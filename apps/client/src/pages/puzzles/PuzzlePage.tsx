// Puzzle play: the Puzzle Ladder (rated, one puzzle at a time near your rating, with a hint), the
// Time Trial and Streak runs, and the daily puzzle. The server deals puzzle_board, judges every
// click (left_click/right_click) and answers with puzzle_result, puzzle_run_end or
// puzzle_daily_result. The board is a fixed square box so puzzles of any shape sit the same.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSocket, onSocket } from "../../online/socket";
import { useAuth } from "../../shared/auth";
import { BoardSession, ActionResult } from "../../game/board-session";
import { KNOWN, UNKNOWN } from "../../game/board-render";
import { makeBoardDecoder } from "../../game/board-decoder";
import { sound } from "../../audio/sound";
import GameBoard, { SHAKE_PAD_X, SHAKE_PAD_Y } from "../../game/GameBoard";
import { PuzzleRankBadge } from "../../shared/RankBadge";
import { puzzleLadder, PUZZLE_TIERS, LEVELS_PER_TIER, ratingForTierLevel } from "../../shared/puzzle-ladder";
import { ResultPanel, ResultHeader, ResultDetail, ResultFoot, ResultActions } from "../../game/ResultPanel";
import { formatDailyDate } from "../home/home-data";
import BoardLogic from "core/src/common/BoardLogic.js";
import { useInGameBody, useMediaQuery, PORTRAIT_MQ } from "../play/mobile";
import styles from "./PuzzlePage.module.scss";

export type PuzzleMode = "rated" | "streak" | "storm" | "daily";
const TITLES: Record<PuzzleMode, string> = { rated: "Puzzle Ladder", streak: "Streak", storm: "Time Trial", daily: "Daily puzzle" };

interface Run { mode: PuzzleMode; solves?: number; targetRating?: number; endsAt?: number; streak?: number; date?: string; bestStreak?: number; }
interface Puzzle { puzzleId: number; difficulty: number; totalSafe: number; totalMines: number; playerRating: number; mode: PuzzleMode; run: Run | null; finished: boolean; hintUsed: boolean; noRating?: boolean; }
interface RatedResult { solved: boolean; hintUsed: boolean; playerBefore?: number; playerAfter?: number; playerDelta?: number; streakBonus?: number; streak?: number; puzzleStreakBest?: number; noRating?: boolean; }
interface RankChange { up: boolean; label: string; color: string; rating: number; }
interface RunEnd { mode: "streak" | "storm"; solves: number; score: number; bestBefore: number; best: number; }
interface DailyResult { date: string; solved: boolean; streak: number; bestStreak?: number; }

// Desktop's box is measured live (all the room under the header, capped by the width left beside the
// card), like the legacy client did; 480 is only the pre-measure fallback. Phones use a fixed box.
// Phones stack everything in one column: the board box spans the width and its cells fit that width
// (minus the box padding), capped so a tiny puzzle does not become huge.
const PUZZLE_BOX_PX = 548, PUZZLE_CELL_MAX = 80, PUZZLE_BOX_PX_MOBILE = 320, PUZZLE_CELL_MAX_MOBILE = 56, PHONE_BOX_PAD = 14;
// Desktop: ladder rail | board | dossier card (design R3·01). The rail and card widths + gaps are what the
// board box has to leave free beside it.
const CARD_PX = 260, RAIL_PX = 200, GRID_GAP_PX = 24;

export default function PuzzlePage({ mode }: { mode: PuzzleMode }) {
	useInGameBody();
	const navigate = useNavigate();
	const { account, update } = useAuth();
	const puzzleRef = useRef<Puzzle | null>(null);
	const [, bump] = useState(0);
	const rerender = () => bump(n => n + 1);
	const [status, setStatus] = useState<string>("");
	const [flash, setFlash] = useState<{ solved: boolean; delta?: number } | null>(null);
	const [done, setDone] = useState<"solved" | "fail" | null>(null);
	const [runEnd, setRunEnd] = useState<RunEnd | null>(null);
	const [daily, setDaily] = useState<DailyResult | null>(null);
	// Consecutive rated solves — server-owned (survives sessions); the result event carries the new value.
	const [streak, setStreak] = useState(account?.puzzleStreak || 0);
	const [streakBonus, setStreakBonus] = useState(0);
	// A rated result that crossed a rank boundary: a full-board card ("Rank up! Scout II") shown after the
	// solve flash (or at once on a miss), with the rank-up/down jingle, so the moment is unmissable.
	const [rankChange, setRankChange] = useState<RankChange | null>(null);
	const rankChangeTimer = useRef<number | null>(null);
	const showRankChange = (before: number, after: number, delayMs: number) => {
		const a = puzzleLadder(before), b = puzzleLadder(after);
		if (a.tierIndex === b.tierIndex && a.level === b.level) return;
		const up = after > before;
		window.setTimeout(() => {
			(up ? sound.rankUp : sound.rankDown)();
			setRankChange({ up, label: b.tierName + " " + b.levelLabel, color: b.tierColor, rating: after });
			if (rankChangeTimer.current) window.clearTimeout(rankChangeTimer.current);
			rankChangeTimer.current = window.setTimeout(() => setRankChange(null), 2600);
		}, delayMs);
	};
	useEffect(() => { if (account && typeof account.puzzleStreak === "number") setStreak(account.puzzleStreak); }, [account?.puzzleStreak]);
	const [pendingFlash, setPendingFlash] = useState<"solved" | "fail" | null>(null);
	const [boardFlash, setBoardFlash] = useState<"solved" | "fail" | null>(null);
	const [tick, setTick] = useState(0);
	const boardHostRef = useRef<HTMLDivElement>(null);
	// Rated result: "Next" is the default action — focused as soon as the result is in, so Enter takes it
	// even when focus is elsewhere on the page; arrows move between the two buttons.
	const nextBtnRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!done) return;
		nextBtnRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.repeat) return;
			const t = e.target as HTMLElement | null;
			const tag = t?.tagName || "";
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
			if (t?.closest?.(".kbd-btn-group")) return; // a focused button handles its own Enter
			e.preventDefault(); nextBtnRef.current?.click();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [done]);
	const onActionsKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
		const list = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
		const i = list.indexOf(document.activeElement as HTMLButtonElement);
		if (!list.length) return;
		e.preventDefault();
		const step = (e.key === "ArrowRight" || e.key === "ArrowDown") ? 1 : -1;
		list[(i + step + list.length) % list.length].focus();
	};
	const gridRef = useRef<HTMLDivElement>(null);
	const [desktopBox, setDesktopBox] = useState(PUZZLE_BOX_PX);
	const [phoneW, setPhoneW] = useState(PUZZLE_BOX_PX_MOBILE);
	const mobile = useMediaQuery(PORTRAIT_MQ);

	const session = useMemo(() => new BoardSession({
		mode: () => { const p = puzzleRef.current; return p && !p.finished ? "puzzle" : null; },
		sound,
		onAction: (r, c, asFlag) => { session.hintClues = []; session.hintCovered = []; movesRef.current.push({ r, c, flag: !!asFlag }); getSocket().emit(asFlag ? "right_click" : "left_click", { r, c }); },
		onAfterReveal: (result: ActionResult) => { const p = puzzleRef.current; if (p && (p.mode === "streak" || p.mode === "storm") && result.hitMine) setPendingFlash("fail"); }
	}), []);
	if (import.meta.env.DEV) (window as any).__puzzle = session;

	const finish = () => { const p = puzzleRef.current; if (p) { p.finished = true; rerender(); } };
	// Every move made on the current board, in order. A reconnect (network blip or server deploy) re-sends
	// them with puzzle_resume so the server rebuilds the same board and replays them — the board on screen
	// never resets, and a puzzle finished while disconnected still gets its result.
	const movesRef = useRef<{ r: number; c: number; flag: boolean }[]>([]);

	useEffect(() => {
		const offs = [
			onSocket("puzzle_board", (d) => {
				const apply = () => {
					puzzleRef.current = { puzzleId: d.puzzleId, difficulty: d.difficulty, totalSafe: d.totalSafe, totalMines: d.mines, playerRating: d.playerRating, mode: d.mode || "rated", run: d.run || null, finished: false, hintUsed: false, noRating: !!d.noRating };
					movesRef.current = [];
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
					if (typeof d.streak === "number") setStreak(d.streak); else setStreak(s => d.solved ? s + 1 : 0);
					setStreakBonus(d.streakBonus || 0);
					if (account) update({
						puzzleRating: d.playerAfter, puzzlesAttempted: (account.puzzlesAttempted || 0) + 1, puzzlesSolved: (account.puzzlesSolved || 0) + (d.solved ? 1 : 0),
						puzzleStreak: typeof d.streak === "number" ? d.streak : account.puzzleStreak,
						puzzleStreakBest: typeof d.puzzleStreakBest === "number" ? d.puzzleStreakBest : account.puzzleStreakBest,
						puzzleRecent: [...(account.puzzleRecent || []), d.solved].slice(-10)
					});
				}
				if (d.solved) { sound.win(); setFlash({ solved: true, delta: d.playerDelta }); setTimeout(() => { setFlash(null); setDone("solved"); }, 1200); }
				else setDone("fail");
				if (!d.noRating && typeof d.playerBefore === "number" && typeof d.playerAfter === "number") showRankChange(d.playerBefore, d.playerAfter, d.solved ? 1250 : 150);
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
			// The socket re-authenticated: after a reconnect, pick the current board back up where it was.
			onSocket("authenticated", () => {
				const p = puzzleRef.current;
				if (!p || p.finished || p.puzzleId == null) return;
				if (p.mode === "streak" || p.mode === "storm") {
					// Runs are session-only on the server (it ended this one on the drop) — say so instead of a dead board.
					puzzleRef.current = null; setStatus("Connection lost — the run ended. Start a new one from the menu."); rerender();
					return;
				}
				getSocket().emit("puzzle_resume", { puzzleId: p.puzzleId, mode: p.mode, noRating: !!p.noRating, moves: movesRef.current });
			}),
			onSocket("puzzle_resumed", (d) => {
				if (d && d.ok) return;
				// The server couldn't rebuild this one (not the current puzzle any more, or a day rolled over): fresh board.
				const p = puzzleRef.current;
				getSocket().emit(p && p.mode === "daily" ? "puzzle_daily_start" : "puzzle_next");
			}),
			onSocket("puzzle_error", (d) => { const reason = (d && d.reason) || "unknown"; setStatus(reason === "auth_required" ? "Sign in to play rated puzzles." : reason === "no_puzzles" ? "No puzzles available yet." : "Couldn't load a puzzle: " + reason); })
		];
		const t = setInterval(() => setTick(n => n + 1), 250);
		return () => { offs.forEach(off => off()); clearInterval(t); const p = puzzleRef.current; if (p && (p.mode === "streak" || p.mode === "storm") && !p.finished) getSocket().emit("puzzle_run_abandon"); session.clear(); };
	}, [mode]);
	// Start only once the socket has authenticated (a fresh page load races the handshake otherwise).
	const started = useRef<string | null>(null);
	useEffect(() => { if (!account || started.current === mode) return; started.current = mode; start(mode); }, [mode, !!account]);

	// Fit the board box to the viewport: the height left under the header, or the width left beside the
	// card, whichever is smaller; clamped so odd windows stay usable and huge ones don't blow cells up.
	useLayoutEffect(() => {
		const measure = () => {
			const grid = gridRef.current, host = boardHostRef.current; if (!grid || !host) return;
			const stacked = getComputedStyle(grid).flexDirection === "column";
			if (stacked) { setPhoneW(Math.max(1, grid.clientWidth - PHONE_BOX_PAD * 2 - SHAKE_PAD_X * 2)); return; }
			const availH = window.innerHeight - host.getBoundingClientRect().top - 32;
			const availW = grid.clientWidth - (CARD_PX + GRID_GAP_PX) - (isRun ? 0 : RAIL_PX + GRID_GAP_PX);
			const box = Math.min(availH, availW);
			if (box > 0) setDesktopBox(Math.max(240, Math.min(900, Math.floor(box))));
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [!!account, !!puzzleRef.current, status, mobile]);

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
	const box = desktopBox;
	const cellPx = !session.rows ? 32 : mobile ? Math.min(PUZZLE_CELL_MAX_MOBILE, Math.floor(phoneW / session.cols)) : Math.min(PUZZLE_CELL_MAX, Math.floor((box - SHAKE_PAD_X * 2) / session.cols), Math.floor((box - SHAKE_PAD_Y * 2) / session.rows));
	const ladder = puzzleLadder(account?.puzzleRating || 0);
	void tick;

	return (
		<section className={styles.page}>
			<div className={styles.header}>
				<button className="btn btn-ghost" onClick={exit}>← Exit game</button>
				<span className={styles.title}>{TITLES[mode]}</span>
			</div>
			{!account ? <p className={styles.empty}>Sign in to play. Your score is tied to your account.</p> : !p && status ? <p className={styles.empty}>{status}</p> : (
				<div className={styles.grid} ref={gridRef}>
					{!isRun && <LadderRail rating={account.puzzleRating || 0} />}
					<div className={styles.boardCol} ref={boardHostRef}>
						<div className={`${styles.boardWrap} ${boardFlash === "solved" ? styles.flashSolved : boardFlash === "fail" ? styles.flashFail : ""}`} style={mobile ? { width: "100%", padding: PHONE_BOX_PAD } : { width: box, height: box }} data-shake-host="">
							<GameBoard session={session} cellPx={cellPx} className={styles.board}>
								{flash && <div className={`${styles.flash} ${flash.solved ? styles.flashOk : styles.flashBad}`}><div className={styles.flashIcon}>{flash.solved ? "✓" : "✗"}</div><div className={styles.flashLabel}>{flash.solved ? "Solved" : "Mine hit"}</div></div>}
							</GameBoard>
						</div>
						{p && !isRun && p.puzzleId != null && (
							<div className={styles.underBoard}>
								{streak >= 2 && <span className={styles.streakChip}><FlameIcon /> {streak}{flash && streakBonus ? " · +" + streakBonus : ""}</span>}
							</div>
						)}
					</div>
					<aside className={styles.card}>
						<div className={`${styles.cardHead} ${!isRun ? styles.cardHeadRated : ""}`}><button type="button" className={styles.back} onClick={exit} aria-label="Back to lobby">←</button><span className={styles.cardTitle}>{TITLES[mode]}</span></div>
						{!isRun ? (
							<>
								<div className={styles.ladderHead}>
									<PuzzleRankBadge rating={account.puzzleRating || 0} size={9} />
									<div className={styles.ladderText}>
										<span className={styles.cardTitle}>Puzzle Ladder</span>
										<span className={styles.ladderTier} style={{ color: ladder.tierColor }}>{ladder.tierName + " " + ladder.levelLabel}{flash && typeof flash.delta === "number" && flash.delta !== 0 ? <span className={`${styles.delta} ${flash.delta > 0 ? styles.gain : styles.loss}`}>{flash.delta > 0 ? "+" : ""}{flash.delta}</span> : null}</span>
									</div>
								</div>
								<div className={styles.rankBar}><div className={styles.rankFill} style={{ width: ladder.levelPct + "%", background: ladder.tierColor }} /></div>
								<div className={styles.rankFoot}><span>{ladder.rating}</span><span>{ladder.nextLevelAt == null ? "" : ladder.nextLevelAt + " · " + puzzleLadder(ladder.nextLevelAt).tierName + " " + puzzleLadder(ladder.nextLevelAt).levelLabel}</span></div>
								<div className={styles.stats}>
									<div className={styles.stat}><span className={styles.statLabel}>Rating</span><span className={styles.statValue}>{ladder.rating}</span></div>
									<div className={styles.stat}><span className={styles.statLabel}>Streak</span><span className={styles.statValue} style={{ color: "var(--energy-streak)" }}>{streak}</span></div>
									<div className={styles.stat}><span className={styles.statLabel}>Solved</span><span className={styles.statValue}>{account.puzzlesSolved || 0} / {account.puzzlesAttempted || 0}</span></div>
									<div className={styles.stat}><span className={styles.statLabel}>Best streak</span><span className={styles.statValue}>{Math.max(account.puzzleStreakBest || 0, streak)}</span></div>
								</div>
								<div className={styles.history}>
									<span className={styles.cardTitle}>Last 10</span>
									<div className={styles.historyDots}>{(account.puzzleRecent || []).map((ok, i) => <span key={i} className={`${styles.historyDot} ${ok ? styles.historyOk : styles.historyMiss}`}>{ok ? <CheckIcon /> : <CrossIcon />}</span>)}</div>
								</div>
								<div className={styles.cardSpacer} />
								{/* Hint button removed for now (2026-09-14); the server-side puzzle_hint path is still there. */}
								{done && (
									<div className={`${styles.actions} kbd-btn-group`} onKeyDown={onActionsKey}>
										<button ref={nextBtnRef} className={`btn btn-primary ${styles.primaryAction}`} onClick={() => getSocket().emit("puzzle_next")}>{done === "solved" ? "Next" : "Next puzzle"}</button>
										<button className="btn" onClick={() => { if (p) getSocket().emit("puzzle_retry", { puzzleId: p.puzzleId }); }}>{done === "solved" ? "Restart" : "Try again"}</button>
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
								<button className={`btn ${styles.hint} ${p.hintUsed ? styles.hintUsed : ""}`} disabled={p.finished} onClick={() => getSocket().emit("puzzle_hint")}>💡 Hint</button>
							</>
						) : null}
					</aside>
					{/* Rank boundary crossed: covers the WHOLE puzzle area (board + side card), not just the canvas. */}
					{rankChange && (
						<div className={`${styles.rankFlash} ${rankChange.up ? styles.rankUp : styles.rankDown}`} style={{ borderColor: rankChange.color }}>
							<div className={styles.rankFlashKicker}>{rankChange.up ? "Rank up!" : "Rank down"}</div>
							<PuzzleRankBadge rating={rankChange.rating} size={14} />
							<div className={styles.rankFlashLabel} style={{ color: rankChange.color }}>{rankChange.label}</div>
							<div className={styles.rankFlashRating}>{rankChange.rating} rating</div>
						</div>
					)}
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

// The ladder rail (desktop): every tier, top to bottom, the player's tier highlighted with its level pips.
function LadderRail({ rating }: { rating: number }) {
	const me = puzzleLadder(rating);
	const tiers = PUZZLE_TIERS.map((t, i) => ({ ...t, i })).reverse();
	return (
		<aside className={styles.rail} aria-label="Puzzle Ladder tiers">
			{tiers.map(t => {
				const current = t.i === me.tierIndex, reached = t.i < me.tierIndex;
				return (
					<div key={t.name} className={`${styles.railRow} ${current ? styles.railCurrent : ""} ${reached || current ? "" : styles.railLocked}`} style={current ? { borderColor: t.color } : undefined}>
						<PuzzleRankBadge rating={ratingForTierLevel(t.i, 1)} size={5} />
						<div className={styles.railText}>
							<span className={styles.railName} style={{ color: reached || current ? t.color : undefined }}>{t.name}{current ? " " + me.levelLabel : ""}</span>
							{current && <div className={styles.pips}>{Array.from({ length: LEVELS_PER_TIER }, (_, k) => <i key={k} style={k < me.level ? { background: t.color } : undefined} />)}</div>}
						</div>
					</div>
				);
			})}
		</aside>
	);
}
function FlameIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22c4 0 7-3 7-7 0-3-2-5-3-7-1 2-2 3-3 3 0-3-1-6-4-8 0 3-1 5-3 7-2 2-3 4-3 6 0 4 3 6 6 6z" /></svg>; }
function CheckIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>; }
function CrossIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>; }
