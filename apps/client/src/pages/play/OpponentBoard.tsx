// An opponent's live board: a mirror BoardSession fed with each draw_board frame, rendered through the
// same GameBoard chrome as the player's own board. Diffing frames in the session gives the opponent's
// reveals, flags and mine hits the same animations (and shake) as your own; the focus ring follows
// their live cursor when one is relayed, else the last cell that changed. Every player races the same
// layout, so the clues come from the local session's decoder.
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { sound } from "../../audio/sound";
import { BoardSession } from "../../game/board-session";
import GameBoard from "../../game/GameBoard";
import { match, GameFrame } from "../../game/match-store";

// sound: their mine hits are heard (a softer, more distant blast than your own); reveals and flags stay silent. 1v1 only.
interface Props { playerId: string; skin: string | null; frame: GameFrame | null; rows: number; cols: number; cellPx: number; className?: string; covered?: boolean; sound?: boolean; }

export default function OpponentBoard({ playerId, skin, frame, rows, cols, cellPx, className, covered, sound: withSound }: Props) {
	const soundRef = useRef(!!withSound); soundRef.current = !!withSound;
	// The session gets its board (and, when there is one, the live state) right here at creation, before
	// the canvas is first sized: a mirror that got its board only in a later effect painted one frame into
	// a default-sized canvas, a squashed board flashing as a player joined.
	const cellAt = match.session.cellAt;
	const seeded = useRef(false);
	const session = useMemo(() => {
		const s = new BoardSession({ mode: () => "mirror", sound: { cascade() {}, flag() {}, unflag() {}, mine: () => { if (soundRef.current) sound.opponentMine(); } } });
		s.mirror = true; s.ownBoard = false;
		if (rows && cols) { s.setBoard(rows, cols, cellAt, frame && frame.state && frame.state.length === rows ? s.clone(frame.state) : null); s.focusVisible = false; seeded.current = true; }
		return s;
	}, []);
	useEffect(() => { match.registerOpponentSession(playerId, session); return () => match.registerOpponentSession(playerId, null); }, [playerId, session]);
	useLayoutEffect(() => { session.skin = skin || "classic"; session.render(); }, [session, skin]);
	// The opponent's own reveal effect, shipped with every frame, plays on their mirror.
	const revealEffect = (frame && frame.revealEffect) || null;
	useLayoutEffect(() => { session.revealEffect = revealEffect; }, [session, revealEffect]);
	// A new round (new layout: the local decoder changes) or size resets the mirror to a covered board, from
	// which the next frame's reveals animate in. The very first board of this mirror (it was just mounted: a
	// card appearing, the Boards view switched on) starts silently at the board as it already is instead, so
	// nothing that happened before the mount is replayed (usually done at creation above; here when the
	// board's size was not known yet).
	useLayoutEffect(() => {
		if (!rows || !cols) return;
		if (session.rows !== rows || session.cols !== cols || session.cellAt !== cellAt) {
			const current = !seeded.current && frame && frame.state && frame.state.length === rows ? session.clone(frame.state) : null;
			session.setBoard(rows, cols, cellAt, current); session.focusVisible = false;
			seeded.current = true;
		}
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
