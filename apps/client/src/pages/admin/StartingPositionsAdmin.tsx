// Enumerated starting positions: the 3x3 cascades (size 3) and the 4x4 corner-mine family (size 4,
// variant corner4). Each card is the opening the player would see with the analyzer's ring
// deductions on top. Paginated with filters mirrored into the query string; the corner-mine family
// also has Analyze, which rebuilds a concrete board and shows the solver trace.
import { useEffect, useMemo, useRef, useState } from "react";
import BoardLogic from "core/src/common/BoardLogic.js";
import { useAuth } from "../../shared/auth";
import { BoardView, UNKNOWN, KNOWN, FLAGGED, sizeCellCanvas } from "../../game/board-render";
import { buildPreviewModel } from "../../game/PreviewBoard";
import { drawOutlines } from "../learn/learn-model";
import { AdminPage, Pager, adminStyles, useQueryState } from "./admin-shared";
import { ActionTag, ChipRow, RatingBadge, StartingPos, StartingPosCanvas, boardStyles } from "./admin-boards";

const PAGE_SIZE = 60;
const FAMILY_OPTIONS = [{ key: "3", label: "3×3 cascade" }, { key: "4", label: "4×4 corner-mine" }];
const RATING_BANDS = [{ key: "", label: "Any" }, { key: "0-199", label: "0 to 199" }, { key: "1200-1399", label: "1200 to 1399" }, { key: "1600-1799", label: "1600 to 1799" }, { key: "1800-1999", label: "1800+" }];
const ACTION_OPTIONS = [{ key: "", label: "Any" }, { key: "reveal", label: "Reveal" }, { key: "flag", label: "Flag" }, { key: "case", label: "Case" }];
const UNIQUE_OPTIONS = [{ key: "", label: "Any" }, { key: "true", label: "Unique" }, { key: "false", label: "Multiple" }];
const PRIME_OPTIONS = [{ key: "", label: "Any" }, { key: "true", label: "Prime" }, { key: "false", label: "Reducible" }];
const DEFAULTS = { size: "3", sort: "desc", action: "", band: "", unique: "", prime: "", page: "0" };

function subtitle(size: number) {
	if (size === 4) {
		return "The 4x4 corner-mine family: a 4x4 opening where one corner is a covered mine the solver must deduce (flagged here), so it floods like a real cascade. The revealed interior is the player view; the outer ring marks the analyzer's deductions (flags = forced mines, checks = forced safe). Ranked by realistic difficulty: each opening is solved on a concrete consistent mine layout with cascades (the same board Analyze rebuilds), max = the hardest single deduction, total = the sum of all of them. The surrounding ring is underconstrained, so many of these openings aren't fully solvable. A random sample across difficulty bands, always keeping the single hardest opening.";
	}
	return "Enumerated cascade patterns where the analyzer can deduce at least one safe cell. The 3x3 cascade is the player view; the outer ring marks what the analyzer can deduce (flags = forced mines, checks = forced safe, plain = ambiguous). Symmetric duplicates are collapsed to the lex-smallest of each orbit. Rating is the complexity of the first analyzer move.";
}

export default function StartingPositionsAdmin() {
	const { account } = useAuth();
	const ready = !!account;
	const [q, setQ] = useQueryState(DEFAULTS);
	const page = Math.max(0, parseInt(q.page, 10) || 0);
	const size = q.size === "4" ? 4 : 3;
	const [positions, setPositions] = useState<StartingPos[]>([]);
	const [total, setTotal] = useState(0);
	const [status, setStatus] = useState("");
	const [analyzing, setAnalyzing] = useState<StartingPos | null>(null);

	useEffect(() => {
		if (!ready) return;
		let cancelled = false;
		const bits = ["size=" + size, "page=" + page, "pageSize=" + PAGE_SIZE, "sort=" + q.sort];
		if (q.action) bits.push("action=" + q.action);
		if (q.band) { const [min, max] = q.band.split("-"); bits.push("minRating=" + min, "maxRating=" + max); }
		if (q.unique) bits.push("unique=" + q.unique);
		if (q.prime) bits.push("prime=" + q.prime);
		fetch("/api/starting-positions?" + bits.join("&")).then(r => r.json()).then(data => {
			if (cancelled) return;
			const list: StartingPos[] = (data && data.positions) || [];
			const n = data && typeof data.total === "number" ? data.total : list.length;
			setPositions(list); setTotal(n);
			const fromN = n ? page * PAGE_SIZE + 1 : 0, toN = Math.min(n, (page + 1) * PAGE_SIZE);
			setStatus(n + " match" + (n === 1 ? "" : "es") + (n ? " · showing " + fromN + " to " + toN : ""));
		}).catch(e => { if (!cancelled) setStatus("Error: " + e.message); });
		return () => { cancelled = true; };
	}, [ready, size, page, q.sort, q.action, q.band, q.unique, q.prime]);

	const filter = (patch: Record<string, string>) => setQ({ ...patch, page: "0" });

	return (
		<AdminPage title="Starting positions" sub={subtitle(size)} wide>
			<div className={boardStyles.toolbar}>
				<div className={boardStyles.sortWrap}>
					<span className={boardStyles.filterLabel}>Sort</span>
					<select className={adminStyles.select} value={q.sort} onChange={e => filter({ sort: e.target.value })}>
						<option value="desc">Hardest first</option>
						<option value="asc">Easiest first</option>
					</select>
				</div>
				<ChipRow label="Family" options={FAMILY_OPTIONS} value={q.size} onChange={k => filter({ size: k })} />
				<ChipRow label="Rating" options={RATING_BANDS} value={q.band} onChange={k => filter({ band: k })} />
				<ChipRow label="First action" options={ACTION_OPTIONS} value={q.action} onChange={k => filter({ action: k })} />
				<ChipRow label="Solutions" options={UNIQUE_OPTIONS} value={q.unique} onChange={k => filter({ unique: k })} />
				<ChipRow label="Pattern" options={PRIME_OPTIONS} value={q.prime} onChange={k => filter({ prime: k })} />
			</div>
			<p className={boardStyles.status}>{status}</p>
			{positions.length === 0
				? <p className={boardStyles.empty}>No starting positions match.</p>
				: <div className={boardStyles.positionsGrid}>{positions.map(p => <PositionCard key={p.id} pos={p} onAnalyze={() => setAnalyzing(p)} />)}</div>}
			<Pager total={total} page={page} pageSize={PAGE_SIZE} onGoto={p => setQ({ page: String(p) })} />
			{analyzing && <AnalyzePanel pos={analyzing} onClose={() => setAnalyzing(null)} />}
		</AdminPage>
	);
}

function PositionCard({ pos, onAnalyze }: { pos: StartingPos; onAnalyze: () => void }) {
	const corner = pos.variant === "corner4";
	return (
		<div className={boardStyles.card}>
			<div className={boardStyles.cardHead}>
				<RatingBadge rating={pos.rating} />
				<ActionTag action={pos.first_action} />
			</div>
			<StartingPosCanvas pos={pos} />
			{pos.total_complexity != null && (
				<div className={boardStyles.detailsMuted}>max {(+(pos.max_complexity || 0)).toFixed(1)} · total {(+pos.total_complexity).toFixed(1)} difficulty</div>
			)}
			<div className={boardStyles.detailsMuted}>{pos.solutions} soln · {pos.forced_safe} safe · {pos.forced_mine} mine</div>
			<div className={boardStyles.patternText}>{pos.pattern}</div>
			{corner && <button type="button" className={boardStyles.smallBtn} onClick={onAnalyze}>Analyze</button>}
		</div>
	);
}

// ---- Analyze: solver trace for a corner-mine opening ----
// One fetch returns the reconstructed board layout and the solver moves. Clicking a move applies the
// moves up to it on the board and outlines the cells that move changed.
interface Move { method: string; complexity: number; revealed?: number[][]; flagged?: number[][]; changed?: number[][]; cells?: number[][]; splitCell?: number[]; componentSize?: number; }
interface Trace { rows: number; cols: number; mines: number[][]; revealed: number[][]; moves: Move[]; maxComplexity: number; totalComplexity: number; solved: boolean; safeCovered: number; error?: string; }

function tierOf(mx: number) { return mx >= 8 ? 6 : mx >= 6 ? 5 : mx >= 4 ? 4 : mx >= 2 ? 3 : mx >= 1 ? 2 : 1; }
const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const plural = (n: number, word: string) => n + " " + word + (n === 1 ? "" : "s");

function describe(mv: Move) {
	const rCount = (mv.revealed || []).length, fCount = (mv.flagged || []).length;
	const outcome = rCount && fCount ? plural(rCount, "safe") + ", " + plural(fCount, "mine") : rCount ? plural(rCount, "safe") : plural(fCount, "mine");
	if (mv.method === "case" && mv.splitCell) return "case (" + mv.splitCell[0] + "," + mv.splitCell[1] + ") → " + outcome;
	if (mv.method === "enum") return "enum " + mv.componentSize + " → " + outcome;
	return outcome;
}

function AnalyzePanel({ pos, onClose }: { pos: StartingPos; onClose: () => void }) {
	const [trace, setTrace] = useState<Trace | null>(null);
	const [error, setError] = useState("");
	const [active, setActive] = useState(-1);

	useEffect(() => {
		let cancelled = false;
		setTrace(null); setError(""); setActive(-1);
		fetch("/api/starting-positions/" + pos.id + "/analyze").then(r => r.json()).then(data => {
			if (cancelled) return;
			if (!data || data.error) { setError((data && data.error) || "Analyze failed"); return; }
			setTrace(data);
		}).catch(e => { if (!cancelled) setError(e.message); });
		return () => { cancelled = true; };
	}, [pos]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	const moves = trace ? trace.moves || [] : [];
	return (
		<div className={boardStyles.analyzeBackdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
			<div className={boardStyles.analyzePanel} role="dialog" aria-label="Analyze starting position">
				<div className={boardStyles.analyzeHead}>
					<h2>Analyze · corner-mine #{pos.id}</h2>
					<span className={boardStyles.analyzeSub}>
						{trace && `${trace.rows}×${trace.cols} · ${Math.round((trace.mines.length / (trace.rows * trace.cols)) * 100)}% · `}rating {pos.rating} · t{tierOf(+(pos.max_complexity || 0))}
					</span>
					<button type="button" className={boardStyles.smallBtn} onClick={onClose}>Close</button>
				</div>
				<div className={boardStyles.analyzeBody}>
					<div>{trace && <TraceBoard trace={trace} upTo={active} />}</div>
					<div>
						<div className={adminStyles.label}>Solver moves</div>
						<p className={boardStyles.status}>
							{error ? "Error: " + error : !trace ? "Analyzing…"
								: "max complexity " + fmt(trace.maxComplexity) + " · total " + fmt(trace.totalComplexity) + (trace.solved ? " · solved" : " · " + trace.safeCovered + " safe cells uncovered")}
						</p>
						{trace && (
							<ol className={boardStyles.traceList}>
								{moves.map((mv, i) => (
									<li key={i} className={`${boardStyles.traceMove} ${i === active ? boardStyles.traceActive : ""}`} onClick={() => setActive(i)}>
										<span className={boardStyles.traceIndex}>#{i + 1}</span>
										<span>{describe(mv)}</span>
										<span className={boardStyles.traceCells}>{(mv.changed || mv.cells || []).map(rc => "(" + rc[0] + "," + rc[1] + ")").join(" ")}</span>
										<span className={boardStyles.traceCompl}>c={Math.round(mv.complexity * 10) / 10}</span>
									</li>
								))}
							</ol>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

// The reconstructed board with moves 0..upTo applied (reveals cascade like the server's solver
// did) and the focused move's cells outlined.
function TraceBoard({ trace, upTo }: { trace: Trace; upTo: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	const spec = useMemo(() => ({ rows: trace.rows, cols: trace.cols, mines: trace.mines, revealed: trace.revealed }), [trace]);
	useEffect(() => {
		const canvas = ref.current; if (!canvas) return;
		const R = spec.rows, C = spec.cols;
		sizeCellCanvas(canvas, C, R, 40);
		const m = buildPreviewModel(spec);
		const state = m.state;
		const reveal = (r: number, c: number) => BoardLogic.cascadeReveal(r, c, R, C,
			(rr: number, cc: number) => state[rr][cc] === UNKNOWN,
			(rr: number, cc: number) => { state[rr][cc] = KNOWN; return m.isMine[rr][cc]; },
			(rr: number, cc: number) => m.clue[rr][cc]);
		const moves = trace.moves || [];
		for (let i = 0; i <= upTo && i < moves.length; i++) {
			for (const rc of moves[i].revealed || []) reveal(rc[0], rc[1]);
			for (const rc of moves[i].flagged || []) state[rc[0]][rc[1]] = FLAGGED;
		}
		const focus = upTo >= 0 && moves[upTo] ? [...(moves[upTo].revealed || []), ...(moves[upTo].flagged || [])] : [];
		new BoardView(canvas, R, C, state, m.cellAt)
			.overlay((ctx, sw, sh) => drawOutlines(ctx, sw, sh, focus, "rgba(250, 204, 21, 0.95)", "rgba(250, 204, 21, 0.7)"))
			.draw();
	}, [spec, trace, upTo]);
	return <canvas ref={ref} className={boardStyles.canvas} aria-hidden="true" />;
}
