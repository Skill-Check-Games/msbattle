// Pointer, touch and keyboard input for a BoardSession's canvas. Mouse: left reveals, right flags.
// Touch: tap does the current tool (flagMode), long press flags, movement past a tolerance cancels
// (the board may be panning). Keyboard: the rebindable bindings move a focus cursor and act on it.
import { BoardSession } from "./board-session";
import { keybindings } from "../shared/keybindings";

const LONG_PRESS_MS = 320;
const TOUCH_MOVE_TOLERANCE = 12;

export interface InputOptions {
	flagMode: () => boolean;                      // touch tap tool: reveal (false) or flag (true)
	onTap?: (x: number, y: number, changed: boolean) => void;   // after a tap or click acted (duel zoom gestures)
	interceptTap?: (x: number, y: number) => boolean;           // return true to swallow the tap (zoomed-out overview)
}

export function attachBoardInput(session: BoardSession, canvas: HTMLCanvasElement, opts: InputOptions): () => void {
	let lastTouchAt = 0, touchStartX = 0, touchStartY = 0, touchMoved = false, longPressFired = false;
	let longPressTimer: number | null = null;
	const cancelLongPress = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
	const isLeft = (e: MouseEvent) => e.button === 0;
	const isRight = (e: MouseEvent) => e.button === 2;

	const actAt = (x: number, y: number, asFlag: boolean): boolean => {
		const cell = session.cellFromClient(x, y);
		if (!cell) return false;
		session.focusVisible = false;
		return session.performAction(cell.r, cell.c, asFlag);
	};
	const onClick = (e: MouseEvent) => {
		if (Date.now() - lastTouchAt < 500) return;
		if (opts.interceptTap && opts.interceptTap(e.clientX, e.clientY)) return;
		const changed = isLeft(e) ? actAt(e.clientX, e.clientY, false) : isRight(e) ? actAt(e.clientX, e.clientY, true) : false;
		opts.onTap?.(e.clientX, e.clientY, changed);
	};
	const onContextMenu = (e: MouseEvent) => {
		e.preventDefault();
		if (Date.now() - lastTouchAt < 600) return;
		actAt(e.clientX, e.clientY, true);
	};
	const onTouchStart = (e: TouchEvent) => {
		lastTouchAt = Date.now();
		if (e.touches.length !== 1) { cancelLongPress(); session.setPressed(null); return; }
		const t = e.touches[0];
		touchStartX = t.clientX; touchStartY = t.clientY; touchMoved = false; longPressFired = false;
		session.setPressed(session.cellFromClient(t.clientX, t.clientY));
		cancelLongPress();
		if (opts.interceptTap && opts.interceptTap(touchStartX, touchStartY)) return; // no long press while zoomed out
		longPressTimer = window.setTimeout(() => {
			longPressTimer = null;
			if (touchMoved) return;
			longPressFired = true;
			session.setPressed(null);
			actAt(touchStartX, touchStartY, true);
			if (navigator.vibrate) navigator.vibrate(15);
		}, LONG_PRESS_MS);
	};
	const onTouchMove = (e: TouchEvent) => {
		lastTouchAt = Date.now();
		if (e.touches.length !== 1) return;
		const t = e.touches[0];
		if (Math.abs(t.clientX - touchStartX) > TOUCH_MOVE_TOLERANCE || Math.abs(t.clientY - touchStartY) > TOUCH_MOVE_TOLERANCE) {
			touchMoved = true; cancelLongPress(); session.setPressed(null);
		}
	};
	const onTouchEnd = (e: TouchEvent) => {
		lastTouchAt = Date.now();
		cancelLongPress();
		session.setPressed(null);
		e.preventDefault();
		if (longPressFired || touchMoved) return;
		if (opts.interceptTap && opts.interceptTap(touchStartX, touchStartY)) return;
		const changed = actAt(touchStartX, touchStartY, opts.flagMode());
		opts.onTap?.(touchStartX, touchStartY, changed);
	};
	const onTouchCancel = () => { cancelLongPress(); touchMoved = true; session.setPressed(null); };

	canvas.addEventListener("click", onClick);
	canvas.addEventListener("contextmenu", onContextMenu);
	canvas.addEventListener("touchstart", onTouchStart, { passive: true });
	canvas.addEventListener("touchmove", onTouchMove, { passive: true });
	canvas.addEventListener("touchend", onTouchEnd, { passive: false });
	canvas.addEventListener("touchcancel", onTouchCancel);
	return () => {
		cancelLongPress();
		canvas.removeEventListener("click", onClick);
		canvas.removeEventListener("contextmenu", onContextMenu);
		canvas.removeEventListener("touchstart", onTouchStart);
		canvas.removeEventListener("touchmove", onTouchMove);
		canvas.removeEventListener("touchend", onTouchEnd);
		canvas.removeEventListener("touchcancel", onTouchCancel);
	};
}

// Document-level keyboard control for the one live session. Ignored while typing in a field or
// inside a keyboard-driven button group (.kbd-btn-group), and with modifier keys held.
export function attachBoardKeyboard(session: BoardSession): () => void {
	const onKey = (e: KeyboardEvent) => {
		if (!session.hooks.mode()) return;
		const tag = (e.target as HTMLElement | null)?.tagName || "";
		if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
		if ((e.target as HTMLElement | null)?.closest?.(".kbd-btn-group")) return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const action = keybindings.actionFor(e);
		if (!action) return;
		const skip = e.shiftKey;
		let moved = false;
		if (action === "up") moved = session.stepFocus(-1, 0, skip);
		else if (action === "down") moved = session.stepFocus(1, 0, skip);
		else if (action === "left") moved = session.stepFocus(0, -1, skip);
		else if (action === "right") moved = session.stepFocus(0, 1, skip);
		else if (action === "next") { e.preventDefault(); moved = session.jumpToNextUnknown(!e.shiftKey); }
		else if (action === "reveal") { e.preventDefault(); if (e.repeat) return; session.focusVisible = true; session.performAction(session.focusedR, session.focusedC, false); return; }
		else if (action === "flag") { e.preventDefault(); if (e.repeat) return; session.focusVisible = true; session.performAction(session.focusedR, session.focusedC, true); return; }
		else return;
		e.preventDefault();
		session.focusVisible = true;
		session.updateFocusOverlay();
		void moved;
	};
	document.addEventListener("keydown", onKey);
	return () => document.removeEventListener("keydown", onKey);
}
