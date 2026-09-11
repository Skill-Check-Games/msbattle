// The live board engine: one object that owns what the legacy client kept as page globals for the
// local player's board (state, the mine decoder, focus, animations, the RAF loop) and offers the
// same operations (performAction with local prediction, server frames via applyServerState, the
// countdown and go sweeps, opponent thumbnails' mirrored reveal). React components mount a session
// on a canvas (GameBoard.tsx); pages decide what an action means (the `hooks`).
import { Explosion, makeExplosion, explosionLife } from "./explosion";
import BoardLogic from "core/src/common/BoardLogic.js";
import {
	BoardView, CellAnim, HoverKind, MINE, UNKNOWN, KNOWN, FLAGGED,
	REVEAL_DUR, FLAG_DUR, MINE_DUR, SETTLE_DUR, WAVE_STEP_MS, WAVE_MAX_MS,
	drawKnownBase, drawNumber, drawUnknown, roundRectPath, paletteHasGlow, localBoardSkin
} from "./board-render";

export type CellAt = (r: number, c: number) => number;
export interface ActionResult { revealed: number[][]; hitMine: boolean; anyChange: boolean; clearedFlags: number[][]; }
export interface SoundLike { cascade(n: number): void; mine(): void; flag(): void; unflag(): void; pulse?(): void; }
export interface SessionHooks {
	// Which kind of play this is right now, or null when input is ignored (between rounds, not started).
	mode: () => string | null;
	// Called after a local action changed the board (or a flag was placed); the page emits to the server.
	onAction?: (r: number, c: number, asFlag: boolean, result: ActionResult | null) => void;
	onAfterReveal?: (result: ActionResult) => void;
	onFlagPlaced?: () => void;
	rules?: () => { noFlags?: boolean; onlyFlags?: boolean; deathPenalty?: number } | null;
	onFreeze?: (until: number) => void;
	// The pointer moved over a cell of the local board (throttled by the caller); used to show the
	// cursor to opponents.
	onCursor?: (r: number, c: number) => void;
	sound?: SoundLike;
}

interface AnimEntry { type: CellAnim["type"]; start: number; }
const durOf = (type: CellAnim["type"]) => type === "flag" ? FLAG_DUR : type === "mine" ? MINE_DUR : type === "settle" ? SETTLE_DUR : REVEAL_DUR;

// ---- countdown glyphs (3, 2, 1 spelled out of covered cells) and the go sweep ----
const COUNTDOWN_GLYPHS: Record<string, string[]> = {
	"3": ["111", "001", "111", "001", "111"],
	"2": ["111", "001", "111", "100", "111"],
	"1": ["010", "110", "010", "010", "111"]
};
export const COUNTDOWN_STYLE = { fadeInMs: 200, holdMs: 300, fadeOutMs: 500, gapMs: 100 };
export const countdownTickMs = () => Math.max(50, COUNTDOWN_STYLE.fadeInMs + COUNTDOWN_STYLE.holdMs + COUNTDOWN_STYLE.fadeOutMs + COUNTDOWN_STYLE.gapMs);
export const BOARD_GO_STYLE = { durationMs: 700, width: 3, brightness: 0.7, color: "#bfdbfe", pauseAfterMs: 300 };
// Hovered chordable number: lift it and the cells its chord would open (false), or wiggle its digit (true).
export const NUMBER_HOVER_WIGGLE = false;
export const boardGoTotalMs = () => Math.max(0, BOARD_GO_STYLE.durationMs) + Math.max(0, BOARD_GO_STYLE.pauseAfterMs);
export const naturalCountdownTotalMs = () => boardGoTotalMs() + 3 * countdownTickMs();
export const BOARD_IDLE_STYLE = { speed: 3, brightness: 0.7, color: "#bfdbfe" };

interface RGB { r: number; g: number; b: number; }
function hexToRgb(hex: string): RGB {
	hex = (hex || "#bfdbfe").replace("#", "");
	if (hex.length === 3) hex = hex.split("").map(ch => ch + ch).join("");
	const num = parseInt(hex, 16) || 0;
	return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
const rgbaStr = (rgb: RGB, a: number) => "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + Math.max(0, Math.min(1, a)).toFixed(3) + ")";
const lightenRgb = (rgb: RGB, amt: number): RGB => ({ r: Math.round(rgb.r + (255 - rgb.r) * amt), g: Math.round(rgb.g + (255 - rgb.g) * amt), b: Math.round(rgb.b + (255 - rgb.b) * amt) });

interface GlyphState { glyph: string[]; scale: number; start: number; number: number; }

export class BoardSession {
	rows = 0; cols = 0;
	state: number[][] | null = null;
	prevState: number[][] | null = null;
	cellAt: CellAt = () => 0;
	canvas: HTMLCanvasElement | null = null;
	focusRingEl: HTMLElement | null = null;
	pressHighlightEl: HTMLElement | null = null;
	focusedR = 0; focusedC = 0; focusVisible = false;
	pressedCell: { r: number; c: number } | null = null;
	lastActionCell: { r: number; c: number } | null = null;
	frozenUntil = 0;
	skin: string | null = null;       // null: the local player's skin
	ownBoard = true;
	hooks: SessionHooks;
	// Style-challenge tracking (No Flags / Chord Master achievements): a flag placement or a direct
	// reveal of a covered cell flips these; chords do not. Reset by setBoard.
	clearNoFlag = true; clearNoReveal = true;
	// Puzzle hint highlights (drawn over the board).
	hintClues: number[][] = []; hintCovered: number[][] = [];

	private anims: Record<string, AnimEntry> = {};
	private raf: number | null = null;
	private glyphs: GlyphState[] = [];
	explosions: Explosion[] = [];   // mines that went off; ExplosionLayer paints them over (and past) the board
	private explosionListeners = new Set<() => void>();
	onExplosion(cb: () => void): () => void { this.explosionListeners.add(cb); return () => { this.explosionListeners.delete(cb); }; }
	private goAnim: { start: number } | null = null;
	private idleActive = false;
	// Hover (local board): the cell under the pointer and whether acting on it would do anything.
	private hover: { r: number; c: number } | null = null;
	private hoverKind: HoverKind = null;
	private hoverExtra: string[] = [];   // a hovered chordable number: the covered cells its chord would open
	// Mirror boards (opponents): the focus ring follows the last cell that changed when no live cursor
	// has been received, so bots and late joiners still show where play is happening.
	mirror = false;
	revealEffect: string | null = null;   // mirror boards: the opponent's chosen reveal effect
	private listeners = new Set<() => void>();

	constructor(hooks: SessionHooks) { this.hooks = hooks; }

	// ---- board lifecycle ----
	setBoard(rows: number, cols: number, cellAt: CellAt, state?: number[][] | null) {
		this.rows = rows; this.cols = cols; this.cellAt = cellAt;
		this.state = state || this.coveredState();
		this.prevState = this.clone(this.state);
		this.resetAnimations();
		this.focusedR = 0; this.focusedC = 0; this.focusVisible = false;
		this.clearNoFlag = true; this.clearNoReveal = true;
		this.hintClues = []; this.hintCovered = [];
		this.frozenUntil = 0;
		this.render();
		this.emitChange(); // GameBoard re-sizes its canvas to the new rows/cols
	}
	coveredState(): number[][] { const s: number[][] = []; for (let r = 0; r < this.rows; r++) s.push(new Array(this.cols).fill(UNKNOWN)); return s; }
	clone(state: number[][]): number[][] { return state.map(row => row.slice()); }
	clear() { this.state = null; this.prevState = null; this.resetAnimations(); this.render(); }
	// A frame from the server (draw_board): diff against the last seen state and animate the changes.
	applyServerState(state: number[][]) {
		if (!this.state) { this.state = state; this.prevState = this.clone(state); this.render(); return; }
		if (this.mirror) this.trackMirrorFocus(state);
		this.state = state;
		this.queueRevealAnimations(state);
		this.prevState = this.clone(state);
	}
	// Mirror boards: point the focus ring at what just changed (the one cell, or the centre of a cascade).
	// If the ring was already walking toward a cell that changed, it lands there instead.
	private trackMirrorFocus(state: number[][]) {
		if (!this.prevState) return;
		let n = 0, sr = 0, sc = 0, nearTarget = true;
		const t = this.travel || this.lastTarget;
		for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) if (state[r][c] !== this.prevState[r][c]) { n++; sr += r; sc += c; if (t && (Math.abs(r - t.r) > 1 || Math.abs(c - t.c) > 1)) nearTarget = false; }
		if (!n) return;
		this.stopTravel();
		// An announced cell that just acted (itself or its neighbours, a chord) is where the ring lands;
		// anything else, such as a cascade, lands on the centre of what changed.
		if (t && nearTarget) { this.focusedR = t.r; this.focusedC = t.c; } else { this.focusedR = Math.round(sr / n); this.focusedC = Math.round(sc / n); }
		this.focusVisible = true; this.lastTarget = null;
	}
	// A live cursor from an opponent: the focus ring moves there. A human's pointer just snaps (it is a
	// continuous stream). A bot announces its next cell with the time until it clicks, and the ring walks
	// there one cell at a time, longer axis first, like a player steering with the keyboard, timed to
	// arrive just before the click.
	private travel: { r: number; c: number; timer: number } | null = null;
	private lastTarget: { r: number; c: number } | null = null;
	private stopTravel() { if (this.travel) { clearTimeout(this.travel.timer); this.travel = null; } }
	setMirrorFocus(r: number, c: number, etaMs?: number) {
		if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return;
		this.stopTravel(); this.lastTarget = { r, c };
		if (etaMs == null || !this.focusVisible) { this.focusedR = r; this.focusedC = c; this.focusVisible = true; this.updateFocusOverlay(); return; }
		const steps = Math.abs(r - this.focusedR) + Math.abs(c - this.focusedC);
		if (!steps) return;
		const interval = Math.max(28, Math.min(110, (etaMs - 140) / steps));
		const step = () => {
			const dr = r - this.focusedR, dc = c - this.focusedC;
			if (Math.abs(dr) >= Math.abs(dc) && dr) this.focusedR += Math.sign(dr); else if (dc) this.focusedC += Math.sign(dc);
			this.updateFocusOverlay();
			if (this.focusedR === r && this.focusedC === c) { this.travel = null; this.lastTarget = { r, c }; return; }
			this.travel = { r, c, timer: window.setTimeout(step, interval) };
		};
		this.travel = { r, c, timer: window.setTimeout(step, Math.min(interval, 60)) };
	}

	// ---- chord ----
	// The covered cells a click on the number at (r, c) would open, or null when it is not chordable:
	// its flagged neighbours plus any neighbouring mines already shown must match the number, and
	// something covered must remain. Hover and the click itself share this, so they can never disagree.
	private chordTargets(r: number, c: number): number[][] | null {
		const s = this.state; if (!s || s[r][c] !== KNOWN) return null;
		const clue = this.cellAt(r, c); if (clue <= 0) return null;
		const ctx = BoardLogic.chordContext(r, c, this.rows, this.cols,
			(rr: number, cc: number) => s[rr][cc] === FLAGGED,
			(rr: number, cc: number) => s[rr][cc] === KNOWN && this.cellAt(rr, cc) === MINE,
			(rr: number, cc: number) => s[rr][cc] === UNKNOWN);
		return ctx.flagCount === clue && ctx.covered.length ? ctx.covered : null;
	}

	// ---- hover (local board) ----
	// Whether acting on (r, c) would do anything: a covered cell can be opened or flagged; a number
	// can be chorded when chordTargets says so.
	private clickableKind(r: number, c: number): HoverKind {
		const s = this.state; if (!s || !this.hooks.mode() || this.isFrozen()) return null;
		const v = s[r][c];
		if (v === UNKNOWN || v === FLAGGED) return "cell";
		return this.chordTargets(r, c) ? "chord" : null;
	}
	// The cell the player is pointing at: the mouse hover, or, with the keyboard cursor showing, the focused
	// cell. Both get the same treatment (the lift, and the cells a chord would open lifting with it).
	private attention(): { r: number; c: number } | null {
		if (this.hover) return this.hover;
		if (this.focusVisible && !this.mirror && this.focusedR >= 0 && this.focusedR < this.rows && this.focusedC >= 0 && this.focusedC < this.cols) return { r: this.focusedR, c: this.focusedC };
		return null;
	}
	private attentionKeys(): string[] { const a = this.attention(); const keys = [...this.hoverExtra]; if (a) keys.push(a.r + "," + a.c); return keys; }
	private refreshHoverKind() {
		const at = this.attention();
		const kind = at ? this.clickableKind(at.r, at.c) : null;
		this.hoverKind = kind;
		this.hoverExtra = [];
		if (kind === "chord" && at) for (const cell of this.chordTargets(at.r, at.c) || []) this.hoverExtra.push(cell[0] + "," + cell[1]);
		if (this.canvas) this.canvas.style.cursor = this.hover && kind ? "pointer" : "";
		if (NUMBER_HOVER_WIGGLE && kind === "chord") this.startAnimLoop();
	}
	setHover(cell: { r: number; c: number } | null) {
		const prev = this.hover;
		if ((prev ? prev.r + "," + prev.c : "") === (cell ? cell.r + "," + cell.c : "")) return;
		const keys = this.attentionKeys();
		this.hover = cell;
		this.refreshHoverKind();
		keys.push(...this.attentionKeys());
		this.render(keys);
		if (cell) this.hooks.onCursor?.(cell.r, cell.c);
	}
	// The keyboard cursor moved (or showed/hid): repaint the cells that lose and gain the lift.
	focusChanged(prevR: number, prevC: number) {
		const keys = [...this.hoverExtra, prevR + "," + prevC];
		this.refreshHoverKind();
		keys.push(...this.attentionKeys());
		this.render(keys);
		this.updateFocusOverlay();
	}
	subscribe(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
	private emitChange() { this.listeners.forEach(cb => cb()); }

	// ---- counting ----
	countKnown(): number { let n = 0; if (!this.state) return 0; for (const row of this.state) for (const v of row) if (v === KNOWN) n++; return n; }
	countFlags(): number { let n = 0; if (!this.state) return 0; for (const row of this.state) for (const v of row) if (v === FLAGGED) n++; return n; }

	// ---- local prediction ----
	private localReveal(r: number, c: number, revealed: number[][]): boolean {
		const s = this.state!;
		return BoardLogic.cascadeReveal(r, c, this.rows, this.cols,
			(rr: number, cc: number) => s[rr][cc] === UNKNOWN || s[rr][cc] === FLAGGED,
			(rr: number, cc: number) => { s[rr][cc] = KNOWN; revealed.push([rr, cc]); return this.cellAt(rr, cc) === MINE; },
			(rr: number, cc: number) => this.cellAt(rr, cc));
	}
	applyLocalLeftClick(r: number, c: number): ActionResult {
		const s = this.state;
		if (!s) return { revealed: [], hitMine: false, anyChange: false, clearedFlags: [] };
		const revealed: number[][] = [], clearedFlags: number[][] = [];
		let hitMine = false;
		if (s[r][c] === UNKNOWN) {
			hitMine = this.localReveal(r, c, revealed);
		} else if (s[r][c] === KNOWN) {
			const targets = this.chordTargets(r, c);
			if (targets) {
				for (const cell of targets) if (this.localReveal(cell[0], cell[1], revealed)) hitMine = true;
				if (hitMine) { // a detonating chord clears every wrong flag around the number
					for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
						if (!dr && !dc) continue;
						const nr = r + dr, nc = c + dc;
						if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols) continue;
						if (s[nr][nc] === FLAGGED && this.cellAt(nr, nc) !== MINE) { s[nr][nc] = UNKNOWN; clearedFlags.push([nr, nc]); }
					}
				}
			}
		}
		return { revealed, hitMine, anyChange: revealed.length > 0 || clearedFlags.length > 0, clearedFlags };
	}
	revealAt(r: number, c: number): ActionResult {
		this.lastActionCell = { r, c };
		const result = this.applyLocalLeftClick(r, c);
		if (result.anyChange) { this.queueRevealAnimations(this.state!); this.prevState = this.clone(this.state!); }
		return result;
	}
	placeFlag(r: number, c: number) {
		const s = this.state; if (!s) return;
		const key = r + "," + c, now = performance.now();
		if (s[r][c] === UNKNOWN) {
			s[r][c] = FLAGGED; if (this.prevState) this.prevState[r][c] = FLAGGED;
			this.anims[key] = { type: "flag", start: now }; this.startAnimLoop(); this.hooks.sound?.flag();
		} else if (s[r][c] === FLAGGED) {
			s[r][c] = UNKNOWN; if (this.prevState) this.prevState[r][c] = UNKNOWN;
			this.anims[key] = { type: "settle", start: now }; this.startAnimLoop(); this.hooks.sound?.unflag();
		}
	}
	// One player action at a cell. Returns whether the board actually changed.
	performAction(r: number, c: number, asFlag: boolean): boolean {
		const mode = this.hooks.mode();
		if (!mode || !this.state) return false;
		if (Date.now() < this.frozenUntil) return false;
		if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
		const rules = this.hooks.rules ? this.hooks.rules() : null;
		if (rules) {
			if (rules.noFlags && asFlag) return false;
			if (rules.onlyFlags && !asFlag) { if (this.state[r][c] !== KNOWN) return false; asFlag = true; }
		}
		this.focusedR = r; this.focusedC = c;
		let result: ActionResult | null = null, didChange = false;
		if (asFlag) {
			if (this.state[r][c] === KNOWN) {
				result = this.revealAt(r, c); didChange = result.anyChange;
				if (result.hitMine && rules && rules.deathPenalty) this.freeze(rules.deathPenalty * 1000);
				if (result.anyChange || result.hitMine) this.hooks.onAfterReveal?.(result);
			} else {
				this.placeFlag(r, c); didChange = true; this.clearNoFlag = false;
				this.hooks.onFlagPlaced?.();
			}
		} else {
			const wasCovered = this.state[r][c] === UNKNOWN;
			result = this.revealAt(r, c); didChange = result.anyChange;
			if (wasCovered) this.clearNoReveal = false;
			if (result.hitMine && rules && rules.deathPenalty) this.freeze(rules.deathPenalty * 1000);
			if (result.anyChange || result.hitMine) this.hooks.onAfterReveal?.(result);
		}
		this.hooks.onAction?.(r, c, asFlag, result);
		this.updateFocusOverlay();
		this.emitChange();
		return didChange;
	}
	// A mine hit: nothing on the board responds until the penalty has run, and the hover lift goes at once.
	freeze(ms: number) { this.frozenUntil = Date.now() + ms; this.setHover(null); this.hooks.onFreeze?.(this.frozenUntil); }
	isFrozen() { return Date.now() < this.frozenUntil; }

	// ---- focus (keyboard cursor) ----
	stepFocus(dr: number, dc: number, skipRevealed: boolean): boolean {
		if (skipRevealed && this.state) {
			let nr = this.focusedR + dr, nc = this.focusedC + dc;
			while (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
				if (this.state[nr][nc] === UNKNOWN) { this.focusedR = nr; this.focusedC = nc; return true; }
				nr += dr; nc += dc;
			}
			return false;
		}
		const tr = Math.max(0, Math.min(this.rows - 1, this.focusedR + dr)), tc = Math.max(0, Math.min(this.cols - 1, this.focusedC + dc));
		if (tr === this.focusedR && tc === this.focusedC) return false;
		this.focusedR = tr; this.focusedC = tc; return true;
	}
	jumpToNextUnknown(forward: boolean): boolean {
		if (!this.state) return false;
		const total = this.rows * this.cols, start = this.focusedR * this.cols + this.focusedC;
		for (let i = 1; i <= total; i++) {
			const idx = forward ? (start + i) % total : (start - i + total) % total;
			const r = Math.floor(idx / this.cols), c = idx % this.cols;
			if (this.state[r][c] === UNKNOWN) { this.focusedR = r; this.focusedC = c; return true; }
		}
		return false;
	}
	cellFromClient(clientX: number, clientY: number): { r: number; c: number } | null {
		const canvas = this.canvas; if (!canvas) return null;
		const rect = canvas.getBoundingClientRect();
		let bx = clientX - rect.left, by = clientY - rect.top, boxW = rect.width, boxH = rect.height;
		if (document.body.classList.contains("duel-force-rotate")) { // CSS-rotated board: undo the rotation for hit-testing
			const preW = canvas.offsetWidth, preH = canvas.offsetHeight;
			const ox = by, oy = preH - bx; bx = ox; by = oy; boxW = preW; boxH = preH;
		}
		const c = Math.floor(bx / boxW * this.cols), r = Math.floor(by / boxH * this.rows);
		if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
		return { r, c };
	}

	// ---- overlays (DOM elements positioned over the canvas) ----
	private positionOverlay(el: HTMLElement, r: number, c: number) {
		const canvas = this.canvas!;
		const cw = canvas.clientWidth, ch = canvas.clientHeight;
		if (!cw || !ch) { el.hidden = true; return; }
		const sw = cw / this.cols, sh = ch / this.rows, gap = Math.max(1, Math.round(Math.min(sw, sh) * 0.08));
		el.style.left = (canvas.offsetLeft + c * sw + gap / 2) + "px"; el.style.top = (canvas.offsetTop + r * sh + gap / 2) + "px";
		el.style.width = (sw - gap) + "px"; el.style.height = (sh - gap) + "px";
		el.hidden = false;
	}
	updateFocusOverlay() {
		const el = this.focusRingEl; if (!el || !this.canvas) return;
		if (!this.focusVisible || !this.hooks.mode() || this.focusedR < 0 || this.focusedR >= this.rows || this.focusedC < 0 || this.focusedC >= this.cols) { el.hidden = true; return; }
		this.positionOverlay(el, this.focusedR, this.focusedC);
	}
	updatePressOverlay() {
		const el = this.pressHighlightEl; if (!el || !this.canvas) return;
		const p = this.pressedCell;
		if (!p || !this.state || !this.hooks.mode() || p.r < 0 || p.r >= this.rows || p.c < 0 || p.c >= this.cols) { el.hidden = true; return; }
		this.positionOverlay(el, p.r, p.c);
	}
	setPressed(cell: { r: number; c: number } | null) { this.pressedCell = cell; this.updatePressOverlay(); }

	// ---- animations ----
	private canPartialRepaint(): boolean {
		if (this.goAnim || this.idleActive) return false;
		if (paletteHasGlow()) return false; // glow digits bleed past their cell
		if (this.glyphs.length) return false;
		if (this.hintClues.length || this.hintCovered.length) return false;
		return true;
	}
	private view(canvas: HTMLCanvasElement, state: number[][], skin: string | null): BoardView {
		return new BoardView(canvas, this.rows, this.cols, state, this.cellAt, { skin, ownBoard: canvas === this.canvas && this.ownBoard, forceRevealEffect: this.mirror ? (this.revealEffect || "ripple") : null, wiggleHover: NUMBER_HOVER_WIGGLE, hoverAt: this.attention() ? (r, c) => { const a = this.attention(); return a && a.r === r && a.c === c ? this.hoverKind : this.hoverExtra.length && this.hoverExtra.indexOf(r + "," + c) !== -1 ? "peek" : null; } : null });
	}
	// Paint the board; dirtyKeys ("r,c") limits the repaint to those cells and their neighbours.
	render(dirtyKeys?: string[]) {
		const canvas = this.canvas; if (!canvas) return;
		this.refreshHoverKind();
		if (this.state) {
			const now = performance.now();
			const bv = this.view(canvas, this.state, this.skin || localBoardSkin);
			bv.animAt = (r, c) => { const a = this.anims[r + "," + c]; return a ? { type: a.type, t: (now - a.start) / durOf(a.type) } : null; };
			bv.overlay((ctx, sw, sh) => {
				this.paintCountdown(ctx, sw, sh);
				const isRevealed = (r: number, c: number) => this.state![r][c] === KNOWN;
				if (this.goAnim) {
					if (!this.paintGoWithIdle(ctx, sw, sh, isRevealed)) { this.goAnim = null; this.setIdle(false); }
				} else if (this.idleActive) this.paintIdle(ctx, sw, sh, isRevealed);
				this.paintHints(ctx, sw, sh);
			});
			if (dirtyKeys && this.canPartialRepaint()) {
				const dirty: number[][] = [], seen: Record<string, boolean> = {};
				for (const key of dirtyKeys) {
					const [dr, dc] = key.split(",").map(Number);
					for (let nr = dr - 1; nr <= dr + 1; nr++) for (let nc = dc - 1; nc <= dc + 1; nc++) {
						if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols) continue;
						const k = nr + "," + nc; if (!seen[k]) { seen[k] = true; dirty.push([nr, nc]); }
					}
				}
				bv.draw(dirty);
			} else bv.draw();
		} else {
			const ctx = canvas.getContext("2d")!;
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			if (this.idleActive && this.rows && this.cols) { // waiting for a series: a covered board that twinkles
				const isw = canvas.width / this.cols, ish = canvas.height / this.rows, igap = Math.max(1, Math.round(Math.min(isw, ish) * 0.08));
				const iw = isw - igap, ih = ish - igap, irad = Math.min(iw, ih) * 0.2;
				for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) { ctx.save(); ctx.translate(c * isw + igap / 2, r * ish + igap / 2); drawUnknown(ctx, iw, ih, irad); ctx.restore(); }
				this.paintIdle(ctx, isw, ish, null);
			}
		}
		this.updatePressOverlay();
		this.updateFocusOverlay();
	}
	// Drops every in-flight cell animation. The idle twinkle is a mode, not an animation: if it is on it
	// keeps running across the reset, so the board never freezes between the search, the match being
	// found and the countdown (each of those resets the board).
	resetAnimations() {
		this.prevState = this.state ? this.clone(this.state) : null;
		this.anims = {}; this.lastActionCell = null; this.glyphs = []; this.goAnim = null; this.explosions = [];
		if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
		if (this.idleActive) this.startAnimLoop();
	}
	// Wave order: breadth-first through the revealed set from the clicked tile, so the animation spreads
	// outward the way the flood did; unreachable cells fall back to straight-line distance.
	private waveDepths(revealed: number[][], origin: { r: number; c: number }): Record<string, number> {
		const inSet: Record<string, boolean> = {}, depth: Record<string, number> = {}, queue: number[][] = [];
		for (const cell of revealed) inSet[cell[0] + "," + cell[1]] = true;
		const or = Math.round(origin.r), oc = Math.round(origin.c), oKey = or + "," + oc;
		const visit = (nr: number, nc: number, d: number) => { const k = nr + "," + nc; if (inSet[k] && depth[k] === undefined) { depth[k] = d; queue.push([nr, nc]); } };
		if (inSet[oKey]) visit(or, oc, 0);
		else BoardLogic.forEachNeighbour(or, oc, this.rows, this.cols, (nr: number, nc: number) => visit(nr, nc, 1));
		for (let qi = 0; qi < queue.length; qi++) {
			const cur = queue[qi], d0 = depth[cur[0] + "," + cur[1]];
			BoardLogic.forEachNeighbour(cur[0], cur[1], this.rows, this.cols, (nr: number, nc: number) => visit(nr, nc, d0 + 1));
		}
		for (const cell of revealed) { const k = cell[0] + "," + cell[1]; if (depth[k] === undefined) depth[k] = Math.round(Math.hypot(cell[0] - origin.r, cell[1] - origin.c)); }
		return depth;
	}
	queueRevealAnimations(newState: number[][]) {
		const now = performance.now(), revealed: number[][] = [];
		let newlyFlagged = 0, newlyUnflagged = 0;
		for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
			const was = this.prevState ? this.prevState[r][c] : UNKNOWN, cur = newState[r][c];
			if (cur === was) continue;
			const key = r + "," + c;
			if (cur === KNOWN && was !== KNOWN) revealed.push([r, c]);
			else if (cur === FLAGGED && was !== FLAGGED) { this.anims[key] = { type: "flag", start: now }; newlyFlagged++; }
			else if (cur !== KNOWN && cur !== FLAGGED) { if (was === FLAGGED) newlyUnflagged++; this.anims[key] = { type: "settle", start: now }; }
		}
		let hitMine = false, safeRevealed = 0;
		if (revealed.length) {
			let origin = this.lastActionCell;
			if (!origin || newState[origin.r][origin.c] !== KNOWN) {
				let sr = 0, sc = 0; for (const cell of revealed) { sr += cell[0]; sc += cell[1]; }
				origin = { r: sr / revealed.length, c: sc / revealed.length };
			}
			const depths = this.waveDepths(revealed, origin);
			let maxDepth = 0; for (const k in depths) if (depths[k] > maxDepth) maxDepth = depths[k];
			const step = maxDepth > 0 ? Math.min(WAVE_STEP_MS, WAVE_MAX_MS / maxDepth) : WAVE_STEP_MS;
			for (const cell of revealed) {
				const isMine = this.cellAt(cell[0], cell[1]) === MINE;
				if (isMine) { hitMine = true; this.explosions.push(makeExplosion(cell[0], cell[1], now)); } else safeRevealed++;
				this.anims[cell[0] + "," + cell[1]] = { type: isMine ? "mine" : "reveal", start: now + depths[cell[0] + "," + cell[1]] * step };
			}
			if (hitMine) { this.triggerShake(); this.startAnimLoop(); this.explosionListeners.forEach(cb => cb()); }
		}
		const snd = this.hooks.sound;
		if (snd) {
			if (safeRevealed > 0) snd.cascade(safeRevealed);
			if (hitMine) snd.mine();
			if (newlyFlagged > 0) snd.flag();
			if (newlyUnflagged > 0) snd.unflag();
			if (snd.pulse) { const pulses = (safeRevealed > 0 ? Math.min(safeRevealed, 4) : 0) + (newlyFlagged > 0 ? 1 : 0) + (newlyUnflagged > 0 ? 1 : 0); for (let i = 0; i < pulses; i++) snd.pulse(); }
		}
		this.startAnimLoop();
	}
	startAnimLoop() {
		if (this.raf) return;
		const step = () => {
			const now = performance.now();
			let alive = false;
			const keys = Object.keys(this.anims);
			for (const key of keys) { const a = this.anims[key]; if (now >= a.start + durOf(a.type)) delete this.anims[key]; else alive = true; }
			this.explosions = this.explosions.filter(e => now - e.start < explosionLife(e, this.frozenUntil, now));
			if (this.glyphs.length || this.goAnim || this.idleActive || this.explosions.length) alive = true;
			// A hovered chordable number wiggles, so its cell repaints every frame while the pointer is on it.
			if (NUMBER_HOVER_WIGGLE && this.hoverKind === "chord" && this.hover) { keys.push(this.hover.r + "," + this.hover.c); alive = true; }
			this.render(keys);
			if (alive) this.raf = requestAnimationFrame(step);
			else { this.raf = null; this.render(); }
		};
		this.raf = requestAnimationFrame(step);
	}
	// Shakes the whole board card when the canvas sits in one (an ancestor marked data-shake-host, e.g.
	// the duel arena), else the canvas inside its padded scroll container (GameBoard) so nothing clips.
	// Driven through the Web Animations API rather than a class: React owns the host's className and
	// rewrites it on the very render the mine hit triggers (the card turns red), which would drop a class.
	triggerShake() {
		const canvas = this.canvas; if (!canvas) return;
		const el = (canvas.closest("[data-shake-host]") as HTMLElement | null) || canvas;
		if (typeof el.animate !== "function") return;
		el.animate([
			{ transform: "translate(0, 0)" }, { transform: "translate(-5px, 2px)" }, { transform: "translate(5px, -2px)" },
			{ transform: "translate(-4px, 1px)" }, { transform: "translate(4px, -1px)" }, { transform: "translate(0, 0)" },
		], { duration: 350, easing: "ease" });
	}

	// ---- countdown / go / idle ----
	// at: a shared timestamp so every board in view (yours and the mirrors) runs the same digit off the same
	// clock; the first frame is painted right away rather than on the next animation tick for the same reason.
	startCountdownGlyph(number: number, at = performance.now()) {
		const glyph = COUNTDOWN_GLYPHS[String(number)]; if (!glyph || !this.rows) return;
		this.glyphs.push({ glyph, scale: Math.max(1, Math.round(this.rows / 10)), start: at, number });
		this.startAnimLoop(); this.render();
	}
	private paintCountdown(ctx: CanvasRenderingContext2D, sw: number, sh: number) {
		if (!this.state) return;
		const alive: GlyphState[] = [];
		for (const g of this.glyphs) if (this.paintGlyph(ctx, sw, sh, g)) alive.push(g);
		this.glyphs = alive;
	}
	private paintGlyph(ctx: CanvasRenderingContext2D, sw: number, sh: number, g: GlyphState): boolean {
		const elapsed = performance.now() - g.start;
		const { fadeInMs, holdMs, fadeOutMs } = COUNTDOWN_STYLE;
		let alpha: number;
		if (elapsed < fadeInMs) alpha = fadeInMs > 0 ? elapsed / fadeInMs : 1;
		else if (elapsed < fadeInMs + holdMs) alpha = 1;
		else alpha = fadeOutMs > 0 ? Math.max(0, 1 - (elapsed - fadeInMs - holdMs) / fadeOutMs) : 0;
		if (alpha <= 0) return false;
		const glyphRows = g.glyph.length * g.scale, glyphCols = g.glyph[0].length * g.scale;
		const startRow = Math.floor((this.rows - glyphRows) / 2), startCol = Math.floor((this.cols - glyphCols) / 2);
		const gap = Math.max(1, Math.round(Math.min(sw, sh) * 0.08)), w = sw - gap, h = sh - gap, rad = Math.min(w, h) * 0.2;
		for (let gr = 0; gr < g.glyph.length; gr++) for (let gc = 0; gc < g.glyph[gr].length; gc++) {
			if (g.glyph[gr].charAt(gc) !== "1") continue;
			for (let sr = 0; sr < g.scale; sr++) for (let sc = 0; sc < g.scale; sc++) {
				const r = startRow + gr * g.scale + sr, c = startCol + gc * g.scale + sc;
				if (r < 0 || r >= this.rows || c < 0 || c >= this.cols || this.state![r][c] === KNOWN) continue;
				ctx.save(); ctx.translate(c * sw + gap / 2, r * sh + gap / 2); ctx.globalAlpha = alpha;
				drawKnownBase(ctx, w, h, rad); drawNumber(ctx, g.number, w, h, alpha);
				ctx.restore();
			}
		}
		return true;
	}
	startBoardGo() { if (!this.rows || !this.cols) { this.goAnim = null; return; } this.goAnim = { start: performance.now() }; this.startAnimLoop(); }
	setIdle(active: boolean) {
		if (active && this.idleSuppressed) return;
		if (!active) this.idleFade = null;
		if (active === this.idleActive) return;
		this.idleActive = active; if (active) this.startAnimLoop(); else this.render();
	}
	private goFront(): { frontP: number; width: number; maxP: number } | null {
		if (!this.goAnim) return null;
		const duration = Math.max(50, BOARD_GO_STYLE.durationMs), elapsed = performance.now() - this.goAnim.start;
		if (elapsed >= duration) return null;
		const width = Math.max(0.5, BOARD_GO_STYLE.width), maxP = this.rows - 1 + this.cols - 1; // diagonal sweep
		return { frontP: (elapsed / duration) * (maxP + width * 2) - width, width, maxP };
	}
	private drawGoCell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number, alpha: number, base: RGB) {
		ctx.save(); ctx.translate(x, y); ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
		ctx.shadowBlur = Math.max(0, w * 0.6); ctx.shadowColor = rgbaStr(base, 0.8);
		const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, rgbaStr(lightenRgb(base, 0.85), 0.92)); g.addColorStop(1, rgbaStr(lightenRgb(base, 0.32), 0.78));
		roundRectPath(ctx, 0, 0, w, h, rad); ctx.fillStyle = g; ctx.fill(); ctx.shadowBlur = 0; ctx.restore();
	}
	private idleAlpha(r: number, c: number, now: number, fade = 1): number {
		const seed = ((r * 928371 + c * 123457) % 1000) / 1000;
		const wave = Math.sin((now / 1000) * BOARD_IDLE_STYLE.speed * (0.4 + seed * 0.6) + seed * Math.PI * 2);
		return Math.max(0, wave) * 0.28 * BOARD_IDLE_STYLE.brightness * fade;
	}
	// The fade factor for this frame, computed once so every cell of the frame shares it; the fade ends
	// (idle off) only after the whole frame has painted, never halfway through it.
	private idleFadeFactor(now: number): number {
		if (!this.idleFade) return 1;
		return Math.max(0, 1 - (now - this.idleFade.start) / this.idleFade.dur);
	}
	private endIdleFadeIfDone(fade: number) { if (this.idleFade && fade <= 0) { this.idleFade = null; this.idleActive = false; } }
	// Fades the idle twinkle out over fadeMs and keeps it off (until the next search starts it again),
	// so a stray "planning" room update cannot bring it back mid-sequence.
	private idleFade: { start: number; dur: number } | null = null;
	idleSuppressed = false;
	fadeIdleOut(fadeMs: number) {
		this.idleSuppressed = true;
		if (!this.idleActive || this.idleFade) return;
		this.idleFade = { start: performance.now(), dur: Math.max(50, fadeMs) };
		this.startAnimLoop();
	}
	private drawIdleCell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number, alpha: number, base: RGB) {
		ctx.save(); ctx.translate(x, y); ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
		roundRectPath(ctx, 0, 0, w, h, rad); ctx.fillStyle = rgbaStr(lightenRgb(base, 0.5), 1); ctx.fill(); ctx.restore();
	}
	private paintGoWithIdle(ctx: CanvasRenderingContext2D, sw: number, sh: number, isRevealed: (r: number, c: number) => boolean): boolean {
		const f = this.goFront(); if (!f) return false;
		const base = hexToRgb(BOARD_GO_STYLE.color), idleBase = hexToRgb(BOARD_IDLE_STYLE.color), now = performance.now();
		const gap = Math.max(1, Math.round(Math.min(sw, sh) * 0.08)), w = sw - gap, h = sh - gap, rad = Math.min(w, h) * 0.2;
		for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
			if (isRevealed(r, c)) continue;
			const pos = r + c, dist = Math.abs(pos - f.frontP);
			if (dist <= f.width) this.drawGoCell(ctx, c * sw + gap / 2, r * sh + gap / 2, w, h, rad, (1 - dist / f.width) * BOARD_GO_STYLE.brightness, base);
			else if (pos > f.frontP) { const a = this.idleAlpha(r, c, now); if (a > 0.015) this.drawIdleCell(ctx, c * sw + gap / 2, r * sh + gap / 2, w, h, rad, a, idleBase); }
		}
		return true;
	}
	private paintIdle(ctx: CanvasRenderingContext2D, sw: number, sh: number, isRevealed: ((r: number, c: number) => boolean) | null) {
		const now = performance.now(), base = hexToRgb(BOARD_IDLE_STYLE.color), fade = this.idleFadeFactor(now);
		const gap = Math.max(1, Math.round(Math.min(sw, sh) * 0.08)), w = sw - gap, h = sh - gap, rad = Math.min(w, h) * 0.2;
		if (fade > 0) for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
			if (isRevealed && isRevealed(r, c)) continue;
			const a = this.idleAlpha(r, c, now, fade); if (a <= 0.015) continue;
			this.drawIdleCell(ctx, c * sw + gap / 2, r * sh + gap / 2, w, h, rad, a, base);
		}
		this.endIdleFadeIfDone(fade);
	}
	private paintHints(ctx: CanvasRenderingContext2D, sw: number, sh: number) {
		if (!this.hintClues.length && !this.hintCovered.length) return;
		const gap = Math.max(1, Math.round(Math.min(sw, sh) * 0.08));
		ctx.save();
		ctx.strokeStyle = "rgba(251, 191, 36, 0.55)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
		for (const rc of this.hintCovered) { roundRectPath(ctx, rc[1] * sw + gap / 2, rc[0] * sh + gap / 2, sw - gap, sh - gap, (Math.min(sw, sh) - gap) * 0.2); ctx.stroke(); }
		ctx.setLineDash([]); ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 3; ctx.shadowBlur = 14; ctx.shadowColor = "rgba(251, 191, 36, 0.9)";
		for (const rc of this.hintClues) { roundRectPath(ctx, rc[1] * sw + gap / 2, rc[0] * sh + gap / 2, sw - gap, sh - gap, (Math.min(sw, sh) - gap) * 0.2); ctx.stroke(); }
		ctx.restore();
	}

}
