// Achievements: a data-driven catalogue evaluated against a flat metrics bag (the account payload
// merged with the server's achievementStats aggregates). Two shapes: TIERED counters and BOOLEAN
// checks. Rank and streak entries read peak/best metrics so they never un-earn.
import { tierFor } from "./ranking";

type Metrics = Record<string, any>;
interface TieredDef { icon: string; name: string; value: (m: Metrics) => number; tiers: number[]; desc: (t: number) => string; }
interface BoolDef { icon: string; name: string; bool: (m: Metrics) => boolean; progress: (m: Metrics) => string; desc: () => string; }
type AchDef = TieredDef | BoolDef;
export interface Computed { icon: string; name: string; desc: string; unlocked: boolean; complete: boolean; reached: number; tierCount: number; frac: number; progText: string; }

const ROMAN = ["", "I", "II", "III", "IV", "V"];
const achTierName = (rating: number) => tierFor(rating).name.replace(/ I+$/, "");
const modeWins = (m: Metrics, s: string) => (m.perModeWins && m.perModeWins[s]) || 0;
const peakOf = (m: Metrics, s: string) => (m.peak && m.peak[s]) || m["rating" + s.charAt(0).toUpperCase() + s.slice(1)] || 0;
const peakOverallOf = (m: Metrics) => (m.peak && m.peak.overall) || Math.max(m.ratingSprint || 0, m.ratingStandard || 0);
function minSolo(m: Metrics, sizePrefix?: string) { const b = m.soloBests; let min = Infinity; if (b) for (const k of Object.keys(b)) if ((!sizePrefix || k.indexOf(sizePrefix + "_") === 0) && b[k] < min) min = b[k]; return min; }
function fmtSec(ms: number) { const s = ms / 1000, m = Math.floor(s / 60), r = s - m * 60; return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1); }

export const ACHIEVEMENTS: AchDef[] = [
	{ icon: "🏆", name: "Victories", value: m => m.wins || 0, tiers: [1, 10, 50, 250, 1000], desc: t => "Win " + t + " ranked match" + (t > 1 ? "es" : "") },
	{ icon: "🛡️", name: "Battle-tested", value: m => m.played || 0, tiers: [10, 50, 200, 1000, 5000], desc: t => "Play " + t + " ranked matches" },
	{ icon: "🎯", name: "Specialist", value: m => m.maxModeWins || 0, tiers: [25, 100, 500], desc: t => "Win " + t + " matches in a single mode" },
	{ icon: "⚔️", name: "Two-Sport Star", bool: m => modeWins(m, "sprint") > 0 && modeWins(m, "standard") > 0, progress: m => ((modeWins(m, "sprint") > 0 ? 1 : 0) + (modeWins(m, "standard") > 0 ? 1 : 0)) + " / 2 modes", desc: () => "Win in both Sprint and Standard" },
	{ icon: "📈", name: "Ascendant", value: m => peakOverallOf(m), tiers: [600, 1200, 1800, 2400, 3000], desc: t => "Reach " + achTierName(t) + " (" + t + ")" },
	{ icon: "🌟", name: "Well-rounded", bool: m => peakOf(m, "sprint") >= 1200 && peakOf(m, "standard") >= 1200, progress: m => ((peakOf(m, "sprint") >= 1200 ? 1 : 0) + (peakOf(m, "standard") >= 1200 ? 1 : 0)) + " / 2 at Gold", desc: () => "Reach Gold in both Sprint and Standard" },
	{ icon: "🔥", name: "On Fire", value: m => m.winStreakBest || 0, tiers: [3, 5, 10, 20], desc: t => "Win " + t + " matches in a row" },
	{ icon: "🌀", name: "Grinder", value: m => m.bestDayWins || 0, tiers: [5, 10, 20], desc: t => "Win " + t + " matches in one day" },
	{ icon: "⚡", name: "Surge", value: m => m.bestDayGain || 0, tiers: [150, 300, 500], desc: t => "Climb +" + t + " rating in one day" },
	{ icon: "💥", name: "Big Swing", value: m => m.bigSwing || 0, tiers: [40, 80, 120], desc: t => "Gain +" + t + " from a single match" },
	{ icon: "🤺", name: "Duelist", value: m => m.wins1v1 || 0, tiers: [10, 50, 200, 1000], desc: t => "Win " + t + " 1v1 matches" },
	{ icon: "👑", name: "Free-for-all King", value: m => m.wins6p || 0, tiers: [1, 10, 50], desc: t => t === 1 ? "Win a 7-player free-for-all" : "Win " + t + " 7-player free-for-alls" },
	{ icon: "🧠", name: "No Flags", value: m => m.noFlagClears || 0, tiers: [1, 10, 50], desc: t => t === 1 ? "Clear a board without placing a flag" : "Clear " + t + " boards without a flag" },
	{ icon: "🎹", name: "Chord Master", value: m => m.noRevealClears || 0, tiers: [1, 10, 50], desc: t => t === 1 ? "Clear a board without a left-click (chords only)" : "Clear " + t + " boards chord-only" },
	{ icon: "🎖️", name: "Sharpshooter", bool: m => (m.played || 0) >= 20 && (m.wins || 0) / (m.played || 1) >= 0.6, progress: m => { const p = m.played || 0; return p >= 20 ? Math.round((m.wins || 0) / p * 100) + "% win rate" : p + " / 20 matches"; }, desc: () => "60%+ win rate over 20+ matches" },
	{ icon: "⏱️", name: "Sub-minute", bool: m => minSolo(m) < 60000, progress: m => { const v = minSolo(m); return isFinite(v) ? "best " + fmtSec(v) : "no clears yet"; }, desc: () => "Clear any free-play board under 1:00" },
	{ icon: "🚀", name: "Quick Sweep", bool: m => minSolo(m, "small") < 30000, progress: m => { const v = minSolo(m, "small"); return isFinite(v) ? "best " + fmtSec(v) : "no Small clears"; }, desc: () => "Clear a Small board under 0:30" },
	{ icon: "🧭", name: "Free Spirit", value: m => m.soloBests ? Object.keys(m.soloBests).length : 0, tiers: [1, 5, 9], desc: t => t >= 9 ? "Clear all 9 free-play boards" : "Clear " + t + " free-play board" + (t > 1 ? "s" : "") },
	{ icon: "🧩", name: "Deductionist", value: m => m.puzzlesSolved || 0, tiers: [10, 100, 500, 2000, 5000], desc: t => "Solve " + t + " puzzles" },
	{ icon: "🧠", name: "Puzzle Rank", value: m => Math.max(m.peakPuzzleRating || 0, m.puzzleRating || 0), tiers: [1000, 1500, 2000, 2500], desc: t => "Reach a puzzle rating of " + t },
	{ icon: "🎲", name: "On a Roll", value: m => m.streakBest || 0, tiers: [5, 10, 25, 50], desc: t => "Hit an " + t + "-puzzle streak" },
	{ icon: "⛈️", name: "Time Trial Ace", value: m => m.stormBest || 0, tiers: [15, 30, 50, 75], desc: t => "Solve " + t + " in one Time Trial run" },
	{ icon: "📅", name: "Daily Devotee", value: m => Math.max(m.dailyStreakBest || 0, m.dailyStreak || 0), tiers: [3, 7, 30, 100], desc: t => "Reach a " + t + "-day daily streak" },
	{ icon: "🗓️", name: "Daily Regular", value: m => m.dailiesSolved || 0, tiers: [10, 50, 200, 500], desc: t => "Solve " + t + " daily puzzles" },
	{ icon: "🎂", name: "Veteran", value: m => m.createdAt ? Math.floor((Date.now() - new Date(m.createdAt).getTime()) / 86400000) : 0, tiers: [30, 180, 365, 730], desc: t => "Be a member for " + t + " days" },
	{ icon: "📆", name: "Regular", value: m => m.distinctDays || 0, tiers: [7, 30, 100, 365], desc: t => "Play on " + t + " different days" },
	{ icon: "🌐", name: "Tried It All", bool: m => (m.played || 0) > 0 && (m.puzzlesAttempted || 0) > 0 && !!m.soloBests && Object.keys(m.soloBests).length > 0, progress: m => (((m.played || 0) > 0 ? 1 : 0) + ((m.puzzlesAttempted || 0) > 0 ? 1 : 0) + (m.soloBests && Object.keys(m.soloBests).length > 0 ? 1 : 0)) + " / 3 modes", desc: () => "Play ranked, puzzles and free play" }
];

export function computeTiered(icon: string, name: string, value: number, tiers: number[], descFn: (t: number) => string): Computed {
	let reached = 0;
	for (const t of tiers) if (value >= t) reached++;
	const maxed = reached >= tiers.length, next = maxed ? tiers[tiers.length - 1] : tiers[reached];
	return { icon, name: name + (tiers.length > 1 && reached > 0 ? " " + ROMAN[reached] : ""), desc: descFn(next), unlocked: reached > 0, complete: maxed, reached, tierCount: tiers.length, frac: maxed ? 1 : (next ? Math.min(1, value / next) : 1), progText: maxed ? "Complete" : Math.round(value) + " / " + next };
}
export function computeAchievement(a: AchDef, m: Metrics): Computed {
	if ("tiers" in a) return computeTiered(a.icon, a.name, a.value(m), a.tiers, a.desc);
	const on = a.bool(m);
	return { icon: a.icon, name: a.name, desc: a.desc(), unlocked: on, complete: on, reached: on ? 1 : 0, tierCount: 1, frac: on ? 1 : 0, progText: on ? "Unlocked" : a.progress(m) };
}
// Every achievement plus the meta Collector (distinct achievements unlocked).
export function computeAll(metrics: Metrics): Computed[] {
	const computed = ACHIEVEMENTS.map(a => computeAchievement(a, metrics));
	const unlockedCount = computed.filter(c => c.unlocked).length;
	computed.push(computeTiered("🏅", "Collector", unlockedCount, [10, 20, ACHIEVEMENTS.length], t => "Unlock " + t + " achievements"));
	return computed;
}
