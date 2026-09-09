// Admin-only debug view: the client's local board state vs the server's authoritative one, side by
// side, plus a log of every socket event exchanged between them. Port of the legacy admin/DebugView.js,
// which was an in-game modal opened by clicking your own avatar during a match; here it is a page
// (/admin/debug) that shows the same data for THIS tab's socket session, and `DebugPanel` is exported
// so the play page can later mount the same body inside a modal.
//
// The event log is recorded unconditionally from app start (a small capped ring buffer, installed at
// module load since main.tsx already creates the socket before render), so history from just before
// a problem was noticed is still there; only the view is gated to admins.
import { useEffect, useState } from "react";
import { getSocket, onSocket } from "../../online/socket";
import { match, useMatch } from "../../game/match-store";
import { MINE, KNOWN, FLAGGED } from "../../game/board-render";
import { AdminPage, adminStyles } from "./admin-shared";
import styles from "./DebugAdmin.module.scss";

const LOG_MAX = 300;
interface LogEntry { t: number; dir: "in" | "out"; event: string; args: any[]; }
const debugLog: LogEntry[] = [];
function pushLog(dir: "in" | "out", event: string, args: any[]) {
	debugLog.push({ t: Date.now(), dir, event, args });
	if (debugLog.length > LOG_MAX) debugLog.shift();
}
(function installLog() {
	const s: any = getSocket();
	if (s.__msDebugLogInstalled) return;
	s.__msDebugLogInstalled = true;
	if (typeof s.onAny === "function") s.onAny((event: string, ...args: any[]) => pushLog("in", event, args));
	if (typeof s.onAnyOutgoing === "function") s.onAnyOutgoing((event: string, ...args: any[]) => pushLog("out", event, args));
})();

export function requestDebugSnapshot() { getSocket().emit("admin_debug_snapshot"); }

// The client's own decoded board as a plain 2D array, the same MINE/count shape the server's `board`
// field uses, so one cell-label function serves both grids.
function clientBoard(): number[][] | null {
	const s = match.session;
	if (!s.rows || !s.cols || !s.state) return null;
	const g: number[][] = [];
	for (let r = 0; r < s.rows; r++) { const row: number[] = []; for (let c = 0; c < s.cols; c++) row.push(s.cellAt(r, c)); g.push(row); }
	return g;
}

function DebugGrid({ title, rows, cols, board, state, mismatch }: { title: string; rows: number; cols: number; board: number[][] | null; state: number[][] | null; mismatch: ((r: number, c: number) => boolean) | null }) {
	const cells: JSX.Element[] = [];
	if (rows && cols && state) {
		for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
			const st = state[r] ? state[r][c] : undefined;
			const bv = board && board[r] ? board[r][c] : undefined;
			let text = "", cls = styles.cellUnknown;
			if (st === KNOWN) { cls = styles.cellKnown; text = bv === MINE ? "*" : (bv != null && bv > 0 ? String(bv) : ""); }
			else if (st === FLAGGED) { cls = styles.cellFlagged; text = "F"; }
			cells.push(<div key={r * cols + c} className={`${styles.cell} ${cls} ${mismatch && mismatch(r, c) ? styles.cellMismatch : ""}`}>{text}</div>);
		}
	}
	return (
		<div className={styles.gridWrap}>
			<h3 className={styles.gridTitle}>{title}</h3>
			{cells.length === 0 ? <p className={adminStyles.muted}>No data.</p> : <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{cells}</div>}
		</div>
	);
}

function formatTime(t: number): string {
	let ms = String(t % 1000); while (ms.length < 3) ms = "0" + ms;
	return new Date(t).toLocaleTimeString(undefined, { hour12: false }) + "." + ms;
}
function formatArgs(args: any[]): string {
	try { return args && args.length ? JSON.stringify(args[0]).slice(0, 160) : ""; } catch { return "[unserializable]"; }
}

// The body: summary line, the two grids, the event log. Requests a fresh server snapshot on mount and
// on Refresh; repaints on match-store changes and on a slow tick so the log keeps flowing.
export function DebugPanel({ refreshKey }: { refreshKey?: number }) {
	useMatch();
	const [snap, setSnap] = useState<any | null>(null);
	const [, tick] = useState(0);
	useEffect(() => onSocket("admin_debug_snapshot_result", (d) => setSnap(d)), []);
	useEffect(() => { requestDebugSnapshot(); }, [refreshKey]);
	useEffect(() => { const h = setInterval(() => tick(n => n + 1), 500); return () => clearInterval(h); }, []);

	const store: any = match;
	const localSeq: number = store.moveSeq, localHash: number = store.moveHash;
	const session = match.session;
	const liveState = session.state;
	const clientLine = "Client: seq " + localSeq + " · hash " + localHash + (session.rows ? " · " + session.rows + "×" + session.cols : "");
	const serverLine = !snap ? "Server: …"
		: !snap.ok ? "Server: " + (snap.reason === "not_in_game" ? "no active game" : snap.reason || "no active game")
		: "Server: seq " + snap.seq + " · hash " + snap.hash + " · playing " + snap.playing + " · finished " + snap.finished + " · safe " + snap.safeCount + "/" + snap.totalSafe + (snap.roomPhase ? " · phase " + snap.roomPhase : "");
	const hashMismatch = !!(snap && snap.ok && snap.hash !== localHash);
	const mismatch = (snap && snap.ok && liveState) ? (r: number, c: number) => {
		const cs = liveState[r] ? liveState[r][c] : undefined;
		const ss = snap.state && snap.state[r] ? snap.state[r][c] : undefined;
		return cs !== ss;
	} : null;

	return (
		<div>
			<div className={`${styles.summary} ${adminStyles.mono}`}>
				<div>{clientLine}</div>
				<div className={hashMismatch ? styles.summaryMismatch : undefined}>{serverLine}</div>
			</div>
			<div className={styles.grids}>
				<DebugGrid title="Client (yours)" rows={session.rows} cols={session.cols} board={clientBoard()} state={liveState} mismatch={mismatch} />
				{snap && snap.ok
					? <DebugGrid title="Server (authoritative)" rows={snap.rows} cols={snap.cols} board={snap.board} state={snap.state} mismatch={mismatch} />
					: <DebugGrid title="Server (authoritative)" rows={0} cols={0} board={null} state={null} mismatch={null} />}
			</div>
			<div className={styles.logWrap}>
				<h3 className={styles.gridTitle}>Event log (newest first)</h3>
				<div className={styles.log}>
					{debugLog.slice().reverse().map((e, i) => (
						<div key={debugLog.length - i} className={`${styles.logRow} ${e.dir === "out" ? styles.logOut : styles.logIn}`}>
							{formatTime(e.t) + " " + (e.dir === "out" ? "→" : "←") + " " + e.event + (formatArgs(e.args) ? " " + formatArgs(e.args) : "")}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export default function DebugAdmin() {
	const [refreshKey, setRefreshKey] = useState(0);
	return (
		<AdminPage title="Debug: Board State" wide
			sub="Compares this tab's local board (the live match session) against the server's authoritative copy for the same socket, cell by cell, plus the raw socket event log. Open it in the tab that is in the match: the socket is per tab, so another tab has no game."
			actions={<button type="button" className="btn" onClick={() => setRefreshKey(k => k + 1)}>↻ Refresh</button>}>
			<DebugPanel refreshKey={refreshKey} />
		</AdminPage>
	);
}
