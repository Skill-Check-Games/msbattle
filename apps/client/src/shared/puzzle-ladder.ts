// Puzzle Ladder: the rank is read straight off the player's puzzle rating (Elo against the puzzles), so it
// moves both ways. 8 tiers x 3 levels (I, II, III), each level RATING_PER_LEVEL wide from PUZZLE_RANK_BASE.
// Anything below the base still shows as Recruit I; Grandmaster III is open-ended.
export const PUZZLE_TIERS = [
	{ name: "Recruit",       color: "#9aa3ad" },
	{ name: "Scout",         color: "#8fbf6f" },
	{ name: "Sapper",        color: "#c8a96a" },
	{ name: "Engineer",      color: "#f0a13a" },
	{ name: "Specialist",    color: "#e5673f" },
	{ name: "Demolitionist", color: "#e0405f" },
	{ name: "Bomb Squad",    color: "#d048c8" },
	{ name: "Grandmaster",   color: "#eaf2ff" }
];
export const LEVELS_PER_TIER = 3;
export const RATING_PER_LEVEL = 100;
export const PUZZLE_RANK_BASE = 400; // = the pool's rating floor; new players start just above it
export const LEVEL_NUMERALS = ["I", "II", "III"];
const MAX_LEVEL = PUZZLE_TIERS.length * LEVELS_PER_TIER;

export interface PuzzleLadderInfo {
	rating: number; tierIndex: number; tierName: string; tierColor: string;
	level: number; levelLabel: string; atMax: boolean;
	ratingPerLevel: number; ratingIntoLevel: number; levelPct: number; nextLevelAt: number | null;
}

export function puzzleLadder(rating: number): PuzzleLadderInfo {
	rating = Math.round(rating || 0);
	const levelGlobal = Math.max(0, Math.min(MAX_LEVEL - 1, Math.floor((rating - PUZZLE_RANK_BASE) / RATING_PER_LEVEL)));
	const tierIndex = Math.floor(levelGlobal / LEVELS_PER_TIER);
	const levelInTier = levelGlobal % LEVELS_PER_TIER;
	const atMax = levelGlobal === MAX_LEVEL - 1;
	const levelStart = PUZZLE_RANK_BASE + levelGlobal * RATING_PER_LEVEL;
	const into = Math.max(0, Math.min(RATING_PER_LEVEL, rating - levelStart));
	const tier = PUZZLE_TIERS[tierIndex];
	return {
		rating, tierIndex, tierName: tier.name, tierColor: tier.color,
		level: levelInTier + 1, levelLabel: LEVEL_NUMERALS[levelInTier], atMax,
		ratingPerLevel: RATING_PER_LEVEL, ratingIntoLevel: atMax ? RATING_PER_LEVEL : into,
		levelPct: atMax ? 100 : Math.round(into / RATING_PER_LEVEL * 100),
		nextLevelAt: atMax ? null : levelStart + RATING_PER_LEVEL
	};
}

// The rating at which a player is exactly at the start of `level` (1-based) of tier `tierIndex`.
export function ratingForTierLevel(tierIndex: number, level: number): number {
	const t = Math.min(PUZZLE_TIERS.length - 1, Math.max(0, tierIndex));
	const l = Math.min(LEVELS_PER_TIER, Math.max(1, level));
	return PUZZLE_RANK_BASE + (t * LEVELS_PER_TIER + (l - 1)) * RATING_PER_LEVEL;
}

export function puzzleLadderLabel(rating: number): string {
	const l = puzzleLadder(rating);
	return l.tierName + " " + l.levelLabel;
}
