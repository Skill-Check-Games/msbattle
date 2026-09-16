// Regression: a one-shot "ranked reset" used to zero ratings/played/wins for every user whose
// ranked_reset_v2 flag was 0 on EVERY boot — and new users were inserted with the flag at 0, so each
// deploy wiped every account created since the previous one. Now: new rows carry the flag, a boot never
// resets anyone, and rows the old wipe already damaged (played below the recorded matches, a rating at 0
// despite recorded matches) are repaired from match_history.
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
function run(dbPath, code) {
	return execFileSync("node", ["-e", "var db=require('./src/db');" + code], { cwd: ROOT, env: Object.assign({}, process.env, { RANKED_DB: dbPath }) }).toString().trim();
}

test("a boot never wipes a user's rank, and old wipe damage is repaired from match history", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-reset-")), dbPath = path.join(dir, "test.db");
	// Boot 1: a fresh guest plays two matches. Then simulate the old wipe on a second, older-style row.
	const ids = JSON.parse(run(dbPath, `
		var g = db.createGuest();
		db.updateRating(g.id, 197, true, 'sprint'); db.recordMatch({ userId: g.id, style: 'sprint', ratingBefore: 0, ratingAfter: 197, placement: 1, players: 2, won: true, opponent: 'A' });
		db.updateRating(g.id, 641, true, 'sprint'); db.recordMatch({ userId: g.id, style: 'sprint', ratingBefore: 197, ratingAfter: 641, placement: 1, players: 6, won: true, opponent: null });
		var v = db.createGuest();
		db.updateRating(v.id, 300, true, 'standard'); db.recordMatch({ userId: v.id, style: 'standard', ratingBefore: 0, ratingAfter: 300, placement: 1, players: 2, won: true, opponent: 'B' });
		db.updateRating(v.id, 420, false, 'standard'); db.recordMatch({ userId: v.id, style: 'standard', ratingBefore: 300, ratingAfter: 420, placement: 2, players: 2, won: false, opponent: 'C' });
		// the damage the old code did: zeroed everything but left match_history alone
		require('node:sqlite'); var raw = new (require('node:sqlite').DatabaseSync)(process.env.RANKED_DB);
		raw.exec('UPDATE users SET rating_standard = 0, played = 0, wins = 0 WHERE id = ' + v.id);
		console.log(JSON.stringify({ g: g.id, v: v.id, flag: db.getUserById(g.id).ranked_reset_v2 }));
	`));
	assert.strictEqual(ids.flag, 1, "a new row carries the reset flag, so no later boot can reset it");
	// Boot 2 (a deploy): the fresh guest keeps everything; the damaged one gets played/wins/rating back.
	const after = JSON.parse(run(dbPath, `
		var g = db.getUserById(${ids.g}), v = db.getUserById(${ids.v});
		console.log(JSON.stringify({ g: { rating: g.rating_sprint, played: g.played, wins: g.wins }, v: { rating: v.rating_standard, played: v.played, wins: v.wins } }));
	`));
	assert.deepStrictEqual(after.g, { rating: 641, played: 2, wins: 2 }, "untouched across a boot");
	assert.deepStrictEqual(after.v, { rating: 420, played: 2, wins: 1 }, "repaired from match_history");
	// Boot 3: the repair is idempotent.
	const again = JSON.parse(run(dbPath, `var v = db.getUserById(${ids.v}); console.log(JSON.stringify({ rating: v.rating_standard, played: v.played, wins: v.wins }));`));
	assert.deepStrictEqual(again, { rating: 420, played: 2, wins: 1 });
});
