// Solo free play: the server deals a no-guess board (request_solo_board -> solo_board), the player
// clears it locally against the clock. A Start button gates the first move behind the 3-2-1
// countdown; the timer starts on the first real move. Wins report solo_result for the best-times table.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSocket, onSocket } from "../../online/socket";
import { useAuth } from "../../shared/auth";
import { BoardSession, ActionResult, naturalCountdownTotalMs } from "../../game/board-session";
import { KNOWN, MINE } from "../../game/board-render";
import { makeBoardDecoder } from "../../game/board-decoder";
import { countDown, cancelCountdown } from "../../game/countdown";
import { useCellPx } from "../../game/use-cell-px";
import { sound } from "../../audio/sound";
import GameBoard from "../../game/GameBoard";
import { ResultPanel, ResultHeader, ResultDetail, ResultFoot, ResultActions } from "../../game/ResultPanel";
import { autoEnterGameFullscreen } from "../../game/fullscreen";
import { useInGameBody } from "../play/mobile";
import styles from "./SoloPage.module.scss";

type Size = "small" | "medium" | "large";
const SIZES: Size[] = ["small", "medium", "large"];
const DENSITIES: Array<[number, string]> = [[0.1, "Low"], [0.15, "Medium"], [0.2, "High"]];

interface Solo { size: Size; density: number; totalSafe: number; totalMines: number; startTime: number | null; finishTime: number | null; finished: boolean; started: boolean; counting: boolean; }

export function formatSoloTime(ms: number | null | undefined): string {
	if (ms == null || ms < 0) ms = 0;
	const totalSec = ms / 1000, m = Math.floor(totalSec / 60), s = totalSec - m * 60;
	const long = s >= 10 || m > 0;
	return m + ":" + (s < 10 ? "0" : "") + s.toFixed(long ? 1 : 2).slice(0, long ? 4 : 5);
}
const soloKey = (size: string, density: number) => size + "_" + Math.round(density * 100);

export default function SoloPage() {
	useInGameBody();
	const navigate = useNavigate();
	const { account, update } = useAuth();
	const [size, setSize] = useState<Size>(() => (localStorage.getItem("ms_solo_size") as Size) || "medium");
	const [density, setDensity] = useState<number>(() => parseFloat(localStorage.getItem("ms_solo_density") || "0.1") || 0.1);
	const soloRef = useRef<Solo | null>(null);
	const [, bump] = useState(0);
	const rerender = () => bump(n => n + 1);
	const [outcome, setOutcome] = useState<{ won: boolean; ms: number; safe: number; total: number; best: number | null } | null>(null);
	const [record, setRecord] = useState<{ isNewBest: boolean; best: number } | null>(null);
	const [tick, setTick] = useState(0);
	const boardHostRef = useRef<HTMLDivElement>(null);

	// One session for the page's lifetime; hooks read the current solo run through the ref.
	const session = useMemo(() => new BoardSession({
		mode: () => { const s = soloRef.current; return s && !s.finished && s.started ? "solo" : null; },
		sound,
		onFlagPlaced: () => startTimerOnce(),
		onAfterReveal: (result: ActionResult) => onAfterReveal(result)
	}), []);
	if (import.meta.env.DEV) (window as any).__session = session; // probing from the console / tests

	function startTimerOnce() {
		const s = soloRef.current; if (!s || s.finished) return;
		if (!s.startTime) { s.startTime = Date.now(); rerender(); }
	}
	function countSafeRevealed(): number {
		let n = 0;
		if (session.state) for (let r = 0; r < session.rows; r++) for (let c = 0; c < session.cols; c++) if (session.state[r][c] === KNOWN && session.cellAt(r, c) !== MINE) n++;
		return n;
	}
	function onAfterReveal(result: ActionResult) {
		const s = soloRef.current; if (!s || s.finished) return;
		if (result.anyChange || result.hitMine) startTimerOnce();
		if (result.hitMine) {
			s.finished = true; s.finishTime = Date.now();
			setOutcome({ won: false, ms: s.finishTime - (s.startTime || s.finishTime), safe: countSafeRevealed(), total: s.totalSafe, best: null });
			return;
		}
		if (countSafeRevealed() >= s.totalSafe) {
			s.finished = true; s.finishTime = Date.now();
			sound.win();
			const ms = s.finishTime - (s.startTime || s.finishTime);
			getSocket().emit("solo_result", { size: s.size, density: s.density, ms });
			getSocket().emit("record_clear", { noFlag: session.clearNoFlag, noReveal: session.clearNoReveal });
			const bests = account?.soloBests || {};
			setOutcome({ won: true, ms, safe: s.totalSafe, total: s.totalSafe, best: bests[soloKey(s.size, s.density)] || null });
		}
	}

	function requestBoard(sz = size, dens = density) {
		cancelCountdown();
		setOutcome(null); setRecord(null);
		getSocket().emit("request_solo_board", { size: sz, density: dens });
	}

	useEffect(() => {
		const offBoard = onSocket("solo_board", (data) => {
			soloRef.current = { size: data.size, density: typeof data.density === "number" ? data.density : density, totalSafe: data.totalSafe, totalMines: data.mines, startTime: null, finishTime: null, finished: false, started: false, counting: false };
			const decoder = makeBoardDecoder(data.boardData, data.boardMask, data.cols);
			const state: number[][] = [];
			for (let r = 0; r < data.rows; r++) state.push(new Array(data.cols).fill(-3));
			for (const rc of data.knownCells || []) state[rc[0]][rc[1]] = KNOWN;
			session.setBoard(data.rows, data.cols, decoder, state);
			session.focusedR = Math.floor(data.rows / 2); session.focusedC = Math.floor(data.cols / 2);
			rerender();
		});
		const offRejected = onSocket("solo_rejected", () => navigate("/"));
		const offRecord = onSocket("solo_record", (data) => {
			update({ soloBests: { ...(account?.soloBests || {}), [data.size + "_" + data.density]: data.best } });
			setRecord({ isNewBest: !!data.isNewBest, best: data.best });
		});
		requestBoard();
		const timer = setInterval(() => setTick(t => t + 1), 100);
		return () => { offBoard(); offRejected(); offRecord(); clearInterval(timer); cancelCountdown(); session.clear(); };
	}, []);

	const solo = soloRef.current;
	const elapsed = solo && solo.startTime ? (solo.finishTime || Date.now()) - solo.startTime : 0;
	const flagged = session.countFlags();
	const best = account?.soloBests?.[soloKey(size, density)] || null;
	const cellPx = useCellPx(boardHostRef, { rows: session.rows, cols: session.cols, maxCell: 100 });
	void tick;

	function begin() {
		const s = soloRef.current; if (!s || s.started || s.counting) return;
		s.counting = true;
		countDown(session, naturalCountdownTotalMs(), () => { if (soloRef.current === s) { s.started = true; rerender(); } }, { sound });
		rerender();
	}
	function pick(sz: Size, dens: number) {
		setSize(sz); setDensity(dens);
		try { localStorage.setItem("ms_solo_size", sz); localStorage.setItem("ms_solo_density", String(dens)); } catch { /* storage blocked */ }
		requestBoard(sz, dens);
	}

	return (
		<section className={styles.page}>
			<div className={styles.header}>
				<button className="btn btn-ghost" onClick={() => navigate("/")}>Exit game</button>
				<span className={styles.mode}>Free play</span>
			</div>
			<div className={styles.grid}>
				<div className={styles.left} ref={boardHostRef}>
					<div className={styles.boardCard}>
						<GameBoard session={session} cellPx={cellPx} className={styles.board}>
							{solo && !solo.started && !solo.counting && (
								<div className={styles.startOverlay}><button className={`btn btn-primary ${styles.startBtn}`} onClick={() => { autoEnterGameFullscreen(); begin(); }}>Start</button></div>
							)}
						</GameBoard>
					</div>
				</div>
				<aside className={styles.side}>
					<div className={styles.card}>
						<h3 className={styles.sideTitle}>Free play</h3>
						<div className={styles.stats}>
							<Stat label="Time" value={formatSoloTime(elapsed)} />
							<Stat label="Mines" value={`${flagged} / ${solo ? solo.totalMines : 0}`} />
							<Stat label="Best" value={best ? formatSoloTime(best) : "—"} />
						</div>
						<span className={styles.pickerLabel}>Board size</span>
						<div className={styles.picker}>{SIZES.map(sz => <button key={sz} className={`btn ${sz === size ? styles.active : ""}`} onClick={() => pick(sz, density)}>{sz[0].toUpperCase() + sz.slice(1)}</button>)}</div>
						<span className={styles.pickerLabel}>Mine density</span>
						<div className={styles.picker}>{DENSITIES.map(([d, label]) => <button key={d} className={`btn ${d === density ? styles.active : ""}`} onClick={() => pick(size, d)}>{label}</button>)}</div>
						<button className={`btn btn-primary ${styles.restart}`} onClick={() => requestBoard()}>New board</button>
					</div>
				</aside>
			</div>
			{outcome && (
				<ResultPanel kind={outcome.won ? "win" : "lose"}>
					<ResultHeader>{outcome.won ? "Cleared!" : "Mine hit"}</ResultHeader>
					<ResultDetail color={outcome.won ? "#4ade80" : "#f87171"}>{formatSoloTime(outcome.ms)}</ResultDetail>
					{outcome.won && <div className={`${styles.bestLine} ${record?.isNewBest ? styles.bestNew : ""}`}>{record ? (record.isNewBest ? "★ New best!" : "Best: " + formatSoloTime(record.best)) : outcome.best ? "Best: " + formatSoloTime(outcome.best) : ""}</div>}
					{!outcome.won && <ResultFoot>Revealed {outcome.safe} of {outcome.total} safe cells.</ResultFoot>}
					<ResultActions>
						<button className="btn btn-primary" onClick={() => requestBoard()}>New board</button>
						<button className="btn" onClick={() => navigate("/")}>Back home</button>
					</ResultActions>
				</ResultPanel>
			)}
		</section>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return <div className={styles.stat}><span className={styles.statLabel}>{label}</span><span className={styles.statValue}>{value}</span></div>;
}
