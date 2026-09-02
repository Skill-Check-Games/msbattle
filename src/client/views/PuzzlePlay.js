// Rated puzzle play view.
//
// Architecturally identical to Solo: ask the server for a puzzle, receive
// the obfuscated board, render it in the standard game view via the same
// canvas + Input.js stack. Every click goes to the server (left_click /
// right_click) — server validates against the real game state and decides
// outcome via game.win / game.mineHit. No client-trusted "I solved it".

var puzzleSession = null;  // { puzzleId, totalSafe, totalMines, playerRating, startedAt, finished, result, hintUsed, mode, run }
var puzzleStreak = 0;       // solved-in-a-row across the session; resets on miss / fresh login
var puzzleHintClues = [];   // [[r,c], …] — clue cells highlighted by the active hint
var puzzleHintCovered = []; // [[r,c], …] — covered cells whose status the clues determine
var puzzleRunMode = null;   // "streak" | "storm" while a run is active, else null
var puzzleStormTimer = null; // setInterval for storm countdown rendering
var pendingRunFlash = null; // "solved" | "fail" — primed locally on the click, drained by puzzle_board / puzzle_run_end

// Brief board-border pulse (green = solved, red = miss) used in run modes.
// We buffer the next puzzle_board / puzzle_run_end for the flash duration
// so the feedback lands on the OLD board before the new one swaps in.
function flashRunBoard(kind) {
	var wrap = document.querySelector(".game-view.puzzle .board-wrap");
	if (!wrap) return;
	wrap.classList.remove("flash-solved", "flash-fail");
	void wrap.offsetWidth;
	wrap.classList.add(kind === "solved" ? "flash-solved" : "flash-fail");
}

function withPendingRunFlash(fn) {
	if (!pendingRunFlash) { fn(); return; }
	var kind = pendingRunFlash;
	pendingRunFlash = null;
	flashRunBoard(kind);
	setTimeout(fn, 280);
}

// Called from Input.js performAction after a reveal in puzzle mode — primes
// the flash based on the LOCAL outcome so the visual fires immediately,
// before the server's next message arrives. Only "fail" primes the board
// flash; solve feedback is the big solve-counter bump that fires when the
// next puzzle_board installs, which feels punchier than a board outline.
function notePuzzleReveal(result) {
	if (!puzzleSession) return;
	if (puzzleSession.mode !== "streak" && puzzleSession.mode !== "storm") return;
	if (result.hitMine) pendingRunFlash = "fail";
}

// Show the puzzle play view: trigger a server-side pick. Server responds
// with `puzzle_board` (rated/streak/storm flavor), which routes us into the
// game view with puzzle chrome.
function renderPuzzlePlay(mode) {
	mode = mode || "rated";
	puzzleRunMode = (mode === "streak" || mode === "storm" || mode === "daily") ? mode : null;
	// player_div is shared with the multiplayer view, which leaves an
	// .idle class on it during the lobby's "planning" phase. Clear it
	// so the puzzle board isn't faded behind a "Waiting for series" tag.
	var playerDiv = document.getElementById("player_div");
	if (playerDiv) playerDiv.classList.remove("idle");
	var view = document.getElementById("puzzle_play_view");
	if (!view) return;
	view.innerHTML = "";
	var title = document.createElement("h1");
	title.className = "section-page-title";
	title.textContent = mode === "streak" ? "Streak"
		: mode === "storm" ? "Time Trial"
		: mode === "daily" ? "Daily puzzle"
		: "Puzzle Ladder";
	view.appendChild(title);

	if (!account) {
		var msg = document.createElement("p");
		msg.className = "puzzle-play-empty";
		msg.textContent = "Sign in to play — your score is tied to your account.";
		view.appendChild(msg);
		return;
	}
	// Desktop keeps puzzle modes in the normal page (no fullscreen) — a calm solo experience, not a
	// head-to-head match, keeping the navbar/footer in view. Mobile now force-enters fullscreen on
	// request (enterPuzzleMobileFullscreen, Fullscreen.js) — unlike the battle layouts' own mobile
	// fullscreen entry, this does NOT lock landscape: puzzle has real, working layouts in both
	// orientations (portrait and landscape — see style.css), so this is purely about reclaiming the
	// browser chrome's screen space, not "this mode only works turned sideways." Called synchronously
	// here (same requestFullscreen()-needs-a-fresh-user-gesture constraint as the battle layouts) —
	// renderPuzzlePlay runs straight off the router's click-triggered navigation, before any of the
	// async socket round-trips below.
	if (typeof enterPuzzleMobileFullscreen === "function") enterPuzzleMobileFullscreen();
	if (mode === "daily") {
		// Check first — if already attempted today, show the result without
		// starting a fresh play.
		var loading = document.createElement("p");
		loading.className = "puzzle-play-empty";
		loading.textContent = "Checking today's puzzle…";
		view.appendChild(loading);
		socket.emit("puzzle_daily_status");
		return;
	}
	var loading2 = document.createElement("p");
	loading2.className = "puzzle-play-empty";
	loading2.textContent = mode === "streak" ? "Starting streak run…"
		: mode === "storm" ? "Starting Time Trial run…"
		: "Finding a puzzle near your rating…";
	view.appendChild(loading2);
	if (mode === "streak") socket.emit("puzzle_streak_start");
	else if (mode === "storm") socket.emit("puzzle_storm_start");
	else socket.emit("puzzle_next");
}

function exitPuzzle() {
	exitGameFullscreen();
	// If a run is active, tell the server to wrap it up so the score gets
	// recorded as a personal-best update if it qualifies.
	if (puzzleSession && (puzzleSession.mode === "streak" || puzzleSession.mode === "storm") && !puzzleSession.finished) {
		socket.emit("puzzle_run_abandon");
	}
	var wasMarathon = !!(puzzleSession && puzzleSession.marathon);
	puzzleSession = null;
	puzzleRunMode = null;
	stopStormTicker();
	if (puzzleFlashTimer) { clearTimeout(puzzleFlashTimer); puzzleFlashTimer = null; }
	var flash = document.getElementById("puzzle_flash");
	if (flash) { flash.style.display = "none"; flash.classList.remove("playing"); }
	togglePuzzleChrome(false);
	if (gameView) {
		gameView.classList.remove("puzzle");
		gameView.classList.remove("marathon");
	}
	hideOverlay();
	myState = null;
	prevPlayerState = null;
	boardDecoder = null;
	navigate(wasMarathon ? "/admin/marathon-boards" : "/");
}

function togglePuzzleChrome(on, mode, marathon) {
	var card = document.getElementById("puzzle_card");
	if (card) card.style.display = on ? "" : "none";
	var scoreboardCard = document.getElementById("scoreboard_card");
	if (scoreboardCard) scoreboardCard.style.display = on ? "none" : "";
	if (allOpponentsDiv) allOpponentsDiv.style.display = on ? "none" : "";
	if (seriesCard) seriesCard.style.display = on ? "none" : "";
	if (botsCard) botsCard.style.display = on ? "none" : "";
	if (readyButton) readyButton.style.display = on ? "none" : "";
	var rankedTagEl = document.getElementById("ranked_tag");
	if (rankedTagEl) rankedTagEl.style.display = "none";
	var soloCard = document.getElementById("solo_card");
	if (soloCard) soloCard.style.display = "none";

	if (!on) return;
	var ratedPanel = document.getElementById("puzzle_rated_panel");
	var runPanel = document.getElementById("puzzle_run_panel");
	var titleEl = document.getElementById("puzzle_side_title");
	var primaryLabel = document.getElementById("puzzle_run_primary_label");
	var secondaryLabel = document.getElementById("puzzle_run_secondary_label");
	var footLabel = document.getElementById("puzzle_run_foot_label");
	// #puzzle_hint_btn moved out from inside ratedPanel to be its own direct child of #puzzle_card
	// (index.html, so portrait mobile can relocate it independently — see style.css) — it no longer
	// inherits ratedPanel's own display automatically, so mirror the same condition explicitly here.
	var hintBtn = document.getElementById("puzzle_hint_btn");
	if (mode === "streak" || mode === "storm" || mode === "daily") {
		if (ratedPanel) ratedPanel.style.display = "none";
		if (hintBtn) hintBtn.style.display = "none";
		if (runPanel) runPanel.style.display = "";
		if (titleEl) {
			titleEl.textContent = mode === "streak" ? "Streak"
				: mode === "storm" ? "Time Trial"
				: "Daily puzzle";
		}
		if (primaryLabel) {
			primaryLabel.textContent = mode === "daily" ? "Streak" : "Solved";
		}
		if (secondaryLabel) {
			secondaryLabel.textContent = mode === "streak" ? "Level"
				: mode === "storm" ? "Time"
				: "Today";
		}
		if (footLabel) footLabel.textContent = "Best";
	} else {
		if (ratedPanel) ratedPanel.style.display = "";
		if (hintBtn) hintBtn.style.display = "";
		if (runPanel) runPanel.style.display = "none";
		if (titleEl) titleEl.textContent = marathon ? "Marathon board" : "Puzzle Ladder";
	}
	// Marathon boards aren't rated — there's no tier/points to show, and "Next puzzle" on a miss
	// would emit puzzle_next, which would incorrectly hand back an unrelated rated puzzle instead
	// of just letting the player retry this same marathon board.
	var ladderHeadline = document.querySelector(".puzzle-ladder-headline");
	var rankBar = document.querySelector(".puzzle-rank-bar");
	var rankFoot = document.querySelector(".puzzle-rank-foot");
	if (ladderHeadline) ladderHeadline.style.display = marathon ? "none" : "";
	if (rankBar) rankBar.style.display = marathon ? "none" : "";
	if (rankFoot) rankFoot.style.display = marathon ? "none" : "";
	var skipBtn = document.getElementById("puzzle_skip_btn");
	if (skipBtn) skipBtn.style.display = marathon ? "none" : "";
	var failActions = document.getElementById("puzzle_fail_actions");
	// Restart takes the full row (style.css) once Skip is hidden, instead of sitting alone at its
	// usual ~34% width with an empty gap beside it.
	if (failActions) failActions.classList.toggle("marathon-fail-actions", marathon);
	var livesRow = document.getElementById("puzzle_lives_row");
	if (livesRow) livesRow.style.display = marathon ? "" : "none";
	var bestChip = document.getElementById("puzzle_marathon_best");
	if (bestChip) bestChip.style.display = marathon ? "" : "none";
	if (marathon) { updatePuzzleLivesHud(); updatePuzzleMarathonBestChip(); }
}

// 3 hearts, filled left-to-right for lives remaining — marathon boards only (see togglePuzzleChrome).
function updatePuzzleLivesHud() {
	var hearts = document.querySelectorAll("#puzzle_lives_row .puzzle-life");
	if (!hearts.length) return;
	var livesLeft = (puzzleSession && puzzleSession.livesLeft != null) ? puzzleSession.livesLeft : 3;
	hearts.forEach(function(el, i) { el.classList.toggle("lost", i >= livesLeft); });
}

// Live "Best: ★★☆" while playing a marathon board — the same "your standing record is always visible"
// treatment Solo's sidebar gives its best time, so replaying a board doesn't feel like starting from
// nothing. bestStars is null when this is the player's first-ever attempt at this puzzle.
function updatePuzzleMarathonBestChip() {
	var chip = document.getElementById("puzzle_marathon_best");
	if (!chip || !puzzleSession) return;
	chip.innerHTML = "";
	if (puzzleSession.bestStars == null) {
		chip.textContent = "First attempt";
		return;
	}
	var label = document.createTextNode("Best: ");
	chip.appendChild(label);
	chip.appendChild(buildStarGlyphs(puzzleSession.bestStars, "marathon-star-mini"));
}

function updatePuzzleHud() {
	if (!puzzleSession) return;
	if (puzzleSession.mode === "streak" || puzzleSession.mode === "storm") {
		renderPuzzleRunHud();
	} else {
		renderPuzzleRank(puzzleSession.playerRating);
		renderPuzzleStreak();
		updatePuzzleHintButton();
	}
}

function renderPuzzleRunHud() {
	var run = puzzleSession && puzzleSession.run;
	if (!run) return;
	var solvesEl = document.getElementById("puzzle_run_solves");
	if (solvesEl) {
		// Daily uses the streak number as the primary counter; streak/storm
		// use the in-run solve count.
		var newPrimary = run.mode === "daily" ? (run.streak || 0) : (run.solves || 0);
		var prevPrimary = parseInt(solvesEl.textContent, 10);
		if (isNaN(prevPrimary)) prevPrimary = newPrimary;
		solvesEl.textContent = String(newPrimary);
		if (newPrimary > prevPrimary) {
			solvesEl.classList.remove("bump");
			void solvesEl.offsetWidth;
			solvesEl.classList.add("bump");
		}
	}
	var secondary = document.getElementById("puzzle_run_secondary_value");
	if (secondary) {
		if (run.mode === "streak") {
			secondary.textContent = String(run.targetRating || 0);
		} else if (run.mode === "storm") {
			var remaining = Math.max(0, (run.endsAt || 0) - Date.now());
			var sec = Math.ceil(remaining / 1000);
			var m = Math.floor(sec / 60), s = sec % 60;
			secondary.textContent = m + ":" + (s < 10 ? "0" : "") + s;
		} else if (run.mode === "daily") {
			// Trim YYYY-MM-DD → "MMM D" for a friendlier label.
			secondary.textContent = formatDailyDate(run.date || "");
		}
	}
	var bestEl = document.getElementById("puzzle_run_best");
	if (bestEl && account) {
		if (run.mode === "streak") bestEl.textContent = String(account.streakBest || 0);
		else if (run.mode === "storm") bestEl.textContent = String(account.stormBest || 0);
		// Best daily streak — was previously showing "Solved"/"Missed" under a "Best" label, which
		// didn't match the label at all (see showDailyOutcome for the actual result feedback).
		else if (run.mode === "daily") bestEl.textContent = String(run.bestStreak || 0);
	}
}

function formatDailyDate(iso) {
	if (!iso || iso.length < 10) return iso;
	var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
	var y = iso.slice(0, 4), m = parseInt(iso.slice(5, 7), 10), d = parseInt(iso.slice(8, 10), 10);
	return months[m - 1] + " " + d;
}

function startStormTicker() {
	stopStormTicker();
	puzzleStormTimer = setInterval(renderPuzzleRunHud, 250);
}

function stopStormTicker() {
	if (puzzleStormTimer) { clearInterval(puzzleStormTimer); puzzleStormTimer = null; }
}

function renderPuzzleStreak() {
	var chip = document.getElementById("puzzle_streak_chip");
	var countEl = document.getElementById("puzzle_streak_count");
	if (!chip || !countEl) return;
	if (puzzleStreak >= 2) {
		chip.style.display = "";
		countEl.textContent = String(puzzleStreak);
	} else {
		chip.style.display = "none";
	}
}

function clearPuzzleHints() {
	puzzleHintClues = [];
	puzzleHintCovered = [];
}

function updatePuzzleHintButton() {
	var btn = document.getElementById("puzzle_hint_btn");
	if (!btn) return;
	// Re-usable per puzzle — only disabled when the puzzle isn't active.
	// The `used` class still toggles to indicate the Elo penalty is in
	// effect even though the button is still clickable.
	var hintUsed = puzzleSession && puzzleSession.hintUsed;
	btn.disabled = !puzzleSession || puzzleSession.finished;
	btn.classList.toggle("used", !!hintUsed);
}

// Puzzle-specific tier ladder. Wider bands than the ranked ladder so the
// progression feels meaningful at the rate puzzle ratings change (K=20 means
// ~10 points per solve at parity, so a 250-point band fills in ~25 puzzles).
// Ratings start at 800, the top of generated puzzle ratings is ~3000, so the
// ladder spans roughly that range.
// The rated panel IS the Puzzle Ladder: monotonic points → tier + level (Wood…Legend), driven by
// `account.puzzlePoints` (PuzzleLadder.js). The puzzle rating is hidden — it only sets which puzzles
// you're served behind the scenes, it isn't your rank.
function renderPuzzleRank(rating) {
	var tierEl = document.getElementById("puzzle_rank_tier");
	var fillEl = document.getElementById("puzzle_rank_fill");
	var progEl = document.getElementById("puzzle_rank_progress");
	var nextEl = document.getElementById("puzzle_rank_next");
	if (!tierEl) return;
	if (typeof puzzleLadder !== "function") return;
	var pts = (typeof account !== "undefined" && account && typeof account.puzzlePoints === "number") ? account.puzzlePoints : 0;
	var l = puzzleLadder(pts);
	tierEl.textContent = l.atMax ? (l.tierName + " · Max") : (l.tierName + " · Lvl " + l.level);
	tierEl.style.color = l.tierColor;
	if (fillEl) { fillEl.style.width = l.levelPct + "%"; fillEl.style.background = l.tierColor; }
	if (l.atMax) { if (progEl) progEl.textContent = "Maxed"; if (nextEl) nextEl.textContent = ""; }
	else { if (progEl) progEl.textContent = l.pointsIntoLevel + " / " + l.pointsPerLevel + " pts"; if (nextEl) nextEl.textContent = "→ Lvl " + (l.level + 1); }
}

var puzzleFlashTimer = null;

// Brief floating overlay over the board after a solve (only ever called for solved — see
// showPuzzleOutcome, a miss goes straight to setRatedDoneActions instead). Auto-fades into the
// Restart/Next action row (setRatedDoneActions("solved")) instead of silently auto-advancing to the
// next puzzle — on request, so the player decides when to move on rather than losing a few seconds'
// look at the cleared board to a timer. The rating delta lives on the progress bar (floats up next to
// the rating), not in the flash, so the eye is already drawn to the bar as it animates.
function flashPuzzleResult(result) {
	var flash = document.getElementById("puzzle_flash");
	if (!flash) return;
	flash.className = "puzzle-flash " + (result.solved ? "puzzle-flash-solved" : "puzzle-flash-fail");
	flash.style.display = "";
	flash.innerHTML = "";

	var icon = document.createElement("div");
	icon.className = "puzzle-flash-icon";
	icon.textContent = result.solved ? "✓" : "✗";
	flash.appendChild(icon);

	var label = document.createElement("div");
	label.className = "puzzle-flash-label";
	label.textContent = result.solved ? "Solved" : "Mine hit";
	flash.appendChild(label);

	// Re-trigger the CSS keyframes by toggling the class.
	flash.classList.remove("playing");
	void flash.offsetWidth;
	flash.classList.add("playing");

	// Float the Ladder points earned (the bar slides to its new level width to match).
	if (result.pointsEarned > 0) flashPuzzleDelta(result.pointsEarned);

	if (puzzleFlashTimer) clearTimeout(puzzleFlashTimer);
	puzzleFlashTimer = setTimeout(function() {
		flash.style.display = "none";
		flash.classList.remove("playing");
		if (puzzleSession && puzzleSession.finished) {
			setRatedDoneActions("solved");
		}
	}, 1200);
}

// Float a "+13" / "-6" badge next to the rating; pairs visually with the
// bar fill sliding to its new width.
function flashPuzzleDelta(delta) {
	var el = document.getElementById("puzzle_rank_delta");
	if (!el) return;
	el.textContent = (delta > 0 ? "+" : "") + delta;
	el.className = "puzzle-rank-delta " + (delta > 0 ? "gain" : delta < 0 ? "loss" : "flat");
	el.classList.remove("playing");
	void el.offsetWidth;
	el.classList.add("playing");
}

function showPuzzleOutcome(result) {
	// Marathon boards have their own outcome (stars from lives survived, or "out of lives") instead
	// of the Ladder tier/points flash — they aren't rated, and a solve here must NOT auto-advance via
	// the inline flash's puzzle_next (that would silently hand back an unrelated real rated puzzle,
	// since marathon boards are deliberately excluded from every random puzzle-serving query).
	if (puzzleSession && puzzleSession.marathon) {
		showMarathonOutcome(result);
		return;
	}
	// Both outcomes swap the Hint button on the side card for the retry/next action row once the flash
	// settles — the player picks; the same hint-button slot keeps the actions in a stable location
	// instead of dropping a modal over the board.
	if (!result.solved) {
		// No Ladder points lost on a miss — the "Mine hit" flash + fail actions are enough.
		setRatedDoneActions("fail");
		return;
	}
	flashPuzzleResult(result);
}

// Reusable 3-star rating glyphs — the marathon outcome panel, the live "Best" chip while playing, and
// the admin Marathon Boards list all show the same star language, just at different sizes (extraClass
// adds a size modifier alongside the shared marathon-star/filled pair, e.g. "marathon-star-mini").
// Returns a fragment of exactly 3 spans; the caller supplies its own container/wrapper element.
function buildStarGlyphs(count, extraClass) {
	var frag = document.createDocumentFragment();
	for (var i = 1; i <= 3; i++) {
		var star = document.createElement("span");
		star.className = "marathon-star" + (extraClass ? " " + extraClass : "") + (i <= count ? " filled" : "");
		star.textContent = "★";
		frag.appendChild(star);
	}
	return frag;
}

// Marathon result: a modal-style panel (like the run/daily outcomes below) rather than the inline
// Ladder flash, since there's no rating/points to animate and no auto-advance to the next puzzle —
// "Play again" replays THIS board (puzzle_retry), there's no queue of marathon boards to serve next.
function showMarathonOutcome(result) {
	var panel = document.createElement("div");
	panel.className = "result-panel";

	var header = document.createElement("div");
	header.className = "result-header";
	header.textContent = result.solved ? "Board cleared!" : "Out of lives";
	panel.appendChild(header);

	var starsRow = document.createElement("div");
	starsRow.className = "marathon-stars-row";
	var starCount = result.solved ? (result.stars || 0) : 0;
	starsRow.appendChild(buildStarGlyphs(starCount));
	panel.appendChild(starsRow);

	var detail = document.createElement("div");
	detail.className = "result-detail-line";
	detail.style.color = result.solved ? "#4ade80" : "#f87171";
	detail.textContent = result.solved
		? (result.livesLost > 0 ? "Lost " + result.livesLost + " life" + (result.livesLost > 1 ? "s" : "") : "Flawless clear!")
		: "You lost all 3 lives.";
	panel.appendChild(detail);

	// Per-board history: "New best!" when this attempt raised the record, otherwise the standing best
	// (if any) — makes replaying the same board feel like it's building toward something instead of
	// starting fresh every time, the same "beat your own record" language Solo/Streak/Storm already use.
	var bestLine = document.createElement("div");
	bestLine.className = "puzzle-best-line";
	if (result.isNewBest) {
		bestLine.classList.add("puzzle-best-line-new");
		bestLine.textContent = "🏆 New best!";
	} else if (result.bestStars != null) {
		bestLine.textContent = "Best: ";
		bestLine.appendChild(buildStarGlyphs(result.bestStars, "marathon-star-mini"));
		if (result.attempts) {
			var attemptsSpan = document.createElement("span");
			attemptsSpan.className = "marathon-best-attempts";
			attemptsSpan.textContent = " · " + result.attempts + " attempt" + (result.attempts === 1 ? "" : "s");
			bestLine.appendChild(attemptsSpan);
		}
	}
	if (bestLine.childNodes.length || bestLine.textContent) panel.appendChild(bestLine);

	var actions = document.createElement("div");
	actions.className = "result-actions";

	var again = document.createElement("button");
	again.className = "btn btn-primary";
	again.textContent = "Play again";
	again.addEventListener("click", function() {
		hideOverlay();
		if (puzzleSession) socket.emit("puzzle_retry", { puzzleId: puzzleSession.puzzleId });
	});
	actions.appendChild(again);

	var back = document.createElement("button");
	back.className = "btn btn-secondary";
	back.textContent = "Back to boards";
	back.addEventListener("click", exitPuzzle);
	actions.appendChild(back);

	panel.appendChild(actions);
	presentPanel(panel, result.solved ? "win" : "lose");
}

// Swap the hint button for the retry/next action row (or back). Called with "fail" after a rated
// miss, "solved" once the post-solve flash finishes (see flashPuzzleResult — a solve used to just
// auto-emit puzzle_next here instead of waiting for the player, on request), null whenever a fresh
// puzzle_board arrives so the hint comes back for the next attempt.
// Reuses the SAME two buttons for both outcomes rather than building a separate pair — only the
// labels change (Restart/Next after a solve, Try again/Next puzzle after a miss); the layout itself
// is fixed on request — Next always the wide (~66%) prominent action, Restart always the narrow
// borderless icon-over-text one beside it (index.html/style.css), so the row doesn't rearrange
// itself between the two outcomes, only relabels.
function setRatedDoneActions(kind) {
	var hint = document.getElementById("puzzle_hint_btn");
	var actions = document.getElementById("puzzle_fail_actions");
	var retryLabel = document.getElementById("puzzle_retry_label");
	var skipBtn = document.getElementById("puzzle_skip_btn");
	var shown = kind === "fail" || kind === "solved";
	if (hint) hint.style.display = shown ? "none" : "";
	if (actions) {
		// Swaps into the exact spot Hint just vacated (both are direct children of #puzzle_card,
		// index.html) — nothing above this row (the rank/progress panel) moves when this toggles.
		actions.style.display = shown ? "" : "none";
		// Solved-only: tints Next green instead of the app's usual accent (still .btn-primary either
		// way — see style.css) — a "you're done, move on" affordance distinct from an ordinary action.
		actions.classList.toggle("puzzle-fail-actions-solved", kind === "solved");
	}
	if (retryLabel) retryLabel.textContent = kind === "solved" ? "Restart" : "Try again";
	if (skipBtn) skipBtn.textContent = kind === "solved" ? "Next" : "Next puzzle";
	// Next/Skip is always the keyboard-focus target here (focusButtonGroup, Main.js, focuses whichever
	// child carries .btn-primary) — matches it always being the wide, prominent button visually now,
	// in both outcomes, not just on a solve.
	if (shown && typeof focusButtonGroup === "function") focusButtonGroup(actions);
}

// Daily puzzle result panel — shown after the one allowed attempt, or
// when revisiting the daily page after the day's play is done.
function showDailyOutcome(data) {
	stopStormTicker();
	var panel = document.createElement("div");
	panel.className = "result-panel";

	var header = document.createElement("div");
	header.className = "result-header";
	header.textContent = data.solved ? "Daily cleared!" : "Daily missed";
	panel.appendChild(header);

	var line = document.createElement("div");
	line.className = "result-detail-line";
	line.style.color = data.solved ? "#4ade80" : "#f87171";
	line.textContent = "Streak · " + data.streak;
	panel.appendChild(line);

	// Best streak — same "beat your own record" language Solo/Streak/Storm already use, so the daily
	// puzzle doesn't feel like it resets to nothing every single day.
	if (typeof data.bestStreak === "number") {
		var bestLine = document.createElement("div");
		bestLine.className = "puzzle-best-line";
		if (data.streak > 0 && data.streak >= data.bestStreak) {
			bestLine.classList.add("puzzle-best-line-new");
			bestLine.textContent = "🏆 New best streak!";
		} else {
			bestLine.textContent = "Best streak: " + data.bestStreak;
		}
		panel.appendChild(bestLine);
	}

	var foot = document.createElement("div");
	foot.className = "result-foot";
	foot.textContent = data.solved ? "Come back tomorrow for a new puzzle." : "Give it another go — same puzzle, no limit on attempts.";
	panel.appendChild(foot);

	var actions = document.createElement("div");
	actions.className = "result-actions";
	// A miss can be retried immediately (same daily puzzle) instead of being locked out until
	// tomorrow — only a solve ends the day. See puzzle_daily_start's server-side gate.
	if (!data.solved) {
		var again = document.createElement("button");
		again.className = "btn btn-primary";
		again.textContent = "Try again";
		again.addEventListener("click", function() {
			hideOverlay();
			socket.emit("puzzle_daily_start");
		});
		actions.appendChild(again);
	}
	var back = document.createElement("button");
	back.className = data.solved ? "btn btn-primary" : "btn btn-secondary";
	back.textContent = "Back to lobby";
	back.addEventListener("click", exitPuzzle);
	actions.appendChild(back);
	panel.appendChild(actions);

	presentPanel(panel, data.solved ? "win" : "lose");
}

// Player visited /puzzles/daily but already played today — show the
// outcome panel without starting a fresh play.
function showDailyAlreadyDone(data) {
	puzzleSession = {
		mode: "daily",
		finished: true,
		run: { mode: "daily", date: data.date, streak: data.streak, bestStreak: data.bestStreak, lastSolved: data.attempt.solved }
	};
	// Show the side card chrome so the result panel reads naturally.
	hideAllViews();
	if (gameView) {
		gameView.style.display = "";
		clearBattleLayoutClasses(); // see Main.js's clearBattleLayoutClasses comment
		gameView.classList.add("puzzle");
	}
	togglePuzzleChrome(true, "daily");
	updatePuzzleHud();
	showDailyOutcome({ date: data.date, solved: data.attempt.solved, streak: data.streak, bestStreak: data.bestStreak });
}

// Run-end panel (Streak / Storm). Modal-style since the run is done and
// there's no auto-advance to wait for — the player picks retry or back.
function showPuzzleRunOutcome(data) {
	stopStormTicker();
	var panel = document.createElement("div");
	panel.className = "result-panel";

	var header = document.createElement("div");
	header.className = "result-header";
	header.textContent = data.mode === "streak" ? "Streak ended" : "Time's up";
	panel.appendChild(header);

	var scoreLine = document.createElement("div");
	scoreLine.className = "result-detail-line";
	scoreLine.style.color = data.score > data.bestBefore ? "#4ade80" : "#cbd5e1";
	scoreLine.textContent = data.mode === "streak"
		? data.score + " peak rating · " + data.solves + " solved"
		: data.solves + " solved";
	panel.appendChild(scoreLine);

	var detail = document.createElement("div");
	detail.className = "result-foot";
	if (data.score > data.bestBefore) {
		detail.textContent = "New personal best!";
		detail.style.color = "#4ade80";
	} else {
		detail.textContent = "Best: " + data.best;
	}
	panel.appendChild(detail);

	var actions = document.createElement("div");
	actions.className = "result-actions";

	var again = document.createElement("button");
	again.className = "btn btn-primary";
	again.textContent = data.mode === "streak" ? "New streak" : "New Time Trial";
	again.addEventListener("click", function() {
		hideOverlay();
		if (data.mode === "streak") socket.emit("puzzle_streak_start");
		else socket.emit("puzzle_storm_start");
	});
	actions.appendChild(again);

	var back = document.createElement("button");
	back.className = "btn btn-secondary";
	back.textContent = "Back to lobby";
	back.addEventListener("click", exitPuzzle);
	actions.appendChild(back);

	panel.appendChild(actions);
	presentPanel(panel, data.score > data.bestBefore ? "win" : "lose");
}
