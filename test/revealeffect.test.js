// set_reveal_effect (session.js) is the server-side ownership gate for the reveal-effect shop
// items — unlike set_skin, nothing about the choice is ever relayed to opponents or persisted in
// live game state (see Cosmetics.js's own comment on why it's still gated server-side anyway: a
// purchasable preference a client could just apply via localStorage with no server check at all
// would mean "pay, or open devtools" for anyone, which defeats selling it in the first place).

var test = require("node:test");
var assert = require("node:assert");
var io = require("socket.io-client");
var helpers = require("./helpers");

var server;
test.before(async function() { server = await helpers.startServer({ port: 13892 }); });
test.after(function() { if (server) server.stop(); });

function once(socket, event, ms) {
	return new Promise(function(resolve, reject) {
		var t = setTimeout(function() { reject(new Error("timeout waiting for '" + event + "'")); }, ms || 5000);
		socket.once(event, function(d) { clearTimeout(t); resolve(d); });
	});
}
// Resolves true if `event` fires within `ms`, false if it doesn't — the "confirm nothing happened"
// counterpart to once() above, used to prove the free effect never gets rejected.
function neverFires(socket, event, ms) {
	return new Promise(function(resolve) {
		var t = setTimeout(function() { resolve(true); }, ms || 500);
		socket.once(event, function() { clearTimeout(t); resolve(false); });
	});
}
function connect() { return io(server.base, { transports: ["websocket"], forceNew: true }); }

test("ripple (free/default) is accepted with no rejection", async function() {
	var c = connect();
	try {
		await once(c, "connected");
		c.emit("guest_session");
		await once(c, "authenticated");

		var noReject = neverFires(c, "reveal_effect_rejected", 600);
		c.emit("set_reveal_effect", { effect: "ripple" });
		assert.strictEqual(await noReject, true, "the free default effect is never rejected");
	} finally { c.close(); }
});

test("a purchasable effect the account doesn't own is rejected", async function() {
	var c = connect();
	try {
		await once(c, "connected");
		c.emit("guest_session");
		await once(c, "authenticated");

		var rejected = once(c, "reveal_effect_rejected", 5000);
		c.emit("set_reveal_effect", { effect: "shatter" });
		var r = await rejected;
		assert.strictEqual(r.effect, "shatter");
		assert.strictEqual(r.reason, "not_owned");
	} finally { c.close(); }
});

test("a malformed effect id is dropped silently, not rejected (it never reaches the ownership check)", async function() {
	var c = connect();
	try {
		await once(c, "connected");
		c.emit("guest_session");
		await once(c, "authenticated");

		var noReject = neverFires(c, "reveal_effect_rejected", 600);
		c.emit("set_reveal_effect", { effect: "<script>nope</script>" });
		assert.strictEqual(await noReject, true, "an invalid id is just ignored, not treated as a purchase attempt");
	} finally { c.close(); }
});
