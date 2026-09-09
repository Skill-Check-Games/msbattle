// Deduction-pattern catalogue: each row is a unique "first deduction" template (clue cells plus the
// cells that move deduced) canonicalized by translation and dihedral symmetry. Paginated, filtered by
// method, ordered by rating or occurrences; filters live in the query string.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../shared/auth";
import { AdminPage, Pager, adminStyles, useQueryState } from "./admin-shared";
import { ChipRow, MethodTag, PatternCanvas, RatingBadge, boardStyles } from "./admin-boards";

const PAGE_SIZE = 50;
const METHOD_OPTIONS: { key: string; label: string }[] = [
	{ key: "", label: "Any" }, { key: "trivial", label: "Trivial" }, { key: "subset", label: "Subset" }, { key: "intersect", label: "Intersect" }, { key: "union", label: "Union" }, { key: "case", label: "Case" }
];
const ORDER_OPTIONS = [
	{ value: "rating-desc", label: "Hardest first" }, { value: "rating-asc", label: "Easiest first" },
	{ value: "occurrences-desc", label: "Most used first" }, { value: "occurrences-asc", label: "Least used first" }
];
const DEFAULTS = { sort: "desc", orderBy: "rating", method: "", page: "0" };

interface Pattern { id: number; width: number; height: number; rating: number; method: string; clue_count: number; safe_count: number; mine_count: number; occurrence_count: number; cells_json: string; }

export default function PatternsAdmin() {
	const { account } = useAuth();
	const ready = !!account;
	const [q, setQ] = useQueryState(DEFAULTS);
	const page = Math.max(0, parseInt(q.page, 10) || 0);
	const [patterns, setPatterns] = useState<Pattern[]>([]);
	const [total, setTotal] = useState(0);
	const [status, setStatus] = useState("");

	useEffect(() => {
		if (!ready) return;
		let cancelled = false;
		const bits = ["page=" + page, "pageSize=" + PAGE_SIZE, "sort=" + q.sort, "orderBy=" + q.orderBy];
		if (q.method) bits.push("method=" + q.method);
		fetch("/api/patterns?" + bits.join("&")).then(r => r.json()).then(data => {
			if (cancelled) return;
			const list: Pattern[] = (data && data.patterns) || [];
			const n = data && typeof data.total === "number" ? data.total : list.length;
			setPatterns(list); setTotal(n);
			const fromN = n ? page * PAGE_SIZE + 1 : 0, toN = Math.min(n, (page + 1) * PAGE_SIZE);
			setStatus(n + " pattern" + (n === 1 ? "" : "s") + (n ? " · showing " + fromN + " to " + toN : ""));
		}).catch(e => { if (!cancelled) setStatus("Error: " + e.message); });
		return () => { cancelled = true; };
	}, [ready, page, q.sort, q.orderBy, q.method]);

	return (
		<AdminPage title="Deduction patterns" sub="First-move templates extracted from every starting position. Each pattern shows the clue cells the analyzer needed plus the cells that first move deduced (flag = forced mine, checkmark = forced safe). Position, rotation, and reflection are collapsed: patterns that are rotations or mirrors of each other share one row." wide>
			<div className={boardStyles.toolbar}>
				<div className={boardStyles.sortWrap}>
					<span className={boardStyles.filterLabel}>Order by</span>
					<select className={adminStyles.select} value={q.orderBy + "-" + q.sort} onChange={e => { const [orderBy, sort] = e.target.value.split("-"); setQ({ orderBy, sort, page: "0" }); }}>
						{ORDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
					</select>
				</div>
				<ChipRow label="Method" options={METHOD_OPTIONS} value={q.method} onChange={k => setQ({ method: k, page: "0" })} />
			</div>
			<p className={boardStyles.status}>{status}</p>
			{patterns.length === 0
				? <p className={boardStyles.empty}>No patterns to show.</p>
				: <div className={boardStyles.patternsGrid}>{patterns.map(p => <PatternCard key={p.id} pat={p} />)}</div>}
			<Pager total={total} page={page} pageSize={PAGE_SIZE} onGoto={p => setQ({ page: String(p) })} />
		</AdminPage>
	);
}

function PatternCard({ pat }: { pat: Pattern }) {
	const cells = useMemo(() => { try { return JSON.parse(pat.cells_json); } catch { return null; } }, [pat.cells_json]);
	return (
		<div className={boardStyles.card}>
			<div className={boardStyles.cardHead}>
				<RatingBadge rating={pat.rating} />
				<MethodTag method={pat.method} />
			</div>
			{cells && <PatternCanvas width={pat.width} height={pat.height} cells={cells} />}
			<div className={boardStyles.details}>{pat.clue_count} clues → {pat.safe_count} safe · {pat.mine_count} mine</div>
			<div className={boardStyles.uses}>used by {pat.occurrence_count} starting position{pat.occurrence_count === 1 ? "" : "s"}</div>
		</div>
	);
}
