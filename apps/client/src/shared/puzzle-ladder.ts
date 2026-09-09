// Puzzle Ladder: a monotonic points progression (points only ever go up, awarded server-side on a
// rated solve). 8 tiers x 20 levels x 50 points per level, all tunable here.
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
const LEVELS_PER_TIER = 20;
const POINTS_PER_LEVEL = 50;
const MAX_LEVEL = PUZZLE_TIERS.length * LEVELS_PER_TIER;

export interface PuzzleLadderInfo {
	points: number; tierIndex: number; tierName: string; tierColor: string;
	level: number; atMax: boolean; pointsPerLevel: number; pointsIntoLevel: number; levelPct: number;
}

export function puzzleLadder(points: number): PuzzleLadderInfo {
	points = Math.max(0, Math.round(points || 0));
	const levelGlobal = Math.floor(points / POINTS_PER_LEVEL);
	const atMax = levelGlobal >= MAX_LEVEL;
	const tierIndex = atMax ? PUZZLE_TIERS.length - 1 : Math.floor(levelGlobal / LEVELS_PER_TIER);
	const levelInTier = atMax ? LEVELS_PER_TIER : (levelGlobal % LEVELS_PER_TIER);
	const tier = PUZZLE_TIERS[tierIndex];
	const into = points - levelGlobal * POINTS_PER_LEVEL;
	return {
		points, tierIndex, tierName: tier.name, tierColor: tier.color,
		level: atMax ? LEVELS_PER_TIER : levelInTier + 1, atMax,
		pointsPerLevel: POINTS_PER_LEVEL, pointsIntoLevel: atMax ? POINTS_PER_LEVEL : into,
		levelPct: atMax ? 100 : Math.round(into / POINTS_PER_LEVEL * 100)
	};
}

export function puzzleLadderLabel(points: number): string {
	const l = puzzleLadder(points);
	return l.tierName + " · " + (l.atMax ? "Max" : "Lvl " + l.level);
}
