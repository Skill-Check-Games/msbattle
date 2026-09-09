// Reclaiming a mid-round seat shouldn't require the SERVER to notice the old connection drop first —
// socket.io's ping/pong heartbeat can take up to ~45s to flag a silent disconnect (locked/backgrounded
// phone, a network handoff), while the client typically reconnects and re-authenticates well before
// that. This is the "client noticed first" path (session.js's findLiveSeatForUser): a fresh authenticate
// for a user who already has another live connection sitting mid-round migrates that seat right away,
// without waiting for appState.pendingDisconnects to exist. See session.js's own comment for the bug
// this fixes — a match silently stuck forever once the race was lost.

var test = require("node:test");
var assert = require("node:assert");
var io = require("socket.io-client");
var helpers = require("./helpers");

var server;
test.before(async function() { server = await helpers.startServer({ port: 13804 }); });
test.after(function() { if (server) server.stop(); });

function once(socket, event, ms) {
	return new Promise(function(resolve, reject) {
		var t = setTimeout(function() { reject(new Error("timeout waiting for '" + event + "'")); }, ms || 5000);
		socket.once(event, function(d) { clearTimeout(t); resolve(d); });
	});
}

function connect() { return io(server.base, { transports: ["websocket"], forceNew: true }); }

test("a second connection authenticating as the same user mid-round reclaims the seat, without the old socket ever disconnecting first", async function() {
	var c1 = connect(), c2 = null;
	try {
		await once(c1, "connected");
		c1.emit("guest_session");
		var auth1 = await once(c1, "authenticated");
		assert.ok(auth1.token, "guest session carries a reusable token");

		c1.emit("create_room", {});
		var joined = await once(c1, "joined_room");
		var roomId = joined.roomId;
		c1.emit("add_bot");
		await once(c1, "room_state");
		var started = once(c1, "start_game", 10000);
		c1.emit("player_ready");
		await started; // room.phase is now "playing" — the exact precondition findLiveSeatForUser checks

		// c1 never disconnects — simulating the client reconnecting/re-authenticating faster than the
		// server's own heartbeat ever notices the old transport is actually dead.
		c2 = connect();
		await once(c2, "connected");
		// All three listeners are armed BEFORE the authenticate that triggers the migration — the
		// room_state broadcast (fired synchronously inside migrateReconnectedPlayer, session.js) can
		// otherwise land before a listener registered only after awaiting something else gets attached.
		var c1Disconnected = once(c1, "disconnect", 5000);
		var c2Authenticated = once(c2, "authenticated", 5000);
		var c2RoomState = once(c2, "room_state", 5000);
		var c2DrawBoard = once(c2, "draw_board", 8000);
		c2.emit("authenticate", { token: auth1.token });

		var auth2 = await c2Authenticated;
		assert.strictEqual(auth2.name, auth1.name, "same account on the new connection");

		// The old, now-redundant socket gets force-closed rather than left to rot.
		await c1Disconnected;

		// The new socket inherits the room — a fresh room_state (broadcast as part of the migration)
		// carries the same roomId, and the new connection keeps receiving live board frames.
		var state2 = await c2RoomState;
		assert.strictEqual(state2.id, roomId, "the migrated room is the same one c1 was playing in");
		await c2DrawBoard;
	} finally {
		c1.close();
		if (c2) c2.close();
	}
});
