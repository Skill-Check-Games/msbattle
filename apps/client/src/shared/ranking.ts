// Ranked tiers and the badge artwork. Ratings run 0 -> 3000+, 200 per sub-tier, five bands of
// three sub-tiers, then Master. Badges are SVG strings (rendered via RankBadge.tsx); their colours
// come from the .rank-badge.tier-* custom properties in styles/badges.scss.
import { puzzleLadder } from "./puzzle-ladder";

export const TIER_BANDS = [
	{ name: "Bronze",   color: "#d08b5b" },
	{ name: "Silver",   color: "#cbd5e1" },
	{ name: "Gold",     color: "#fbbf24" },
	{ name: "Platinum", color: "#5eead4" },
	{ name: "Diamond",  color: "#60a5fa" }
];
export const TIER_BASE_RATING = 0;
export const SUB_TIER_WIDTH = 200;
export const SUB_TIERS_PER_TIER = 3;
export const SUB_TIER_NUMERALS = ["I", "II", "III"];
export const MASTER_THRESHOLD = TIER_BASE_RATING + TIER_BANDS.length * SUB_TIERS_PER_TIER * SUB_TIER_WIDTH;

export function tierFor(rating: number, _provisional?: boolean): { name: string; color: string } {
	if (rating >= MASTER_THRESHOLD) return { name: "Master", color: "#c084fc" };
	const clamped = rating < TIER_BASE_RATING ? TIER_BASE_RATING : rating;
	const subIdx = Math.floor((clamped - TIER_BASE_RATING) / SUB_TIER_WIDTH);
	const tierIdx = Math.min(TIER_BANDS.length - 1, Math.floor(subIdx / SUB_TIERS_PER_TIER));
	const t = TIER_BANDS[tierIdx];
	return { name: t.name + " " + SUB_TIER_NUMERALS[subIdx % SUB_TIERS_PER_TIER], color: t.color };
}

export function overallRating(account: { ratingSprint?: number; ratingStandard?: number } | null): number {
	if (!account) return 0;
	return Math.max(account.ratingSprint || 0, account.ratingStandard || 0);
}

export function rankIconFor(rating: number): { tierClass: string; subNum: string | null; label: string } {
	if (rating >= MASTER_THRESHOLD) return { tierClass: "master", subNum: null, label: "Master" };
	const clamped = rating < TIER_BASE_RATING ? TIER_BASE_RATING : rating;
	const subIdx = Math.floor((clamped - TIER_BASE_RATING) / SUB_TIER_WIDTH);
	const tierIdx = Math.min(TIER_BANDS.length - 1, Math.floor(subIdx / SUB_TIERS_PER_TIER));
	const t = TIER_BANDS[tierIdx];
	return { tierClass: t.name.toLowerCase(), subNum: SUB_TIER_NUMERALS[subIdx % SUB_TIERS_PER_TIER], label: t.name };
}

// ---- ranked hexagon emblem ----
const RANK_HEX_PTS = "50,15 85,34 85,72 50,91 15,72 15,34";
function rankHexSVG() {
	return '<polygon class="rank-hex-fill" points="' + RANK_HEX_PTS + '"/><polygon class="rank-hex-rim" points="' + RANK_HEX_PTS + '"/>';
}
function rankHexChevrons(n: number, grad: string) {
	const w = 38, rise = 6.5, thick = 5, gap = 1.6, h = rise + thick;
	const total = n * h + (n - 1) * gap, y0 = 53 - total / 2, x0 = 50 - w / 2;
	let p = "";
	for (let i = 0; i < n; i++) {
		const y = y0 + i * (h + gap);
		const pts = [
			50 + "," + y.toFixed(1), (x0 + w) + "," + (y + rise).toFixed(1), (x0 + w) + "," + (y + rise + thick).toFixed(1),
			50 + "," + (y + thick).toFixed(1), x0 + "," + (y + rise + thick).toFixed(1), x0 + "," + (y + rise).toFixed(1)
		];
		p += '<polygon points="' + pts.join(" ") + '" fill="url(#' + grad + ')"/>';
	}
	return p;
}
function rankHexStarSVG(grad: string) {
	const pts: string[] = [], cx = 50, cy = 53, ro = 19, ri = 8;
	for (let k = 0; k < 10; k++) {
		const a = (-90 + k * 36) * Math.PI / 180, r = (k % 2) ? ri : ro;
		pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1));
	}
	return '<polygon points="' + pts.join(" ") + '" fill="url(#' + grad + ')"/>';
}
let rankGradSeq = 0;
export function rankEmblemSVG(rating: number): { tierClass: string; svg: string } {
	const info = rankIconFor(rating);
	const isMaster = info.tierClass === "master";
	const subN = info.subNum ? Math.max(1, SUB_TIER_NUMERALS.indexOf(info.subNum) + 1) : 3;
	const grad = "rg" + (++rankGradSeq);
	// Matte: a one-colour gradient (kept as a gradient so the id plumbing stays uniform).
	let svg = '<svg class="rank-emblem" viewBox="0 0 100 100" aria-hidden="true">';
	svg += '<defs><linearGradient id="' + grad + '" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" style="stop-color:var(--rb-c2)"/><stop offset="1" style="stop-color:var(--rb-c2)"/></linearGradient></defs>';
	svg += rankHexSVG();
	svg += isMaster ? rankHexStarSVG(grad) : rankHexChevrons(subN, grad);
	svg += "</svg>";
	return { tierClass: info.tierClass, svg };
}

const LOCK = '<rect x="38" y="50" width="24" height="18" rx="4" fill="currentColor"/><path d="M43 50 V44 a7 7 0 0 1 14 0 V50" fill="none" stroke="currentColor" stroke-width="4.5"/>';
// Placement: the hexagon plate as a dashed outline with a padlock, until the first placement matches are played.
export function placementBadgeSVG(): string {
	return '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="' + RANK_HEX_PTS + '" fill="rgba(255,255,255,0.03)" stroke="currentColor" stroke-width="4" stroke-dasharray="7 6" stroke-linejoin="round"/>' + LOCK + "</svg>";
}
// Puzzle Ladder counterpart: a dashed circle with the padlock, before the first rated solve.
export function puzzleLockedBadgeSVG(): string {
	return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="53" r="36" fill="rgba(255,255,255,0.03)" stroke="currentColor" stroke-width="4" stroke-dasharray="7 6"/>' + LOCK + "</svg>";
}

// ---- Puzzle Ladder medal: a roundel of eight rim segments (tier N lights N) and a per-tier emblem ----
const PUZZLE_BADGE_DARK = "var(--surface, #131a2e)";
const puzzleBadgeParts = (() => {
	const S = (d: string, w?: number, extra?: string) => '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + (w || 3.5) + '" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + "/>";
	const F = (d: string) => '<path d="' + d + '" fill="currentColor"/>';
	const C = (x: number | string, y: number | string, r: number, fill?: boolean, sw?: number) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" ' + (fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="' + (sw || 3.5) + '"') + "/>";
	const R = (x: number, y: number, w: number, h: number, rx: number) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx + '" fill="currentColor"/>';
	const D = (x: number, y: number, r: number) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + PUZZLE_BADGE_DARK + '"/>';
	function spikes(r: number, len: number, sw: number) {
		let out = '<g stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round">';
		for (let i = 0; i < 8; i++) {
			const a = i * Math.PI / 4;
			out += '<path d="M' + (50 + Math.cos(a) * (r + 3)).toFixed(1) + " " + (52 + Math.sin(a) * (r + 3)).toFixed(1) + " L" + (50 + Math.cos(a) * (r + 3 + len)).toFixed(1) + " " + (52 + Math.sin(a) * (r + 3 + len)).toFixed(1) + '"/>';
		}
		return out + "</g>";
	}
	function knobs(r: number, len: number, sw: number, kr: number) {
		let out = spikes(r, len, sw);
		for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; out += C((50 + Math.cos(a) * (r + 3 + len)).toFixed(1), (52 + Math.sin(a) * (r + 3 + len)).toFixed(1), kr, true); }
		return out;
	}
	function star(r: number, cx: number, cy: number) {
		const pts: string[] = [];
		for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.46 : r; pts.push((cx + Math.cos(a) * rr).toFixed(1) + "," + (cy + Math.sin(a) * rr).toFixed(1)); }
		return '<polygon points="' + pts.join(" ") + '" fill="currentColor"/>';
	}
	const shrink = (inner: string, k: number) => '<g transform="translate(50 52) scale(' + k + ') translate(-50 -52)">' + inner + "</g>";
	const magnifier = C(46, 47, 12) + S("M40 43 A8 8 0 0 1 46 39", 2.5) + S("M55 56 L67 68", 5);
	const shovel = S("M50 32.4 V55.8", 4) + S("M41.9 32.4 H58.1", 4) + F("M39.2 55.8 H60.8 L59 70.2 Q50 75.6 41 70.2 Z");
	const claymore = F("M30 45 Q50 36 70 45 V60 Q50 51 30 60 Z") + '<path d="M33 53 Q50 45.5 67 53" fill="none" stroke="' + PUZZLE_BADGE_DARK + '" stroke-width="1.6"/>' + R(46, 36, 8, 5, 1.5) + S("M38 60 L34 72", 3.5) + S("M62 60 L66 72", 3.5);
	const seaOutline = C(50, 52, 11) + knobs(11, 3.5, 3, 2);
	const dynamite = R(37, 44, 8, 26, 3) + R(46, 44, 8, 26, 3) + R(55, 44, 8, 26, 3) + '<rect x="35" y="54" width="30" height="5" fill="' + PUZZLE_BADGE_DARK + '"/>' + S("M52 44 Q56 36 62 34", 2.5) + star(4.5, 64, 33);
	const seaSolid = C(50, 52, 12, true) + spikes(12, 5.5, 4) + D(45.4, 47.4, 3.1);
	const ring = (r: number, op: string) => C(50, 52, r, false, 2.5).replace('stroke-width="2.5"', 'stroke-width="2.5" opacity="' + op + '"');
	const radar = ring(21, "0.45") + ring(14, "0.6") + ring(7, "0.8") + F("M50 52 L50 29 A23 23 0 0 1 70 41 Z") + C(50, 52, 3, true) + C(40, 40, 2.4, true) + C(59, 63, 2.4, true);
	const EMBLEMS = ["", shrink(magnifier, 0.92), shovel, '<g transform="translate(0 -0.5)">' + shrink(claymore, 0.92) + "</g>", shrink(seaOutline, 0.92), shrink(dynamite, 0.92), shrink(seaSolid, 0.92), radar];
	function roundel(lit: number) {
		let out = '<circle cx="50" cy="52" r="40" fill="' + PUZZLE_BADGE_DARK + '"/><g stroke="currentColor" stroke-width="6" fill="none">';
		for (let i = 0; i < 8; i++) {
			const a0 = -Math.PI / 2 + i * Math.PI / 4 + 0.06, a1 = -Math.PI / 2 + (i + 1) * Math.PI / 4 - 0.06;
			out += '<path d="M' + (50 + Math.cos(a0) * 36).toFixed(1) + " " + (52 + Math.sin(a0) * 36).toFixed(1) + " A36 36 0 0 1 " + (50 + Math.cos(a1) * 36).toFixed(1) + " " + (52 + Math.sin(a1) * 36).toFixed(1) + '" opacity="' + (i < lit ? 1 : 0.18) + '"/>';
		}
		return out + "</g>";
	}
	return { roundel, EMBLEMS };
})();

export function puzzleRankBadgeSVG(tierIndex: number): string {
	const t = Math.max(0, Math.min(7, tierIndex | 0));
	return '<svg viewBox="0 0 100 100" aria-hidden="true">' + puzzleBadgeParts.roundel(t + 1) + puzzleBadgeParts.EMBLEMS[t] + "</svg>";
}
export function puzzleBadgeFor(points: number): { color: string; svg: string } {
	const l = puzzleLadder(points || 0);
	return { color: l.tierColor, svg: puzzleRankBadgeSVG(l.tierIndex) };
}
