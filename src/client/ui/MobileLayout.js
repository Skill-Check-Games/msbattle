// Mobile / responsive layout: media-query tracking, canvas sizing for both
// the player board and opponent thumbnails (DPR-aware), the "find next
// frontier" mobile aid, and the routing-into/out-of mobile layout when the
// breakpoint changes.

var mobileMQL = window.matchMedia ? window.matchMedia("(max-width: 700px)") : null;
var mobileLayout = !!(mobileMQL && mobileMQL.matches);
function sizeBoardCanvas(canvas, cellPx) {
	var w = Math.round(cols * cellPx * DPR), h = Math.round(rows * cellPx * DPR);
	// Only reassign the backing size when it actually changes — assigning canvas.width/height clears
	// the canvas even to the same value, which would wipe a board we want to keep on screen (e.g. the
	// final board states under the game-over result, repainted only by live frames that have stopped).
	if (canvas.width !== w) canvas.width = w;
	if (canvas.height !== h) canvas.height = h;
	canvas.style.width = (cols * cellPx) + "px";
	canvas.style.maxWidth = "100%";
	canvas.style.height = "auto";
}
// Fixed board area for the rated-puzzle view so the page layout doesn't
// jump as different-sized puzzles load. Cells scale to fit the larger
// dimension, smaller dimension is centered in the box via flex on
// .board-scroll (see style.css). Cell size is capped — at the unbounded
// 480/max(rows,cols), a 4×4 would render at 120-px cells, ~3.5× the
// multiplayer cell, which looks oversized against itself.
var PUZZLE_BOARD_PX = 480;
var PUZZLE_BOARD_PX_MOBILE = 320;
var PUZZLE_CELL_MAX = 75;
var PUZZLE_CELL_MAX_MOBILE = 56;

// True on the mobile landscape 1v1 duel layout (body.duel-landscape-mode, style.css) — a wide
// (width > 700) viewport, so it fails the width-based mobileLayout check even though it's a phone
// held sideways and needs the same fixed-size, panned-by-hand canvas as the real mobileLayout branch
// below (fitMobileCellPx's board-scroll gets exactly that treatment for portrait phones).
function isDuelLandscapeMobile() {
	return (typeof isDuoRacing === "function") && isDuoRacing() && document.body.classList.contains("duel-landscape-mode");
}

// True whenever the board is the fixed-size, hand-panned kind — portrait mobileLayout, or duel-
// landscape mobile — rather than desktop's scale-to-fit-then-static canvas. Shared by every place
// that needs "can/should this board be panned around," so the two flags don't have to be OR'd
// together separately at each call site.
function boardIsPannable() {
	return mobileLayout || isDuelLandscapeMobile();
}

// Largest cell size that lets a rows×cols board fit the available board area on
// desktop, clamped to [DESKTOP_CELL_MIN, DESKTOP_CELL_MAX]. Scaling to fit means a
// big board grows to use the screen instead of sitting at a fixed small size, and a
// wide board uses the full column width. Falls back to PLAYER_CELL if the layout
// can't be measured yet (e.g. called before the game view is visible).
function fitDesktopCellPx() {
	var availW, availH;
	if (isDuelLandscapeMobile()) {
		// The generic measurement below doesn't fit this layout: .game-left is display:contents here
		// (grid-area flattening, style.css), so its clientWidth is always 0 — and the "window height
		// minus canvas top" formula has no idea the Reveal/Flag/find-next row shares .board-wrap's own
		// column below the canvas, so it overshoots by that row's height. .board-wrap itself is a real,
		// un-flattened box (grid-area: board), and #board_scroll's clientHeight already reflects
		// everything ELSE in its flex column (that button row included, via ordinary flex layout) — so
		// measure directly off those instead. Can't use #board_scroll's own WIDTH the same way: below,
		// sizePlayerCanvas's pannable-board branch explicitly narrows its style.width to fit the LAST
		// computed cell size, so reading it back here would be circular (always chasing the old value).
		var wrap = document.querySelector(".board-wrap");
		availW = wrap ? wrap.clientWidth - 16 : 0; // minus .board-wrap's own 0.5rem × 2 padding
		availH = boardScroll ? boardScroll.clientHeight : 0;
	} else {
		var gameLeft = document.querySelector(".game-left");
		// .game-left has min-width:0 and lives in a minmax(0,1fr) track, so its width is
		// the available column width regardless of the canvas's current size.
		availW = gameLeft ? gameLeft.clientWidth - 42 : 0; // minus .player-board padding + border
		var top = playerCanvas.getBoundingClientRect().top;
		availH = window.innerHeight - top - 24;            // leave a small bottom gap
	}
	if (!(availW > 0)) availW = cols * PLAYER_CELL;
	if (!(availH > 0)) availH = rows * PLAYER_CELL;
	var cell = Math.floor(Math.min(availW / cols, availH / rows));
	// Territory, solo, marathon, and 1v1 duo boards fill the whole area below the nav (duo splits it
	// with exactly one opponent board, the same "just 1-2 boards" situation territory/solo are already
	// in), so let their cells grow past the racing cap — the cap stays at 6-player multi, where that
	// many boards' worth of cells genuinely do need to stay legible at once.
	var inMarathon = (typeof puzzleSession !== "undefined") && puzzleSession && puzzleSession.marathon;
	var inDuo = (typeof isDuoRacing === "function") && isDuoRacing();
	var bigCell = (typeof territoryActive !== "undefined" && territoryActive) || ((typeof soloSession !== "undefined") && soloSession) || inMarathon || inDuo;
	var maxCell = bigCell ? 100 : DESKTOP_CELL_MAX;
	// The mobile landscape duel (body.duel-landscape-mode, style.css) floors noticeably higher than
	// the general-purpose DESKTOP_CELL_MIN once the round is actually live — on a viewport this short
	// the ideal (fit-everything) cell size is almost always well under 22px anyway (that's exactly why
	// board-scroll pans), so the board was already rendering at the absolute minimum, not a
	// deliberately chosen size. Bumped twice (30 -> 40 -> 56) after repeated "very hard to click
	// correctly" feedback — tapping individual cells accurately matters more than fitting the whole
	// board in untouched, WHILE PLAYING.
	// Before that (still in the pre-round countdown, roundStartTime not stamped yet — Overlay.js's
	// countDown sets it at the exact instant GO fires, same moment localRoundStartReveal/Main.js does
	// the actual zoom-in resize) there's no reason to pay that cost: nothing is clickable yet, so an
	// overview of the WHOLE board — no floor at all, just whatever cell size fits everything on
	// screen — is more useful than a zoomed-in slice of it, letting the player size up what they're
	// about to solve during the countdown instead of after.
	// Same overview treatment applies mid-round too, on demand, whenever duelZoomedOut is set — the
	// player's own double-tap/double-click zoom-out toggle (zoomDuelOut, above), not just the
	// pre-round state.
	var roundLive = (typeof roundStartTime !== "undefined") && roundStartTime > 0;
	var duelMobile = isDuelLandscapeMobile();
	var minCell = (duelMobile && roundLive && !duelZoomedOut) ? 56 : (duelMobile ? 1 : DESKTOP_CELL_MIN);
	return Math.max(minCell, Math.min(maxCell, cell));
}

// Mobile cell size for racing/solo/territory: the largest whole-pixel cell that lets a finger-friendly
// number of columns (~MOBILE_PLAYER_CELL wide) fill the board viewport exactly. A board narrower than
// that fits entirely (no panning); a wider board keeps big cells and pans. Returns an integer so cells
// render crisp, and so the viewport can be sized to a whole number of them (no half-cut cells).
var mobileCellPx = 0; // last mobile cell size, used to snap panning to whole-cell steps
// Available board width = the (full-bleed) parent of the scroll viewport. We measure the PARENT, not
// boardScroll itself, because sizePlayerCanvas shrinks boardScroll to a whole-cell width — reading its
// own (already-shrunk) width would drift smaller on every re-run.
function mobileAvailW() {
	var p = boardScroll && boardScroll.parentNode;
	var w = (p && p.clientWidth) || (boardScroll && boardScroll.clientWidth) || window.innerWidth;
	return w > 0 ? w : window.innerWidth;
}
function fitMobileCellPx() {
	var availW = mobileAvailW();
	var fitCols = Math.max(1, Math.floor(availW / MOBILE_PLAYER_CELL));
	var visibleCols = Math.min(cols, fitCols);            // never claim more columns than the board has
	return Math.max(1, Math.floor(availW / visibleCols)); // fill the width with whole columns
}

function sizePlayerCanvas() {
	var inPuzzle = (typeof puzzleSession !== "undefined") && puzzleSession;
	// Marathon boards reuse the puzzle-play path but are full-size boards (24x30-30x40), not small
	// curriculum puzzles — size them like a regular game instead of the fixed puzzle box.
	var fixedBox = inPuzzle && !puzzleSession.marathon;
	var cellPx;
	if (fixedBox) {
		var target = mobileLayout ? PUZZLE_BOARD_PX_MOBILE : PUZZLE_BOARD_PX;
		var cap = mobileLayout ? PUZZLE_CELL_MAX_MOBILE : PUZZLE_CELL_MAX;
		cellPx = Math.min(cap, Math.floor(target / Math.max(rows, cols)));
	} else {
		cellPx = mobileLayout ? fitMobileCellPx() : fitDesktopCellPx();
	}
	var pw = Math.round(cols * cellPx * DPR), ph = Math.round(rows * cellPx * DPR);
	// Same guard as sizeBoardCanvas: don't clear the player board by re-assigning the same size.
	if (playerCanvas.width !== pw) playerCanvas.width = pw;
	if (playerCanvas.height !== ph) playerCanvas.height = ph;
	playerCanvas.style.width = (cols * cellPx) + "px";
	// Duel-landscape needs the same fixed-size, hand-panned canvas as real mobileLayout (below) —
	// otherwise the desktop branch's maxWidth:100% would scale the canvas straight back down to fit
	// the panel, silently undoing fitDesktopCellPx's landscape-duel floor and leaving cells just as
	// small (and just as hard to tap) as before that floor was raised.
	if (boardIsPannable()) {
		mobileCellPx = cellPx;
		wireScrollSnap();
		playerCanvas.style.height = (rows * cellPx) + "px";
		playerCanvas.style.maxWidth = "none";
		// Constrain the scroll viewport to a whole number of cells (centered), so its edges always land
		// on cell boundaries — combined with whole-step panning (snapBoardScroll), no cell is ever
		// rendered half-visible. Puzzles keep their fixed centered box (marathon boards don't).
		if (boardScroll && !fixedBox) {
			var visW = Math.min(cols, Math.floor(mobileAvailW() / cellPx)) * cellPx;
			boardScroll.style.width = visW + "px";
			boardScroll.style.marginLeft = "auto";
			boardScroll.style.marginRight = "auto";
		}
	} else {
		playerCanvas.style.height = "auto";
		playerCanvas.style.maxWidth = "100%";
	}
}

// Animates the mobile duel board zooming toward (centerR, centerC) — the manual zoomDuelOut/zoomDuelIn
// toggle (below) goes through this. Caller must call sizePlayerCanvas() FIRST so the canvas's backing
// resolution/#board_scroll's own width/margin are already at their FINAL, correct state before this
// runs — this function itself never resizes anything, only animates a CSS transform over the
// already-correctly-sized board.
// fromCellPx is a snapshot of the cell size the board was AT before sizePlayerCanvas ran (the caller
// has to capture it first — sizePlayerCanvas immediately overwrites playerCanvas.style.width with the
// final value) — the animation's start point.
//
// Deliberately a `transform: scale()`, NOT an animated `width`/`height` (an earlier version did that,
// interpolating scrollLeft/Top alongside it to keep the target centered at each frame's cell size) —
// width/height are layout-affecting properties, so animating them forces a synchronous reflow on every
// single frame, and that cost visibly spikes right as the canvas crosses from "fits #board_scroll, no
// scrolling needed" to "overflows, needs a real scrollable region" — which happens PARTWAY THROUGH a
// zoom-IN (starts small/non-overflowing, grows into overflowing) but only ever at the very END of a
// zoom-OUT (starts already overflowing, shrinks out of it right at the finish) — a real asymmetry, and
// exactly why zoom-out could look fine while zoom-in still visibly hitched. A transform never touches
// layout, only compositing, so it's smooth in both directions regardless of that crossing.
// The technique: jump #board_scroll's scrollLeft/Top straight to the FINAL centered position (valid
// immediately — the canvas's real layout size is ALREADY final, from sizePlayerCanvas above, so nothing
// clamps), set `transform-origin` to the anchor cell's own pixel position within that final-size canvas,
// then animate `scale` from `fromCellPx/toCellPx` up to `1`. CSS transforms scale an element AROUND its
// transform-origin without moving the element's own layout box — so the origin point stays visually
// fixed on screen for the whole animation, and since the scroll jump already centered that exact point,
// "fixed on screen" here means "stays centered," the same end result as the old scroll-interpolation
// approach, just achieved for free by transform semantics instead of hand-rolled math (and with no
// scroll-clamping edge case left to get wrong — scroll is set once, to its one valid final value).
function animateDuelZoomTo(centerR, centerC, fromCellPx) {
	var toCellPx = parseFloat(playerCanvas.style.width) / cols; // sizePlayerCanvas already set this
	if (!boardScroll || !(fromCellPx > 0) || Math.abs(toCellPx - fromCellPx) < 0.5) return; // nothing worth animating
	// Slower than a typical UI transition on purpose — this is the one moment (GO, or a manual zoom
	// toggle) meant to be watched rather than reacted to instantly, giving the player a real sense of
	// motion toward where they're headed rather than just registering a before/after.
	var DURATION_MS = 900;
	// Ease-out cubic: fast start, settling in gently right as it reaches the target cell — reads as
	// "zooming toward" the destination rather than mechanically interpolating toward it.
	function ease(t) { return 1 - Math.pow(1 - t, 3); }
	function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
	boardScroll.scrollLeft = clamp((centerC + 0.5) * toCellPx - boardScroll.clientWidth / 2, 0, Math.max(0, cols * toCellPx - boardScroll.clientWidth));
	boardScroll.scrollTop = clamp((centerR + 0.5) * toCellPx - boardScroll.clientHeight / 2, 0, Math.max(0, rows * toCellPx - boardScroll.clientHeight));
	playerCanvas.style.transformOrigin = ((centerC + 0.5) * toCellPx) + "px " + ((centerR + 0.5) * toCellPx) + "px";
	playerCanvas.style.willChange = "transform";
	var startScale = fromCellPx / toCellPx;
	var t0 = null;
	function frame(now) {
		if (t0 === null) t0 = now;
		var t = Math.min(1, (now - t0) / DURATION_MS);
		var scale = startScale + (1 - startScale) * ease(t);
		playerCanvas.style.transform = "scale(" + scale + ")";
		if (t < 1) { requestAnimationFrame(frame); return; }
		// Done — scale(1) and no transform at all render identically, so clearing these is invisible;
		// leaving them set would keep the canvas painted on its own GPU layer indefinitely for no reason.
		playerCanvas.style.transform = "";
		playerCanvas.style.transformOrigin = "";
		playerCanvas.style.willChange = "";
	}
	requestAnimationFrame(frame);
}

// Manual zoom toggle, independent of roundStartTime (fitDesktopCellPx's own floor already handles the
// pre-round overview automatically) — a player can zoom back out mid-round to get their bearings, then
// back in, same two cell sizes either way, no third size in between. See fitDesktopCellPx's own use of
// this flag. Reset to false at the start of every round (localRoundStartReveal, Main.js) so a round
// never inherits the previous one's zoom state.
var duelZoomedOut = false;

// Zoom out to the whole-board overview, anchored on whatever's currently centered in the viewport —
// the point that stays visually "under" the player as the rest of the board reveals itself around it,
// same idea as a pinch-zoom's focal point. Triggered by a double-tap/double-click while zoomed in
// (Main.js) — see zoomDuelIn below for the reverse.
function zoomDuelOut() {
	if (!isDuelLandscapeMobile() || duelZoomedOut || !boardScroll) return;
	var fromCellPx = parseFloat(playerCanvas.style.width) / cols;
	if (!(fromCellPx > 0)) return;
	var anchorC = (boardScroll.scrollLeft + boardScroll.clientWidth / 2) / fromCellPx - 0.5;
	var anchorR = (boardScroll.scrollTop + boardScroll.clientHeight / 2) / fromCellPx - 0.5;
	duelZoomedOut = true;
	sizePlayerCanvas();
	// sizePlayerCanvas reassigns the canvas's backing width/height whenever the cell size actually
	// changes (nearly always true here — that's the whole point) — which, per the HTML canvas spec,
	// clears its contents outright, same as every other resize call site (e.g. refreshPlayerBoardSize,
	// below) already has to repaint after. Missing this left the board solid black until SOMETHING else
	// happened to trigger a repaint — usually masked in quick testing by the reveal-animation RAF loop
	// (startAnimLoop, Animations.js) still running from a moment earlier, but with no animation in
	// flight (the common case once a round's been idle a beat) nothing ever repainted it again — a real
	// "board goes black and stays black" bug, not just a one-frame flicker.
	if (typeof redrawOwnBoardWithFocus === "function") redrawOwnBoardWithFocus();
	animateDuelZoomTo(anchorR, anchorC, fromCellPx);
	if (navigator.vibrate) navigator.vibrate(8);
}

// Zoom in on (targetR, targetC) — wherever the player just tapped/clicked while zoomed out (Main.js:
// a tap at this zoom level can't land on a cell precisely enough to be a real reveal/flag attempt, so
// it's read as "zoom in HERE" instead; see the touch/click handlers' own comments).
function zoomDuelIn(targetR, targetC) {
	if (!isDuelLandscapeMobile() || !duelZoomedOut || !boardScroll) return;
	var fromCellPx = parseFloat(playerCanvas.style.width) / cols;
	if (!(fromCellPx > 0)) return;
	duelZoomedOut = false;
	sizePlayerCanvas();
	// Same repaint-after-resize requirement as zoomDuelOut above — see its comment.
	if (typeof redrawOwnBoardWithFocus === "function") redrawOwnBoardWithFocus();
	animateDuelZoomTo(targetR, targetC, fromCellPx);
	if (navigator.vibrate) navigator.vibrate(8);
}

// Once a pan settles, glide the board to the nearest whole-cell offset so no cell is left clipped at an
// edge — animated (not an instant jump) so it doesn't feel like the board snaps around under your finger.
function snapBoardScroll() {
	if (!mobileLayout || !boardScroll || !(mobileCellPx > 0)) return;
	var sx = Math.round(boardScroll.scrollLeft / mobileCellPx) * mobileCellPx;
	var sy = Math.round(boardScroll.scrollTop / mobileCellPx) * mobileCellPx;
	if (Math.abs(sx - boardScroll.scrollLeft) < 0.5 && Math.abs(sy - boardScroll.scrollTop) < 0.5) return; // already aligned
	if (typeof boardScroll.scrollTo === "function") {
		try { boardScroll.scrollTo({ left: sx, top: sy, behavior: "smooth" }); return; } catch (e) {}
	}
	boardScroll.scrollLeft = sx;
	boardScroll.scrollTop = sy;
}
function scrollToCell(r, c, smooth) {
	if (!boardScroll) return;
	var rect = playerCanvas.getBoundingClientRect();
	var cellW = rect.width / cols, cellH = rect.height / rows;
	// Centre the cell, then snap the offset to a whole-cell step so edges land on cell boundaries.
	var targetX = Math.round(((c + 0.5) * cellW - boardScroll.clientWidth / 2) / cellW) * cellW;
	var targetY = Math.round(((r + 0.5) * cellH - boardScroll.clientHeight / 2) / cellH) * cellH;
	if (smooth && typeof boardScroll.scrollTo === "function") {
		try { boardScroll.scrollTo({ left: targetX, top: targetY, behavior: "smooth" }); return; } catch (e) {}
	}
	boardScroll.scrollLeft = targetX;
	boardScroll.scrollTop = targetY;
}
// Snap manual (finger) panning to whole-cell steps once the gesture settles.
var scrollSnapWired = false;
function wireScrollSnap() {
	if (scrollSnapWired || !boardScroll) return;
	scrollSnapWired = true;
	// Snap only once scrolling has fully stopped (including momentum), so we never fight an in-progress
	// fling. scrollend fires exactly then; for browsers without it, debounce 'scroll' long enough that
	// momentum has settled. (No touchend snap — the finger lifts while momentum is still running.)
	var t = null;
	function deferredSnap() { if (t) clearTimeout(t); t = setTimeout(snapBoardScroll, 140); }
	if ("onscrollend" in boardScroll) boardScroll.addEventListener("scrollend", snapBoardScroll);
	else boardScroll.addEventListener("scroll", deferredSnap, { passive: true });
}
function isFrontierCell(r, c) {
	if (myState[r][c] !== UNKNOWN) return false;
	for (var dr = -1; dr <= 1; dr++) {
		for (var dc = -1; dc <= 1; dc++) {
			if (dr === 0 && dc === 0) continue;
			var nr = r + dr, nc = c + dc;
			if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
			if (myState[nr][nc] === KNOWN) return true;
		}
	}
	return false;
}
function findNearestFrontierCell() {
	if (!myState) return null;
	var rect = playerCanvas.getBoundingClientRect();
	var cellW = rect.width / cols, cellH = rect.height / rows;
	var viewCol = (boardScroll.scrollLeft + boardScroll.clientWidth / 2) / cellW - 0.5;
	var viewRow = (boardScroll.scrollTop + boardScroll.clientHeight / 2) / cellH - 0.5;
	var bestFrontier = null, bestFrontierD = Infinity;
	var bestUnknown = null, bestUnknownD = Infinity;
	for (var r = 0; r < rows; r++) {
		for (var c = 0; c < cols; c++) {
			if (myState[r][c] !== UNKNOWN) continue;
			var dr = r - viewRow, dc = c - viewCol;
			var d = dr * dr + dc * dc;
			if (d < bestUnknownD) { bestUnknownD = d; bestUnknown = { r: r, c: c }; }
			if (isFrontierCell(r, c) && d < bestFrontierD) { bestFrontierD = d; bestFrontier = { r: r, c: c }; }
		}
	}
	return bestFrontier || bestUnknown;
}
function updateMobileFindNextHint() {
	if (!mobileLayout || !findNextArrow) return;
	if (!currentActionMode() || !myState) {
		findNextArrow.classList.remove("visible");
		arrowTargetCell = null;
		return;
	}
	var rect = playerCanvas.getBoundingClientRect();
	if (!rect.width || !rect.height) return;
	var cellW = rect.width / cols, cellH = rect.height / rows;
	var minCol = Math.max(0, Math.floor(boardScroll.scrollLeft / cellW));
	var maxCol = Math.min(cols, Math.ceil((boardScroll.scrollLeft + boardScroll.clientWidth) / cellW));
	var minRow = Math.max(0, Math.floor(boardScroll.scrollTop / cellH));
	var maxRow = Math.min(rows, Math.ceil((boardScroll.scrollTop + boardScroll.clientHeight) / cellH));

	// If any frontier is visible (or the whole board is solved), no arrow.
	for (var r = minRow; r < maxRow; r++) {
		for (var c = minCol; c < maxCol; c++) {
			if (isFrontierCell(r, c)) {
				findNextArrow.classList.remove("visible");
				arrowTargetCell = null;
				return;
			}
		}
	}

	var target = findNearestFrontierCell();
	// Guard against the target already being inside the viewport (race condition).
	if (!target || (target.r >= minRow && target.r < maxRow && target.c >= minCol && target.c < maxCol)) {
		findNextArrow.classList.remove("visible");
		arrowTargetCell = null;
		return;
	}
	arrowTargetCell = target;

	// Direction from viewport centre to the target cell.
	var viewCenterX = boardScroll.scrollLeft + boardScroll.clientWidth / 2;
	var viewCenterY = boardScroll.scrollTop + boardScroll.clientHeight / 2;
	var dx = (target.c + 0.5) * cellW - viewCenterX;
	var dy = (target.r + 0.5) * cellH - viewCenterY;
	var theta = Math.atan2(dy, dx);
	var deg = theta * 180 / Math.PI;

	// Snap arrow to the closest of 8 viewport positions (4 edges + 4 corners).
	var margin = 8, aw = 44, ah = 44;
	var bw = boardScroll.clientWidth, bh = boardScroll.clientHeight;
	var ax, ay;
	var absDeg = Math.abs(deg);
	if (absDeg < 22.5)               { ax = bw - aw - margin; ay = (bh - ah) / 2; }
	else if (deg >= 22.5 && deg < 67.5)   { ax = bw - aw - margin; ay = bh - ah - margin; }
	else if (deg >= 67.5 && deg < 112.5)  { ax = (bw - aw) / 2;    ay = bh - ah - margin; }
	else if (deg >= 112.5 && deg < 157.5) { ax = margin;           ay = bh - ah - margin; }
	else if (absDeg >= 157.5)             { ax = margin;           ay = (bh - ah) / 2; }
	else if (deg <= -22.5 && deg > -67.5) { ax = bw - aw - margin; ay = margin; }
	else if (deg <= -67.5 && deg > -112.5){ ax = (bw - aw) / 2;    ay = margin; }
	else                                  { ax = margin;           ay = margin; }

	findNextArrow.style.left = ax + "px";
	findNextArrow.style.top = ay + "px";
	arrowGlyph.style.transform = "rotate(" + theta + "rad)";
	findNextArrow.classList.add("visible");
}
// --- Mobile cursor / frontier navigation ---

// Frontier cells (UNKNOWN, adjacent to at least one KNOWN cell) — what #duel_find_next_btn/
// #duel_find_prev_btn cycle between (mobileNavigate, via getFrontierClusters below), one AREA at a
// time. This scan itself stays blind to the actual mine layout — only ever reasons about what the
// PLAYER themselves already knows (their own revealed/flagged state via myState — flagged cells are
// already excluded here for free, isFrontierCell only considers UNKNOWN ones). getFrontierClusters,
// below, is where boardCell/the mine layout comes back in, and only at the CLUSTER level, not here —
// see its own comment for why that split is the right line to draw. Falls back to all UNKNOWN cells
// when no frontier exists yet (very start of a round, before any reveals).
function frontierCells() {
	var cells = [];
	if (!myState) return cells;
	for (var r = 0; r < rows; r++) {
		for (var c = 0; c < cols; c++) {
			if (isFrontierCell(r, c)) cells.push([r, c]);
		}
	}
	if (!cells.length) {
		for (var r = 0; r < rows; r++) {
			for (var c = 0; c < cols; c++) {
				if (myState[r][c] === UNKNOWN) cells.push([r, c]);
			}
		}
	}
	return cells;
}

// Groups frontierCells() into connected areas (8-adjacency) — what #duel_find_next_btn/
// #duel_find_prev_btn actually step between (mobileNavigate), not individual cells. Stepping
// cell-by-cell along a flat sorted list mostly just nudged the view to the cell right next door, which
// barely reads as "somewhere else"; jumping between whole areas instead means every press lands
// somewhere materially different.
// Mine-awareness lives HERE, at the cluster level only, not per-cell: an area is skipped as a landing
// target if EVERY cell in it is a mine (boardCell(...) === MINE for all members) — nothing to actually
// do there but flag, not what this button is for. A version that filtered individual cells instead (so
// the landing cell was always guaranteed safe) was a real cheat vector — the exact cell the button
// highlighted, or the ones it conspicuously never visited, directly leaked which specific cells the
// client's boardDecoder knows aren't mines. This is deliberately coarser: "this whole area has at
// least one safe cell somewhere in it" is a much weaker signal than "this exact cell is safe," and the
// representative (landing) cell below is still chosen with NO regard for mine status — picked purely
// by geometry from the cluster's full membership, mines included, so it can land on a mine just as
// easily as a safe cell within a qualifying area.
function getFrontierClusters() {
	var cells = frontierCells();
	if (!cells.length) return [];
	function key(r, c) { return r + "," + c; }
	var inSet = {};
	cells.forEach(function(rc) { inSet[key(rc[0], rc[1])] = true; });
	var seen = {};
	var clusters = [];
	cells.forEach(function(start) {
		var sk = key(start[0], start[1]);
		if (seen[sk]) return;
		seen[sk] = true;
		var stack = [start], members = [start];
		while (stack.length) {
			var cur = stack.pop();
			for (var dr = -1; dr <= 1; dr++) {
				for (var dc = -1; dc <= 1; dc++) {
					if (dr === 0 && dc === 0) continue;
					var nr = cur[0] + dr, nc = cur[1] + dc, nk = key(nr, nc);
					if (!inSet[nk] || seen[nk]) continue;
					seen[nk] = true;
					stack.push([nr, nc]);
					members.push([nr, nc]);
				}
			}
		}
		// Skip this area entirely if every member is a mine — see the function comment above for why
		// this check belongs here (cluster-level) and not folded into frontierCells (cell-level).
		var hasSafeCell = members.some(function(m) { return boardCell(m[0], m[1]) !== MINE; });
		if (!hasSafeCell) return;
		// Representative (landing) cell: the member closest to the cluster's own centroid, so it reads
		// as "the middle of this area" instead of an arbitrary corner of it. Picked from ALL members,
		// mines included — see the function comment above for why this stays blind to boardCell.
		var sumR = 0, sumC = 0;
		members.forEach(function(m) { sumR += m[0]; sumC += m[1]; });
		var cR = sumR / members.length, cC = sumC / members.length;
		var rep = members[0], repD = Infinity;
		members.forEach(function(m) {
			var d = (m[0] - cR) * (m[0] - cR) + (m[1] - cC) * (m[1] - cC);
			if (d < repD) { repD = d; rep = m; }
		});
		clusters.push({ r: rep[0], c: rep[1] });
	});
	if (clusters.length <= 1) return clusters;
	// Sort by angle from the centroid of revealed cells, same trick as before, now one entry per AREA
	// instead of per cell — traces the board's boundary in a circular sweep rather than jumping back
	// and forth across rows in reading order.
	var sumR = 0, sumC = 0, n = 0;
	for (var r = 0; r < rows; r++) {
		for (var c = 0; c < cols; c++) {
			if (myState[r][c] === KNOWN) { sumR += r; sumC += c; n++; }
		}
	}
	var boardCR = n > 0 ? sumR / n : rows / 2;
	var boardCC = n > 0 ? sumC / n : cols / 2;
	clusters.sort(function(a, b) {
		return Math.atan2(a.r - boardCR, a.c - boardCC) - Math.atan2(b.r - boardCR, b.c - boardCC);
	});
	return clusters;
}

// On mobile we play by tapping cells directly and panning the board by hand — there's no focus
// cursor and the board never auto-pans to follow one. So this is a no-op on mobile (it used to move a
// keyboard-style cursor to the nearest frontier cell and scroll it into view after every action, which
// made the board jump around). Kept as a stub so its call sites stay valid.
function mobileAutoSelect() {}

// Step the cursor to the prev (dir=-1) or next (dir=+1) unsolved AREA (getFrontierClusters, above)
// along the circular boundary sweep, wrapping around. Used by the portrait ‹ / › nav buttons, and by
// the mobile duel's own #duel_find_next_btn (index.html) — its "another unsolved part of the map"
// button, always dir=1.
function mobileNavigate(dir) {
	if (!boardIsPannable() || !touchInput) return;
	var clusters = getFrontierClusters();
	if (!clusters.length) return;
	// Anchor on whichever area is nearest the cursor's current spot, so "next"/"prev" moves relative
	// to where we actually are instead of always restarting from the first area in sweep order. Moving
	// dir steps from THAT area always lands in a different one — areas are connected components of the
	// frontier, so two distinct areas are never adjacent to each other by construction (there's always
	// at least one revealed cell between them) — which is exactly what makes this "somewhere else"
	// instead of just the next cell over.
	var cur = -1, best = Infinity;
	for (var i = 0; i < clusters.length; i++) {
		var dr = clusters[i].r - focusedR, dc = clusters[i].c - focusedC;
		var d = dr * dr + dc * dc;
		if (d < best) { best = d; cur = i; }
	}
	var next = (cur + dir + clusters.length) % clusters.length;
	focusedR = clusters[next].r;
	focusedC = clusters[next].c;
	focusVisible = true;
	scrollToCell(focusedR, focusedC, true);
	redrawOwnBoardWithFocus();
	if (navigator.vibrate) navigator.vibrate(8);
}

// Duel-landscape mobile: let a drag ANYWHERE in the game view pan the board, not only a drag that
// starts directly on the canvas. The board is zoomed in on a short landscape screen (fitDesktopCellPx's
// landscape floor, above) and the canvas is only part of a cramped viewport shared with two side
// panels, so a swipe starting a few px off it — an easy miss with a thumb — otherwise does nothing;
// #board_scroll's native overflow:auto pan only ever engages for a touch that starts inside it. This
// drives boardScroll.scrollLeft/Top by hand instead, for any touch that starts outside #board_scroll —
// touches starting ON it (the canvas) are untouched, still the existing native scroll + Main.js's own
// tap/long-press handling, so there's no double-handling of the same gesture.
var duelPan = null; // { startX, startY, lastX, lastY, moved } | null, while a gesture from off-canvas is live
var DUEL_PAN_TOLERANCE = 10;
(function() {
	var container = document.getElementById("game_view");
	if (!container) return;
	container.addEventListener("touchstart", function(e) {
		duelPan = null;
		if (!isDuelLandscapeMobile() || e.touches.length !== 1) return;
		if (!boardScroll || boardScroll.contains(e.target)) return; // native scroll already owns this one
		var t = e.touches[0];
		duelPan = { startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastY: t.clientY, moved: false };
	}, { passive: true });
	container.addEventListener("touchmove", function(e) {
		if (!duelPan || e.touches.length !== 1 || !boardScroll) return;
		var t = e.touches[0];
		if (!duelPan.moved) {
			// Below tolerance: leave it alone so a plain tap on a button (Reveal/Flag/back/...) still
			// fires its normal click on touchend, same threshold-before-committing idea as the canvas's
			// own tap-vs-pan logic (Main.js's touchMoved/TOUCH_MOVE_TOLERANCE).
			if (Math.abs(t.clientX - duelPan.startX) < DUEL_PAN_TOLERANCE && Math.abs(t.clientY - duelPan.startY) < DUEL_PAN_TOLERANCE) return;
			duelPan.moved = true;
		}
		e.preventDefault(); // now committed to a pan — don't let anything else react to this touch too
		boardScroll.scrollLeft -= (t.clientX - duelPan.lastX);
		boardScroll.scrollTop -= (t.clientY - duelPan.lastY);
		duelPan.lastX = t.clientX;
		duelPan.lastY = t.clientY;
	}, { passive: false });
	container.addEventListener("touchend", function() { duelPan = null; });
	container.addEventListener("touchcancel", function() { duelPan = null; });
})();

function onMobileLayoutChange() {
	mobileLayout = !!(mobileMQL && mobileMQL.matches);
	sizePlayerCanvas();
}
if (mobileMQL) {
	if (typeof mobileMQL.addEventListener === "function") mobileMQL.addEventListener("change", onMobileLayoutChange);
	else if (typeof mobileMQL.addListener === "function") mobileMQL.addListener(onMobileLayoutChange);
}

// Rescale the player board when the window resizes, so the fit-to-space sizing
// tracks the available area. Re-sizing the canvas clears its backing store, so we
// redraw after. Coalesced into one rAF tick to avoid thrashing during a drag.
function refreshPlayerBoardSize() {
	if (typeof myState === "undefined" || !myState) return; // only while a board is active
	sizePlayerCanvas();
	if (typeof redrawOwnBoardWithFocus === "function") redrawOwnBoardWithFocus();
	// Duel: keep the opponent board matched to the (resized) player board and repaint it from
	// the last frame, since resizing a canvas clears it and the opponent may not be moving.
	if (typeof sizeOpponentCanvases === "function") sizeOpponentCanvases();
	if (typeof isDuoRacing === "function" && isDuoRacing()) {
		if (lastGames && lastGames[1]) {
			drawBoardStatic(lastGames[1].state, document.getElementById("game1"), lastGames[1].skin || "classic");
		} else if (typeof paintOpponentCovered === "function") {
			// No live frame yet for THIS match/search (lastGames is reset in resetGameUI at the start
			// of both) — repaint covered instead of leaving the just-cleared canvas blank.
			paintOpponentCovered();
		}
	}
}
var playerBoardResizeRaf = null;
window.addEventListener("resize", function() {
	if (playerBoardResizeRaf) return;
	playerBoardResizeRaf = requestAnimationFrame(function() {
		playerBoardResizeRaf = null;
		refreshPlayerBoardSize();
	});
});
