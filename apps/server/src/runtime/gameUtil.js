// Small shared game helpers, extracted from minesweeperServer so the modules that need
// them require them directly (instead of receiving them through init(deps)): the bot/player
// predicates, the board obfuscator, the per-game broadcast payload, and updateDraw (push
// each player their draw_board frame). Depend only on appState + crypto.

var crypto = require("node:crypto");
var appState = require("./appState");

var bots = appState.bots, games = appState.games, sockets = appState.sockets, names = appState.names;
var accounts = appState.accounts, pendingRoomEvents = appState.pendingRoomEvents;

// Pack the full board into a XOR-masked byte blob the client decodes lazily from inside a
// closure. Not real anti-cheat, but the over-the-wire bytes aren't a readable JSON board.
function obfuscateBoard(board, rows, cols) {
	var bytes = Buffer.alloc(rows * cols);
	for (var r = 0; r < rows; r++) {
		for (var c = 0; c < cols; c++) {
			bytes[r * cols + c] = board[r][c] === -1 ? 9 : board[r][c];
		}
	}
	var mask = crypto.randomBytes(256);
	for (var j = 0; j < bytes.length; j++) bytes[j] = bytes[j] ^ mask[j % mask.length];
	return { data: bytes.toString("base64"), mask: mask.toString("base64") };
}

// Per-game snapshot for a draw_board frame (no board — the client got the obfuscated board once).
function gameForBroadcast(g, pid) {
	if (!g) return null;
	var safeCount = g.revealedSafeCount ? g.revealedSafeCount() : 0;
	var totalSafe = g.totalSafeSquares || 0;
	return {
		id: pid,
		playerName: g.playerName,
		skin: g.skin || null,
		avatar: g.avatar || null,
		country: g.country || null,
		state: g.state,
		finished: g.finished,
		finishedAt: g.finishedAt,
		safeCount: safeCount,
		totalSafe: totalSafe,
		progress: totalSafe > 0 ? safeCount / totalSafe : 0,
		frozenUntil: g.frozenUntil,
		playing: g.playing
	};
}

function isBot(playerID) { return !!bots[playerID]; }

// The rating to show for an in-memory account: the per-style rating for a given ranked style,
// or — with no style (casual rooms, an "overall" view) — the player's best rating across modes.
// There is no single legacy `rating` field any more; "overall" always means max-across-modes.
function maxAccountRating(acc) {
	if (!acc) return null;
	return Math.max(acc.ratingSprint || 0, acc.ratingStandard || 0);
}
function accountRating(acc, style) {
	if (!acc) return null;
	if (style === "sprint") return acc.ratingSprint;
	if (style === "standard") return acc.ratingStandard;
	return maxAccountRating(acc);
}

function humanCount(room) {
	var n = 0;
	for (var i = 0; i < room.players.length; i++) if (!isBot(room.players[i])) n++;
	return n;
}

function botCount(room) {
	var n = 0;
	for (var i = 0; i < room.players.length; i++) if (isBot(room.players[i])) n++;
	return n;
}

function getRoomBotNames(room) {
	var ret = [];
	for (var i = 0; i < room.players.length; i++) if (isBot(room.players[i])) ret.push(names[room.players[i]] || "");
	return ret;
}

// Push each player in the room their own draw_board frame (their board first, then opponents).
function updateDraw(room) {
	for (var i = 0; i < room.players.length; i++) {
		var playerID = room.players[i];
		if (sockets[playerID]) {
			var orderedIds = [playerID];
			for (var k = 0; k < room.players.length; k++) {
				if (room.players[k] !== playerID) orderedIds.push(room.players[k]);
			}
			var stripped = orderedIds.map(function(pid) { return gameForBroadcast(games[pid], pid); });
			sockets[playerID].emit("draw_board", { games: stripped });
		}
	}
}

// ---- one-shot room-broadcast redelivery -----------------------------------------------------
// game_result/series_ended (minesweeperServer.js) each fire exactly ONCE, live, to whoever is
// actually connected to the room at that instant (io.to("room:"+id).emit) — a player whose
// connection blips at exactly the wrong moment (including the async gap in endSeries between
// room.phase leaving "playing" and the broadcast actually firing, once Elo/replay persistence
// resolves) permanently misses it: nothing previously re-sent a one-shot event to a socket that
// reconnects even a moment late. This is the root cause behind "I finished the board but never
// got the server-approved result" — the win/round/series genuinely happened server-side, the
// player just never heard about it.
var PENDING_ROOM_EVENT_TTL_MS = 3 * 60 * 1000; // generous — any realistic reconnect lands well inside this
var PENDING_ROOM_EVENTS_MAX_PER_USER = 5; // a real user will never queue anywhere near this many

// Stashes a copy of a one-shot room broadcast per real (non-bot, logged-in) room member, keyed by
// their stable userId (not the ephemeral playerID a reconnect replaces) — call this ALONGSIDE the
// live io.to(...).emit, never instead of it; this is purely the offline-catch-up backstop.
function stashRoomEventForOfflineDelivery(room, event, payload) {
	var now = Date.now();
	for (var i = 0; i < room.players.length; i++) {
		var acc = accounts[room.players[i]];
		if (!acc || acc.userId == null) continue; // bots, and a socket that hasn't authenticated yet
		var q = pendingRoomEvents[acc.userId] = pendingRoomEvents[acc.userId] || [];
		q.push({ event: event, payload: payload, expiresAt: now + PENDING_ROOM_EVENT_TTL_MS });
		while (q.length > PENDING_ROOM_EVENTS_MAX_PER_USER) q.shift();
	}
}

// Delivers (and clears) whatever's queued for this user. Called on EVERY authenticate — not just
// when the pendingDisconnects/findLiveSeatForUser reconnect-migration paths fire (session.js) —
// since a missed broadcast can happen even to a socket the room-membership logic never considered
// "mid-round" in the first place (the endSeries async-gap case above). Order preserved (a missed
// game_result before a missed series_ended arrives in that same order), each checked against its
// own expiry so a very stale entry (a reconnect that took minutes) is silently dropped rather than
// surfacing a long-dead result out of nowhere.
function drainPendingRoomEvents(socket, userId) {
	var q = pendingRoomEvents[userId];
	if (!q || !q.length) return;
	delete pendingRoomEvents[userId];
	var now = Date.now();
	q.forEach(function(item) {
		if (item.expiresAt >= now) socket.emit(item.event, item.payload);
	});
}

module.exports = {
	obfuscateBoard: obfuscateBoard,
	gameForBroadcast: gameForBroadcast,
	isBot: isBot,
	humanCount: humanCount,
	botCount: botCount,
	getRoomBotNames: getRoomBotNames,
	accountRating: accountRating,
	maxAccountRating: maxAccountRating,
	updateDraw: updateDraw,
	stashRoomEventForOfflineDelivery: stashRoomEventForOfflineDelivery,
	drainPendingRoomEvents: drainPendingRoomEvents,
	PENDING_ROOM_EVENT_TTL_MS: PENDING_ROOM_EVENT_TTL_MS,
	PENDING_ROOM_EVENTS_MAX_PER_USER: PENDING_ROOM_EVENTS_MAX_PER_USER
};
