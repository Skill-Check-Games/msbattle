// The CSP analyzer on a worker thread. A deep solve (a big case split over a wide frontier) is seconds of
// pure CPU; on the main thread that stalls every socket this process serves, so puzzleApi runs each
// Analyze request here instead (one at a time, see analyzePuzzleBoardAsync). Loaded in-process too, for
// the plain function.
var workerThreads = require("worker_threads");
var puzzleGen = require("core/src/engine/PuzzleGenerator");
var cspSolver = require("core/src/engine/CSPSolver");
var BoardLogic = require("core/src/common/BoardLogic");
var puzzleBuilder = require("core/src/engine/PuzzleBuilder");

// Run the CSP analyzer on a puzzle ({rows,cols,mines,revealed}) and return the trace payload the Analyze
// modal expects. Shared by the pool's analyze endpoint, the combined-puzzles one and the starting positions.
function analyzePuzzleBoard(puzzle) {
	var board = puzzleGen.buildBoard(puzzle.rows, puzzle.cols, puzzle.mines);
	var state = [];
	for (var r = 0; r < puzzle.rows; r++) {
		state.push([]);
		for (var c = 0; c < puzzle.cols; c++) state[r].push(BoardLogic.UNKNOWN);
	}
	puzzle.revealed.forEach(function(rc) { state[rc[0]][rc[1]] = BoardLogic.KNOWN; });
	function cascade(rr, cc) {
		BoardLogic.cascadeReveal(rr, cc, puzzle.rows, puzzle.cols,
			function(r2, c2) { return state[r2][c2] === BoardLogic.UNKNOWN; },
			function(r2, c2) { state[r2][c2] = BoardLogic.KNOWN; return false; },
			function(r2, c2) { return board[r2][c2]; }
		);
	}
	var result = cspSolver.analyzeBoard(board, state, { revealCell: cascade });
	return {
		solved: result.solved,
		maxComplexity: result.maxComplexity,
		totalComplexity: result.totalComplexity,
		safeCovered: result.safeCovered,
		moves: result.moves
	};
}

// Jobs, by kind: "analyze" (a pool puzzle's trace, the Analyze modal), "rate" (a finished puzzle's rating
// fields), "builder-analyze" and "builder-autocomplete" (the Puzzle Builder's position, see PuzzleBuilder.js).
// A message with no kind is an "analyze" job (the original protocol).
function runJob(job) {
	var kind = (job && job.kind) || "analyze";
	if (kind === "analyze") return analyzePuzzleBoard(job.puzzle || job);
	if (kind === "rate") return puzzleBuilder.rate(job.puzzle);
	if (kind === "builder-analyze") return puzzleBuilder.analyzePosition(job.spec);
	if (kind === "builder-autocomplete") return puzzleBuilder.autocomplete(job.spec, job.opts || {});
	return { error: "unknown job kind " + kind };
}
if (workerThreads.parentPort) {
	workerThreads.parentPort.on("message", function(job) {
		var out;
		try { out = runJob(job); } catch (e) { out = { error: String((e && e.message) || e) }; }
		workerThreads.parentPort.postMessage(out);
	});
}

module.exports = { analyzePuzzleBoard: analyzePuzzleBoard };
