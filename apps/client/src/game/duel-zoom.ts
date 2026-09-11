// The phone landscape duel zoom: the board sits at a whole-board overview (every cell visible, cells
// tiny) until the player taps where they want to play, which zooms in on that cell; a double tap that
// changes nothing zooms back out. The zoom itself is a GPU-composited transform: the canvas has already
// been laid out at its final size, the scroller jumps straight to the final centred position, and only
// `scale` animates around a transform-origin solved so that the first frame is pixel-identical to what
// was on screen the instant before (see the origin formula below), so nothing ever jumps.
export const ZOOMED_IN_CELL_PX = 56;   // the floor while playing zoomed in: tapping single cells has to be accurate
export const ZOOM_DURATION_MS = 900;   // slow on purpose: this is a moment to watch, not react to

export interface ZoomAnchor { fromCellPx: number; centerR: number; centerC: number; gapLeftPre: number; gapTopPre: number; }

// Everything the animation needs about the moment before the resize: the cell size the board is at, and
// the canvas's on-screen offset inside its scroller (the resize and the scroll jump both move it).
export function measureZoomStart(canvas: HTMLCanvasElement, cols: number, centerR: number, centerC: number): ZoomAnchor | null {
	const scroller = canvas.parentElement; if (!scroller) return null;
	const fromCellPx = canvas.clientWidth / cols; if (!(fromCellPx > 0)) return null;
	const a = canvas.getBoundingClientRect(), b = scroller.getBoundingClientRect();
	return { fromCellPx, centerR, centerC, gapLeftPre: a.left - b.left, gapTopPre: a.top - b.top };
}

// The cell currently in the middle of the scroller's viewport (the natural anchor for a zoom-out).
export function viewportCenterCell(canvas: HTMLCanvasElement, rows: number, cols: number): { r: number; c: number } {
	const scroller = canvas.parentElement!;
	const cellPx = canvas.clientWidth / cols;
	const c = (scroller.scrollLeft + scroller.clientWidth / 2 - canvas.offsetLeft) / cellPx - 0.5;
	const r = (scroller.scrollTop + scroller.clientHeight / 2 - canvas.offsetTop) / cellPx - 0.5;
	return { r: Math.max(0, Math.min(rows - 1, r)), c: Math.max(0, Math.min(cols - 1, c)) };
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Call once the canvas has been laid out at its new size. Returns a cancel function.
export function animateZoom(canvas: HTMLCanvasElement, rows: number, cols: number, a: ZoomAnchor, onDone?: () => void): () => void {
	const scroller = canvas.parentElement;
	const toCellPx = canvas.clientWidth / cols;
	if (!scroller || !(a.fromCellPx > 0) || Math.abs(toCellPx - a.fromCellPx) < 0.5) { onDone?.(); return () => {}; }
	// Jump the scroller to its one final, valid position: the target cell centred (clamped at the edges).
	const left = clamp((a.centerC + 0.5) * toCellPx + canvas.offsetLeft - scroller.clientWidth / 2, 0, Math.max(0, scroller.scrollWidth - scroller.clientWidth));
	const top = clamp((a.centerR + 0.5) * toCellPx + canvas.offsetTop - scroller.clientHeight / 2, 0, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
	scroller.scrollLeft = left; scroller.scrollTop = top;
	// The on-screen x of canvas-local 0 after the jump is (offsetLeft - left) + Ox * (1 - scale); requiring it
	// to equal the pre-resize position gapLeftPre at the start scale gives the origin that makes frame 0 match.
	const startScale = a.fromCellPx / toCellPx, denom = 1 - startScale;
	const originX = (left + a.gapLeftPre - canvas.offsetLeft) / denom, originY = (top + a.gapTopPre - canvas.offsetTop) / denom;
	canvas.style.transformOrigin = `${originX}px ${originY}px`;
	canvas.style.willChange = "transform";
	canvas.style.transform = `scale(${startScale})`;   // set synchronously, so the first paint after the resize is already the start frame
	let raf = 0, t0 = 0;
	const clear = () => { canvas.style.transform = ""; canvas.style.transformOrigin = ""; canvas.style.willChange = ""; };
	const frame = (now: number) => {
		if (!t0) t0 = now;
		const t = Math.min(1, (now - t0) / ZOOM_DURATION_MS);
		canvas.style.transform = `scale(${startScale + (1 - startScale) * easeInOutCubic(t)})`;
		if (t < 1) { raf = requestAnimationFrame(frame); return; }
		clear(); raf = 0; onDone?.();
	};
	raf = requestAnimationFrame(frame);
	return () => { if (raf) { cancelAnimationFrame(raf); raf = 0; clear(); } };
}

// A double tap (or double click) that changed nothing on either tap: the "I'm done here" gesture that
// zooms back out. Every tap still acts immediately; the zoom-out is decided after the fact, so ordinary
// fast play near the same spot is never mistaken for it.
const DOUBLE_TAP_MS = 350, DOUBLE_TAP_TOLERANCE = 40;
export class DoubleTapTracker {
	private at = 0; private x = 0; private y = 0; private changed = false;
	// Returns true when this tap completes a pair in which neither tap changed the board.
	tap(x: number, y: number, changed: boolean): boolean {
		const pair = Date.now() - this.at < DOUBLE_TAP_MS && Math.abs(x - this.x) < DOUBLE_TAP_TOLERANCE && Math.abs(y - this.y) < DOUBLE_TAP_TOLERANCE;
		const fire = pair && !changed && !this.changed;
		this.at = pair ? 0 : Date.now();   // a pair is consumed: a third quick tap starts a fresh pair
		this.x = x; this.y = y; this.changed = changed;
		return fire;
	}
}

// Phone landscape: a drag that starts anywhere in the board card (not only on the canvas) pans the board.
// The scroller's native panning only engages for touches that start inside it, and a thumb that lands a
// few px off the canvas is an easy miss. Touches starting on the scroller are left to it.
// blocked: while it returns true (a mine penalty) no pan starts, so the board stays put with everything else.
export function attachPanAnywhere(host: HTMLElement, getScroller: () => HTMLElement | null, blocked?: () => boolean): () => void {
	const TOL = 10;
	let pan: { lastX: number; lastY: number; startX: number; startY: number; moved: boolean } | null = null;
	const start = (e: TouchEvent) => {
		pan = null;
		const sc = getScroller();
		if (e.touches.length !== 1 || !sc || sc.contains(e.target as Node) || (blocked && blocked())) return;
		const t = e.touches[0]; pan = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastY: t.clientY, moved: false };
	};
	const move = (e: TouchEvent) => {
		const sc = getScroller(); if (!pan || e.touches.length !== 1 || !sc) return;
		const t = e.touches[0];
		if (!pan.moved) { if (Math.abs(t.clientX - pan.startX) < TOL && Math.abs(t.clientY - pan.startY) < TOL) return; pan.moved = true; }   // below tolerance a tap on a button still fires
		e.preventDefault();
		let dx = t.clientX - pan.lastX, dy = t.clientY - pan.lastY;
		if (document.body.classList.contains("duel-force-rotate")) { const lx = dy, ly = -dx; dx = lx; dy = ly; }   // the layout is rotated 90 degrees: screen axes to board axes
		sc.scrollLeft -= dx; sc.scrollTop -= dy;
		pan.lastX = t.clientX; pan.lastY = t.clientY;
	};
	const end = () => { pan = null; };
	host.addEventListener("touchstart", start, { passive: true });
	host.addEventListener("touchmove", move, { passive: false });
	host.addEventListener("touchend", end); host.addEventListener("touchcancel", end);
	return () => { host.removeEventListener("touchstart", start); host.removeEventListener("touchmove", move); host.removeEventListener("touchend", end); host.removeEventListener("touchcancel", end); };
}
