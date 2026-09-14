// FLIP for a list that re-sorts: after every render, each child of the container (marked with a
// data-flip-id) that has a different layout position than last time slides from the old slot to the
// new one. Layout positions come from offsetLeft/offsetTop, which ignore transforms, so a child caught
// mid-slide is measured where it will land; its in-flight offset is read from the computed transform
// and folded into the new slide, so an interrupted move continues from where the eye sees it.
import { useLayoutEffect, useRef, RefObject } from "react";

const SLIDE_MS = 550, SLIDE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

export function useFlip(containerRef: RefObject<HTMLElement>) {
	const last = useRef<Map<string, { x: number; y: number }>>(new Map());
	useLayoutEffect(() => {
		const host = containerRef.current; if (!host) return;
		const next = new Map<string, { x: number; y: number }>();
		for (const el of Array.from(host.children) as HTMLElement[]) {
			const id = el.dataset.flipId; if (!id) continue;
			const layout = { x: el.offsetLeft, y: el.offsetTop };
			next.set(id, layout);
			const prev = last.current.get(id);
			if (!prev || (prev.x === layout.x && prev.y === layout.y)) continue;
			let tx = 0, ty = 0;
			try { const m = new DOMMatrix(getComputedStyle(el).transform); tx = m.m41; ty = m.m42; } catch { /* no transform */ }
			el.getAnimations().forEach(a => a.cancel());
			const dx = prev.x - layout.x + tx, dy = prev.y - layout.y + ty;
			if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
			el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: SLIDE_EASE });
		}
		last.current = next;
	});
}
