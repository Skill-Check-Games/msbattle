// Session / auth attach, extracted from minesweeperServer. loginSocket binds a (real or
// guest) user to a socket — populating accounts/names, mirroring the name into any live
// game, and emitting the `authenticated` snapshot — and registers the connect-time auth
// socket events (authenticate / guest_session / sign_out / set_name). Reads appState + db
// + roomState + gameUtil; PROVISIONAL_GAMES is injected via init to avoid a circular
// require. (The OAuth redirect flow lives in oauth.js; clients then `authenticate` here.)

var appState = require("./appState");
var db = require("../db");
var zlib = require("zlib");
var roomState = require("./roomState");
var gameUtil = require("./gameUtil");
var ShopCatalog = require("../../common/ShopCatalog");

var accounts = appState.accounts, names = appState.names, games = appState.games, roomMapping = appState.roomMapping, skins = appState.skins;
var avatars = appState.avatars, countries = appState.countries, sockets = appState.sockets;
var updateDraw = gameUtil.updateDraw;

var PROVISIONAL_GAMES;
function init(deps) { PROVISIONAL_GAMES = deps.PROVISIONAL_GAMES; }

// The "authenticated" snapshot for a user row — shared by loginSocket (the live socket path) and
// staticServer's HTML hydration (a cookie-identified user gets this same shape inlined into the
// page, so the client's first render already has real data instead of "—" placeholders; see
// window.__ACCOUNT__ in staticServer.js). No side effects (doesn't touch appState/live games) —
// just the data.
function buildAccountPayload(user) {
	var today = db.todayUtc();
	var dailyAttempt = db.getDailyAttempt(user.id, today);
	var avatarColor = user.avatar_color || (user.is_guest ? "anon" : null);
	return {
		name: db.displayNameOf(user),
		ratingSprint: user.rating_sprint, ratingStandard: user.rating_standard,
		avatarUrl: user.avatar_url,
		avatarColor: avatarColor,
		country: user.country || null,
		wins: user.wins,
		played: user.played,
		createdAt: user.created_at,
		provisional: user.played < PROVISIONAL_GAMES,
		puzzleRating: user.puzzle_rating,
		puzzlePoints: user.puzzle_points || 0,
		puzzlesSolved: user.puzzles_solved,
		puzzlesAttempted: user.puzzles_attempted,
		streakBest: user.streak_best,
		stormBest: user.storm_best,
		dailyStreak: db.dailyStreakForUser(user.id),
		dailyAttempt: dailyAttempt ? { solved: !!dailyAttempt.solved, at: dailyAttempt.attempted_at } : null,
		isAdmin: !!user.is_admin,
		guest: !!user.is_guest,
		soloBests: db.getSoloBests(user.id),
		provider: user.last_provider || user.provider,
		// Shop: purchased cosmetic ids (e.g. "img:teddy", "tactical"). Ships here so the client has
		// the owned-item list on first paint (live socket + SSR hydration both use this payload) with
		// no separate fetch — see ShopCatalog.js for what these ids mean and set_avatar/set_skin below
		// for where they're enforced.
		ownedItems: db.listOwnedItemIds(user.id)
	};
}

// Read-only profile for a player who ISN'T the caller — leaderboard rows link here (get_public_profile
// below). A curated subset of buildAccountPayload: ratings/stats already shown to everyone in the
// leaderboard/in-game, never anything account-management-ish (no token/provider/ownedItems/email).
// Puzzle rating is excluded same as everywhere else — it's hidden info, only the ladder points/tier
// are public. Returns null for a missing or guest user (guests aren't a stable identity worth linking to).
function buildPublicProfilePayload(user) {
	if (!user || user.is_guest) return null;
	return {
		id: user.id,
		name: db.displayNameOf(user),
		avatarColor: user.avatar_color || null,
		country: user.country || null,
		createdAt: user.created_at,
		ratingSprint: user.rating_sprint, ratingStandard: user.rating_standard,
		wins: user.wins, played: user.played,
		provisional: user.played < PROVISIONAL_GAMES,
		puzzlePoints: user.puzzle_points || 0,
		puzzlesSolved: user.puzzles_solved,
		puzzlesAttempted: user.puzzles_attempted,
		streakBest: user.streak_best,
		stormBest: user.storm_best,
		soloBests: db.getSoloBests(user.id)
	};
}

function loginSocket(socket, playerID, user, token, sendToken) {
	accounts[playerID] = {
		userId: user.id, token: token, played: user.played,
		ratingSprint: user.rating_sprint, ratingStandard: user.rating_standard
	};
	var displayName = db.displayNameOf(user); // editable display_name, falling back to the legacy/guest name
	var isFirst = !names[playerID];
	names[playerID] = displayName;
	// Guests with no chosen avatar default to the anonymous silhouette (others fall back to the red flag).
	var avatarColor = user.avatar_color || (user.is_guest ? "anon" : null);
	avatars[playerID] = avatarColor;
	countries[playerID] = user.country || null;
	if (games[playerID]) {
		games[playerID].playerName = displayName;
		games[playerID].avatar = avatars[playerID];
		games[playerID].country = countries[playerID];
		updateDraw(roomMapping[playerID]);
	}
	var payload = buildAccountPayload(user);
	if (sendToken) payload.token = token;
	socket.emit("authenticated", payload);
	if (isFirst) socket.emit("room_list", { rooms: roomState.getRoomList() });
	else if (roomMapping[playerID]) roomState.broadcastRoomState(roomMapping[playerID]);
}

// Reclaims a mid-round disconnect that reconnected within RECONNECT_GRACE_MS (the pendingDisconnects
// entry minesweeperServer.js's disconnect handler set up) — moves the abandoned seat's ENTIRE live
// state from its old, now-dead socket id over to this freshly (re)authenticated one, so the room/game/
// round-progress the player left behind is exactly what they land back in, instead of a stranger's
// fresh connection walking into a room that still has their old, now-orphaned seat sitting in it.
// Must run BEFORE loginSocket (below) populates names/skins/etc. for the new id — loginSocket's own
// game.playerName/avatar/country sync (which already runs whenever games[playerID] exists) then just
// naturally picks up the migrated game object for free, no special-casing needed there.
function migrateReconnectedPlayer(oldID, newID, socket) {
	var room = roomMapping[oldID];
	if (!room) return; // the room's already gone (series ended, everyone else left, …) — nothing to resume
	games[newID] = games[oldID]; delete games[oldID];
	roomMapping[newID] = room; delete roomMapping[oldID];
	sockets[newID] = socket;
	for (var i = 0; i < room.players.length; i++) {
		if (room.players[i] === oldID) room.players[i] = newID;
	}
	if (room.owner === oldID) room.owner = newID;
	if (room.ready && room.ready.hasOwnProperty(oldID)) { room.ready[newID] = room.ready[oldID]; delete room.ready[oldID]; }
	if (room.scores && room.scores.hasOwnProperty(oldID)) { room.scores[newID] = room.scores[oldID]; delete room.scores[oldID]; }
	// progressSum only exists once at least one round has finished (see endIndividualGame) — carries the
	// margin-of-victory bonus's per-round average forward so a mid-series reconnect doesn't reset it.
	if (room.progressSum && room.progressSum.hasOwnProperty(oldID)) { room.progressSum[newID] = room.progressSum[oldID]; delete room.progressSum[oldID]; }
	socket.join("room:" + room.id);
	// Bring the reconnected client fully current. Its own board's move-sync heartbeat (Main.js) will
	// separately catch the server up on anything it clicked while offline — the exact same dropped-
	// packet healing this reuses verbatim, just with a much longer gap to close — but THIS client also
	// needs a fresh look at every OPPONENT's board, which may well have changed while it was away.
	updateDraw(room);
	roomState.broadcastRoomState(room);
}

function registerSocketHandlers(socket, playerID) {
	socket.on("authenticate", function(data) {
		var token = data && data.token;
		var user = db.getUserByToken(token);
		if (!user) { socket.emit("auth_failed"); return; }
		var pending = appState.pendingDisconnects[user.id];
		if (pending) {
			clearTimeout(pending.timer);
			delete appState.pendingDisconnects[user.id];
			migrateReconnectedPlayer(pending.playerID, playerID, socket);
		}
		loginSocket(socket, playerID, user, token, false);
	});

	// No stored session → spin up a guest: a real user row (with ratings) flagged guest, plus a session
	// token the client persists so the same guest survives reloads. Upgradable to a real account on sign-in.
	socket.on("guest_session", function() {
		if (accounts[playerID]) return; // already signed in / already a guest
		var user = db.createGuest();
		var token = db.createSession(user.id);
		loginSocket(socket, playerID, user, token, true);
	});

	socket.on("sign_out", function() {
		if (accounts[playerID]) {
			db.deleteSession(accounts[playerID].token);
			delete accounts[playerID];
		}
	});

	// Board skin: a display preference relayed to opponents so each player's board renders in
	// their own skin. Stored per-player (like names); mirrored into any live game + rebroadcast.
	// The id is just a short slug — the client maps unknown ids to its default skin.
	// Purchasable skins (currently just "tactical" — see ShopCatalog.js) require ownership; this is
	// the only enforcement point (skin choice was never DB-persisted, only relayed live), so it's
	// also what closes the previously-client-only admin gate — nobody, admins included, gets a free
	// pass anymore, only actual ownership.
	socket.on("set_skin", function(data) {
		var skin = (data && typeof data.skin === "string") ? data.skin.trim().slice(0, 32) : "";
		if (!/^[a-z0-9_-]*$/i.test(skin)) return;
		skin = skin || "classic";
		if (ShopCatalog.isPurchasable("skin", skin)) {
			var acc = accounts[playerID];
			if (!acc || !db.ownsItem(acc.userId, "skin", skin)) {
				socket.emit("skin_rejected", { reason: "not_owned", skin: skin });
				skin = "classic";
			}
		}
		skins[playerID] = skin;
		if (games[playerID]) {
			games[playerID].skin = skins[playerID];
			updateDraw(roomMapping[playerID]);
		}
	});

	// Avatar cloth colour (the in-game flag, recoloured). Persisted on the account + mirrored to opponents.
	// Purchasable avatars ("img:<id>" presets — see ShopCatalog.js) require ownership; the free values
	// (a #rrggbb colour, "anon", "mine") are never in the catalog so isPurchasable is always false for them.
	socket.on("set_avatar", function(data) {
		var acc = accounts[playerID];
		if (!acc) return;
		var color = (data && typeof data.color === "string") ? data.color.trim() : "";
		// A #rrggbb cloth colour, the "anon" silhouette, the "mine", or an "img:<id>" preset (or "" → default red).
		if (color && color !== "anon" && color !== "mine" && !/^#[0-9a-f]{6}$/i.test(color) && !/^img:[a-z0-9_-]+$/i.test(color)) return;
		if (color && ShopCatalog.isPurchasable("avatar", color) && !db.ownsItem(acc.userId, "avatar", color)) {
			socket.emit("avatar_rejected", { reason: "not_owned", color: color });
			return;
		}
		var value = color || null;
		db.setAvatarColor(acc.userId, value);
		avatars[playerID] = value;
		if (games[playerID]) { games[playerID].avatar = value; updateDraw(roomMapping[playerID]); }
	});

	// Country (ISO-3166 alpha-2). Persisted on the account + mirrored to opponents.
	socket.on("set_country", function(data) {
		var acc = accounts[playerID];
		if (!acc) return;
		var country = (data && typeof data.country === "string") ? data.country.trim().toUpperCase() : "";
		if (country && !/^[A-Z]{2}$/.test(country)) return; // two letters, or "" to clear
		var value = country || null;
		db.setCountry(acc.userId, value);
		countries[playerID] = value;
		if (games[playerID]) { games[playerID].country = value; updateDraw(roomMapping[playerID]); }
	});

	// Admin/testing: reset MY puzzle rating + Ladder points. Server-gated to admins (re-checked from the DB,
	// not just the client claim). Echoes the fresh values so the client can update without a reload.
	socket.on("admin_reset_puzzles", function() {
		var acc = accounts[playerID];
		if (!acc) return;
		var u = db.getUserById(acc.userId);
		if (!u || !u.is_admin) return;
		db.resetPuzzleProgress(acc.userId);
		socket.emit("puzzles_reset", { puzzleRating: 0, puzzlePoints: 0 });
	});

	// A solo/racing board cleared with no flag and/or no direct reveal (chord only) — challenge counters.
	socket.on("record_clear", function(data) {
		var acc = accounts[playerID];
		if (acc && data) db.recordClear(acc.userId, !!data.noFlag, !!data.noReveal);
	});

	// Shop: re-sync the socket-held owned-item list after a purchase, without a full reconnect/re-auth.
	// The client can't hear about a purchase live (Stripe redirects the browser back into the app, no
	// socket is involved) — this is the client's explicit "did anything change?" pull on return.
	socket.on("refresh_owned_items", function() {
		var acc = accounts[playerID];
		socket.emit("owned_items", { items: acc ? db.listOwnedItemIds(acc.userId) : [] });
	});

	// Profile: recent ranked matches + per-style rating points (graph). Empty for signed-out.
	socket.on("get_match_history", function() {
		var acc = accounts[playerID];
		if (!acc) { socket.emit("match_history", { matches: [], ratings: [], stats: {} }); return; }
		socket.emit("match_history", {
			matches: db.getMatchHistory(acc.userId, 50),
			ratings: db.getRatingHistory(acc.userId, 1000),
			stats: db.achievementStats(acc.userId) // achievement metrics bag
		});
	});

	// Profile: fetch one replay for playback. We gunzip server-side and ship the raw binary
	// (input-log format) so the client only needs the decoder, not a gzip dependency. Only a
	// participant in the match may fetch it.
	socket.on("get_replay", function(data) {
		var acc = accounts[playerID];
		var id = data && data.id;
		if (!acc || !id) { socket.emit("replay_data", { id: id || null, error: "not_found" }); return; }
		var mine = db.listReplaysForUser(acc.userId, 500).some(function(r) { return r.id === id; });
		if (!mine) { socket.emit("replay_data", { id: id, error: "forbidden" }); return; }
		var row = db.getReplay(id);
		if (!row) { socket.emit("replay_data", { id: id, error: "not_found" }); return; }
		var raw;
		try { raw = zlib.gunzipSync(row.data); } catch (e) { socket.emit("replay_data", { id: id, error: "corrupt" }); return; }
		socket.emit("replay_data", {
			id: id, createdAt: row.created_at, style: row.style, mode: row.mode,
			// Strip any legacy `bot` field — whether an opponent was a bot is hidden information.
			winnerId: row.winner_id, players: row.players ? JSON.parse(row.players).map(function(p) { delete p.bot; return p; }) : [],
			data: raw // Buffer → socket.io sends as binary; arrives as ArrayBuffer on the client
		});
	});

	// Leaderboard rows link here to show another player's read-only profile. No auth required to
	// view (leaderboard itself is public/guest-visible) — just a valid, non-guest user id.
	socket.on("get_public_profile", function(data) {
		var userId = data && parseInt(data.userId, 10);
		var user = userId ? db.getUserById(userId) : null;
		socket.emit("public_profile", { userId: userId || null, profile: buildPublicProfilePayload(user) });
	});

	socket.on("set_name", function(data) {
		var name = (data && typeof data.name === "string") ? data.name.trim().slice(0, 24) : "";
		if (!name) {
			socket.emit("name_rejected", { reason: "Name cannot be empty" });
			return;
		}
		var isFirst = !names[playerID];
		names[playerID] = name;
		// Persist the chosen name for the logged-in row (guests rename themselves this way; it survives reloads).
		if (accounts[playerID]) db.setUserName(accounts[playerID].userId, name);
		if (games[playerID]) {
			games[playerID].playerName = name;
			updateDraw(roomMapping[playerID]);
		}
		socket.emit("name_accepted", { name: name });
		if (isFirst) {
			socket.emit("room_list", { rooms: roomState.getRoomList() });
		} else {
			if (roomMapping[playerID]) roomState.broadcastRoomState(roomMapping[playerID]);
			roomState.broadcastRoomList();
		}
	});

	// Free-play clear: record the best time for this (board size, mine density) and echo it back so the
	// client can show the record / a "new best". Trusts the client's elapsed time — it's an unranked
	// personal stat, not a leaderboard, so there's nothing to game.
	socket.on("solo_result", function(data) {
		if (!accounts[playerID]) return;
		var size = data && data.size;
		var ms = data && parseInt(data.ms, 10);
		var pct = data && Math.round(parseFloat(data.density) * 100);
		if (["small", "medium", "large"].indexOf(size) === -1) return;
		if (!(ms > 0) || !(pct >= 1 && pct <= 100)) return;
		var res = db.recordSoloBest(accounts[playerID].userId, size, pct, ms);
		socket.emit("solo_record", { size: size, density: pct, best: res.best, isNewBest: res.isNewBest });
	});
}

module.exports = { init: init, registerSocketHandlers: registerSocketHandlers, buildAccountPayload: buildAccountPayload };
