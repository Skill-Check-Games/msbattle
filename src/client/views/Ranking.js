// Tier + rank display helpers, shared across the home page chips, the Profile
// view, the Leaderboard, and the match result panels.
//
// MSBattle's ladder is Bronze/Silver/Gold/Platinum/Diamond with three sub-tiers
// each (I/II/III, 200 rating per step starting at 0), then an open-ended Master
// tier above (from 3000). Players reset to 0 and climb up from Bronze I.

// SSR_INLINE:START — embedded verbatim into the server-generated synchronous hydration script
// (see staticServer.js) so the home dashboard's you-card can compute a tier before the deferred
// bundle even loads. Keep this block dependency-free (no DOM, no other globals) since it has to
// stand alone there.
var TIER_BANDS = [
	{ name: "Bronze",   color: "#d08b5b" },
	{ name: "Silver",   color: "#cbd5e1" },
	{ name: "Gold",     color: "#fbbf24" },
	{ name: "Platinum", color: "#5eead4" },
	{ name: "Diamond",  color: "#60a5fa" }
];
var TIER_BASE_RATING = 0;
var SUB_TIER_WIDTH = 200;
var SUB_TIERS_PER_TIER = 3;
var SUB_TIER_NUMERALS = ["I", "II", "III"];
var MASTER_THRESHOLD = TIER_BASE_RATING + TIER_BANDS.length * SUB_TIERS_PER_TIER * SUB_TIER_WIDTH;
function tierFor(rating, provisional) {
	if (rating >= MASTER_THRESHOLD) return { name: "Master", color: "#c084fc" };
	var clamped = rating < TIER_BASE_RATING ? TIER_BASE_RATING : rating;
	var subIdx = Math.floor((clamped - TIER_BASE_RATING) / SUB_TIER_WIDTH);
	var tierIdx = Math.min(TIER_BANDS.length - 1, Math.floor(subIdx / SUB_TIERS_PER_TIER));
	var t = TIER_BANDS[tierIdx];
	return { name: t.name + " " + SUB_TIER_NUMERALS[subIdx % SUB_TIERS_PER_TIER], color: t.color };
}

// Your "overall" rating: the best across all ranked styles. There is no single legacy rating —
// anything that wants one headline number (topbar chip, profile summary) uses this.
function overallRating(account) {
	if (!account) return 0;
	return Math.max(account.ratingSprint || 0, account.ratingStandard || 0);
}
// SSR_INLINE:END

// Returns { tierClass: "bronze"|"silver"|.., subNum: "I"|"II"|"III"|null, label: "Bronze" }
// Used to render the round rank badges in the series-end panel.
function rankIconFor(rating) {
	if (rating >= MASTER_THRESHOLD) return { tierClass: "master", subNum: null, label: "Master" };
	var clamped = rating < TIER_BASE_RATING ? TIER_BASE_RATING : rating;
	var subIdx = Math.floor((clamped - TIER_BASE_RATING) / SUB_TIER_WIDTH);
	var tierIdx = Math.min(TIER_BANDS.length - 1, Math.floor(subIdx / SUB_TIERS_PER_TIER));
	var t = TIER_BANDS[tierIdx];
	return {
		tierClass: t.name.toLowerCase(),
		subNum: SUB_TIER_NUMERALS[subIdx % SUB_TIERS_PER_TIER],
		label: t.name
	};
}

// Rank-insignia badge — a dark service patch glowing in the tier colour, with an emblem that grows
// in prestige as you climb. The rank NAME is always shown beside it, so the emblem is pure flair.
//  • Bronze / Silver / Gold: metallic chevrons (1-3 = the sub-tier) — the foot-soldier insignia.
//  • Platinum / Diamond: a faceted gem crest whose WINGS unfurl with the sub-tier (I=2 feathers per
//    side, II=3, III=4) — it visibly levels up rather than stacking copies.
//  • Master: a crowned, fully-winged star — the pinnacle.
// The patch is sized in `em` off its font-size, so callers scale the whole badge with one rule.
function buildRankBadge(rating) {
	var info = rankIconFor(rating);
	var badge = document.createElement("div");
	badge.className = "rank-badge tier-" + info.tierClass;
	badge.innerHTML = rankEmblemSVG(info);
	return badge;
}

// Placement badge: the same hexagon plate as a dashed outline with a padlock inside — the slot a real
// rank badge fills once the first PROVISIONAL_GAMES matches in that mode are played (see
// renderHomeRankChips, Profile.js). Same .rank-badge sizing so it drops into any rank-badge slot.
// ---- Puzzle Ladder badge: a round medal with eight rim segments (tier N lights N) and a per-tier
// emblem — recruit's medal is empty, then magnifier, shovel, claymore, sea mine (outline), dynamite,
// sea mine (solid), radar. Drawn on a 100×100 canvas centred at (50,52). Designed 2026-09-08 with
// Mathias (icon palette artifact); colours come from PuzzleLadder.js's tiers.
var PUZZLE_BADGE_DARK = "var(--surface, #131a2e)";
var puzzleBadgeParts = (function () {
	function S(d, w, extra) { return '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + (w || 3.5) + '" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + '/>'; }
	function F(d) { return '<path d="' + d + '" fill="currentColor"/>'; }
	function C(x, y, r, fill, sw) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" ' + (fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="' + (sw || 3.5) + '"') + '/>'; }
	function R(x, y, w, h, rx) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx + '" fill="currentColor"/>'; }
	function D(x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + PUZZLE_BADGE_DARK + '"/>'; }
	function spikes(r, len, sw) {
		var out = '<g stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round">';
		for (var i = 0; i < 8; i++) {
			var a = i * Math.PI / 4;
			out += '<path d="M' + (50 + Math.cos(a) * (r + 3)).toFixed(1) + ' ' + (52 + Math.sin(a) * (r + 3)).toFixed(1) + ' L' + (50 + Math.cos(a) * (r + 3 + len)).toFixed(1) + ' ' + (52 + Math.sin(a) * (r + 3 + len)).toFixed(1) + '"/>';
		}
		return out + '</g>';
	}
	function knobs(r, len, sw, kr) {
		var out = spikes(r, len, sw);
		for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; out += C((50 + Math.cos(a) * (r + 3 + len)).toFixed(1), (52 + Math.sin(a) * (r + 3 + len)).toFixed(1), kr, true); }
		return out;
	}
	function star(r, cx, cy) {
		var pts = [];
		for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.46 : r; pts.push((cx + Math.cos(a) * rr).toFixed(1) + "," + (cy + Math.sin(a) * rr).toFixed(1)); }
		return '<polygon points="' + pts.join(" ") + '" fill="currentColor"/>';
	}
	function shrink(inner, k) { return '<g transform="translate(50 52) scale(' + k + ') translate(-50 -52)">' + inner + '</g>'; }
	var magnifier = C(46, 47, 12) + S("M40 43 A8 8 0 0 1 46 39", 2.5) + S("M55 56 L67 68", 5);
	var shovel = S("M50 32.4 V55.8", 4) + S("M41.9 32.4 H58.1", 4) + F("M39.2 55.8 H60.8 L59 70.2 Q50 75.6 41 70.2 Z");
	var claymore = F("M30 45 Q50 36 70 45 V60 Q50 51 30 60 Z") + '<path d="M33 53 Q50 45.5 67 53" fill="none" stroke="' + PUZZLE_BADGE_DARK + '" stroke-width="1.6"/>' + R(46, 36, 8, 5, 1.5) + S("M38 60 L34 72", 3.5) + S("M62 60 L66 72", 3.5);
	var seaOutline = C(50, 52, 11) + knobs(11, 3.5, 3, 2);
	var dynamite = R(37, 44, 8, 26, 3) + R(46, 44, 8, 26, 3) + R(55, 44, 8, 26, 3) + '<rect x="35" y="54" width="30" height="5" fill="' + PUZZLE_BADGE_DARK + '"/>' + S("M52 44 Q56 36 62 34", 2.5) + star(4.5, 64, 33);
	var seaSolid = C(50, 52, 12, true) + spikes(12, 5.5, 4) + D(45.4, 47.4, 3.1);
	var radar = C(50, 52, 21, false, 2.5).replace('stroke-width="2.5"', 'stroke-width="2.5" opacity="0.45"') + C(50, 52, 14, false, 2.5).replace('stroke-width="2.5"', 'stroke-width="2.5" opacity="0.6"') + C(50, 52, 7, false, 2.5).replace('stroke-width="2.5"', 'stroke-width="2.5" opacity="0.8"') + F("M50 52 L50 29 A23 23 0 0 1 70 41 Z") + C(50, 52, 3, true) + C(40, 40, 2.4, true) + C(59, 63, 2.4, true);
	var EMBLEMS = [
		"",
		shrink(magnifier, 0.92),
		shovel,
		'<g transform="translate(0 -0.5)">' + shrink(claymore, 0.92) + '</g>',
		shrink(seaOutline, 0.92),
		shrink(dynamite, 0.92),
		shrink(seaSolid, 0.92),
		radar
	];
	function roundel(lit) {
		var out = '<circle cx="50" cy="52" r="40" fill="' + PUZZLE_BADGE_DARK + '" stroke="currentColor" stroke-width="3"/><g stroke="currentColor" stroke-width="6" fill="none">';
		for (var i = 0; i < 8; i++) {
			var a0 = -Math.PI / 2 + i * Math.PI / 4 + 0.06, a1 = -Math.PI / 2 + (i + 1) * Math.PI / 4 - 0.06;
			out += '<path d="M' + (50 + Math.cos(a0) * 33).toFixed(1) + ' ' + (52 + Math.sin(a0) * 33).toFixed(1) + ' A33 33 0 0 1 ' + (50 + Math.cos(a1) * 33).toFixed(1) + ' ' + (52 + Math.sin(a1) * 33).toFixed(1) + '" opacity="' + (i < lit ? 1 : 0.18) + '"/>';
		}
		return out + '</g>';
	}
	return { roundel: roundel, EMBLEMS: EMBLEMS };
})();
// SVG markup for a tier (0-based index into PuzzleLadder's tiers). Colour comes from the element's
// currentColor, so callers set style.color to the tier colour.
function puzzleRankBadgeSVG(tierIndex) {
	var t = Math.max(0, Math.min(7, tierIndex | 0));
	return '<svg viewBox="0 0 100 100" aria-hidden="true">' + puzzleBadgeParts.roundel(t + 1) + puzzleBadgeParts.EMBLEMS[t] + '</svg>';
}
// The badge element, sized like buildRankBadge (font-size drives it via .rank-badge's 5em box).
function buildPuzzleRankBadge(points) {
	var l = (typeof puzzleLadder === "function") ? puzzleLadder(points || 0) : { tierIndex: 0, tierColor: "#9aa3ad" };
	var badge = document.createElement("div");
	badge.className = "rank-badge puzzle-rank-badge";
	badge.style.color = l.tierColor;
	badge.innerHTML = puzzleRankBadgeSVG(l.tierIndex);
	return badge;
}

// Puzzle Ladder counterpart of buildPlacementBadge: the ladder's badge is a round medal, so before the
// first rated solve the slot shows a dashed circle with the same padlock (see renderHomeRankChips).
function buildPuzzleLockedBadge() {
	var badge = document.createElement("div");
	badge.className = "rank-badge rank-badge-placement";
	badge.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true">'
		+ '<circle cx="50" cy="53" r="36" fill="rgba(255,255,255,0.03)" stroke="currentColor" stroke-width="4" stroke-dasharray="7 6"/>'
		+ '<rect x="38" y="50" width="24" height="18" rx="4" fill="currentColor"/>'
		+ '<path d="M43 50 V44 a7 7 0 0 1 14 0 V50" fill="none" stroke="currentColor" stroke-width="4.5"/>'
		+ '</svg>';
	return badge;
}

function buildPlacementBadge() {
	var badge = document.createElement("div");
	badge.className = "rank-badge rank-badge-placement";
	badge.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true">'
		+ '<polygon points="' + RANK_HEX_PTS + '" fill="rgba(255,255,255,0.03)" stroke="currentColor" stroke-width="4" stroke-dasharray="7 6" stroke-linejoin="round"/>'
		+ '<rect x="38" y="50" width="24" height="18" rx="4" fill="currentColor"/>'
		+ '<path d="M43 50 V44 a7 7 0 0 1 14 0 V50" fill="none" stroke="currentColor" stroke-width="4.5"/>'
		+ '</svg>';
	return badge;
}

// Point-top hexagon plate every tier wears: a dark interior behind a tier-coloured rim, framing the
// sub-tier chevrons (a star for Master). Clean — no wings.
var RANK_HEX_PTS = "50,15 85,34 85,72 50,91 15,72 15,34";
function rankHexSVG() {
	return '<polygon class="rank-hex-fill" points="' + RANK_HEX_PTS + '"/>'
		+ '<polygon class="rank-hex-rim" points="' + RANK_HEX_PTS + '"/>';
}
// The sub-tier chevrons (1-3), stacked and centred, filled with the tier's metallic gradient.
function rankHexChevrons(n, grad) {
	// Each chevron has arms of vertical thickness `thick` that climb to a centred apex `rise` above the
	// outer corners — the rise vs half-width sets the V's angle (bigger rise = sharper, less worm-like).
	var w = 38, rise = 6.5, thick = 5, gap = 1.6, h = rise + thick;
	var total = n * h + (n - 1) * gap, y0 = 53 - total / 2, x0 = 50 - w / 2, p = "";
	for (var i = 0; i < n; i++) {
		var y = y0 + i * (h + gap);
		var pts = [
			50 + "," + y.toFixed(1),
			(x0 + w) + "," + (y + rise).toFixed(1),
			(x0 + w) + "," + (y + rise + thick).toFixed(1),
			50 + "," + (y + thick).toFixed(1),
			x0 + "," + (y + rise + thick).toFixed(1),
			x0 + "," + (y + rise).toFixed(1)
		];
		p += '<polygon points="' + pts.join(" ") + '" fill="url(#' + grad + ')"/>';
	}
	return p;
}
// A star centred in the hexagon for Master (tops the chevron ladder), same metallic gradient fill.
function rankHexStarSVG(grad) {
	var pts = [], cx = 50, cy = 53, ro = 19, ri = 8;
	for (var k = 0; k < 10; k++) {
		var a = (-90 + k * 36) * Math.PI / 180, r = (k % 2) ? ri : ro;
		pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1));
	}
	return '<polygon points="' + pts.join(" ") + '" fill="url(#' + grad + ')"/>';
}
// Compose the emblem: the hexagon plate holding the sub-tier chevrons (a star for Master). Each badge
// gets its own gradient id so the tier vars resolve per-instance (a shared id would take the first
// badge's colours). The chevron/star gradient (objectBoundingBox) runs c1→c2→c3 across each shape, so
// they keep the metallic chevron look at every tier.
var _rankGradSeq = 0;
function rankEmblemSVG(info) {
	var isMaster = info.tierClass === "master";
	var subN = info.subNum ? Math.max(1, SUB_TIER_NUMERALS.indexOf(info.subNum) + 1) : 3;
	var grad = "rg" + (++_rankGradSeq);
	var svg = '<svg class="rank-emblem" viewBox="0 0 100 100" aria-hidden="true">';
	svg += '<defs><linearGradient id="' + grad + '" x1="0" y1="0" x2="0.3" y2="1">'
		+ '<stop offset="0" style="stop-color:var(--rb-c1)"/>'
		+ '<stop offset="0.55" style="stop-color:var(--rb-c2)"/>'
		+ '<stop offset="1" style="stop-color:var(--rb-c3)"/></linearGradient></defs>';
	svg += rankHexSVG();
	svg += isMaster ? rankHexStarSVG(grad) : rankHexChevrons(subN, grad);
	svg += '</svg>';
	return svg;
}

// Progress within the current sub-tier toward the next one (the ranked result modal's bar).
// Returns { fill: 0..1, nextName, pointsToNext, atMax }.
function tierProgress(rating) {
	if (typeof rating !== "number") rating = TIER_BASE_RATING;
	if (rating >= MASTER_THRESHOLD) return { fill: 1, nextName: null, pointsToNext: 0, atMax: true };
	var clamped = rating < TIER_BASE_RATING ? TIER_BASE_RATING : rating;
	var subStart = TIER_BASE_RATING + Math.floor((clamped - TIER_BASE_RATING) / SUB_TIER_WIDTH) * SUB_TIER_WIDTH;
	var nextThreshold = subStart + SUB_TIER_WIDTH;
	return {
		fill: Math.max(0, Math.min(1, (clamped - subStart) / SUB_TIER_WIDTH)),
		nextName: tierFor(nextThreshold).name,
		pointsToNext: Math.max(0, Math.round(nextThreshold - rating)),
		atMax: false
	};
}

function ordinal(n) {
	var s = ["th", "st", "nd", "rd"];
	var v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function medal(rank) {
	return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : ordinal(rank);
}

function formatClearTime(ms) {
	return (ms / 1000).toFixed(1) + "s";
}
