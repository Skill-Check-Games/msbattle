// Looping rule demo: highlights a clue cell, then flags/reveals its targets one at a time, holds,
// and sweeps (a light band, top to bottom) into the next scene on the same canvas.
import { useEffect, useRef } from "react";
import BoardLogic from "core/src/common/BoardLogic.js";
import { BoardView, UNKNOWN, KNOWN, FLAGGED, sizeCellCanvas, drawCell, setPaletteVars, roundRectPath, localBoardSkin } from "../../game/board-render";
import { buildModel, drawOutlines, LEARN_CELL_PX } from "./learn-model";
import type { DemoScene } from "./learn-data";
import styles from "./LearnPage.module.scss";

const SWEEP_MS = 700, SWEEP_WIDTH = 3;

export default function RuleDemo({ scenes }: { scenes: DemoScene[] }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current; if (!canvas || !scenes.length) return;
		const R = scenes[0].rows, C = scenes[0].cols;
		sizeCellCanvas(canvas, C, R, LEARN_CELL_PX);
		let alive = true; const timers: number[] = []; let raf = 0;
		const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(() => { if (alive) fn(); }, ms)); };

		function buildScene(spec: DemoScene, onDone: () => void) {
			const m = buildModel(spec);
			let highlight: number[] | null = null;
			const bv = new BoardView(canvas!, R, C, m.state, m.cellAt, { xray: spec.xray, skin: spec.skin || null });
			bv.overlay((ctx, sw, sh) => { if (highlight) drawOutlines(ctx, sw, sh, [highlight], "rgba(250, 204, 21, 0.95)", "rgba(250, 204, 21, 0.7)"); });
			const targets = spec.targets || [], targetState = spec.action === "flag" ? FLAGGED : KNOWN;
			function playFrom(i: number) {
				if (i === 0) { highlight = spec.clueCell || null; bv.draw(); later(() => playFrom(1), 750); return; }
				if (spec.revealFrom) {
					if (i === 1) {
						BoardLogic.cascadeReveal(spec.revealFrom[0], spec.revealFrom[1], R, C,
							(r: number, c: number) => m.state[r][c] === UNKNOWN && !m.isMine[r][c],
							(r: number, c: number) => { m.state[r][c] = KNOWN; return false; },
							(r: number, c: number) => m.clue[r][c]);
						bv.draw();
					}
					later(onDone, 700); return;
				}
				const idx = i - 1;
				if (idx < targets.length) { const t = targets[idx]; m.state[t[0]][t[1]] = targetState; bv.draw(); later(() => playFrom(i + 1), 650); return; }
				later(onDone, 700);
			}
			return { bv, play: () => playFrom(0) };
		}

		function sweep(oldBv: BoardView, newBv: BoardView, onDone: () => void) {
			const ctx = canvas!.getContext("2d")!;
			const sw = canvas!.width / C, sh = canvas!.height / R, start = performance.now(), maxP = R - 1;
			const paintSplit = (frontP: number) => {
				ctx.clearRect(0, 0, canvas!.width, canvas!.height);
				setPaletteVars(localBoardSkin);
				for (let r = 0; r < R; r++) { const view = r < frontP ? newBv : oldBv; for (let c = 0; c < C; c++) drawCell(ctx, r, c, view, sw, sh, null); }
			};
			const paintBand = (frontP: number) => {
				const gap = Math.max(1, Math.round(Math.min(sw, sh) * 0.08)), w = sw - gap, h = sh - gap, rad = Math.min(w, h) * 0.2;
				for (let r = 0; r < R; r++) { const dist = Math.abs(r - frontP); if (dist > SWEEP_WIDTH) continue; const a = (1 - dist / SWEEP_WIDTH) * 0.7;
					for (let c = 0; c < C; c++) { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = "#bfdbfe"; roundRectPath(ctx, c * sw + gap / 2, r * sh + gap / 2, w, h, rad); ctx.fill(); ctx.restore(); } }
			};
			const frame = () => {
				if (!alive) return;
				const elapsed = performance.now() - start;
				if (elapsed >= SWEEP_MS) { paintSplit(maxP + SWEEP_WIDTH + 1); onDone(); return; }
				const frontP = (elapsed / SWEEP_MS) * (maxP + SWEEP_WIDTH * 2) - SWEEP_WIDTH;
				paintSplit(frontP); paintBand(frontP); raf = requestAnimationFrame(frame);
			};
			frame();
		}

		let current: { bv: BoardView; play: () => void } | null = null;
		function show(idx: number) { current = buildScene(scenes[idx], () => advance(idx)); current.bv.draw(); current.play(); }
		function advance(idx: number) {
			later(() => {
				const next = (idx + 1) % scenes.length;
				if (scenes.length < 2) { show(next); return; }
				const n = buildScene(scenes[next], () => advance(next));
				sweep(current!.bv, n.bv, () => { current = n; current.play(); });
			}, 300);
		}
		later(() => show(0), 50);
		return () => { alive = false; timers.forEach(clearTimeout); cancelAnimationFrame(raf); };
	}, [scenes]);
	return <div className={styles.board}><canvas ref={ref} aria-hidden="true" /></div>;
}
