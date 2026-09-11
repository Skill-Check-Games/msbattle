// An opponent's live board: a mirror BoardSession fed with each draw_board frame, rendered through the
// same GameBoard chrome as the player's own board. Diffing frames in the session gives the opponent's
// reveals, flags and mine hits the same animations (and shake) as your own; the focus ring follows
// their live cursor when one is relayed, else the last cell that changed. Every player races the same
// layout, so the clues come from the local session's decoder.
import { useEffect, useLayoutEffect, useMemo } from "react";
import { BoardSession } from "../../game/board-session";
import GameBoard from "../../game/GameBoard";
import { match, GameFrame } from "../../game/match-store";

interface Props { playerId: string; skin: string | null; frame: GameFrame | null; rows: number; cols: number; cellPx: number; className?: string; covered?: boolean; }

export default function OpponentBoard({ playerId, skin, frame, rows, cols, cellPx, className, covered }: Props) {
	const session = useMemo(() => { const s = new BoardSession({ mode: () => "mirror" }); s.mirror = true; s.ownBoard = false; return s; }, []);
	useEffect(() => { match.registerOpponentSession(playerId, session); return () => match.registerOpponentSession(playerId, null); }, [playerId, session]);
	useLayoutEffect(() => { session.skin = skin || "classic"; session.render(); }, [session, skin]);
	// The opponent's own reveal effect, shipped with every frame, plays on their mirror.
	const revealEffect = (frame && frame.revealEffect) || null;
	useLayoutEffect(() => { session.revealEffect = revealEffect; }, [session, revealEffect]);
	// A new round (new layout: the local decoder changes) or size resets the mirror to a covered board.
	const cellAt = match.session.cellAt;
	useLayoutEffect(() => {
		if (!rows || !cols) return;
		if (session.rows !== rows || session.cols !== cols || session.cellAt !== cellAt) { session.setBoard(rows, cols, cellAt, null); session.focusVisible = false; }
	}, [session, rows, cols, cellAt]);
	useLayoutEffect(() => {
		if (!session.rows) return;
		// The frame's state is shown whether or not they are still playing: at the round's end the board
		// stays as they left it (a new round resets it above, through the new layout). Only a frame with
		// no state at all (the seat is empty) falls back to a covered board.
		const state = frame && frame.state ? frame.state : null;
		session.frozenUntil = (frame && frame.frozenUntil) || 0;   // the mirror's explosion smoke lasts through the penalty like your own
		if (state) session.applyServerState(state);
		else if (covered && session.state && session.countKnown()) { session.setBoard(session.rows, session.cols, session.cellAt, null); session.focusVisible = false; }
	}, [session, frame, covered]);
	return <GameBoard session={session} cellPx={cellPx} interactive={false} className={className} />;
}
