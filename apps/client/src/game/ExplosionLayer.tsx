// A transparent canvas over the board frame, larger than the board by a margin, on which a session's
// explosions are painted. Being its own layer (not the board canvas) it can spill past the board's edge
// when a mine near a corner goes off, is not clipped by the board's scroller, and sits above the red
// mine-hit cover so the fire and smoke show at full brightness. It paints only while an explosion is
// live and hides itself otherwise. Positions come from layout offsets, not screen rectangles, so the
// mapping holds when the board is panned and under the rotated phone layout.
import { useEffect, useRef } from "react";
import { BoardSession } from "./board-session";
import { paintExplosion, explosionLife } from "./explosion";
import styles from "./GameBoard.module.scss";

const MARGIN = 80;   // how far past the board frame the effect may reach, in px

export default function ExplosionLayer({ session }: { session: BoardSession }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const el = ref.current!;
		let raf = 0;
		// While an explosion is live the board's card is lifted above its neighbours (a z-index on the
		// shake host): the shake animation turns the card into a stacking context of its own, and without
		// this the spill would fall behind the panels next to it for the duration of the shake, then pop
		// back on top when it ended.
		const host = el.closest("[data-shake-host]") as HTMLElement | null;
		const frame = () => {
			const board = session.canvas, list = session.explosions, wrap = el.parentElement;
			if (!board || !wrap || !list.length || !session.cols) { el.hidden = true; raf = 0; if (host) host.style.zIndex = ""; return; }
			el.hidden = false;
			if (host && host.style.zIndex !== "30") host.style.zIndex = "30";
			const dpr = window.devicePixelRatio || 1;
			const W = wrap.clientWidth + MARGIN * 2, H = wrap.clientHeight + MARGIN * 2;
			if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) { el.width = Math.round(W * dpr); el.height = Math.round(H * dpr); el.style.width = W + "px"; el.style.height = H + "px"; el.style.left = -MARGIN + "px"; el.style.top = -MARGIN + "px"; }
			const ctx = el.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
			// the board's top-left inside the wrap: through the scroller (its offset parent), minus what is scrolled away
			const scroller = board.parentElement as HTMLElement;
			const bx = MARGIN + scroller.offsetLeft - scroller.scrollLeft + board.offsetLeft, by = MARGIN + scroller.offsetTop - scroller.scrollTop + board.offsetTop;
			const cw = board.clientWidth / session.cols, ch = board.clientHeight / session.rows, now = performance.now();
			for (const e of list) paintExplosion(ctx, e, now - e.start, bx + (e.c + 0.5) * cw, by + (e.r + 0.5) * ch, cw / 40, explosionLife(e, session.frozenUntil, now));
			raf = requestAnimationFrame(frame);
		};
		const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
		const off = session.onExplosion(start);
		start();
		return () => { off(); if (raf) cancelAnimationFrame(raf); raf = 0; if (host) host.style.zIndex = ""; };
	}, [session]);
	return <canvas ref={ref} className={styles.explosionLayer} aria-hidden="true" hidden />;
}
