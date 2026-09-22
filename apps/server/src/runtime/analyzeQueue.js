// The one solver worker: jobs (see analyze-worker.js for the kinds) run on a worker thread, one at a time
// with the rest queued behind it, so a deep solve never blocks the event loop and every socket this process
// serves. A job past JOB_TIMEOUT_MS is killed and reported as an error.
var path = require("path");
var Worker = require("worker_threads").Worker;

var JOB_TIMEOUT_MS = 180000;
var queue = [], busy = false;

function run(job) {
	return new Promise(function(resolve) {
		queue.push({ job: job, resolve: resolve });
		pump();
	});
}
function pump() {
	if (busy || !queue.length) return;
	busy = true;
	var item = queue.shift();
	var worker = new Worker(path.join(__dirname, "analyze-worker.js"));
	var done = false;
	var timer = setTimeout(function() { finish({ error: "Analysis timed out after " + Math.round(JOB_TIMEOUT_MS / 1000) + "s" }); }, JOB_TIMEOUT_MS);
	function finish(out) {
		if (done) return;
		done = true;
		clearTimeout(timer);
		worker.terminate();
		busy = false;
		item.resolve(out || { error: "no result" });
		pump();
	}
	worker.on("message", finish);
	worker.on("error", function(e) { finish({ error: String((e && e.message) || e) }); });
	worker.on("exit", function(code) { if (!done) finish({ error: "analysis worker exited (" + code + ")" }); });
	worker.postMessage(item.job);
}

module.exports = { run: run };
