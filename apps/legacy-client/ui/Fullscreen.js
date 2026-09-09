// Fullscreen.js — go into browser fullscreen when a game starts (any mode, and only if the
// player opted in on Settings) and release it when leaving the game.
//
// requestFullscreen() needs a transient user gesture, so autoEnterGameFullscreen() is called
// straight from the click handlers that commit the player to a game (Ready, findRanked,
// startSolo), never from a later socket/board callback. It's idempotent and fails silently if the
// browser blocks or doesn't support it — the game just stays windowed.

function isInFullscreen() {
	return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

// On phones the browser already gives the game (near-)full use of the screen, and forcing the
// Fullscreen API there is disruptive (locks orientation prompts, hides the address bar abruptly,
// fails outright on iOS Safari). Skip it on mobile-sized viewports and just play in the page.
function isMobileViewport() {
	return !!(window.matchMedia && window.matchMedia("(max-width: 700px)").matches);
}

// Auto-entering fullscreen the instant a game starts is opt-in (default off) — persisted locally,
// like the board skin / keybinds. Off by default because the abrupt jump (plus the "Press Esc to
// exit" banner some browsers flash) surprised players who never asked for it; the in-game
// fullscreen button (toggleGameFullscreen) always works regardless of this setting.
function autoFullscreenEnabled() {
	return localStorage.getItem("ms_auto_fullscreen") === "1";
}
function setAutoFullscreenEnabled(on) {
	try { localStorage.setItem("ms_auto_fullscreen", on ? "1" : "0"); } catch (e) {}
}
// Call this from the "commit to a game" click handlers (Ready, findRanked, startSolo, …) instead of
// enterGameFullscreen() directly — it only fires if the player opted in. The manual toggle button
// bypasses this and calls enterGameFullscreen() unconditionally.
function autoEnterGameFullscreen() {
	if (autoFullscreenEnabled()) enterGameFullscreen();
}

// Both battle layouts' (1v1 duel, 6-player) landscape modes are built around reclaiming every bit of
// vertical space (see .game-view.duo/.multi's landscape media query, style.css) — the browser's own
// chrome (address bar, home indicator) eats exactly the height those layouts are fighting for, so
// unlike everywhere else on mobile, going fullscreen there is worth the jump even without the opt-in.
// Must be called from the same synchronous click handler that commits to the match (findRanked) —
// requestFullscreen() needs that transient user gesture, same constraint as enterGameFullscreen() itself.
//
// isMobileViewport() alone isn't the right check here — it's narrow-width (<=700px), true for a
// portrait phone but false for the SAME phone already turned sideways (700-930px wide), which is
// exactly the case this exists for. Touch/coarse-pointer (touchInput, Main.js — set at script load,
// this only ever runs later off a click) catches a phone in either orientation; the width check
// stays as a fallback for a touch laptop/tablet that's narrow but not really "a phone".
function enterDuelMobileFullscreen() {
	var isTouch = (typeof touchInput !== "undefined") && touchInput;
	// screen.width/height are the device's actual resolution (unaffected by the current browser
	// window size), so a touch laptop or tablet in a wide window still reads correctly as "not a
	// phone" here — a phone's short edge is comfortably under this even accounting for cases like
	// desktop mode / an external display reporting an unusual size.
	var phoneSized = typeof screen !== "undefined" && Math.min(screen.width || 0, screen.height || 0) <= 500;
	if ((isTouch && phoneSized) || isMobileViewport()) enterGameFullscreen(true);
}

// Puzzle's own mobile fullscreen entry (on request) — same phone-detection logic as
// enterDuelMobileFullscreen above (a phone in either orientation, not just a narrow viewport), but
// WITHOUT locking landscape (force=true, lockLandscape=false): puzzle has real, working layouts in
// BOTH orientations (see style.css) — unlike the battle layouts, this is purely "use the reclaimed
// screen space," not "this mode only works turned sideways."
function enterPuzzleMobileFullscreen() {
	var isTouch = (typeof touchInput !== "undefined") && touchInput;
	var phoneSized = typeof screen !== "undefined" && Math.min(screen.width || 0, screen.height || 0) <= 500;
	if ((isTouch && phoneSized) || isMobileViewport()) enterGameFullscreen(true, false);
}

// `force` bypasses the mobile skip below — used only for the two battle modes
// (enterDuelMobileFullscreen), where the landscape layout is built specifically to use the reclaimed
// space (no browser chrome, no address bar) rather than just "windowed but bigger". Every other
// mobile entry point (solo, casual rooms, puzzles, …) keeps the plain windowed-on-mobile behavior below.
// lockLandscape defaults to matching `force` (the existing behavior for every call site below,
// all of which either don't force fullscreen at all or are the battle layouts' own mobile entry
// points, which DO want the lock) — pass it explicitly (false) to force fullscreen without also
// locking orientation, for a mode that genuinely works either way (see enterPuzzleMobileFullscreen).
function enterGameFullscreen(force, lockLandscape) {
	if (lockLandscape === undefined) lockLandscape = force;
	try {
		if (isMobileViewport() && !force) return; // skip fullscreen on mobile — play windowed
		if (isInFullscreen()) return; // already fullscreen — nothing to do
		var el = document.documentElement;
		var req = el.requestFullscreen || el.webkitRequestFullscreen
			|| el.mozRequestFullScreen || el.msRequestFullscreen;
		if (!req) return; // unsupported (e.g. iOS Safari) — play windowed
		var r = req.call(el);
		if (r && typeof r.catch === "function") {
			r.then(function() { if (lockLandscape) tryLockLandscape(); }).catch(function() {});
		} else if (lockLandscape) {
			tryLockLandscape();
		}
	} catch (e) { /* blocked or unsupported — ignore, stay windowed */ }
}

// Screen Orientation API: only actually locks anything while fullscreen (browsers reject it
// otherwise), and only on browsers that implement it at all — notably not iOS Safari, which has
// never shipped ScreenOrientation.lock(). Failing there is expected and silent; body.duel-force-
// rotate (applyDuelLandscapeClass, Main.js) is the real fallback for whoever it doesn't work for.
function tryLockLandscape() {
	try {
		if (screen.orientation && typeof screen.orientation.lock === "function") {
			var p = screen.orientation.lock("landscape");
			if (p && typeof p.catch === "function") p.catch(function() {});
		}
	} catch (e) { /* unsupported — ignore */ }
}

function exitGameFullscreen() {
	try {
		if (!isInFullscreen()) return;
		var exit = document.exitFullscreen || document.webkitExitFullscreen
			|| document.mozCancelFullScreen || document.msExitFullscreen;
		if (!exit) return;
		var r = exit.call(document);
		if (r && typeof r.catch === "function") r.catch(function() {});
	} catch (e) { /* ignore */ }
}

// Every "leaving a game" teardown (leaveRoom, exitSolo, exitPuzzle, cancelBattleSearch, the Router's
// navigate-away path) used to call exitGameFullscreen() unconditionally — fine on desktop, but on
// phone (on request) it meant every single "back to lobby" cost the browser chrome popping back in
// and then, the instant the next match/puzzle/solo starts, popping right back out again — and
// re-entering needs a fresh transient user gesture (requestFullscreen()'s own requirement), so it
// isn't even guaranteed to succeed silently; it can visibly flash windowed for a beat. On a phone,
// once fullscreen, STAY fullscreen straight through leaving/starting games — only an explicit exit
// (the in-game toggle button, or the browser's own Esc/back-gesture handling, both of which still call
// exitGameFullscreen() directly, never this) should ever drop out of it. phoneSizedDevice() (Main.js) —
// not isMobileViewport()'s width check — is the right test here: it reads the device's real screen
// size, so a phone held sideways in the landscape duel/multi layout (width > 700, would read as
// "desktop" under the width check) still correctly counts as a phone and keeps its fullscreen.
function exitGameFullscreenUnlessMobile() {
	if (typeof phoneSizedDevice === "function" && phoneSizedDevice()) return;
	exitGameFullscreen();
}

// Toggle for the in-game fullscreen button: re-enter if we've exited (e.g. pressed Esc), or exit if in.
// The click is a user gesture, so requestFullscreen() is allowed here.
function toggleGameFullscreen() {
	if (isInFullscreen()) exitGameFullscreen();
	else enterGameFullscreen();
}

function fullscreenSupported() {
	var el = document.documentElement;
	return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen);
}

// Keep a `game-fullscreen` body class in sync with the ACTUAL fullscreen state — driven by the browser
// event, not our enter/exit helpers, so pressing Esc (the native exit) reverts the chrome too. The CSS
// hangs the immersive layout (hidden navbar, visible "Exit game" button) off this class.
//
// Also re-syncs the landscape-battle layout/board sizing (real bug: locking a phone's screen while
// fullscreen — a well-known iOS Safari behaviour, force-exits fullscreen; the browser's own chrome
// (address bar/home indicator) then reclaims real screen height on unlock) — nothing previously
// re-ran applyDuelLandscapeClass or re-measured the canvases in response to a fullscreen change at
// all, only resize/orientationchange (Main.js). duel-force-rotate's CSS-rotation trick and the
// board's own JS-computed cell size were both left sized off whatever the viewport looked like the
// LAST time either of those fired — stale fullscreen-era measurements once real browser chrome
// reappears — reported as the layout coming back "in landscape mode with elements on top of each
// other" after locking/unlocking mid-match. requestAnimationFrame mirrors applyDuoClass's own
// reasoning for the same re-measure-after-layout-settles pattern (Main.js).
function syncFullscreenChrome() {
	document.body.classList.toggle("game-fullscreen", isInFullscreen());
	resyncBattleLayoutForFullscreenChange();
}
function resyncBattleLayoutForFullscreenChange() {
	if (typeof applyDuelLandscapeClass === "function") applyDuelLandscapeClass();
	// refreshPlayerBoardSize (MobileLayout.js) is the same resize+redraw path the generic window
	// "resize" listener already uses — guards on an active board itself, resizes AND redraws both
	// the player and opponent canvases (a resized canvas clears its own contents), not just player.
	requestAnimationFrame(function() {
		if (typeof refreshPlayerBoardSize === "function") refreshPlayerBoardSize();
	});
}
document.addEventListener("fullscreenchange", syncFullscreenChrome);
document.addEventListener("webkitfullscreenchange", syncFullscreenChrome);
// Safety net for exactly the lock/unlock case above: fullscreenchange isn't always fired reliably
// (or promptly) across mobile browsers on a screen-lock cycle — a real, previously-reported class of
// bug (see this file's other visibility-driven fixes). visibilitychange fires far more consistently
// when a backgrounded/locked tab comes back, so re-check the ACTUAL fullscreen state (not just
// assume the last event already caught it) and re-run the same resync unconditionally — cheap and
// idempotent if nothing was actually stale.
document.addEventListener("visibilitychange", function() {
	if (document.visibilityState !== "visible") return;
	syncFullscreenChrome();
});

// Wire the in-game fullscreen toggle button, and hide it where the API is unavailable.
(function wireFullscreenButton() {
	if (!fullscreenSupported()) document.body.classList.add("no-fullscreen-support");
	var btn = document.getElementById("fullscreen_btn");
	if (btn) btn.addEventListener("click", toggleGameFullscreen);
})();

// The landscape duel's own fullscreen entry point, next to its back button (style.css/index.html) —
// #fullscreen_btn above lives in .game-header, which duel-landscape-mode hides outright, and the
// auto-attempt on match start (enterDuelMobileFullscreen) can silently fail (blocked, unsupported, or
// the click that started the match just didn't count as a strong enough gesture on that browser). Only
// ever enters — force=true bypasses enterGameFullscreen's own "skip on mobile" check the same way
// enterDuelMobileFullscreen does, since a player tapping this button has unambiguously asked for it
// regardless of viewport-size heuristics. The button hides itself once fullscreen (style.css,
// body.game-fullscreen), so there's no exit path to wire here.
(function wireDuelFullscreenButton() {
	var btn = document.getElementById("duel_fullscreen_btn");
	if (btn) btn.addEventListener("click", function() { enterGameFullscreen(true); });
})();

// Settings-page toggle for the auto-fullscreen opt-in (see autoFullscreenEnabled above).
function renderGameplaySettings() {
	var card = document.getElementById("gameplay_card");
	if (!card) return;
	card.innerHTML = "";
	var h = document.createElement("h2");
	h.className = "controls-title";
	h.textContent = "Gameplay";
	card.appendChild(h);

	var row = document.createElement("div");
	row.className = "setting-row";
	var text = document.createElement("div");
	text.className = "setting-row-text";
	var label = document.createElement("span");
	label.className = "setting-row-label";
	label.textContent = "Auto fullscreen";
	var note = document.createElement("span");
	note.className = "setting-row-note";
	note.textContent = "Jump into fullscreen the moment a game starts. Off by default — use the in-game fullscreen button any time.";
	text.appendChild(label);
	text.appendChild(note);
	row.appendChild(text);

	var sw = document.createElement("button");
	sw.type = "button";
	sw.className = "toggle-switch" + (autoFullscreenEnabled() ? " on" : "");
	sw.setAttribute("aria-pressed", autoFullscreenEnabled() ? "true" : "false");
	sw.addEventListener("click", function() {
		var next = !autoFullscreenEnabled();
		setAutoFullscreenEnabled(next);
		sw.classList.toggle("on", next);
		sw.setAttribute("aria-pressed", next ? "true" : "false");
	});
	row.appendChild(sw);

	card.appendChild(row);
}

// Settings-page volume sliders (Music + Effects), replacing the old topbar speaker-icon popover.
function renderAudioSettings() {
	var card = document.getElementById("audio_card");
	if (!card) return;
	card.innerHTML = "";
	var h = document.createElement("h2");
	h.className = "controls-title";
	h.textContent = "Audio";
	card.appendChild(h);

	function addRow(label, channel) {
		var row = document.createElement("div");
		row.className = "setting-row";
		var text = document.createElement("div");
		text.className = "setting-row-text";
		var lbl = document.createElement("span");
		lbl.className = "setting-row-label";
		lbl.textContent = label;
		text.appendChild(lbl);
		row.appendChild(text);

		var slider = document.createElement("input");
		slider.type = "range";
		slider.className = "cr-slider setting-row-slider";
		slider.min = "0";
		slider.max = "100";
		slider.step = "1";
		slider.setAttribute("aria-label", label + " volume");
		slider.value = String(Math.round(channel.getVolume() * 100));
		slider.addEventListener("input", function() {
			channel.unlock();
			var v = parseInt(slider.value, 10) / 100;
			channel.setVolume(v);
			channel.setMuted(v === 0);
		});
		row.appendChild(slider);

		card.appendChild(row);
	}

	if (typeof music !== "undefined" && music) addRow("Music", music);
	addRow("Effects", sound);
}
