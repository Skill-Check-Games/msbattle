// Profile view: rating + tier + win-rate summary card.
//
// Renders from `account` (populated by the server on sign-in) and the cached
// rating fields the server updates after each ranked match. The rank chips on
// the home page (renderHomeRankChips) read the same data.

// The fixed mine layout every skin preview renders — two mines, left of center; COVERED cells
// (not revealed/exploded, so the unknown-cell gradient/border shows too, not just clue numbers)
// are the two mines PLUS (0,0), an ordinary safe cell simply not clicked yet — same as a real
// in-progress board, where a covered cell doesn't necessarily mean a mine:
//   X X 1
//   X 2 1
//   1 1 0
// A real mini board (not the flat 4-swatch strip this replaced) so a skin's actual tile
// rendering — gradients, borders, the mine icon, number glow — reads clearly at a glance. Fixed
// (not random) so every skin paints the identical layout and only the palette differs. Shared by
// the Shop tile, the skin picker below, and — screenshotted — the generated Stripe product images
// (scripts/render-skin-preview-images.js navigates to a real page and grabs this exact canvas, so
// there's one rendering to keep in sync, not two).
var SKIN_PREVIEW_MINES = [[0, 1], [1, 0]];
var SKIN_PREVIEW_COVERED = [[0, 0], [0, 1], [1, 0]]; // mines + one plain not-yet-clicked cell
function cellInList(list, r, c) {
	return list.some(function(m) { return m[0] === r && m[1] === c; });
}
function skinPreviewCellAt(r, c) {
	if (cellInList(SKIN_PREVIEW_MINES, r, c)) return MINE;
	var count = 0;
	BoardLogic.forEachNeighbour(r, c, 3, 3, function(nr, nc) {
		if (cellInList(SKIN_PREVIEW_MINES, nr, nc)) count++;
	});
	return count;
}
// Built lazily inside the function below, not at module-eval time: KNOWN/UNKNOWN are page globals
// assigned by Main.js, which loads AFTER this file (see the sentinel-timing comment in
// BoardRender.js) — referencing them here at the top level would throw ReferenceError on page load.
function skinPreviewState() {
	var state = [];
	for (var r = 0; r < 3; r++) {
		var row = [];
		for (var c = 0; c < 3; c++) row.push(cellInList(SKIN_PREVIEW_COVERED, r, c) ? UNKNOWN : KNOWN);
		state.push(row);
	}
	return state;
}

// cellPx defaults to the small in-app swatch size (Shop tile / skin picker); the preview-image
// generator script passes a much larger one for a crisp standalone image.
function buildSkinPreview(id, cellPx) {
	var canvas = buildCellCanvas(3, 3, cellPx || 22, "skin-preview-board");
	new BoardView(canvas, 3, 3, skinPreviewState(), skinPreviewCellAt, { skin: id }).draw();
	var wrap = document.createElement("span");
	wrap.className = "skin-preview";
	wrap.appendChild(canvas);
	return wrap;
}

// True iff this cosmetic (avatar "img:<id>"/color/anon/mine, or skin id) is free-by-default (not
// in the shop catalog) or already owned. Shared by the Settings pickers below and the Shop grid.
function shopItemUnlocked(kind, id) {
	if (typeof ShopCatalog === "undefined" || !ShopCatalog.isPurchasable(kind, id)) return true;
	return !!(account && account.ownedItems && account.ownedItems.indexOf(id) !== -1);
}
function shopPriceLabel(id) {
	var item = typeof ShopCatalog !== "undefined" && ShopCatalog.byId(id);
	return item ? "$" + (item.priceCents / 100).toFixed(2) : "";
}
// The avatar swatch grid — its own function (rather than inline in renderAppearance) so it can be
// rebuilt in place after a purchase, the same way buildSkinOptionsGrid/renderAvatarModalSkins works.
function buildAvatarSwatchesGrid() {
	var swatches = document.createElement("div"); swatches.className = "avatar-swatches";
	var current = (account.avatarColor || DEFAULT_AVATAR).toLowerCase();
	// Unowned image presets render locked (dimmed, priced, still clickable) instead of being hidden, so
	// the picker doubles as a discovery surface for the shop; clicking one opens the purchase modal
	// instead of selecting it. Free values (anon/mine/the default flag colour) are never gated —
	// shopItemUnlocked returns true for anything not in the catalog.
	function swatch(value) {
		var unlocked = shopItemUnlocked("avatar", value);
		var b = document.createElement("button"); b.type = "button";
		b.className = "avatar-swatch" + (value.toLowerCase() === current ? " active" : "") + (unlocked ? "" : " locked");
		b.dataset.color = value;
		b.appendChild(buildAvatarCanvas(value, 50));
		if (!unlocked) {
			var price = document.createElement("span"); price.className = "shop-lock-badge"; price.textContent = "🔒";
			b.appendChild(price);
		}
		b.addEventListener("click", function() {
			if (!unlocked) { openItemPurchaseModal(ShopCatalog.byId(value)); return; }
			setAvatarColor(value);
		});
		swatches.appendChild(b);
	}
	// Sorted so everything owned from the start (anon, mine, the default flag colour) comes before
	// anything purchasable (currently just the image presets) — sorted by lock status, not by which
	// array a value came from, so a future purchasable colour would slot in the same way an image does.
	var allAvatarValues = ["anon", "mine"]
		.concat(AVATAR_COLORS)
		.concat(typeof AVATAR_IMAGES !== "undefined" ? Object.keys(AVATAR_IMAGES).map(function(id) { return "img:" + id; }) : []);
	var unlockedValues = allAvatarValues.filter(function(v) { return shopItemUnlocked("avatar", v); });
	var lockedValues = allAvatarValues.filter(function(v) { return !shopItemUnlocked("avatar", v); });
	unlockedValues.concat(lockedValues).forEach(swatch);
	return swatches;
}

// Re-render-only counterpart, mirroring renderAvatarModalSkins — refreshes the swatch grid in place
// (active/locked state) without rebuilding the whole modal. A no-op if the modal isn't open.
function renderAvatarModalAvatars() {
	var container = document.getElementById("avatar_modal_avatars");
	if (!container) return;
	container.innerHTML = "";
	container.appendChild(buildAvatarSwatchesGrid());
}

// Small in-place "buy this?" confirmation opened from inside the avatar-editor modal instead of
// navigating to /shop — clicking a locked item shouldn't kick the player out of what they were
// doing just to see its price. Reuses Shop.js's buyShopItem (the same checkout POST + Stripe
// redirect, or the admin-only fake-grant bypass) so the purchase logic itself isn't duplicated —
// only a real Stripe payment actually navigates away, same as it would from the Shop page.
function openItemPurchaseModal(item) {
	if (!item) return;
	var modal = document.getElementById("item_purchase_modal");
	if (!modal) {
		modal = document.createElement("div");
		modal.id = "item_purchase_modal";
		modal.className = "cr-modal";
		modal.setAttribute("hidden", "");
		modal.innerHTML =
			'<div class="cr-backdrop" data-purchase-close></div>' +
			'<div class="cr-dialog item-purchase-dialog" role="dialog" aria-modal="true" aria-labelledby="item_purchase_title">' +
				'<div class="cr-dialog-head"><h2 id="item_purchase_title">Buy this item</h2>' +
				'<button class="cr-close" type="button" data-purchase-close aria-label="Close">×</button></div>' +
				'<div id="item_purchase_body"></div>' +
			'</div>';
		document.body.appendChild(modal);
		modal.addEventListener("click", function(e) { if (e.target.closest("[data-purchase-close]")) modal.setAttribute("hidden", ""); });
		document.addEventListener("keydown", function(e) { if (e.key === "Escape" && !modal.hasAttribute("hidden")) modal.setAttribute("hidden", ""); });
	}
	var body = modal.querySelector("#item_purchase_body");
	body.innerHTML = "";
	var preview = document.createElement("div"); preview.className = "item-purchase-preview";
	if (item.kind === "avatar" && typeof buildAvatarCanvas === "function") preview.appendChild(buildAvatarCanvas(item.id, 72));
	else if (item.kind === "skin" && typeof buildSkinPreview === "function") preview.appendChild(buildSkinPreview(item.id));
	body.appendChild(preview);
	var name = document.createElement("div"); name.className = "item-purchase-name"; name.textContent = item.label;
	body.appendChild(name);
	var buyBtn = document.createElement("button");
	buyBtn.type = "button"; buyBtn.className = "btn btn-primary item-purchase-btn";
	buyBtn.textContent = shopPriceLabel(item.id);
	buyBtn.addEventListener("click", function() {
		if (typeof buyShopItem === "function") buyShopItem(item, buyBtn);
	});
	body.appendChild(buyBtn);
	modal.removeAttribute("hidden");
}
// Closes the purchase modal — called once an item is actually owned (markOwnedLocally in Shop.js),
// so a real Stripe purchase never gets here (that's a page redirect) but the admin fake-grant does.
function closeItemPurchaseModal() {
	var modal = document.getElementById("item_purchase_modal");
	if (modal) modal.setAttribute("hidden", "");
}

// The skin-option button grid: one button per BOARD_SKIN_LIST entry, each showing a tiny palette
// swatch (buildSkinPreview), label/blurb, and — for a purchasable-but-unowned skin (currently just
// "tactical"/"gold" — see ShopCatalog.js) — a locked/priced state instead of being hidden, so the
// picker doubles as shop discovery. Clicking a locked one goes to the Shop instead of selecting it.
// The only picker for it lives in the avatar-editor modal (renderAvatarModalSkins, below) — there
// used to be a second copy on the Settings page too, dropped as redundant once the modal covered it.
function buildSkinOptionsGrid() {
	var grid = document.createElement("div");
	grid.className = "skin-options";
	BOARD_SKIN_LIST.forEach(function(id) {
		var s = BOARD_SKINS[id];
		var unlocked = shopItemUnlocked("skin", id);
		var btn = document.createElement("button");
		btn.type = "button";
		btn.className = "skin-option" + (id === localBoardSkin ? " active" : "") + (unlocked ? "" : " locked");
		btn.appendChild(buildSkinPreview(id));
		var meta = document.createElement("span");
		meta.className = "skin-meta";
		var name = document.createElement("span"); name.className = "skin-name"; name.textContent = s.label;
		var blurb = document.createElement("span"); blurb.className = "skin-blurb"; blurb.textContent = s.blurb;
		meta.appendChild(name); meta.appendChild(blurb);
		if (!unlocked) {
			var price = document.createElement("span"); price.className = "shop-lock-badge"; price.textContent = "🔒 " + shopPriceLabel(id);
			meta.appendChild(price);
		}
		btn.appendChild(meta);
		btn.addEventListener("click", function() {
			if (!unlocked) { openItemPurchaseModal(ShopCatalog.byId(id)); return; }
			if (typeof setBoardSkin === "function") setBoardSkin(id);
		});
		grid.appendChild(btn);
	});
	return grid;
}

// The picker, inside the avatar-editor modal (#avatar_modal_skins) — re-render-only, so it can be
// called both when the modal (re)opens and whenever the skin changes elsewhere (setBoardSkin calls
// this too, so a selection made in the modal itself updates its own "active" state). A no-op if the
// modal hasn't been built yet (container isn't in the DOM) — harmless to call while hidden too.
function renderAvatarModalSkins() {
	var container = document.getElementById("avatar_modal_skins");
	if (!container) return;
	container.innerHTML = "";
	container.appendChild(buildSkinOptionsGrid());
}

// Profile renders from the account cache plus the most recent leaderboard snapshot.
// The profile is split into three tabs (the page had grown large): Overview (identity + lifetime/
// ranked/puzzle stats), Matches (rating graph + recent games/replays), and Achievements.
var PROFILE_TABS = [
	{ id: "overview", label: "Overview", panel: "profile_tab_overview" },
	{ id: "matches", label: "Matches", panel: "profile_tab_matches" },
	{ id: "achievements", label: "Achievements", panel: "profile_tab_achievements" }
];
var profileTab = "overview"; // remembered across re-renders within a session

function buildProfileTabs() {
	var bar = document.getElementById("profile_tabs");
	if (!bar || bar.dataset.built) return;
	PROFILE_TABS.forEach(function(t) {
		var b = document.createElement("button"); b.type = "button"; b.className = "lb-tab"; b.textContent = t.label;
		b.dataset.tab = t.id;
		b.addEventListener("click", function() { selectProfileTab(t.id); });
		bar.appendChild(b);
	});
	bar.dataset.built = "1";
}

// Show one panel, hide the others, and mark the matching tab button active.
function selectProfileTab(id) {
	profileTab = id;
	PROFILE_TABS.forEach(function(t) {
		var panel = document.getElementById(t.panel);
		if (panel) panel.style.display = t.id === id ? "" : "none";
	});
	var bar = document.getElementById("profile_tabs");
	if (bar) { var btns = bar.querySelectorAll(".lb-tab"); for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", btns[i].dataset.tab === id); }
}

function renderProfile() {
	// Board skin + controls moved to the Settings page (showSettingsView renders them).
	var card = document.getElementById("profile_card");
	if (!card) return;
	var tabsBar = document.getElementById("profile_tabs");
	if (!account) {
		// Signed out: no tabs — just the overview panel with a sign-in prompt.
		if (tabsBar) tabsBar.style.display = "none";
		selectProfileTab("overview");
		card.innerHTML = "";
		var p = document.createElement("p");
		p.textContent = "Sign in to see your rating, win rate, and recent matches.";
		card.appendChild(p);
		var ac0 = document.getElementById("achievements_card");
		if (ac0) ac0.innerHTML = "";
		["rating_history_card", "recent_games_card"].forEach(function(id) {
			var el = document.getElementById(id); if (el) el.style.display = "none";
		});
		return;
	}
	buildProfileTabs();
	if (tabsBar) tabsBar.style.display = "";
	card.innerHTML = "";
	profileStats = {}; // cleared up front — avoids showing a previous account's stale history aggregates
	// (e.g. Best daily streak below) for the moment before get_match_history's fresh reply lands.

	// --- Identity: avatar + country flag, name + member since. No single "overall" rank badge here
	// any more — Sprint and Standard are both shown as their own ladder cards below, and a combined
	// "best across modes" headline was redundant with (and inconsistent with) those. ---
	var summary = document.createElement("div");
	summary.className = "profile-summary";
	if (typeof buildAvatarChip === "function") {
		var chip = buildAvatarChip(account.avatarColor || DEFAULT_AVATAR, account.country || null, 76);
		chip.classList.add("profile-avatar");
		summary.appendChild(chip);
	}
	var text = document.createElement("div");
	text.className = "profile-summary-text";
	var nameLine = document.createElement("div");
	nameLine.className = "profile-summary-name";
	nameLine.textContent = myName || (account.name || "You");
	text.appendChild(nameLine);
	if (account.createdAt) {
		var since = document.createElement("div");
		since.className = "profile-summary-since";
		since.textContent = "Member since " + formatMemberSince(account.createdAt);
		text.appendChild(since);
	}
	summary.appendChild(text);
	card.appendChild(summary);

	// --- Lifetime stats ---
	var played = account.played || 0, wins = account.wins || 0;
	var winRate = played > 0 ? Math.round((wins / played) * 100) + "%" : "0%";
	var stats = document.createElement("div");
	stats.className = "profile-stats";
	stats.appendChild(profileStat("Played", String(played)));
	stats.appendChild(profileStat("Wins", String(wins)));
	stats.appendChild(profileStat("Win rate", winRate));
	// Best daily streak, not the current one — profileStats.dailyStreakBest fills in once
	// get_match_history's aggregates arrive (renderAchievements re-renders on the same event; this
	// falls back to the live streak in the meantime, same "shows instantly, corrects itself" pattern).
	var dailyBest = Math.max((profileStats && profileStats.dailyStreakBest) || 0, account.dailyStreak || 0);
	stats.appendChild(profileStat("Best daily streak", "🔥 " + dailyBest));
	card.appendChild(stats);

	// --- Ranked ladders (one card per mode; Standard first — it's the denser, "main" ruleset) ---
	card.appendChild(profileSectionTitle("Ranked ladders"));
	var ladders = document.createElement("div");
	ladders.className = "profile-ladders";
	ladders.appendChild(profileLadderCard("Standard", account.ratingStandard || 0));
	ladders.appendChild(profileLadderCard("Sprint", account.ratingSprint || 0));
	card.appendChild(ladders);

	// --- Puzzles: same ladder-card treatment as ranked, plus the supporting stats beneath it ---
	card.appendChild(profileSectionTitle("Puzzles"));
	var pzLadders = document.createElement("div");
	pzLadders.className = "profile-ladders";
	pzLadders.appendChild(profilePuzzleLadderCard(account.puzzlePoints || 0));
	card.appendChild(pzLadders);
	var pz = document.createElement("div");
	pz.className = "profile-stats";
	pz.appendChild(profileStat("Solved", (account.puzzlesSolved || 0) + " / " + (account.puzzlesAttempted || 0)));
	pz.appendChild(profileStat("Best streak", String(account.streakBest || 0)));
	pz.appendChild(profileStat("Best Time Trial", String(account.stormBest || 0)));
	card.appendChild(pz);

	renderAchievements();
	// Rating graph + recent games (incl. replay links) + achievement aggregates come from
	// get_match_history → renderMatchHistory.
	if (typeof socket !== "undefined") socket.emit("get_match_history");
	selectProfileTab(profileTab); // restore the active tab (defaults to Overview)
}

// Read-only profile for someone who ISN'T the signed-in player — reached from leaderboard rows
// (/profile?id=<userId>). A trimmed-down version of the Overview tab above (identity, lifetime
// stats, ranked ladders, puzzles, free-play bests) built from the get_public_profile payload
// instead of `account` — no tabs, no achievements/match history/rating graph, no edit-name pencil,
// nothing that assumes this is "you". Reuses the same profileStat/profileLadderCard/etc. helpers
// so it stays visually consistent with the real profile page without duplicating their markup.
function renderPublicProfile(userId) {
	var card = document.getElementById("profile_card");
	if (!card) return;
	var tabsBar = document.getElementById("profile_tabs");
	if (tabsBar) tabsBar.style.display = "none";
	["rating_history_card", "recent_games_card"].forEach(function(id) {
		var el = document.getElementById(id); if (el) el.style.display = "none";
	});
	var ac = document.getElementById("achievements_card");
	if (ac) ac.innerHTML = "";

	card.innerHTML = "";
	var loading = document.createElement("p");
	loading.textContent = "Loading player…";
	card.appendChild(loading);

	if (typeof socket === "undefined" || !userId) { loading.textContent = "Player not found."; return; }
	socket.emit("get_public_profile", { userId: userId });
	publicProfilePending = userId;
}

// Set right before the get_public_profile emit above; onPublicProfile (Main.js's public_profile
// handler) checks this still matches the reply's userId before rendering — guards against a stale
// reply landing after the player has already navigated to a different profile or away entirely.
var publicProfilePending = null;

function renderPublicProfileData(profile) {
	var card = document.getElementById("profile_card");
	if (!card) return;
	card.innerHTML = "";
	if (!profile) {
		var msg = document.createElement("p");
		msg.textContent = "Player not found.";
		card.appendChild(msg);
		return;
	}

	var back = document.createElement("a");
	back.className = "btn btn-ghost learn-back-btn profile-public-back";
	back.href = "/leaderboard";
	back.textContent = "← Back to leaderboard";
	card.appendChild(back);

	var summary = document.createElement("div");
	summary.className = "profile-summary";
	if (typeof buildAvatarChip === "function") {
		var chip = buildAvatarChip(profile.avatarColor || DEFAULT_AVATAR, profile.country || null, 76);
		chip.classList.add("profile-avatar");
		summary.appendChild(chip);
	}
	var text = document.createElement("div");
	text.className = "profile-summary-text";
	var nameLine = document.createElement("div");
	nameLine.className = "profile-summary-name";
	nameLine.textContent = profile.name || "Player";
	text.appendChild(nameLine);
	if (profile.createdAt) {
		var since = document.createElement("div");
		since.className = "profile-summary-since";
		since.textContent = "Member since " + formatMemberSince(profile.createdAt);
		text.appendChild(since);
	}
	summary.appendChild(text);
	card.appendChild(summary);

	var played = profile.played || 0, wins = profile.wins || 0;
	var winRate = played > 0 ? Math.round((wins / played) * 100) + "%" : "0%";
	var stats = document.createElement("div");
	stats.className = "profile-stats";
	stats.appendChild(profileStat("Played", String(played)));
	stats.appendChild(profileStat("Wins", String(wins)));
	stats.appendChild(profileStat("Win rate", winRate));
	card.appendChild(stats);

	card.appendChild(profileSectionTitle("Ranked ladders"));
	var ladders = document.createElement("div");
	ladders.className = "profile-ladders";
	ladders.appendChild(profileLadderCard("Standard", profile.ratingStandard || 0));
	ladders.appendChild(profileLadderCard("Sprint", profile.ratingSprint || 0));
	card.appendChild(ladders);

	card.appendChild(profileSectionTitle("Puzzles"));
	var pzLadders = document.createElement("div");
	pzLadders.className = "profile-ladders";
	pzLadders.appendChild(profilePuzzleLadderCard(profile.puzzlePoints || 0));
	card.appendChild(pzLadders);
	var pz = document.createElement("div");
	pz.className = "profile-stats";
	pz.appendChild(profileStat("Solved", (profile.puzzlesSolved || 0) + " / " + (profile.puzzlesAttempted || 0)));
	pz.appendChild(profileStat("Best streak", String(profile.streakBest || 0)));
	pz.appendChild(profileStat("Best Time Trial", String(profile.stormBest || 0)));
	card.appendChild(pz);
}

// Avatar (recolored flag) palette + country dropdown. Choices persist via set_avatar / set_country and
// update the header chip in place (no full re-render → no refetch/toast churn).
function renderAppearance() {
	var wrap = document.createElement("div");
	wrap.className = "appearance";

	// Flag first — its flag becomes the avatar's pennant when set. The colour swatches below are the
	// fallback when no flag is set. Uses the searchable flag-picker (FlagPicker.js) instead of a plain
	// <select>, ported from Mathias's achtung-royale picker.
	var cLabel = document.createElement("div"); cLabel.className = "appearance-sub"; cLabel.textContent = "Flag"; wrap.appendChild(cLabel);
	if (typeof buildFlagPickerTrigger === "function") {
		wrap.appendChild(buildFlagPickerTrigger(account.country || null, function(code) { setCountry(code || ""); }));
	}

	var aLabel = document.createElement("div"); aLabel.className = "appearance-sub"; aLabel.textContent = "Avatar"; wrap.appendChild(aLabel);
	var swatchesContainer = document.createElement("div"); swatchesContainer.id = "avatar_modal_avatars";
	swatchesContainer.appendChild(buildAvatarSwatchesGrid());
	wrap.appendChild(swatchesContainer);
	var note = document.createElement("div"); note.className = "appearance-note";
	note.textContent = "Flag colours are used when no flag is set above; an image avatar replaces the flag colour. Locked presets are in the Shop.";
	wrap.appendChild(note);
	return wrap;
}

// Avatar editor modal — reuses the Appearance picker; opened by clicking the home/profile avatar.
function openAvatarEditor() {
	if (!account) return;
	var modal = document.getElementById("avatar_modal");
	if (!modal) {
		modal = document.createElement("div");
		modal.id = "avatar_modal";
		modal.className = "cr-modal";
		modal.setAttribute("hidden", "");
		modal.innerHTML =
			'<div class="cr-backdrop" data-avatar-close></div>' +
			'<div class="cr-dialog" role="dialog" aria-modal="true" aria-labelledby="avatar_modal_title">' +
				'<div class="cr-dialog-head"><h2 id="avatar_modal_title">Appearance</h2>' +
				'<button class="cr-close" type="button" data-avatar-close aria-label="Close">×</button></div>' +
				'<div id="avatar_modal_body"></div>' +
			'</div>';
		document.body.appendChild(modal);
		modal.addEventListener("click", function(e) { if (e.target.closest("[data-avatar-close]")) modal.setAttribute("hidden", ""); });
		document.addEventListener("keydown", function(e) { if (e.key === "Escape" && !modal.hasAttribute("hidden")) modal.setAttribute("hidden", ""); });
	}
	var body = modal.querySelector("#avatar_modal_body");
	body.innerHTML = "";
	var preview = document.createElement("div"); preview.className = "avatar-editor-preview";
	if (typeof buildAvatarChip === "function") preview.appendChild(buildAvatarChip(account.avatarColor || DEFAULT_AVATAR, account.country || null, 92));
	body.appendChild(preview);
	body.appendChild(renderAppearance());
	if (typeof BOARD_SKINS !== "undefined") {
		var sLabel = document.createElement("div"); sLabel.className = "appearance-sub"; sLabel.textContent = "Board skin";
		body.appendChild(sLabel);
		var skinsContainer = document.createElement("div"); skinsContainer.id = "avatar_modal_skins";
		body.appendChild(skinsContainer);
		renderAvatarModalSkins();
	}
	modal.removeAttribute("hidden");
}

// Repaint every place the local user's avatar shows after a change (profile header + home identity).
function refreshAvatarDisplays() {
	var head = document.querySelector("#profile_card .profile-avatar");
	if (head && typeof buildAvatarChip === "function") {
		var chip = buildAvatarChip(account.avatarColor || DEFAULT_AVATAR, account.country || null, 76);
		chip.classList.add("profile-avatar");
		head.replaceWith(chip);
	}
	if (typeof renderDashIdentity === "function") renderDashIdentity();
	var prev = document.querySelector("#avatar_modal .avatar-editor-preview");
	if (prev && typeof buildAvatarChip === "function") { prev.innerHTML = ""; prev.appendChild(buildAvatarChip(account.avatarColor || DEFAULT_AVATAR, account.country || null, 92)); }
}
function setAvatarColor(col) {
	account.avatarColor = col;
	if (typeof socket !== "undefined") socket.emit("set_avatar", { color: col });
	refreshAvatarDisplays();
	var btns = document.querySelectorAll(".avatar-swatch");
	for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", (btns[i].dataset.color || "").toLowerCase() === col.toLowerCase());
}
function setCountry(code) {
	account.country = code || null;
	if (typeof socket !== "undefined") socket.emit("set_country", { country: code });
	refreshAvatarDisplays();
}

// Puzzle Ladder summary markup: tier name + level + a progress bar to the next level. Shared by the
// puzzle picker, the profile, and the solve-result panel.
function puzzleLadderHTML(points) {
	if (typeof puzzleLadder !== "function") return "";
	var l = puzzleLadder(points || 0);
	return '<span class="pl-tier" style="color:' + l.tierColor + '">' + l.tierName + '</span>' +
		'<span class="pl-level">' + (l.atMax ? "Max level" : "Lvl " + l.level + " · " + l.pointsIntoLevel + "/" + l.pointsPerLevel) + '</span>' +
		'<span class="pl-bar"><span class="pl-bar-fill" style="width:' + l.levelPct + '%;background:' + l.tierColor + '"></span></span>';
}

function formatMemberSince(ms) {
	var d = new Date(ms);
	if (isNaN(d.getTime())) return "Unknown";
	return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

function profileSectionTitle(textStr) {
	var h = document.createElement("h3");
	h.className = "profile-section-title";
	h.textContent = textStr;
	return h;
}

// One ranked mode's standing: mini rank badge + mode name + tier + rating.
function profileLadderCard(label, rating) {
	var c = document.createElement("div");
	c.className = "profile-ladder";
	var badge = buildRankBadge(rating);
	badge.classList.add("profile-ladder-badge");
	c.appendChild(badge);
	var info = document.createElement("div");
	info.className = "profile-ladder-info";
	var nm = document.createElement("div"); nm.className = "profile-ladder-mode"; nm.textContent = label; info.appendChild(nm);
	var tr = tierFor(rating);
	var tl = document.createElement("div"); tl.className = "profile-ladder-tier"; tl.textContent = tr.name; tl.style.color = tr.color; info.appendChild(tl);
	c.appendChild(info);
	var rt = document.createElement("div"); rt.className = "profile-ladder-rating"; rt.textContent = rating; c.appendChild(rt);
	return c;
}

// Puzzle Ladder's standing, same card as the ranked ladders above ("puzzles shown like ranked") —
// a tier-coloured dot standing in for the hexagon rank badge (the Puzzle Ladder's Wood..Legend tiers
// are a different system from the Bronze..Master ranked ones buildRankBadge draws, so it isn't
// reusable here), mode name, tier name, and level in the number slot instead of a rating.
function profilePuzzleLadderCard(points) {
	var c = document.createElement("div");
	c.className = "profile-ladder";
	var l = (typeof puzzleLadder === "function") ? puzzleLadder(points || 0) : null;
	var dot = document.createElement("div");
	dot.className = "profile-ladder-badge profile-puzzle-dot";
	dot.style.background = l ? l.tierColor : "var(--muted)";
	c.appendChild(dot);
	var info = document.createElement("div");
	info.className = "profile-ladder-info";
	var nm = document.createElement("div"); nm.className = "profile-ladder-mode"; nm.textContent = "Puzzle Ladder"; info.appendChild(nm);
	var tl = document.createElement("div"); tl.className = "profile-ladder-tier";
	tl.textContent = l ? l.tierName : "Unranked";
	tl.style.color = l ? l.tierColor : "";
	info.appendChild(tl);
	c.appendChild(info);
	var rt = document.createElement("div"); rt.className = "profile-ladder-rating";
	rt.textContent = l ? (l.atMax ? "Max" : "Lvl " + l.level) : "";
	c.appendChild(rt);
	return c;
}


// --- Achievements ---------------------------------------------------------------------------
// Data-driven catalogue evaluated against a flat metrics bag = the player's account fields merged
// with the server's `achievementStats` (history aggregates). Each entry is a TIERED counter
// (`value` + `tiers`) or a single BOOLEAN (`bool` + `progress`). Rank/streak achievements read PEAK/
// BEST metrics so they never un-earn. **Adding an achievement is one entry here** (and, if it needs a
// number we don't track yet, one metric in db.achievementStats). Persisting earned-dates / unlock
// toasts is a future layer.
var ACH_ROMAN = ["", "I", "II", "III", "IV", "V"];
function achTierName(rating) { return tierFor(rating).name.replace(/ I+$/, ""); } // bare tier (Silver/Gold/…)
function modeWins(m, s) { return (m.perModeWins && m.perModeWins[s]) || 0; }
function peakOf(m, s) { return (m.peak && m.peak[s]) || m["rating" + s.charAt(0).toUpperCase() + s.slice(1)] || 0; }
function peakOverallOf(m) { return (m.peak && m.peak.overall) || Math.max(m.ratingSprint || 0, m.ratingStandard || 0); }
function minSolo(m, sizePrefix) {
	var b = m.soloBests, min = Infinity;
	if (b) Object.keys(b).forEach(function(k) { if ((!sizePrefix || k.indexOf(sizePrefix + "_") === 0) && b[k] < min) min = b[k]; });
	return min;
}
function fmtSec(ms) { return (typeof formatSoloTime === "function") ? formatSoloTime(ms) : (Math.round(ms / 100) / 10 + "s"); }

var ACHIEVEMENTS = [
	// Ranked milestones
	{ icon: "🏆", name: "Victories", value: function(m) { return m.wins || 0; }, tiers: [1, 10, 50, 250, 1000], desc: function(t) { return "Win " + t + " ranked match" + (t > 1 ? "es" : ""); } },
	{ icon: "🛡️", name: "Battle-tested", value: function(m) { return m.played || 0; }, tiers: [10, 50, 200, 1000, 5000], desc: function(t) { return "Play " + t + " ranked matches"; } },
	{ icon: "🎯", name: "Specialist", value: function(m) { return m.maxModeWins || 0; }, tiers: [25, 100, 500], desc: function(t) { return "Win " + t + " matches in a single mode"; } },
	{ icon: "⚔️", name: "Two-Sport Star", bool: function(m) { return modeWins(m, "sprint") > 0 && modeWins(m, "standard") > 0; }, progress: function(m) { return ((modeWins(m, "sprint") > 0 ? 1 : 0) + (modeWins(m, "standard") > 0 ? 1 : 0)) + " / 2 modes"; }, desc: function() { return "Win in both Sprint and Standard"; } },
	// Rank — peak-based so they never un-earn
	{ icon: "📈", name: "Ascendant", value: function(m) { return peakOverallOf(m); }, tiers: [600, 1200, 1800, 2400, 3000], desc: function(t) { return "Reach " + achTierName(t) + " (" + t + ")"; } },
	{ icon: "🌟", name: "Well-rounded", bool: function(m) { return peakOf(m, "sprint") >= 1200 && peakOf(m, "standard") >= 1200; }, progress: function(m) { return ((peakOf(m, "sprint") >= 1200 ? 1 : 0) + (peakOf(m, "standard") >= 1200 ? 1 : 0)) + " / 2 at Gold"; }, desc: function() { return "Reach Gold in both Sprint and Standard"; } },
	// Performance
	{ icon: "🔥", name: "On Fire", value: function(m) { return m.winStreakBest || 0; }, tiers: [3, 5, 10, 20], desc: function(t) { return "Win " + t + " matches in a row"; } },
	{ icon: "🌀", name: "Grinder", value: function(m) { return m.bestDayWins || 0; }, tiers: [5, 10, 20], desc: function(t) { return "Win " + t + " matches in one day"; } },
	{ icon: "⚡", name: "Surge", value: function(m) { return m.bestDayGain || 0; }, tiers: [150, 300, 500], desc: function(t) { return "Climb +" + t + " rating in one day"; } },
	{ icon: "💥", name: "Big Swing", value: function(m) { return m.bigSwing || 0; }, tiers: [40, 80, 120], desc: function(t) { return "Gain +" + t + " from a single match"; } },
	{ icon: "🤺", name: "Duelist", value: function(m) { return m.wins1v1 || 0; }, tiers: [10, 50, 200, 1000], desc: function(t) { return "Win " + t + " 1v1 matches"; } },
	{ icon: "👑", name: "Free-for-all King", value: function(m) { return m.wins6p || 0; }, tiers: [1, 10, 50], desc: function(t) { return t === 1 ? "Win a 7-player free-for-all" : "Win " + t + " 7-player free-for-alls"; } },
	// Style challenges — solo + racing only (never puzzles); backed by player_stats clear counters.
	{ icon: "🧠", name: "No Flags", value: function(m) { return m.noFlagClears || 0; }, tiers: [1, 10, 50], desc: function(t) { return t === 1 ? "Clear a board without placing a flag" : "Clear " + t + " boards without a flag"; } },
	{ icon: "🎹", name: "Chord Master", value: function(m) { return m.noRevealClears || 0; }, tiers: [1, 10, 50], desc: function(t) { return t === 1 ? "Clear a board without a left-click (chords only)" : "Clear " + t + " boards chord-only"; } },
	{ icon: "🎖️", name: "Sharpshooter", bool: function(m) { return (m.played || 0) >= 20 && (m.wins || 0) / (m.played || 1) >= 0.6; }, progress: function(m) { var p = m.played || 0; return p >= 20 ? (Math.round((m.wins || 0) / p * 100) + "% win rate") : (p + " / 20 matches"); }, desc: function() { return "60%+ win rate over 20+ matches"; } },
	// Speed (free play)
	{ icon: "⏱️", name: "Sub-minute", bool: function(m) { return minSolo(m) < 60000; }, progress: function(m) { var v = minSolo(m); return isFinite(v) ? ("best " + fmtSec(v)) : "no clears yet"; }, desc: function() { return "Clear any free-play board under 1:00"; } },
	{ icon: "🚀", name: "Quick Sweep", bool: function(m) { return minSolo(m, "small") < 30000; }, progress: function(m) { var v = minSolo(m, "small"); return isFinite(v) ? ("best " + fmtSec(v)) : "no Small clears"; }, desc: function() { return "Clear a Small board under 0:30"; } },
	{ icon: "🧭", name: "Free Spirit", value: function(m) { return m.soloBests ? Object.keys(m.soloBests).length : 0; }, tiers: [1, 5, 9], desc: function(t) { return t >= 9 ? "Clear all 9 free-play boards" : "Clear " + t + " free-play board" + (t > 1 ? "s" : ""); } },
	// Puzzles
	{ icon: "🧩", name: "Deductionist", value: function(m) { return m.puzzlesSolved || 0; }, tiers: [10, 100, 500, 2000, 5000], desc: function(t) { return "Solve " + t + " puzzles"; } },
	{ icon: "🧠", name: "Puzzle Rank", value: function(m) { return Math.max(m.peakPuzzleRating || 0, m.puzzleRating || 0); }, tiers: [1000, 1500, 2000, 2500], desc: function(t) { return "Reach a puzzle rating of " + t; } },
	{ icon: "🎲", name: "On a Roll", value: function(m) { return m.streakBest || 0; }, tiers: [5, 10, 25, 50], desc: function(t) { return "Hit an " + t + "-puzzle streak"; } },
	{ icon: "⛈️", name: "Time Trial Ace", value: function(m) { return m.stormBest || 0; }, tiers: [15, 30, 50, 75], desc: function(t) { return "Solve " + t + " in one Time Trial run"; } },
	// Daily
	{ icon: "📅", name: "Daily Devotee", value: function(m) { return Math.max(m.dailyStreakBest || 0, m.dailyStreak || 0); }, tiers: [3, 7, 30, 100], desc: function(t) { return "Reach a " + t + "-day daily streak"; } },
	{ icon: "🗓️", name: "Daily Regular", value: function(m) { return m.dailiesSolved || 0; }, tiers: [10, 50, 200, 500], desc: function(t) { return "Solve " + t + " daily puzzles"; } },
	// Dedication
	{ icon: "🎂", name: "Veteran", value: function(m) { return m.createdAt ? Math.floor((Date.now() - m.createdAt) / 86400000) : 0; }, tiers: [30, 180, 365, 730], desc: function(t) { return "Be a member for " + t + " days"; } },
	{ icon: "📆", name: "Regular", value: function(m) { return m.distinctDays || 0; }, tiers: [7, 30, 100, 365], desc: function(t) { return "Play on " + t + " different days"; } },
	{ icon: "🌐", name: "Tried It All", bool: function(m) { return (m.played || 0) > 0 && (m.puzzlesAttempted || 0) > 0 && m.soloBests && Object.keys(m.soloBests).length > 0; }, progress: function(m) { var n = ((m.played || 0) > 0 ? 1 : 0) + ((m.puzzlesAttempted || 0) > 0 ? 1 : 0) + ((m.soloBests && Object.keys(m.soloBests).length > 0) ? 1 : 0); return n + " / 3"; }, desc: function() { return "Play ranked, puzzles, and free play"; } }
];

// Tiered-achievement evaluator (shared by the catalogue and the meta "Collector").
// `reached`/`tierCount` drive the tier-aware "X / Y" header count; `complete` (all tiers done)
// colours the tile green vs. blue for partial progress.
function computeTiered(icon, name, value, tiers, descFn) {
	var reached = 0;
	for (var i = 0; i < tiers.length; i++) if (value >= tiers[i]) reached++;
	var maxed = reached >= tiers.length;
	var next = maxed ? tiers[tiers.length - 1] : tiers[reached];
	return {
		icon: icon,
		name: name + (tiers.length > 1 && reached > 0 ? " " + ACH_ROMAN[reached] : ""),
		desc: descFn(next),
		unlocked: reached > 0, complete: maxed,
		reached: reached, tierCount: tiers.length,
		frac: maxed ? 1 : (next ? Math.min(1, value / next) : 1),
		progText: maxed ? "Complete" : (Math.round(value) + " / " + next)
	};
}

function computeAchievement(a, m) {
	if (a.tiers) return computeTiered(a.icon, a.name, a.value(m), a.tiers, a.desc);
	var on = a.bool(m);
	return { icon: a.icon, name: a.name, desc: a.desc(), unlocked: on, complete: on, reached: on ? 1 : 0, tierCount: 1, frac: on ? 1 : 0, progText: on ? "Unlocked" : a.progress(m) };
}

function achTile(c) {
	var tile = document.createElement("div");
	// complete (all tiers) → green; partly done → blue; not started → dimmed.
	tile.className = "ach-tile " + (c.complete ? "ach-complete" : (c.unlocked ? "ach-partial" : "ach-locked"));
	var icon = document.createElement("span"); icon.className = "ach-icon"; icon.textContent = c.icon; tile.appendChild(icon);
	var body = document.createElement("div"); body.className = "ach-body";
	var nm = document.createElement("div"); nm.className = "ach-name"; nm.textContent = c.name; body.appendChild(nm);
	var ds = document.createElement("div"); ds.className = "ach-desc"; ds.textContent = c.desc; body.appendChild(ds);
	var bar = document.createElement("div"); bar.className = "ach-prog";
	var fill = document.createElement("span"); fill.className = "ach-prog-bar"; fill.style.width = Math.round(c.frac * 100) + "%"; bar.appendChild(fill);
	body.appendChild(bar);
	var pt = document.createElement("div"); pt.className = "ach-prog-text"; pt.textContent = c.progText; body.appendChild(pt);
	tile.appendChild(body);
	return tile;
}

function renderAchievements() {
	var card = document.getElementById("achievements_card");
	if (!card) return;
	if (!account) { card.innerHTML = ""; card.style.display = "none"; return; }
	card.style.display = "";
	card.innerHTML = "";
	// Account fields + the server's history aggregates (empty until get_match_history returns,
	// at which point this re-renders — so account-derived ones show instantly, history ones fill in).
	var metrics = Object.assign({}, account, profileStats);
	var computed = ACHIEVEMENTS.map(function(a) { return computeAchievement(a, metrics); });
	// Meta: "Collector" tracks how many distinct achievements you've unlocked (≥1 tier).
	var unlockedCount = computed.filter(function(c) { return c.unlocked; }).length;
	computed.push(computeTiered("🏅", "Collector", unlockedCount, [10, 20, ACHIEVEMENTS.length], function(t) { return "Unlock " + t + " achievements"; }));

	// Header count is tier-aware: total tiers reached across everything (so multi-tier achievements count).
	var tiersReached = computed.reduce(function(s, c) { return s + c.reached; }, 0);
	var tiersTotal = computed.reduce(function(s, c) { return s + c.tierCount; }, 0);
	var head = document.createElement("div");
	head.className = "ach-head";
	var h = document.createElement("h2"); h.className = "controls-title"; h.textContent = "Achievements"; head.appendChild(h);
	var count = document.createElement("span"); count.className = "ach-count";
	count.textContent = tiersReached + " / " + tiersTotal + " unlocked";
	head.appendChild(count);
	card.appendChild(head);

	var grid = document.createElement("div");
	grid.className = "ach-grid";
	computed.forEach(function(c) { grid.appendChild(achTile(c)); });
	card.appendChild(grid);
}

// --- Match history: rating graph + recent games (from the server's get_match_history) -----------
var matchHistory = { matches: [], ratings: [] };
var profileStats = {}; // server's achievementStats bag, merged into the achievement metrics
var ratingChartStyle = null; // which ladder the rating graph is showing
var STYLE_LABELS = { sprint: "Sprint", standard: "Standard" };
function styleLabelOf(s) { return STYLE_LABELS[s] || s; }
function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function relTime(ms) {
	var secs = Math.floor((Date.now() - ms) / 1000);
	if (secs < 60) return "just now";
	var m = Math.floor(secs / 60); if (m < 60) return m + "m ago";
	var h = Math.floor(m / 60); if (h < 24) return h + "h ago";
	var d = Math.floor(h / 24); if (d < 30) return d + "d ago";
	return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Server reply: cache + render the graph (only if there's rating data) and the games list.
function renderMatchHistory(data) {
	matchHistory = data || { matches: [], ratings: [] };
	profileStats = (data && data.stats) || {};
	var ratingsCard = document.getElementById("rating_history_card");
	var gamesCard = document.getElementById("recent_games_card");
	var hasRatings = matchHistory.ratings && matchHistory.ratings.length > 0;
	var hasMatches = matchHistory.matches && matchHistory.matches.length > 0;
	if (ratingsCard) { ratingsCard.style.display = hasRatings ? "" : "none"; if (hasRatings) renderRatingGraphCard(); }
	if (gamesCard) { gamesCard.style.display = hasMatches ? "" : "none"; if (hasMatches) renderRecentGamesCard(); }
	// Matches tab placeholder when there's nothing to show yet.
	var emptyEl = document.getElementById("matches_empty");
	if (emptyEl) emptyEl.style.display = (!hasRatings && !hasMatches) ? "" : "none";
	// History aggregates just arrived — re-render achievements so the history-based ones fill in,
	// and toast anything that crossed a tier since the last check.
	if (typeof renderAchievements === "function") renderAchievements();
	checkAchievementUnlocks();
}

// --- Achievement unlock toasts ----------------------------------------------------------------
// Diff each achievement's reached-tier count against the last snapshot. The FIRST check after
// (re)connect just baselines silently; later checks (after a match/puzzle/daily/solo result, which
// re-request stats) toast any tier that newly crossed. Driven entirely off the metrics bag.
var achReached = null; // index -> tiers reached, or null until baselined
function checkAchievementUnlocks() {
	if (!account) { achReached = null; return; }
	var metrics = Object.assign({}, account, profileStats);
	var computed = ACHIEVEMENTS.map(function(a) { return computeAchievement(a, metrics); });
	var now = computed.map(function(c) { return c.reached; });
	if (achReached) {
		for (var i = 0; i < computed.length; i++) {
			if (now[i] > (achReached[i] || 0)) showAchievementToast(computed[i]);
		}
	}
	achReached = now;
}

var ACH_TOAST_AUTO_MS = 5000;
var ACH_TOAST_SWIPE_PX = 60; // drag distance (px) past which a release commits to dismiss, not snap back

function showAchievementToast(c) {
	var stack = document.getElementById("toast_stack");
	if (!stack) { stack = document.createElement("div"); stack.id = "toast_stack"; stack.className = "toast-stack"; document.body.appendChild(stack); }
	var t = document.createElement("div");
	t.className = "ach-toast" + (c.complete ? " ach-toast-complete" : "");
	var icon = document.createElement("span"); icon.className = "ach-toast-icon"; icon.textContent = c.icon;
	var txt = document.createElement("div"); txt.className = "ach-toast-text";
	var label = document.createElement("div"); label.className = "ach-toast-label"; label.textContent = c.complete ? "Achievement complete" : "Achievement unlocked";
	var name = document.createElement("div"); name.className = "ach-toast-name"; name.textContent = c.name;
	txt.appendChild(label); txt.appendChild(name);
	t.appendChild(icon); t.appendChild(txt);
	stack.appendChild(t);
	if (typeof sound !== "undefined" && sound && sound.beep) { try { sound.beep(c.complete ? 1175 : 988); } catch (e) {} }
	requestAnimationFrame(function() { t.classList.add("ach-toast-in"); });

	// Dismissible on request — tap/click anywhere on it, or (touch) swipe it to either side. `dismissed`
	// guards against the auto-timer and a manual dismiss racing each other (e.g. tapped right as the
	// 5s timer was about to fire) both trying to remove the same node.
	var dismissed = false;
	// exitDX: how far (and which direction) to finish sliding off — a plain click/the auto-timer just
	// uses the CSS class's own default (rightward, .ach-toast-out); a swipe past the threshold instead
	// continues sliding the SAME direction the finger was already dragging it, so the exit reads as a
	// continuation of the gesture rather than snapping back and then sliding off some other way.
	function dismiss(exitDX) {
		if (dismissed) return;
		dismissed = true;
		clearTimeout(autoTimer);
		t.classList.remove("ach-toast-in", "ach-toast-dragging");
		t.classList.add("ach-toast-out");
		t.style.opacity = "";
		t.style.transform = exitDX ? "translateX(" + (exitDX > 0 ? "125%" : "-125%") + ")" : "";
		setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 450);
	}
	var autoTimer = setTimeout(function() { dismiss(); }, ACH_TOAST_AUTO_MS);

	t.addEventListener("click", function() { dismiss(); });

	var dragStartX = null, dragDX = 0;
	t.addEventListener("touchstart", function(e) {
		if (dismissed || !e.touches.length) return;
		dragStartX = e.touches[0].clientX;
		dragDX = 0;
		t.classList.add("ach-toast-dragging"); // disables the transition so the drag tracks 1:1, no lag
	}, { passive: true });
	t.addEventListener("touchmove", function(e) {
		if (dragStartX == null || !e.touches.length) return;
		dragDX = e.touches[0].clientX - dragStartX;
		t.style.transform = "translateX(" + dragDX + "px)";
		t.style.opacity = String(Math.max(0.15, 1 - Math.abs(dragDX) / 200));
	}, { passive: true });
	t.addEventListener("touchend", function() {
		if (dragStartX == null) return;
		t.classList.remove("ach-toast-dragging"); // re-enables the transition for the snap-back/exit below
		if (Math.abs(dragDX) > ACH_TOAST_SWIPE_PX) {
			dismiss(dragDX);
		} else {
			t.style.transform = "";
			t.style.opacity = "";
		}
		dragStartX = null;
	});
}

function renderRatingGraphCard() {
	var card = document.getElementById("rating_history_card");
	if (!card) return;
	card.innerHTML = "";
	var buckets = {};
	matchHistory.ratings.forEach(function(p) { (buckets[p.style] = buckets[p.style] || []).push(p); });
	var styles = Object.keys(buckets);
	if (!styles.length) { card.style.display = "none"; return; }
	// Default to the most-played ladder; keep the user's pick if still valid.
	if (!ratingChartStyle || styles.indexOf(ratingChartStyle) < 0) {
		ratingChartStyle = styles.reduce(function(best, s) { return buckets[s].length > buckets[best].length ? s : best; }, styles[0]);
	}
	var h = document.createElement("h2"); h.className = "controls-title"; h.textContent = "Rating history"; card.appendChild(h);
	if (styles.length > 1) {
		var tabs = document.createElement("div"); tabs.className = "lb-tabs rating-chart-tabs";
		styles.forEach(function(s) {
			var b = document.createElement("button"); b.type = "button";
			b.className = "lb-tab" + (s === ratingChartStyle ? " active" : "");
			b.textContent = styleLabelOf(s);
			b.addEventListener("click", function() { ratingChartStyle = s; renderRatingGraphCard(); });
			tabs.appendChild(b);
		});
		card.appendChild(tabs);
	}
	var rows = buckets[ratingChartStyle];
	var points = [];
	// Seed point ("before" the first match) used to get an even earlier timestamp than that match's
	// own — giving it the SAME timestamp (as this used to) makes the seed and the first real point
	// share an x-coordinate, so the line between them is perfectly vertical: a stray straight-up
	// stroke at the very start of the chart instead of a diagonal into the first result. Half the gap
	// to the second match (or one day, if there's only one match total) gives it real breathing room.
	if (rows.length) {
		var gap = rows.length > 1 ? (rows[1].created_at - rows[0].created_at) : 86400000;
		points.push({ t: rows[0].created_at - Math.max(1, gap * 0.5), r: rows[0].rating_before });
	}
	rows.forEach(function(p) { points.push({ t: p.created_at, r: p.rating_after }); });
	// Same fix as the seed point above, generalized: two matches recorded in the same tick (a rapid
	// best-of-N series, or several rounds persisting in the same synchronous DB write) can carry
	// identical created_at values, which produces the exact same perfectly-vertical-line artifact
	// wherever it happens in the series, not just at the start. Force strictly increasing timestamps.
	for (var pi = 1; pi < points.length; pi++) {
		if (points[pi].t <= points[pi - 1].t) points[pi].t = points[pi - 1].t + 1;
	}
	var wrap = document.createElement("div"); wrap.className = "rating-chart-wrap";
	wrap.innerHTML = buildRatingChartSVG(points);
	card.appendChild(wrap);
}

// A simple responsive SVG line chart of rating over time. Grid lines sit at tier boundaries (every
// 200 rating, the ladder's sub-tier width — see Ranking.js) instead of generic evenly-spaced values,
// each labelled and coloured with that tier, so the chart doubles as "how close to the next tier" at
// a glance instead of just a plain number axis.
function buildRatingChartSVG(points) {
	if (points.length < 2) return '<div class="rating-chart-empty">Current rating: ' + (points[0] ? points[0].r : "unrated") + ". Play more matches to chart your progress.</div>";
	var W = 600, H = 170, L = 42, Rp = 14, Tp = 14, Bp = 22;
	var rs = points.map(function(p) { return p.r; }), ts = points.map(function(p) { return p.t; });
	var rMin = Math.min.apply(null, rs), rMax = Math.max.apply(null, rs);
	if (rMax === rMin) { rMin = Math.max(0, rMin - 50); rMax = rMax + 50; }
	var span = rMax - rMin;
	rMin = Math.max(0, Math.floor((rMin - span * 0.1) / 10) * 10);
	rMax = Math.ceil((rMax + span * 0.1) / 10) * 10;
	var tMin = ts[0], tMax = ts[ts.length - 1]; if (tMax === tMin) tMax = tMin + 1;
	function X(t) { return L + (W - L - Rp) * (t - tMin) / (tMax - tMin); }
	function Y(r) { return Tp + (H - Tp - Bp) * (1 - (r - rMin) / (rMax - rMin)); }
	var d = points.map(function(p, i) { return (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.r).toFixed(1); }).join(" ");
	var area = d + " L " + X(tMax).toFixed(1) + " " + (H - Bp) + " L " + X(tMin).toFixed(1) + " " + (H - Bp) + " Z";
	var last = points[points.length - 1];
	var svg = '<svg viewBox="0 0 ' + W + " " + H + '" class="rating-chart">';
	// Sub-tier boundaries (every SUB_TIER_WIDTH) within [rMin, rMax] — cap the step up (400, 600, …)
	// if that range spans enough tiers that every-200 would be too dense to read.
	var step = (typeof SUB_TIER_WIDTH === "number") ? SUB_TIER_WIDTH : 200;
	while ((rMax - rMin) / step > 8) step += (typeof SUB_TIER_WIDTH === "number") ? SUB_TIER_WIDTH : 200;
	var first = Math.ceil(rMin / step) * step;
	for (var rv = first; rv <= rMax; rv += step) {
		var y = Y(rv).toFixed(1);
		var band = (typeof tierFor === "function") ? tierFor(rv) : { name: String(rv), color: "var(--muted)" };
		svg += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - Rp) + '" y2="' + y + '" class="rc-grid" style="stroke:' + band.color + ';stroke-opacity:0.3"/>';
		svg += '<text x="' + (L - 6) + '" y="' + (parseFloat(y) + 3.5) + '" class="rc-label" text-anchor="end" style="fill:' + band.color + '">' + band.name + "</text>";
	}
	svg += '<path d="' + area + '" class="rc-area"/>';
	svg += '<path d="' + d + '" class="rc-line"/>';
	svg += '<circle cx="' + X(last.t).toFixed(1) + '" cy="' + Y(last.r).toFixed(1) + '" r="3.5" class="rc-dot"/>';
	svg += "</svg>";
	return svg;
}

function renderRecentGamesCard() {
	var card = document.getElementById("recent_games_card");
	if (!card) return;
	card.innerHTML = "";
	var h = document.createElement("h2"); h.className = "controls-title"; h.textContent = "Recent games"; card.appendChild(h);
	var list = document.createElement("div"); list.className = "games-list";
	matchHistory.matches.slice(0, 20).forEach(function(m) { list.appendChild(gameRow(m)); });
	card.appendChild(list);
}
function gameRow(m) {
	// Rows with a stored replay become a link to the player; the rest stay plain.
	var hasReplay = !!m.replay_id;
	var row = document.createElement(hasReplay ? "a" : "div");
	row.className = "game-row" + (hasReplay ? " game-row-replay" : "");
	if (hasReplay) row.href = "/replay?id=" + m.replay_id;
	var chip = document.createElement("span"); chip.className = "game-chip game-chip-" + m.style; chip.textContent = styleLabelOf(m.style); row.appendChild(chip);
	var res = document.createElement("span"); res.className = "game-result " + (m.won ? "game-won" : "game-lost");
	res.textContent = m.players <= 2 ? (m.won ? "Won" : "Lost") : (ordinal(m.placement) + " of " + m.players);
	row.appendChild(res);
	var opp = document.createElement("span"); opp.className = "game-opp";
	opp.textContent = m.opponent ? ("vs " + m.opponent) : (m.players > 2 ? (m.players + " players") : "");
	row.appendChild(opp);
	var delta = (m.rating_after || 0) - (m.rating_before || 0);
	var d = document.createElement("span"); d.className = "game-delta " + (delta >= 0 ? "game-delta-pos" : "game-delta-neg");
	d.textContent = (delta >= 0 ? "+" : "") + delta; row.appendChild(d);
	var t = document.createElement("span"); t.className = "game-time"; t.textContent = relTime(m.created_at); row.appendChild(t);
	// Watch affordance (only when a replay exists) — keeps the grid's last column consistent.
	var watch = document.createElement("span"); watch.className = "replay-watch";
	if (hasReplay) watch.textContent = "▶ Watch";
	row.appendChild(watch);
	return row;
}

function profileStat(label, value) {
	var box = document.createElement("div");
	box.className = "profile-stat";
	var l = document.createElement("div");
	l.className = "profile-stat-label";
	l.textContent = label;
	box.appendChild(l);
	var v = document.createElement("div");
	v.className = "profile-stat-value";
	v.textContent = value;
	box.appendChild(v);
	return box;
}

function renderHomeRankChips() {
	// Home page shows only the tier name, never the exact rating number (same "no precise number"
	// treatment the in-game duel identity panels already use).
	function applyTo(tierEl, rating, badgeId) {
		var badgeEl = badgeId ? document.getElementById(badgeId) : null;
		if (badgeEl) {
			badgeEl.innerHTML = "";
			if (account && typeof rating === "number") badgeEl.appendChild(buildRankBadge(rating));
		}
		if (!tierEl) return;
		if (!account) { tierEl.textContent = "—"; tierEl.style.color = ""; return; }
		var t = tierFor(rating, account.provisional);
		tierEl.textContent = t.name;
		tierEl.style.color = t.color;
	}
	var sprint = account ? account.ratingSprint : null;
	var standard = account ? account.ratingStandard : null;
	applyTo(rankTierSprint, sprint, "rank_badge_sprint");
	applyTo(rankTierStandard, standard, "rank_badge_standard");
	// No skeleton on the mode rows' rank/rating corner — it's simply absent until account is
	// confirmed (guest or signed in), then fades in (see .stat-fade-in in style.css / revealStat()
	// in Router.js). They currently all resolve together (one account payload), but are kept as
	// separate elements/ids so each row's reveal is self-contained.
	if (account && typeof revealStat === "function") {
		["dash_stat_sprint", "dash_stat_standard", "dash_stat_puzzles"].forEach(revealStat);
	}

	// The Puzzles home row shows the Puzzle Ladder tier (same "tier only, no raw number" treatment as
	// Sprint/Standard) instead of the hidden puzzle rating or a solved count.
	var puzzleTierEl = document.getElementById("puzzle_ladder_tier");
	if (puzzleTierEl) {
		if (account && typeof puzzleLadder === "function" && typeof puzzleLadderLabel === "function") {
			puzzleTierEl.textContent = puzzleLadderLabel(account.puzzlePoints || 0);
			puzzleTierEl.style.color = puzzleLadder(account.puzzlePoints || 0).tierColor;
		} else {
			puzzleTierEl.textContent = "—";
			puzzleTierEl.style.color = "";
		}
	}
	var streakBestEl = document.getElementById("puzzle_streak_best");
	var stormBestEl = document.getElementById("puzzle_storm_best");
	if (streakBestEl) streakBestEl.textContent = account ? (account.streakBest || 0) : "—";
	if (stormBestEl) stormBestEl.textContent = account ? (account.stormBest || 0) : "—";
	var dailyStreakEl = document.getElementById("puzzle_daily_streak");
	var dailyStatusEl = document.getElementById("puzzle_daily_status");
	if (dailyStreakEl) dailyStreakEl.textContent = account ? ("🔥 " + (account.dailyStreak || 0)) : "—";
	if (dailyStatusEl) {
		if (!account) { dailyStatusEl.textContent = ""; }
		else if (!account.dailyAttempt) { dailyStatusEl.textContent = "Not played"; }
		else if (account.dailyAttempt.solved) { dailyStatusEl.textContent = "Solved today"; }
		else { dailyStatusEl.textContent = "Missed today"; }
	}
	renderLobbyDailyBoard();
	renderLobbyDailyState();
	renderDashIdentity();
	renderModeBoardPreviews();
}

// ---- Home dashboard: the "you" banner + the per-mode board previews ----

// SSR_INLINE:START — embedded verbatim into the server-generated synchronous hydration script
// (see staticServer.js), immediately after Ranking.js's SSR_INLINE block (tierFor/overallRating,
// which this calls). Paints the name/tier/stats portion of the you-card straight from an account
// object, before the deferred bundle even loads — renderDashIdentity() below calls this exact same
// function for the real, post-boot render, so there's one implementation either way; editing it
// updates both the early paint and the normal one. Deliberately does NOT touch the avatar (that's
// canvas-drawn — see buildAvatarChip — real drawing logic, not worth duplicating here); it leaves a
// plain shimmering circle sized to match, left for renderDashIdentity() to replace for real.
function paintYouCardEarly(account) {
	var overall = overallRating(account);
	var t = tierFor(overall, account.provisional);
	var nameEl = document.getElementById("dash_you_name");
	if (nameEl) nameEl.textContent = account.name || "Player";
	var lineEl = document.getElementById("dash_you_line");
	if (lineEl) lineEl.innerHTML = "<b style=\"color:" + t.color + "\">" + t.name + "</b>";
	// Topbar's compact mobile-landscape copy of the same name/tier — see #topbar_you in index.html.
	var topbarNameEl = document.getElementById("topbar_you_name");
	if (topbarNameEl) topbarNameEl.textContent = account.name || "Player";
	var topbarTierEl = document.getElementById("topbar_you_tier");
	if (topbarTierEl) { topbarTierEl.textContent = t.name; topbarTierEl.style.color = t.color; }
	var statsEl = document.getElementById("dash_you_stats");
	if (statsEl) {
		var played = account.played || 0, wins = account.wins || 0;
		var wr = played ? Math.round(wins / played * 100) + "%" : "—";
		// Daily streak already shows (with its fire emoji) under the daily-puzzle card below — no
		// need to repeat it here.
		statsEl.innerHTML = "<span class=\"dash-stat\"><b>" + played + "</b><span>Played</span></span>"
			+ "<span class=\"dash-stat\"><b>" + wr + "</b><span>Win rate</span></span>";
	}
	var badgeEl = document.getElementById("dash_you_badge");
	if (badgeEl && !badgeEl.firstChild) {
		badgeEl.innerHTML = "<span class=\"skel-shimmer\" style=\"display:block;width:62px;height:62px;border-radius:50%\"></span>";
	}
	var skel = document.getElementById("dash_you_skel");
	if (skel && skel.classList) skel.classList.add("skel-hide");
}
// SSR_INLINE:END

// The "you" banner: rank badge (overall = best across modes), name, overall tier/rating, and a
// few real lifetime stats. No fabricated "this week" trend — we don't track it yet.
function renderDashIdentity() {
	var nameEl = document.getElementById("dash_you_name");
	if (!nameEl) return; // dashboard markup not present
	// account is null both before the auth round trip resolves AND (in theory) if it never does —
	// but in practice every visitor ends up with a real account object, guest or not (see the
	// guest_session flow in Auth.js), so this only really means "still waiting". Leave the skeleton
	// up rather than reveal a "guest" treatment that might flip the moment the real data lands.
	if (!account) {
		nameEl.textContent = (typeof myName !== "undefined" && myName) || "Player";
		var topbarNameElEarly = document.getElementById("topbar_you_name");
		if (topbarNameElEarly) topbarNameElEarly.textContent = (typeof myName !== "undefined" && myName) || "Player";
		return;
	}
	paintYouCardEarly(account); // name, tier line, stats, skeleton — see above
	// Dota-style identity: a tall avatar portrait on the left, name on top, rank/tier on the line beneath.
	var badgeEl = document.getElementById("dash_you_badge");
	var nameRow = nameEl.parentNode;
	if (nameRow) { var stale = nameRow.querySelector(".dash-avatar"); if (stale) stale.remove(); } // drop the old inline avatar
	if (badgeEl) {
		badgeEl.innerHTML = "";
		if (typeof buildAvatarChip === "function") badgeEl.appendChild(buildAvatarChip(account.avatarColor || DEFAULT_AVATAR, account.country || null, 62));
		// Click the home avatar to edit it.
		badgeEl.classList.add("dash-avatar-edit");
		badgeEl.title = "Edit avatar";
		badgeEl.onclick = function() { if (typeof openAvatarEditor === "function") openAvatarEditor(); };
	}
	// Topbar's compact mobile-landscape avatar — same chip, smaller, no click-to-edit (the full
	// .dash-you card underneath — hidden visually there, but still real — already offers that).
	var topbarAvatarEl = document.getElementById("topbar_you_avatar");
	if (topbarAvatarEl) {
		topbarAvatarEl.innerHTML = "";
		if (typeof buildAvatarChip === "function") topbarAvatarEl.appendChild(buildAvatarChip(account.avatarColor || DEFAULT_AVATAR, account.country || null, 32));
	}
}

// Fixed board previews for each mode, in the standard board format the game renderer
// (buildLearnPuzzle) consumes: lists of [row, col] for `mines` and `flagged` (flags pre-placed). The
// open area is given as a single `revealStart` cell — the renderer cascades from there exactly like a
// real click. Sprint is a sparse, wide-open field; Standard a tight opening in a denser minefield.
// Puzzles is a crafted deduction position with no 0-cell to cascade from, so it lists its revealed
// cells explicitly. All three share Standard's 6x9 dimensions so the rendered previews come out the
// same size (see .dash-board-preview canvas in style.css, which fixes height but not width — mismatched
// dimensions used to make some previews render narrower than others). Rendered in the player's chosen
// board skin (renderModeBoardPreviews re-runs on skin change — see setBoardSkin) and frozen
// (pointer-events: none, no click/reveal wiring beyond what buildLearnPuzzle sets up for its own
// canvas — it draws once synchronously per call, no requestAnimationFrame loop, so a still preview
// never keeps a frame ticking in the background).
var DASH_MODE_BOARDS = {
	sprint: {
		rows: 6, cols: 9,
		mines: [[0,0],[0,3],[1,1],[3,3],[3,7],[3,8]],
		revealStart: [3, 5],
		flagged: [[3,3],[3,7],[3,8]]
	},
	standard: {
		rows: 6, cols: 9,
		mines: [[0,2],[0,3],[1,1],[1,6],[2,0],[2,6],[2,8],[3,0],[3,6],[3,7],[3,8],[4,1],[4,8],[5,2]],
		revealStart: [3, 4],
		flagged: [[1,6],[2,6],[3,6],[3,7],[5,2]]
	},
	puzzles: {
		rows: 6, cols: 9,
		mines: [[0,3],[1,0],[1,2],[2,0],[3,5],[4,3],[5,2]],
		revealed: [[1,1],[1,3],[1,4],[2,1],[2,2],[2,3],[2,4],[3,1],[3,2],[3,3],[3,4],[4,1],[4,2],[4,4]],
		flagged: []
	}
};
// Called on lobby show and again from setBoardSkin() whenever the player's skin changes, so these
// stay in sync with the rest of the site instead of being frozen at "classic" forever.
function renderModeBoardPreviews() {
	if (typeof buildLearnPuzzle !== "function") return;
	Object.keys(DASH_MODE_BOARDS).forEach(function(key) {
		var slot = document.getElementById("dash_board_" + key);
		if (!slot) return;
		var b = DASH_MODE_BOARDS[key];
		var el = buildLearnPuzzle({
			title: "", rows: b.rows, cols: b.cols, mines: b.mines,
			revealed: b.revealed, revealStart: b.revealStart, flagged: b.flagged,
			skin: (typeof localBoardSkin !== "undefined" && localBoardSkin) || "classic"
		}, false, function() {});
		el.classList.add("dash-board-preview");
		slot.innerHTML = "";
		slot.appendChild(el);
	});
}

// Drives state-aware styling on the daily hero (solved / missed / new),
// the button text, and the corner badge over the board preview.
function renderLobbyDailyState() {
	var hero = document.querySelector(".lobby-daily-hero");
	if (!hero) return;
	hero.classList.remove("daily-solved", "daily-missed", "daily-fresh");
	var btn = document.getElementById("open_daily_button");
	var attempt = account && account.dailyAttempt;
	if (!account) {
		if (btn) { btn.textContent = "Sign in to play"; btn.disabled = true; }
		return;
	}
	if (!attempt) {
		hero.classList.add("daily-fresh");
		if (btn) { btn.textContent = "Play today's puzzle"; btn.disabled = false; }
	} else if (attempt.solved) {
		hero.classList.add("daily-solved");
		if (btn) { btn.textContent = "Solved — back tomorrow"; btn.disabled = true; }
	} else {
		// A miss doesn't lock the day out — retrying is a click away (same puzzle until solved).
		hero.classList.add("daily-missed");
		if (btn) { btn.textContent = "Try again"; btn.disabled = false; }
	}
}

// "2026-08-18" -> "Aug 18". Parsed as UTC (matching db.todayUtc(), which produced the string) so the
// displayed date can't drift a day off around midnight depending on the viewer's local timezone.
function formatDailyDate(isoDate) {
	var parts = isoDate.split("-");
	if (parts.length !== 3) return isoDate;
	var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
	if (isNaN(d.getTime())) return isoDate;
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Paints the daily puzzle's starting position into the lobby hero card.
// Read-only — clicks fall through to the "Play today's puzzle" button.
function renderLobbyDailyBoard() {
	var container = document.getElementById("lobby_daily_board");
	if (!container) return;
	var dateEl = document.getElementById("lobby_daily_date");
	// Prefer the live (authoritative) copy once it lands over the socket; fall back to the
	// server-inlined snapshot (window.__DAILY__ — see staticServer.js) so the board can paint
	// before the socket round trip even starts. Both describe the same public, day-shared puzzle
	// (no personalization), so there's nothing to reconcile beyond "whichever is available" — the
	// boardKey dedupe below keeps the canvas from being rebuilt when the authoritative copy arrives
	// a moment later with identical data (the skin is folded into the key too, so a skin change —
	// setBoardSkin calls this again — still forces a rebuild).
	var inline = (typeof window.__DAILY__ !== "undefined") ? window.__DAILY__ : null;
	var board = (account && account.dailyBoard) || inline;
	var date = (account && account.dailyDate) || (inline && inline.date);
	var skin = (typeof localBoardSkin !== "undefined" && localBoardSkin) || "classic";
	if (!board) {
		container.innerHTML = '<div class="lobby-daily-board-empty">No puzzle available today.</div>';
		if (dateEl) dateEl.textContent = "";
		return;
	}
	if (dateEl) dateEl.textContent = date ? formatDailyDate(date) : "";
	if (typeof hideSkeleton === "function") hideSkeleton("dash_daily_skel");
	var boardKey = board.rows + "x" + board.cols + "@" + date + "#" + skin;
	if (container.dataset.boardKey === boardKey) return;
	container.dataset.boardKey = boardKey;
	container.innerHTML = "";
	var pseudo = {
		title: "",
		rows: board.rows,
		cols: board.cols,
		mines: board.mines,
		revealed: board.revealed,
		skin: skin
	};
	var puzzleEl = buildLearnPuzzle(pseudo, false, function() {});
	puzzleEl.classList.add("lobby-daily-preview");
	container.appendChild(puzzleEl);
}
