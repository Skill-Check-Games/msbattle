// Interactive Learn puzzle: a small board the player solves with the real cascade/chord/flag rules.
// Objective is "open every safe cell" unless mustFlag / guess / clickMine change it; optional
// requirements (minCascades / minChords) add a condition on top. Mouse and the rebindable keys.
import { useEffect, useRef, useState } from "react";
import BoardLogic from "core/src/common/BoardLogic.js";
import { BoardView, UNKNOWN, KNOWN, FLAGGED, sizeCellCanvas, roundRectPath } from "../../game/board-render";
import { keybindings } from "../../shared/keybindings";
import { buildModel, drawOutlines, LEARN_CELL_PX } from "./learn-model";
import type { BoardSpec } from "./learn-data";
import styles from "./LearnPage.module.scss";

export type MistakeKind = "mine" | "wrongFlag";
interface Props {
	puzzle: BoardSpec; isGuess?: boolean; compact?: boolean; hideKbdHint?: boolean; autoFocus?: boolean;
	onSolved?: () => void; onFailed?: () => void; onMistake?: (kind: MistakeKind, cell: { r: number; c: number }) => void;
}

export default function LearnPuzzle({ puzzle, isGuess, compact, hideKbdHint, autoFocus, onSolved, onFailed, onMistake }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [status, setStatus] = useState<{ text: string; cls: string }>({ text: "", cls: "" });
	const [solved, setSolved] = useState(false);
	const [resetKey, setResetKey] = useState(0);
	const cb = useRef({ onSolved, onFailed, onMistake }); cb.current = { onSolved, onFailed, onMistake };

	useEffect(() => {
		const canvas = canvasRef.current; if (!canvas) return;
		const m = buildModel(puzzle);
		const R = m.R, C = m.C;
		const state = m.state;
		sizeCellCanvas(canvas, C, R, LEARN_CELL_PX);
		let focusR = Math.floor(R / 2), focusC = Math.floor(C / 2), hasFocus = false, keyboardEngaged = false;
		let puzzleSolved = false, gameOver = false, cascadeCount = 0, chordCount = 0;
		const highlighted: number[][] = [];
		let bv: BoardView;
		const build = () => {
			bv = new BoardView(canvas, R, C, state, m.cellAt, { xray: puzzle.xray, skin: puzzle.skin || null });
			bv.overlay((ctx, sw, sh) => drawOutlines(ctx, sw, sh, highlighted, "rgba(250, 204, 21, 0.95)", "rgba(250, 204, 21, 0.7)"));
			bv.overlay((ctx, sw, sh) => {
				if (!hasFocus || !keyboardEngaged) return;
				const gap = Math.max(1, Math.round(Math.min(sw, sh) * 0.08));
				ctx.save(); ctx.strokeStyle = "#facc15"; ctx.lineWidth = 2;
				roundRectPath(ctx, focusC * sw + gap / 2, focusR * sh + gap / 2, sw - gap, sh - gap, (Math.min(sw, sh) - gap) * 0.2); ctx.stroke(); ctx.restore();
			});
		};
		build();
		const draw = () => bv.draw();
		draw();
		setStatus({ text: "", cls: "" }); setSolved(false);

		const requirementsMet = () => { const q = puzzle.requirements; if (!q) return true; if (typeof q.minCascades === "number" && cascadeCount < q.minCascades) return false; if (typeof q.minChords === "number" && chordCount < q.minChords) return false; return true; };
		const notifySolved = () => { if (puzzleSolved) return; puzzleSolved = true; setSolved(true); cb.current.onSolved?.(); };
		const progressStatus = () => {
			if (isGuess || puzzle.clickMine) { setStatus({ text: "", cls: "" }); return; }
			if (puzzle.mustFlag) { const mines = puzzle.mines || []; const f = mines.filter(x => state[x[0]][x[1]] === FLAGGED).length; setStatus({ text: `${f} / ${mines.length} mines flagged`, cls: "" }); return; }
			let total = 0, opened = 0;
			for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (!m.isMine[r][c]) { total++; if (state[r][c] === KNOWN) opened++; }
			setStatus({ text: `${opened} / ${total} safe cells opened`, cls: "" });
		};
		const checkSolved = () => {
			if (puzzleSolved || gameOver || puzzle.clickMine) return;
			if (isGuess) { for (const g of puzzle.goodGuessCells || []) if (state[g[0]][g[1]] === KNOWN) { setStatus({ text: "Good guess. Lowest risk on the board.", cls: "ok" }); notifySolved(); return; } return; }
			let allOk = true;
			if (puzzle.mustFlag) { for (const x of puzzle.mines || []) if (state[x[0]][x[1]] !== FLAGGED) { allOk = false; break; } }
			else { for (let r = 0; r < R && allOk; r++) for (let c = 0; c < C && allOk; c++) if (!m.isMine[r][c] && state[r][c] !== KNOWN) allOk = false; }
			if (allOk && !requirementsMet()) allOk = false;
			if (allOk) { setStatus({ text: "Solved!", cls: "ok" }); notifySolved(); } else progressStatus();
		};
		const revealCell = (r: number, c: number) => {
			let opened = 0, hitMine = false;
			BoardLogic.cascadeReveal(r, c, R, C, (rr: number, cc: number) => state[rr][cc] === UNKNOWN, (rr: number, cc: number) => {
				state[rr][cc] = KNOWN; opened++;
				if (m.isMine[rr][cc]) {
					hitMine = true;
					if (puzzle.clickMine) { setStatus({ text: "Found it.", cls: "ok" }); notifySolved(); return true; }
					gameOver = true;
					setStatus({ text: isGuess ? "Bad guess. The other group has better odds. Reset to try again." : "You hit a mine. Reset to try again.", cls: "warn" });
					cb.current.onFailed?.(); cb.current.onMistake?.("mine", { r: rr, c: cc });
					return true;
				}
				return false;
			}, (rr: number, cc: number) => m.clue[rr][cc]);
			if (!hitMine && opened > 1) cascadeCount++;
			draw();
		};
		const tryChord = (r: number, c: number) => {
			if (state[r][c] !== KNOWN) return;
			const v = m.clue[r][c]; if (v === 0) return;
			const ctxc = BoardLogic.chordContext(r, c, R, C, (rr: number, cc: number) => state[rr][cc] === FLAGGED, null, (rr: number, cc: number) => state[rr][cc] === UNKNOWN);
			if (ctxc.flagCount !== v) return;
			chordCount++;
			for (const cell of ctxc.covered) revealCell(cell[0], cell[1]);
		};
		const toggleFlag = (r: number, c: number) => {
			if (state[r][c] === UNKNOWN) { state[r][c] = FLAGGED; if (!m.isMine[r][c]) cb.current.onMistake?.("wrongFlag", { r, c }); }
			else if (state[r][c] === FLAGGED) state[r][c] = UNKNOWN;
			else return;
			draw();
		};
		const left = (r: number, c: number) => {
			if (gameOver || puzzleSolved) return;
			if (state[r][c] === UNKNOWN) { if (puzzle.chordOnly) { setStatus({ text: "Chord a satisfied number.", cls: "warn" }); return; } revealCell(r, c); }
			else if (state[r][c] === KNOWN) tryChord(r, c);
			checkSolved();
		};
		const right = (r: number, c: number) => {
			if (gameOver || puzzleSolved) return;
			if (state[r][c] === UNKNOWN || state[r][c] === FLAGGED) { if (puzzle.chordOnly) { setStatus({ text: "Chord a satisfied number.", cls: "warn" }); return; } toggleFlag(r, c); }
			else if (state[r][c] === KNOWN) tryChord(r, c);
			checkSolved();
		};
		const cellFromEvent = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			const c = Math.floor((e.clientX - rect.left) / rect.width * C), r = Math.floor((e.clientY - rect.top) / rect.height * R);
			return (r >= 0 && r < R && c >= 0 && c < C) ? { r, c } : null;
		};
		const onClick = (e: MouseEvent) => { const cell = cellFromEvent(e); if (cell) left(cell.r, cell.c); };
		const onCtx = (e: MouseEvent) => { e.preventDefault(); const cell = cellFromEvent(e); if (cell) right(cell.r, cell.c); };
		const onKey = (e: KeyboardEvent) => {
			const a = keybindings.actionFor(e); if (!a || a === "next") return;
			e.preventDefault(); keyboardEngaged = true;
			if (a === "reveal") { left(focusR, focusC); return; }
			if (a === "flag") { right(focusR, focusC); return; }
			const d = a === "up" ? [-1, 0] : a === "down" ? [1, 0] : a === "left" ? [0, -1] : [0, 1];
			focusR = Math.max(0, Math.min(R - 1, focusR + d[0])); focusC = Math.max(0, Math.min(C - 1, focusC + d[1])); draw();
		};
		const onFocus = () => { hasFocus = true; draw(); };
		const onBlur = () => { hasFocus = false; draw(); };
		canvas.addEventListener("click", onClick); canvas.addEventListener("contextmenu", onCtx); canvas.addEventListener("keydown", onKey);
		canvas.addEventListener("focus", onFocus); canvas.addEventListener("blur", onBlur);
		if (autoFocus) canvas.focus({ preventScroll: true });
		return () => {
			canvas.removeEventListener("click", onClick); canvas.removeEventListener("contextmenu", onCtx); canvas.removeEventListener("keydown", onKey);
			canvas.removeEventListener("focus", onFocus); canvas.removeEventListener("blur", onBlur);
		};
	}, [puzzle, isGuess, resetKey]);

	const revealKey = keybindings.label(keybindings.get("reveal")), flagKey = keybindings.label(keybindings.get("flag"));
	return (
		<div className={compact ? styles.puzzleCompact : styles.puzzle}>
			{!compact && <span className={styles.puzzleTitle}>{puzzle.title}{solved && <span className={styles.solvedTick}>✓</span>}</span>}
			<div className={styles.board}>
				<canvas ref={canvasRef} tabIndex={0} className={styles.puzzleCanvas}
					aria-label={`Minesweeper puzzle, ${puzzle.rows} by ${puzzle.cols} cells. Arrow keys move the selected cell, ${revealKey} reveals it, ${flagKey} flags it.`} />
			</div>
			{!hideKbdHint && <div className={styles.kbdHint}>Keyboard: arrows to move, {revealKey} to reveal, {flagKey} to flag.</div>}
			{!compact && (
				<div className={styles.controls}>
					<button type="button" className={styles.smallBtn} onClick={() => setResetKey(k => k + 1)}>Reset</button>
					<span className={`${styles.status} ${status.cls === "ok" ? styles.statusOk : status.cls === "warn" ? styles.statusWarn : ""}`}>{status.text}</span>
				</div>
			)}
		</div>
	);
}
