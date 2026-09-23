// Hand-made puzzles (the admin Puzzle Builder, /admin/builder). A position is a grid of cells, each one of:
//   "?"  covered, undecided        "M"  covered, a mine        "S"  covered, safe        "0".."8"  revealed clue
// enumerate() lists the mine layouts of the covered cells around the clues that satisfy every clue (the
// author's M / S marks are fixed). analyzePosition() turns that into what the builder shows: contradiction,
// determined and ambiguous cells, the solver's next move from the visible clues, and a preview rating of one
// completion. autocomplete() picks the completion that makes the best-rated solvable puzzle. Covered cells no
// clue touches ("free") are filled as mines in the analysis preview (nothing ever needs to deduce them, so
// they cannot make a puzzle unsolvable, and they keep the visible position exactly as drawn); autocomplete
// instead seeds them at random like the pool generator does, so the finished board plays on past the clues,
// and only falls back to mines when no random fill is solvable.
var BoardLogic = require("../common/BoardLogic");
var cspSolver = require("./CSPSolver");
var puzzleGen = require("./PuzzleGenerator");
var KNOWN = BoardLogic.KNOWN, UNKNOWN = BoardLogic.UNKNOWN;

var RATING_FLOOR = 400;   // db.js PUZZLE_RATING_FLOOR: every pool rating sits at or above it
function isDigit(v) { return typeof v === "string" && v.length === 1 && v >= "0" && v <= "8"; }
function cellKey(r, c) { return r + "," + c; }

// The covered cells next to at least one clue (row-major) and the clue constraints over them.
function constraints(spec) {
	var rows = spec.rows, cols = spec.cols, cells = spec.cells;
	var seen = {}, covered = [], clueList = [];
	for (var r = 0; r < rows; r++) {
		for (var c = 0; c < cols; c++) {
			if (!isDigit(cells[r][c])) continue;
			var vars = [];
			BoardLogic.forEachNeighbour(r, c, rows, cols, function(nr, nc) {
				if (isDigit(cells[nr][nc])) return;   // a revealed cell is safe
				var k = cellKey(nr, nc);
				if (seen[k] == null) { seen[k] = true; covered.push([nr, nc]); }
				vars.push(k);
			});
			clueList.push({ at: [r, c], need: parseInt(cells[r][c], 10), varKeys: vars });
		}
	}
	covered.sort(function(a, b) { return a[0] - b[0] || a[1] - b[1]; });
	var idx = {};
	covered.forEach(function(rc, i) { idx[cellKey(rc[0], rc[1])] = i; });
	var clues = clueList.map(function(cl) { return { at: cl.at, need: cl.need, vars: cl.varKeys.map(function(k) { return idx[k]; }) }; });
	return { covered: covered, clues: clues, idx: idx };
}

// Backtracking over the undecided constrained cells, most-constrained first, checking only the clues a
// placement touches. Stops at maxSolutions layouts or maxNodes placements (capped: true).
function enumerate(spec, opts) {
	opts = opts || {};
	var maxSolutions = opts.maxSolutions || 2000, maxNodes = opts.maxNodes || 3000000;
	var cs = constraints(spec), covered = cs.covered, clues = cs.clues, n = covered.length;
	var assign = new Array(n), touching = new Array(n);
	for (var i = 0; i < n; i++) {
		var v = spec.cells[covered[i][0]][covered[i][1]];
		assign[i] = v === "M" ? 1 : v === "S" ? 0 : -1;
		touching[i] = [];
	}
	clues.forEach(function(cl, ci) { cl.vars.forEach(function(vi) { touching[vi].push(ci); }); });
	var mines = clues.map(function() { return 0; }), unknown = clues.map(function(cl) { return cl.vars.length; });
	for (i = 0; i < n; i++) if (assign[i] !== -1) touching[i].forEach(function(ci) { unknown[ci]--; if (assign[i] === 1) mines[ci]++; });
	for (var ci = 0; ci < clues.length; ci++) {
		if (mines[ci] > clues[ci].need || mines[ci] + unknown[ci] < clues[ci].need) return { covered: covered, clues: clues, idx: cs.idx, solutions: [], capped: false, nodes: 0 };
	}
	var order = [];
	for (i = 0; i < n; i++) if (assign[i] === -1) order.push(i);
	order.sort(function(a, b) { return touching[b].length - touching[a].length || a - b; });
	var solutions = [], nodes = 0, capped = false;
	function fits(vi) {
		for (var t = 0; t < touching[vi].length; t++) { var k = touching[vi][t]; if (mines[k] > clues[k].need || mines[k] + unknown[k] < clues[k].need) return false; }
		return true;
	}
	function go(d) {
		if (solutions.length >= maxSolutions || nodes >= maxNodes) { capped = true; return; }
		if (d === order.length) { solutions.push(assign.slice()); return; }
		var vi = order[d];
		for (var val = 0; val <= 1 && !capped; val++) {
			nodes++;
			assign[vi] = val;
			touching[vi].forEach(function(k) { unknown[k]--; if (val) mines[k]++; });
			if (fits(vi)) go(d + 1);
			touching[vi].forEach(function(k) { unknown[k]++; if (val) mines[k]--; });
			assign[vi] = -1;
		}
	}
	go(0);
	return { covered: covered, clues: clues, idx: cs.idx, solutions: solutions, capped: capped, nodes: nodes };
}

// One layout applied to the spec: constrained cells from the solution, free undecided cells as freeAs.
function complete(spec, en, solution, freeAs) {
	var cells = spec.cells.map(function(row) { return row.slice(); });
	en.covered.forEach(function(rc, i) { if (cells[rc[0]][rc[1]] === "?") cells[rc[0]][rc[1]] = solution[i] ? "M" : "S"; });
	for (var r = 0; r < spec.rows; r++) for (var c = 0; c < spec.cols; c++) if (cells[r][c] === "?") cells[r][c] = freeAs || "M";
	return { rows: spec.rows, cols: spec.cols, cells: cells };
}

// A complete spec as a pool puzzle ({rows, cols, mines, revealed}); errors lists undecided cells and clues
// whose number does not match the mines around them.
function toPuzzle(spec) {
	var mines = [], revealed = [], errors = [];
	for (var r = 0; r < spec.rows; r++) for (var c = 0; c < spec.cols; c++) {
		var v = spec.cells[r][c];
		if (v === "M") mines.push([r, c]); else if (isDigit(v)) revealed.push([r, c]); else if (v !== "S") errors.push({ at: [r, c], why: "undecided" });
	}
	for (var i = 0; i < revealed.length; i++) {
		var rr = revealed[i][0], cc = revealed[i][1], count = 0;
		BoardLogic.forEachNeighbour(rr, cc, spec.rows, spec.cols, function(nr, nc) { if (spec.cells[nr][nc] === "M") count++; });
		if (count !== parseInt(spec.cells[rr][cc], 10)) errors.push({ at: [rr, cc], why: "shows " + spec.cells[rr][cc] + " but " + count + " mines around it" });
	}
	return { puzzle: { rows: spec.rows, cols: spec.cols, mines: mines, revealed: revealed }, errors: errors };
}

function tierOf(maxC, solved) { return !solved ? 0 : maxC <= 1.5 ? 1 : maxC <= 3 ? 2 : maxC <= 5 ? 3 : maxC <= 7 ? 4 : maxC <= 10 ? 5 : 6; }
function ratingOf(score) { return Math.max(RATING_FLOOR, BoardLogic.scoreToRating(score)); }

// The solver's whole run on a puzzle: the rating fields plus the first move, from the visible clues only
// (so it is the same whichever consistent completion is used).
function solve(puzzle) {
	var board = puzzleGen.buildBoard(puzzle.rows, puzzle.cols, puzzle.mines), state = [];
	for (var r = 0; r < puzzle.rows; r++) { state.push([]); for (var c = 0; c < puzzle.cols; c++) state[r].push(UNKNOWN); }
	puzzle.revealed.forEach(function(rc) { state[rc[0]][rc[1]] = KNOWN; });
	function cascade(rr, cc) {
		BoardLogic.cascadeReveal(rr, cc, puzzle.rows, puzzle.cols,
			function(a, b) { return state[a][b] === UNKNOWN; },
			function(a, b) { state[a][b] = KNOWN; return false; },
			function(a, b) { return board[a][b]; });
	}
	var res = cspSolver.analyzeBoard(board, state, { revealCell: cascade });
	var score = res.solved ? puzzleGen.complexityScore(res.moves) : 0;
	var first = res.moves[0] || null;
	return {
		solved: res.solved, maxComplexity: Math.round(res.maxComplexity * 10) / 10, totalComplexity: Math.round(res.totalComplexity * 10) / 10,
		score: score, difficulty: tierOf(res.maxComplexity, res.solved), rating: res.solved ? ratingOf(score) : null,
		moves: res.moves.length, safeLeft: res.safeCovered,
		nextMove: first ? { method: first.method || first.action, action: first.action, complexity: Math.round(first.complexity * 100) / 100, cells: first.cells, changed: first.changed, splitCell: first.splitCell || null } : null
	};
}

// Whether some layout fits the clues with the cell at rc marked as (M or S): one search to the first solution.
function feasibleWith(spec, rc, mark) {
	var cells = spec.cells.map(function(row) { return row.slice(); });
	cells[rc[0]][rc[1]] = mark;
	return enumerate({ rows: spec.rows, cols: spec.cols, cells: cells }, { maxSolutions: 1 }).solutions.length > 0;
}

function analyzePosition(spec) {
	var en = enumerate(spec, { maxSolutions: 5000 });
	var out = { rows: spec.rows, cols: spec.cols, clues: en.clues.length, layouts: en.solutions.length, capped: en.capped, contradiction: en.solutions.length === 0 && !en.capped, determinedSafe: [], determinedMine: [], ambiguous: [], free: [], nextMove: null, preview: null };
	for (var r = 0; r < spec.rows; r++) for (var c = 0; c < spec.cols; c++) if (spec.cells[r][c] === "?" && en.idx[cellKey(r, c)] == null) out.free.push([r, c]);
	if (!en.solutions.length) return out;
	en.covered.forEach(function(rc, i) {
		if (spec.cells[rc[0]][rc[1]] !== "?") return;   // the author's own marks are not "determined by the clues"
		var anyMine = false, anySafe = false;
		for (var s = 0; s < en.solutions.length && !(anyMine && anySafe); s++) { if (en.solutions[s][i]) anyMine = true; else anySafe = true; }
		// A capped enumeration is a biased sample: the search branches on the most constrained cell first and tries
		// "safe" first, so its first thousands of layouts can all agree on a cell that is in fact open. Whatever the
		// sample did not see is checked exactly: is there any layout with this cell a mine (or safe)?
		if (en.capped && !(anyMine && anySafe)) { if (!anyMine) anyMine = feasibleWith(spec, rc, "M"); if (!anySafe) anySafe = feasibleWith(spec, rc, "S"); }
		(anyMine && anySafe ? out.ambiguous : anyMine ? out.determinedMine : out.determinedSafe).push(rc);
	});
	var completion = complete(spec, en, en.solutions[0], "M");
	var tp = toPuzzle(completion);
	var solved = solve(tp.puzzle);
	out.nextMove = solved.nextMove;
	out.preview = { solved: solved.solved, difficulty: solved.difficulty, score: solved.score, rating: solved.rating, maxComplexity: solved.maxComplexity, moves: solved.moves, safeLeft: solved.safeLeft, mines: tp.puzzle.mines.length };
	return out;
}

// Tries consistent layouts of the constrained cells, and for each one several random fills of the free cells
// at opts.density (jittered a few points either way, as the pool generator varies its boards), and keeps the
// solvable puzzle with the highest score: the hardest puzzle the drawn position can be, on a board that goes
// on past the clues. Bounded by opts.budgetMs. If no random fill is solvable it falls back to filling the free
// cells with mines (always as solvable as the clues allow); if even that fails, the attempt the solver gets
// furthest on comes back with solvable: false so the author can see where it sticks.
var FILL_DENSITY = 0.2, FILL_BUDGET_MS = 2500, FILLS_PER_LAYOUT = 6;
function autocomplete(spec, opts) {
	opts = opts || {};
	var density = typeof opts.density === "number" ? Math.max(0, Math.min(0.6, opts.density)) : FILL_DENSITY;
	var budgetMs = opts.budgetMs || FILL_BUDGET_MS, started = Date.now();
	var en = enumerate(spec, { maxSolutions: opts.maxTries || 400 });
	if (!en.solutions.length) return { ok: false, contradiction: !en.capped, tried: 0 };
	var free = [];
	for (var r = 0; r < spec.rows; r++) for (var c = 0; c < spec.cols; c++) if (spec.cells[r][c] === "?" && en.idx[cellKey(r, c)] == null) free.push([r, c]);
	var best = null, solvable = 0, tried = 0;
	function consider(completion) {
		var tp = toPuzzle(completion), s = solve(tp.puzzle);
		tried++;
		if (s.solved) solvable++;
		var better = !best || (s.solved && !best.solved) || (s.solved === best.solved && s.score > best.score);
		if (better) best = { solved: s.solved, score: s.score, difficulty: s.difficulty, rating: s.rating, maxComplexity: s.maxComplexity, moves: s.moves, safeLeft: s.safeLeft, cells: completion.cells, puzzle: tp.puzzle };
	}
	// Layouts in a random order, so a run that hits the budget has sampled the space rather than its first corner.
	var order = en.solutions.map(function(_, i) { return i; });
	for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
	var fills = free.length ? FILLS_PER_LAYOUT : 1;
	for (var oi = 0; oi < order.length && Date.now() - started < budgetMs; oi++) {
		var solution = en.solutions[order[oi]];
		for (var f = 0; f < fills && Date.now() - started < budgetMs; f++) {
			var completion = complete(spec, en, solution, "S");
			if (free.length) {
				var d = Math.max(0, Math.min(0.6, density + (Math.random() - 0.5) * 0.06)), want = Math.round(free.length * d);
				var picks = free.slice();
				for (var k = picks.length - 1; k > 0; k--) { var kk = Math.floor(Math.random() * (k + 1)); var tt = picks[k]; picks[k] = picks[kk]; picks[kk] = tt; }
				for (var m = 0; m < want; m++) completion.cells[picks[m][0]][picks[m][1]] = "M";
			}
			consider(completion);
		}
	}
	if (!best || !best.solved) {
		// Nothing random solved: the old fill (free cells all mines) for every layout, which cannot fail on the free
		// side, so what is left tells the author about the clues themselves.
		for (var li = 0; li < en.solutions.length && Date.now() - started < budgetMs * 2; li++) consider(complete(spec, en, en.solutions[li], "M"));
	}
	return { ok: true, tried: tried, layouts: en.solutions.length, capped: en.capped, solvable: solvable, free: free.length, density: density, best: best };
}

// A finished puzzle's rating fields, as the pool stores them (analyzeWithTracking's view) plus the tier.
function rate(puzzle) {
	var a = puzzleGen.analyzeWithTracking(puzzleGen.buildBoard(puzzle.rows, puzzle.cols, puzzle.mines), puzzle.revealed, puzzle.mines.length);
	return { solved: a.solved, difficulty: a.difficulty, score: a.score, rating: a.solved ? ratingOf(a.score) : null, maxEnumSize: a.maxEnumSize, needsCaseSplit: a.needsCaseSplit, cspMethod: a.cspMethod, maxComplexity: a.cspMaxComplexity, totalComplexity: a.cspTotalComplexity };
}

exports.isDigit = isDigit;
exports.enumerate = enumerate;
exports.complete = complete;
exports.toPuzzle = toPuzzle;
exports.solve = solve;
exports.analyzePosition = analyzePosition;
exports.autocomplete = autocomplete;
exports.rate = rate;
