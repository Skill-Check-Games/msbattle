// Board canvases and chip rows shared by the analyzer admin pages (starting positions, deduction
// patterns, start patterns). Every canvas is drawn once with the live board renderer so the cells
// look the same as in a game; forced-safe cells get the green check marker on top.
import { useLayoutEffect, useRef, ReactNode } from "react";
import { BoardView, MINE, UNKNOWN, KNOWN, FLAGGED, sizeCellCanvas } from "../../game/board-render";
import styles from "./admin-boards.module.scss";

export { styles as boardStyles };

// Analyzer rating (complexity of the first move) to a tier for the badge tint.
export function ratingTier(rating: number): "case" | "intersect-hard" | "intersect" | "subset" | "trivial" {
	if (rating >= 1800) return "case";
	if (rating >= 1500) return "intersect-hard";
	if (rating >= 1000) return "intersect";
	if (rating >= 200) return "subset";
	return "trivial";
}
const TIER_CLASS: Record<string, string> = {
	trivial: styles.tierTrivial, subset: styles.tierSubset, intersect: styles.tierIntersect, "intersect-hard": styles.tierIntersectHard, case: styles.tierCase
};
export function RatingBadge({ rating }: { rating: number }) {
	return <span className={`${styles.rating} ${TIER_CLASS[ratingTier(rating)]}`}>{rating}</span>;
}

const METHOD_CLASS: Record<string, string> = {
	trivial: styles.tagGreen, subset: styles.tagCyan, intersect: styles.tagAmber, union: styles.tagOrange, case: styles.tagPurple, enum: styles.tagRed
};
export function MethodTag({ method }: { method: string }) {
	return <span className={`${styles.tag} ${METHOD_CLASS[method] || ""}`}>{method}</span>;
}
const ACTION_CLASS: Record<string, string> = { reveal: styles.tagGreen, flag: styles.tagRed, mixed: styles.tagAmber, case: styles.tagPurple };
export function ActionTag({ action }: { action: string }) {
	return <span className={`${styles.tag} ${ACTION_CLASS[action] || ""}`}>{action}</span>;
}

// A labelled row of toggle chips; `value` null matches the option whose key is null ("Any").
export interface ChipOption<K> { key: K; label: string; className?: string; }
export function ChipRow<K>({ label, options, value, onChange }: { label: ReactNode; options: ChipOption<K>[]; value: K; onChange: (k: K) => void }) {
	return (
		<div className={styles.filter}>
			<span className={styles.filterLabel}>{label}</span>
			{options.map(o => (
				<button key={String(o.key)} type="button" className={`${styles.chip} ${o.key === value ? styles.chipActive : ""} ${o.className || ""}`} onClick={() => onChange(o.key)}>{o.label}</button>
			))}
		</div>
	);
}

// ---- pattern canvas ----
// A deduction pattern on its tight bounding box: clue cells revealed, deduced mines flagged, deduced
// safe cells checked, ambiguous covered cells plain. Cells outside the pattern are transparent; wall
// cells (board edge) are solid dark tiles.
export interface PatternCells { clues?: number[][]; deduced?: (number | string)[][]; covered?: (number | string)[][]; walls?: (number | string)[][]; }
export const PATTERN_CELL_PX = 36;

export function PatternCanvas({ width, height, cells, cellPx = PATTERN_CELL_PX }: { width: number; height: number; cells: PatternCells; cellPx?: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useLayoutEffect(() => {
		const canvas = ref.current; if (!canvas) return;
		const R = height, C = width;
		sizeCellCanvas(canvas, C, R, cellPx);
		const inPattern: boolean[][] = [], state: number[][] = [], isMine: boolean[][] = [], clue: number[][] = [], isWall: boolean[][] = [];
		for (let r = 0; r < R; r++) {
			inPattern.push(new Array(C).fill(false)); state.push(new Array(C).fill(UNKNOWN));
			isMine.push(new Array(C).fill(false)); clue.push(new Array(C).fill(0)); isWall.push(new Array(C).fill(false));
		}
		const inside = (r: number, c: number) => r >= 0 && r < R && c >= 0 && c < C;
		const safeCells: number[][] = [];
		for (const w of cells.walls || []) { const r = +w[0], c = +w[1]; if (inside(r, c)) isWall[r][c] = true; }
		for (const k of cells.covered || []) { const r = +k[0], c = +k[1]; if (inside(r, c)) inPattern[r][c] = true; }
		for (const k of cells.clues || []) { const r = k[0], c = k[1]; if (!inside(r, c)) continue; state[r][c] = KNOWN; clue[r][c] = k[2]; inPattern[r][c] = true; }
		for (const d of cells.deduced || []) {
			const r = +d[0], c = +d[1]; if (!inside(r, c)) continue;
			inPattern[r][c] = true;
			if (d[2] === "M") { state[r][c] = FLAGGED; isMine[r][c] = true; } else safeCells.push([r, c]);
		}
		const bv = new BoardView(canvas, R, C, state, (r, c) => isMine[r][c] ? MINE : clue[r][c], { includeCell: (r, c) => inPattern[r][c] });
		bv.underlay((ctx, sw, sh) => {
			const gap = Math.max(1, Math.round(Math.min(sw, sh) * 0.08));
			ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
			for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (isWall[r][c]) ctx.fillRect(c * sw + gap / 2, r * sh + gap / 2, sw - gap, sh - gap);
		});
		bv.markSafe(safeCells);
		bv.draw();
	}, [width, height, cells, cellPx]);
	return <canvas ref={ref} className={styles.canvas} aria-hidden="true" />;
}

// ---- starting position canvas ----
export interface StartingPos {
	id: number; size?: number; variant?: string; pattern: string; rating: number; first_action: string;
	solutions: number; forced_safe: number; forced_mine: number; forced_safe_mask?: number; forced_mine_mask?: number;
	max_complexity?: number | null; total_complexity?: number | null;
}
export const STARTING_POS_CELL_PX = 28;

// Outer-ring cell index (0..15) for the 3x3 family on a 5x5 board, matching the brute-force masks:
// 0..4 row 0, 5..7 col 0 rows 1..3, 8..10 col 4 rows 1..3, 11..15 row 4.
function outsideIndex(r: number, c: number) {
	if (r === 0) return c;
	if (r === 4) return 11 + c;
	if (c === 0) return 5 + (r - 1);
	if (c === 4) return 8 + (r - 1);
	return -1;
}
// Ring index for the 4x4 corner-mine family on a 6x6 board: row-major over every cell outside the
// inner 4x4 (rows/cols 1..4), matching the generator's mask ordering.
function cornerOutsideIndex(r: number, c: number) {
	if (r === 0) return c;
	if (r === 5) return 14 + c;
	if (c === 0) return 6 + (r - 1) * 2;
	if (c === 5) return 6 + (r - 1) * 2 + 1;
	return -1;
}

function paintStartingPos(canvas: HTMLCanvasElement, pos: StartingPos) {
	const corner = pos.variant === "corner4";
	const N = corner ? 6 : 5;
	const state: number[][] = [], isMine: boolean[][] = [], clue: number[][] = [];
	for (let i = 0; i < N; i++) { state.push(new Array(N).fill(UNKNOWN)); isMine.push(new Array(N).fill(false)); clue.push(new Array(N).fill(0)); }
	const tokens = pos.pattern.split(".");
	if (corner) {
		// 16 row-major tokens over the inner 4x4; "M" is the corner mine, drawn as a flag since the solver deduces it.
		let k = 0;
		for (let r = 1; r <= 4; r++) for (let c = 1; c <= 4; c++) {
			const tok = tokens[k++];
			if (tok === "M") { state[r][c] = FLAGGED; isMine[r][c] = true; }
			else { state[r][c] = KNOWN; clue[r][c] = parseInt(tok, 10) || 0; }
		}
	} else {
		// Eight boundary clues clockwise from (1,1); the centre is the 0 that opened the cascade.
		const clues = tokens.map(x => parseInt(x, 10));
		const boundary: Record<string, number> = { "1,1": clues[0], "1,2": clues[1], "1,3": clues[2], "2,3": clues[3], "3,3": clues[4], "3,2": clues[5], "3,1": clues[6], "2,1": clues[7] };
		for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) { state[r][c] = KNOWN; clue[r][c] = (r === 2 && c === 2) ? 0 : boundary[r + "," + c]; }
	}
	const ringIndex = corner ? cornerOutsideIndex : outsideIndex;
	const safeMask = pos.forced_safe_mask || 0, mineMask = pos.forced_mine_mask || 0;
	const safeCells: number[][] = [];
	for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
		const idx = ringIndex(r, c); if (idx < 0) continue;
		if (mineMask & (1 << idx)) { state[r][c] = FLAGGED; isMine[r][c] = true; }
		else if (safeMask & (1 << idx)) safeCells.push([r, c]);
	}
	new BoardView(canvas, N, N, state, (r, c) => isMine[r][c] ? MINE : clue[r][c]).markSafe(safeCells).draw();
}

export function StartingPosCanvas({ pos, cellPx = STARTING_POS_CELL_PX }: { pos: StartingPos; cellPx?: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useLayoutEffect(() => {
		const canvas = ref.current; if (!canvas) return;
		const N = pos.variant === "corner4" ? 6 : (pos.size || 3) + 2;
		sizeCellCanvas(canvas, N, N, cellPx);
		paintStartingPos(canvas, pos);
	}, [pos, cellPx]);
	return <canvas ref={ref} className={styles.canvas} aria-hidden="true" />;
}
