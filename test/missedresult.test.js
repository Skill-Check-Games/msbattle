// End-to-end regression test for the reported bug: "I finished the board but never got the
// server-approved result." Plays a real casual match to a real, fast, deterministic win, but
// disconnects the winning socket in the same tick as the final click — before the server's
// synchronous-then-async endSeries has any chance to deliver its one-shot series_ended broadcast
// to it. Reconnecting afterward (a fresh socket, same session token) must still receive the result,
// via the pendingRoomEvents backstop (gameUtil.js) rather than the live io.to(room).emit alone.

var test = require("node:test");
var assert = require("node:assert");
var io = require("socket.io-client");
var helpers = require("./helpers");

var server;
test.before(async function() { server = await helpers.startServer({ port: 13891 }); });
test.after(function() { if (server) server.stop(); });

// Generous default (matching endtoend.test.js's own reasoning): the shared test sandbox runs
// several other files' spawned server processes concurrently, and under that CPU contention even
// basic socket lifecycle events (connect, authenticated) can legitimately take much longer than in
// isolation — confirmed by re-running this file alone, which always passes quickly.
function once(socket, event, ms) {
	return new Promise(function(resolve, reject) {
		var t = setTimeout(function() { reject(new Error("timeout waiting for '" + event + "'")); }, ms || 20000);
		socket.once(event, function(d) { clearTimeout(t); resolve(d); });
	});
}
function connect() { return io(server.base, { transports: ["websocket"], forceNew: true }); }

function decodeBoard(dataB64, maskB64, rows, cols) {
	var data = Buffer.from(dataB64, "base64");
	var mask = Buffer.from(maskB64, "base64");
	var board = [];
	for (var r = 0; r < rows; r++) {
		var row = [];
		for (var c = 0; c < cols; c++) {
			var v = data[r * cols + c] ^ mask[(r * cols + c) % mask.length];
			row.push(v === 9 ? -1 : v);
		}
		board.push(row);
	}
	return board;
}

test("a series_ended missed by a disconnect at the exact moment of winning is still delivered on reconnect", async function() {
	var c1 = connect(), c2 = null;
	try {
		await once(c1, "connected");
		c1.emit("guest_session");
		var auth1 = await once(c1, "authenticated");

		// gameCount:1 so a single round win ends the whole series immediately (no need to play out a
		// best-of-N to reach series_ended).
		c1.emit("create_room", { gameCount: 1 });
		await once(c1, "joined_room");
		c1.emit("add_bot");
		await once(c1, "room_state");
		var started = once(c1, "start_game", 20000);
		c1.emit("player_ready");
		var start = await started;
		var board = decodeBoard(start.boardData, start.boardMask, start.rows, start.cols);

		await new Promise(function(r) { setTimeout(r, start.startDelayMs + 300); });
		for (var r = 0; r < start.rows; r++) {
			for (var c = 0; c < start.cols; c++) {
				if (board[r][c] !== -1) c1.emit("left_click", { r: r, c: c, id: "1" });
			}
		}
		// A brief pause before disconnecting — long enough for the burst of left_click emits above to
		// actually reach the server (an immediate disconnect() can tear down the transport before
		// queued outgoing messages are flushed, losing the win entirely rather than reproducing the
		// bug), but still well ahead of endSeries's own async report round-trip completing, so this
		// socket is already gone by the time the live series_ended broadcast goes out.
		await new Promise(function(r) { setTimeout(r, 60); });
		var c1Id = c1.id; // socket.io-client clears .id once disconnected — capture it first
		c1.disconnect();

		// Give the server plenty of time to actually finish ending the series (Elo, the live
		// broadcast attempt against the now-dead socket, etc.) before we reconnect.
		await new Promise(function(r) { setTimeout(r, 1500); });

		c2 = connect();
		await once(c2, "connected");
		var seriesEndedPromise = once(c2, "series_ended", 15000);
		c2.emit("authenticate", { token: auth1.token });
		await once(c2, "authenticated");

		var ended = await seriesEndedPromise;
		assert.ok(ended, "the missed series_ended was redelivered on reconnect");
		var mine = ended.standings.find(function(s) { return s.id === c1Id; });
		assert.ok(mine, "the winner's own standing is present in the redelivered payload");
		assert.strictEqual(mine.rank, 1, "we actually won the round");
	} finally {
		c1.close();
		if (c2) c2.close();
	}
});
