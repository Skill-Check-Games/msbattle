// Game role: a match socket that drops MID-MATCH reconnects with its join token and gets its seat back
// (the seat keeps its original player id, the room never sees a change), the seat is held for a grace
// window meanwhile, and a player who never comes back is evicted when it runs out. Also the deploy
// workflow's /internal/drain switch. Before this, any game-socket drop after the series started was
// terminal: the reconnect was rejected and the player evicted mid-round.

process.env.MATCH_TOKEN_SECRET = "reconnect-tok"; // must be set before requiring matchToken
const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const io = require("socket.io-client");
const { startServer } = require("./helpers");
const matchToken = require("../src/runtime/matchToken");

function once(socket, event, ms) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error("timeout waiting for '" + event + "'")), ms || 8000);
		socket.once(event, d => { clearTimeout(t); resolve(d); });
	});
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A slow bot so the match is still in progress while the human drops and returns.
function slowBot() { return { speedMs: 4000, difficultyMs: 3, distanceMult: 0, maxDifficulty: 8, mistakeRate: 0, chordRate: 0, rating: 1000 }; }
const HDR = { "content-type": "application/json", "x-internal-secret": "s" };
async function health(base) { return (await fetch(base + "/internal/health", { headers: HDR })).json(); }

function spec(matchId, roomId, playerKey, userId) {
	return {
		matchId, roomId, ownerPid: "system", size: 2,
		ranked: true, mode: "sprint_duo", style: "sprint", gameMode: "race", boardSize: "small",
		rules: { mineDensity: 0.1, roundSeconds: 120, deathPenalty: 0, gameCount: 1, modifier: null },
		humanRoster: [{ playerKey, name: "Tester", avatar: null, country: null, skin: null, userId, rating: 1000, played: 10 }],
		bots: [{ config: slowBot() }]
	};
}

test("a match socket that drops mid-match reconnects into the same seat; the seat is held meanwhile", async () => {
	const capture = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"ok":true,"applied":true}'); });
	await new Promise(r => capture.listen(13941, r));
	const game = await startServer({ port: 13942, env: {
		ROLE: "game", INTERNAL_SECRET: "s", MAIN_URL: "http://localhost:13941", MATCH_TOKEN_SECRET: "reconnect-tok", GAME_RECONNECT_GRACE_MS: "800"
	} });
	let c1, c2, c3;
	try {
		const alloc = await fetch(game.base + "/internal/allocate", { method: "POST", headers: HDR, body: JSON.stringify(spec("rc:1", 90200, "u:7", 7)) });
		assert.strictEqual(alloc.status, 200);
		assert.strictEqual((await health(game.base)).activeMatches, 1, "an allocated match awaiting its players already counts as active");

		const token = matchToken.issueMatchToken({ matchId: "rc:1", playerKey: "u:7", userId: 7 }, 60 * 60 * 1000);
		c1 = io(game.base, { transports: ["websocket"], forceNew: true, auth: { token }, reconnection: false });
		const att1 = once(c1, "match_attached");
		await once(c1, "joined_room");
		const first = await att1;
		assert.strictEqual(first.reconnected, false);
		assert.strictEqual(first.id, c1.id, "a first attach plays as its own socket id");
		await once(c1, "draw_board", 10000); // the series is running
		assert.strictEqual((await health(game.base)).activeMatches, 1);

		// The connection drops. The seat is held: the match is still active, nobody was evicted.
		c1.close();
		await sleep(300);
		assert.strictEqual((await health(game.base)).activeMatches, 1, "seat held during the grace window");

		// Same token, new socket → same seat, same player id, and the match carries on.
		c2 = io(game.base, { transports: ["websocket"], forceNew: true, auth: { token }, reconnection: false });
		const second = await once(c2, "match_attached");
		assert.strictEqual(second.reconnected, true);
		assert.strictEqual(second.id, first.id, "the reconnect plays under the seat's original id");
		await once(c2, "draw_board", 10000);
		await sleep(900); // past the grace window — the reconnect must have cancelled the eviction
		assert.strictEqual((await health(game.base)).activeMatches, 1, "reconnected seat is not evicted when the old grace timer fires");

		// Drop again and never come back: evicted once the grace runs out; the token no longer opens a seat.
		c2.close();
		await sleep(1500);
		assert.strictEqual((await health(game.base)).activeMatches, 0, "abandoned seat evicted after the grace window");
		c3 = io(game.base, { transports: ["websocket"], forceNew: true, auth: { token }, reconnection: false });
		await assert.rejects(once(c3, "match_attached", 1500), "no seat once the match is gone");
	} finally {
		for (const c of [c1, c2, c3]) if (c) c.close();
		game.stop();
		await new Promise(r => capture.close(r));
	}
});

test("/internal/drain takes a game server out of rotation and back", async () => {
	const game = await startServer({ port: 13943, env: { ROLE: "game", INTERNAL_SECRET: "s", MATCH_TOKEN_SECRET: "reconnect-tok" } });
	try {
		assert.strictEqual((await health(game.base)).draining, false);
		const on = await (await fetch(game.base + "/internal/drain", { method: "POST", headers: HDR, body: "{}" })).json();
		assert.strictEqual(on.draining, true);
		assert.strictEqual((await health(game.base)).draining, true);
		const refused = await fetch(game.base + "/internal/allocate", { method: "POST", headers: HDR, body: JSON.stringify(spec("rc:2", 90201, "u:8", 8)) });
		assert.strictEqual(refused.status, 503, "a draining server refuses new matches");
		const off = await (await fetch(game.base + "/internal/drain", { method: "POST", headers: HDR, body: '{"drain":false}' })).json();
		assert.strictEqual(off.draining, false);
		const ok = await fetch(game.base + "/internal/allocate", { method: "POST", headers: HDR, body: JSON.stringify(spec("rc:3", 90202, "u:9", 9)) });
		assert.strictEqual(ok.status, 200, "back in rotation");
		const noSecret = await fetch(game.base + "/internal/drain", { method: "POST", body: "{}" });
		assert.strictEqual(noSecret.status, 403);
	} finally { game.stop(); }
});
