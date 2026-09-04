// Player-board input dispatch.
//
// Mouse/touch/key event handlers feed into performAction, which optimistically
// applies the reveal or flag to myState (queuing the corresponding animation)
// and emits the same action to the server. Solo (Solo.js) and the multiplayer
// flow both come through performAction.
//
// localReveal + applyLocalLeftClick are the local mirror of the server's
// dfs reveal + chord click — they run through BoardLogic so the two surfaces
// stay in lockstep.

// Hit-test a canvas at a client (x, y) point. Used by both the live game
// (cellFromClient) and the Learn page — every interactive board on the site
// flows through here.
function cellFromCanvas(canvas, R, C, clientX, clientY) {
	var rect = canvas.getBoundingClientRect();
	var bx = clientX - rect.left, by = clientY - rect.top; // local point within the ON-SCREEN box
	var boxW = rect.width, boxH = rect.height;
	// body.duel-force-rotate (style.css) rotates an ANCESTOR (#game_view) 90° to render the landscape
	// duel on a portrait phone that can't be orientation-locked — see its comment for why. Rendering
	// falls straight out of the transform cascade with no extra work, but hit-testing runs backwards
	// (screen point -> local point), and getBoundingClientRect() only ever reports the POST-rotation
	// box — bx/by above are local to THAT box, not to the canvas's own pre-rotation layout, so
	// dividing by it directly would read columns where rows are and vice versa. Map back to
	// pre-rotation local coordinates first. offsetWidth/Height are unaffected by the transform (it's
	// applied above this element, not to it), so they're exactly the pre-rotation box this needs: for
	// a 90° clockwise rotation, a point at rotated-local (bx, by) was at pre-rotation local
	// (by, preRotationHeight - bx) — i.e. swap the axes, then flip the one that's now inverted.
	if (document.body.classList.contains("duel-force-rotate")) {
		var preW = canvas.offsetWidth, preH = canvas.offsetHeight;
		var ox = by, oy = preH - bx;
		bx = ox; by = oy;
		boxW = preW; boxH = preH;
	}
	var c = Math.floor(bx / boxW * C);
	var r = Math.floor(by / boxH * R);
	if (r < 0 || r >= R || c < 0 || c >= C) return null;
	return { r: r, c: c };
}

function cellFromClient(clientX, clientY) {
	return cellFromCanvas(playerCanvas, rows, cols, clientX, clientY);
}

function clearPressed() {
	if (!pressedCell) return;
	pressedCell = null;
	updatePressHighlightOverlay(); // no board content changed — just hide the touch highlight
}
function localReveal(r, c, revealed) {
	return BoardLogic.cascadeReveal(r, c, rows, cols,
		// Mirrors the server's dfs (GameCreator.js) exactly — a flagged cell no longer blocks the
		// cascade, since a no-guess board's flood-fill neighbours are guaranteed safe by construction,
		// so any flag a cascade reaches was necessarily a mistaken flag on a safe cell. Must stay in
		// lockstep with the server's own predicate or the two sides' move-hash chains would diverge.
		function(rr, cc) { return myState[rr][cc] === UNKNOWN || myState[rr][cc] === FLAGGED; },
		function(rr, cc) {
			myState[rr][cc] = KNOWN;
			revealed.push([rr, cc]);
			return boardCell(rr, cc) === MINE;
		},
		function(rr, cc) { return boardCell(rr, cc); }
	);
}

// Click on a revealed number-cell with the right flag-count → chord (auto-reveal
// the remaining unflagged neighbors). Matches server clearAdjacentIfEnoughFlags.
function applyLocalLeftClick(r, c) {
	if (!myState || !boardDecoder) return { revealed: [], hitMine: false, anyChange: false, clearedFlags: [] };
	var revealed = [];
	var hitMine = false;
	var clearedFlags = [];
	if (myState[r][c] === UNKNOWN) {
		hitMine = localReveal(r, c, revealed);
	} else if (myState[r][c] === KNOWN) {
		var v = boardCell(r, c);
		if (v > 0) {
			var ctx = BoardLogic.chordContext(r, c, rows, cols,
				function(rr, cc) { return myState[rr][cc] === FLAGGED; },
				function(rr, cc) { return myState[rr][cc] === KNOWN && boardCell(rr, cc) === MINE; },
				function(rr, cc) { return myState[rr][cc] === UNKNOWN; }
			);
			if (ctx.flagCount === v) {
				for (var i = 0; i < ctx.covered.length; i++) {
					if (localReveal(ctx.covered[i][0], ctx.covered[i][1], revealed)) hitMine = true;
				}
				// A chord that detonates means a flag here was wrong. Clear every incorrect flag around
				// this number (flagged but not actually a mine) so the mistake is visibly undone.
				// Just the state mutation here — no cellAnims bookkeeping needed: revealAt's call to
				// queueRevealAnimations, right after this returns, diffs the whole board and gives
				// each of these cells its own "settle" placeholder (nothing renders in between, so
				// there's no stale frame to worry about).
				if (hitMine) {
					for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
						if (!dr && !dc) continue;
						var nr = r + dr, nc = c + dc;
						if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
						if (myState[nr][nc] === FLAGGED && boardCell(nr, nc) !== MINE) {
							myState[nr][nc] = UNKNOWN;
							clearedFlags.push([nr, nc]);
						}
					}
				}
			}
		}
	}
	return { revealed: revealed, hitMine: hitMine, anyChange: revealed.length > 0 || clearedFlags.length > 0, clearedFlags: clearedFlags };
}

// One click pipeline for every mode. The board logic is identical — only
// the mode-specific bookkeeping differs (server echo, freeze-on-mine for
// multiplayer; timer start, local win/lose detection, outcome panel for
// solo; rating HUD for puzzles). Splitting this earlier had the rendering
// bug masked by the multiplayer server echo, which silently kicked the
// animation loop; in solo and puzzles there's no echo so the bug shows up.
// Returns whether a real board change happened (a reveal/chord actually touched a cell, or a flag was
// placed/removed) — false for every early-return guard and for a genuine no-op tap (e.g. a plain
// left-click on an already-flagged, protected cell). Main.js's duel-landscape double-tap detection
// (duelIsDoubleTap) uses this to tell "the player tapped twice near the same still-live spot, probably
// meaning to zoom out" apart from "the player is just playing quickly and happened to land two real
// actions close together in time/space" — only the former should trigger a zoom.
function performAction(r, c, asFlag) {
	var mode = currentActionMode();
	if (!mode) return false;
	if (Date.now() < frozenUntil) return false;
	if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
	// Solo is locked until the player hits Start and the countdown finishes.
	if (mode === "solo" && soloSession && !soloSession.started) return false;
	// Racing/casual multiplayer is locked the same way — currentRoom.phase flips to "playing" once
	// at series start and stays there for every round, so on its own it doesn't tell us this
	// SPECIFIC round has gone live yet. roundStartTime is only stamped at GO (see countDown's single
	// authoritative timer in Overlay.js, scheduled from the server's own startDelayMs) and reset to 0
	// at the top of every round (start_game in Main.js), so it's the right signal — matches what the
	// server itself gates on (game.playing flips true after that same server-side delay,
	// ROUND_START_DELAY_MS in minesweeperServer.js), which already silently drops clicks sent before
	// then; this just stops the client from predicting a move locally that the server was always
	// going to ignore.
	if (mode === "multiplayer" && !roundStartTime) return false;
	// Symmetric check for the OTHER end of the round: once game_result lands, the server has already
	// stopped accepting this player's moves (game.playing flips false the instant the round closes —
	// see gameWin/handleRoundTimeUp, minesweeperServer.js) — but nothing here was checking that, and
	// roundStartTime stays truthy right through to the next round's start_game (by design — see the
	// comment on it in the game_result handler, Main.js). So a player who hadn't finished yet could
	// keep clicking on their own board for the full BETWEEN_GAMES_DELAY/RESULT_MODAL_DELAY_MS gap
	// (server-side, 1.2-3s+) the room deliberately holds the finished board on screen for everyone
	// else to see — the client kept optimistically revealing those clicks locally (same prediction as
	// any other move), visually "finishing" a board that no longer counted anywhere. Reported as
	// "I cleared the whole board but progress is stuck on 70%" — not a dropped packet, a real gap:
	// the 70% was an accurate snapshot of the moment the round actually closed, and every click after
	// it silently did nothing server-side while still rendering as if it had.
	if (mode === "multiplayer" && roundResultShown) return false;
	if (mode === "puzzle" && typeof clearPuzzleHints === "function") clearPuzzleHints();
	// Custom-lobby modifiers: "noFlags" blocks flag/right-click; "onlyFlags" lets only the flag tool act.
	if (mode === "multiplayer" && currentRoom && currentRoom.modifier) {
		if (currentRoom.modifier === "noFlags" && asFlag) return false;
		if (currentRoom.modifier === "onlyFlags" && !asFlag) {
			// Flags-only: a left-click can't reveal — it only chords a revealed number (right-click places/
			// removes flags, which auto-chord). A left-click on a covered or flagged cell is a no-op; on a
			// revealed number it routes through the flag tool so the server (which ignores left_click in this
			// mode) handles it as a chord.
			if (!myState || myState[r][c] !== KNOWN) return false;
			asFlag = true;
		}
	}
	focusedR = r;
	focusedC = c;
	var actionResult = null; // reveal/chord result, for emitting any chord-cleared flags to the server
	var didChange = false;
	if (asFlag) {
		// Right-click on a covered cell toggles a flag. Right-click on a
		// revealed number with the matching flag count chords the same way
		// left-click does — both go through revealAt so the local cascade
		// (and any mine-hit detection) is identical regardless of which
		// button triggered it.
		if (myState && myState[r][c] === KNOWN) {
			var chordResult = revealAt(r, c);
			actionResult = chordResult;
			didChange = !!chordResult.anyChange;
			if (mode === "multiplayer" && chordResult.hitMine && currentRoom.deathPenalty) {
				frozenUntil = Date.now() + currentRoom.deathPenalty * 1000;
				startFreezeTick();
			}
			if (mode === "solo") soloOnAfterReveal(chordResult);
		} else {
			// Cell is guaranteed non-KNOWN here (the branch above already claimed KNOWN), so it's
			// either UNKNOWN or FLAGGED — placeFlag always toggles one of those, a real change.
			placeFlag(r, c);
			didChange = true;
			// Placing/toggling a flag is a real first move — start the solo clock.
			if (mode === "solo" && typeof soloStartTimerOnce === "function") soloStartTimerOnce();
			// No-flag-clear challenge (solo + racing only, not puzzles): a flag disqualifies it.
			if (mode === "solo" || mode === "multiplayer") clearNoFlag = false;
		}
	} else {
		// A direct reveal of a covered cell (vs. a chord on a revealed number) disqualifies the
		// "chord-only" clear challenge. Capture before revealAt mutates the cell.
		var wasCovered = myState && myState[r][c] === UNKNOWN;
		var result = revealAt(r, c);
		actionResult = result;
		didChange = !!result.anyChange;
		if (wasCovered && (mode === "solo" || mode === "multiplayer")) clearNoReveal = false;
		if (mode === "multiplayer" && result.hitMine && currentRoom.deathPenalty) {
			frozenUntil = Date.now() + currentRoom.deathPenalty * 1000;
			startFreezeTick();
		}
		if (mode === "solo") soloOnAfterReveal(result);
		if (mode === "puzzle" && typeof notePuzzleReveal === "function") notePuzzleReveal(result);
	}
	if (mode === "multiplayer" || mode === "puzzle") {
		// Racing games track a move-history hash chain (Main.js: localMoveSeq/localMoveHash/
		// localMoveLog) so a dropped packet can be precisely detected and replayed — see
		// recordLocalMove/attachMoveSync there. Puzzle mode doesn't participate (no other player to
		// desync from, and no room-wide draw_board broadcast to bootstrap the round's opening state
		// the way racing has), so its emits are unchanged.
		var trackSync = mode === "multiplayer" && typeof recordLocalMove === "function";
		if (trackSync) recordLocalMove(r, c, asFlag);
		activeGameSocket().emit(asFlag ? "right_click" : "left_click", trackSync ? attachMoveSync({ r: r, c: c, id: id }) : { r: r, c: c, id: id });
		// A chord that detonated cleared its incorrect flags locally — tell the server to drop those
		// flags too (right_click toggles each off) so its per-player board stays in sync. Each of
		// these is its own real move as far as move-history goes too (the server's handleRightClick
		// advances its own seq/hash for every one it applies), so it's tracked the same way.
		if (actionResult && actionResult.clearedFlags) {
			for (var cf = 0; cf < actionResult.clearedFlags.length; cf++) {
				var cfr = actionResult.clearedFlags[cf][0], cfc = actionResult.clearedFlags[cf][1];
				if (trackSync) recordLocalMove(cfr, cfc, true);
				activeGameSocket().emit("right_click", trackSync ? attachMoveSync({ r: cfr, c: cfc, id: id }) : { r: cfr, c: cfc, id: id });
			}
		}
	}
	if (mode === "solo") updateSoloHud();
	else if (mode === "puzzle") updatePuzzleHud();
	// Board content is already fully handled above: revealAt/placeFlag each trigger exactly the
	// repaint their own change needs (cellAnims + the RAF loop for anything animated; a targeted
	// renderPlayerBoard([key]) call, inline, for the two cases with no animation to hang a repaint
	// off of — unflagging, and a chord's cleared-incorrect-flags). All that's left here is the
	// keyboard-focus ring, since focusedR/focusedC were just set above regardless of which branch
	// ran — a plain DOM reposition, not a board repaint.
	updateFocusHighlightOverlay();
	return didChange;
}

function currentActionMode() {
	if (soloSession && !soloSession.finished) return "solo";
	if ((typeof puzzleSession !== "undefined") && puzzleSession && !puzzleSession.finished) return "puzzle";
	if (inRoom && currentRoom && currentRoom.phase === "playing") return "multiplayer";
	return null;
}

// Optimistic flag toggle. prevPlayerState is updated too so the server's
// matching broadcast doesn't re-trigger the animation. startAnimLoop is
// required — without it the cellAnim entry sits at t=0 (invisible flag)
// until the next render frame kicks in for another reason.
function placeFlag(r, c) {
	if (!myState) return;
	var key = r + "," + c;
	if (myState[r][c] === UNKNOWN) {
		myState[r][c] = FLAGGED;
		if (prevPlayerState) prevPlayerState[r][c] = FLAGGED;
		cellAnims[key] = { type: "flag", start: performance.now() };
		startAnimLoop();
		sound.flag && sound.flag();
	} else if (myState[r][c] === FLAGGED) {
		myState[r][c] = UNKNOWN;
		if (prevPlayerState) prevPlayerState[r][c] = UNKNOWN;
		// Unlike placing a flag, removing one has no animation of its own — a "settle" placeholder
		// (not a bare delete) so the RAF loop's own snapshot-before-prune still picks this cell up
		// for one repaint next frame (see SETTLE_DUR, BoardRender.js), same mechanism
		// queueRevealAnimations uses for the identical case (a reveal/chord reverting a cell).
		cellAnims[key] = { type: "settle", start: performance.now() };
		startAnimLoop();
		sound.unflag && sound.unflag();
	}
}

// Optimistic reveal + cascade. queueRevealAnimations starts the RAF loop
// and plays cascade/mine sounds based on the state diff vs. prevPlayerState.
function revealAt(r, c) {
	lastActionCell = { r: r, c: c };
	var result = applyLocalLeftClick(r, c);
	if (result.anyChange) {
		queueRevealAnimations(myState);
		prevPlayerState = cloneState(myState);
	}
	return result;
}

function emitBoardActionAt(clientX, clientY, asFlag) {
	var cell = cellFromClient(clientX, clientY);
	if (!cell) return false;
	focusVisible = false;
	return performAction(cell.r, cell.c, asFlag);
}

function boardClicked(event) {
	event = event || window.event;
	var cell = cellFromClient(event.clientX, event.clientY);
	if (!cell) return false;
	focusVisible = false;
	if (isLeftClick(event)) return performAction(cell.r, cell.c, false);
	if (isRightClick(event)) return performAction(cell.r, cell.c, true);
	return false;
}
function stepFocus(dr, dc, skipRevealed) {
	if (skipRevealed && myState) {
		var nr = focusedR + dr;
		var nc = focusedC + dc;
		while (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
			if (myState[nr][nc] === UNKNOWN) {
				focusedR = nr;
				focusedC = nc;
				return true;
			}
			nr += dr;
			nc += dc;
		}
		return false;
	}
	var tr = Math.max(0, Math.min(rows - 1, focusedR + dr));
	var tc = Math.max(0, Math.min(cols - 1, focusedC + dc));
	if (tr === focusedR && tc === focusedC) return false;
	focusedR = tr;
	focusedC = tc;
	return true;
}

function jumpToNextUnknown(forward) {
	if (!myState) return false;
	var total = rows * cols;
	var start = focusedR * cols + focusedC;
	for (var i = 1; i <= total; i++) {
		var idx = forward ? (start + i) % total : (start - i + total) % total;
		var r = Math.floor(idx / cols);
		var c = idx % cols;
		if (myState[r][c] === UNKNOWN) {
			focusedR = r;
			focusedC = c;
			return true;
		}
	}
	return false;
}
document.addEventListener("keydown", function(e) {
	// Reuse the same gate as click handling — keep the modes-list defined
	// once so adding a new mode (puzzle, future Streak/Storm, …) doesn't
	// have to update both call sites independently.
	if (!currentActionMode()) return;
	var tag = (e.target && e.target.tagName) || "";
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
	// Don't move the board / reveal while a keyboard button-group (puzzle fail actions, result panels)
	// has focus — its own arrow-nav + native Enter own the keys there.
	if (e.target && e.target.closest && e.target.closest(".kbd-btn-group")) return;
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	// Keys are user-rebindable (see Keybindings.js); map the event to an action.
	var action = (typeof keybindings !== "undefined") ? keybindings.actionFor(e) : null;
	if (!action) return;
	var skip = e.shiftKey; // Shift held with movement skips already-revealed cells
	var moved = false;
	if (action === "up") {
		moved = stepFocus(-1, 0, skip);
	} else if (action === "down") {
		moved = stepFocus(1, 0, skip);
	} else if (action === "left") {
		moved = stepFocus(0, -1, skip);
	} else if (action === "right") {
		moved = stepFocus(0, 1, skip);
	} else if (action === "next") {
		e.preventDefault();
		moved = jumpToNextUnknown(!e.shiftKey);
	} else if (action === "reveal") {
		e.preventDefault();
		// Browser key-repeat fires keydown ~30/sec when a key is held; each tick
		// would toggle/re-emit, so reveal/flag are one-press-one-action.
		if (e.repeat) return;
		focusVisible = true;
		performAction(focusedR, focusedC, false);
		return;
	} else if (action === "flag") {
		e.preventDefault();
		if (e.repeat) return;
		focusVisible = true;
		performAction(focusedR, focusedC, true);
		return;
	} else {
		return;
	}
	e.preventDefault();
	focusVisible = true;
	// Pure cursor movement — the board's content hasn't changed, only which cell the ring is on, so
	// skip renderPlayerBoard entirely (no canvas work, not even the cheap dirty-cell kind) and just
	// reposition the ring's own DOM element. This is the hot path arrow-key/Tab navigation runs
	// through, so it's worth not touching the canvas for at all.
	updateFocusHighlightOverlay();
});
function isRightClick(e) {
	return (e.which ? (e.which == 3) : (e.button ? (e.button == 2) : false));
}

function isLeftClick(e) {
	return (e.which ? (e.which == 1) : (e.button ? (e.button == 0) : false));
}

// Cell size derived live from the canvas (same source as the renderer/highlight) so hit-testing stays
// correct after the canvas is resized, instead of a cached copy that can drift.
function getRow(y) { return Math.floor(y / (playerCanvas.height / rows)); }
function getCol(x) { return Math.floor(x / (playerCanvas.width / cols)); }
