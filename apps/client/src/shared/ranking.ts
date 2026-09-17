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

// A player still in placement has no rank yet, whatever the hidden rating says: "Placement" in the muted colour
// (a rating of 0 would otherwise wear Bronze I unearned). Pair it with RankBadge's `provisional` for the badge.
export const PLACEMENT_TIER = { name: "Placement", color: "var(--muted)" };
export function tierFor(rating: number, provisional?: boolean): { name: string; color: string } {
	if (provisional) return PLACEMENT_TIER;
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
		p += '<polygon points="' + pts.join(" ") + '" ' + (grad ? 'fill="url(#' + grad + ')"' : 'style="fill:' + RB + '"') + "/>";
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
// ---- band marks (Design Lab, Sep 2026): the sub-tier is one to three of the band's own mark for Bronze
// (chevrons), Silver (bars) and Gold (stars); Platinum carries a bolt and Diamond a gem, with the frame telling
// the sub-tier: I the plain rim, II an inner rim, III "forged" (inner rim, rays and cracks on a thicker rim).
// Everything stays inside the hexagon. Colours come from the .rank-badge.tier-* custom properties.
const RB = "var(--rb-c2)", RB_DARK = "var(--bg, #0b1020)";
const HEX_VERTS = RANK_HEX_PTS.split(" ").map(p => p.split(",").map(Number));
const hexDir = (i: number, r: number) => { const v = HEX_VERTS[i], dx = v[0] - 50, dy = v[1] - 53, l = Math.hypot(dx, dy); return [50 + dx / l * r, 53 + dy / l * r]; };
const rbPath = (d: string, w: number, opacity?: number, color = RB) => '<path d="' + d + '" style="fill:none;stroke:' + color + ';stroke-width:' + w + (opacity != null ? ";opacity:" + opacity : "") + '" stroke-linecap="round" stroke-linejoin="round"/>';
const rbFill = (d: string) => '<path d="' + d + '" style="fill:' + RB + '"/>';
function scaledHex(k: number): string { return HEX_VERTS.map(v => (50 + (v[0] - 50) * k).toFixed(1) + "," + (53 + (v[1] - 53) * k).toFixed(1)).join(" "); }
function starPoints(cx: number, cy: number, ro: number, ri: number): string {
	const pts: string[] = [];
	for (let k = 0; k < 10; k++) { const a = (-90 + k * 36) * Math.PI / 180, r = k % 2 ? ri : ro; pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1)); }
	return pts.join(" ");
}
function rankHexBars(n: number): string {
	const h = 5, gap = 5, total = n * h + (n - 1) * gap, y0 = 53 - total / 2;
	let p = "";
	for (let i = 0; i < n; i++) p += '<rect x="31" y="' + (y0 + i * (h + gap)).toFixed(1) + '" width="38" height="' + h + '" rx="2.5" style="fill:' + RB + '"/>';
	return p;
}
function rankHexStars(n: number): string {
	const gap = 17, x0 = 50 - (n - 1) * gap / 2;
	let p = "";
	for (let i = 0; i < n; i++) p += '<polygon points="' + starPoints(x0 + i * gap, 53, 8, 3.4) + '" style="fill:' + RB + '"/>';
	return p;
}
const rankBolt = () => '<g transform="translate(50 53) scale(1.02) translate(-50 -46)">' + rbFill("M54 26 L37 49 H48 L45 66 L63 41 H52 Z") + "</g>";
const rankGem = () => '<g transform="translate(50 53) scale(1.02) translate(-50 -47)">' + rbFill("M35 42 L43 32 H57 L65 42 L50 62 Z") + rbPath("M35 42 H65 M43 32 L50 42 L57 32 M50 42 V62", 1.5, undefined, RB_DARK) + "</g>";
const rankInnerRim = () => '<polygon points="' + scaledHex(0.82) + '" style="fill:none;stroke:' + RB + ';stroke-width:2"/>';
// Forged (level III): twelve fine rays and six jagged cracks from the emblem to the corners, on a thicker rim.
function rankForged(): string {
	let s = rankInnerRim();
	for (let i = 0; i < 12; i++) {
		const a = -Math.PI / 2 + i * Math.PI / 6, r0 = 16, r1 = i % 2 ? 27 : 36;
		s += rbPath("M" + (50 + Math.cos(a) * r0).toFixed(1) + " " + (53 + Math.sin(a) * r0).toFixed(1) + " L" + (50 + Math.cos(a) * r1).toFixed(1) + " " + (53 + Math.sin(a) * r1).toFixed(1), 1.3, 0.4);
	}
	for (let i = 0; i < 6; i++) {
		const a = hexDir(i, 18), m1 = hexDir(i, 26), m2 = hexDir(i, 33), b = hexDir(i, 39), px = -(b[1] - a[1]) / 24, py = (b[0] - a[0]) / 24, sgn = i % 2 ? 1 : -1;
		const k1 = [m1[0] + px * 3 * sgn, m1[1] + py * 3 * sgn], k2 = [m2[0] - px * 2.5 * sgn, m2[1] - py * 2.5 * sgn];
		s += rbPath("M" + a[0].toFixed(1) + " " + a[1].toFixed(1) + " L" + k1[0].toFixed(1) + " " + k1[1].toFixed(1) + " L" + k2[0].toFixed(1) + " " + k2[1].toFixed(1) + " L" + b[0].toFixed(1) + " " + b[1].toFixed(1), 1.8, 0.6);
		if (i % 2 === 0) s += rbPath("M" + k1[0].toFixed(1) + " " + k1[1].toFixed(1) + " L" + (k1[0] + px * 6 * sgn + (m2[0] - m1[0]) * 0.35).toFixed(1) + " " + (k1[1] + py * 6 * sgn + (m2[1] - m1[1]) * 0.35).toFixed(1), 1.3, 0.48);
	}
	return s + '<polygon points="' + RANK_HEX_PTS + '" style="fill:none;stroke:' + RB + ';stroke-width:6" stroke-linejoin="round"/>';
}
function rankBandMark(tierClass: string, subN: number): string {
	switch (tierClass) {
		case "bronze": return rankHexChevrons(subN, "");
		case "silver": return rankHexBars(subN);
		case "gold": return rankHexStars(subN);
		case "platinum": case "diamond": return (subN === 3 ? rankForged() : subN === 2 ? rankInnerRim() : "") + (tierClass === "platinum" ? rankBolt() : rankGem());
	}
	return rankHexChevrons(subN, "");
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
	svg += isMaster ? rankHexStarSVG(grad) : rankBandMark(info.tierClass, subN);
	svg += "</svg>";
	return { tierClass: info.tierClass, svg };
}

const LOCK = '<rect x="38" y="50" width="24" height="18" rx="4" fill="currentColor"/><path d="M43 50 V44 a7 7 0 0 1 14 0 V50" fill="none" stroke="currentColor" stroke-width="4.5"/>';
// Placement: the hexagon plate as a dashed outline with a padlock, until the first placement matches are played.
export function placementBadgeSVG(): string {
	return '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="' + RANK_HEX_PTS + '" fill="rgba(255,255,255,0.03)" stroke="currentColor" stroke-width="4" stroke-dasharray="7 6" stroke-linejoin="round"/>' + LOCK + "</svg>";
}
// The placement plate cut for the reveal animation (PlacementReveal.tsx): six wedges from the centre to each
// edge, each a clipped copy of the dashed plate, plus the padlock as its own group with the shackle separate so
// it can spring open. `cls` names the classes the animation styles hang on; per-wedge flight vectors are inline.
let placementRevealSeq = 0;
export function placementRevealSVG(cls: { wedge: string; lock: string; shackle: string }): string {
	const V = [[50, 15], [85, 34], [85, 72], [50, 91], [15, 72], [15, 34]], cx = 50, cy = 53, id = "pr" + (++placementRevealSeq);
	const plate = '<polygon points="' + RANK_HEX_PTS + '" fill="rgba(255,255,255,0.03)" stroke="currentColor" stroke-width="4" stroke-dasharray="7 6" stroke-linejoin="round"/>';
	let defs = "", body = "";
	for (let i = 0; i < 6; i++) {
		const a = V[i], b = V[(i + 1) % 6], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = mx - cx, dy = my - cy, len = Math.hypot(dx, dy), k = 34 + (i % 3) * 7;
		defs += '<clipPath id="' + id + i + '"><polygon points="' + cx + "," + cy + " " + a.join(",") + " " + b.join(",") + '"/></clipPath>';
		body += '<g class="' + cls.wedge + '" clip-path="url(#' + id + i + ')" style="--wx:' + (dx / len * k).toFixed(1) + "px;--wy:" + (dy / len * k).toFixed(1) + "px;--wr:" + ((i % 2 ? 1 : -1) * (25 + i * 9)) + "deg;--d:" + (i * 0.04).toFixed(2) + 's">' + plate + "</g>";
	}
	const lock = '<g class="' + cls.lock + '"><rect x="38" y="50" width="24" height="18" rx="4" fill="currentColor"/><path class="' + cls.shackle + '" d="M43 50 V44 a7 7 0 0 1 14 0 V50" fill="none" stroke="currentColor" stroke-width="4.5"/></g>';
	return '<svg viewBox="0 0 100 100" aria-hidden="true" style="overflow:visible"><defs>' + defs + "</defs>" + body + lock + "</svg>";
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
	// Bomb Squad: steel helmet with chin strap.
	const helmet = F("M32 57 A18 18 0 0 1 68 57 Z") + R(27, 56, 46, 5.5, 2.75) + S("M41 62 Q50 71 59 62", 3);
	const ring = (r: number, op: string) => C(50, 52, r, false, 2.5).replace('stroke-width="2.5"', 'stroke-width="2.5" opacity="' + op + '"');
	const radar = ring(21, "0.45") + ring(14, "0.6") + ring(7, "0.8") + F("M50 52 L50 29 A23 23 0 0 1 70 41 Z") + C(50, 52, 3, true) + C(40, 40, 2.4, true) + C(59, 63, 2.4, true);
	// Recruit: a dog tag on its chain. Enlisted, but no gear issued yet.
	const dogTag = '<g transform="rotate(-14 50 52)">' + R(41, 38, 18, 30, 5) + D(50, 44, 2.4) + "</g>" + S("M50 41 C50 30 42 28 40 33", 2.5);
	const EMBLEMS = [dogTag, shrink(magnifier, 0.92), shovel, '<g transform="translate(0 -0.5)">' + shrink(claymore, 0.92) + "</g>", shrink(seaOutline, 0.92), shrink(dynamite, 0.92), helmet, radar];
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
export function puzzleBadgeFor(rating: number): { color: string; svg: string } {
	const l = puzzleLadder(rating || 0);
	return { color: l.tierColor, svg: puzzleRankBadgeSVG(l.tierIndex) };
}

// Progress within the current sub-tier toward the next (the ranked result's bar).
export function tierProgress(rating: number | null | undefined): { fill: number; nextName: string | null; pointsToNext: number; atMax: boolean } {
	if (typeof rating !== "number") rating = TIER_BASE_RATING;
	if (rating >= MASTER_THRESHOLD) return { fill: 1, nextName: null, pointsToNext: 0, atMax: true };
	const clamped = rating < TIER_BASE_RATING ? TIER_BASE_RATING : rating;
	const subStart = TIER_BASE_RATING + Math.floor((clamped - TIER_BASE_RATING) / SUB_TIER_WIDTH) * SUB_TIER_WIDTH;
	const nextThreshold = subStart + SUB_TIER_WIDTH;
	return { fill: Math.max(0, Math.min(1, (clamped - subStart) / SUB_TIER_WIDTH)), nextName: tierFor(nextThreshold).name, pointsToNext: Math.max(0, Math.round(nextThreshold - rating)), atMax: false };
}
export function ordinal(n: number): string { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
export function formatClearTime(ms: number): string { return (ms / 1000).toFixed(1) + "s"; }
