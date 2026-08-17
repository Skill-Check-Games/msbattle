// Shop catalog: which cosmetics are for sale and at what price. Item ids are exactly
// the existing wire values set_avatar/set_skin already use ("img:teddy", "tactical",
// ...), so ownership checks need no id translation. Free/always-owned items (anon,
// mine, the default flag colour, classic skin) are intentionally absent from ITEMS —
// isPurchasable() returning false for them IS the "always allowed" signal callers use.
//
// Hand-authored rather than derived from Cosmetics.AVATAR_IMAGES/BOARD_SKIN_LIST:
// price isn't mechanically derivable from cosmetic data, and which future art drops
// join the paid catalog is a product decision, not something that should happen for
// free just by adding an entry to Cosmetics.js. A boot-time check below still ties
// every catalog id back to Cosmetics, so a typo'd/removed id fails loud instead of
// silently selling something that doesn't exist.
(function() {
	var AVATAR_PRICE_CENTS = 199;
	var TACTICAL_SKIN_PRICE_CENTS = 499;
	var GOLD_SKIN_PRICE_CENTS = 599;

	function avatarLabel(id) {
		return id.split("-").map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
	}

	function buildItems() {
		var Cosmetics = (typeof module !== "undefined" && module.exports) ? require("./Cosmetics") : window.Cosmetics;
		var items = [];
		Object.keys(Cosmetics.AVATAR_IMAGES).forEach(function(id) {
			items.push({ id: "img:" + id, kind: "avatar", label: avatarLabel(id), priceCents: AVATAR_PRICE_CENTS, currency: "usd" });
		});
		items.push({
			id: "tactical", kind: "skin",
			label: Cosmetics.BOARD_SKINS.tactical.label,
			priceCents: TACTICAL_SKIN_PRICE_CENTS, currency: "usd"
		});
		items.push({
			id: "gold", kind: "skin",
			label: Cosmetics.BOARD_SKINS.gold.label,
			priceCents: GOLD_SKIN_PRICE_CENTS, currency: "usd"
		});

		// Boot-time integrity check: every catalog id must be a real cosmetic id, so a typo or a
		// cosmetic later removed from Cosmetics.js can't silently sell (or gate) a nonexistent item.
		items.forEach(function(item) {
			if (item.kind === "avatar") {
				var avatarId = item.id.slice(4);
				if (!Cosmetics.AVATAR_IMAGES[avatarId]) throw new Error("ShopCatalog: unknown avatar id \"" + avatarId + "\"");
			} else if (item.kind === "skin") {
				if (Cosmetics.BOARD_SKIN_LIST.indexOf(item.id) === -1) throw new Error("ShopCatalog: unknown skin id \"" + item.id + "\"");
			} else {
				throw new Error("ShopCatalog: unknown item kind \"" + item.kind + "\"");
			}
		});
		return items;
	}

	var ITEMS = buildItems();
	var BY_ID = {};
	ITEMS.forEach(function(item) { BY_ID[item.id] = item; });

	var ShopCatalog = {
		ITEMS: ITEMS,
		byId: function(id) { return BY_ID[id] || null; },
		// True iff this (kind, id) is a paid catalog item — the gate callers use to decide whether
		// ownership must be checked at all (free/default values simply aren't in the catalog).
		isPurchasable: function(kind, id) {
			var item = BY_ID[id];
			return !!item && item.kind === kind;
		}
	};

	if (typeof module !== "undefined" && module.exports) {
		module.exports = ShopCatalog;
	} else if (typeof window !== "undefined") {
		window.ShopCatalog = ShopCatalog;
	}
})();
