// Shop: browse + buy avatar presets and board skins with real money (Stripe Checkout, hosted
// page — this view only ever talks to our own /api/shop/* endpoints, never Stripe directly, so it
// needs no Stripe.js). A purchase is a full-page redirect away and back, so this view also handles
// the return trip (?purchase=success|cancel&session_id=...). Ownership rides account.ownedItems,
// shipped on the `authenticated` payload / SSR hydration (see session.js buildAccountPayload) and
// re-synced after a purchase via the refresh_owned_items/owned_items socket round-trip.
//
// buildSkinPreview/shopItemUnlocked/shopPriceLabel/goToShop are shared with the Settings pickers —
// see Profile.js.

function shopHeaders() {
	try {
		var t = localStorage.getItem("ms_session");
		return t ? { "X-Session-Token": t } : {};
	} catch (e) { return {}; }
}

function shopStatusBanner(text, kind) {
	var el = document.getElementById("shop_status");
	if (!el) return;
	if (!text) { el.style.display = "none"; el.textContent = ""; return; }
	el.className = "section-card shop-status" + (kind ? " shop-status-" + kind : "");
	el.textContent = text;
	el.style.display = "";
}

function buyShopItem(item, btn) {
	var originalLabel = btn.textContent;
	btn.disabled = true;
	btn.textContent = "Starting checkout…";
	fetch("/api/shop/checkout", {
		method: "POST",
		headers: Object.assign({ "Content-Type": "application/json" }, shopHeaders()),
		body: JSON.stringify({ itemId: item.id })
	}).then(function(r) { return r.json(); }).then(function(data) {
		if (data.alreadyOwned) {
			if (!account.ownedItems) account.ownedItems = [];
			if (account.ownedItems.indexOf(item.id) === -1) account.ownedItems.push(item.id);
			renderShop();
			return;
		}
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
	tile.className = "shop-tile";

	var preview = document.createElement("div"); preview.className = "shop-tile-preview";
	if (item.kind === "avatar" && typeof buildAvatarCanvas === "function") preview.appendChild(buildAvatarCanvas(item.id, 64));
	else if (item.kind === "skin" && typeof buildSkinPreview === "function") preview.appendChild(buildSkinPreview(item.id));
	tile.appendChild(preview);

	var name = document.createElement("div"); name.className = "shop-tile-name"; name.textContent = item.label;
	tile.appendChild(name);

	var owned = shopItemUnlocked(item.kind, item.id);
	if (owned) {
		var badge = document.createElement("span"); badge.className = "shop-tile-owned"; badge.textContent = "✓ Owned";
		tile.appendChild(badge);
	} else if (!account || account.guest) {
		var signInBtn = document.createElement("button");
		signInBtn.type = "button"; signInBtn.className = "btn btn-ghost shop-tile-btn";
		signInBtn.textContent = "Sign in to buy";
		signInBtn.addEventListener("click", function() { if (typeof doSignIn === "function") doSignIn(); });
		tile.appendChild(signInBtn);
	} else {
		var buyBtn = document.createElement("button");
		buyBtn.type = "button"; buyBtn.className = "btn btn-primary shop-tile-btn";
		buyBtn.textContent = "Buy — " + shopPriceLabel(item.id);
		buyBtn.addEventListener("click", function() { buyShopItem(item, buyBtn); });
		tile.appendChild(buyBtn);
	}
	return tile;
}

function renderShop() {
	var view = document.getElementById("shop_view");
	if (!view || typeof ShopCatalog === "undefined") return;
	view.innerHTML = "";

	var title = document.createElement("h1"); title.className = "section-page-title"; title.textContent = "Shop";
	view.appendChild(title);
	var sub = document.createElement("p"); sub.className = "section-page-sub";
	sub.textContent = "Cosmetics only — avatars and board skins never change how the game plays.";
	view.appendChild(sub);

	var status = document.createElement("div"); status.id = "shop_status"; status.style.display = "none";
	view.appendChild(status);

	function section(labelText, kind) {
		var items = ShopCatalog.ITEMS.filter(function(i) { return i.kind === kind; });
		if (!items.length) return;
		var card = document.createElement("div"); card.className = "section-card";
		var h = document.createElement("h2"); h.className = "controls-title"; h.textContent = labelText;
		card.appendChild(h);
		var grid = document.createElement("div"); grid.className = "shop-grid";
		items.forEach(function(item) { grid.appendChild(buildShopTile(item)); });
		card.appendChild(grid);
		view.appendChild(card);
	}
	section("Avatars", "avatar");
	section("Board skins", "skin");

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
