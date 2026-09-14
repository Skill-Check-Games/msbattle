// Fill the thin rating bands of the puzzle pool OFFLINE and write the result to puzzle-pool.json at the
// repo root — the server imports that file idempotently at boot (puzzleApi.importPoolFile, INSERT OR
// IGNORE on canonical_key), so prod gets the puzzles on the next deploy without ever running the CSP
// generators on the live machine.
//
//   node apps/server/scripts/fill-pool.js                 # default band targets, 30 min budget
//   BUDGET_MIN=10 node apps/server/scripts/fill-pool.js   # shorter run
//   HAVE='{"600":34,"900":76}' ...                        # what the target DB already holds per band
//
// Targets are per 100-rating band (rating = db.poolRating(score), i.e. the scoring function floored at
// 400). Each generator config covers a band range; the loop keeps only puzzles whose band is still
// short, so nothing generated for a full band is wasted on the file (it is simply skipped).
var fs = require("fs");
var path = require("path");
var PG = require("core/src/engine/PuzzleGenerator");
var IO = require("core/src/engine/InsideOutGenerator");
var BL = require("core/src/common/BoardLogic");

var OUT = path.join(__dirname, "..", "..", "..", "puzzle-pool.json");
var FLOOR = 400;
var BUDGET_MS = (parseFloat(process.env.BUDGET_MIN) || 30) * 60 * 1000;
var HAVE = process.env.HAVE ? JSON.parse(process.env.HAVE) : {};

// Wanted puzzles per band (after what the target DB already has, HAVE).
var TARGET = {};
for (var b = 400; b <= 1900; b += 100) TARGET[b] = 250;
for (b = 2000; b <= 2500; b += 100) TARGET[b] = 120;
TARGET[2600] = 60; TARGET[2700] = 40; TARGET[2800] = 30;

function rating(p) { return Math.max(FLOOR, BL.scoreToRating(p.score)); }
function bandOf(p) { return Math.min(2800, Math.floor(rating(p) / 100) * 100); }

// Generator configs with the band range they mostly produce (from a benchmark run).
var CONFIGS = [
	{ name: "random d2 dense", lo: 500, hi: 800, gen: function() { return PG.generatePuzzles({ count: 10, diff: 2, density: 0.30 }); } },
	{ name: "random d3", lo: 600, hi: 1100, gen: function() { return PG.generatePuzzles({ count: 10, diff: 3 }); } },
	{ name: "random d4", lo: 1200, hi: 1800, gen: function() { return PG.generatePuzzles({ count: 10, diff: 4 }); } },
	{ name: "random d5", lo: 1600, hi: 2500, gen: function() { return PG.generatePuzzles({ count: 5, diff: 5 }); } },
	{ name: "random d6", lo: 2500, hi: 2800, gen: function() { return PG.generatePuzzles({ count: 2, diff: 6 }); } },
	{ name: "inside-out 650", lo: 500, hi: 700, gen: function() { return IO.generatePuzzles({ count: 10, targetRating: 650, ratingWindow: 80 }); } },
	{ name: "inside-out 1050", lo: 900, hi: 1200, gen: function() { return IO.generatePuzzles({ count: 10, targetRating: 1050, ratingWindow: 200 }); } },
	{ name: "inside-out 1900", lo: 1700, hi: 2100, gen: function() { return IO.generatePuzzles({ count: 5, targetRating: 1900, ratingWindow: 250 }); } },
	{ name: "inside-out 2300", lo: 2000, hi: 2600, gen: function() { return IO.generatePuzzles({ count: 5, targetRating: 2300, ratingWindow: 350 }); } },
	{ name: "inside-out 2700", lo: 2400, hi: 2800, gen: function() { return IO.generatePuzzles({ count: 3, targetRating: 2700, ratingWindow: 350 }); } }
];

// The random generator's output carries only difficulty/score; re-run the analyzer so the row gets the
// same csp_method / case-split / complexity columns the inside-out generator (and the Lab) fill in.
function complete(p, source) {
	if (!p.cspMethod) {
		var board = PG.buildBoard(p.rows, p.cols, p.mines);
		var a = PG.analyzeWithTracking(board, p.revealed, p.mines.length);
		p.needsCaseSplit = !!a.needsCaseSplit;
		p.cspMethod = a.cspMethod || "trivial";
		p.maxComplexity = a.cspMaxComplexity;
		p.totalComplexity = a.cspTotalComplexity;
	}
	p.source = p.source || source;
	p.genMethod = p.genMethod || "fill-pool";
	return p;
}

var existing = [];
try { existing = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) {}
var seen = {};
var have = {};
for (b in TARGET) have[b] = HAVE[b] || 0;
existing.forEach(function(p) { seen[p.key] = true; var bb = bandOf(p); if (have[bb] != null) have[bb]++; });
var out = existing.slice();

function need(band) { return TARGET[band] != null && have[band] < TARGET[band]; }
function anyNeedIn(lo, hi) { for (var x = lo; x <= hi; x += 100) if (need(x)) return true; return false; }
function summary() { return Object.keys(TARGET).map(function(k) { return k + ":" + have[k] + "/" + TARGET[k]; }).join(" "); }

var t0 = Date.now(), lastSave = t0, i = 0, produced = 0;
console.log("start —", summary());
while (Date.now() - t0 < BUDGET_MS) {
	var live = CONFIGS.filter(function(c) { return anyNeedIn(c.lo, c.hi); });
	if (!live.length) { console.log("all bands full"); break; }
	// Weighted pick: a config's weight is the total deficit across the bands it covers, so the generators
	// that reach the emptiest bands run most often instead of a flat round-robin.
	var weights = live.map(function(c) { var w = 0; for (var x = c.lo; x <= c.hi; x += 100) if (need(x)) w += TARGET[x] - have[x]; return w; });
	var total = weights.reduce(function(a, b) { return a + b; }, 0), r = Math.random() * total, cfg = live[live.length - 1];
	for (var wi = 0; wi < live.length; wi++) { r -= weights[wi]; if (r <= 0) { cfg = live[wi]; break; } }
	i++;
	var batch = cfg.gen();
	batch.forEach(function(p) {
		if (seen[p.key]) return;
		var bb = bandOf(p);
		if (!need(bb)) return;
		seen[p.key] = true; have[bb]++; produced++;
		out.push(complete(p, cfg.name.indexOf("inside") === 0 ? "inside_out" : "random"));
	});
	if (Date.now() - lastSave > 60 * 1000) {
		fs.writeFileSync(OUT, JSON.stringify(out));
		lastSave = Date.now();
		console.log(Math.round((Date.now() - t0) / 60000) + "min +" + produced + " —", summary());
	}
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("done: " + out.length + " puzzles in " + OUT + " (+" + produced + " this run) —", summary());
