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

// The Shop page IS the customize lab (mountCustomizeLab, Profile.js) hosted as a page: same tabs,
// same tiles (owned ones apply, locked ones preview + show a price), same live preview board.

// One glyph per reveal effect, standing in for a static preview image (the lab tiles, Profile.js). An
// animation has no single frame worth screenshotting the way a skin's board preview does. "ripple"
// isn't a ShopCatalog item (it's the free default, never shown in the Shop grid itself) but the
// picker in the Appearance modal (Profile.js) lists it alongside the purchasable ones, so it needs
// a glyph here too.
var REVEAL_EFFECT_GLYPHS = { ripple: "🌊", spark: "⚡", shatter: "💥", crt: "📺", dust: "💨" };

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

// Fake-shop access: a real admin account, or running against a DEV_AUTH-enabled local server (the
// same "admin or local dev, for convenience" bar refreshAdminNavLink/PuzzleLab.js already uses for
// the Admin nav link) — window.serverInfo.dev is set from the connected event's oauth.dev flag
// (noteServerDev, PuzzleLab.js). Purely a client-side convenience: the server's own /api/shop/
// fake-grant independently re-checks real is_admin (isSocketAdmin's DEV_AUTH bypass covers the rest
// of that gap there), so showing this locally with no is_admin row set doesn't grant anything by
// itself — it just lets a solo local dev exercise the toggle without hand-flipping their DB.
function shopFakeShopAllowed() {
	return !!(account && account.isAdmin) || !!(window.serverInfo && window.serverInfo.dev);
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
	// Also re-checks shopFakeShopAllowed() here (not just the checkbox's own gating) so a stale
	// in-memory fakeShopMode="true" can't leak into a real checkout for an account/session that no
	// longer qualifies (e.g. an admin toggles it on, then signs out into a guest without a page reload).
	if (fakeShopMode && shopFakeShopAllowed()) { buyShopItemFake(item, btn, originalLabel); return; }
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

function renderShop() {
	var view = document.getElementById("shop_view");
	if (!view || typeof ShopCatalog === "undefined") return;
	// Only while the page is actually showing: mounting the lab takes over the shared board engine, so
	// an owned_items event landing mid-game must not build it into a hidden view.
	if (view.style.display === "none") return;
	// Unmount BEFORE wiping the view: the lab reparents the game's #board_focus_ring/#board_press_highlight
	// into its board frame, and innerHTML = "" would destroy them for the rest of the session.
	if (typeof unmountCustomizeLab === "function") unmountCustomizeLab();
	view.innerHTML = "";

	var titleRow = document.createElement("div"); titleRow.className = "shop-title-row";
	var title = document.createElement("h1"); title.className = "section-page-title"; title.textContent = "Shop";
	titleRow.appendChild(title);

	// Admin (or local DEV_AUTH) escape hatch for demoing/testing the shop (works in prod too, for a
	// real admin) without a real charge — the server independently re-checks is_admin on every
	// /api/shop/fake-grant call (isSocketAdmin's own DEV_AUTH bypass covers the local case), so this
	// toggle is just the client-side switch, not itself a trust boundary. Deliberately doesn't change
	// the shop's appearance beyond itself. Flipping it should be invisible to
	// anyone glancing at the page, only observable in what actually happens on a Buy click.
	if (shopFakeShopAllowed()) {
		var fakeRow = document.createElement("div"); fakeRow.className = "shop-fake-toggle";
		var fakeTxt = document.createElement("span"); fakeTxt.className = "shop-fake-toggle-label";
		fakeTxt.textContent = "Fake shop";
		fakeRow.appendChild(fakeTxt);
		var sw = document.createElement("button");
		sw.type = "button";
		sw.className = "toggle-switch" + (fakeShopMode ? " on" : "");
		sw.setAttribute("aria-pressed", fakeShopMode ? "true" : "false");
		sw.setAttribute("aria-label", "Fake shop: activate items instantly, skip checkout (admin or local dev)");
		sw.addEventListener("click", function() { fakeShopMode = !fakeShopMode; renderShop(); });
		fakeRow.appendChild(sw);
		titleRow.appendChild(fakeRow);
	}
	view.appendChild(titleRow);

	var sub = document.createElement("p"); sub.className = "section-page-sub";
	sub.textContent = "Cosmetics only. Avatars and board skins never change how the game plays.";
	view.appendChild(sub);

	var status = document.createElement("div"); status.id = "shop_status"; status.style.display = "none";
	view.appendChild(status);

	var host = document.createElement("div"); host.className = "lab-host shop-lab-host";
	view.appendChild(host);
	if (typeof mountCustomizeLab === "function") mountCustomizeLab(host);

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
