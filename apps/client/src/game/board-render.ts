// Canvas board rendering. Every board surface on the site (the live game, opponent thumbnails, the
// customize lab, Learn, previews) builds a BoardView bound to its canvas and calls draw(); the cell
// loop and the drawCell primitive live here, so no surface re-implements them. Ported from the
// legacy BoardRender.js with the same drawing code; the page globals it read are now explicit
// module state (the local skin and reveal effect) and BoardView options.
import Cosmetics from "core/src/common/Cosmetics.js";
import BoardLogic from "core/src/common/BoardLogic.js";
import { countryFlagSrc } from "../shared/countries";

export const MINE: number = BoardLogic.MINE;
export const FLAGGED: number = BoardLogic.FLAGGED;
export const UNKNOWN: number = BoardLogic.UNKNOWN;
export const KNOWN: number = BoardLogic.KNOWN;

export const BOARD_SKINS: Record<string, any> = Cosmetics.BOARD_SKINS;
export const BOARD_SKIN_LIST: string[] = Cosmetics.BOARD_SKIN_LIST;
export const AVATAR_COLORS: string[] = Cosmetics.AVATAR_COLORS;
export const DEFAULT_AVATAR_COLOR: string = Cosmetics.DEFAULT_AVATAR_COLOR;
export const DEFAULT_AVATAR: string = Cosmetics.DEFAULT_AVATAR;
export const AVATAR_IMAGES: Record<string, string> = Cosmetics.AVATAR_IMAGES;
export const REVEAL_EFFECT_LIST: string[] = Cosmetics.REVEAL_EFFECT_LIST;
export const DEFAULT_REVEAL_EFFECT: string = Cosmetics.DEFAULT_REVEAL_EFFECT;

// ---- palette (the draw helpers read these live; a BoardView swaps them in for its own skin) ----
let COLOR_MINE: string, NUMBER_COLORS: Record<number, string>, COLOR_KNOWN_BG: string, COLOR_KNOWN_EDGE: string,
	COLOR_UNKNOWN_TOP: string, COLOR_UNKNOWN_BOTTOM: string, COLOR_UNKNOWN_EDGE: string, COLOR_UNKNOWN_HILITE: string,
	COLOR_FLAG_CLOTH: string, COLOR_FLAG_POLE: string, NUMBER_FONT: string, NUMBER_GLOW: boolean, SKIN_NO_TOP_HILITE: boolean;

export function setPaletteVars(id: string) {
	const s = BOARD_SKINS[id] || BOARD_SKINS.classic;
	COLOR_MINE = s.mine; NUMBER_COLORS = s.numbers;
	COLOR_KNOWN_BG = s.knownBg; COLOR_KNOWN_EDGE = s.knownEdge;
	COLOR_UNKNOWN_TOP = s.unknownTop; COLOR_UNKNOWN_BOTTOM = s.unknownBottom; COLOR_UNKNOWN_EDGE = s.unknownEdge;
	COLOR_UNKNOWN_HILITE = s.unknownHilite;
	COLOR_FLAG_CLOTH = s.flagCloth; COLOR_FLAG_POLE = s.flagPole;
	NUMBER_FONT = s.font; NUMBER_GLOW = !!s.glow; SKIN_NO_TOP_HILITE = !!s.noTopHilite;
}
export function paletteHasGlow(): boolean { return NUMBER_GLOW; }

// ---- the local player's own choices (skin + reveal effect), with change subscribers ----
// Persisted to localStorage; telling the server is the caller's job (cosmetics.ts), since ownership
// is checked there and the socket module must not be a dependency of a pure renderer.
export let localBoardSkin = "classic";
export let localRevealEffect: string = DEFAULT_REVEAL_EFFECT;
const skinListeners = new Set<() => void>();
export function onCosmeticsChange(cb: () => void): () => void { skinListeners.add(cb); return () => { skinListeners.delete(cb); }; }
function notify() { skinListeners.forEach(cb => cb()); }

export function applyBoardSkin(id: string) {
	if (!BOARD_SKINS[id]) id = "classic";
	localBoardSkin = id;
	setPaletteVars(id);
	if (document.body) document.body.setAttribute("data-board-skin", id);
	notify();
}
export function applyRevealEffect(id: string) {
	if (REVEAL_EFFECT_LIST.indexOf(id) === -1) id = DEFAULT_REVEAL_EFFECT;
	localRevealEffect = id;
	notify();
}
function stored(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
applyBoardSkin(stored("ms_board_skin") || "classic");
applyRevealEffect(stored("ms_reveal_effect") || DEFAULT_REVEAL_EFFECT);

// Device pixel ratio, capped at 2 (beyond that a flat-colour board gains nothing visible but the
// per-frame fill cost keeps scaling with the square of the ratio).
export const DPR = Math.min(2, window.devicePixelRatio || 1);

// ---- animation timing ----
export const REVEAL_DUR = 230;
export const FLAG_DUR = 260;
export const MINE_DUR = 460;
// Reveal wave: cells open in rings of flood distance from the clicked tile, one ring per step; a very
// deep flood compresses the step so the whole wave lands within WAVE_MAX_MS.
export const WAVE_STEP_MS = 45;
export const WAVE_MAX_MS = 900;
export const SETTLE_DUR = 1;

// ---- easing + geometry ----
export const clamp01 = (t: number) => t < 0 ? 0 : t > 1 ? 1 : t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export function easeOutBack(t: number) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	r = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

// ---- BoardView ----
export interface CellAnim { type: "reveal" | "mine" | "flag" | "settle"; t: number; }
export interface BoardViewOptions {
	xray?: boolean;
	animAt?: ((r: number, c: number) => CellAnim | null) | null;
	includeCell?: ((r: number, c: number) => boolean) | null;
	skin?: string | null;                 // null: the local player's skin
	forceRevealEffect?: string | null;    // demo boards: show a specific effect
	ownBoard?: boolean;                   // the local player's live board: reveals use localRevealEffect
}
type OverlayFn = (ctx: CanvasRenderingContext2D, sw: number, sh: number) => void;

export class BoardView {
	canvas: HTMLCanvasElement; rows: number; cols: number;
	xray: boolean; animAt: BoardViewOptions["animAt"]; includeCell: BoardViewOptions["includeCell"];
	skinId: string | null; forceRevealEffect: string | null; ownBoard: boolean;
	private _state: number[][]; private _cellAt: (r: number, c: number) => number;
	private _underlays: OverlayFn[] = []; private _overlays: OverlayFn[] = [];
	constructor(canvas: HTMLCanvasElement, rows: number, cols: number, state: number[][], cellAt: (r: number, c: number) => number, opts: BoardViewOptions = {}) {
		this.canvas = canvas; this.rows = rows; this.cols = cols; this._state = state; this._cellAt = cellAt;
		this.xray = !!opts.xray; this.animAt = opts.animAt || null; this.includeCell = opts.includeCell || null;
		this.skinId = opts.skin || null; this.forceRevealEffect = opts.forceRevealEffect || null; this.ownBoard = !!opts.ownBoard;
	}
	setState(state: number[][]) { this._state = state; }
	isCovered(r: number, c: number) { return this._state[r][c] === UNKNOWN; }
	isRevealed(r: number, c: number) { return this._state[r][c] === KNOWN; }
	isFlagged(r: number, c: number) { return this._state[r][c] === FLAGGED; }
	isMine(r: number, c: number) { return this._cellAt(r, c) === MINE; }
	getClue(r: number, c: number) { const v = this._cellAt(r, c); return v > 0 ? v : 0; }
	underlay(fn: OverlayFn) { this._underlays.push(fn); return this; }
	overlay(fn: OverlayFn) { this._overlays.push(fn); return this; }
	markSafe(cells: number[][]) {
		return this.overlay((ctx, sw, sh) => { for (const cell of cells) drawSafeMarker(ctx, cell[1] * sw, cell[0] * sh, sw, sh); });
	}
	// dirtyCells: repaint only those cells (the live board's per-frame fast path); otherwise a full repaint.
	draw(dirtyCells?: number[][]) {
		const ctx = this.canvas.getContext("2d")!;
		const sw = this.canvas.width / this.cols, sh = this.canvas.height / this.rows;
		setPaletteVars(this.skinId || localBoardSkin);
		if (dirtyCells) {
			for (const [r, c] of dirtyCells) {
				if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue;
				if (this.includeCell && !this.includeCell(r, c)) continue;
				ctx.clearRect(c * sw, r * sh, sw, sh);
				drawCell(ctx, r, c, this, sw, sh, this.animAt ? this.animAt(r, c) : null);
			}
		} else {
			ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			for (const u of this._underlays) u(ctx, sw, sh);
			for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
				if (this.includeCell && !this.includeCell(r, c)) continue;
				drawCell(ctx, r, c, this, sw, sh, this.animAt ? this.animAt(r, c) : null);
			}
		}
		for (const o of this._overlays) o(ctx, sw, sh);
		setPaletteVars(localBoardSkin);
	}
}

// A DPR-scaled canvas sized to a cols x rows grid of cellPx logical px.
export function buildCellCanvas(cols: number, rows: number, cellPx: number, className?: string): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	if (className) canvas.className = className;
	sizeCellCanvas(canvas, cols, rows, cellPx);
	return canvas;
}
export function sizeCellCanvas(canvas: HTMLCanvasElement, cols: number, rows: number, cellPx: number) {
	canvas.width = Math.round(cols * cellPx * DPR);
	canvas.height = Math.round(rows * cellPx * DPR);
	canvas.style.width = (cols * cellPx) + "px";
	canvas.style.height = (rows * cellPx) + "px";
}

export function drawSafeMarker(ctx: CanvasRenderingContext2D, x: number, y: number, sw: number, sh: number) {
	const cx = x + sw / 2, cy = y + sh / 2, s = Math.min(sw, sh) * 0.28;
	ctx.save();
	ctx.strokeStyle = "#4ade80"; ctx.lineWidth = Math.max(2, s * 0.35); ctx.lineCap = "round"; ctx.lineJoin = "round";
	ctx.beginPath(); ctx.moveTo(cx - s, cy + s * 0.05); ctx.lineTo(cx - s * 0.25, cy + s * 0.65); ctx.lineTo(cx + s, cy - s * 0.55); ctx.stroke();
	ctx.restore();
}

// ---- one cell ----
export function drawCell(ctx: CanvasRenderingContext2D, r: number, c: number, view: BoardView, sw: number, sh: number, anim: CellAnim | null) {
	const gap = Math.max(1, Math.round(Math.min(sw, sh) * 0.08));
	const w = sw - gap, h = sh - gap, rad = Math.min(w, h) * 0.2;
	ctx.save();
	ctx.translate(c * sw + gap / 2, r * sh + gap / 2);
	if (view.xray && view.isMine(r, c) && !view.isFlagged(r, c)) {
		drawUnknown(ctx, w, h, rad);
		drawMineXray(ctx, w, h);
	} else if (view.isRevealed(r, c)) {
		const revealing = !!anim && (anim.type === "reveal" || anim.type === "mine");
		const t = revealing ? clamp01(anim!.t) : 1;
		drawKnownBase(ctx, w, h, rad);
		if (view.isMine(r, c)) {
			if (anim && anim.type === "mine") {
				ctx.globalAlpha = (1 - easeOutCubic(t)) * 0.85;
				ctx.fillStyle = "#dc2626"; roundRectPath(ctx, 0, 0, w, h, rad); ctx.fill();
				ctx.globalAlpha = 1;
			}
			drawMine(ctx, w, h, t);
		} else {
			const clue = view.getClue(r, c);
			if (clue > 0) drawNumber(ctx, clue, w, h, t);
		}
		// The covered lid lifts off as the reveal plays, in the local player's chosen effect on their own
		// board and the default elsewhere (an opponent's reveal is not yours to customize).
		if (revealing && anim!.t < 1) {
			const effectId = view.forceRevealEffect || (view.ownBoard ? localRevealEffect : "ripple");
			drawRevealLid(ctx, w, h, rad, t, r, c, effectId);
			ctx.globalAlpha = 1;
		}
	} else if (view.isFlagged(r, c)) {
		drawUnknown(ctx, w, h, rad);
		const fs = anim && anim.type === "flag" ? easeOutBack(clamp01(anim.t)) : 1;
		drawFlag(ctx, w, h, fs, null);
		ctx.globalAlpha = 1;
	} else {
		drawUnknown(ctx, w, h, rad);
	}
	ctx.restore();
}

export function drawUnknown(ctx: CanvasRenderingContext2D, w: number, h: number, rad: number) {
	const g = ctx.createLinearGradient(0, 0, 0, h);
	g.addColorStop(0, COLOR_UNKNOWN_TOP); g.addColorStop(1, COLOR_UNKNOWN_BOTTOM);
	roundRectPath(ctx, 0, 0, w, h, rad); ctx.fillStyle = g; ctx.fill();
	if (!SKIN_NO_TOP_HILITE) { // raised top highlight (Frost opts out)
		ctx.strokeStyle = COLOR_UNKNOWN_HILITE; ctx.lineWidth = Math.max(1, h * 0.06);
		ctx.beginPath(); ctx.moveTo(rad, ctx.lineWidth / 2); ctx.lineTo(w - rad, ctx.lineWidth / 2); ctx.stroke();
	}
	roundRectPath(ctx, 0, 0, w, h, rad); ctx.strokeStyle = COLOR_UNKNOWN_EDGE; ctx.lineWidth = 1; ctx.stroke();
}
function drawKnownBase(ctx: CanvasRenderingContext2D, w: number, h: number, rad: number) {
	roundRectPath(ctx, 0, 0, w, h, rad); ctx.fillStyle = COLOR_KNOWN_BG; ctx.fill();
	ctx.strokeStyle = COLOR_KNOWN_EDGE; ctx.lineWidth = 1; ctx.stroke();
}

// ---- reveal effects: how the covered lid comes off. All read the live skin palette. ----
function cellSeededRandom(n: number) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function revealLidRipple(ctx: CanvasRenderingContext2D, w: number, h: number, rad: number, t: number) {
	const scale = 1 + 0.18 * easeOutCubic(t);
	ctx.save();
	ctx.globalAlpha = 1 - easeOutCubic(t);
	ctx.translate(w / 2, h / 2); ctx.scale(scale, scale); ctx.translate(-w / 2, -h / 2);
	drawUnknown(ctx, w, h, rad);
	if (t < 0.35) { ctx.globalAlpha = (1 - t / 0.35) * 0.5; ctx.fillStyle = "#ffffff"; roundRectPath(ctx, 0, 0, w, h, rad); ctx.fill(); }
	ctx.restore();
}
function revealLidSpark(ctx: CanvasRenderingContext2D, w: number, h: number, rad: number, t: number) {
	ctx.save(); ctx.globalAlpha = 1 - easeInCubic(Math.min(1, t * 1.4)); drawUnknown(ctx, w, h, rad); ctx.restore();
	if (t < 0.5) {
		const st = t / 0.5, r2 = Math.min(w, h) * (0.12 + 0.3 * st);
		ctx.save(); ctx.globalAlpha = 1 - st;
		const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r2);
		grd.addColorStop(0, "#ffffff"); grd.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(w / 2, h / 2, r2, 0, Math.PI * 2); ctx.fill();
		ctx.restore();
	}
}
function revealLidShatter(ctx: CanvasRenderingContext2D, w: number, h: number, rad: number, t: number, r: number, c: number) {
	ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
	if (t < 0.15) { ctx.save(); ctx.globalAlpha = 1 - t / 0.15; drawUnknown(ctx, w, h, rad); ctx.restore(); }
	const shardCount = 4, maxDist = Math.min(w, h) * 0.32;
	for (let i = 0; i < shardCount; i++) {
		const seedA = cellSeededRandom(r * 401 + c * 809 + i * 37), seedB = cellSeededRandom(r * 613 + c * 271 + i * 91 + 17);
		const angle = (i / shardCount) * Math.PI * 2 + (seedA - 0.5) * 1.2;
		const dist = maxDist * easeOutCubic(t), size = Math.min(w, h) * 0.24 * (1 - t * 0.35);
		ctx.save(); ctx.globalAlpha = 1 - t;
		ctx.translate(w / 2 + Math.cos(angle) * dist, h / 2 + Math.sin(angle) * dist); ctx.rotate((seedB - 0.5) * 5 * t);
		ctx.fillStyle = COLOR_UNKNOWN_TOP;
		ctx.beginPath(); ctx.moveTo(0, -size / 2); ctx.lineTo(size / 2, size / 2); ctx.lineTo(-size / 2, size / 2); ctx.closePath(); ctx.fill();
		ctx.restore();
	}
	ctx.restore();
}
function revealLidCrt(ctx: CanvasRenderingContext2D, w: number, h: number, rad: number, t: number) {
	if (t < 0.6) {
		ctx.save(); ctx.globalAlpha = 1 - t / 0.6; drawUnknown(ctx, w, h, rad); ctx.restore();
		const flicker = Math.abs(Math.sin(t * 50));
		if (flicker > 0.6) { ctx.save(); ctx.globalAlpha = ((flicker - 0.6) / 0.4) * (1 - t / 0.6); ctx.fillStyle = COLOR_UNKNOWN_TOP; roundRectPath(ctx, 0, 0, w, h, rad); ctx.fill(); ctx.restore(); }
	}
	if (t < 0.4) { ctx.save(); ctx.globalAlpha = 1 - t / 0.4; ctx.fillStyle = COLOR_UNKNOWN_TOP; ctx.fillRect(0, (t / 0.4) * h, w, Math.max(1, h * 0.06)); ctx.restore(); }
}
function revealLidDust(ctx: CanvasRenderingContext2D, w: number, h: number, rad: number, t: number) {
	ctx.save(); ctx.globalAlpha = 1 - easeOutCubic(t); drawUnknown(ctx, w, h, rad); ctx.restore();
	const pt = Math.min(1, t * 1.6), r2 = Math.min(w, h) * (0.15 + 0.55 * pt);
	ctx.save(); ctx.globalAlpha = (1 - pt) * 0.7;
	const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r2);
	grd.addColorStop(0, COLOR_UNKNOWN_HILITE); grd.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(w / 2, h / 2, r2, 0, Math.PI * 2); ctx.fill();
	ctx.restore();
}
const REVEAL_LID_FX: Record<string, (ctx: CanvasRenderingContext2D, w: number, h: number, rad: number, t: number, r: number, c: number) => void> =
	{ ripple: revealLidRipple, spark: revealLidSpark, shatter: revealLidShatter, crt: revealLidCrt, dust: revealLidDust };
function drawRevealLid(ctx: CanvasRenderingContext2D, w: number, h: number, rad: number, t: number, r: number, c: number, styleId: string) {
	(REVEAL_LID_FX[styleId] || revealLidRipple)(ctx, w, h, rad, t, r, c);
}

export function drawNumber(ctx: CanvasRenderingContext2D, n: number, w: number, h: number, t: number) {
	ctx.save();
	ctx.globalAlpha = clamp01(t);
	const scale = 0.7 + 0.3 * easeOutBack(clamp01(t));
	ctx.translate(w / 2, h / 2); ctx.scale(scale, scale);
	const col = NUMBER_COLORS[n] || "#e2e8f0";
	ctx.fillStyle = col;
	if (NUMBER_GLOW) { ctx.shadowColor = col; ctx.shadowBlur = Math.max(2, h * 0.4); }
	ctx.font = "bold " + Math.floor(0.72 * h) + "px " + NUMBER_FONT;
	ctx.textAlign = "center";
	// Centred on the glyph's measured ink box, not the font's "middle" line (font metrics differ per skin).
	ctx.textBaseline = "alphabetic";
	const s = String(n), m = ctx.measureText(s);
	const dy = (typeof m.actualBoundingBoxAscent === "number") ? (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 : 0.36 * h;
	ctx.fillText(s, 0, dy);
	ctx.restore();
}

export function drawMine(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
	ctx.save();
	ctx.globalAlpha = clamp01(t);
	const scale = 0.6 + 0.4 * easeOutBack(clamp01(t));
	ctx.translate(w / 2, h / 2); ctx.scale(scale, scale);
	const rad = Math.min(w, h) * 0.26;
	ctx.strokeStyle = COLOR_MINE; ctx.lineWidth = Math.max(1, rad * 0.22); ctx.lineCap = "round";
	for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * rad * 0.7, Math.sin(a) * rad * 0.7); ctx.lineTo(Math.cos(a) * rad * 1.5, Math.sin(a) * rad * 1.5); ctx.stroke(); }
	ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fillStyle = COLOR_MINE; ctx.fill();
	ctx.beginPath(); ctx.arc(-rad * 0.3, -rad * 0.3, rad * 0.3, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fill();
	ctx.restore();
}
export function drawMineXray(ctx: CanvasRenderingContext2D, w: number, h: number) {
	ctx.save();
	ctx.translate(w / 2, h / 2);
	const rad = Math.min(w, h) * 0.2, len = rad * 1.8;
	ctx.strokeStyle = "#0f172a"; ctx.lineWidth = Math.max(1, rad * 0.32); ctx.lineCap = "round";
	const lines = [[0, -len, 0, len], [-len, 0, len, 0], [-len * 0.8, -len * 0.8, len * 0.8, len * 0.8], [len * 0.8, -len * 0.8, -len * 0.8, len * 0.8]];
	for (const l of lines) { ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.stroke(); }
	ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fillStyle = "#0f172a"; ctx.fill();
	ctx.beginPath(); ctx.arc(-rad * 0.35, -rad * 0.35, rad * 0.28, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fill();
	ctx.restore();
}
export function drawFlag(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, clothColor: string | null) {
	ctx.save();
	ctx.translate(w / 2, h / 2); ctx.scale(scale, scale);
	const ph = h * 0.5, px = -w * 0.12;
	ctx.strokeStyle = COLOR_FLAG_POLE; ctx.lineWidth = Math.max(1, w * 0.07); ctx.lineCap = "round";
	ctx.beginPath(); ctx.moveTo(px, -ph / 2); ctx.lineTo(px, ph / 2); ctx.stroke();
	ctx.beginPath(); ctx.moveTo(px - w * 0.16, ph / 2); ctx.lineTo(px + w * 0.16, ph / 2); ctx.stroke();
	ctx.beginPath(); ctx.moveTo(px, -ph / 2); ctx.lineTo(px + w * 0.34, -ph * 0.28); ctx.lineTo(px, -ph * 0.06); ctx.closePath();
	ctx.fillStyle = clothColor || COLOR_FLAG_CLOTH; ctx.fill();
	ctx.restore();
}

// ---- avatars ----
// The avatar tile: "anon" (silhouette), "mine" (sea mine), "img:<id>" (preset image), or a colour,
// which draws the in-game flag on a pole with the country flag as its cloth when a country is set.
const AVATAR_IMAGE_CACHE: Record<string, HTMLImageElement> = {};
export function buildAvatarCanvas(color: string | null, px: number, country?: string | null, cornerPx?: number | null, rimStyle?: string | null): HTMLCanvasElement {
	px = px || 28;
	const corner = (cornerPx != null) ? cornerPx : Math.min(7, Math.max(3, px * 0.09));
	const rim = rimStyle || "rgba(255,255,255,0.10)";
	const dpr = window.devicePixelRatio || 1;
	const c = document.createElement("canvas");
	c.className = "avatar-canvas";
	c.width = Math.round(px * dpr); c.height = Math.round(px * dpr);
	c.style.width = px + "px"; c.style.height = px + "px";
	const ctx = c.getContext("2d")!;
	ctx.scale(dpr, dpr);

	function tileBg() {
		ctx.clearRect(0, 0, px, px);
		if (corner <= 0) { ctx.fillStyle = "#1a2240"; ctx.fillRect(0, 0, px, px); return; }
		roundRectPath(ctx, 0.5, 0.5, px - 1, px - 1, corner);
		ctx.fillStyle = "#1a2240"; ctx.fill();
		ctx.strokeStyle = rim; ctx.lineWidth = 1; ctx.stroke();
	}
	if (color === "anon") {
		tileBg();
		ctx.save(); roundRectPath(ctx, 0.5, 0.5, px - 1, px - 1, corner); ctx.clip();
		ctx.fillStyle = "#aab3d0";
		ctx.beginPath(); ctx.arc(px * 0.5, px * 1.04, px * 0.37, 0, Math.PI * 2); ctx.fill();
		ctx.beginPath(); ctx.arc(px * 0.5, px * 0.37, px * 0.17, 0, Math.PI * 2); ctx.fill();
		ctx.restore();
		return c;
	}
	if (color === "mine") {
		tileBg();
		ctx.save();
		const mcx = px * 0.5, mcy = px * 0.5, mrad = px * 0.28;
		ctx.strokeStyle = "#475569"; ctx.lineWidth = Math.max(1.2, mrad * 0.34); ctx.lineCap = "round";
		for (let mi = 0; mi < 8; mi++) {
			const ma = mi * Math.PI / 4 + Math.PI / 8;
			ctx.beginPath(); ctx.moveTo(mcx + Math.cos(ma) * mrad * 0.85, mcy + Math.sin(ma) * mrad * 0.85); ctx.lineTo(mcx + Math.cos(ma) * mrad * 1.52, mcy + Math.sin(ma) * mrad * 1.52); ctx.stroke();
		}
		const mg = ctx.createLinearGradient(0, mcy - mrad, 0, mcy + mrad);
		mg.addColorStop(0, "#33425e"); mg.addColorStop(1, "#0b1220");
		ctx.beginPath(); ctx.arc(mcx, mcy, mrad, 0, Math.PI * 2); ctx.fillStyle = mg; ctx.fill();
		ctx.lineWidth = Math.max(1, px * 0.02); ctx.strokeStyle = "rgba(148,163,184,0.45)"; ctx.stroke();
		ctx.beginPath(); ctx.arc(mcx - mrad * 0.32, mcy - mrad * 0.34, mrad * 0.26, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.82)"; ctx.fill();
		ctx.restore();
		return c;
	}
	const imgId = (typeof color === "string" && color.indexOf("img:") === 0) ? color.slice(4) : null;
	if (imgId && AVATAR_IMAGES[imgId]) {
		const imgSrc = AVATAR_IMAGES[imgId];
		let aim = AVATAR_IMAGE_CACHE[imgSrc];
		const paint = () => {
			tileBg();
			ctx.save(); roundRectPath(ctx, 0.5, 0.5, px - 1, px - 1, corner); ctx.clip();
			const pad = px * 0.02;
			const s = Math.min((px - pad * 2) / (aim.naturalWidth || 1), (px - pad * 2) / (aim.naturalHeight || 1));
			const w = (aim.naturalWidth || px) * s, h = (aim.naturalHeight || px) * s;
			ctx.drawImage(aim, (px - w) / 2, (px - h) / 2, w, h);
			ctx.restore();
		};
		// One shared Image per preset: an already-loaded one paints synchronously (no blank first frame).
		if (aim && aim.complete && aim.naturalWidth) { paint(); return c; }
		tileBg();
		aim = aim || (AVATAR_IMAGE_CACHE[imgSrc] = new Image());
		aim.addEventListener("load", paint);
		if (!aim.src) aim.src = imgSrc;
		return c;
	}

	const poleX = px * 0.24, poleTop = px * 0.12, poleBot = px * 0.88;
	const clothLeft = poleX + px * 0.05;
	const Ax = clothLeft, Ay = px * 0.12, Bx = clothLeft + px * 0.56, By = px * 0.35, Cx = clothLeft, Cy = px * 0.58;
	const Gx = (Ax + Bx + Cx) / 3, Gy = (Ay + By + Cy) / 3;
	const Rmax = Math.max(Math.hypot(Ax - Gx, Ay - Gy), Math.hypot(Bx - Gx, By - Gy), Math.hypot(Cx - Gx, Cy - Gy));
	const side = Rmax * 2 * 1.06;
	const tri = () => { ctx.beginPath(); ctx.moveTo(Ax, Ay); ctx.lineTo(Bx, By); ctx.lineTo(Cx, Cy); ctx.closePath(); };
	const base = () => {
		ctx.clearRect(0, 0, px, px);
		roundRectPath(ctx, 0.5, 0.5, px - 1, px - 1, corner);
		ctx.fillStyle = "#1a2240"; ctx.fill();
		ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1; ctx.stroke();
		ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = Math.max(1, px * 0.045); ctx.lineCap = "round";
		ctx.beginPath(); ctx.moveTo(poleX, poleTop); ctx.lineTo(poleX, poleBot); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(poleX - px * 0.07, poleBot); ctx.lineTo(poleX + px * 0.07, poleBot); ctx.stroke();
	};
	const drawCountry = (img: HTMLImageElement) => {
		base();
		ctx.save(); tri(); ctx.clip(); ctx.drawImage(img, Gx - side / 2, Gy - side / 2, side, side); ctx.restore();
		tri(); ctx.strokeStyle = "rgba(0,0,0,0.30)"; ctx.lineWidth = Math.max(1, px * 0.025); ctx.stroke();
	};
	const drawPennant = () => { base(); tri(); ctx.fillStyle = color || DEFAULT_AVATAR_COLOR; ctx.fill(); };
	const drawPlaceholder = () => { base(); tri(); ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1; ctx.stroke(); };
	const flagSrc = country ? countryFlagSrc(country) : null;
	if (flagSrc) {
		let im = AVATAR_IMAGE_CACHE[flagSrc];
		if (im && im.complete && im.naturalWidth) drawCountry(im);
		else {
			drawPlaceholder();
			im = im || (AVATAR_IMAGE_CACHE[flagSrc] = new Image());
			im.addEventListener("load", () => drawCountry(im));
			if (!im.src) im.src = flagSrc;
		}
	} else {
		drawPennant();
	}
	return c;
}
