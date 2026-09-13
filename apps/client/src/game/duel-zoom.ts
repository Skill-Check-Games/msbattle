// The phone landscape duel zoom. Every round starts at the whole-board overview (every cell visible,
// cells tiny). The round's first tap zooms in on that cell (an animated zoom to ZOOMED_IN_CELL_PX);
// from then on the board is a free viewport: taps play at any zoom, one finger pans (the native
// scroller), two fingers pinch between the overview and ZOOMED_IN_CELL_PX. Both zooms follow the same
// rule: the picture is moved with a GPU-composited transform, and the canvas is laid out (repainted
// crisp) at its new cell size only once, at the end. The animated tap zoom lays out first and animates
// `scale` from an origin solved so the first frame matches what was on screen (see animateZoom); the
// pinch transforms live under the fingers and lays out on release (see attachPinchZoom). The board sits
// in a scroll area padded on every side (PlayPage sets the canvas margins), so it stays wherever a
// gesture left it and never snaps to the centre.
export const ZOOMED_IN_CELL_PX = 56;   // the ceiling: tapping single cells has to be accurate, and no closer is useful
export const ZOOM_DURATION_MS = 900;   // slow on purpose: this is a moment to watch, not react to
const rotated = () => document.body.classList.contains("duel-force-rotate");

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
	if (!scroller || !(a.fromCellPx > 0)) { onDone?.(); return () => {}; }
	// Jump the scroller to its one final, valid position: the target cell centred (clamped at the edges).
	const left = clamp((a.centerC + 0.5) * toCellPx + canvas.offsetLeft - scroller.clientWidth / 2, 0, Math.max(0, scroller.scrollWidth - scroller.clientWidth));
	const top = clamp((a.centerR + 0.5) * toCellPx + canvas.offsetTop - scroller.clientHeight / 2, 0, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
	scroller.scrollLeft = left; scroller.scrollTop = top;
	if (Math.abs(toCellPx - a.fromCellPx) < 0.5) { onDone?.(); return () => {}; }   // same size: only the centring (the round's end at the overview)
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

// A screen point as a point in an element's own layout box (CSS px from its top-left corner). On a
// force-rotated phone the whole layout is CSS-rotated 90 degrees, so the screen rect is the box turned
// on its side; the same undo as BoardSession.cellFromClient. Only valid while the element itself is untransformed.
export function localPoint(el: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
	const r = el.getBoundingClientRect();
	const sx = clientX - r.left, sy = clientY - r.top;
	return rotated() ? { x: sy, y: el.offsetHeight - sx } : { x: sx, y: sy };
}
export const clearZoomTransform = (canvas: HTMLCanvasElement) => { canvas.style.transform = ""; canvas.style.transformOrigin = ""; canvas.style.willChange = ""; };

// What a finished pinch asks the page to do: lay the board out at `cellPx` and scroll so that the board
// point at fraction (fx, fy) sits at (mx, my) of the scroller's box, where the fingers left it. Until that
// has happened the canvas keeps the gesture's transform, so nothing flashes.
export interface PinchCommit { cellPx: number; fx: number; fy: number; mx: number; my: number; }
export interface PinchOptions {
	canvas: () => HTMLCanvasElement | null;
	cellPxNow: (canvas: HTMLCanvasElement) => number;   // the cell size the canvas is laid out at right now
	overviewPx: () => number;          // the whole-board fit: the floor of the pinch
	maxPx: number;                     // the ceiling (ZOOMED_IN_CELL_PX)
	blocked: () => boolean;            // no pinch while it returns true (before GO)
	onStart: () => void;               // a pinch is beginning: stop any running zoom animation
	onCommit: (c: PinchCommit) => void;
}

// Two fingers anywhere in the host (the board card) zoom the board. During the gesture the canvas gets
// `translate(t) scale(s)` around the board point that was under the fingers' midpoint: that point follows
// the midpoint, the scale follows the fingers' distance (clamped to the overview..max range). On release
// the page lays the board out at the new size and scrolls the anchored point back under where the
// midpoint ended, then drops the transform: the picture never jumps, it only turns crisp.
export function attachPinchZoom(host: HTMLElement, o: PinchOptions): () => void {
	let pinch: { ids: [number, number]; d0: number; px0: number; fx: number; fy: number; mx0: number; my0: number; mx: number; my: number; scale: number; minS: number; maxS: number } | null = null;
	const find = (e: TouchEvent, id: number) => { for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === id) return e.touches[i]; return null; };
	const begin = (e: TouchEvent) => {
		const canvas = o.canvas(); if (!canvas || o.blocked() || !canvas.offsetWidth) return;
		const a = e.touches[0], b = e.touches[1];
		o.onStart();
		const mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
		const m = localPoint(canvas, mx, my);
		const fx = clamp(m.x / canvas.offsetWidth, 0, 1), fy = clamp(m.y / canvas.offsetHeight, 0, 1);
		const cell = o.cellPxNow(canvas), ov = o.overviewPx();
		pinch = { ids: [a.identifier, b.identifier], d0: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1, px0: cell, fx, fy, mx0: mx, my0: my, mx, my, scale: 1, minS: Math.min(ov, cell) / cell, maxS: Math.max(o.maxPx, cell) / cell };
		canvas.style.transformOrigin = `${fx * canvas.offsetWidth}px ${fy * canvas.offsetHeight}px`;
		canvas.style.willChange = "transform";
	};
	const start = (e: TouchEvent) => { if (!pinch && e.touches.length === 2) begin(e); };
	const move = (e: TouchEvent) => {
		if (!pinch) { if (e.touches.length === 2) begin(e); return; }   // the second finger may have landed outside the host: the event still carries every touch
		const a = find(e, pinch.ids[0]), b = find(e, pinch.ids[1]); if (!a || !b) return;
		e.preventDefault();
		const canvas = o.canvas(); if (!canvas) return;
		pinch.scale = clamp(Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) / pinch.d0, pinch.minS, pinch.maxS);
		pinch.mx = (a.clientX + b.clientX) / 2; pinch.my = (a.clientY + b.clientY) / 2;
		let dx = pinch.mx - pinch.mx0, dy = pinch.my - pinch.my0;
		if (rotated()) { const lx = dy, ly = -dx; dx = lx; dy = ly; }   // screen axes to board axes
		canvas.style.transform = `translate(${dx}px, ${dy}px) scale(${pinch.scale})`;
	};
	const end = (e: TouchEvent) => {
		if (!pinch || (find(e, pinch.ids[0]) && find(e, pinch.ids[1]))) return;   // both pinch fingers still down: some other touch lifted
		const p = pinch; pinch = null;
		const canvas = o.canvas(), scroller = canvas && canvas.parentElement; if (!canvas || !scroller) return;
		const m = localPoint(scroller, p.mx, p.my);
		o.onCommit({ cellPx: p.px0 * p.scale, fx: p.fx, fy: p.fy, mx: m.x, my: m.y });
	};
	host.addEventListener("touchstart", start, { passive: true });
	host.addEventListener("touchmove", move, { passive: false });
	host.addEventListener("touchend", end); host.addEventListener("touchcancel", end);
	return () => { host.removeEventListener("touchstart", start); host.removeEventListener("touchmove", move); host.removeEventListener("touchend", end); host.removeEventListener("touchcancel", end); };
}

// Phone landscape: one finger anywhere in the board card pans the board, in JS (the section has touch-action
// none, so the browser never scrolls it and never competes with the pinch), with a short glide after release.
// blocked: while it returns true (before GO) no pan starts, so the board stays put with everything else.
const GLIDE_DECAY = 0.94, GLIDE_STOP = 0.03;   // per 16ms frame; px per ms
export function attachPanAnywhere(host: HTMLElement, getScroller: () => HTMLElement | null, blocked?: () => boolean): () => void {
	const TOL = 6;
	let pan: { id: number; lastX: number; lastY: number; startX: number; startY: number; moved: boolean; vx: number; vy: number; at: number } | null = null;
	let glide = 0;
	const stopGlide = () => { if (glide) { cancelAnimationFrame(glide); glide = 0; } };
	const toBoard = (dx: number, dy: number) => rotated() ? { dx: dy, dy: -dx } : { dx, dy };   // screen axes to board axes
	const start = (e: TouchEvent) => {
		stopGlide(); pan = null;
		const sc = getScroller();
		if (e.touches.length !== 1 || !sc || (blocked && blocked())) return;
		const t = e.touches[0]; pan = { id: t.identifier, startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastY: t.clientY, moved: false, vx: 0, vy: 0, at: performance.now() };
	};
	const move = (e: TouchEvent) => {
		const sc = getScroller(); if (!pan || e.touches.length !== 1 || !sc) return;
		const t = e.touches[0]; if (t.identifier !== pan.id) return;
		if (!pan.moved) { if (Math.abs(t.clientX - pan.startX) < TOL && Math.abs(t.clientY - pan.startY) < TOL) return; pan.moved = true; }   // below tolerance a tap on a button or cell still fires
		e.preventDefault();
		const d = toBoard(t.clientX - pan.lastX, t.clientY - pan.lastY), now = performance.now(), dt = Math.max(1, now - pan.at);
		sc.scrollLeft -= d.dx; sc.scrollTop -= d.dy;
		pan.vx = 0.6 * pan.vx + 0.4 * (-d.dx / dt); pan.vy = 0.6 * pan.vy + 0.4 * (-d.dy / dt);   // smoothed, in scroll px per ms
		pan.lastX = t.clientX; pan.lastY = t.clientY; pan.at = now;
	};
	const end = (e: TouchEvent) => {
		const p = pan; if (!p) return;
		if (e.touches.length) return;   // another finger is still down (a pinch is taking over)
		pan = null;
		const sc = getScroller(); if (!sc || !p.moved || performance.now() - p.at > 80) return;   // a finger that stopped before lifting does not glide
		let vx = p.vx, vy = p.vy, last = performance.now();
		const frame = (now: number) => {
			if (blocked && blocked()) { glide = 0; return; }   // the board got held mid-glide (the round ended): stop where it is, the page takes over
			const dt = now - last; last = now;
			sc.scrollLeft += vx * dt; sc.scrollTop += vy * dt;
			const k = Math.pow(GLIDE_DECAY, dt / 16); vx *= k; vy *= k;
			glide = Math.abs(vx) > GLIDE_STOP || Math.abs(vy) > GLIDE_STOP ? requestAnimationFrame(frame) : 0;
		};
		glide = requestAnimationFrame(frame);
	};
	host.addEventListener("touchstart", start, { passive: true });
	host.addEventListener("touchmove", move, { passive: false });
	host.addEventListener("touchend", end); host.addEventListener("touchcancel", end);
	return () => { stopGlide(); host.removeEventListener("touchstart", start); host.removeEventListener("touchmove", move); host.removeEventListener("touchend", end); host.removeEventListener("touchcancel", end); };
}
