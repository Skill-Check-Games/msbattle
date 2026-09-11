// How big a cell should be for the space available: the board fits the container's width and the
// viewport's remaining height on desktop (clamped between a readable minimum and a cap), and on
// portrait phones fills the width with whole columns and pans for the rest.
import { useEffect, useState, RefObject } from "react";
import { SHAKE_PAD_X, SHAKE_PAD_Y } from "./GameBoard";

export const DESKTOP_CELL_MIN = 22;
export const DESKTOP_CELL_MAX = 54;
export const PLAYER_CELL = 34;
export const MOBILE_PLAYER_CELL = 30;

export function isMobileLayout(): boolean { return window.matchMedia("(max-width: 700px)").matches; }

export interface CellPxOptions { rows: number; cols: number; maxCell?: number; minCell?: number; bottomGap?: number; chrome?: number; desktopFit?: boolean; topOffset?: number; reserve?: number; share?: number; fitBox?: string; gutterX?: number; }  // gutterX: the scroller's horizontal padding when a layout overrides the default shake gutter  // fitBox: a selector inside the container for a fixed-size box the board must fit (the phone landscape scroller), measured directly  // reserve/share: the container holds `share` boards side by side after `reserve` px of other columns  // chrome: the board card's padding + border around the canvas; desktopFit: skip the portrait-phone fit (landscape phones, force-rotated ones included); topOffset: fixed height above the board (instead of measuring the canvas, which moves when the board is centred)

export function fitCellPx(container: HTMLElement | null, canvas: HTMLElement | null, o: CellPxOptions): number {
	if (!o.rows || !o.cols) return PLAYER_CELL;
	if (isMobileLayout() && !o.desktopFit) {
		// The container's own padding is not board space: measure its content box.
		const cs = container ? getComputedStyle(container) : null;
		const inner = container ? container.clientWidth - (parseFloat(cs!.paddingLeft) || 0) - (parseFloat(cs!.paddingRight) || 0) : window.innerWidth - 24;
		const availW = inner - (o.gutterX ?? SHAKE_PAD_X) * 2;
		const fitCols = Math.max(1, Math.floor(availW / MOBILE_PLAYER_CELL));
		const visibleCols = Math.min(o.cols, fitCols);
		return Math.max(1, Math.floor(availW / visibleCols));
	}
	let availW: number, availH: number;
	const box = o.fitBox && container ? container.querySelector<HTMLElement>(o.fitBox) : null;
	if (box) { availW = box.clientWidth - SHAKE_PAD_X * 2; availH = box.clientHeight - SHAKE_PAD_Y * 2; }
	else {
		availW = container ? (container.clientWidth - (o.reserve ?? 0)) / (o.share ?? 1) - (o.chrome ?? 42) - SHAKE_PAD_X * 2 : 0;
		const top = o.topOffset != null ? o.topOffset : canvas ? canvas.getBoundingClientRect().top : 120;
		availH = window.innerHeight - top - (o.bottomGap ?? 24);
	}
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
	}, [containerRef, o.rows, o.cols, o.maxCell, o.minCell, o.chrome, o.desktopFit, o.topOffset, o.reserve, o.share, o.fitBox, o.gutterX]);
	return px;
}
