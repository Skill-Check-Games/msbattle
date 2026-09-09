// Shared by the All-puzzles and Combined-puzzles admin pages: the puzzle card (playable board
// thumbnail + Analyze button) and the Analyze modal, which plays the puzzle interactively while the
// CSP solver's move trace (GET <base>/<id>/analyze) is listed alongside. Clicking a move replays
// the board to that point; derivation steps and case-split branches highlight their cells on hover.
// Port of renderPuzzleListCard / openAnalyzeModal (legacy admin/Puzzles.js).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import BoardLogic from "core/src/common/BoardLogic.js";
import Modal from "../../app/Modal";
import { BoardView, MINE, UNKNOWN, KNOWN, FLAGGED, sizeCellCanvas } from "../../game/board-render";
import { drawOutlines } from "../learn/learn-model";
import styles from "./PuzzleAnalyze.module.scss";

export interface PoolPuzzle {
	id: number; rows: number; cols: number; mines: number[][]; revealed: number[][];
	coveredSafe?: number; rating?: number | null; difficulty?: number;
	label?: string; solved?: boolean; cspMaxComplexity?: number; [k: string]: any;
}
export type Highlight = number[][] | { primary: number[][]; context: number[][] } | null;
export interface BoardController { reset(): void; revealCell(r: number, c: number): void; flagCell(r: number, c: number): void; highlight(cells: Highlight): void; }

const density = (p: PoolPuzzle) => Math.round((p.mines.length / (p.rows * p.cols)) * 100);
const cellPxFor = (p: PoolPuzzle, max: number, fitPx: number) => Math.max(14, Math.min(max, Math.floor(fitPx / Math.max(p.cols, p.rows))));

// ---- the playable board (mouse: left reveal / chord, right flag) with an imperative controller ----
export const PlayBoard = forwardRef<BoardController, { puzzle: PoolPuzzle; cellPx: number; showStatus?: boolean }>(function PlayBoard({ puzzle, cellPx, showStatus }, ref) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [status, setStatus] = useState<{ text: string; warn?: boolean; ok?: boolean }>({ text: "" });
	const ctrl = useRef<BoardController | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current; if (!canvas) return;
		const R = puzzle.rows, C = puzzle.cols;
		const isMine: boolean[][] = []; for (let r = 0; r < R; r++) isMine[r] = new Array(C).fill(false);
		for (const m of puzzle.mines) isMine[m[0]][m[1]] = true;
		const clue: number[][] = BoardLogic.buildClueGrid(R, C, (r: number, c: number) => isMine[r][c]);
		const cellAt = (r: number, c: number) => isMine[r][c] ? MINE : clue[r][c];
		const freshState = () => { const s: number[][] = []; for (let r = 0; r < R; r++) s[r] = new Array(C).fill(UNKNOWN); for (const rc of puzzle.revealed || []) s[rc[0]][rc[1]] = KNOWN; return s; };
		let state = freshState();
		let highlighted: Highlight = null;
		let gameOver = false, solved = false;
		sizeCellCanvas(canvas, C, R, cellPx);
		let bv: BoardView;
		const build = () => {
			bv = new BoardView(canvas, R, C, state, cellAt, {});
			bv.overlay((ctx, sw, sh) => {
				if (!highlighted) return;
				if (Array.isArray(highlighted)) drawOutlines(ctx, sw, sh, highlighted, "rgba(250, 204, 21, 0.95)", "rgba(250, 204, 21, 0.7)");
				else { drawOutlines(ctx, sw, sh, highlighted.context || [], "rgba(96, 165, 250, 0.85)", "rgba(96, 165, 250, 0.5)"); drawOutlines(ctx, sw, sh, highlighted.primary || [], "rgba(250, 204, 21, 0.95)", "rgba(250, 204, 21, 0.7)"); }
			});
		};
		build();
		const draw = () => bv.draw();
		const progress = () => {
			if (!showStatus) return;
			let total = 0, opened = 0;
			for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (!isMine[r][c]) { total++; if (state[r][c] === KNOWN) opened++; }
			if (opened === total) { solved = true; setStatus({ text: "Solved! ✓", ok: true }); }
			else setStatus({ text: `${opened} / ${total} safe cells opened` });
		};
		const revealCell = (r: number, c: number) => {
			BoardLogic.cascadeReveal(r, c, R, C,
				(rr: number, cc: number) => state[rr][cc] === UNKNOWN,
				(rr: number, cc: number) => { state[rr][cc] = KNOWN; if (isMine[rr][cc]) { gameOver = true; setStatus({ text: "You hit a mine. Reset to try again.", warn: true }); return true; } return false; },
				(rr: number, cc: number) => clue[rr][cc]);
			if (!gameOver) progress();
			draw();
		};
		const flagCell = (r: number, c: number) => { if (state[r][c] === UNKNOWN) { state[r][c] = FLAGGED; draw(); } };
		const reset = () => { state = freshState(); build(); gameOver = false; solved = false; setStatus({ text: "" }); draw(); };
		ctrl.current = { reset: () => { highlighted = null; reset(); }, revealCell, flagCell, highlight: (cells) => { highlighted = cells || null; draw(); } };
		draw(); setStatus({ text: "" });

		const cellFromEvent = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			const c = Math.floor((e.clientX - rect.left) / rect.width * C), r = Math.floor((e.clientY - rect.top) / rect.height * R);
			return (r >= 0 && r < R && c >= 0 && c < C) ? { r, c } : null;
		};
		const onClick = (e: MouseEvent) => {
			if (gameOver || solved) return;
			const cell = cellFromEvent(e); if (!cell) return;
			const { r, c } = cell;
			if (state[r][c] === UNKNOWN) { revealCell(r, c); return; }
			if (state[r][c] === KNOWN && clue[r][c] > 0) {
				const ctx = BoardLogic.chordContext(r, c, R, C, (rr: number, cc: number) => state[rr][cc] === FLAGGED, null, (rr: number, cc: number) => state[rr][cc] === UNKNOWN);
				if (ctx.flagCount === clue[r][c]) for (const [nr, nc] of ctx.covered as number[][]) { if (gameOver) break; revealCell(nr, nc); }
			}
		};
		const onContext = (e: MouseEvent) => {
			e.preventDefault();
			if (gameOver || solved) return;
			const cell = cellFromEvent(e); if (!cell) return;
			const { r, c } = cell;
			if (state[r][c] === UNKNOWN) state[r][c] = FLAGGED; else if (state[r][c] === FLAGGED) state[r][c] = UNKNOWN; else return;
			draw();
		};
		canvas.addEventListener("click", onClick);
		canvas.addEventListener("contextmenu", onContext);
		return () => { canvas.removeEventListener("click", onClick); canvas.removeEventListener("contextmenu", onContext); ctrl.current = null; };
	}, [puzzle, cellPx, showStatus]);

	useImperativeHandle(ref, () => ({
		reset: () => ctrl.current?.reset(),
		revealCell: (r, c) => ctrl.current?.revealCell(r, c),
		flagCell: (r, c) => ctrl.current?.flagCell(r, c),
		highlight: (cells) => ctrl.current?.highlight(cells)
	}), []);

	return (
		<div className={styles.play}>
			<canvas ref={canvasRef} className={styles.canvas} />
			{showStatus && (
				<div className={styles.playRow}>
					<button type="button" className={styles.btn} onClick={() => ctrl.current?.reset()}>Reset</button>
					<span className={`${styles.status} ${status.warn ? styles.statusWarn : ""} ${status.ok ? styles.statusOk : ""}`}>{status.text}</span>
				</div>
			)}
		</div>
	);
});

// ---- the list card ----
export function PuzzleCard({ p, onAnalyze }: { p: PoolPuzzle; onAnalyze: (p: PoolPuzzle) => void }) {
	return (
		<div className={styles.card}>
			<div className={styles.cardHead}>
				<span className={`${styles.diffBadge} ${styles["diff" + (p.difficulty || 0)] || ""}`}>{(p.rating != null ? p.rating : "?") + " · t" + p.difficulty}</span>
				<span className={styles.cardMeta}>{p.rows}×{p.cols} · {p.coveredSafe} covered · {density(p)}%</span>
				<button type="button" className={styles.btn} onClick={() => onAnalyze(p)}>Analyze</button>
			</div>
			{p.label && <div className={styles.cardLabel}>{p.label}{p.solved === false ? " · partial" : ""}</div>}
			<PlayBoard puzzle={p} cellPx={cellPxFor(p, 24, 300)} />
		</div>
	);
}

// ---- the Analyze modal ----
interface Move { method?: string; revealed?: number[][]; flagged?: number[][]; changed?: number[][]; cells?: number[][]; complexity: number; depth?: number; derivation?: DerivStep[]; splitCell?: number[]; componentSize?: number; branches?: Record<string, Branch>; }
interface DerivStep { index: number; cells: number[][]; lo: number; hi: number; source: string; from?: number[]; parents?: number[]; complexity: number; }
interface Branch { moves: { action: string; cells: number[][]; changed?: number[][]; complexity: number }[]; contradiction?: { clue: number[]; why: string } | null; }
interface Trace { error?: string; moves?: Move[]; maxComplexity: number; totalComplexity: number; solved: boolean; safeCovered: number; }

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const plural = (n: number, word: string) => n + " " + word + (n === 1 ? "" : "s");
const cellsText = (cells: number[][]) => cells.map(rc => "(" + rc[0] + "," + rc[1] + ")").join(" ");
function setName(idx: number) { return idx < 26 ? String.fromCharCode(65 + idx) : String.fromCharCode(65 + Math.floor(idx / 26) - 1) + String.fromCharCode(65 + (idx % 26)); }
function describeMines(step: DerivStep) {
	const { lo, hi } = step;
	if (lo === hi) return plural(lo, "mine");
	if (lo === 0) return "at most " + plural(hi, "mine");
	if (hi === step.cells.length) return "at least " + plural(lo, "mine");
	return "between " + lo + " and " + plural(hi, "mine");
}
function describeStep(step: DerivStep) {
	const cells = plural(step.cells.length, "cell"), mines = describeMines(step);
	let tail = "";
	if (step.cells.length > 0 && step.lo === step.hi) { if (step.hi === step.cells.length) tail = " (all mines!)"; else if (step.hi === 0) tail = " (all safe!)"; }
	if (step.source === "initial") return "from clue at (" + step.from![0] + "," + step.from![1] + ") → " + cells + ", " + mines + tail;
	const pA = setName(step.parents![0]), pB = setName(step.parents![1]);
	if (step.source === "subset") return pB + " minus " + pA + " → " + cells + ", " + mines + tail;
	if (step.source === "union") return pA + " combined with " + pB + " → " + cells + ", " + mines + tail;
	if (step.source === "intersect") return "overlap of " + pA + " and " + pB + " → " + cells + ", " + mines + tail;
	return step.source;
}
function moveAccent(mv: Move) {
	if (mv.method === "case") return styles.accCase;
	if (mv.method === "enum") return styles.accEnum;
	const r = (mv.revealed || []).length, f = (mv.flagged || []).length;
	if (r && f) return styles.accMixed;
	return r ? styles.accReveal : styles.accFlag;
}
function moveOutcome(mv: Move) {
	const r = (mv.revealed || []).length, f = (mv.flagged || []).length;
	const outcome = r && f ? plural(r, "safe") + ", " + plural(f, "mine") : r ? plural(r, "safe") : plural(f, "mine");
	if (mv.method === "case") return "case·(" + mv.splitCell![0] + "," + mv.splitCell![1] + ") → " + outcome;
	if (mv.method === "enum") return "enum·" + mv.componentSize + " → " + outcome;
	return outcome;
}

export function AnalyzeModal({ puzzle, base, onClose }: { puzzle: PoolPuzzle | null; base: string; onClose: () => void }) {
	const board = useRef<BoardController>(null);
	const [trace, setTrace] = useState<Trace | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [active, setActive] = useState<number | null>(null);
	const [open, setOpen] = useState<Record<number, boolean>>({});
	const playToken = useRef(0);

	useEffect(() => {
		setTrace(null); setError(null); setActive(null); setOpen({}); playToken.current++;
		if (!puzzle) return;
		let alive = true;
		fetch(base + "/" + puzzle.id + "/analyze").then(r => r.json()).then(data => {
			if (!alive) return;
			if (data && data.error) setError(data.error); else setTrace(data);
		}).catch(e => { if (alive) setError(e.message); });
		return () => { alive = false; playToken.current++; };
	}, [puzzle, base]);

	const moves = useMemo(() => (trace && trace.moves) || [], [trace]);

	// Apply move-bundles 0..upTo, then highlight the focused bundle's cells.
	const applyMoves = useCallback((upTo: number, focus: number | null) => {
		const b = board.current; if (!b) return;
		b.reset();
		for (let i = 0; i <= upTo && i < moves.length; i++) {
			const mv = moves[i];
			for (const rc of mv.revealed || []) b.revealCell(rc[0], rc[1]);
			for (const rc of mv.flagged || []) b.flagCell(rc[0], rc[1]);
		}
		if (focus != null && moves[focus]) b.highlight((moves[focus].revealed || []).concat(moves[focus].flagged || []));
		else b.highlight(null);
	}, [moves]);

	const selectMove = (i: number) => { setActive(i); applyMoves(i, i); };
	const playAll = () => {
		const my = ++playToken.current;
		board.current?.reset(); setActive(null);
		let i = 0;
		const step = () => {
			if (my !== playToken.current) return;
			if (i >= moves.length) { board.current?.highlight(null); return; }
			applyMoves(i, i); setActive(i);
			document.getElementById("analyze-move-" + i)?.scrollIntoView({ block: "nearest" });
			i++;
			window.setTimeout(step, 500);
		};
		step();
	};

	const close = useCallback(() => { playToken.current++; onClose(); }, [onClose]);
	if (!puzzle) return null;
	const title = puzzle.label ? "Analyze · " + puzzle.label : "Analyze · puzzle " + puzzle.id;
	return (
		<Modal open={!!puzzle} onClose={close} width={1120} className={styles.modal}>
			<div className={styles.modalHead}>
				<h2 className={styles.modalTitle}>{title}</h2>
				<span className={styles.modalSub}>{puzzle.rows}×{puzzle.cols} · {density(puzzle)}% · rating {puzzle.rating} · t{puzzle.difficulty}</span>
			</div>
			<div className={styles.modalBody}>
				<div className={styles.modalBoard}>
					<PlayBoard ref={board} puzzle={puzzle} cellPx={cellPxFor(puzzle, 32, 440)} showStatus />
				</div>
				<div className={styles.trace}>
					<div className={styles.traceHeadRow}>
						<div className={styles.traceHead}>Solver moves</div>
						<button type="button" className={styles.playAll} disabled={moves.length === 0} onClick={playAll}>Play all</button>
					</div>
					<div className={styles.traceStatus}>
						{error ? "Error: " + error : !trace ? "Analyzing…" :
							"max complexity " + fmt1(trace.maxComplexity) + " · total " + fmt1(trace.totalComplexity) + (trace.solved ? " · solved" : " · " + trace.safeCovered + " safe cells uncovered")}
					</div>
					<ol className={styles.traceList}>
						{moves.map((mv, i) => {
							const hasDerivation = !!(mv.derivation && mv.derivation.length > 1);
							const hasBranches = mv.method === "case" && !!mv.branches;
							const expandable = hasDerivation || hasBranches;
							const isOpen = !!open[i];
							return (
								<li key={i} id={"analyze-move-" + i} className={`${styles.move} ${moveAccent(mv)} ${active === i ? styles.moveActive : ""}`}>
									<div className={styles.moveHeader} onClick={() => selectMove(i)}>
										<span className={`${styles.toggle} ${expandable ? "" : styles.toggleEmpty}`} onClick={e => { if (!expandable) return; e.stopPropagation(); setOpen(o => ({ ...o, [i]: !o[i] })); }}>{expandable ? (isOpen ? "▼" : "▶") : "·"}</span>
										<span className={styles.moveIndex}>#{i + 1}</span>
										<span className={styles.moveAction}>{moveOutcome(mv)}</span>
										<span className={styles.moveCells}>{cellsText(mv.changed || mv.cells || [])}</span>
										{typeof mv.depth === "number" && hasDerivation && <span className={styles.moveDepth}>d={mv.depth}</span>}
										<span className={styles.moveCompl}>c={Math.round(mv.complexity * 10) / 10}</span>
									</div>
									{expandable && isOpen && (
										<div className={styles.detail}>
											{hasDerivation && <Derivation steps={mv.derivation!} moveIdx={i} board={board} applyMoves={applyMoves} />}
											{hasBranches && <CaseBranches mv={mv} moveIdx={i} board={board} applyMoves={applyMoves} />}
										</div>
									)}
								</li>
							);
						})}
					</ol>
				</div>
			</div>
		</Modal>
	);
}

// The derivation tree of a move as a topologically-ordered list of steps: read it like a proof,
// initial reads first, derived clues after. Hover replays the board to just before the move and
// outlines the step's cells (gold) against its parents' (blue).
function Derivation({ steps, moveIdx, board, applyMoves }: { steps: DerivStep[]; moveIdx: number; board: React.RefObject<BoardController | null>; applyMoves: (upTo: number, focus: number | null) => void }) {
	const hover = (step: DerivStep) => {
		applyMoves(moveIdx - 1, null);
		const primary = step.cells.slice(); if (step.from) primary.push(step.from);
		const context: number[][] = [];
		for (const pi of step.parents || []) { const par = steps[pi]; if (!par) continue; for (const c of par.cells) context.push(c); if (par.from) context.push(par.from); }
		board.current?.highlight({ primary, context });
	};
	return (
		<>
			{steps.map(step => (
				<div key={step.index} className={`${styles.derivStep} ${step.source === "initial" ? styles.derivInitial : ""}`} onMouseEnter={() => hover(step)} onMouseLeave={() => applyMoves(moveIdx, moveIdx)}>
					<span className={styles.derivLabel}>Set {setName(step.index)}</span>
					<span className={styles.derivBody}>{describeStep(step)}</span>
					<span className={styles.derivCompl}>c={step.complexity}</span>
				</div>
			))}
		</>
	);
}

// The two branches of a case-split move: each with the moves the propagator took until a
// contradiction (the split cell cannot have that value) or a consistent end that pins cells.
function CaseBranches({ mv, moveIdx, board, applyMoves }: { mv: Move; moveIdx: number; board: React.RefObject<BoardController | null>; applyMoves: (upTo: number, focus: number | null) => void }) {
	const split = mv.splitCell!;
	const leave = () => applyMoves(moveIdx, moveIdx);
	return (
		<>
			{(["safe", "mine"] as const).map(which => {
				const branch = mv.branches && mv.branches[which]; if (!branch) return null;
				const applyHypotheticalUpTo = (stepIdx: number) => {
					applyMoves(moveIdx - 1, null);
					const b = board.current; if (!b) return;
					if (which === "safe") b.revealCell(split[0], split[1]); else b.flagCell(split[0], split[1]);
					for (let k = 0; k <= stepIdx && k < branch.moves.length; k++) {
						const bm = branch.moves[k];
						const cells = bm.changed && bm.changed.length ? bm.changed : bm.cells;
						for (const rc of cells) { if (bm.action === "flag") b.flagCell(rc[0], rc[1]); else b.revealCell(rc[0], rc[1]); }
					}
				};
				return (
					<div key={which}>
						<div className={styles.branchHead}>
							<span className={styles.hyp}>If ({split[0]},{split[1]}) is {which === "safe" ? "safe" : "a mine"}</span>
							{branch.contradiction
								? <span className={styles.caseTag}>→ contradiction at ({branch.contradiction.clue[0]},{branch.contradiction.clue[1]})</span>
								: <span className={`${styles.caseTag} ${styles.caseTagOk}`}>→ consistent</span>}
						</div>
						{branch.moves.map((bm, bi) => (
							<div key={bi} className={`${styles.caseStep} ${bm.action === "flag" ? styles.accFlag : styles.accReveal}`}
								onMouseEnter={() => { applyHypotheticalUpTo(bi); board.current?.highlight({ primary: bm.changed || bm.cells, context: [split] }); }} onMouseLeave={leave}>
								<span className={styles.caseNum}>{bi + 1}.</span>
								<span className={styles.caseAction}>{bm.action === "flag" ? "flag" : "reveal"}</span>
								<span className={styles.moveCells}>{cellsText(bm.changed || bm.cells)}</span>
								<span className={styles.moveCompl}>c={Math.round(bm.complexity * 10) / 10}</span>
							</div>
						))}
						{branch.contradiction && (
							<div className={styles.contra} onMouseEnter={() => { applyHypotheticalUpTo(branch.moves.length - 1); board.current?.highlight({ primary: [branch.contradiction!.clue], context: [split] }); }} onMouseLeave={leave}>
								✗ {branch.contradiction.why}
							</div>
						)}
					</div>
				);
			})}
		</>
	);
}
