// Shop: browse + buy avatar presets and board skins with real money (Stripe Checkout, hosted
// page — this view only ever talks to our own /api/shop/* endpoints, never Stripe directly, so it
// needs no Stripe.js). A purchase is a full-page redirect away and back, so this view also handles
// the return trip (?purchase=success|cancel&session_id=...). Ownership rides account.ownedItems,
// shipped on the `authenticated` payload / SSR hydration (see session.js buildAccountPayload) and
// re-synced after a purchase via the refresh_owned_items/owned_items socket round-trip.
//
// buildSkinPreview/shopItemUnlocked/shopPriceLabel/openItemPurchaseModal are shared with the
// avatar-editor modal's picker — see Profile.js.

function shopHeaders() {
	try {
		var t = localStorage.getItem("ms_session");
		return t ? { "X-Session-Token": t } : {};
	} catch (e) { return {}; }
}

// Admin-only, in-memory (resets on reload — never persisted): while on, Buy buttons hit
// /api/shop/fake-grant instead of Stripe checkout, activating the item immediately with no payment.
// The server independently re-checks is_admin, so this checkbox is purely a client-side UX switch —
// it can't itself grant anything to a non-admin poking at it.
var fakeShopMode = false;

// Tabbed categories (one ShopCatalog "kind" each) — the tagline is pure flavor text, shown once
// under the category header, same spot the top-level page subtitle used to carry its one static
// line before there was more than one section to caption individually.
var SHOP_CATEGORIES = [
	{ kind: "avatar", label: "Avatars", tagline: "Doesn't change your hitbox — there is no hitbox." },
	{ kind: "skin", label: "Board Skins", tagline: "Reskins the tiles. The mines don't move, promise." },
	{ kind: "revealEffect", label: "Reveal Effects", tagline: "How your own cascade looks as it opens. Only you ever see it." }
];
// Which tab is showing — persists across re-renders (buy/owned-state changes, the post-purchase
// redirect back) the same way fakeShopMode does, so switching tabs doesn't get silently undone by
// something else in the page re-rendering itself.
var shopActiveKind = null;

// One glyph per reveal effect, standing in for a static preview image (see buildShopTile) — an
// animation has no single frame worth screenshotting the way a skin's board preview does.
var REVEAL_EFFECT_GLYPHS = { spark: "⚡", shatter: "💥", crt: "📺", dust: "💨" };

function shopStatusBanner(text, kind) {
	var el = document.getElementById("shop_status");
	if (!el) return;
	if (!text) { el.style.display = "none"; el.textContent = ""; return; }
	el.className = "section-card shop-status" + (kind ? " shop-status-" + kind : "");
	el.textContent = text;
	el.style.display = "";
}

function markOwnedLocally(itemId) {
	if (!account.ownedItems) account.ownedItems = [];
	if (account.ownedItems.indexOf(itemId) === -1) account.ownedItems.push(itemId);
	// Re-sync the socket-held copy too (used by the live-game avatar/skin pickers), same as after a
	// real purchase — see the session-status poller below.
	if (typeof socket !== "undefined") socket.emit("refresh_owned_items");
	// If the avatar-editor modal's purchase flow is what triggered this (in-place buy, no page
	// navigation — see openItemPurchaseModal/Profile.js), refresh its pickers and close the little
	// purchase dialog so the newly-owned item shows unlocked right away. No-ops if that modal isn't open.
	if (typeof renderAvatarModalAvatars === "function") renderAvatarModalAvatars();
	if (typeof renderAvatarModalSkins === "function") renderAvatarModalSkins();
	if (typeof renderAvatarModalRevealEffect === "function") renderAvatarModalRevealEffect();
	if (typeof closeItemPurchaseModal === "function") closeItemPurchaseModal();
}

function buyShopItemFake(item, btn, originalLabel) {
	// Deliberately doesn't swap the button's text for a "Starting checkout…" state — the price label
	// is usually shorter than that string, so the swap widened the button and shifted whatever sits
	// next to it. Disabling the button (dimmed via .btn:disabled) is feedback enough for how brief
	// this in-flight window actually is.
	btn.disabled = true;
	fetch("/api/shop/fake-grant", {
		method: "POST",
		headers: Object.assign({ "Content-Type": "application/json" }, shopHeaders()),
		body: JSON.stringify({ itemId: item.id })
	}).then(function(r) { return r.json(); }).then(function(data) {
		if (data.ok) { markOwnedLocally(item.id); renderShop(); return; }
		btn.disabled = false; btn.textContent = originalLabel;
		shopStatusBanner("Couldn't activate item — try again.", "error");
	}).catch(function() {
		btn.disabled = false; btn.textContent = originalLabel;
		shopStatusBanner("Couldn't activate item — try again.", "error");
	});
}

function buyShopItem(item, btn) {
	var originalLabel = btn.textContent;
	// Also re-checks account.isAdmin here (not just the checkbox's own gating) so a stale in-memory
	// fakeShopMode="true" can't leak into a real checkout for a non-admin account mid-session (e.g.
	// an admin toggles it on, then signs out into a guest without a page reload).
	if (fakeShopMode && account && account.isAdmin) { buyShopItemFake(item, btn, originalLabel); return; }
	btn.disabled = true; // see buyShopItemFake's comment on why this doesn't also swap the button text
	fetch("/api/shop/checkout", {
		method: "POST",
		headers: Object.assign({ "Content-Type": "application/json" }, shopHeaders()),
		body: JSON.stringify({ itemId: item.id })
	}).then(function(r) { return r.json(); }).then(function(data) {
		if (data.alreadyOwned) { markOwnedLocally(item.id); renderShop(); return; }
		if (data.url) { window.location.href = data.url; return; }
		btn.disabled = false; btn.textContent = originalLabel;
		shopStatusBanner(data.error === "guest_not_allowed" ? "Sign in to buy items." : "Couldn't start checkout — try again.", "error");
	}).catch(function() {
		btn.disabled = false; btn.textContent = originalLabel;
		shopStatusBanner("Couldn't start checkout — try again.", "error");
	});
}

function buildShopTile(item) {
	var tile = document.createElement("div");
	// tier ("common"/"rare"/"epic", ShopCatalog.js) drives the card's border colour/glow — a purely
	// cosmetic shop-display concept, unrelated to ownership or gameplay.
	tile.className = "shop-tile" + (item.tier ? " shop-tile-" + item.tier : "");

	var head = document.createElement("div"); head.className = "shop-tile-head";
	var name = document.createElement("div"); name.className = "shop-tile-name"; name.textContent = item.label;
	head.appendChild(name);
	tile.appendChild(head);

	var preview = document.createElement("div"); preview.className = "shop-tile-preview";
	if (item.kind === "avatar" && typeof buildAvatarCanvas === "function") preview.appendChild(buildAvatarCanvas(item.id, 64));
	else if (item.kind === "skin" && typeof buildSkinPreview === "function") preview.appendChild(buildSkinPreview(item.id));
	else if (item.kind === "revealEffect") {
		// No static preview image makes sense for an animation — a simple per-effect emoji glyph
		// instead of a canvas swatch. Try the real thing live in the Appearance modal/a game.
		var glyph = document.createElement("span");
		glyph.className = "shop-tile-fx-glyph";
		glyph.textContent = REVEAL_EFFECT_GLYPHS[item.id] || "✨";
		preview.appendChild(glyph);
	}
	tile.appendChild(preview);

	var body = document.createElement("div"); body.className = "shop-tile-body";
	var owned = shopItemUnlocked(item.kind, item.id);
	if (owned) {
		var badge = document.createElement("span"); badge.className = "shop-tile-owned"; badge.textContent = "✓ Owned";
		body.appendChild(badge);
	} else if (!account || account.guest) {
		var signInBtn = document.createElement("button");
		signInBtn.type = "button"; signInBtn.className = "btn btn-ghost shop-tile-btn";
		signInBtn.textContent = "Sign in to buy";
		signInBtn.addEventListener("click", function() { if (typeof doSignIn === "function") doSignIn(); });
		body.appendChild(signInBtn);
	} else {
		var buyBtn = document.createElement("button");
		buyBtn.type = "button"; buyBtn.className = "btn btn-primary shop-tile-btn";
		// Deliberately identical whether fakeShopMode is on or not — the shop should look exactly the
		// same either way, only what happens on click differs (see buyShopItem). Just the price, no
		// "Buy" prefix — it's already the only thing a buy button on an unowned item could mean.
		buyBtn.textContent = shopPriceLabel(item.id);
		buyBtn.addEventListener("click", function() { buyShopItem(item, buyBtn); });
		body.appendChild(buyBtn);
	}
	tile.appendChild(body);
	return tile;
}

function renderShop() {
	var view = document.getElementById("shop_view");
	if (!view || typeof ShopCatalog === "undefined") return;
	view.innerHTML = "";

	var titleRow = document.createElement("div"); titleRow.className = "shop-title-row";
	var title = document.createElement("h1"); title.className = "section-page-title"; title.textContent = "Shop";
	titleRow.appendChild(title);

	// Admin-only escape hatch for demoing/testing the shop (works in prod too) without a real charge —
	// the server independently re-checks is_admin on every /api/shop/fake-grant call, so this toggle
	// is just the client-side switch, not itself a trust boundary. Deliberately doesn't change the
	// shop's appearance beyond itself (see buildShopTile) — flipping it should be invisible to anyone
	// glancing at the page, only observable in what actually happens on a Buy click.
	if (account && account.isAdmin) {
		var fakeRow = document.createElement("div"); fakeRow.className = "shop-fake-toggle";
		var fakeTxt = document.createElement("span"); fakeTxt.className = "shop-fake-toggle-label";
		fakeTxt.textContent = "Fake shop";
		fakeRow.appendChild(fakeTxt);
		var sw = document.createElement("button");
		sw.type = "button";
		sw.className = "toggle-switch" + (fakeShopMode ? " on" : "");
		sw.setAttribute("aria-pressed", fakeShopMode ? "true" : "false");
		sw.setAttribute("aria-label", "Fake shop: activate items instantly, skip checkout (admin only)");
		sw.addEventListener("click", function() { fakeShopMode = !fakeShopMode; renderShop(); });
		fakeRow.appendChild(sw);
		titleRow.appendChild(fakeRow);
	}
	view.appendChild(titleRow);

	var sub = document.createElement("p"); sub.className = "section-page-sub";
	sub.textContent = "Cosmetics only — avatars and board skins never change how the game plays.";
	view.appendChild(sub);

	var status = document.createElement("div"); status.id = "shop_status"; status.style.display = "none";
	view.appendChild(status);

	// Only categories that actually have items get a tab — a future category with nothing in
	// ShopCatalog.ITEMS yet simply doesn't show up rather than rendering an empty tab.
	var categories = SHOP_CATEGORIES.filter(function(cat) {
		return ShopCatalog.ITEMS.some(function(i) { return i.kind === cat.kind; });
	});
	if (!categories.length) return;
	if (!shopActiveKind || !categories.some(function(c) { return c.kind === shopActiveKind; })) {
		shopActiveKind = categories[0].kind;
	}

	var tabs = document.createElement("div"); tabs.className = "shop-tabs";
	categories.forEach(function(cat) {
		var tab = document.createElement("button");
		tab.type = "button";
		tab.className = "shop-tab" + (cat.kind === shopActiveKind ? " active" : "");
		tab.textContent = cat.label;
		tab.addEventListener("click", function() {
			if (shopActiveKind === cat.kind) return;
			shopActiveKind = cat.kind;
			renderShop();
		});
		tabs.appendChild(tab);
	});
	view.appendChild(tabs);

	var activeCat = categories.filter(function(c) { return c.kind === shopActiveKind; })[0];
	var card = document.createElement("div"); card.className = "section-card shop-category-card";
	var head = document.createElement("div"); head.className = "shop-category-head";
	var bar = document.createElement("span"); bar.className = "shop-category-bar"; bar.setAttribute("aria-hidden", "true");
	head.appendChild(bar);
	var headText = document.createElement("div");
	var h = document.createElement("h2"); h.className = "shop-category-title"; h.textContent = activeCat.label;
	headText.appendChild(h);
	var tagline = document.createElement("p"); tagline.className = "shop-category-tagline"; tagline.textContent = activeCat.tagline;
	headText.appendChild(tagline);
	head.appendChild(headText);
	card.appendChild(head);

	var grid = document.createElement("div"); grid.className = "shop-grid";
	ShopCatalog.ITEMS.filter(function(i) { return i.kind === shopActiveKind; }).forEach(function(item) {
		grid.appendChild(buildShopTile(item));
	});
	card.appendChild(grid);
	view.appendChild(card);

	handleShopReturn();
}

var shopPollTimer = null;
// The redirect back from Stripe's hosted Checkout page lands here with ?purchase=success|cancel.
// On success, poll /api/shop/session-status briefly — the webhook (the authoritative grant path)
// can lag a beat behind the redirect, so this is a self-healing UX convenience on top of it, not
// a replacement (grantItem is idempotent either way).
function handleShopReturn() {
	if (shopPollTimer) { clearTimeout(shopPollTimer); shopPollTimer = null; }
	var params = new URLSearchParams(window.location.search);
	var purchase = params.get("purchase");
	if (!purchase) return;
	if (purchase === "cancel") { shopStatusBanner("Checkout cancelled — nothing was charged.", "info"); return; }
	if (purchase !== "success") return;
	var sessionId = params.get("session_id");
	if (!sessionId || !account) { shopStatusBanner("Purchase complete!", "success"); return; }
	pollShopSessionStatus(sessionId, 0);
}

function pollShopSessionStatus(sessionId, attempt) {
	fetch("/api/shop/session-status?session_id=" + encodeURIComponent(sessionId), { headers: shopHeaders() })
		.then(function(r) { return r.json(); })
		.then(function(data) {
			if (data.owned) {
				if (!account.ownedItems) account.ownedItems = [];
				if (data.itemId && account.ownedItems.indexOf(data.itemId) === -1) account.ownedItems.push(data.itemId);
				shopStatusBanner("Purchase complete!", "success");
				renderShop();
				if (typeof socket !== "undefined") socket.emit("refresh_owned_items");
				return;
			}
			if (data.paid && attempt < 6) {
				shopStatusBanner("Payment received — finishing up…", "info");
				shopPollTimer = setTimeout(function() { pollShopSessionStatus(sessionId, attempt + 1); }, 1500);
				return;
			}
			shopStatusBanner(data.paid ? "Still processing — check back in a minute." : "Payment not completed.", "info");
		}).catch(function() { shopStatusBanner("Couldn't confirm your purchase — refresh to check again.", "error"); });
}
