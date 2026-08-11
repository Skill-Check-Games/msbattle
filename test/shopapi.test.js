// Integration coverage for the shop's HTTP surface (shopApi.js): unconfigured (no Stripe keys)
// degrades cleanly, checkout auth/validation (401/403/404) never needs a real Stripe network call
// since those checks happen before any API call, and the webhook is verified end-to-end using
// stripe.webhooks.generateTestHeaderString — a pure-crypto helper the SDK ships specifically for
// this, so signature verification is tested with zero network access.

var test = require("node:test");
var assert = require("node:assert");
var io = require("socket.io-client");
var Stripe = require("stripe");
var path = require("node:path");
var os = require("node:os");
var execFileSync = require("node:child_process").execFileSync;
var helpers = require("./helpers");

var FAKE_SECRET_KEY = "sk_test_fake_for_tests";
var FAKE_WEBHOOK_SECRET = "whsec_fake_for_tests";
var STRIPE_PORT = 13821;
// helpers.startServer computes this exact path internally from (this process's pid, the port) — a
// spawned server's db is a *different process*, so touching its rows from here (to grant an item, or
// assert the webhook actually persisted one) has to go through db.js in a child process pointed at
// the same file, same as test/marathonlives.test.js's "seed the live DB from outside" pattern. A
// same-process require("../src/server/db") would silently open a DIFFERENT (default-path) database.
var STRIPE_DB_PATH = path.join(os.tmpdir(), "ms-test-" + process.pid + "-" + STRIPE_PORT + ".db");
function dbCall(script) {
	var out = execFileSync("node", ["-e", "var db=require('./src/server/db');" + script], {
		cwd: helpers.ROOT, env: Object.assign({}, process.env, { RANKED_DB: STRIPE_DB_PATH })
	});
	return JSON.parse(out.toString().trim());
}

function once(socket, event, ms) {
	return new Promise(function(resolve, reject) {
		var t = setTimeout(function() { reject(new Error("timeout waiting for '" + event + "'")); }, ms || 5000);
		socket.once(event, function(d) { clearTimeout(t); resolve(d); });
	});
}

// --- Unconfigured server (no Stripe keys — the default local/CI state) ------------------------
var plainServer;
test.before(async function() { plainServer = await helpers.startServer({ port: 13820 }); });
test.after(function() { if (plainServer) plainServer.stop(); });

test("checkout is a clean 503 when Stripe isn't configured", async function() {
	var r = await fetch(plainServer.base + "/api/shop/checkout", {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: "img:teddy" })
	});
	assert.strictEqual(r.status, 503);
	assert.strictEqual((await r.json()).error, "shop_unconfigured");
});

test("webhook is a clean 503 when Stripe isn't configured", async function() {
	var r = await fetch(plainServer.base + "/api/shop/webhook", { method: "POST", body: "{}" });
	assert.strictEqual(r.status, 503);
});

// --- Configured server (fake Stripe test-mode keys — no real network calls in these tests) -----
var stripeServer;
test.before(async function() {
	stripeServer = await helpers.startServer({ port: STRIPE_PORT, env: { STRIPE_SECRET_KEY: FAKE_SECRET_KEY, STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET } });
});
test.after(function() { if (stripeServer) stripeServer.stop(); });

async function guestToken() {
	var c = io(stripeServer.base, { transports: ["websocket"], forceNew: true });
	await once(c, "connected");
	c.emit("guest_session");
	var data = await once(c, "authenticated");
	c.close();
	return data.token;
}
async function realUserToken() {
	var r = await fetch(stripeServer.base + "/auth/dev?name=ShopTester", { redirect: "manual" });
	var loc = r.headers.get("location"); // "http://.../#token=<token>"
	return loc.split("#token=")[1];
}

test("checkout with no session token -> 401 unauthenticated", async function() {
	var r = await fetch(stripeServer.base + "/api/shop/checkout", {
		method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: "img:teddy" })
	});
	assert.strictEqual(r.status, 401);
});

test("checkout as a guest -> 403 guest_not_allowed", async function() {
	var token = await guestToken();
	var r = await fetch(stripeServer.base + "/api/shop/checkout", {
		method: "POST", headers: { "Content-Type": "application/json", "X-Session-Token": token }, body: JSON.stringify({ itemId: "img:teddy" })
	});
	assert.strictEqual(r.status, 403);
	assert.strictEqual((await r.json()).error, "guest_not_allowed");
});

test("checkout with an unknown itemId -> 404 unknown_item", async function() {
	var token = await realUserToken();
	var r = await fetch(stripeServer.base + "/api/shop/checkout", {
		method: "POST", headers: { "Content-Type": "application/json", "X-Session-Token": token }, body: JSON.stringify({ itemId: "not-a-real-item" })
	});
	assert.strictEqual(r.status, 404);
	assert.strictEqual((await r.json()).error, "unknown_item");
});

test("checkout for an already-owned item skips Stripe entirely -> { alreadyOwned: true }", async function() {
	var token = await realUserToken();
	var userId = dbCall("console.log(JSON.stringify(db.getUserByToken('" + token + "').id))");
	dbCall("db.grantItem(" + userId + ", 'avatar', 'img:teddy', {}); console.log('null')");

	var r = await fetch(stripeServer.base + "/api/shop/checkout", {
		method: "POST", headers: { "Content-Type": "application/json", "X-Session-Token": token }, body: JSON.stringify({ itemId: "img:teddy" })
	});
	assert.strictEqual(r.status, 200);
	assert.deepStrictEqual(await r.json(), { alreadyOwned: true });
});

test("webhook rejects a bad/tampered signature", async function() {
	var r = await fetch(stripeServer.base + "/api/shop/webhook", {
		method: "POST",
		headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=deadbeef" },
		body: JSON.stringify({ id: "evt_bad", type: "checkout.session.completed" })
	});
	assert.strictEqual(r.status, 400);
});

test("webhook with a valid signature grants the item, and a redelivered event doesn't double-grant", async function() {
	var token = await realUserToken();
	var userId = dbCall("console.log(JSON.stringify(db.getUserByToken('" + token + "').id))");
	assert.strictEqual(dbCall("console.log(JSON.stringify(db.ownsItem(" + userId + ", 'skin', 'tactical')))"), false);

	var stripeForSigning = new Stripe(FAKE_SECRET_KEY);
	var payload = JSON.stringify({
		id: "evt_checkout_test_1",
		type: "checkout.session.completed",
		data: { object: {
			id: "cs_test_1", amount_total: 499, currency: "usd", payment_intent: "pi_test_1",
			metadata: { userId: String(userId), kind: "skin", itemId: "tactical" }
		} }
	});
	var signature = stripeForSigning.webhooks.generateTestHeaderString({ payload: payload, secret: FAKE_WEBHOOK_SECRET });

	var r1 = await fetch(stripeServer.base + "/api/shop/webhook", {
		method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: payload
	});
	assert.strictEqual(r1.status, 200);
	assert.strictEqual(dbCall("console.log(JSON.stringify(db.ownsItem(" + userId + ", 'skin', 'tactical')))"), true, "webhook granted the item");

	// Stripe can redeliver the same event id — replay must not double-count (grantItem's own PK
	// makes this safe regardless, but the processed_stripe_events ledger should also short-circuit it).
	var r2 = await fetch(stripeServer.base + "/api/shop/webhook", {
		method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: payload
	});
	assert.strictEqual(r2.status, 200);
	var owned = dbCall("console.log(JSON.stringify(db.listOwnedItemIds(" + userId + ")))");
	assert.deepStrictEqual(owned.filter(function(id) { return id === "tactical"; }), ["tactical"]);
});
