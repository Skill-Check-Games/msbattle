// Pure unit coverage for src/common/ShopCatalog.js: every catalog item round-trips against
// Cosmetics (the boot-time integrity check this file relies on to catch id drift), and
// byId/isPurchasable behave as the ownership-gating call sites (session.js) expect.

const { test } = require("node:test");
const assert = require("node:assert");

const Cosmetics = require("../src/common/Cosmetics");
const ShopCatalog = require("../src/common/ShopCatalog");

test("every avatar preset in Cosmetics has a catalog entry, and vice versa", () => {
	const avatarIds = Object.keys(Cosmetics.AVATAR_IMAGES).map((id) => "img:" + id)
		.concat(Cosmetics.AVATAR_COLORS.slice(1)); // every colour past the free/default one is purchasable
	const catalogAvatarIds = ShopCatalog.ITEMS.filter((i) => i.kind === "avatar").map((i) => i.id);
	assert.deepStrictEqual(catalogAvatarIds.sort(), avatarIds.sort());
});

test("tactical skin is purchasable, classic is not (free/default)", () => {
	assert.strictEqual(ShopCatalog.isPurchasable("skin", "tactical"), true);
	assert.strictEqual(ShopCatalog.isPurchasable("skin", "classic"), false);
});

test("free avatar values (anon, mine, the default flag colour) are not purchasable", () => {
	assert.strictEqual(ShopCatalog.isPurchasable("avatar", "anon"), false);
	assert.strictEqual(ShopCatalog.isPurchasable("avatar", "mine"), false);
	assert.strictEqual(ShopCatalog.isPurchasable("avatar", "#ef4444"), false);
});

test("byId resolves a real item with its price, and returns null for an unknown id", () => {
	const item = ShopCatalog.byId("img:scout-dog");
	assert.strictEqual(item.kind, "avatar");
	assert.strictEqual(item.priceCents, 199);
	assert.strictEqual(ShopCatalog.byId("img:not-a-real-avatar"), null);
});

test("the tactical skin item is priced higher than an avatar preset", () => {
	const skin = ShopCatalog.byId("tactical");
	const avatar = ShopCatalog.byId("img:scout-dog");
	assert.strictEqual(skin.priceCents, 499);
	assert.ok(skin.priceCents > avatar.priceCents);
});

test("every REVEAL_EFFECT_LIST entry past the free default (ripple) has a catalog entry, and vice versa", () => {
	const effectIds = Cosmetics.REVEAL_EFFECT_LIST.filter((id) => id !== Cosmetics.DEFAULT_REVEAL_EFFECT);
	const catalogEffectIds = ShopCatalog.ITEMS.filter((i) => i.kind === "revealEffect").map((i) => i.id);
	assert.deepStrictEqual(catalogEffectIds.sort(), effectIds.sort());
});

test("ripple (the free/default reveal effect) is not purchasable, shatter is", () => {
	assert.strictEqual(ShopCatalog.isPurchasable("revealEffect", "ripple"), false);
	assert.strictEqual(ShopCatalog.isPurchasable("revealEffect", "shatter"), true);
});
