// Admin: browse the benchmarked ranked-bot pool and watch any bot play. Port of the legacy
// admin/BotsAdmin.js: a sortable/filterable, paginated card grid backed by `GET /api/bots`, each
// card showing the bot's six per-move variables, its overall Elo, and a row per calibrated mine
// density (10/15/20%) with the measured Elo and a Watch button. The demo itself is server-driven
// (bot_demo_start/stop + bot_demo_board/move frames, apps/server/src/runtime/botDemo.js); this
// page only paints the streamed frames on its own canvas.
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../shared/auth";
import { getSocket, onSocket } from "../../online/socket";
import { BoardView, sizeCellCanvas } from "../../game/board-render";
import { AdminPage, Pager, useQueryState, adminStyles } from "./admin-shared";
import styles from "./BotsAdmin.module.scss";

// Sortable fields (must match BOT_SORT_FIELDS in apps/server/src/runtime/puzzleApi.js).
const SORT_OPTIONS = [
	{ value: "rating", label: "Overall Elo" },
	{ value: "r10", label: "Sprint Elo (10%)" },
	{ value: "r15", label: "15% density Elo" },
	{ value: "r20", label: "Standard Elo (20%)" },
	{ value: "speedMs", label: "Speed (ms/move)" },
	{ value: "difficultyMs", label: "Thinking (ms/difficulty)" },
	{ value: "distanceMult", label: "Distance mult" },
	{ value: "maxDifficulty", label: "Max difficulty" },
	{ value: "mistakeRate", label: "Mistake rate" },
	{ value: "chordRate", label: "Chord rate" }
];

// Density to label. ratings/times in the pool are keyed by these density strings. 15% has no
// current ranked mode (generate-bot-pool.js still benchmarks it), so it is labelled by density.
const MODES = [
	{ density: 0.10, key: "0.10", label: "Sprint", pct: "10%" },
	{ density: 0.15, key: "0.15", label: "15% density", pct: "15%" },
	{ density: 0.20, key: "0.20", label: "Standard", pct: "20%" }
];
type Mode = typeof MODES[number];

const PAGE_SIZE = 30;
const DEFAULTS = { sort: "rating", dir: "desc", minRating: "", maxRating: "", page: "0" };

function sessionHeaders(): Record<string, string> {
	try { const t = localStorage.getItem("ms_session"); return t ? { "X-Session-Token": t } : {}; } catch { return {}; }
}

interface Demo { botIndex: number; density: number; title: string; }

export default function BotsAdmin() {
	const { account } = useAuth();
	const [q, setQ] = useQueryState(DEFAULTS);
	const [bots, setBots] = useState<any[]>([]);
	const [total, setTotal] = useState(0);
	const [pool, setPool] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [demo, setDemo] = useState<Demo | null>(null);
	const page = Math.max(0, parseInt(q.page, 10) || 0);

	useEffect(() => {
		if (!account || !account.isAdmin) return;
		let cancelled = false;
		const bits = ["sort=" + q.sort, "dir=" + q.dir, "page=" + page, "pageSize=" + PAGE_SIZE];
		if (q.minRating !== "") bits.push("minRating=" + encodeURIComponent(q.minRating));
		if (q.maxRating !== "") bits.push("maxRating=" + encodeURIComponent(q.maxRating));
		fetch("/api/bots?" + bits.join("&"), { headers: sessionHeaders() })
			.then(r => { if (r.status === 403) throw new Error("Admin access required."); return r.json(); })
			.then(data => {
				if (cancelled) return;
				const list = (data && data.bots) || [];
				setBots(list);
				setTotal(data && typeof data.total === "number" ? data.total : list.length);
				setPool(data && data.pool != null ? data.pool : null);
				setError(null);
			})
			.catch(e => { if (!cancelled) setError(e.message); });
		return () => { cancelled = true; };
	}, [account, q.sort, q.dir, q.minRating, q.maxRating, page]);

	const fromN = total ? page * PAGE_SIZE + 1 : 0;
	const toN = Math.min(total, (page + 1) * PAGE_SIZE);
	const onEloChange = (which: "minRating" | "maxRating", raw: string) => {
		const v = parseFloat(raw);
		setQ({ [which]: isNaN(v) ? "" : String(v), page: "0" } as any);
	};

	return (
		<AdminPage title="Ranked bots" sub="Browse the benchmarked bot pool. Each bot's variables and per-mode Elo were measured by simulating it on the three ranked densities. Click Watch to see one play an example board in real time." wide>
			<p className={`${adminStyles.status} ${styles.statusLine}`}>
				{error ? "Error: " + error : "Pool: " + (pool != null ? pool : total) + " bots · matching " + total + " · showing " + fromN + "–" + toN}
			</p>
			<div className={styles.toolbar}>
				<div className={adminStyles.row}>
					<span className={adminStyles.label}>Sort</span>
					<select className={adminStyles.select} value={q.sort} onChange={e => setQ({ sort: e.target.value, page: "0" })}>
						{SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
					</select>
					<select className={adminStyles.select} value={q.dir} onChange={e => setQ({ dir: e.target.value, page: "0" })}>
						<option value="desc">High → low</option>
						<option value="asc">Low → high</option>
					</select>
				</div>
				<div className={adminStyles.row}>
					<span className={adminStyles.label}>Elo</span>
					<input type="number" className={`${adminStyles.input} ${styles.eloInput}`} placeholder="min" defaultValue={q.minRating} key={"min" + q.minRating} onBlur={e => onEloChange("minRating", e.target.value)} onKeyDown={e => { if (e.key === "Enter") onEloChange("minRating", (e.target as HTMLInputElement).value); }} />
					<span className={adminStyles.muted}>to</span>
					<input type="number" className={`${adminStyles.input} ${styles.eloInput}`} placeholder="max" defaultValue={q.maxRating} key={"max" + q.maxRating} onBlur={e => onEloChange("maxRating", e.target.value)} onKeyDown={e => { if (e.key === "Enter") onEloChange("maxRating", (e.target as HTMLInputElement).value); }} />
				</div>
			</div>

			{bots.length === 0 && !error
				? <p className={adminStyles.muted}>{page > 0 ? "No bots on this page. Try going back." : "No bots match this filter."}</p>
				: <div className={styles.grid}>{bots.map(b => <BotCard key={b.index} bot={b} onWatch={(mode) => setDemo({ botIndex: b.index, density: mode.density, title: "Bot #" + b.index + " · " + b.rating + " Elo: " + mode.label + " (" + mode.pct + ")" })} />)}</div>}

			<Pager total={total} page={page} pageSize={PAGE_SIZE} onGoto={p => setQ({ page: String(p) })} />
			{demo && <BotDemoModal demo={demo} onClose={() => setDemo(null)} />}
		</AdminPage>
	);
}

function BotCard({ bot, onWatch }: { bot: any; onWatch: (mode: Mode) => void }) {
	const vars: Array<[string, string]> = [
		["speed", bot.speedMs + "ms"],
		["think", bot.difficultyMs + "ms/d"],
		["dist×", String(bot.distanceMult)],
		["maxDiff", String(bot.maxDifficulty)],
		["mistakes", (bot.mistakeRate * 100).toFixed(1) + "%"],
		["chord", (bot.chordRate * 100).toFixed(0) + "%"]
	];
	return (
		<div className={`${adminStyles.card} ${styles.card}`}>
			<div className={styles.cardHead}>
				<span className={styles.ratingBadge}>{(bot.rating != null ? bot.rating : "?") + " Elo"}</span>
				<span className={`${adminStyles.muted} ${adminStyles.mono}`}>#{bot.index}</span>
			</div>
			<div className={styles.vars}>
				{vars.map(([k, v]) => <div key={k} className={styles.varCell}><span className={styles.varKey}>{k}</span><span className={`${styles.varVal} ${adminStyles.mono}`}>{v}</span></div>)}
			</div>
			{MODES.map(mode => (
				<div key={mode.key} className={styles.modeRow}>
					<span className={styles.modeName}>{mode.label} · {mode.pct}</span>
					<span className={`${styles.modeElo} ${adminStyles.mono}`}>{(bot.ratings && bot.ratings[mode.key] != null ? bot.ratings[mode.key] : "?") + " Elo"}</span>
					<button type="button" className={`btn ${styles.watchBtn}`} onClick={() => onWatch(mode)}>▶ Watch</button>
				</div>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Watch-a-bot-play modal (server-driven). One open at a time.
// ---------------------------------------------------------------------------
interface Frame { rows: number; cols: number; board: number[][]; state: number[][]; }

function BotDemoModal({ demo, onClose }: { demo: Demo; onClose: () => void }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const frameRef = useRef<Frame | null>(null);
	const [status, setStatus] = useState("Generating board…");

	const draw = (lastMove: any) => {
		const f = frameRef.current, canvas = canvasRef.current;
		if (!f || !canvas) return;
		// Fit the board into a target box, capped cell size, DPR-aware.
		const box = 560;
		const cellPx = Math.max(14, Math.min(40, Math.floor(box / Math.max(f.rows, f.cols))));
		sizeCellCanvas(canvas, f.cols, f.rows, cellPx);
		const bv = new BoardView(canvas, f.rows, f.cols, f.state, (r, c) => f.board[r][c]);
		// Outline the bot's most recent move so the eye can follow it.
		if (lastMove) {
			bv.overlay((ctx, sw, sh) => {
				ctx.save();
				ctx.strokeStyle = lastMove.stuck ? "rgba(248,113,113,0.95)" : "rgba(250,204,21,0.95)";
				ctx.lineWidth = Math.max(2, sw * 0.08);
				ctx.strokeRect(lastMove.c * sw + ctx.lineWidth / 2, lastMove.r * sh + ctx.lineWidth / 2, sw - ctx.lineWidth, sh - ctx.lineWidth);
				ctx.restore();
			});
		}
		bv.draw();
	};

	const start = () => {
		setStatus("Generating board…");
		getSocket().emit("bot_demo_start", { botIndex: demo.botIndex, density: demo.density });
	};

	useEffect(() => {
		const offs = [
			onSocket("bot_demo_board", (d) => {
				frameRef.current = { rows: d.rows, cols: d.cols, board: d.board, state: d.state };
				setStatus("Playing… 0%");
				draw(null);
			}),
			onSocket("bot_demo_move", (d) => {
				const f = frameRef.current; if (!f) return;
				if (d.state) f.state = d.state;
				const pct = Math.round((d.progress || 0) * 100);
				if (d.finished || d.done) setStatus(d.finished ? "Solved! " + pct + "%" : "Stopped · " + pct + "%");
				else setStatus("Playing… " + pct + "%");
				draw(d.move || null);
			}),
			onSocket("bot_demo_rejected", (d) => setStatus((d && d.reason) || "Couldn't start demo."))
		];
		frameRef.current = null;
		start();
		return () => { offs.forEach(off => off()); try { getSocket().emit("bot_demo_stop"); } catch { /* socket gone */ } };
	}, [demo.botIndex, demo.density]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
			<div className={styles.panel} role="dialog" aria-modal="true">
				<div className={styles.panelHead}>
					<div className={styles.panelTitle}>{demo.title}</div>
					<span className={`${adminStyles.muted} ${styles.demoStatus}`}>{status}</span>
					<button type="button" className="btn" onClick={start}>New board</button>
					<button type="button" className={`btn btn-ghost ${styles.closeBtn}`} onClick={onClose} aria-label="Close">✕</button>
				</div>
				<div className={styles.panelBody}>
					<canvas ref={canvasRef} className={styles.demoCanvas} />
				</div>
			</div>
		</div>
	);
}
