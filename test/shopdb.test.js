// Direct db.js unit coverage for shop ownership: grantItem is idempotent (INSERT OR IGNORE on the
// (user,kind,item) PK), ownsItem/listOwnedItemIds reflect grants, and markStripeEventProcessed
// follows the same idempotency idiom as markMatchPersisted (see test/idempotency.test.js).

const { test, before } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

let db;
before(() => {
	process.env.RANKED_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ms-shopdb-")), "test.db");
	db = require("../src/server/db");
});

test("grantItem grants an item exactly once", () => {
	const u = db.createGuest();
	assert.strictEqual(db.ownsItem(u.id, "avatar", "img:teddy"), false);
	assert.strictEqual(db.grantItem(u.id, "avatar", "img:teddy", { priceCents: 199, currency: "usd" }), true, "first grant → newly granted");
	assert.strictEqual(db.ownsItem(u.id, "avatar", "img:teddy"), true);
	assert.strictEqual(db.grantItem(u.id, "avatar", "img:teddy", { priceCents: 199, currency: "usd" }), false, "second grant → already owned");
});

test("listOwnedItemIds returns every owned item for a user, independent of other users", () => {
	const u1 = db.createGuest();
	const u2 = db.createGuest();
	db.grantItem(u1.id, "avatar", "img:teddy", {});
	db.grantItem(u1.id, "skin", "tactical", {});
	db.grantItem(u2.id, "avatar", "img:mine-dog", {});

	assert.deepStrictEqual(db.listOwnedItemIds(u1.id).sort(), ["img:teddy", "tactical"]);
	assert.deepStrictEqual(db.listOwnedItemIds(u2.id), ["img:mine-dog"]);
});

test("markStripeEventProcessed records an eventId exactly once", () => {
	const id = "evt_test_123";
	assert.strictEqual(db.markStripeEventProcessed(id), true, "first time → newly processed");
	assert.strictEqual(db.markStripeEventProcessed(id), false, "second time → already processed");
	assert.strictEqual(db.markStripeEventProcessed(id), false, "still idempotent on further retries");
});

test("a missing stripe event id fails open (does not block processing)", () => {
	assert.strictEqual(db.markStripeEventProcessed(null), true);
	assert.strictEqual(db.markStripeEventProcessed(""), true);
});
