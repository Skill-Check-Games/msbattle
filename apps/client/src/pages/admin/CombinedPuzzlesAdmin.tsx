// /admin/combined-puzzles: starting-cascade patterns composed at a shared seam (scripts/combine-patterns.js
// -> combined-puzzles.json, GET /api/combined-puzzles). Each is a real board, so the All-puzzles card and
// Analyze modal are reused with the combined analyze endpoint as base. Port of legacy admin/CombinedPuzzlesView.js.
import { useEffect, useState } from "react";
import { useAuth } from "../../shared/auth";
import { AdminPage } from "./admin-shared";
import { AnalyzeModal, PoolPuzzle, PuzzleCard } from "./PuzzleAnalyze";
import styles from "./CombinedPuzzlesAdmin.module.scss";

interface Payload { puzzles: PoolPuzzle[]; unsatisfiable: { label: string }[]; generatedAt?: string; error?: string; }
const byComplexity = (a: PoolPuzzle, b: PoolPuzzle) => (b.cspMaxComplexity || 0) - (a.cspMaxComplexity || 0);

export default function CombinedPuzzlesAdmin() {
	const { account } = useAuth();
	const [data, setData] = useState<Payload | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [analyze, setAnalyze] = useState<PoolPuzzle | null>(null);

	useEffect(() => {
		if (!account) return;
		let alive = true;
		fetch("/api/combined-puzzles").then(r => r.json()).then(d => { if (alive) setData({ puzzles: (d && d.puzzles) || [], unsatisfiable: (d && d.unsatisfiable) || [], generatedAt: d && d.generatedAt }); }).catch(e => { if (alive) setError(e.message); });
		return () => { alive = false; };
	}, [account]);

	const puzzles = data ? data.puzzles : [];
	const status = error ? "Error: " + error : !data ? "Loading…" : puzzles.length
		? puzzles.length + " combined puzzles" + (data.generatedAt ? " · generated " + data.generatedAt.slice(0, 10) : "")
		: "No combined puzzles. Run scripts/combine-patterns.js to build combined-puzzles.json.";

	// Split by whether the board is fully no-guess solvable. Solvable ones are real playable puzzles;
	// "partial" ones force some cells (often a ring of mines via a case-split) and then stall on a
	// genuine ambiguity, kept because Analyze still shows the hard deduction.
	const section = (heading: string, blurb: string, list: PoolPuzzle[]) => list.length ? (
		<>
			<h2 className={styles.subtitle}>{heading}</h2>
			<p className={styles.blurb}>{blurb}</p>
			<div className={styles.grid}>{list.sort(byComplexity).map(p => <PuzzleCard key={p.id} p={p} onAnalyze={setAnalyze} />)}</div>
		</>
	) : null;

	return (
		<AdminPage wide title="Combined puzzles" sub="Two starting-cascade patterns composed into one board (script-generated, scripts/combine-patterns.js). Cards are real puzzles: click Analyze to play and see the solver's move trace. Rated by the hardest forced deduction; the research question is whether composing building blocks beats the ~cx-8 ceiling a single opening hits.">
			<p className={styles.status}>{status}</p>
			{section("Solvable", "Fully no-guess solvable: real puzzles you can clear by deduction. Click Analyze to play and step the solver.", puzzles.filter(p => p.solved))}
			{section("Partial: forces flags, then ambiguous", "Not no-guess solvable: the solver forces some cells (the corners4-edges2 ring pins a checkerboard of mines via a cx-8 case-split) then stalls on cells no deduction can resolve. Kept because Analyze still shows the hardest forced deduction, including combinations that push past the cx-8 ceiling.", puzzles.filter(p => !p.solved))}
			{data && data.unsatisfiable.length > 0 && (
				<div className={styles.unsat}>
					<h2 className={styles.subtitle}>No consistent layout (patterns conflict at the seam)</h2>
					<ul className={styles.unsatList}>{data.unsatisfiable.map((u, i) => <li key={i}>{u.label}</li>)}</ul>
				</div>
			)}
			<AnalyzeModal puzzle={analyze} base="/api/combined-puzzles" onClose={() => setAnalyze(null)} />
		</AdminPage>
	);
}
