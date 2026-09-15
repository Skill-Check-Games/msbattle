// Shrinks an element's text a step at a time until it fits its box, and only lets it ellipsize once it
// has run out of room to shrink. The CSS keeps the decision: the size the stylesheet sets is the maximum,
// and the floor is a fraction of it, so a layout that grows the box gets bigger text for free.
import { useLayoutEffect, RefObject } from "react";

export function useFitText(ref: RefObject<HTMLElement>, text: string, enabled = true, floor = 0.72) {
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el || !enabled) { if (el) el.style.fontSize = ""; return; }
		const fit = () => {
			el.style.fontSize = "";   // back to the stylesheet's size: that is the maximum
			const max = parseFloat(getComputedStyle(el).fontSize);
			if (!(max > 0)) return;
			const min = Math.max(10, max * floor);
			let s = max;
			while (s > min && el.scrollWidth > el.clientWidth) { s = Math.max(min, s - 0.5); el.style.fontSize = s + "px"; }
		};
		fit();
		// The box, not the text: watching the element itself would re-fire on every size we set.
		const box = el.parentElement;
		const ro = box && typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
		if (ro && box) ro.observe(box);
		return () => { if (ro) ro.disconnect(); el.style.fontSize = ""; };
	}, [ref, text, enabled, floor]);
}
