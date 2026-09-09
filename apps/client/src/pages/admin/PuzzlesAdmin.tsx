// /admin/puzzles: the whole puzzle pool (GET /api/puzzles), paginated, sortable by rating and
// filterable by tier, solver method, complexity band and source. Filters live in the query string
// so a reload keeps the view. Port of legacy admin/Puzzles.js (renderPuzzlesList + stats panel).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../shared/auth";
import { AdminPage, Pager, adminStyles, useQueryState } from "./admin-shared";
import { AnalyzeModal, PoolPuzzle, PuzzleCard } from "./PuzzleAnalyze";
import styles from "./PuzzlesAdmin.module.scss";

const PAGE_SIZE = 50;
// Complexity bands: the score column carries CSP maxComplexity + total/20, so these map directly
// to the difficulty bands the user sees in the rating curve.
const SCORE_BANDS = [["", "Any"], ["0-1", "0–1"], ["1-2", "1–2"], ["2-3", "2–3"], ["3-4", "3–4"], ["4-5", "4–5"], ["5-6", "5–6"], ["6-8", "6–8"], ["8-10", "8–10"], ["10+", "10+"]];
const METHODS = [["", "Any"], ["trivial", "Trivial"], ["subset", "Subset"], ["union", "Union"], ["intersect", "Intersection"], ["case", "Case-split"], ["enum", "Enum"]];
const DIFFS = [["", "All"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"], ["6", "6"]];
const DEFAULTS = { sort: "score-asc", diff: "", method: "", score: "", source: "", page: "0" };

export default function PuzzlesAdmin() {
	const { account } = useAuth();
	const [q, setQ] = useQueryState(DEFAULTS);
	const page = Math.max(0, parseInt(q.page, 10) || 0);
	const [data, setData] = useState<{ puzzles: PoolPuzzle[]; total: number; pool: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sources, setSources] = useState<{ source: string; count: number }[]>([]);
	const [analyze, setAnalyze] = useState<PoolPuzzle | null>(null);

	const query = useMemo(() => {
		let qs = "page=" + page + "&pageSize=" + PAGE_SIZE + "&sort=" + (q.sort === "score-desc" ? "desc" : "asc");
		if (q.diff) qs += "&diff=" + q.diff;
		if (q.method) qs += "&method=" + q.method;
		if (q.score) qs += "&score=" + encodeURIComponent(q.score);
		if (q.source) qs += "&source=" + q.source;
		return qs;
	}, [page, q.sort, q.diff, q.method, q.score, q.source]);

	useEffect(() => {
		if (!account) return;
		let alive = true;
		setError(null);
		fetch("/api/puzzles?" + query).then(r => r.json()).then(d => {
			if (!alive) return;
			const puzzles = (d && d.puzzles) || [];
			setData({ puzzles, total: typeof d.total === "number" ? d.total : puzzles.length, pool: d.pool != null ? d.pool : (typeof d.total === "number" ? d.total : puzzles.length) });
		}).catch(e => { if (alive) setError(e.message); });
		return () => { alive = false; };
	}, [account, query]);

	// Whatever sources are actually in the pool (random, inside_out, template:<id>, ...), so
	// dynamically-tagged sources show up without hardcoding.
	useEffect(() => {
		if (!account) return;
		let alive = true;
		fetch("/api/puzzle-sources").then(r => r.json()).then(d => { if (alive) setSources(((d && d.sources) || []).filter((s: any) => s.source != null && s.source !== "")); }).catch(() => {});
		return () => { alive = false; };
	}, [account]);

	const setFilter = (patch: Partial<typeof DEFAULTS>) => setQ({ ...patch, page: "0" });
	const chips = (label: string, opts: string[][], key: keyof typeof DEFAULTS, cls?: (v: string) => string) => (
		<div className={styles.filter}>
			<span className={adminStyles.label}>{label}</span>
			{opts.map(([v, text]) => (
				<button key={v} type="button" className={`${styles.chip} ${q[key] === v ? styles.chipActive : ""} ${cls ? cls(v) : ""}`} onClick={() => setFilter({ [key]: v } as any)}>{text}</button>
			))}
		</div>
	);

	let status = "";
	if (data) {
		const bits = ["Pool: " + data.pool + " puzzles"];
		if (q.diff) bits.push("diff " + q.diff + " · " + data.total);
		const fromN = data.total ? page * PAGE_SIZE + 1 : 0, toN = Math.min(data.total, (page + 1) * PAGE_SIZE);
		bits.push("showing " + fromN + "–" + toN);
		status = bits.join(" · ");
	}

	return (
		<AdminPage wide title="All puzzles" sub="Browse all puzzles in the pool. Sort by rating, filter by tier. Each puzzle's rating is calibrated from the solver and will move with human play once Rated mode is live.">
			<StatsPanel ready={!!account} />
			<div className={styles.toolbar}>
				<div className={styles.filter}>
					<span className={adminStyles.label}>Sort</span>
					<select className={adminStyles.select} value={q.sort} onChange={e => setFilter({ sort: e.target.value })}>
						<option value="score-asc">Easiest first</option>
						<option value="score-desc">Hardest first</option>
					</select>
				</div>
				{chips("Difficulty", DIFFS, "diff", v => v ? styles["chipDiff" + v] : "")}
				{chips("Method", METHODS, "method")}
				{chips("Complexity", SCORE_BANDS, "score")}
				{chips("Source", [["", "Any"], ...sources.map(s => [s.source, s.source + " (" + s.count + ")"])], "source")}
			</div>
			<p className={styles.status}>{error ? "Error: " + error : status || "Loading…"}</p>
			<div className={styles.grid}>
				{data && data.puzzles.length === 0 && <p className={styles.empty}>{page > 0 ? "No puzzles on this page, try going back." : "No puzzles to show, head to the Lab to generate some."}</p>}
				{data && data.puzzles.map(p => <PuzzleCard key={p.id} p={p} onAnalyze={setAnalyze} />)}
			</div>
			{data && <Pager total={data.total} page={page} pageSize={PAGE_SIZE} onGoto={p => setQ({ page: String(p) })} />}
			<p className={styles.footer}><Link to="/admin/lab">Open the Puzzle Lab →</Link></p>
			<AnalyzeModal puzzle={analyze} base="/api/puzzles" onClose={() => setAnalyze(null)} />
		</AdminPage>
	);
}

// ---- stats panel: rating histogram, tier breakdown, board-size mix, density mix. Collapsed by default. ----
const METHOD_KEYS = ["trivial", "subset", "union", "intersect", "case", "enum"] as const;
interface Stats { total: number; ratingHistogram: { bucket: number; n: number }[]; tierBreakdown: ({ tier: number; n: number } & Record<string, number>)[]; sizeMix: { size: string; n: number }[]; densityMix: { bucket: number; n: number }[]; needsCaseSplit: number; }
const maxOf = <T,>(arr: T[], get: (t: T) => number) => { let m = 0; for (const x of arr) { const v = get(x); if (v > m) m = v; } return m || 1; };

function StatsPanel({ ready }: { ready: boolean }) {
	const [open, setOpen] = useState(false);
	const [stats, setStats] = useState<Stats | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!open || !ready || stats) return;
		let alive = true;
		fetch("/api/puzzles/stats").then(r => r.json()).then(d => { if (alive) setStats(d); }).catch(e => { if (alive) setError(e.message); });
		return () => { alive = false; };
	}, [open, ready, stats]);
	return (
		<div className={styles.stats}>
			<button type="button" className={styles.statsToggle} onClick={() => setOpen(o => !o)}>{(open ? "▼" : "▶") + " Stats"}</button>
			{open && (
				<div className={styles.statsBody}>
					{error ? "Error: " + error : !stats ? "Loading…" : !stats.total ? "Pool empty." : (
						<>
							<StatBlock title="Rating distribution"><Bars rows={stats.ratingHistogram.map(b => ({ label: b.bucket + "–" + (b.bucket + 199), n: b.n }))} /></StatBlock>
							<StatBlock title="Tier breakdown"><TierChart tiers={stats.tierBreakdown} /></StatBlock>
							<StatBlock title="Board sizes"><Bars rows={stats.sizeMix.map(s => ({ label: s.size, n: s.n }))} /></StatBlock>
							<StatBlock title="Mine density"><Bars rows={stats.densityMix.map(b => ({ label: b.bucket + "–" + (b.bucket + 4) + "%", n: b.n }))} /></StatBlock>
							{stats.needsCaseSplit > 0 && <p className={styles.statsNote}>{stats.needsCaseSplit} puzzles need case-split ({Math.round(100 * stats.needsCaseSplit / stats.total)}% of pool)</p>}
						</>
					)}
				</div>
			)}
		</div>
	);
}
function StatBlock({ title, children }: { title: string; children: React.ReactNode }) {
	return <div className={styles.statsBlock}><h3 className={styles.statsBlockTitle}>{title}</h3>{children}</div>;
}
function Bars({ rows }: { rows: { label: string; n: number }[] }) {
	const max = maxOf(rows, r => r.n);
	return (
		<div className={styles.chart}>
			{rows.map(r => (
				<div key={r.label} className={styles.chartRow}>
					<span className={styles.chartLabel}>{r.label}</span>
					<span className={styles.bar}><span className={styles.barFill} style={{ width: Math.round(100 * r.n / max) + "%" }} /></span>
					<span className={styles.chartValue}>{r.n}</span>
				</div>
			))}
		</div>
	);
}
// Stacked bar per tier showing method composition.
function TierChart({ tiers }: { tiers: Stats["tierBreakdown"] }) {
	const max = maxOf(tiers, t => t.n);
	return (
		<div className={styles.chart}>
			{tiers.map(t => (
				<div key={t.tier} className={styles.chartRow}>
					<span className={styles.chartLabel}>tier {t.tier}</span>
					<span className={styles.bar}>
						<span className={styles.stack} style={{ width: (t.n / max) * 100 + "%" }}>
							{METHOD_KEYS.map(k => t[k] ? <span key={k} className={`${styles.seg} ${styles["seg_" + k]}`} style={{ width: Math.round(100 * t[k] / t.n) + "%" }} title={k + ": " + t[k]} /> : null)}
						</span>
					</span>
					<span className={styles.chartValue}>{t.n}</span>
				</div>
			))}
			<div className={styles.legend}>{METHOD_KEYS.map(k => <span key={k} className={styles.legendItem}><span className={`${styles.seg} ${styles["seg_" + k]}`} /> {k}</span>)}</div>
		</div>
	);
}
