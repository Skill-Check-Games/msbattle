// The Puzzle Builder's API (/api/builder/*, admin only): analyse or autocomplete a drawn position on the solver
// worker, and the author's collection (save with a rating, list, delete, publish into the pool).
var db = require("../db");
var oauth = require("./oauth");
var analyzeQueue = require("./analyzeQueue");
var puzzleBuilder = require("core/src/engine/PuzzleBuilder");
var puzzleGen = require("core/src/engine/PuzzleGenerator");

function json(res, code, body) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); }
function readJsonBody(req, cb) {
	var body = "";
	req.on("data", function(c) { body += c; if (body.length > 1e6) req.destroy(); });
	req.on("end", function() { try { cb(null, body ? JSON.parse(body) : {}); } catch (e) { cb(e); } });
	req.on("error", function(e) { cb(e); });
}
// The author: the session's user, who must be an admin (DEV_AUTH opens the gate locally, with the dev user).
function authorOf(req) {
	var token = req.headers["x-session-token"];
	var user = token ? db.getUserByToken(token) : null;
	if (user && (user.is_admin || oauth.DEV_AUTH)) return user;
	return null;
}
function validSpec(spec) {
	if (!spec || typeof spec !== "object") return null;
	var rows = spec.rows | 0, cols = spec.cols | 0;
	if (rows < 3 || rows > 12 || cols < 3 || cols > 12 || !Array.isArray(spec.cells) || spec.cells.length !== rows) return null;
	var cells = [];
	for (var r = 0; r < rows; r++) {
		if (!Array.isArray(spec.cells[r]) || spec.cells[r].length !== cols) return null;
		cells.push(spec.cells[r].map(function(v) { return v === "M" || v === "S" || puzzleBuilder.isDigit(v) ? v : "?"; }));
	}
	return { rows: rows, cols: cols, cells: cells };
}

function serveAnalyze(req, res, kind) {
	readJsonBody(req, function(err, body) {
		var spec = !err && validSpec(body && body.spec);
		if (!spec) { json(res, 400, { error: "bad position" }); return; }
		// Autocomplete's options: the mine density for the cells no clue touches (a share, 0 to 0.6).
		var opts = {};
		if (body && typeof body.density === "number" && isFinite(body.density)) opts.density = Math.max(0, Math.min(0.6, body.density));
		analyzeQueue.run({ kind: kind, spec: spec, opts: opts }).then(function(out) { json(res, out && out.error ? 500 : 200, out); });
	});
}
function serveList(req, res, user) { json(res, 200, { puzzles: db.listBuilderPuzzles(user.id) }); }
function serveSave(req, res, user) {
	readJsonBody(req, function(err, body) {
		var spec = !err && validSpec(body && body.spec);
		if (!spec) { json(res, 400, { error: "bad position" }); return; }
		var tp = puzzleBuilder.toPuzzle(spec);
		if (tp.errors.length) { json(res, 400, { error: "the board is not finished", cells: tp.errors }); return; }
		if (!tp.puzzle.revealed.length) { json(res, 400, { error: "reveal at least one clue" }); return; }
		var name = String((body && body.name) || "").trim().slice(0, 60) || ("Puzzle " + new Date().toISOString().slice(0, 10));
		analyzeQueue.run({ kind: "rate", puzzle: tp.puzzle }).then(function(a) {
			if (!a || a.error) { json(res, 500, { error: (a && a.error) || "rating failed" }); return; }
			json(res, 200, { puzzle: db.insertBuilderPuzzle(user.id, name, tp.puzzle, a) });
		});
	});
}
function serveDelete(req, res, user, id) { json(res, db.deleteBuilderPuzzle(id, user.id) ? 200 : 404, { ok: true }); }
// Publishing: an ordinary pool row (INSERT OR IGNORE on the canonical key, so a duplicate of an existing
// puzzle links to that one), playable at /puzzles/:id and served by the ladder like any other.
function servePublish(req, res, user, id) {
	var bp = db.getBuilderPuzzle(id, user.id);
	if (!bp) { json(res, 404, { error: "not found" }); return; }
	if (!bp.solved) { json(res, 400, { error: "the solver cannot solve this puzzle, so the ladder cannot serve it" }); return; }
	var puzzle = { rows: bp.rows, cols: bp.cols, mines: bp.mines, revealed: bp.revealed };
	var key = puzzleGen.canonicalKey(puzzle);
	analyzeQueue.run({ kind: "rate", puzzle: puzzle }).then(function(a) {
		if (!a || a.error) { json(res, 500, { error: (a && a.error) || "rating failed" }); return; }
		db.insertPuzzle({ key: key, rows: bp.rows, cols: bp.cols, mines: bp.mines, revealed: bp.revealed, coveredSafe: bp.rows * bp.cols - bp.mines.length - bp.revealed.length, difficulty: a.difficulty, score: a.score, maxEnumSize: a.maxEnumSize, needsCaseSplit: a.needsCaseSplit, cspMethod: a.cspMethod, source: "builder", genMethod: "builder", maxComplexity: a.maxComplexity, totalComplexity: a.totalComplexity });
		var row = db.getPuzzleByKey(key);
		if (!row) { json(res, 500, { error: "publish failed" }); return; }
		db.setBuilderPuzzlePool(id, user.id, row.id);
		json(res, 200, { poolPuzzleId: row.id, puzzle: db.getBuilderPuzzle(id, user.id) });
	});
}

function handleBuilderRoute(req, res, url) {
	var pathname = url.pathname;
	if (pathname.indexOf("/api/builder/") !== 0) return false;
	var user = authorOf(req);
	if (!user) { json(res, 401, { error: "Sign in as an admin to use the Puzzle Builder." }); return true; }
	if (pathname === "/api/builder/analyze" && req.method === "POST") { serveAnalyze(req, res, "builder-analyze"); return true; }
	if (pathname === "/api/builder/autocomplete" && req.method === "POST") { serveAnalyze(req, res, "builder-autocomplete"); return true; }
	if (pathname === "/api/builder/puzzles" && req.method === "GET") { serveList(req, res, user); return true; }
	if (pathname === "/api/builder/puzzles" && req.method === "POST") { serveSave(req, res, user); return true; }
	var one = pathname.match(/^\/api\/builder\/puzzles\/(\d+)(\/publish)?$/);
	if (one && one[2] && req.method === "POST") { servePublish(req, res, user, parseInt(one[1], 10)); return true; }
	if (one && !one[2] && req.method === "DELETE") { serveDelete(req, res, user, parseInt(one[1], 10)); return true; }
	json(res, 404, { error: "not found" });
	return true;
}

module.exports = { handleBuilderRoute: handleBuilderRoute };
