// Lobby UI: ranked queue panel (findRanked), the room list rendered for casual play, and the
// small formatters that label room options (round time, death penalty, mine density, board
// size, series format).
//
// Top-level addEventListener bindings for the lobby buttons stay in the main
// inline script — they need access to DOM elements declared there.

function findRanked(mode) {
	autoEnterGameFullscreen();
	// Both battle modes (1v1 duel, 6-player) force fullscreen on mobile even without the opt-in — see
	// enterDuelMobileFullscreen's comment (Fullscreen.js) for why just these are worth it (their
	// landscape layouts are built specifically to use the reclaimed space). Any other mode (mode.replace
	// wouldn't match _duo/_six) keeps the plain windowed-on-mobile behavior.
	if (/_(duo|six)$/.test(mode) && typeof enterDuelMobileFullscreen === "function") enterDuelMobileFullscreen();
	currentRankedMode = mode;
	socket.emit("find_ranked", { mode: mode });
	startBattleSearch(mode);
}
var MODE_LABELS = {
	sprint_duo: "1v1 Sprint",   sprint_six: "7-player Sprint",
	standard_duo: "1v1 Standard", standard_six: "7-player Standard"
};

function formatRoundTime(s) {
	if (s <= 0) return "0:00";
	var m = Math.floor(s / 60);
	var sec = s % 60;
	return m + ":" + (sec < 10 ? "0" : "") + sec;
}

function formatRoundOption(s) {
	return s === 0 ? "Unlimited" : (s % 60 === 0 ? (s/60) + " min" : s + "s");
}

function formatPenaltyOption(s) {
	return s === 0 ? "None" : s + "s";
}

// Mirror of the server's board presets, for option labels.
var BOARD_DIMS = { small: [10, 13], medium: [16, 20], large: [16, 30] };

// Low / Medium / High map to 10 / 15 / 20% mines. Keyed by integer percent to
// dodge float-equality issues; anything else just shows the raw percentage.
var DENSITY_LABELS = { 10: "Low", 15: "Medium", 20: "High" };
function formatMineDensity(d) {
	var pct = Math.round(d * 100);
	var label = DENSITY_LABELS[pct];
	return label ? label + " (" + pct + "%)" : pct + "%";
}

function formatBoardSize(size) {
	var dims = BOARD_DIMS[size];
	var label = size.charAt(0).toUpperCase() + size.slice(1);
	return dims ? label + " (" + dims[0] + "×" + dims[1] + ")" : label;
}

function applyBoardDims(newRows, newCols) {
	if (!newRows || !newCols || (newRows === rows && newCols === cols)) return;
	rows = newRows;
	cols = newCols;
	sizePlayerCanvas();
	sizeOpponentCanvases();
	focusedR = Math.floor(rows / 2);
	focusedC = Math.floor(cols / 2);
}

// Sub-tier ladder: Bronze 1 → 2 → 3 → Silver 1 → ... → Diamond 3 → Master.
// Bronze 1 starts at the DB default rating (1000); 50 ELO per sub-tier, 150 per
// tier, Master is the open-ended top at 1750+. Provisional players still get a
// real tier so progress is visible — the `~` rating prefix elsewhere signals
// that the number hasn't settled yet.
// Tier constants + rank helpers moved to Ranking.js.

// Series progress label: ranked plays exactly one match per lobby; casual plays a best-of-N.
function formatGameProgress(gameNumber, gameCount, scoreTarget) {
	if (scoreTarget) return "Game " + gameNumber + " · First to " + scoreTarget;
	if (gameCount === 1) {
		var mode = currentRoom && currentRoom.rankedMode;
		return mode ? (MODE_LABELS[mode] || "Ranked") + " match" : "Single match";
	}
	return "Game " + gameNumber + " of " + gameCount;
}

function formatSeriesFormat(gameCount, scoreTarget) {
	if (scoreTarget) return "First to " + scoreTarget;
	if (gameCount === 1) return "One match";
	return "Best of " + gameCount;
}
function renderRoomList(rooms) {
	var openRooms = rooms.filter(function(r) { return r.phase === "planning"; });
	var busyRooms = rooms.filter(function(r) { return r.phase !== "planning"; });

	openRoomList.innerHTML = "";
	if (openRooms.length === 0) {
		openRoomList.appendChild(emptyRow("No open lobbies. Create one to get started."));
	} else {
		openRooms.forEach(function(r) { openRoomList.appendChild(roomRow(r, true)); });
	}

	busyRoomList.innerHTML = "";
	if (busyRooms.length === 0) {
		busyRoomList.appendChild(emptyRow("No games in progress."));
	} else {
		busyRooms.forEach(function(r) { busyRoomList.appendChild(roomRow(r, false)); });
	}
}

function emptyRow(text) {
	var li = document.createElement("li");
	li.className = "room-empty";
	li.textContent = text;
	return li;
}

function roomChip(text, cls) {
	var s = document.createElement("span");
	s.className = "room-chip" + (cls ? " " + cls : "");
	s.textContent = text;
	return s;
}

function roomRow(room, joinable) {
	var li = document.createElement("li");
	li.className = "room-row";

	var info = document.createElement("div");
	info.className = "room-info";

	var title = document.createElement("div");
	title.className = "room-title";
	title.textContent = room.ownerName + "'s lobby";
	info.appendChild(title);

	// At-a-glance ruleset chips: how full it is, then the board/density/timer/series options.
	var chips = document.createElement("div");
	chips.className = "room-chips";
	var full = room.playerCount >= room.maxPlayers;
	chips.appendChild(roomChip(room.playerCount + " / " + room.maxPlayers + " players",
		"room-chip-players" + (full ? " room-chip-full" : "")));
	var dims = BOARD_DIMS[room.boardSize];
	if (dims) chips.appendChild(roomChip(dims[0] + "×" + dims[1]));
	if (typeof room.mineDensity === "number") chips.appendChild(roomChip(Math.round(room.mineDensity * 100) + "% mines"));
	chips.appendChild(roomChip(formatRoundOption(room.roundSeconds)));
	chips.appendChild(roomChip(room.gameCount === 1 ? "Single game" : "Best of " + room.gameCount));
	info.appendChild(chips);

	var meta = document.createElement("div");
	meta.className = "room-meta";
	meta.textContent = (room.phase === "planning" ? "" : "Game " + room.gamesPlayed + " of " + room.gameCount + " · ")
		+ room.players.join(", ");
	info.appendChild(meta);

	li.appendChild(info);

	if (joinable) {
		var joinBtn = document.createElement("button");
		joinBtn.className = "btn btn-secondary room-join";
		joinBtn.textContent = full ? "Full" : "Join";
		joinBtn.disabled = full;
		joinBtn.addEventListener("click", function() {
			socket.emit("join_room", { roomId: room.id });
		});
		li.appendChild(joinBtn);
	} else {
		var badge = document.createElement("span");
		badge.className = "room-badge";
		badge.textContent = "In game";
		li.appendChild(badge);
	}

	return li;
}
