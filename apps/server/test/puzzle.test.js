// Socket integration test for single-player puzzle play (now in puzzlePlay.js): an
// authenticated guest requests a puzzle and is served a board (puzzle_next ->
// startPuzzlePlay -> obfuscateBoard -> puzzle_board), and the unauthenticated +
// empty-pool paths reject cleanly. The net for extracting puzzle play out of the server.

var test = require("node:test");
var assert = require("node:assert");
var io = require("socket.io-client");
var helpers = require("./helpers");

// A minimal valid puzzle row so puzzle_next has something to serve.
var SEED = {
	key: "test:4x4-seed", rows: 4, cols: 4,
	mines: [[0, 0], [3, 3]],
	revealed: [[1, 1], [1, 2], [2, 1], [2, 2]],
	coveredSafe: 10, difficulty: 2, score: 1.0,
	maxEnumSize: 0, cspMethod: "trivial", needsCaseSplit: false, source: "test"
};

var server;
test.before(async function() { server = await helpers.startServer({ port: 13804, seedPuzzle: SEED }); });
test.after(function() { if (server) server.stop(); });

function once(socket, event, ms) {
	return new Promise(function(resolve, reject) {
		var t = setTimeout(function() { reject(new Error("timeout waiting for '" + event + "'")); }, ms || 5000);
		socket.once(event, function(d) { clearTimeout(t); resolve(d); });
	});
}
function connect() { return io(server.base, { transports: ["websocket"], forceNew: true }); }

test("an authenticated player is served a puzzle board", async function() {
	var c = connect();
	try {
		await once(c, "connected");
		c.emit("guest_session");
		await once(c, "authenticated");
		c.emit("puzzle_next");
		var board = await once(c, "puzzle_board", 6000);
		assert.ok(board, "puzzle_board arrived (startPuzzlePlay + obfuscateBoard ran)");
		assert.strictEqual(board.rows, 4);
		assert.strictEqual(board.cols, 4);
		assert.ok(board.boardData && board.boardMask, "carries the obfuscated board blob");
		assert.ok(Array.isArray(board.knownCells), "carries the seed cascade");
	} finally { c.close(); }
});

test("puzzle_next without auth is rejected", async function() {
	var c = connect();
	try {
		await once(c, "connected");
		c.emit("puzzle_next"); // no guest_session → no account
		var err = await once(c, "puzzle_error", 6000);
		assert.strictEqual(err.reason, "auth_required");
	} finally { c.close(); }
});

// Reconnect mid-puzzle (a network blip, or a server deploy that wiped the in-memory play): the new socket
// re-authenticates as the same user and sends puzzle_resume with every move made so far. The server rebuilds
// the SAME board silently (no puzzle_board, which would reset the client) and replays the moves — a board
// that was fully solved by then completes and fires the normal puzzle_result.
test("a reconnect resumes the current puzzle silently and replays the moves to completion", async function() {
	var c1 = connect(), c2 = null;
	try {
		await once(c1, "connected");
		c1.emit("guest_session");
		var auth = await once(c1, "authenticated");
		assert.ok(auth && auth.token, "fresh guest got a session token");
		c1.emit("puzzle_next");
		var board = await once(c1, "puzzle_board", 6000);
		c1.emit("left_click", { r: 0, c: 1 }); // one move before the drop
		await new Promise(function(r) { setTimeout(r, 150); });
		c1.close();

		c2 = connect();
		var boardsOnC2 = 0; c2.on("puzzle_board", function() { boardsOnC2++; });
		await once(c2, "connected");
		c2.emit("authenticate", { token: auth.token });
		await once(c2, "authenticated");
		// Every safe covered cell of the 4x4 seed (mines at 0,0 and 3,3; centre already revealed).
		var moves = [[0, 1], [0, 2], [0, 3], [1, 0], [1, 3], [2, 0], [2, 3], [3, 0], [3, 1], [3, 2]].map(function(rc) { return { r: rc[0], c: rc[1], flag: false }; });
		var resultP = once(c2, "puzzle_result", 6000);
		c2.emit("puzzle_resume", { puzzleId: board.puzzleId, mode: "rated", moves: moves });
		var resumed = await once(c2, "puzzle_resumed", 4000);
		assert.strictEqual(resumed.ok, true, "the current puzzle was resumed");
		assert.strictEqual(resumed.puzzleId, board.puzzleId);
		var result = await resultP;
		assert.strictEqual(result.solved, true, "replaying the moves completed the puzzle");
		assert.strictEqual(boardsOnC2, 0, "no puzzle_board on resume — the client keeps its board");

		// A puzzle that is not the user's current one is refused, so the client asks for a fresh board.
		c2.emit("puzzle_resume", { puzzleId: 999999, mode: "rated", moves: [] });
		var refused = await once(c2, "puzzle_resumed", 4000);
		assert.strictEqual(refused.ok, false);
	} finally { c1.close(); if (c2) c2.close(); }
});
