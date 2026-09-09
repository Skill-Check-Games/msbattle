// Start patterns: the unique first-deduction building blocks enumerated from starting cascades
// (scripts/generate-patterns.js writes deduction-patterns.json, served by /api/start-patterns), each
// tagged with the block size(s) it was found in.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../shared/auth";
import { AdminPage } from "./admin-shared";
import { MethodTag, PatternCanvas, RatingBadge, boardStyles } from "./admin-boards";

interface StartPattern {
	id?: string | number; width: number; height: number; rating: number; method: string; complexity: number;
	clueCells?: number[][]; deducedCells?: (number | string)[][]; coveredCells?: (number | string)[][]; wallCells?: (number | string)[][];
	foundIn?: string[]; counts?: Record<string, number>;
}

export default function StartPatternsAdmin() {
	const { account } = useAuth();
	const ready = !!account;
	const [patterns, setPatterns] = useState<StartPattern[]>([]);
	const [status, setStatus] = useState("");

	useEffect(() => {
		if (!ready) return;
		let cancelled = false;
		fetch("/api/start-patterns").then(r => r.json()).then(data => {
			if (cancelled) return;
			const list: StartPattern[] = (data && data.patterns) || [];
			const sizes: string[] = (data && data.sizes) || [];
			setPatterns(list);
			setStatus(list.length
				? list.length + " unique patterns across " + sizes.join(", ") + (data.generatedAt ? " · generated " + String(data.generatedAt).slice(0, 10) : "")
				: "No patterns. Run scripts/generate-patterns.js to build deduction-patterns.json.");
		}).catch(e => { if (!cancelled) setStatus("Error: " + e.message); });
		return () => { cancelled = true; };
	}, [ready]);

	return (
		<AdminPage title="Start patterns" sub="Unique first-deduction patterns enumerated from starting cascades, deduped across block sizes. Each shows the clue cells the first move needed plus what it deduced (flag = forced mine, checkmark = forced safe). Tagged with the size(s) it was found in." wide>
			<p className={boardStyles.status}>{status}</p>
			<div className={boardStyles.patternsGrid}>
				{patterns.map((p, i) => <StartPatternCard key={p.id != null ? p.id : i} rec={p} />)}
			</div>
		</AdminPage>
	);
}

function StartPatternCard({ rec }: { rec: StartPattern }) {
	const cells = useMemo(() => ({ clues: rec.clueCells, deduced: rec.deducedCells, covered: rec.coveredCells, walls: rec.wallCells }), [rec]);
	const deduced = rec.deducedCells || [];
	const safe = deduced.filter(c => c[2] === "S").length, mine = deduced.filter(c => c[2] === "M").length;
	return (
		<div className={boardStyles.card}>
			<div className={boardStyles.cardHead}>
				<RatingBadge rating={rec.rating} />
				<MethodTag method={rec.method} />
			</div>
			<PatternCanvas width={rec.width} height={rec.height} cells={cells} />
			<div className={boardStyles.details}>{(rec.clueCells || []).length} clues → {safe} safe · {mine} mine · cx {rec.complexity}</div>
			<div className={boardStyles.sizeTags}>
				{(rec.foundIn || []).map(sz => { const n = rec.counts && rec.counts[sz]; return <span key={sz} className={boardStyles.sizeTag}>{sz}{n ? " · " + n : ""}</span>; })}
			</div>
		</div>
	);
}
