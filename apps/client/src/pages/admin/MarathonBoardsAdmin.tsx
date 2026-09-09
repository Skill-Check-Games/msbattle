// Admin browse view for script-generated marathon/Nightmare boards (scripts/generate-marathon-boards.js
// -> puzzles table, source="marathon"). Port of the legacy admin/MarathonBoards.js: a sortable table
// of metadata (size, density, difficulty, generation provenance) with a Play button per row, plus the
// "Generate board" job runner (marathon_gen_start/stop/status + marathon_gen_update frames from
// apps/server/src/runtime/marathonGen.js) with its always-visible status bar.
//
// Play goes through the real puzzle engine (puzzle_retry -> puzzle_board, the same path "Try again"
// uses), here inside an in-page modal with a live BoardSession rather than the legacy full-screen
// takeover, so the admin list stays where it was.
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../shared/auth";
import { getSocket, onSocket } from "../../online/socket";
import { BoardSession } from "../../game/board-session";
import { KNOWN, UNKNOWN } from "../../game/board-render";
import { makeBoardDecoder } from "../../game/board-decoder";
import { sound } from "../../audio/sound";
import GameBoard from "../../game/GameBoard";
import BoardLogic from "core/src/common/BoardLogic.js";
import { AdminPage, Pager, useQueryState, adminStyles } from "./admin-shared";
import styles from "./MarathonBoardsAdmin.module.scss";

const SORT_OPTIONS = [
	{ key: "total_desc", label: "Hardest overall (total)", orderBy: "total_complexity", dir: "desc" },
	{ key: "total_asc", label: "Easiest overall (total)", orderBy: "total_complexity", dir: "asc" },
	{ key: "max_desc", label: "Hardest single move", orderBy: "max_complexity", dir: "desc" },
	{ key: "newest", label: "Newest first", orderBy: "created_at", dir: "desc" }
];
const PAGE_SIZE = 30;
const DEFAULTS = { sort: "total_desc", tier: "", page: "0" };
const TIERS = [null, 1, 2, 3, 4, 5, 6];

function sessionHeaders(): Record<string, string> {
	try { const t = localStorage.getItem("ms_session"); return t ? { "X-Session-Token": t } : {}; } catch { return {}; }
}

function relativeTime(ts: number | null | undefined): string {
	if (!ts) return "n/a";
	const mins = Math.floor((Date.now() - ts) / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return mins + "m ago";
	const hours = Math.floor(mins / 60);
	if (hours < 24) return hours + "h ago";
	return Math.floor(hours / 24) + "d ago";
}
function formatElapsed(ms: number): string {
	const s = Math.floor(ms / 1000), m = Math.floor(s / 60), r = s % 60;
	return m + ":" + (r < 10 ? "0" : "") + r;
}
const statusLabel = (status: string) =>
	status === "running" ? "Generating…" : status === "stopping" ? "Stopping…" : status === "done" ? "Done" : status === "stopped" ? "Stopped" : status === "error" ? "Error" : status;

function Stars({ count, big }: { count: number; big?: boolean }) {
	return <span className={big ? styles.starsBig : styles.stars}>{[1, 2, 3].map(i => <span key={i} className={`${styles.star} ${i <= count ? styles.starFilled : ""}`}>★</span>)}</span>;
}

// The server's marathon_gen_update snapshot (marathonGen.js `snapshot()`).
interface GenJob { id?: number; status: string; params?: any; startedAt?: number; finishedAt?: number; latest?: any; log?: string[]; exitCode?: number; error?: string | null; }

export default function MarathonBoardsAdmin() {
	const { account } = useAuth();
	const [q, setQ] = useQueryState(DEFAULTS);
	const [boards, setBoards] = useState<any[]>([]);
	const [total, setTotal] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [job, setJob] = useState<GenJob | null>(null);
	const [dismissedId, setDismissedId] = useState<number | null>(null);
	const [genOpen, setGenOpen] = useState(false);
	const [showForm, setShowForm] = useState(true);
	const [playing, setPlaying] = useState<any | null>(null);
	const [, tick] = useState(0);
	const page = Math.max(0, parseInt(q.page, 10) || 0);
	const tier = parseInt(q.tier, 10);
	const tierFilter = tier >= 1 && tier <= 6 ? tier : null;
	const admin = !!(account && account.isAdmin);

	// Generation job stream. Registered once; the status request goes out once the socket is authenticated.
	useEffect(() => onSocket("marathon_gen_update", (data: GenJob) => {
		setJob(data);
		if (data.status === "running" || data.status === "stopping") setDismissedId(null);
		if (data.status === "done") setReloadKey(k => k + 1);
	}), []);
	useEffect(() => { if (admin) getSocket().emit("marathon_gen_status"); }, [admin]);
	// Ticks the elapsed-time display while a job is running.
	useEffect(() => {
		if (!job || job.status !== "running") return;
		const h = setInterval(() => tick(n => n + 1), 500);
		return () => clearInterval(h);
	}, [job && job.status]);

	useEffect(() => {
		if (!admin) return;
		let cancelled = false;
		const opt = SORT_OPTIONS.find(o => o.key === q.sort) || SORT_OPTIONS[0];
		const bits = ["source=marathon", "orderBy=" + opt.orderBy, "sort=" + opt.dir, "page=" + page, "pageSize=" + PAGE_SIZE];
		if (tierFilter) bits.push("diff=" + tierFilter);
		// The session token lets the server attach the signed-in admin's own best (marathon_best) to each row.
		fetch("/api/puzzles?" + bits.join("&"), { headers: sessionHeaders() })
			.then(r => r.json())
			.then(data => {
				if (cancelled) return;
				const list = data.puzzles || [];
				setBoards(list); setTotal(typeof data.total === "number" ? data.total : list.length); setError(null);
			})
			.catch(e => { if (!cancelled) setError(e.message); });
		return () => { cancelled = true; };
	}, [admin, q.sort, tierFilter, page, reloadKey]);

	const fromN = total ? page * PAGE_SIZE + 1 : 0;
	const toN = Math.min(total, (page + 1) * PAGE_SIZE);
	const jobActive = !!job && (job.status === "running" || job.status === "stopping");
	const openGen = () => { if (!jobActive) setShowForm(true); setGenOpen(true); };

	return (
		<AdminPage title="Marathon boards" wide
			sub="Long, dense, fully no-guess-solvable boards from the hill-climb generator (scripts/generate-marathon-boards.js): lots of medium-difficulty moves rather than one rare hard one. Sort by difficulty, click Play to try one."
			actions={<button type="button" className="btn btn-primary" onClick={openGen}>Generate board</button>}>

			{job && job.status !== "idle" && job.id !== dismissedId && <GenStatusBar job={job} onDismiss={() => setDismissedId(job.id ?? null)} />}

			<div className={styles.toolbar}>
				<div className={adminStyles.row}>
					<span className={adminStyles.label}>Sort</span>
					<select className={adminStyles.select} value={q.sort} onChange={e => setQ({ sort: e.target.value, page: "0" })}>
						{SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
					</select>
				</div>
				<div className={adminStyles.row}>
					<span className={adminStyles.label}>Tier</span>
					{TIERS.map(t => <button key={String(t)} type="button" className={`${styles.chip} ${t === tierFilter ? styles.chipActive : ""}`} onClick={() => setQ({ tier: t == null ? "" : String(t), page: "0" })}>{t == null ? "Any" : "t" + t}</button>)}
				</div>
			</div>

			<p className={adminStyles.muted}>{error ? "Error: " + error : total + " board" + (total === 1 ? "" : "s") + (total ? " · showing " + fromN + "–" + toN : "")}</p>

			<div className={adminStyles.tableWrap}>
				<table className={adminStyles.table}>
					<thead><tr>{["Size", "Mines", "Max diff", "Total diff", "Tier", "Method", "Passes", "Best", "Created", ""].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
					<tbody>
						{boards.length === 0
							? <tr><td colSpan={10} className={adminStyles.muted}>No marathon boards yet. Run scripts/generate-marathon-boards.js or click Generate board.</td></tr>
							: boards.map(p => <BoardRow key={p.id} p={p} onPlay={() => setPlaying(p)} />)}
					</tbody>
				</table>
			</div>
			<Pager total={total} page={page} pageSize={PAGE_SIZE} onGoto={p => setQ({ page: String(p) })} />

			{genOpen && <GenModal job={job} showForm={showForm} setShowForm={setShowForm} onClose={() => setGenOpen(false)} />}
			{playing && <PlayModal puzzle={playing} onClose={() => { setPlaying(null); setReloadKey(k => k + 1); }} />}
		</AdminPage>
	);
}

function BoardRow({ p, onPlay }: { p: any; onPlay: () => void }) {
	const mines = p.mines ? p.mines.length : (p.mineCount || 0);
	const density = Math.round((mines / (p.rows * p.cols)) * 100);
	// Every method currently generated is "hillclimb:…", a redundant prefix on a page that only ever
	// shows hillclimb boards; the full string stays in the tooltip.
	const methodText = (p.genMethod || "n/a").replace(/^hillclimb:/, "");
	return (
		<tr>
			<td>{p.rows}×{p.cols}</td>
			<td>{mines} · {density}%</td>
			<td className={adminStyles.mono}>{p.maxComplexity != null ? (+p.maxComplexity).toFixed(1) : "n/a"}</td>
			<td className={adminStyles.mono}>{p.totalComplexity != null ? (+p.totalComplexity).toFixed(1) : "n/a"}</td>
			<td><span className={`${styles.tierBadge} ${styles["tier" + p.difficulty] || ""}`}>t{p.difficulty}</span></td>
			<td className={styles.methodCell} title={p.genMethod || ""}>{methodText}</td>
			<td className={adminStyles.mono}>{p.genIterations != null ? p.genIterations : "n/a"}</td>
			<td title={p.attempts ? p.attempts + " attempt" + (p.attempts === 1 ? "" : "s") : undefined}>{p.bestStars != null ? <Stars count={p.bestStars} /> : <span className={adminStyles.muted}>n/a</span>}</td>
			<td className={adminStyles.muted}>{relativeTime(p.createdAt || p.created_at)}</td>
			<td><button type="button" className={`btn ${styles.playBtn}`} onClick={onPlay}>Play</button></td>
		</tr>
	);
}

// --- Generation status bar: visible on the page (not just inside the modal) while a job is active,
// and left up after it finishes so the outcome is visible without having kept the modal open. ---
function GenStatsLine({ job, finished }: { job: GenJob; finished: boolean }) {
	const latest = job.latest || {};
	if (latest.totalC != null) {
		return <div className={styles.genStats}>
			{"iter " + (latest.iter || 0) + " · totalC=" + latest.totalC.toFixed(1) + " · maxC=" + latest.maxC.toFixed(2)
				+ (latest.accepted != null ? " · " + latest.accepted + " accepted" : "")
				+ (finished && latest.puzzleId != null ? " · saved as puzzle id " + latest.puzzleId : "")}
		</div>;
	}
	// Nothing ever parsed (e.g. no solvable initial board within the density/size given): surface the
	// generator's own last line instead of leaving it blank.
	if (finished && job.log && job.log.length) return <div className={styles.genStats}>{job.log[job.log.length - 1]}</div>;
	return <div className={styles.genStats}>Searching for an initial solvable board…</div>;
}

function GenStatusBar({ job, onDismiss }: { job: GenJob; onDismiss: () => void }) {
	const p = job.params || {};
	const running = job.status === "running";
	const finished = job.status === "done" || job.status === "error" || job.status === "stopped";
	const tone = job.status === "error" ? styles.barError : job.status === "done" ? styles.barDone : "";
	return (
		<div className={`${styles.genBar} ${tone}`}>
			<div className={styles.genBarHead}>
				<span className={styles.genBadge}>{statusLabel(job.status)}</span>
				<span className={adminStyles.muted}>{p.rows + "×" + p.cols + " @ " + Math.round((p.density || 0) * 100) + "% · target " + p.target + " · " + p.strategy}</span>
				{running && job.startedAt && <span className={`${adminStyles.muted} ${adminStyles.mono}`}>{formatElapsed(Date.now() - job.startedAt)}</span>}
			</div>
			<GenStatsLine job={job} finished={finished} />
			{job.status === "error" && job.error && <div className={styles.genError}>{job.error}</div>}
			<div className={styles.genBarActions}>
				{running
					? <button type="button" className="btn btn-ghost" onClick={() => getSocket().emit("marathon_gen_stop")}>Stop</button>
					: <button type="button" className="btn btn-ghost" onClick={onDismiss}>Dismiss</button>}
			</div>
			{job.log && job.log.length > 0 && <details className={styles.logDetails}><summary>Log</summary><pre className={styles.genLog}>{job.log.join("\n")}</pre></details>}
		</div>
	);
}

// --- Generate modal: pick params, start the job, then hand off to the status bar above. Dispatches
// on the job status: the config form, a live progress view, or a frozen final result. ---
function GenModal({ job, showForm, setShowForm, onClose }: { job: GenJob | null; showForm: boolean; setShowForm: (v: boolean) => void; onClose: () => void }) {
	const [form, setForm] = useState({ rows: 24, cols: 30, density: 20, target: 300, maximize: false, time: 90, strategy: "weighted", maxComplexity: 7 });
	const logRef = useRef<HTMLPreElement>(null);
	const active = !!job && (job.status === "running" || job.status === "stopping");
	const finished = !!job && (job.status === "done" || job.status === "error" || job.status === "stopped");
	const view: "form" | "progress" | "result" = active ? "progress" : (job && !showForm && finished) ? "result" : "form";

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);
	useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; });

	const num = (v: any, dflt: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : dflt; };
	const submit = () => {
		getSocket().emit("marathon_gen_start", {
			rows: num(form.rows, 24), cols: num(form.cols, 30), density: num(form.density, 20) / 100,
			target: form.maximize ? 100000 : num(form.target, 300), timeBudgetSec: num(form.time, 90),
			strategy: form.strategy, maxComplexity: num(form.maxComplexity, 7)
		});
		setShowForm(false);
	};
	const field = (label: string, key: keyof typeof form, min: number, max: number, step?: number, disabled?: boolean) => (
		<label className={styles.field}><span className={adminStyles.label}>{label}</span>
			<input type="number" className={adminStyles.input} min={min} max={max} step={step} disabled={disabled} value={form[key] as number} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>
	);

	return (
		<div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
			<div className={styles.dialog} role="dialog" aria-modal="true">
				<div className={styles.dialogHead}><h2 className={styles.dialogTitle}>Generate marathon board</h2><button type="button" className={`btn btn-ghost ${styles.closeBtn}`} onClick={onClose} aria-label="Close">✕</button></div>
				<p className={adminStyles.cardText}>Runs the hill-climb generator in the background. It is safe to close this and keep browsing, the status bar on the page tracks it.</p>
				{view === "form" ? (
					<>
						<div className={styles.fields}>
							{field("Rows", "rows", 8, 40)}
							{field("Cols", "cols", 8, 60)}
							{field("Mine density (%)", "density", 5, 35)}
							<div className={styles.field}>
								{field("Target total difficulty", "target", 1, 100000, undefined, form.maximize)}
								<label className={styles.check}><input type="checkbox" checked={form.maximize} onChange={e => setForm({ ...form, maximize: e.target.checked })} /> Maximize instead (ignore target)</label>
							</div>
							{field("Time limit (seconds)", "time", 5, 900)}
							<label className={styles.field}><span className={adminStyles.label}>Region strategy</span>
								<select className={adminStyles.select} value={form.strategy} onChange={e => setForm({ ...form, strategy: e.target.value })}>
									<option value="weighted">Weighted (recommended)</option>
									<option value="grid">Grid</option>
								</select></label>
							<details className={styles.advanced}><summary>Advanced</summary>{field("Max single-move complexity", "maxComplexity", 1, 9.9, 0.1)}</details>
						</div>
						<div className={styles.dialogActions}>
							<button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
							<button type="button" className="btn btn-primary" onClick={submit}>Start generation</button>
						</div>
					</>
				) : job && (
					<>
						<div className={styles.progress}>
							<span className={styles.genBadge}>{statusLabel(job.status)}</span>
							<GenStatsLine job={job} finished={view === "result"} />
							{view === "result" && job.status === "error" && job.error && <div className={styles.genError}>{job.error}</div>}
							<pre ref={logRef} className={styles.genLog}>{(job.log || []).join("\n")}</pre>
						</div>
						<div className={styles.dialogActions}>
							<button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
							{view === "result"
								? <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>Generate another</button>
								: <button type="button" className="btn btn-primary" onClick={() => getSocket().emit("marathon_gen_stop")}>Stop</button>}
						</div>
					</>
				)}
			</div>
		</div>
	);
}

// --- Play modal: a real interactive session (puzzle_retry serves the board with noRating set; the
// server tracks the 3 marathon lives and judges the result). ---
interface PlayResult { solved: boolean; stars: number | null; bestStars: number | null; isNewBest: boolean; attempts: number; }

function PlayModal({ puzzle, onClose }: { puzzle: any; onClose: () => void }) {
	const [status, setStatus] = useState("Loading board…");
	const [lives, setLives] = useState<number | null>(null);
	const [best, setBest] = useState<{ bestStars: number | null; attempts: number } | null>(null);
	const [result, setResult] = useState<PlayResult | null>(null);
	const [cellPx, setCellPx] = useState(24);
	const finishedRef = useRef(false);
	const [, bump] = useState(0);

	const session = useMemo(() => new BoardSession({
		mode: () => finishedRef.current ? null : "puzzle",
		sound,
		onAction: (r, c, asFlag) => getSocket().emit(asFlag ? "right_click" : "left_click", { r, c })
	}), []);

	const start = () => {
		finishedRef.current = false; setResult(null); setStatus("Loading board…");
		getSocket().emit("puzzle_retry", { puzzleId: puzzle.id });
	};

	useEffect(() => {
		const offs = [
			onSocket("puzzle_board", (d) => {
				const decoder = makeBoardDecoder(d.boardData, d.boardMask, d.cols);
				const state: number[][] = []; for (let r = 0; r < d.rows; r++) state.push(new Array(d.cols).fill(UNKNOWN));
				for (const rc of d.knownCells || []) state[rc[0]][rc[1]] = KNOWN;
				// A revealed zero opens its neighbourhood, like the real cascade would have.
				for (const rc of d.knownCells || []) {
					if (decoder(rc[0], rc[1]) !== 0) continue;
					for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
						if (!dr && !dc) continue;
						BoardLogic.cascadeReveal(rc[0] + dr, rc[1] + dc, d.rows, d.cols, (rr: number, cc: number) => state[rr][cc] === UNKNOWN, (rr: number, cc: number) => { state[rr][cc] = KNOWN; return false; }, (rr: number, cc: number) => decoder(rr, cc));
					}
				}
				finishedRef.current = false;
				session.setBoard(d.rows, d.cols, decoder, state);
				session.focusedR = Math.floor(d.rows / 2); session.focusedC = Math.floor(d.cols / 2);
				setLives(d.marathon ? 3 : 1);
				setBest({ bestStars: d.bestStars ?? null, attempts: d.attempts || 0 });
				setStatus(""); setResult(null);
				bump(n => n + 1);
			}),
			onSocket("puzzle_mine_hit", (d) => { if (typeof d.livesLeft === "number") setLives(d.livesLeft); }),
			onSocket("puzzle_result", (d) => {
				finishedRef.current = true;
				if (d.solved) sound.win();
				setResult({ solved: !!d.solved, stars: d.stars ?? null, bestStars: d.bestStars ?? null, isNewBest: !!d.isNewBest, attempts: d.attempts || 0 });
			}),
			onSocket("puzzle_error", (d) => setStatus("Couldn't load the board: " + ((d && d.reason) || "unknown")))
		];
		start();
		const compute = () => {
			const rows = session.rows || puzzle.rows, cols = session.cols || puzzle.cols;
			const px = Math.floor(Math.min((window.innerWidth - 96) / cols, (window.innerHeight - 200) / rows));
			setCellPx(Math.max(16, Math.min(34, px)));
		};
		compute();
		window.addEventListener("resize", compute);
		return () => { offs.forEach(off => off()); window.removeEventListener("resize", compute); session.clear(); };
	}, [puzzle.id]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
			<div className={`${styles.dialog} ${styles.playDialog}`} role="dialog" aria-modal="true">
				<div className={styles.dialogHead}>
					<div className={styles.playTitle}>Marathon board #{puzzle.id} <span className={adminStyles.muted}>· {puzzle.rows}×{puzzle.cols} · t{puzzle.difficulty}</span></div>
					{lives != null && !result && <span className={`${adminStyles.chip} ${styles.lives}`}>Lives: {lives}</span>}
					{best && best.bestStars != null && <span className={`${adminStyles.muted} ${styles.bestChip}`}>Best: <Stars count={best.bestStars} /></span>}
					<button type="button" className={`btn btn-ghost ${styles.closeBtn}`} onClick={onClose} aria-label="Close">✕</button>
				</div>
				{status && <p className={adminStyles.muted}>{status}</p>}
				<div className={styles.playBody}>
					<GameBoard session={session} cellPx={cellPx}>
						{result && (
							<div className={styles.resultOverlay}>
								<div className={styles.resultPanel}>
									<div className={styles.resultTitle}>{result.solved ? "Solved" : "Out of lives"}</div>
									{result.solved && result.stars != null && <Stars count={result.stars} big />}
									{result.bestStars != null && <div className={adminStyles.muted}>{result.isNewBest ? "New best" : "Best"}: <Stars count={result.bestStars} /> · {result.attempts} attempt{result.attempts === 1 ? "" : "s"}</div>}
									<div className={styles.dialogActions}>
										<button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
										<button type="button" className="btn btn-primary" onClick={start}>Play again</button>
									</div>
								</div>
							</div>
						)}
					</GameBoard>
				</div>
			</div>
		</div>
	);
}
