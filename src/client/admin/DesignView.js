// Admin "Design" page — a living reference for the visual design system, rendered with the real
// components. Right now it shows the full rank ladder (every tier + sub-tier through Master) using
// the live buildRankBadge(), so the insignia can be reviewed in one place without grinding the ladder.
function renderDesign() {
	var view = document.getElementById("design_view");
	if (!view) return;
	view.innerHTML = "";

	var title = document.createElement("h1");
	title.className = "section-page-title";
	title.textContent = "Design";
	view.appendChild(title);
	var sub = document.createElement("p");
	sub.className = "section-page-sub";
	sub.textContent = "A living reference for the visual design system, rendered with the live components.";
	view.appendChild(sub);

	var section = document.createElement("h2");
	section.className = "design-section-title";
	section.textContent = "Rank ladder";
	view.appendChild(section);
	var note = document.createElement("p");
	note.className = "section-page-sub";
	note.textContent = "Every tier is framed in a point-top hexagon with the sub-tier chevrons (a star for Master), filled with the tier's metallic gradient.";
	view.appendChild(note);

	// Build one rating per sub-tier (Bronze I … Diamond III) plus Master, from the ladder constants.
	var subs = (typeof SUB_TIERS_PER_TIER === "number") ? SUB_TIERS_PER_TIER : 3;
	var width = (typeof SUB_TIER_WIDTH === "number") ? SUB_TIER_WIDTH : 200;
	var base = (typeof TIER_BASE_RATING === "number") ? TIER_BASE_RATING : 0;
	var master = (typeof MASTER_THRESHOLD === "number") ? MASTER_THRESHOLD : 3000;
	var bands = (typeof TIER_BANDS !== "undefined" && TIER_BANDS.length) ? TIER_BANDS.length : 5;

	var ratings = [];
	for (var i = 0; i < bands * subs; i++) ratings.push(base + i * width);
	ratings.push(master);

	var grid = document.createElement("div");
	grid.className = "design-ranks";
	ratings.forEach(function(rating) {
		var info = rankIconFor(rating);
		var cell = document.createElement("div");
		cell.className = "design-rank";
		var badge = buildRankBadge(rating);
		badge.style.fontSize = "26px";
		cell.appendChild(badge);
		var name = document.createElement("div");
		name.className = "design-rank-name";
		name.textContent = info.label + (info.subNum ? " " + info.subNum : "");
		var tier = (typeof tierFor === "function") ? tierFor(rating) : null;
		if (tier && tier.color) name.style.color = tier.color;
		cell.appendChild(name);
		var rt = document.createElement("div");
		rt.className = "design-rank-rating";
		rt.textContent = rating + (rating >= master ? "+" : "");
		cell.appendChild(rt);
		grid.appendChild(cell);
	});
	view.appendChild(grid);

	// --- Admin: set your own rank (testing) -------------------------------------------------------
	function rankLabel(r) { var info = rankIconFor(r); return info.label + (info.subNum ? " " + info.subNum : ""); }
	var setSection = document.createElement("h2");
	setSection.className = "design-section-title";
	setSection.textContent = "Set your rank (admin)";
	view.appendChild(setSection);
	var setNote = document.createElement("p");
	setNote.className = "section-page-sub";
	setNote.textContent = "Set your own rating to preview ranks and test the ranked UI at any tier. Admins only.";
	view.appendChild(setNote);

	var panel = document.createElement("div");
	panel.className = "design-rankset";

	var preview = document.createElement("div");
	preview.className = "design-rankset-current";
	if (typeof account !== "undefined" && account) {
		var ov = overallRating(account);
		var pv = buildRankBadge(ov); pv.style.fontSize = "22px";
		preview.appendChild(pv);
		var pl = document.createElement("span");
		pl.className = "design-rankset-label";
		pl.textContent = "Current: " + rankLabel(ov) + " · " + ov;
		preview.appendChild(pl);
	} else {
		preview.textContent = "Sign in to set your rank.";
	}
	panel.appendChild(preview);

	var controls = document.createElement("div");
	controls.className = "design-rankset-controls";
	var rankSel = document.createElement("select");
	rankSel.className = "design-select";
	ratings.forEach(function(r) {
		var o = document.createElement("option");
		o.value = r; o.textContent = rankLabel(r) + " (" + r + ")";
		rankSel.appendChild(o);
	});
	if (typeof account !== "undefined" && account) {
		var cur = overallRating(account), best = ratings[0];
		ratings.forEach(function(r) { if (r <= cur) best = r; });
		rankSel.value = String(best);
	}
	var styleSel = document.createElement("select");
	styleSel.className = "design-select";
	[["all", "All modes"], ["sprint", "Sprint"], ["standard", "Standard"]].forEach(function(s) {
		var o = document.createElement("option");
		o.value = s[0]; o.textContent = s[1];
		styleSel.appendChild(o);
	});
	var apply = document.createElement("button");
	apply.className = "btn btn-primary";
	apply.textContent = "Apply";
	apply.addEventListener("click", function() {
		if (typeof socket === "undefined") return;
		socket.emit("admin_set_rating", { rating: parseInt(rankSel.value, 10), style: styleSel.value });
	});
	controls.appendChild(rankSel);
	controls.appendChild(styleSel);
	controls.appendChild(apply);
	panel.appendChild(controls);
	view.appendChild(panel);

	view.appendChild(buildRankAnimSection());
	view.appendChild(buildRankResultPreviewSection());
}

// ---- Rank change animation lab: 5 candidate treatments for the moment a player crosses a tier
// boundary — today that moment is sound-only (sound.rankUp/rankDown, playResultMoment in
// MatchPanels.js) plus a generic rating-delta number; there's no animation on the rank badge itself.
// Each candidate below is built on the real buildRankBadge() (Ranking.js), so whichever gets picked
// ships as-is — this is a comparison of live components, not mockups. Same "candidate cards, each
// with its own Play button" pattern SoundLab.js already established for audio; see its own comment
// for why that shape (not sliders) fits "here are some options" better than a single tunable one.

// Crosses a real tier boundary (Bronze III -> Silver I, and back) rather than a same-tier sub-step —
// dramatic enough that the colour/chevron-count change actually reads in a quick preview.
var RANK_ANIM_UP = { from: 590, to: 600 };
var RANK_ANIM_DOWN = { from: 600, to: 590 };

// The target tier's name, fading in a beat after each animation starts (every candidate's own
// timing already lands the new badge by ~0.5-0.6s, so a 0.5s-delayed caption reads as confirming
// what just happened rather than racing it).
function rankLabCaption(rating) {
	var el = document.createElement("div");
	el.className = "ranklab-caption";
	var info = rankIconFor(rating);
	el.textContent = info.label + (info.subNum ? " " + info.subNum : "");
	var t = tierFor(rating);
	if (t && t.color) el.style.color = t.color;
	return el;
}

// 1) Crossfade & Glow — the old badge sinks away, the new one blooms in under its own tier glow.
function playRanklabCrossfade(stage, up) {
	var pair = up ? RANK_ANIM_UP : RANK_ANIM_DOWN;
	stage.innerHTML = "";
	var box = document.createElement("div");
	box.className = "ranklab-badge-box";
	var oldB = buildRankBadge(pair.from); oldB.classList.add("ranklab-crossfade-old");
	var newB = buildRankBadge(pair.to); newB.classList.add("ranklab-crossfade-new");
	box.appendChild(oldB); box.appendChild(newB);
	stage.appendChild(box);
	stage.appendChild(rankLabCaption(pair.to));
}

// 2) Flip Reveal — a real 3D card flip; the old badge is the front face, the new one the (pre-
// rotated) back face, so one rotateY sweep lands the new badge upright and forward-facing.
function playRanklabFlip(stage, up) {
	var pair = up ? RANK_ANIM_UP : RANK_ANIM_DOWN;
	stage.innerHTML = "";
	var box = document.createElement("div");
	box.className = "ranklab-badge-box ranklab-flip";
	var inner = document.createElement("div");
	inner.className = "ranklab-flip-inner";
	var front = document.createElement("div");
	front.className = "ranklab-flip-face";
	front.appendChild(buildRankBadge(pair.from));
	var back = document.createElement("div");
	back.className = "ranklab-flip-face ranklab-flip-face-back";
	back.appendChild(buildRankBadge(pair.to));
	inner.appendChild(front); inner.appendChild(back);
	box.appendChild(inner);
	stage.appendChild(box);
	stage.appendChild(rankLabCaption(pair.to));
}

// 3) Shatter & Reform — the old badge cracks into shards (coloured in the tier being left behind)
// that fly outward and fade, while the new one bursts in from nothing with an overshoot bounce.
function playRanklabShatter(stage, up) {
	var pair = up ? RANK_ANIM_UP : RANK_ANIM_DOWN;
	stage.innerHTML = "";
	var box = document.createElement("div");
	box.className = "ranklab-badge-box ranklab-shatter";
	var oldB = buildRankBadge(pair.from); oldB.classList.add("ranklab-shatter-old");
	var shardColor = (tierFor(pair.from) || {}).color || "#fff";
	var shardCount = 9;
	for (var i = 0; i < shardCount; i++) {
		var shard = document.createElement("div");
		shard.className = "ranklab-shard";
		shard.style.setProperty("--shard-color", shardColor);
		var angle = (i / shardCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
		var dist = 46 + Math.random() * 30;
		shard.style.setProperty("--sx", (Math.cos(angle) * dist).toFixed(1) + "px");
		shard.style.setProperty("--sy", (Math.sin(angle) * dist).toFixed(1) + "px");
		shard.style.setProperty("--srot", Math.round((Math.random() - 0.5) * 420) + "deg");
		shard.style.animationDelay = (Math.random() * 0.05).toFixed(2) + "s";
		box.appendChild(shard);
	}
	box.appendChild(oldB);
	var newB = buildRankBadge(pair.to); newB.classList.add("ranklab-shatter-new");
	box.appendChild(newB);
	stage.appendChild(box);
	stage.appendChild(rankLabCaption(pair.to));
}

// 4) Climb / Drop — the old badge travels off in the direction of the change (up to promote, down
// to demote) with a motion blur, the new one arrives from the opposite edge.
function playRanklabSlide(stage, up) {
	var pair = up ? RANK_ANIM_UP : RANK_ANIM_DOWN;
	stage.innerHTML = "";
	var box = document.createElement("div");
	box.className = "ranklab-badge-box";
	var dir = up ? "up" : "down";
	var oldB = buildRankBadge(pair.from); oldB.classList.add("ranklab-slide-old", dir);
	var newB = buildRankBadge(pair.to); newB.classList.add("ranklab-slide-new", dir);
	box.appendChild(oldB); box.appendChild(newB);
	stage.appendChild(box);
	stage.appendChild(rankLabCaption(pair.to));
}

// 5) Radial Burst — Crossfade's own swap (reused verbatim) plus a ring + particles radiating out in
// the app's existing win/loss colours (--energy-win/--danger).
function playRanklabBurst(stage, up) {
	var pair = up ? RANK_ANIM_UP : RANK_ANIM_DOWN;
	stage.innerHTML = "";
	var box = document.createElement("div");
	box.className = "ranklab-badge-box ranklab-burst " + (up ? "up" : "down");
	var accent = up ? "var(--energy-win)" : "var(--danger)";
	var ring = document.createElement("div");
	ring.className = "ranklab-burst-ring";
	ring.style.setProperty("--ring-color", accent);
	box.appendChild(ring);
	var oldB = buildRankBadge(pair.from); oldB.classList.add("ranklab-crossfade-old");
	var newB = buildRankBadge(pair.to); newB.classList.add("ranklab-crossfade-new");
	box.appendChild(oldB); box.appendChild(newB);
	var particleCount = 10;
	for (var i = 0; i < particleCount; i++) {
		var p = document.createElement("div");
		p.className = "ranklab-particle";
		p.style.setProperty("--pcolor", accent);
		var angle = Math.random() * Math.PI * 2;
		var dist = 30 + Math.random() * 40;
		p.style.setProperty("--px", (Math.cos(angle) * dist).toFixed(1) + "px");
		p.style.setProperty("--py", (Math.sin(angle) * dist).toFixed(1) + "px");
		p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + "s";
		box.appendChild(p);
	}
	stage.appendChild(box);
	stage.appendChild(rankLabCaption(pair.to));
}

var RANK_ANIM_CANDIDATES = [
	{ id: "crossfade", name: "Crossfade & Glow", desc: "The old badge sinks away, the new one blooms in under its own tier glow. Calmest option — closest to the app's existing (unused) rank-icon-in/out CSS.", play: playRanklabCrossfade },
	{ id: "flip", name: "Flip Reveal", desc: "A real 3D card flip — the badge turns over to reveal the new tier on its back face. Reads as a single deliberate reveal rather than a swap.", play: playRanklabFlip },
	{ id: "shatter", name: "Shatter & Reform", desc: "The old badge cracks into shards that fly outward while the new one bursts in with an overshoot bounce. The most dramatic option — best for a big multi-tier jump.", play: playRanklabShatter },
	{ id: "slide", name: "Climb / Drop", desc: "The old badge travels off in the direction of the change — up to promote, down to demote — motion-blurred, while the new one arrives from the opposite edge. Literally climbing or falling the ladder.", play: playRanklabSlide },
	{ id: "burst", name: "Radial Burst", desc: "A plain crossfade swap plus a ring and particles radiating out in the app's existing win/loss colours — bright and outward on a promotion, falling like ash on a demotion. The most \"game-y celebratory\" option.", play: playRanklabBurst }
];

function buildRankAnimCard(candidate) {
	var card = document.createElement("div");
	card.className = "section-card ranklab-card";

	var name = document.createElement("div");
	name.className = "ranklab-card-name";
	name.textContent = candidate.name;
	card.appendChild(name);

	var desc = document.createElement("p");
	desc.className = "ranklab-card-desc";
	desc.textContent = candidate.desc;
	card.appendChild(desc);

	var stage = document.createElement("div");
	stage.className = "ranklab-stage";
	card.appendChild(stage);

	var actions = document.createElement("div");
	actions.className = "ranklab-actions";
	var upBtn = document.createElement("button");
	upBtn.type = "button";
	upBtn.className = "btn btn-secondary";
	upBtn.textContent = "▲ Rank up";
	upBtn.addEventListener("click", function() {
		if (typeof unlockAudio === "function") unlockAudio();
		if (typeof sound !== "undefined") sound.rankUp();
		candidate.play(stage, true);
	});
	var downBtn = document.createElement("button");
	downBtn.type = "button";
	downBtn.className = "btn btn-secondary";
	downBtn.textContent = "▼ Rank down";
	downBtn.addEventListener("click", function() {
		if (typeof unlockAudio === "function") unlockAudio();
		if (typeof sound !== "undefined") sound.rankDown();
		candidate.play(stage, false);
	});
	actions.appendChild(upBtn);
	actions.appendChild(downBtn);
	card.appendChild(actions);

	return card;
}

function buildRankAnimSection() {
	var section = document.createElement("div");

	var head = document.createElement("h2");
	head.className = "design-section-title";
	head.textContent = "Rank change animation (candidates)";
	section.appendChild(head);

	var sub = document.createElement("p");
	sub.className = "section-page-sub";
	sub.textContent = "Crossing a tier boundary today only plays a sound (sound.rankUp/rankDown) — there's no animation on the badge itself. Five candidates below, each built on the real rank badge (Ranking.js) so whichever is picked ships as-is; every Preview also plays the real fanfare, so you're judging the whole moment, not just the visual. Bronze III → Silver I (and back), a real tier boundary so the colour/chevron change actually reads.";
	section.appendChild(sub);

	var grid = document.createElement("div");
	grid.className = "ranklab-grid";
	RANK_ANIM_CANDIDATES.forEach(function(candidate) {
		grid.appendChild(buildRankAnimCard(candidate));
	});
	section.appendChild(grid);

	return section;
}

// ---- Post-game rank-up/down modal, in context ----------------------------------------------------
// Testing this normally means actually climbing/dropping a real tier in a real ranked match —
// tedious. This section calls the REAL showRankedResult() (MatchPanels.js) with a synthetic
// tier-crossing standings payload, so the real modal (including the Climb/Drop badge animation
// shipped in it) shows up exactly as it would after a genuine match, on demand.

// One standings entry per rank 1..totalPlayers, "you" placed at myRank with the given rating/delta —
// every other rank gets a plausible filler bot. Kept separate from RANK_ANIM_CANDIDATES' own preview
// data (that section never touches real account/standings state at all, just the badge in isolation).
var RESULT_PREVIEW_NAMES = ["Foxglove", "Ironclad99", "Nimbus", "Quartzite", "Redwood", "Silversmith"];
function buildResultPreviewStandings(totalPlayers, myRank, myRating, myDelta) {
	var entries = [];
	var nameIdx = 0;
	for (var rank = 1; rank <= totalPlayers; rank++) {
		if (rank === myRank) {
			entries.push({
				id: id, name: (typeof account !== "undefined" && account && account.name) || "You",
				rank: rank, rating: myRating, ratingDelta: myDelta, provisional: false,
				finished: true, finishMs: 42000, progress: 1
			});
		} else {
			// A couple of trailing ranks in the 7-player case show as still-racing (unfinished) —
			// closer to what a real standings list actually looks like than everyone neatly finished.
			var finished = rank <= Math.max(2, totalPlayers - 2);
			entries.push({
				id: "preview-p" + rank, name: RESULT_PREVIEW_NAMES[nameIdx++ % RESULT_PREVIEW_NAMES.length],
				rank: rank, rating: 500 + (totalPlayers - rank) * 15, ratingDelta: rank <= 2 ? 8 : -6,
				provisional: false, finished: finished, finishMs: finished ? 18000 + rank * 6000 : null,
				progress: finished ? 1 : 0.4 + rank * 0.05
			});
		}
	}
	return entries;
}

// Shows the real modal, then immediately undoes the real account mutation it just made
// (updateRatingFromStandings, inside showRankedResult, writes account.ratingSprint/provisional for
// real — necessary for the modal to be genuine, but has to be cleaned up right after so the admin's
// own topbar rating doesn't end up showing this preview's fake number) and swaps the modal's own
// action buttons for a single "Close preview" — "Play another" would actually queue a real ranked
// match and "Leave" would emit a real leave_room, neither of which makes sense with no real room
// behind this.
function previewRankedResultModal(up, totalPlayers) {
	if (typeof account === "undefined" || !account) return;
	if (typeof showRankedResult !== "function") return;
	if (typeof unlockAudio === "function") unlockAudio();

	var pair = up ? RANK_ANIM_UP : RANK_ANIM_DOWN;
	var isDuo = totalPlayers === 2;
	var myRank = up ? 1 : (isDuo ? 2 : 5);
	var standings = buildResultPreviewStandings(totalPlayers, myRank, pair.to, pair.to - pair.from);
	var winner = standings.filter(function(s) { return s.rank === 1; })[0];

	var realRatingSprint = account.ratingSprint;
	var realProvisional = account.provisional;
	account.ratingSprint = pair.from;

	// The result modal (#board_overlay) lives nested inside #game_view in the DOM — invisible on this
	// (or any non-game) page no matter what its own display is, since #game_view itself is display:none
	// here (hideAllViews, Router.js). Show it just enough for the modal's ancestor chain to actually
	// render, restoring its real hidden/shown state when the preview closes.
	var gameView = document.getElementById("game_view");
	var gameViewWasHidden = gameView && gameView.style.display === "none";
	if (gameViewWasHidden) gameView.style.display = "";

	showRankedResult({
		ranked: true,
		mode: isDuo ? "sprint_duo" : "sprint_six",
		winnerId: winner.id,
		standings: standings
	});

	account.ratingSprint = realRatingSprint;
	account.provisional = realProvisional;
	if (typeof renderRatingBadge === "function") renderRatingBadge();
	if (typeof renderHomeRankChips === "function") renderHomeRankChips();

	var actions = document.querySelector(".board-overlay-panel .result-actions");
	if (actions) {
		actions.innerHTML = "";
		var close = document.createElement("button");
		close.type = "button";
		close.className = "btn btn-primary";
		close.textContent = "Close preview";
		close.addEventListener("click", function() {
			hideOverlay();
			if (gameViewWasHidden && gameView) gameView.style.display = "none";
		});
		actions.appendChild(close);
		try { close.focus({ preventScroll: true }); } catch (e) {}
	}
}

function buildRankResultPreviewSection() {
	var section = document.createElement("div");

	var head = document.createElement("h2");
	head.className = "design-section-title";
	head.textContent = "Post-game rank-up/down modal (in context)";
	section.appendChild(head);

	var sub = document.createElement("p");
	sub.className = "section-page-sub";
	sub.textContent = "Opens the real post-game result modal with a fake tier-crossing match, instead of having to actually climb or drop a tier in a real ranked match to see it. This is the exact production modal (showRankedResult) with the Climb/Drop badge animation above already wired in — not a mockup. \"Close preview\" stands in for Play another/Leave, which would otherwise try to act on a real match that doesn't exist here.";
	section.appendChild(sub);

	var card = document.createElement("div");
	card.className = "section-card ranklab-card";

	[
		{ label: "1v1 result", players: 2 },
		{ label: "7-player result", players: 7 }
	].forEach(function(group) {
		var row = document.createElement("div");
		row.className = "ranklab-preview-row";
		var lbl = document.createElement("span");
		lbl.className = "ranklab-preview-row-label";
		lbl.textContent = group.label;
		row.appendChild(lbl);
		var actions = document.createElement("div");
		actions.className = "ranklab-actions";
		var upBtn = document.createElement("button");
		upBtn.type = "button";
		upBtn.className = "btn btn-secondary";
		upBtn.textContent = "▲ Rank up";
		upBtn.addEventListener("click", function() { previewRankedResultModal(true, group.players); });
		var downBtn = document.createElement("button");
		downBtn.type = "button";
		downBtn.className = "btn btn-secondary";
		downBtn.textContent = "▼ Rank down";
		downBtn.addEventListener("click", function() { previewRankedResultModal(false, group.players); });
		actions.appendChild(upBtn);
		actions.appendChild(downBtn);
		row.appendChild(actions);
		card.appendChild(row);
	});

	section.appendChild(card);
	return section;
}
