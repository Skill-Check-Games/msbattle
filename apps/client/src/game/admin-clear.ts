// Admin-only test hotkey: F8 clears the board on screen instantly by playing every remaining safe cell
// through the session's normal action path — each reveal reaches the server like a real click, so the
// win, rating, streak and rank animations all happen exactly as for a hand-cleared board. Used by the
// puzzle, play and solo pages; a non-admin account never gets the listener.
import { useEffect } from "react";
import type { BoardSession } from "./board-session";
import { MINE, UNKNOWN } from "./board-render";

export function useAdminClearBoard(session: BoardSession | null, isAdmin: boolean | undefined) {
	useEffect(() => {
		if (!isAdmin || !session) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "F8" || e.repeat) return;
			if (!session.hooks.mode() || !session.state) return; // no live board
			e.preventDefault();
			for (let r = 0; r < session.rows; r++) for (let c = 0; c < session.cols; c++) {
				if (session.state[r][c] === UNKNOWN && session.cellAt(r, c) !== MINE) session.performAction(r, c, false);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [session, isAdmin]);
}
