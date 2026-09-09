// Fullscreen for games. Desktop: opt-in (Settings). Phones: forced for the 1v1 duel, which is built
// around the space the browser chrome would eat, plus a landscape lock where the API exists (not
// iOS Safari, which has neither; it stays windowed there). Must be called from a click handler.
const AUTO_KEY = "ms_auto_fullscreen";
export const isInFullscreen = () => !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
export const isMobileViewport = () => window.matchMedia("(max-width: 700px)").matches;
export const phoneSizedDevice = () => ("ontouchstart" in window || navigator.maxTouchPoints > 0) && Math.min(screen.width || 0, screen.height || 0) <= 500;
export const autoFullscreenEnabled = () => { try { return localStorage.getItem(AUTO_KEY) === "1"; } catch { return false; } };
export const setAutoFullscreenEnabled = (on: boolean) => { try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* storage blocked */ } };
export const fullscreenSupported = () => { const el = document.documentElement as any; return !!(el.requestFullscreen || el.webkitRequestFullscreen); };

export function enterGameFullscreen(force = false, lockLandscape = force) {
	try {
		if (isMobileViewport() && !force) return;
		if (isInFullscreen()) return;
		const el = document.documentElement as any;
		const req = el.requestFullscreen || el.webkitRequestFullscreen;
		if (!req) return;
		const r = req.call(el);
		if (r && typeof r.then === "function") r.then(() => { if (lockLandscape) tryLockLandscape(); }).catch(() => {});
		else if (lockLandscape) tryLockLandscape();
	} catch { /* blocked or unsupported */ }
}
export function tryLockLandscape() {
	try { const o = (screen as any).orientation; if (o && typeof o.lock === "function") { const p = o.lock("landscape"); if (p && p.catch) p.catch(() => {}); } } catch { /* unsupported */ }
}
export function exitGameFullscreen() {
	try {
		if (!isInFullscreen()) return;
		const d = document as any, exit = d.exitFullscreen || d.webkitExitFullscreen;
		if (exit) { const r = exit.call(document); if (r && r.catch) r.catch(() => {}); }
	} catch { /* ignore */ }
}
// Desktop games: only when the player opted in. Phone duels: always (the layout depends on it).
export const autoEnterGameFullscreen = () => { if (autoFullscreenEnabled()) enterGameFullscreen(); };
export const enterDuelMobileFullscreen = () => { if (phoneSizedDevice() || isMobileViewport()) enterGameFullscreen(true); };
