// Phone pieces of the in-game page: media-query hooks, the bottom
// action bar (Reveal / Flag + jump between unsolved areas), and the "jump to another area" logic.
import { useEffect, useState } from "react";
import { BoardSession } from "../../game/board-session";
import { UNKNOWN, KNOWN } from "../../game/board-render";
import { music } from "../../audio/music";
import { exitGameFullscreen, unlockOrientation, phoneSizedDevice } from "../../game/fullscreen";
import styles from "./PlayPage.module.scss";

export const PORTRAIT_MQ = "(max-width: 700px)";
export const LANDSCAPE_PHONE_MQ = "(orientation: landscape) and (max-height: 500px) and (min-width: 701px)";
// Phones in either orientation: the Customize lab (the modal on the home page, the shop page) becomes a full-screen sheet.
export const PHONE_SHEET_MQ = "(max-width: 700px), (orientation: landscape) and (max-height: 500px)";

export function useMediaQuery(q: string): boolean {
	const [m, setM] = useState(() => window.matchMedia(q).matches);
	useEffect(() => { const mq = window.matchMedia(q); const on = () => setM(mq.matches); on(); mq.addEventListener("change", on); return () => mq.removeEventListener("change", on); }, [q]);
	return m;
}

// body.in-game while a game screen is mounted: global CSS hides the navbar/footer on phones. The
// soundtrack runs only on game screens (music: false leaves it to the page: the play page starts it
// itself once the first round goes live, the puzzle page never does), and leaving drops fullscreen (phones keep it: re-entering
// needs a gesture, and the next match wants it back) but always releases the landscape lock: the
// site's own pages are not held sideways.
export function useInGameBody(opts?: { music?: boolean }) {
	const withMusic = !opts || opts.music !== false;
	useEffect(() => {
		document.body.classList.add("in-game"); if (withMusic) music.resume();
		return () => { document.body.classList.remove("in-game"); if (withMusic) music.pause(); unlockOrientation(); if (!phoneSizedDevice()) exitGameFullscreen(); };
	}, []);
}


// Frontier cells (covered, touching a revealed cell) grouped into 8-connected areas, each landing on
// the member nearest its centroid; cycle through the areas by angle around the board centre so a
// press always moves to a materially different part of the board. Reads only the player's own state.
export function jumpArea(session: BoardSession, dir: 1 | -1) {
	const st = session.state, R = session.rows, C = session.cols;
	if (!st || !R || !C) return;
	const isFrontier = (r: number, c: number) => {
		if (st[r][c] !== UNKNOWN) return false;
		for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if ((dr || dc) && rr >= 0 && rr < R && cc >= 0 && cc < C && st[rr][cc] === KNOWN) return true; }
		return false;
	};
	const seen = new Set<number>(), clusters: number[][][] = [];
	for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
		if (seen.has(r * C + c) || !isFrontier(r, c)) continue;
		const members: number[][] = [], stack = [[r, c]]; seen.add(r * C + c);
		while (stack.length) {
			const [cr, cc] = stack.pop()!; members.push([cr, cc]);
			for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const nr = cr + dr, nc = cc + dc; if (nr < 0 || nr >= R || nc < 0 || nc >= C || seen.has(nr * C + nc) || !isFrontier(nr, nc)) continue; seen.add(nr * C + nc); stack.push([nr, nc]); }
		}
		clusters.push(members);
	}
	if (!clusters.length) return;
	const reps = clusters.map(m => {
		const cy = m.reduce((a, x) => a + x[0], 0) / m.length, cx = m.reduce((a, x) => a + x[1], 0) / m.length;
		let best = m[0], bd = Infinity; for (const x of m) { const d = (x[0] - cy) ** 2 + (x[1] - cx) ** 2; if (d < bd) { bd = d; best = x; } }
		return { r: best[0], c: best[1], angle: Math.atan2(cy - R / 2, cx - C / 2) };
	}).sort((a, b) => a.angle - b.angle);
	let cur = 0, bd = Infinity;
	reps.forEach((p, i) => { const d = (p.r - session.focusedR) ** 2 + (p.c - session.focusedC) ** 2; if (d < bd) { bd = d; cur = i; } });
	const next = reps[(cur + dir + reps.length) % reps.length];
	session.focusedR = next.r; session.focusedC = next.c; session.render();
	scrollCellIntoView(session, next.r, next.c);
}

export function scrollCellIntoView(session: BoardSession, r: number, c: number) {
	const canvas = session.canvas; if (!canvas) return;
	const scroller = canvas.parentElement; if (!scroller) return;
	const cw = canvas.offsetWidth / session.cols, ch = canvas.offsetHeight / session.rows;
	scroller.scrollTo({ left: canvas.offsetLeft + (c + 0.5) * cw - scroller.clientWidth / 2, top: canvas.offsetTop + (r + 0.5) * ch - scroller.clientHeight / 2, behavior: "smooth" });
	if (scroller.offsetHeight > window.innerHeight) window.scrollTo({ top: scroller.getBoundingClientRect().top + window.scrollY + (r + 0.5) * ch - window.innerHeight / 2, behavior: "smooth" });
}
