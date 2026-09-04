// game_result/series_ended (minesweeperServer.js) are each broadcast exactly once, live, to
// whoever is connected to the room at that instant — a player whose socket is disconnected or
// mid-reconnect right then permanently misses it, with no prior mechanism to catch them up. This
// is the root cause behind "I finished the board but never got the server-approved result" (a real
// report). stashRoomEventForOfflineDelivery/drainPendingRoomEvents (gameUtil.js) are the backstop:
// a per-user copy queued alongside the live broadcast, delivered on that user's next authenticate.

const { test, before, beforeEach } = require("node:test");
const assert = require("node:assert");

let gameUtil, appState;
before(() => {
	gameUtil = require("../src/server/runtime/gameUtil");
	appState = require("../src/server/runtime/appState");
});
beforeEach(() => {
	// gameUtil.js closed over the ORIGINAL appState.accounts/pendingRoomEvents object references at
	// require time (var accounts = appState.accounts, …) — reassigning appState.accounts to a NEW
	// object here wouldn't be visible to gameUtil at all, so clear the existing objects IN PLACE.
	Object.keys(appState.accounts).forEach((k) => delete appState.accounts[k]);
	Object.keys(appState.pendingRoomEvents).forEach((k) => delete appState.pendingRoomEvents[k]);
});

function fakeSocket() {
	const calls = [];
	return { emit: (event, payload) => calls.push({ event, payload }), calls };
}

test("stashes an event for every real room member, skipping bots and accountless sockets", () => {
	appState.accounts.p1 = { userId: 100 };
	appState.accounts.p2 = { userId: 200 };
	// p3 (a bot) and p4 (no account entry at all) deliberately have no appState.accounts entry.
	const room = { players: ["p1", "p2", "p3", "p4"] };

	gameUtil.stashRoomEventForOfflineDelivery(room, "series_ended", { winnerId: "p1" });

	assert.strictEqual(appState.pendingRoomEvents[100].length, 1);
	assert.strictEqual(appState.pendingRoomEvents[200].length, 1);
	assert.deepStrictEqual(appState.pendingRoomEvents[100][0].payload, { winnerId: "p1" });
});

test("draining delivers the queued event and clears it — a second drain is a no-op", () => {
	appState.accounts.p1 = { userId: 100 };
	const room = { players: ["p1"] };
	gameUtil.stashRoomEventForOfflineDelivery(room, "series_ended", { winnerId: "p1" });

	const socket = fakeSocket();
	gameUtil.drainPendingRoomEvents(socket, 100);
	assert.strictEqual(socket.calls.length, 1);
	assert.strictEqual(socket.calls[0].event, "series_ended");
	assert.deepStrictEqual(socket.calls[0].payload, { winnerId: "p1" });
	assert.strictEqual(appState.pendingRoomEvents[100], undefined, "queue cleared after draining");

	const socket2 = fakeSocket();
	gameUtil.drainPendingRoomEvents(socket2, 100);
	assert.strictEqual(socket2.calls.length, 0, "nothing left to deliver the second time");
});

test("delivers multiple queued events in order (a missed game_result then a missed series_ended)", () => {
	appState.accounts.p1 = { userId: 100 };
	const room = { players: ["p1"] };
	gameUtil.stashRoomEventForOfflineDelivery(room, "game_result", { gameNumber: 1 });
	gameUtil.stashRoomEventForOfflineDelivery(room, "series_ended", { winnerId: "p1" });

	const socket = fakeSocket();
	gameUtil.drainPendingRoomEvents(socket, 100);
	assert.strictEqual(socket.calls.length, 2);
	assert.strictEqual(socket.calls[0].event, "game_result");
	assert.strictEqual(socket.calls[1].event, "series_ended");
});

test("an expired entry is silently dropped, not delivered", () => {
	appState.accounts.p1 = { userId: 100 };
	const room = { players: ["p1"] };
	gameUtil.stashRoomEventForOfflineDelivery(room, "series_ended", { winnerId: "p1" });
	appState.pendingRoomEvents[100][0].expiresAt = Date.now() - 1000; // force it stale

	const socket = fakeSocket();
	gameUtil.drainPendingRoomEvents(socket, 100);
	assert.strictEqual(socket.calls.length, 0, "a stale entry (reconnect took too long) is dropped, not delivered late");
});

test("the per-user queue is capped — the oldest entry drops once it overflows", () => {
	appState.accounts.p1 = { userId: 100 };
	const room = { players: ["p1"] };
	const total = gameUtil.PENDING_ROOM_EVENTS_MAX_PER_USER + 3;
	for (let i = 0; i < total; i++) {
		gameUtil.stashRoomEventForOfflineDelivery(room, "game_result", { gameNumber: i });
	}
	assert.strictEqual(appState.pendingRoomEvents[100].length, gameUtil.PENDING_ROOM_EVENTS_MAX_PER_USER);
	// The oldest (gameNumber: 0) should have been dropped — the surviving front entry is a later one.
	assert.notStrictEqual(appState.pendingRoomEvents[100][0].payload.gameNumber, 0);
});
