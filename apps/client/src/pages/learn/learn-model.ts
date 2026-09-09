// Pure board model for Learn boards: mine grid, clue grid, and the initial state a spec describes.
import BoardLogic from "core/src/common/BoardLogic.js";
import { MINE, UNKNOWN, KNOWN, FLAGGED } from "../../game/board-render";
import type { BoardSpec } from "./learn-data";

export const LEARN_CELL_PX = 32;

export function buildMineGrid(spec: BoardSpec): boolean[][] {
	const arr: boolean[][] = [];
	for (let r = 0; r < spec.rows; r++) arr[r] = new Array(spec.cols).fill(false);
	for (const m of spec.mines || []) arr[m[0]][m[1]] = true;
	return arr;
}

export function buildBoardState(spec: BoardSpec, isMine: boolean[][], clue: number[][]): number[][] {
	const R = spec.rows, C = spec.cols;
	const s: number[][] = [];
	for (let r = 0; r < R; r++) s[r] = new Array(C).fill(UNKNOWN);
	if (spec.revealAll) for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (!isMine[r][c]) s[r][c] = KNOWN;
	for (const p of spec.revealed || []) s[p[0]][p[1]] = KNOWN;
	for (const p of spec.covered || []) s[p[0]][p[1]] = UNKNOWN;
	for (const p of spec.flagged || []) s[p[0]][p[1]] = FLAGGED;
	if (spec.revealStart) {
		BoardLogic.cascadeReveal(spec.revealStart[0], spec.revealStart[1], R, C,
			(r: number, c: number) => s[r][c] === UNKNOWN && !isMine[r][c],
			(r: number, c: number) => { s[r][c] = KNOWN; return false; },
			(r: number, c: number) => clue[r][c]);
	}
	return s;
}

export interface LearnModel { R: number; C: number; isMine: boolean[][]; clue: number[][]; cellAt: (r: number, c: number) => number; state: number[][]; }
export function buildModel(spec: BoardSpec): LearnModel {
	const isMine = buildMineGrid(spec);
	const clue: number[][] = BoardLogic.buildClueGrid(spec.rows, spec.cols, (r: number, c: number) => isMine[r][c]);
	return { R: spec.rows, C: spec.cols, isMine, clue, cellAt: (r, c) => isMine[r][c] ? MINE : clue[r][c], state: buildBoardState(spec, isMine, clue) };
}

// Gold outline around a set of cells (hint / clue highlights).
export function drawOutlines(ctx: CanvasRenderingContext2D, sw: number, sh: number, cells: number[][], stroke: string, shadow: string) {
	if (!cells.length) return;
	ctx.save();
	ctx.lineWidth = Math.max(2, Math.min(sw, sh) * 0.08); ctx.strokeStyle = stroke; ctx.shadowColor = shadow; ctx.shadowBlur = Math.min(sw, sh) * 0.25;
	for (const [r, c] of cells) ctx.strokeRect(c * sw + sw * 0.08, r * sh + sh * 0.08, sw * 0.84, sh * 0.84);
	ctx.restore();
}
