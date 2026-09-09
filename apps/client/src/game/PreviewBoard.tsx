// A still board picture from a spec: mines, an opening (a cell to cascade from, or explicit revealed
// cells) and pre-placed flags. Draws once per prop change, no animation loop. Used by the home
// mode rows, the daily hero, and the customize lab's skin swatches.
import { useLayoutEffect, useRef } from "react";
import BoardLogic from "core/src/common/BoardLogic.js";
import { BoardView, MINE, UNKNOWN, KNOWN, FLAGGED, sizeCellCanvas } from "./board-render";

export interface BoardSpec {
	rows: number; cols: number;
	mines: number[][];
	revealed?: number[][];
	revealStart?: number[] | null;
	flagged?: number[][];
	xray?: boolean;
}

export function buildPreviewModel(spec: BoardSpec) {
	const R = spec.rows, C = spec.cols;
	const isMine: boolean[][] = [];
	for (let r = 0; r < R; r++) isMine[r] = new Array(C).fill(false);
	for (const m of spec.mines || []) isMine[m[0]][m[1]] = true;
	const clue: number[][] = BoardLogic.buildClueGrid(R, C, (r: number, c: number) => isMine[r][c]);
	const cellAt = (r: number, c: number) => isMine[r][c] ? MINE : clue[r][c];
	const state: number[][] = [];
	for (let r = 0; r < R; r++) state[r] = new Array(C).fill(UNKNOWN);
	for (const cell of spec.revealed || []) state[cell[0]][cell[1]] = KNOWN;
	if (spec.revealStart) {
		BoardLogic.cascadeReveal(spec.revealStart[0], spec.revealStart[1], R, C,
			(r: number, c: number) => state[r][c] === UNKNOWN,
			(r: number, c: number) => { state[r][c] = KNOWN; return isMine[r][c]; },
			(r: number, c: number) => clue[r][c]);
	}
	for (const f of spec.flagged || []) state[f[0]][f[1]] = FLAGGED;
	return { isMine, clue, cellAt, state };
}

interface Props { spec: BoardSpec; skin?: string | null; cellPx?: number; className?: string; }

export default function PreviewBoard({ spec, skin, cellPx = 32, className }: Props) {
	const ref = useRef<HTMLCanvasElement>(null);
	useLayoutEffect(() => {
		const canvas = ref.current; if (!canvas) return;
		sizeCellCanvas(canvas, spec.cols, spec.rows, cellPx);
		const m = buildPreviewModel(spec);
		new BoardView(canvas, spec.rows, spec.cols, m.state, m.cellAt, { xray: spec.xray, skin: skin || null }).draw();
	}, [spec, skin, cellPx]);
	return <canvas ref={ref} className={className} aria-hidden="true" />;
}
