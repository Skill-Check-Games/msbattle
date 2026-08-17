// Direct db.js unit coverage for shop ownership: grantItem is idempotent (INSERT OR IGNORE on the
// (user,kind,item) PK), ownsItem/listOwnedItemIds reflect grants, and markStripeEventProcessed
// follows the same idempotency idiom as markMatchPersisted (see test/idempotency.test.js).

const { test, before } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const sqlite = require("node:sqlite");

let db;
let dbPath;
before(() => {
	dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ms-shopdb-")), "test.db");
	process.env.RANKED_DB = dbPath;
	db = require("../src/server/db");
});

test("grantItem grants an item exactly once", () => {
	const u = db.createGuest();
	assert.strictEqual(db.ownsItem(u.id, "avatar", "img:scout-dog"), false);
	assert.strictEqual(db.grantItem(u.id, "avatar", "img:scout-dog", { priceCents: 199, currency: "usd" }), true, "first grant → newly granted");
	assert.strictEqual(db.ownsItem(u.id, "avatar", "img:scout-dog"), true);
	assert.strictEqual(db.grantItem(u.id, "avatar", "img:scout-dog", { priceCents: 199, currency: "usd" }), false, "second grant → already owned");
});

test("listOwnedItemIds returns every owned item for a user, independent of other users", () => {
	const u1 = db.createGuest();
	const u2 = db.createGuest();
	db.grantItem(u1.id, "avatar", "img:scout-dog", {});
	db.grantItem(u1.id, "skin", "tactical", {});
	db.grantItem(u2.id, "avatar", "img:sentry-fox", {});

	assert.deepStrictEqual(db.listOwnedItemIds(u1.id).sort(), ["img:scout-dog", "tactical"]);
	assert.deepStrictEqual(db.listOwnedItemIds(u2.id), ["img:sentry-fox"]);
});

test("grantItem stores a $0 price as 0, not null (admin fake-grants pass priceCents: 0)", () => {
	const u = db.createGuest();
	assert.strictEqual(db.grantItem(u.id, "skin", "gold", { priceCents: 0, currency: "usd", stripeSessionId: "fake-shop:admin" }), true);
	const raw = new sqlite.DatabaseSync(dbPath);
	const row = raw.prepare("SELECT price_cents, stripe_session_id FROM shop_purchases WHERE user_id = ? AND kind = ? AND item_id = ?").get(u.id, "skin", "gold");
	raw.close();
	assert.strictEqual(row.price_cents, 0, "0 must survive as 0, not collapse to null via `|| null`");
	assert.strictEqual(row.stripe_session_id, "fake-shop:admin");
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
