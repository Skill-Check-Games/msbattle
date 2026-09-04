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
	var MONOCHROME_SKIN_PRICE_CENTS = 299;
	var TACTICAL_SKIN_PRICE_CENTS = 499;
	var FROST_SKIN_PRICE_CENTS = 499;
	var GOLD_SKIN_PRICE_CENTS = 599;
	var NEON_SKIN_PRICE_CENTS = 699;
	// Reveal effects are pure code (no art asset), and each only ever affects the local player's own
	// board (see Cosmetics.js's own comment) — priced as a lighter "flourish" tier below the avatars/
	// skins rather than matched to them.
	var DUST_FX_PRICE_CENTS = 149;
	var SPARK_FX_PRICE_CENTS = 199;
	var CRT_FX_PRICE_CENTS = 249;
	var SHATTER_FX_PRICE_CENTS = 299;

	function avatarLabel(id) {
		return id.split("-").map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
	}

	function buildItems() {
		var Cosmetics = (typeof module !== "undefined" && module.exports) ? require("./Cosmetics") : window.Cosmetics;
		var items = [];
		Object.keys(Cosmetics.AVATAR_IMAGES).forEach(function(id) {
			// imagePath: a real, publicly-served static asset (unlike the board skins below, which are
			// palette-only — no static preview image exists for those yet) — used by
			// scripts/provision-stripe-catalog.js to set the Stripe Product's image.
			items.push({ id: "img:" + id, kind: "avatar", productType: "avatar", label: avatarLabel(id), priceCents: AVATAR_PRICE_CENTS, currency: "usd", imagePath: Cosmetics.AVATAR_IMAGES[id], tier: "common" });
		});
		// Every AVATAR_COLORS entry past the first (free/default) one is a purchasable flag colour.
		// Hardcoded label — fine while there's exactly one extra colour; if more are added, give
		// AVATAR_COLORS a {hex,label} shape instead of guessing names from hex values here.
		// productType is "flag" here (not "avatar") — same `kind`/DB bucket as the avatar images
		// (both set the player's avatar), but a flag colour and an avatar image are a different
		// *product* to a buyer/in Stripe's catalog, same "flags are a separate thing" reasoning as
		// the pirate-flag-in-AVATAR_COLORS split documented in CLAUDE.md.
		Cosmetics.AVATAR_COLORS.slice(1).forEach(function(hex) {
			items.push({ id: hex, kind: "avatar", productType: "flag", label: "Pirate Flag", priceCents: AVATAR_PRICE_CENTS, currency: "usd", tier: "common" });
		});
		items.push({
			id: "monochrome", kind: "skin", productType: "board_skin",
			label: Cosmetics.BOARD_SKINS.monochrome.label,
			priceCents: MONOCHROME_SKIN_PRICE_CENTS, currency: "usd",
			imagePath: "/skins/monochrome-preview.png",
			// Cheapest paid skin, plainest palette (literally black/white/grey) — "common" fits both
			// its price and its own look, unlike the others below which lean into a flashier tier.
			tier: "common"
		});
		items.push({
			id: "tactical", kind: "skin", productType: "board_skin",
			label: Cosmetics.BOARD_SKINS.tactical.label,
			priceCents: TACTICAL_SKIN_PRICE_CENTS, currency: "usd",
			// Generated (not hand-authored like the avatar PNGs) — see
			// scripts/render-skin-preview-images.js, which reproduces the exact in-app skin-preview
			// strip (buildSkinPreview, Profile.js) at high resolution since skins have no other
			// static asset (they're painted live from this palette, never saved as a file).
			imagePath: "/skins/tactical-preview.png",
			// Shop-display rarity only (see .shop-tile-rare/-epic, style.css) — purely cosmetic framing
			// for how the tile itself is bordered/lit, not a gameplay or ownership concept.
			tier: "rare"
		});
		items.push({
			id: "frost", kind: "skin", productType: "board_skin",
			label: Cosmetics.BOARD_SKINS.frost.label,
			priceCents: FROST_SKIN_PRICE_CENTS, currency: "usd",
			imagePath: "/skins/frost-preview.png",
			tier: "rare"
		});
		items.push({
			id: "gold", kind: "skin", productType: "board_skin",
			label: Cosmetics.BOARD_SKINS.gold.label,
			priceCents: GOLD_SKIN_PRICE_CENTS, currency: "usd",
			imagePath: "/skins/gold-preview.png",
			// The one item in the shop actually named "Gold" gets the gold "epic" tile treatment —
			// nice coincidence, not engineered, but too fitting to pass up.
			tier: "epic"
		});
		items.push({
			id: "neon", kind: "skin", productType: "board_skin",
			label: Cosmetics.BOARD_SKINS.neon.label,
			priceCents: NEON_SKIN_PRICE_CENTS, currency: "usd",
			imagePath: "/skins/neon-preview.png",
			// Flashiest/priciest skin (glowing digits, the only other `glow:true` skin besides
			// Tactical) — epic fits.
			tier: "epic"
		});

		// Cascade reveal effects (Cosmetics.js's own REVEAL_EFFECTS has the label/blurb copy already —
		// not duplicated here, this is just id/price/tier). "ripple" is the free/default treatment, so
		// it's the one REVEAL_EFFECT_LIST entry with no catalog item, same as classic/anon/mine above.
		items.push({
			id: "dust", kind: "revealEffect", productType: "reveal_effect",
			label: Cosmetics.REVEAL_EFFECTS.dust.label,
			priceCents: DUST_FX_PRICE_CENTS, currency: "usd",
			// Cheapest/most subtle candidate — common fits both its price and its own restraint.
			tier: "common"
		});
		items.push({
			id: "spark", kind: "revealEffect", productType: "reveal_effect",
			label: Cosmetics.REVEAL_EFFECTS.spark.label,
			priceCents: SPARK_FX_PRICE_CENTS, currency: "usd",
			tier: "common"
		});
		items.push({
			id: "crt", kind: "revealEffect", productType: "reveal_effect",
			label: Cosmetics.REVEAL_EFFECTS.crt.label,
			priceCents: CRT_FX_PRICE_CENTS, currency: "usd",
			tier: "rare"
		});
		items.push({
			id: "shatter", kind: "revealEffect", productType: "reveal_effect",
			label: Cosmetics.REVEAL_EFFECTS.shatter.label,
			priceCents: SHATTER_FX_PRICE_CENTS, currency: "usd",
			// The most dramatic candidate, and the one that deliberately echoes the rank-up Shatter &
			// Reform animation's own visual language — epic fits.
			tier: "epic"
		});

		// Boot-time integrity check: every catalog id must be a real cosmetic id, so a typo or a
		// cosmetic later removed from Cosmetics.js can't silently sell (or gate) a nonexistent item.
		items.forEach(function(item) {
			if (item.kind === "avatar" && item.id.indexOf("img:") === 0) {
				var avatarId = item.id.slice(4);
				if (!Cosmetics.AVATAR_IMAGES[avatarId]) throw new Error("ShopCatalog: unknown avatar id \"" + avatarId + "\"");
			} else if (item.kind === "avatar") {
				if (Cosmetics.AVATAR_COLORS.indexOf(item.id) === -1) throw new Error("ShopCatalog: unknown avatar colour \"" + item.id + "\"");
			} else if (item.kind === "skin") {
				if (Cosmetics.BOARD_SKIN_LIST.indexOf(item.id) === -1) throw new Error("ShopCatalog: unknown skin id \"" + item.id + "\"");
			} else if (item.kind === "revealEffect") {
				if (Cosmetics.REVEAL_EFFECT_LIST.indexOf(item.id) === -1) throw new Error("ShopCatalog: unknown reveal effect id \"" + item.id + "\"");
			} else {
				throw new Error("ShopCatalog: unknown item kind \"" + item.kind + "\"");
			}
		});

		// Server-side only (window has no fs/require-json): attach the live-mode Stripe Product/Price
		// ids provisioned by scripts/provision-stripe-catalog.js, so shopApi.js can reference the real
		// catalog entry instead of an inline one-off price. Absent locally (dev/test runs against a
		// different, test-mode Stripe account these live ids don't exist in) or before the script has
		// been run for a newly-added item — shopApi.js falls back to inline price_data in that case,
		// same "degrade instead of throw" stance as the rest of the shop's Stripe integration.
		if (typeof module !== "undefined" && module.exports) {
			var stripeIds = {};
			try { stripeIds = require("../../stripe-shop-catalog.json"); } catch (e) { /* not provisioned yet */ }
			items.forEach(function(item) {
				var ids = stripeIds[item.id];
				if (ids) { item.stripeProductId = ids.productId; item.stripePriceId = ids.priceId; }
			});
		}

		return items;
	}

	var ITEMS = buildItems();
	var BY_ID = {};
	ITEMS.forEach(function(item) { BY_ID[item.id] = item; });

	var ShopCatalog = {
		GAME: "msbattle",
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
