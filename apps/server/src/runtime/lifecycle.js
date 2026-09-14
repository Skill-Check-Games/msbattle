// Game-runtime lifecycle / draining (PHASE0_TICKETS.md P0-7, ARCHITECTURE_PLAN.md §7).
//
// A deploy must never cut a live match. The model: an instance is `active` or `draining`. On shutdown
// (SIGTERM) it begins draining — stops accepting NEW matches but lets in-flight ones finish — and only
// exits once no match is active. In the split, the fleet runs many game servers and main simply stops
// routing new matches to a draining one; in today's monolith the same hooks make `npm run stop` / a
// `fly deploy` graceful instead of abrupt.
//
// This module is the in-process stand-in: the lifecycle state + an `activeMatchCount` read + a SIGTERM
// handler that drains then exits. The matchmaker checks canAcceptNewMatch() before forming a match.

var appState = require("./appState");

var draining = false;

function isDraining() { return draining; }
function canAcceptNewMatch() { return !draining; }

// Live matches currently running = rooms in the "playing" phase. (A draining instance keeps serving
// these — including reconnections — until they end.)
function activeMatchCount() {
	var rooms = appState.rooms, n = 0;
	// attachPending: a match main has allocated here whose players are still connecting (game role) —
	// not "playing" yet, but a deploy now would strand it just the same.
	for (var id in rooms) { if (rooms[id] && (rooms[id].phase === "playing" || rooms[id].attachPending)) n++; }
	return n;
}

// Explicit drain switch (POST /internal/drain) — the deploy workflow flips a game server to draining
// BEFORE deploying it, then waits for activeMatchCount() to hit zero, so a rolling replace never cuts a
// live match: main routes new matches to the other game server(s) meanwhile. Reversible so an aborted
// deploy can put the server back in rotation.
function setDraining(on) { draining = !!on; }

// Enter draining and invoke onEmpty() once no match is active — immediately if already idle, else polled.
// Bounded by maxWaitMs so a stuck match can't block shutdown forever. Non-blocking; the poll timer is
// unref'd so it never keeps the process alive on its own (the live matches' own timers do that).
function beginDrain(onEmpty, opts) {
	opts = opts || {};
	var pollMs = opts.pollMs || 1000;
	var maxWaitMs = (opts.maxWaitMs != null) ? opts.maxWaitMs : 4 * 60 * 1000;
	draining = true;
	var waited = 0;
	function tick() {
		if (activeMatchCount() <= 0 || waited >= maxWaitMs) { if (onEmpty) onEmpty(); return; }
		waited += pollMs;
		var t = setTimeout(tick, pollMs);
		if (t && t.unref) t.unref();
	}
	tick();
}

// Drain on SIGTERM, then exit. Idempotent. (Tests use SIGKILL, which can't be trapped, so this never
// interferes with the harness.)
var installed = false;
function installShutdownHandler(opts) {
	if (installed) return;
	installed = true;
	// fly's init sends kill_signal (SIGINT unless configured) first and SIGTERM later, so both start the
	// same drain. Idempotent: the second signal just logs.
	var started = false;
	function onSignal(sig) {
		console.log("[lifecycle] " + sig + " — draining (" + activeMatchCount() + " active match(es))" + (started ? " [already draining]" : ""));
		if (started) return;
		started = true;
		beginDrain(function() {
			console.log("[lifecycle] drained — exiting");
			process.exit(0);
		}, opts);
	}
	process.on("SIGTERM", function() { onSignal("SIGTERM"); });
	process.on("SIGINT", function() { onSignal("SIGINT"); });
}

// Test-only: reset the module state between cases in a single test process.
function _reset() { draining = false; }

module.exports = {
	isDraining: isDraining,
	canAcceptNewMatch: canAcceptNewMatch,
	activeMatchCount: activeMatchCount,
	setDraining: setDraining,
	beginDrain: beginDrain,
	installShutdownHandler: installShutdownHandler,
	_reset: _reset
};
