// Puzzle play: the Puzzle Ladder (rated, one puzzle at a time near your rating, with a hint), the
// Time Trial and Streak runs, and the daily puzzle. The server deals puzzle_board, judges every
// click (left_click/right_click) and answers with puzzle_result, puzzle_run_end or
// puzzle_daily_result. The board is a fixed square box so puzzles of any shape sit the same.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSocket, onSocket } from "../../online/socket";
import { useAuth } from "../../shared/auth";
import { BoardSession, ActionResult } from "../../game/board-session";
import { KNOWN, UNKNOWN } from "../../game/board-render";
import { makeBoardDecoder } from "../../game/board-decoder";
import { sound } from "../../audio/sound";
import GameBoard from "../../game/GameBoard";
import { PuzzleRankBadge } from "../../shared/RankBadge";
import { puzzleLadder } from "../../shared/puzzle-ladder";
import { ResultPanel, ResultHeader, ResultDetail, ResultFoot, ResultActions } from "../../game/ResultPanel";
import { formatDailyDate } from "../home/home-data";
import BoardLogic from "core/src/common/BoardLogic.js";
import { useInGameBody } from "../play/mobile";
import { FullscreenButton } from "../play/hud";
import styles from "./PuzzlePage.module.scss";

export type PuzzleMode = "rated" | "streak" | "storm" | "daily";
const TITLES: Record<PuzzleMode, string> = { rated: "Puzzle Ladder", streak: "Streak", storm: "Time Trial", daily: "Daily puzzle" };

interface Run { mode: PuzzleMode; solves?: number; targetRating?: number; endsAt?: number; streak?: number; date?: string; bestStreak?: number; }
interface Puzzle { puzzleId: number; difficulty: number; totalSafe: number; totalMines: number; playerRating: number; mode: PuzzleMode; run: Run | null; finished: boolean; hintUsed: boolean; }
interface RatedResult { solved: boolean; hintUsed: boolean; playerAfter?: number; pointsEarned?: number; puzzlePoints?: number; noRating?: boolean; }
interface RunEnd { mode: "streak" | "storm"; solves: number; score: number; bestBefore: number; best: number; }
interface DailyResult { date: string; solved: boolean; streak: number; bestStreak?: number; }

const PUZZLE_BOX_PX = 480, PUZZLE_CELL_MAX = 75, PUZZLE_BOX_PX_MOBILE = 320, PUZZLE_CELL_MAX_MOBILE = 56;
const difficultyLabel = (tier: number) => tier <= 2 ? "Easy" : tier <= 4 ? "Medium" : "Hard";

export default function PuzzlePage({ mode }: { mode: PuzzleMode }) {
	useInGameBody();
	const navigate = useNavigate();
	const { account, update } = useAuth();
	const puzzleRef = useRef<Puzzle | null>(null);
	const [, bump] = useState(0);
	const rerender = () => bump(n => n + 1);
	const [status, setStatus] = useState<string>("");
	const [flash, setFlash] = useState<{ solved: boolean; points?: number } | null>(null);
	const [done, setDone] = useState<"solved" | "fail" | null>(null);
	const [runEnd, setRunEnd] = useState<RunEnd | null>(null);
	const [daily, setDaily] = useState<DailyResult | null>(null);
	const [streak, setStreak] = useState(0);
	const [pendingFlash, setPendingFlash] = useState<"solved" | "fail" | null>(null);
	const [boardFlash, setBoardFlash] = useState<"solved" | "fail" | null>(null);
	const [tick, setTick] = useState(0);
	const boardHostRef = useRef<HTMLDivElement>(null);

	const session = useMemo(() => new BoardSession({
		mode: () => { const p = puzzleRef.current; return p && !p.finished ? "puzzle" : null; },
		sound,
		onAction: (r, c, asFlag) => { session.hintClues = []; session.hintCovered = []; getSocket().emit(asFlag ? "right_click" : "left_click", { r, c }); },
		onAfterReveal: (result: ActionResult) => { const p = puzzleRef.current; if (p && (p.mode === "streak" || p.mode === "storm") && result.hitMine) setPendingFlash("fail"); }
	}), []);
	if (import.meta.env.DEV) (window as any).__puzzle = session;

	const finish = () => { const p = puzzleRef.current; if (p) { p.finished = true; rerender(); } };

	useEffect(() => {
		const offs = [
			onSocket("puzzle_board", (d) => {
				const apply = () => {
					puzzleRef.current = { puzzleId: d.puzzleId, difficulty: d.difficulty, totalSafe: d.totalSafe, totalMines: d.mines, playerRating: d.playerRating, mode: d.mode || "rated", run: d.run || null, finished: false, hintUsed: false };
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
					session.setBoard(d.rows, d.cols, decoder, state);
					session.focusedR = Math.floor(d.rows / 2); session.focusedC = Math.floor(d.cols / 2);
					setDone(null); setFlash(null); setStatus(""); setDaily(null); setRunEnd(null);
					rerender();
				};
				withFlash(apply);
			}),
			onSocket("puzzle_result", (d: RatedResult & { playerAfter: number }) => {
				const p = puzzleRef.current; if (!p || p.mode === "streak" || p.mode === "storm") return;
				finish();
				if (!d.noRating) {
					p.playerRating = d.playerAfter;
					setStreak(s => d.solved ? s + 1 : 0);
					if (account) update({ puzzleRating: d.playerAfter, puzzlesAttempted: (account.puzzlesAttempted || 0) + 1, puzzlesSolved: (account.puzzlesSolved || 0) + (d.solved ? 1 : 0), ...(typeof d.puzzlePoints === "number" ? { puzzlePoints: d.puzzlePoints } : {}) });
				}
				if (d.solved) { sound.win(); setFlash({ solved: true, points: d.pointsEarned }); setTimeout(() => { setFlash(null); setDone("solved"); }, 1200); }
				else setDone("fail");
				getSocket().emit("get_match_history");
			}),
			onSocket("puzzle_run_end", (d: RunEnd) => withFlash(() => { finish(); if (account) update(d.mode === "streak" ? { streakBest: d.best } : { stormBest: d.best }); setRunEnd(d); })),
			onSocket("puzzle_daily_result", (d: DailyResult) => { finish(); if (account) update({ dailyStreak: d.streak, dailyAttempt: { solved: d.solved, at: new Date().toISOString() } }); withFlash(() => setDaily(d)); }),
			onSocket("puzzle_daily_status", (d) => {
				if (mode !== "daily") return;
				if (d.attempt && d.attempt.solved) { puzzleRef.current = { puzzleId: 0, difficulty: 0, totalSafe: 0, totalMines: 0, playerRating: 0, mode: "daily", run: { mode: "daily", date: d.date, streak: d.streak, bestStreak: d.bestStreak }, finished: true, hintUsed: false }; setDaily({ date: d.date, solved: true, streak: d.streak, bestStreak: d.bestStreak }); rerender(); }
				else getSocket().emit("puzzle_daily_start");
			}),
			onSocket("puzzle_hint_pointer", (d) => { const p = puzzleRef.current; if (!p || d.alreadyUsed) return; p.hintUsed = true; session.hintClues = d.clueCells || []; session.hintCovered = d.coveredCells || []; session.render(); rerender(); }),
			onSocket("puzzle_error", (d) => { const reason = (d && d.reason) || "unknown"; setStatus(reason === "auth_required" ? "Sign in to play rated puzzles." : reason === "no_puzzles" ? "No puzzles available yet." : "Couldn't load a puzzle: " + reason); })
		];
		const t = setInterval(() => setTick(n => n + 1), 250);
		return () => { offs.forEach(off => off()); clearInterval(t); const p = puzzleRef.current; if (p && (p.mode === "streak" || p.mode === "storm") && !p.finished) getSocket().emit("puzzle_run_abandon"); session.clear(); };
	}, [mode]);
	// Start only once the socket has authenticated (a fresh page load races the handshake otherwise).
	const started = useRef<string | null>(null);
	useEffect(() => { if (!account || started.current === mode) return; started.current = mode; start(mode); }, [mode, !!account]);

	function withFlash(fn: () => void) {
		setPendingFlash(pf => { if (pf) { setBoardFlash(pf); setTimeout(() => { setBoardFlash(null); fn(); }, 280); } else fn(); return null; });
	}
	function start(m: PuzzleMode) {
		setStatus(m === "streak" ? "Starting streak run…" : m === "storm" ? "Starting Time Trial run…" : m === "daily" ? "Checking today's puzzle…" : "Finding a puzzle near your rating…");
		const socket = getSocket();
		if (m === "streak") socket.emit("puzzle_streak_start");
		else if (m === "storm") socket.emit("puzzle_storm_start");
		else if (m === "daily") socket.emit("puzzle_daily_status");
		else socket.emit("puzzle_next");
	}
	const exit = () => navigate("/");

	const p = puzzleRef.current;
	const isRun = !!p && (p.mode === "streak" || p.mode === "storm" || p.mode === "daily");
	const mobile = window.matchMedia("(max-width: 700px)").matches;
	const box = mobile ? PUZZLE_BOX_PX_MOBILE : PUZZLE_BOX_PX, cellMax = mobile ? PUZZLE_CELL_MAX_MOBILE : PUZZLE_CELL_MAX;
	const cellPx = session.rows ? Math.min(cellMax, Math.floor(box / Math.max(session.rows, session.cols))) : 32;
	const ladder = puzzleLadder(account?.puzzlePoints || 0);
	void tick;

	return (
		<section className={styles.page}>
			<div className={styles.header}>
				<button className="btn btn-ghost" onClick={exit}>← Exit game</button>
				<span className={styles.title}>{TITLES[mode]} <FullscreenButton /></span>
			</div>
			{!account ? <p className={styles.empty}>Sign in to play. Your score is tied to your account.</p> : !p && status ? <p className={styles.empty}>{status}</p> : (
				<div className={styles.grid}>
					<div className={styles.boardCol} ref={boardHostRef}>
						<div className={`${styles.boardWrap} ${boardFlash === "solved" ? styles.flashSolved : boardFlash === "fail" ? styles.flashFail : ""}`} style={{ width: box, height: box }}>
							<GameBoard session={session} cellPx={cellPx} className={styles.board}>
								{flash && <div className={`${styles.flash} ${flash.solved ? styles.flashOk : styles.flashBad}`}><div className={styles.flashIcon}>{flash.solved ? "✓" : "✗"}</div><div className={styles.flashLabel}>{flash.solved ? "Solved" : "Mine hit"}</div></div>}
							</GameBoard>
						</div>
						{p && !isRun && p.puzzleId != null && <div className={styles.info}>Puzzle #{p.puzzleId}<span className={styles.sep}>·</span><span style={{ color: difficultyLabel(p.difficulty) === "Easy" ? "var(--success)" : difficultyLabel(p.difficulty) === "Medium" ? "var(--energy-streak)" : "var(--danger)" }}>{difficultyLabel(p.difficulty)}</span></div>}
					</div>
					<aside className={styles.card}>
						<div className={styles.cardHead}><span className={styles.cardTitle}>{TITLES[mode]}</span></div>
						{!isRun ? (
							<>
								<div className={styles.ladderHead}>
									<PuzzleRankBadge points={account.puzzlePoints || 0} size={7} />
									<span className={styles.ladderTier} style={{ color: ladder.tierColor }}>{ladder.atMax ? ladder.tierName + " · Max" : ladder.tierName + " · Lvl " + ladder.level}</span>
									{flash && flash.points ? <span className={`${styles.delta} ${styles.gain}`}>+{flash.points}</span> : null}
									{streak >= 2 && <span className={styles.streakChip}>🔥 {streak}</span>}
								</div>
								<div className={styles.rankBar}><div className={styles.rankFill} style={{ width: ladder.levelPct + "%", background: ladder.tierColor }} /></div>
								<div className={styles.rankFoot}><span>{ladder.atMax ? "Maxed" : ladder.pointsIntoLevel + " / " + ladder.pointsPerLevel + " pts"}</span><span>{ladder.atMax ? "" : "→ Lvl " + (ladder.level + 1)}</span></div>
								{!done ? (
									<button className={`btn ${styles.hint} ${p?.hintUsed ? styles.hintUsed : ""}`} disabled={!p || p.finished} onClick={() => getSocket().emit("puzzle_hint")}>💡 Hint</button>
								) : (
									<div className={`${styles.actions} kbd-btn-group`}>
										<button className="btn btn-primary" onClick={() => { if (p) getSocket().emit("puzzle_retry", { puzzleId: p.puzzleId }); }}>{done === "solved" ? "Restart" : "Try again"}</button>
										<button className="btn" onClick={() => getSocket().emit("puzzle_next")}>{done === "solved" ? "Next" : "Next puzzle"}</button>
									</div>
								)}
							</>
						) : p && p.run ? (
							<>
								<div className={styles.runRow}>
									<div className={styles.runStat}><span className={styles.runLabel}>{p.mode === "daily" ? "Streak" : "Solved"}</span><span className={styles.runValue}>{p.mode === "daily" ? p.run.streak || 0 : p.run.solves || 0}</span></div>
									<div className={styles.runStat}><span className={styles.runLabel}>{p.mode === "streak" ? "Level" : p.mode === "storm" ? "Time" : "Today"}</span><span className={styles.runValue}>{p.mode === "streak" ? String(p.run.targetRating || 0) : p.mode === "storm" ? stormClock(p.run.endsAt || 0) : formatDailyDate(p.run.date || "")}</span></div>
								</div>
								<div className={styles.runFoot}><span>Best</span><span>{p.mode === "streak" ? account.streakBest || 0 : p.mode === "storm" ? account.stormBest || 0 : p.run.bestStreak || 0}</span></div>
							</>
						) : null}
					</aside>
				</div>
			)}
			{runEnd && (
				<ResultPanel kind={runEnd.score > runEnd.bestBefore ? "win" : "lose"}>
					<ResultHeader>{runEnd.mode === "streak" ? "Streak ended" : "Time's up"}</ResultHeader>
					<ResultDetail color={runEnd.score > runEnd.bestBefore ? "#4ade80" : "#cbd5e1"}>{runEnd.mode === "streak" ? runEnd.score + " peak rating · " + runEnd.solves + " solved" : runEnd.solves + " solved"}</ResultDetail>
					<ResultFoot>{runEnd.score > runEnd.bestBefore ? <span style={{ color: "#4ade80" }}>New personal best!</span> : "Best: " + runEnd.best}</ResultFoot>
					<ResultActions>
						<button className="btn btn-primary" onClick={() => { setRunEnd(null); getSocket().emit(runEnd.mode === "streak" ? "puzzle_streak_start" : "puzzle_storm_start"); }}>{runEnd.mode === "streak" ? "New streak" : "New Time Trial"}</button>
						<button className="btn" onClick={exit}>Back to lobby</button>
					</ResultActions>
				</ResultPanel>
			)}
			{daily && (
				<ResultPanel kind={daily.solved ? "win" : "lose"}>
					<ResultHeader>{daily.solved ? "Daily cleared!" : "Daily missed"}</ResultHeader>
					<ResultDetail color={daily.solved ? "#4ade80" : "#f87171"}>Streak · {daily.streak}</ResultDetail>
					{typeof daily.bestStreak === "number" && <div className={styles.bestLine}>{daily.streak > 0 && daily.streak >= daily.bestStreak ? "🏆 New best streak!" : "Best streak: " + daily.bestStreak}</div>}
					<ResultFoot>{daily.solved ? "Come back tomorrow for a new puzzle." : "Give it another go. Same puzzle, no limit on attempts."}</ResultFoot>
					<ResultActions>
						{!daily.solved && <button className="btn btn-primary" onClick={() => { setDaily(null); getSocket().emit("puzzle_daily_start"); }}>Try again</button>}
						<button className={daily.solved ? "btn btn-primary" : "btn"} onClick={exit}>Back to lobby</button>
					</ResultActions>
				</ResultPanel>
			)}
		</section>
	);
}

function stormClock(endsAt: number): string {
	const sec = Math.ceil(Math.max(0, endsAt - Date.now()) / 1000), m = Math.floor(sec / 60), s = sec % 60;
	return m + ":" + (s < 10 ? "0" : "") + s;
}
