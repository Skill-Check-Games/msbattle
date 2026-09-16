// Phase 0 P0-4: the pairwise-Elo math is a PURE function of the match parts (ratings-before + played
// + rank + progress) — no db, no appState, no sockets. These tests pin the formula and prove isolation.

const { test, before } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

let elo, db;
before(() => {
	process.env.RANKED_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ms-elo-")), "test.db");
	elo = require("../src/runtime/elo");
	db = require("../src/db");
	elo.init({ RANKED_BOT_RATING: 1000, PROVISIONAL_GAMES: 5 });
});

test("1v1 equal ratings: winner +K/2, loser -K/2 (settled K=40)", () => {
	const parts = [
		{ rank: 1, rating: 1000, bot: false, userId: 1, played: 10 },
		{ rank: 2, rating: 1000, bot: false, userId: 2, played: 10 }
	];
	elo.computeRankedElo(parts, "sprint"); // kFactor(10,sprint)=40, sum=±0.5, sqrt(n-1)=1
	assert.strictEqual(parts[0].delta, 20);
	assert.strictEqual(parts[0].newRating, 1020);
	assert.strictEqual(parts[1].delta, -20);
	assert.strictEqual(parts[1].newRating, 980);
	assert.strictEqual(parts[0].provisional, false); // played+1=11 >= 5
});

test("margin-of-victory scales a positive swing but not a loss", () => {
	const parts = [
		{ rank: 1, rating: 1000, bot: false, userId: 1, played: 10, progress: 1.0 },
		{ rank: 2, rating: 1000, bot: false, userId: 2, played: 10, progress: 0.0 }
	];
	elo.computeRankedElo(parts, "sprint"); // winner gap=1.0, sprint bonus 0.6 → 20*1.6=32
	assert.strictEqual(parts[0].delta, 32);
	assert.strictEqual(parts[1].delta, -20); // loss unaffected by margin
});

// Bots are rated for display only (nothing is persisted for them): a result card with a blank rating
// change on some rows would say which players are bots, which the game never reveals.
test("bots get a display delta at the settled K; unidentified players get none", () => {
	const parts = [
		{ rank: 1, rating: 1200, bot: true, userId: null, played: 0 },
		{ rank: 2, rating: 1000, bot: false, userId: 7, played: 3 },
		{ rank: 3, rating: 1000, bot: false, userId: null, played: 0 }
	];
	elo.computeRankedElo(parts, "sprint");
	assert.notStrictEqual(parts[0].delta, null, "bot is rated for display");
	assert.strictEqual(parts[0].provisional, false, "a bot is never in placement");
	assert.ok(Math.abs(parts[0].delta) <= 60, "a bot swings by the settled K, not the placement one");
	assert.notStrictEqual(parts[1].delta, null, "human is rated");
	assert.strictEqual(parts[1].provisional, true); // played+1=4 < 5
	assert.strictEqual(parts[2].delta, null, "a player with no identity at all is not rated");
});

test("a rating can't fall below 0 (Bronze I floor)", () => {
	const parts = [
		{ rank: 1, rating: 3000, bot: false, userId: 1, played: 0 },
		{ rank: 2, rating: 5, bot: false, userId: 2, played: 0 }
	];
	elo.computeRankedElo(parts, "sprint");
	assert.ok(parts[1].newRating >= 0, "floored at 0");
});

test("applyRankedEloFromReport persists by userId from a network report (P1-5)", () => {
	// A report from a game server carries userId + rating-before per standing (no accounts cache).
	const standings = [
		{ id: "game-sock-A", rank: 1, name: "Winner", userId: 4242, ratingBefore: 1000, played: 10 },
		{ id: "game-sock-B", rank: 2, name: "Loser", userId: 4343, ratingBefore: 1000, played: 10 }
	];
	elo.applyRankedEloFromReport(standings, "sprint");
	const winnerRating = db.getUserById(4242) ? db.getUserById(4242).rating_sprint : null;
	// The user rows didn't pre-exist, so updateRating is a no-op UPDATE; the durable proof is the
	// match_history rows recorded by userId.
	const hist = db.getMatchHistory(4242, 10);
	assert.ok(hist.length >= 1, "winner's match recorded by userId");
	assert.strictEqual(hist[0].style, "sprint");
	assert.strictEqual(hist[0].won, 1, "rank-1 recorded as a win");
	assert.ok(hist[0].rating_after > hist[0].rating_before, "winner gained rating");
	const loserHist = db.getMatchHistory(4343, 10);
	assert.ok(loserHist[0].rating_after < loserHist[0].rating_before, "loser lost rating");
});

test("pure & deterministic: same input → same output, no side effects", () => {
	const mk = () => [
		{ rank: 1, rating: 1100, bot: false, userId: 1, played: 2 },
		{ rank: 2, rating: 1000, bot: false, userId: 2, played: 2 }
	];
	const a = elo.computeRankedElo(mk(), "standard");
	const b = elo.computeRankedElo(mk(), "standard");
	assert.deepStrictEqual(a.map(p => p.delta), b.map(p => p.delta));
});

// Win-streak bonus: a win that extends a streak of 3+ pays more, up to 3× the settled gain at 6 in a row.
// `streak` on a part is the wins in a row BEFORE the match; the multiplier applies to the win that extends it.
test("streakMultiplier: nothing below 3 in a row, 1.5×/2×/2.5×, capped at 3× from 6", () => {
	assert.strictEqual(elo.streakMultiplier(0), 1);
	assert.strictEqual(elo.streakMultiplier(2), 1);
	assert.strictEqual(elo.streakMultiplier(3), 1.5);
	assert.strictEqual(elo.streakMultiplier(4), 2);
	assert.strictEqual(elo.streakMultiplier(5), 2.5);
	assert.strictEqual(elo.streakMultiplier(6), 3);
	assert.strictEqual(elo.streakMultiplier(15), 3);
});

test("a settled 1v1 win on a 5-win streak (6th in a row) triples the gain; the loser is unaffected", () => {
	const parts = [
		{ rank: 1, rating: 1000, bot: false, userId: 1, played: 10, streak: 5 },
		{ rank: 2, rating: 1000, bot: false, userId: 2, played: 10, streak: 5 }
	];
	elo.computeRankedElo(parts, "sprint");
	assert.strictEqual(parts[0].delta, 60);  // 20 × 3
	assert.strictEqual(parts[1].delta, -20); // a loss never gets a streak bonus, whatever the streak was
});

test("streak bonus starts at the 3rd consecutive win (streak 2 before the match → 1.5×)", () => {
	const parts = [
		{ rank: 1, rating: 1000, bot: false, userId: 1, played: 10, streak: 2 },
		{ rank: 2, rating: 1000, bot: false, userId: 2, played: 10, streak: 0 }
	];
	elo.computeRankedElo(parts, "sprint");
	assert.strictEqual(parts[0].delta, 30);
	const none = [
		{ rank: 1, rating: 1000, bot: false, userId: 1, played: 10, streak: 1 },
		{ rank: 2, rating: 1000, bot: false, userId: 2, played: 10, streak: 0 }
	];
	elo.computeRankedElo(none, "sprint");
	assert.strictEqual(none[0].delta, 20, "2 in a row is not yet a streak");
});

test("streak bonus is measured against the settled K, so placement swings get an additive bonus, not 3×", () => {
	// Game 1 K=150: base +75. A 6-streak adds (3-1) × settled 40 × 0.5 = +40, not 75 × 3.
	const parts = [
		{ rank: 1, rating: 1000, bot: false, userId: 1, played: 0, streak: 5 },
		{ rank: 2, rating: 1000, bot: false, userId: 2, played: 0, streak: 0 }
	];
	elo.computeRankedElo(parts, "sprint");
	assert.strictEqual(parts[0].delta, 115);
});

test("6-player win at Gold vs 1000-rated bots: streak lifts a ~15 gain to ~45", () => {
	const mk = (streak) => [{ rank: 1, rating: 1300, bot: false, userId: 1, played: 20, streak }]
		.concat([2, 3, 4, 5, 6].map(r => ({ rank: r, rating: 1000, bot: true, userId: null, played: 0 })));
	const cold = elo.computeRankedElo(mk(0), "sprint")[0].delta;
	const hot = elo.computeRankedElo(mk(6), "sprint")[0].delta;
	assert.ok(cold >= 12 && cold <= 16, "cold gain ~13.5 (got " + cold + ")");
	assert.ok(Math.abs(hot - cold * 3) <= 1, "hot ≈ 3× cold before rounding (cold " + cold + ", hot " + hot + ")");
});

test("applyRankedEloFromReport reads the streak from player_stats (3 prior wins → 2× on the 4th)", () => {
	const W = 5151, L = 5252;
	for (let i = 0; i < 3; i++) {
		db.recordMatch({ userId: W, style: "sprint", ratingBefore: 1000, ratingAfter: 1020, placement: 1, players: 2, won: true, opponent: null });
	}
	assert.strictEqual(db.currentWinStreak(W), 3);
	assert.strictEqual(db.currentWinStreak(L), 0);
	const standings = [
		{ id: "a", rank: 1, name: "W", userId: W, ratingBefore: 1000, played: 10 },
		{ id: "b", rank: 2, name: "L", userId: L, ratingBefore: 1000, played: 10 }
	];
	elo.applyRankedEloFromReport(standings, "sprint");
	assert.strictEqual(standings[0].ratingDelta, 40); // 20 × 2
	assert.strictEqual(standings[1].ratingDelta, -20);
	assert.strictEqual(db.currentWinStreak(W), 4, "the win extended the streak");
	// A loss resets it, so the next win is back to the plain gain.
	db.recordMatch({ userId: W, style: "sprint", ratingBefore: 1040, ratingAfter: 1020, placement: 2, players: 2, won: false, opponent: null });
	assert.strictEqual(db.currentWinStreak(W), 0);
});
