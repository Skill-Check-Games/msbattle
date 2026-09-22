// Persistent identities for ranked pool bots. The first time a pool bot is used it gets a users row (is_bot):
// a generated name, flag and avatar it keeps from then on, and per-style ratings seeded from its benchmark
// Elo. From there it accrues match history and wins like any player, so its profile can be opened from a
// result, a replay or a match list. Keyed by the bot's AI knobs (BotPlayer.botKeyOf), so the same pool entry
// maps to the same profile across restarts and pool regenerations that keep its numbers. Casual-room bots
// (no pool config) stay transient and get no profile.
var db = require("../db");
var botPlayer = require("core/src/engine/BotPlayer");

var cache = {};   // botKey -> { id, name, country, avatar }

function ratingFor(config, densityKey) {
	if (config && config.ratings && typeof config.ratings[densityKey] === "number") return config.ratings[densityKey];
	return (config && typeof config.rating === "number") ? config.rating : 0;
}

function ensure(config) {
	if (!config) return null;
	var key = botPlayer.botKeyOf(config);
	if (cache[key]) return cache[key];
	var existing = db.getBotUserByKey(key);
	if (!existing) {
		var identity = {
			name: botPlayer.pickBotName(db.botNames()),
			country: botPlayer.pickBotCountry(),
			avatar: botPlayer.pickBotAvatar(),
			ratingSprint: ratingFor(config, "0.10"),     // Sprint plays 10% mines, Standard 20% (the pool benchmarks both)
			ratingStandard: ratingFor(config, "0.20")
		};
		existing = db.ensureBotUser(key, identity);
	}
	var prof = { id: existing.id, name: existing.name, country: existing.country || null, avatar: existing.avatar_color || null };
	cache[key] = prof;
	return prof;
}

module.exports = { ensure: ensure };
