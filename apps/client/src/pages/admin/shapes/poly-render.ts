// Canvas painting for the shape playground. Same idea as game/board-render.ts, but the cell is a
// polygon instead of a rounded rectangle, so everything (the gap between cells, the digit, the flag,
// the mine) is sized off each cell's own radius rather than a shared cell size.

import { BOARD_SKINS, DPR } from "../../../game/board-render";
import { Tiling, Pt, pointInPoly } from "./tilings";
import { PolyGame, COVERED, REVEALED, FLAGGED } from "./poly-game";

// The skins stop at 8 because a square board stops at 8. A triangle touches twelve cells, so the
// high numbers get their own colours, carrying on the same warm-to-pale run.
const HIGH_NUMBERS: Record<number, string> = { 9: "#fdba74", 10: "#fb7185", 11: "#d8b4fe", 12: "#f8fafc" };

export interface Transform { scale: number; ox: number; oy: number; }

export function transformFor(cssW: number, cssH: number, tiling: Tiling, pad = 10): Transform {
	const scale = Math.min((cssW - pad * 2) / tiling.width, (cssH - pad * 2) / tiling.height);
	return { scale, ox: (cssW - tiling.width * scale) / 2, oy: (cssH - tiling.height * scale) / 2 };
}

export function cellAt(tiling: Tiling, t: Transform, x: number, y: number): number | null {
	const bx = (x - t.ox) / t.scale, by = (y - t.oy) / t.scale;
	for (let i = 0; i < tiling.polys.length; i++) {
		const [cx, cy] = tiling.centroids[i];
		const reach = tiling.radius[i] * 3;
		if (Math.abs(bx - cx) > reach || Math.abs(by - cy) > reach) continue;
		if (pointInPoly(tiling.polys[i], bx, by)) return i;
	}
	return null;
}

export interface PaintOpts {
	tiling: Tiling;
	game: PolyGame;
	skin: string;
	hover: number | null;
	xray: boolean;
	hint: number[];
	showSides: boolean;
}

function tracePath(ctx: CanvasRenderingContext2D, poly: Pt[], c: Pt, t: Transform, shrink: number) {
	ctx.beginPath();
	for (let i = 0; i < poly.length; i++) {
		const p = poly[i];
		const x = t.ox + (c[0] + (p[0] - c[0]) * shrink) * t.scale;
		const y = t.oy + (c[1] + (p[1] - c[1]) * shrink) * t.scale;
		if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
	}
	ctx.closePath();
}

function drawMine(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	ctx.lineWidth = Math.max(1, r * 0.22);
	ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, Math.PI * 2); ctx.fill();
	for (let k = 0; k < 4; k++) {
		const a = (k * Math.PI) / 4 + Math.PI / 8;
		ctx.beginPath();
		ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
		ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
		ctx.stroke();
	}
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, cloth: string, pole: string) {
	ctx.strokeStyle = pole;
	ctx.lineWidth = Math.max(1, r * 0.16);
	ctx.beginPath(); ctx.moveTo(x - r * 0.1, y - r * 0.75); ctx.lineTo(x - r * 0.1, y + r * 0.7); ctx.stroke();
	ctx.fillStyle = cloth;
	ctx.beginPath();
	ctx.moveTo(x - r * 0.1, y - r * 0.78);
	ctx.lineTo(x + r * 0.78, y - r * 0.32);
	ctx.lineTo(x - r * 0.1, y + r * 0.1);
	ctx.closePath(); ctx.fill();
}

export function paint(canvas: HTMLCanvasElement, o: PaintOpts) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const cssW = canvas.width / DPR, cssH = canvas.height / DPR;
	const t = transformFor(cssW, cssH, o.tiling);
	const skin = BOARD_SKINS[o.skin] || BOARD_SKINS.classic;
	const hint = new Set(o.hint);

	ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
	ctx.clearRect(0, 0, cssW, cssH);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";

	const { game, tiling } = o;
	for (let i = 0; i < tiling.polys.length; i++) {
		const poly = tiling.polys[i], c = tiling.centroids[i];
		const px = t.ox + c[0] * t.scale, py = t.oy + c[1] * t.scale;
		const r = tiling.radius[i] * t.scale;
		// A fixed gap in screen pixels, converted back into the per-cell shrink that produces it.
		const shrink = Math.max(0.55, 1 - 1.1 / Math.max(r, 2));
		const state = game.state[i];
		const isMine = !!game.mines[i];
		const showMine = isMine && (game.over || o.xray);
		tracePath(ctx, poly, c, t, shrink);

		if (state === REVEALED || (game.over && isMine)) {
			ctx.fillStyle = game.explodedAt === i ? "#7f1d1d" : skin.knownBg;
			ctx.fill();
			ctx.strokeStyle = skin.knownEdge;
			ctx.lineWidth = 1;
			ctx.stroke();
		} else {
			const g = ctx.createLinearGradient(px, py - r, px, py + r);
			g.addColorStop(0, skin.unknownTop);
			g.addColorStop(1, skin.unknownBottom);
			ctx.fillStyle = g;
			ctx.fill();
			if (o.hover === i && !game.over) { ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fill(); }
			if (hint.has(i)) { ctx.fillStyle = "rgba(34,197,94,0.55)"; ctx.fill(); }
			ctx.strokeStyle = skin.unknownEdge;
			ctx.lineWidth = 1;
			ctx.stroke();
		}
		if (o.xray && isMine && state !== REVEALED && !game.over) {
			ctx.strokeStyle = "rgba(252,165,165,0.85)";
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}

		if (state === FLAGGED) {
			drawFlag(ctx, px, py, Math.max(3, r * 0.8), skin.flagCloth, skin.flagPole);
		} else if (showMine) {
			drawMine(ctx, px, py, Math.max(2.5, r * 0.62), skin.mine);
		} else if (state === REVEALED) {
			const num = game.counts[i];
			if (num > 0) {
				const size = Math.max(10, r * (num > 9 ? 1.05 : 1.35));
				ctx.font = "700 " + size.toFixed(1) + "px " + skin.font;
				ctx.fillStyle = skin.numbers[num] || HIGH_NUMBERS[num] || skin.numbers[8];
				ctx.fillText(String(num), px, py + size * 0.04);
			}
		} else if (o.showSides) {
			const size = Math.max(6, r * 0.9);
			ctx.font = "600 " + size.toFixed(1) + "px " + skin.font;
			ctx.fillStyle = "rgba(255,255,255,0.65)";
			ctx.fillText(String(tiling.sides[i]), px, py);
		}
	}
}
