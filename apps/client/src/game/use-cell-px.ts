// How big a cell should be for the space available: the board fits the container's width and the
// viewport's remaining height on desktop (clamped between a readable minimum and a cap), and on
// portrait phones fills the width with whole columns and pans for the rest.
import { useEffect, useState, RefObject } from "react";

export const DESKTOP_CELL_MIN = 22;
export const DESKTOP_CELL_MAX = 54;
export const PLAYER_CELL = 34;
export const MOBILE_PLAYER_CELL = 30;

export function isMobileLayout(): boolean { return window.matchMedia("(max-width: 700px)").matches; }

export interface CellPxOptions { rows: number; cols: number; maxCell?: number; minCell?: number; bottomGap?: number; chrome?: number; }  // chrome: the board card's padding + border around the canvas

export function fitCellPx(container: HTMLElement | null, canvas: HTMLElement | null, o: CellPxOptions): number {
	if (!o.rows || !o.cols) return PLAYER_CELL;
	if (isMobileLayout()) {
		const availW = container ? container.clientWidth : window.innerWidth - 24;
		const fitCols = Math.max(1, Math.floor(availW / MOBILE_PLAYER_CELL));
		const visibleCols = Math.min(o.cols, fitCols);
		return Math.max(1, Math.floor(availW / visibleCols));
	}
	let availW = container ? container.clientWidth - (o.chrome ?? 42) : 0;
	const top = canvas ? canvas.getBoundingClientRect().top : 120;
	let availH = window.innerHeight - top - (o.bottomGap ?? 24);
	if (!(availW > 0)) availW = o.cols * PLAYER_CELL;
	if (!(availH > 0)) availH = o.rows * PLAYER_CELL;
	const cell = Math.floor(Math.min(availW / o.cols, availH / o.rows));
	return Math.max(o.minCell ?? DESKTOP_CELL_MIN, Math.min(o.maxCell ?? DESKTOP_CELL_MAX, cell));
}

// Recomputes on mount, on board size change and on window resize.
export function useCellPx(containerRef: RefObject<HTMLElement>, o: CellPxOptions): number {
	const [px, setPx] = useState(PLAYER_CELL);
	useEffect(() => {
		const compute = () => setPx(fitCellPx(containerRef.current, containerRef.current?.querySelector("canvas") || null, o));
		compute();
		window.addEventListener("resize", compute);
		return () => window.removeEventListener("resize", compute);
	}, [containerRef, o.rows, o.cols, o.maxCell, o.minCell, o.chrome]);
	return px;
}
