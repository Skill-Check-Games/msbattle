// Admin-only in-game debug tool. Click your own avatar during a ranked duo/multi match
// (#duel_id_you, wired from Main.js's buildDuelIdentity) to open a modal comparing the CLIENT's
// local board state against the SERVER's authoritative one, side by side, plus a log of every
// socket event exchanged between them — built to finally root-cause the intermittent "the client
// thinks the board is done but the server never confirms it" reports, which the existing
// move-hash resync system (localMoveSeq/localMoveHash, Main.js) hasn't fully caught on its own.
//
// The event log is recorded unconditionally (a small capped ring buffer — cheap) rather than only
// once the modal is opened, so history from just before a problem was first noticed is still
// there; only the VIEW itself is gated to admins. Main.js wires the actual socket.onAny/
// onAnyOutgoing hooks (this file loads before `socket` exists) and forwards
// admin_debug_snapshot_result here via onAdminDebugSnapshot.

var ADMIN_DEBUG_LOG_MAX = 300;
var adminDebugLog = [];
function pushAdminDebugLog(dir, event, args) {
	adminDebugLog.push({ t: Date.now(), dir: dir, event: event, args: args });
	if (adminDebugLog.length > ADMIN_DEBUG_LOG_MAX) adminDebugLog.shift();
}

var adminDebugSnapshot = null; // last admin_debug_snapshot_result payload, or {ok:false,...}
function onAdminDebugSnapshot(data) {
	adminDebugSnapshot = data;
	renderAdminDebugView();
}

function requestAdminDebugSnapshot() {
	if (typeof socket !== "undefined") socket.emit("admin_debug_snapshot");
}

// Attaches the click-to-open handler once per element (idempotent across fillDuelId's repeated
// innerHTML rebuilds of the SAME wrapper node) — called from Main.js's buildDuelIdentity, gated
// there on account.isAdmin so non-admins never get an extra listener on their own avatar at all.
function wireAdminDebugAvatar(el) {
	if (!el || el.dataset.debugWired) return;
	el.dataset.debugWired = "1";
	el.addEventListener("click", openAdminDebugView);
}

function openAdminDebugView() {
	if (!account || !account.isAdmin) return;
	var modal = document.getElementById("admin_debug_modal");
	if (!modal) {
		modal = document.createElement("div");
		modal.id = "admin_debug_modal";
		modal.className = "cr-modal";
		modal.setAttribute("hidden", "");
		modal.innerHTML =
			'<div class="cr-backdrop" data-admindebug-close></div>' +
			'<div class="cr-dialog admin-debug-dialog" role="dialog" aria-modal="true" aria-labelledby="admin_debug_title">' +
				'<div class="cr-dialog-head">' +
					'<h2 id="admin_debug_title">Debug: Board State</h2>' +
					'<div class="admin-debug-head-actions">' +
						'<button class="btn btn-ghost" type="button" id="admin_debug_refresh">↻ Refresh</button>' +
						'<button class="cr-close" type="button" data-admindebug-close aria-label="Close">×</button>' +
					'</div>' +
				'</div>' +
				'<div id="admin_debug_body"></div>' +
			'</div>';
		document.body.appendChild(modal);
		modal.addEventListener("click", function(e) { if (e.target.closest("[data-admindebug-close]")) modal.setAttribute("hidden", ""); });
		document.addEventListener("keydown", function(e) { if (e.key === "Escape" && !modal.hasAttribute("hidden")) modal.setAttribute("hidden", ""); });
		document.getElementById("admin_debug_refresh").addEventListener("click", requestAdminDebugSnapshot);
	}
	modal.removeAttribute("hidden");
	requestAdminDebugSnapshot();
	renderAdminDebugView(); // paint whatever we already have (client state + log) immediately, don't wait on the round-trip
}

// The client's own decoded board as a plain 2D array (boardCell is a function, not an array) —
// same MINE/count shape the server's own `board` field uses, so one cell-label function serves both.
function adminDebugClientBoard() {
	if (typeof rows === "undefined" || !rows || typeof boardCell !== "function") return null;
	var g = [];
	for (var r = 0; r < rows; r++) {
		var row = [];
		for (var c = 0; c < cols; c++) row.push(boardCell(r, c));
		g.push(row);
	}
	return g;
}

function buildAdminDebugGrid(title, gridRows, gridCols, board, state, mismatchFn) {
	var wrap = document.createElement("div"); wrap.className = "admin-debug-grid-wrap";
	var h = document.createElement("h3"); h.className = "admin-debug-grid-title"; h.textContent = title;
	wrap.appendChild(h);
	if (!gridRows || !gridCols || !state) {
		var none = document.createElement("p"); none.className = "admin-debug-empty"; none.textContent = "No data.";
		wrap.appendChild(none);
		return wrap;
	}
	var grid = document.createElement("div"); grid.className = "admin-debug-grid";
	grid.style.gridTemplateColumns = "repeat(" + gridCols + ", 1fr)";
	for (var r = 0; r < gridRows; r++) {
		for (var c = 0; c < gridCols; c++) {
			var cell = document.createElement("div");
			var st = state[r] ? state[r][c] : undefined;
			var bv = board && board[r] ? board[r][c] : undefined;
			var text = "";
			var stClass = "unknown";
			if (st === KNOWN) { stClass = "known"; text = bv === MINE ? "*" : (bv > 0 ? String(bv) : ""); }
			else if (st === FLAGGED) { stClass = "flagged"; text = "F"; }
			cell.className = "admin-debug-cell admin-debug-cell-" + stClass;
			cell.textContent = text;
			if (mismatchFn && mismatchFn(r, c)) cell.classList.add("admin-debug-cell-mismatch");
			grid.appendChild(cell);
		}
	}
	wrap.appendChild(grid);
	return wrap;
}

function renderAdminDebugView() {
	var body = document.getElementById("admin_debug_body");
	if (!body) return; // modal not open — harmless no-op, same contract as this app's other render* functions
	body.innerHTML = "";

	var snap = adminDebugSnapshot;
	var summary = document.createElement("div"); summary.className = "admin-debug-summary";
	var clientLine = "Client — seq " + localMoveSeq + " · hash " + localMoveHash;
	var serverLine = !snap ? "Server — …" :
		!snap.ok ? "Server — " + (snap.reason || "no active game") :
		"Server — seq " + snap.seq + " · hash " + snap.hash + " · playing " + snap.playing + " · finished " + snap.finished +
			" · safe " + snap.safeCount + "/" + snap.totalSafe;
	var hashMismatch = snap && snap.ok && snap.hash !== localMoveHash;
	summary.innerHTML =
		'<div>' + clientLine + '</div>' +
		'<div' + (hashMismatch ? ' class="admin-debug-summary-mismatch"' : '') + '>' + serverLine + '</div>';
	body.appendChild(summary);

	// `typeof myState !== "undefined"` only proves the variable exists, not that it's non-null (it's
	// declared `var myState = null;` in Main.js whenever there's no active game) — check the value
	// itself too, or myState[r] throws instead of falling through to `undefined`.
	var liveMyState = (typeof myState !== "undefined" && myState) ? myState : null;
	var mismatchFn = (snap && snap.ok && liveMyState) ? function(r, c) {
		var clientState = liveMyState[r] ? liveMyState[r][c] : undefined;
		var serverState = snap.state && snap.state[r] ? snap.state[r][c] : undefined;
		return clientState !== serverState;
	} : null;

	var grids = document.createElement("div"); grids.className = "admin-debug-grids";
	grids.appendChild(buildAdminDebugGrid(
		"Client (yours)",
		typeof rows !== "undefined" ? rows : 0, typeof cols !== "undefined" ? cols : 0,
		adminDebugClientBoard(), liveMyState, mismatchFn
	));
	if (snap && snap.ok) {
		grids.appendChild(buildAdminDebugGrid("Server (authoritative)", snap.rows, snap.cols, snap.board, snap.state, mismatchFn));
	} else {
		grids.appendChild(buildAdminDebugGrid("Server (authoritative)", 0, 0, null, null, null));
	}
	body.appendChild(grids);

	var logWrap = document.createElement("div"); logWrap.className = "admin-debug-log-wrap";
	var logTitle = document.createElement("h3"); logTitle.className = "admin-debug-grid-title";
	logTitle.textContent = "Event log (newest first)";
	logWrap.appendChild(logTitle);
	var log = document.createElement("div"); log.className = "admin-debug-log";
	adminDebugLog.slice().reverse().forEach(function(entry) {
		var row = document.createElement("div");
		row.className = "admin-debug-log-row admin-debug-log-" + entry.dir;
		var d = new Date(entry.t);
		var ms = String(entry.t % 1000);
		while (ms.length < 3) ms = "0" + ms;
		var time = d.toLocaleTimeString(undefined, { hour12: false }) + "." + ms;
		var argsStr = "";
		try { if (entry.args && entry.args.length) argsStr = JSON.stringify(entry.args[0]).slice(0, 160); }
		catch (e) { argsStr = "[unserializable]"; }
		row.textContent = time + " " + (entry.dir === "out" ? "→" : "←") + " " + entry.event + (argsStr ? " " + argsStr : "");
		log.appendChild(row);
	});
	logWrap.appendChild(log);
	body.appendChild(logWrap);
}
