// Elo / rating math, extracted from minesweeperServer. The pairwise-Elo formula that
// turns a round's standings into rating changes, and the per-style rating reader.
// Pure math over db + the in-memory accounts cache; the standings it consumes are built in
// the core (which reads game state). isBot + the rating constants are injected via init(deps)
// to avoid a circular require; accounts/botRating come from appState.

var db = require("../db");
var appState = require("./appState");
var gameUtil = require("./gameUtil");
var botPlayer = require("core/src/engine/BotPlayer");

var accounts = appState.accounts, botRating = appState.botRating, botUserIds = appState.botUserIds;
// Everyone else in a match, for the match row: profile id when there is one (a player, or a pool bot's
// persistent profile), plus what a match list shows.
function opponentsOf(standings, i, userIdOf) {
	var out = [];
	for (var j = 0; j < standings.length; j++) {
		if (j === i) continue;
		var s = standings[j];
		out.push({ userId: userIdOf(s) || null, name: s.name || "Anonymous", avatar: s.avatar || null, country: s.country || null, placement: s.rank });
	}
	return out;
}
var isBot = gameUtil.isBot;

var RANKED_BOT_RATING, PROVISIONAL_GAMES;
function init(deps) {
	RANKED_BOT_RATING = deps.RANKED_BOT_RATING;
	PROVISIONAL_GAMES = deps.PROVISIONAL_GAMES;
}

// Standard matches take far longer to play than Sprint, so a session yields far fewer of them and the
// ladder climbs slowly. Boost Standard's rating swings — extra during placement — so it moves at a pace
// closer to Sprint despite the lower game volume. 1.5× for the first game, easing to a steady 1.3×.
function styleKMultiplier(style, played) {
	if (style !== "standard") return 1;
	return 1.3 + 0.2 * Math.max(0, 1 - played / 8);
}

// K-factor: big swings for a player's first matches (placement), settling to a stable floor so an
// established rating stops bouncing. K=150 game 1 → 40 from ~game 8 on (× the per-style multiplier).
function kFactor(played, style) { return Math.max(40, 150 - played * 14) * styleKMultiplier(style, played); }
// Bots never persist a rating, but the result card shows them gaining and losing like anyone else (a row
// with no rating change would say "this one is a bot"). Their swing is computed by the same pairwise math
// off their pool rating, with a settled match count so they get the ordinary K, never the placement one.
var BOT_SETTLED_PLAYED = 10;

// Win-streak bonus: a WIN on a hot streak pays more. `streak` is the number of wins in a row this
// win extends (so the win that makes it 3 in a row is streak 3). Nothing below 3; then the gain grows by
// half a settled-K step per win — 3 → 1.5×, 4 → 2×, 5 → 2.5× — capping at 3× from 6 in a row. Losses
// and non-first finishes are never touched. The bonus is measured against the SETTLED K (not the
// placement K), so a streak during placement adds the same absolute bonus as it would later instead of
// tripling an already-large placement swing.
var STREAK_BONUS_FROM = 3, STREAK_BONUS_MAX_AT = 6, STREAK_MAX_MULTIPLIER = 3;
function streakMultiplier(streak) {
	if (!(streak >= STREAK_BONUS_FROM)) return 1;
	var t = Math.min(1, (streak - (STREAK_BONUS_FROM - 1)) / (STREAK_BONUS_MAX_AT - (STREAK_BONUS_FROM - 1)));
	return 1 + (STREAK_MAX_MULTIPLIER - 1) * t;
}
function settledK(style) { return kFactor(BOT_SETTLED_PLAYED, style); }

// ---- Placement: the first PROVISIONAL_GAMES matches on a style's ladder ----
// Not Elo steps from 0 but a performance estimate, so a strong newcomer lands near their level in a
// match or two and a weak start is corrected just as fast. Each placement match yields a performance
// rating: the classic outcome estimate (each opponent's rating ± 400 for a win / loss, averaged) blended
// with a SPEED rating when the player cleared the board — the rating of pool bots that clear this
// style's board in the same time (bots-pool.json's benchmarked clear times, see speedRating). The
// rating after placement match k is the mean of the k performance ratings so far (so match 1 jumps
// straight to its estimate and later matches average in, up or down), capped at PLACEMENT_CAP: upper
// Platinum / lower Diamond at most; anything higher has to be earned by ordinary Elo afterwards.
var PLACEMENT_CAP = 2500;
var PLACEMENT_SPEED_WEIGHT = 0.5;
var STYLE_DENSITY = { sprint: "0.10", standard: "0.20" }; // the ranked boards' mine densities (RANKED_MODES in ranked.js)
var SPEED_BAND = 300;
var speedCurves = null; // density key → [{ ms, rating }] from slowest to fastest, one point per rating band
function speedCurve(key) {
	if (!speedCurves) {
		speedCurves = {};
		var pool = botPlayer.getPool();
		Object.keys(STYLE_DENSITY).forEach(function(style) {
			var k = STYLE_DENSITY[style], bands = {};
			pool.forEach(function(b) {
				var t = b.times && b.times[k];
				if (typeof b.rating !== "number" || typeof t !== "number" || !(t > 0)) return;
				var band = Math.floor(b.rating / SPEED_BAND);
				(bands[band] = bands[band] || []).push(t);
			});
			var pts = Object.keys(bands).map(function(band) {
				var ts = bands[band].slice().sort(function(a, c) { return a - c; });
				return { rating: band * SPEED_BAND + SPEED_BAND / 2, ms: ts[Math.floor(ts.length / 2)] };
			}).sort(function(a, c) { return c.ms - a.ms; });
			speedCurves[k] = pts;
		});
	}
	return speedCurves[key] || [];
}
// The rating at which pool bots clear this board in `ms`: linear interpolation between the bands' median
// times, clamped to the curve's ends. null without a curve (no pool) so the caller falls back to outcome only.
function speedRating(style, ms) {
	var key = STYLE_DENSITY[style]; if (!key) return null;
	var pts = speedCurve(key); if (pts.length < 2) return null;
	if (ms >= pts[0].ms) return pts[0].rating;
	for (var i = 1; i < pts.length; i++) {
		if (ms >= pts[i].ms) {
			var a = pts[i - 1], b = pts[i], t = (a.ms - ms) / (a.ms - b.ms);
			return a.rating + (b.rating - a.rating) * t;
		}
	}
	return pts[pts.length - 1].rating;
}
// One placement match's performance rating for `p` against `parts` (see above).
function performanceRating(p, parts, style) {
	var sum = 0, n = 0;
	for (var j = 0; j < parts.length; j++) {
		var q = parts[j]; if (q === p) continue;
		var score = p.rank < q.rank ? 1 : p.rank > q.rank ? 0 : 0.5;
		sum += q.rating + 400 * (2 * score - 1); n++;
	}
	if (!n) return p.rating;
	var outcome = sum / n;
	var speed = (typeof p.clearMs === "number" && p.clearMs > 0) ? speedRating(style, p.clearMs) : null;
	return speed == null ? outcome : (1 - PLACEMENT_SPEED_WEIGHT) * outcome + PLACEMENT_SPEED_WEIGHT * speed;
}
// The rating after a placement match: the running mean of the performance ratings so far, capped.
function placementRating(p, parts, style) {
	var k = p.played + 1;
	var mean = (p.rating * p.played + performanceRating(p, parts, style)) / k;
	return Math.round(Math.max(0, Math.min(PLACEMENT_CAP, mean)));
}

// Margin-of-victory: a dominant finish boosts the rating GAIN by up to the style's margin bonus. The
// margin is the gap between this player's progress (avg fraction of board cleared across the series) and
// the best progress among the players they outranked — so clearing far ahead of the next player pays more
// than a photo-finish. Standard rewards blowouts harder (longer games, fewer of them). Progress absent →
// factor 1 (no bonus).
var MARGIN_BONUS = 0.6;
var STANDARD_MARGIN_BONUS = 1.1;
function marginFactor(part, parts, style) {
	if (typeof part.progress !== "number") return 1;
	var below = 0;
	for (var j = 0; j < parts.length; j++) {
		var q = parts[j];
		if (q.rank > part.rank && typeof q.progress === "number" && q.progress > below) below = q.progress;
	}
	var gap = Math.max(0, Math.min(1, part.progress - below));
	var bonus = style === "standard" ? STANDARD_MARGIN_BONUS : MARGIN_BONUS;
	return 1 + bonus * gap;
}

// Read the rating column matching this match's playstyle so Sprint / Standard each evolve
// independently.
function readUserRating(u, style) {
	if (!u) return RANKED_BOT_RATING;
	if (style === "sprint") return u.rating_sprint;
	if (style === "standard") return u.rating_standard;
	// No style → overall is the best rating across modes (there is no legacy `rating` column).
	return Math.max(u.rating_sprint || 0, u.rating_standard || 0);
}

// Compute and apply Elo for a single player against a known set of standings. Used when a
// player bails on a live ranked match early (applyEarlyLeavePenalty, minesweeperServer.js) so
// they get their rating change immediately rather than waiting for the series to finish
// normally. The math is the same pairwise formula as applyRankedElo. Returns the delta info
// (or null if the player isn't a persisted human).
function applyEloForPlayer(targetPid, allParts, style) {
	var target = null;
	for (var i = 0; i < allParts.length; i++) if (allParts[i].id === targetPid) { target = allParts[i]; break; }
	if (!target || target.bot || !target.userId) return null;
	var n = allParts.length;
	if (n < 2) return null;
	var sum = 0;
	for (var j = 0; j < n; j++) {
		var q = allParts[j];
		if (q.id === targetPid) continue;
		var score = target.rank < q.rank ? 1 : target.rank > q.rank ? 0 : 0.5;
		var expected = 1 / (1 + Math.pow(10, (q.rating - target.rating) / 400));
		sum += score - expected;
	}
	var delta = Math.round(kFactor(target.played, style) * sum / Math.sqrt(n - 1));
	var newRating = Math.max(0, target.rating + delta); // Bronze I floors at 0
	if (target.played < PROVISIONAL_GAMES) { newRating = placementRating(target, allParts, style); delta = newRating - target.rating; } // placement: the performance estimate (a walk-out is a loss to everyone)
	var provisional = (target.played + 1) < PROVISIONAL_GAMES;
	db.updateRating(target.userId, newRating, target.rank === 1, style);
	db.recordMatch({
		userId: target.userId, style: style, ratingBefore: target.rating, ratingAfter: newRating,
		placement: target.rank, players: n, won: target.rank === 1, opponent: null
	});
	if (accounts[targetPid]) {
		// Cache the style-specific rating on the in-memory account so the
		// lobby tile updates the right tier badge.
		if (style === "sprint") accounts[targetPid].ratingSprint = newRating;
		else if (style === "standard") accounts[targetPid].ratingStandard = newRating;
		accounts[targetPid].played = (accounts[targetPid].played || 0) + 1;
		if (style === "sprint") accounts[targetPid].playedSprint = target.played + 1;
		else if (style === "standard") accounts[targetPid].playedStandard = target.played + 1;
	}
	return { delta: delta, newRating: newRating, provisional: provisional };
}

// PURE pairwise-Elo math (P0-4): given the match `parts` — one per player, each
// { rank, rating, progress, bot, userId, played, streak? } — fill in { delta, newRating, provisional } for
// every persisted human and return the same array. Each pair of players is a mini-match; a player's
// delta is K * mean(score - expected) across opponents (so a round's swing stays ~K regardless of
// lobby size). No db, no appState, no sockets — `ratings before` and `played` are inputs, so this is
// unit-testable in isolation and is the computation the future game-server→main boundary would run.
// (Depends only on the injected PROVISIONAL_GAMES and the pure kFactor/marginFactor helpers.)
function computeRankedElo(parts, style) {
	var n = parts.length;
	for (var i = 0; i < n; i++) {
		var p = parts[i];
		p.delta = null; p.newRating = null; p.provisional = false;
		if (n < 2 || (!p.bot && !p.userId)) continue;
		if (!p.bot && p.played < PROVISIONAL_GAMES) {
			// Placement: the performance estimate replaces the pairwise step (no streak / margin bonuses: the
			// estimate already reads the result and the speed).
			p.newRating = placementRating(p, parts, style);
			p.delta = p.newRating - p.rating;
			p.provisional = (p.played + 1) < PROVISIONAL_GAMES;
			continue;
		}
		var sum = 0;
		for (var j = 0; j < n; j++) {
			if (i === j) continue;
			var q = parts[j];
			var score = p.rank < q.rank ? 1 : p.rank > q.rank ? 0 : 0.5;
			var expected = 1 / (1 + Math.pow(10, (q.rating - p.rating) / 400));
			sum += score - expected;
		}
		// Normalize by sqrt(n-1) instead of (n-1) so beating more opponents pays
		// more: 1v1 top spot ~K/2; 6-player top spot ~K*sqrt(5)/2 ≈ 2.2× as much.
		var delta = kFactor(p.bot ? BOT_SETTLED_PLAYED : p.played, style) * sum / Math.sqrt(n - 1);
		// Win-streak bonus (humans only; `streak` = wins in a row BEFORE this match, this win extends it).
		if (!p.bot && p.rank === 1 && delta > 0) {
			var mult = streakMultiplier((p.streak || 0) + 1);
			if (mult > 1) delta += (mult - 1) * settledK(style) * sum / Math.sqrt(n - 1);
		}
		// Reward dominant wins: scale a positive swing by how far ahead of the field you finished.
		if (delta > 0) delta *= marginFactor(p, parts, style);
		p.delta = Math.round(delta);
		p.newRating = Math.max(0, p.rating + p.delta); // Bronze I floors at 0
		p.provisional = p.bot ? false : (p.played + 1) < PROVISIONAL_GAMES;
	}
	return parts;
}

// Apply pairwise Elo over a round's standings: gather each player's rating-before/played (db + the
// in-memory caches), run the pure computeRankedElo, then persist (updateRating + recordMatch) and sync
// the cache + mutate the human standings entries with ratingDelta/rating/provisional for the client.
function applyRankedElo(standings, style) {
	var parts = standings.map(function(s) {
		var bot = isBot(s.id);
		var acc = accounts[s.id];
		var rating = bot ? (botRating[s.id] || RANKED_BOT_RATING) : RANKED_BOT_RATING, userId = bot ? (botUserIds[s.id] || null) : null, played = 0;
		if (!bot && acc) {
			var u = db.getUserById(acc.userId);
			if (u) { rating = readUserRating(u, style); userId = acc.userId; played = db.playedByStyle(u.id, u.played || 0)[style]; } // games on THIS ladder
		}
		return { rank: s.rank, rating: rating, progress: s.progress, clearMs: s.clearMs, bot: bot, userId: userId, played: played,
			streak: userId ? db.currentWinStreak(userId) : 0, delta: null, newRating: null, provisional: false };
	});
	var n = parts.length;
	if (n < 2) return;
	computeRankedElo(parts, style); // pure math — fills delta/newRating/provisional
	var localUserId = function(s) { return isBot(s.id) ? botUserIds[s.id] : (accounts[s.id] && accounts[s.id].userId); };
	for (var i = 0; i < n; i++) {
		var p = parts[i];
		if (!p.userId) continue;   // a bot without a profile (casual-room bot): nothing to persist
		// A pool bot's profile takes the result like a player's: its rating moves with the same delta and its
		// match is recorded, so its profile shows a real history. (The rating the math used is still its pool
		// benchmark, read from botRating above; the profile's rating is what it shows the world.)
		db.updateRating(p.userId, p.newRating, p.rank === 1, style);
		// Record the match for the profile rating graph + recent-games list. In 1v1 the opponent
		// is the other standing; bigger lobbies have no single opponent label.
		db.recordMatch({
			userId: p.userId, style: style, ratingBefore: p.rating, ratingAfter: p.newRating,
			placement: p.rank, players: n, won: p.rank === 1,
			opponent: (n === 2 && standings[1 - i]) ? standings[1 - i].name : null,
			opponents: opponentsOf(standings, i, localUserId)
		});
	}
	for (var k = 0; k < standings.length; k++) {
		// Bots get the same two display fields (never persisted) so a result card cannot be read for who is human.
		if (parts[k].bot) { standings[k].ratingDelta = parts[k].delta; standings[k].rating = parts[k].newRating; standings[k].provisional = false; }
		if (!parts[k].bot && parts[k].userId) {
			standings[k].ratingDelta = parts[k].delta;
			standings[k].rating = parts[k].newRating;
			standings[k].provisional = parts[k].provisional;
			standings[k].played = parts[k].played + 1; // games played after this one: the result panel's placement dots
			// Keep the in-memory cache in sync with what we just persisted.
			if (accounts[standings[k].id]) {
				var acc = accounts[standings[k].id];
				if (style === "sprint") acc.ratingSprint = parts[k].newRating;
				else if (style === "standard") acc.ratingStandard = parts[k].newRating;
				acc.played = (acc.played || 0) + 1;
				if (style === "sprint") acc.playedSprint = parts[k].played + 1;
				else if (style === "standard") acc.playedStandard = parts[k].played + 1;
			}
		}
	}
}

// Apply Elo from a result report that arrived OVER THE NETWORK (from a game server). Unlike
// applyRankedElo, it can't read the in-memory accounts cache (those sockets live on the game server),
// so each standing carries its own userId + rating-before + played, captured at match start. The pure
// computeRankedElo does the math; we persist by userId. (P1-5 Elo-from-report.)
//
// Mutates `standings` in place with ratingDelta/rating/provisional for every human entry, mirroring
// applyRankedElo's contract — the game server awaits this call (see reportResultToMain/gameService.
// reportResult) specifically so it can relay the computed numbers back to the client's series_ended
// event instead of showing the stale pre-match rating as both "before" and "after".
function applyRankedEloFromReport(standings, style) {
	if (!standings || standings.length < 2) return;
	var parts = standings.map(function(s) {
		return {
			rank: s.rank,
			rating: (typeof s.ratingBefore === "number") ? s.ratingBefore : RANKED_BOT_RATING,
			progress: s.progress,
			clearMs: s.clearMs,
			bot: s.isBot != null ? !!s.isBot : !s.userId,   // older game servers send no flag: then no id means a bot
			userId: s.userId || null,
			played: s.played || 0,
			streak: (s.userId && !s.isBot) ? db.currentWinStreak(s.userId) : 0
		};
	});
	computeRankedElo(parts, style);
	var wireUserId = function(s) { return s.userId; };
	for (var i = 0; i < parts.length; i++) {
		var p = parts[i];
		if (p.userId) {
			db.updateRating(p.userId, p.newRating, p.rank === 1, style);
			db.recordMatch({
				userId: p.userId, style: style, ratingBefore: p.rating, ratingAfter: p.newRating,
				placement: p.rank, players: parts.length, won: p.rank === 1,
				opponent: (parts.length === 2 && standings[1 - i]) ? standings[1 - i].name : null,
				opponents: opponentsOf(standings, i, wireUserId)
			});
		}
		standings[i].ratingDelta = p.delta;
		standings[i].rating = p.newRating;
		if (p.bot) { standings[i].provisional = false; continue; }   // a bot's display fields only (see BOT_SETTLED_PLAYED)
		standings[i].provisional = p.provisional;
		standings[i].played = p.played + 1;
	}
}

// An early leave reported OVER THE NETWORK by a game server (the split deployment): the leaver's seat
// (userId / rating-before / games played on this ladder) and the others' seats, the leaver pinned at the
// worst rank. The same pairwise math as applyEloForPlayer; only the leaver is persisted — the others get
// their Elo at series end as usual. Returns { delta, newRating, provisional } or null for a bad payload.
function applyLeaveFromReport(leaver, others, style) {
	if (!leaver || leaver.userId == null || !Array.isArray(others) || !others.length) return null;
	var parts = [{ rank: others.length + 1, rating: (typeof leaver.ratingBefore === "number") ? leaver.ratingBefore : RANKED_BOT_RATING, bot: false, userId: leaver.userId, played: leaver.played || 0, streak: 0 }];
	others.forEach(function(o, i) {
		parts.push({ rank: typeof o.rank === "number" ? o.rank : i + 1, rating: (typeof o.ratingBefore === "number") ? o.ratingBefore : RANKED_BOT_RATING, bot: o.isBot != null ? !!o.isBot : !o.userId, userId: o.userId || null, played: o.played || 0, streak: 0 });
	});
	computeRankedElo(parts, style);
	var p = parts[0];
	if (typeof p.newRating !== "number") return null;
	db.updateRating(leaver.userId, p.newRating, false, style);
	db.recordMatch({ userId: leaver.userId, style: style, ratingBefore: p.rating, ratingAfter: p.newRating, placement: p.rank, players: parts.length, won: false, opponent: (others.length === 1 && others[0].name) || null });
	return { delta: p.delta, newRating: p.newRating, provisional: p.provisional };
}

module.exports = {
	init: init,
	applyLeaveFromReport: applyLeaveFromReport,
	readUserRating: readUserRating,
	applyEloForPlayer: applyEloForPlayer,
	computeRankedElo: computeRankedElo,
	streakMultiplier: streakMultiplier,
	applyRankedElo: applyRankedElo,
	applyRankedEloFromReport: applyRankedEloFromReport,
	speedRating: speedRating,
	performanceRating: performanceRating,
	PLACEMENT_CAP: PLACEMENT_CAP
};
