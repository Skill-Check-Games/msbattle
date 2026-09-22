// The battle standings (3 to 6 players), in the arena's language: every player in their seat, you included
// and highlighted (no rank numbers: seats are fixed, the bars and percentages tell the race). A row is avatar, name, a
// progress bar in the row's colour (blue for you, red for the rest, green once finished, red-hot during
// a mine penalty) and the percentage. compact: the landscape phone's 158px panel (one line per player, the
// bar under the name). During a ranked search the seats fill in one
// by one; an empty seat shows the radar where the avatar will land and "Finding enemy" where the name will.
import { ReactNode, useRef } from "react";
import { useFitText } from "../../shared/use-fit-text";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { useFlip } from "../../shared/use-flip";
import { Radar } from "./MatchFound";
import { ordinal } from "../../shared/ranking";
import type { RoomState, GameFrame, RoomPlayer } from "../../game/match-store";
import styles from "./Standings.module.scss";

// skipId: a player shown elsewhere (the phone's leader card) is left out of the list; the ranks still count them.
// roomy: the landscape phone's 6-player panel. The row has no bar of its own: it IS the bar, filling from the
// left in the player's colour, so the whole width is the track and the flag sits over the name rather than
// beside it. The row height and avatar size come in as --row-h / --av on an ancestor.
// liveOrder: rows in rank order (the replay: the rail reorders as the race runs). renderName / onRowClick / focusId: the
// replay links names to profiles, focuses a board by clicking its row, and marks the row on the stage. big: taller rows
// with a larger avatar (the replay's rail has the height for them).
interface Props { room: RoomState | null; search?: { members: RoomPlayer[]; size: number } | null; frames: GameFrame[] | null; myId: string | null; placeOf?: Record<string, number>; compact?: boolean; roomy?: boolean; skipId?: string | null; liveOrder?: boolean; renderName?: (p: RoomPlayer) => ReactNode; onRowClick?: (p: RoomPlayer) => void; focusId?: string | null; big?: boolean; }

// Whether the cards and rows re-sort live as ranks change (sliding into place, use-flip.ts). Off: every
// player keeps the seat they joined in and only their rank number moves. A trial switch: both feels are
// wired, this picks one.
export const LIVE_RANK_ORDER = false;

// The live ranking every battle view shares: during a round by progress (finishers first, in finish
// order), otherwise by series score then rating. `sorted` is the display order (rank order, or the join
// order when LIVE_RANK_ORDER is off); `rankOf` is always the rank.
// The display order when seats are fixed: you first, then the others in the order they joined.
export function seatOrder(players: RoomPlayer[], myId: string | null): RoomPlayer[] {
	const mine = players.filter(p => p.id === myId || p.isYou), rest = players.filter(p => !(p.id === myId || p.isYou));
	return mine.concat(rest);
}

export function rankPlayers(room: RoomState, frames: GameFrame[] | null, myId: string | null = null, liveOrder: boolean = LIVE_RANK_ORDER): { sorted: RoomPlayer[]; live: Record<string, GameFrame>; rankOf: Record<string, number> } {
	const playing = room.phase === "playing";
	const live: Record<string, GameFrame> = {};
	for (const f of frames || []) if (f && f.id) live[f.id] = f;
	const sorted = room.players.slice().sort((a, b) => {
		if (playing) {
			const la = live[a.id], lb = live[b.id];
			const fa = !!(la && la.finished), fb = !!(lb && lb.finished);
			if (fa !== fb) return fa ? -1 : 1;
			if (fa && fb) return (la.finishedAt || 0) - (lb.finishedAt || 0);
			return ((lb && lb.progress) || 0) - ((la && la.progress) || 0);
		}
		if (b.score !== a.score) return b.score - a.score;
		return (b.rating || 0) - (a.rating || 0);
	});
	const rankOf: Record<string, number> = {};
	sorted.forEach((p, i) => { rankOf[p.id] = i + 1; });
	return { sorted: liveOrder ? sorted : seatOrder(room.players, myId), live, rankOf };
}

export default function Standings({ room, search, frames, myId, placeOf, compact, roomy, skipId, liveOrder, renderName, onRowClick, focusId, big }: Props) {
	const cls = `${styles.list} ${compact ? styles.compact : ""} ${roomy ? styles.roomy : ""}`;
	const listRef = useRef<HTMLUListElement>(null);
	useFlip(listRef);   // a rank change slides the rows to their new places
	if (!room) {
		if (!search) return null;
		return (
			<ul ref={listRef} className={cls} aria-label="Players">
				{Array.from({ length: search.size }, (_, i) => {
					const p = seatOrder(search.members, myId)[i];
					return p ? <Row key={"seat" + i} seat={"seat" + i} p={p} rank={i + 1} me={!!p.isYou || p.id === myId} frame={null} playing={false} place={null} roomy={roomy} /> : <li key={"seat" + i} data-flip-id={"seat" + i} className={`${styles.row} ${styles.waiting}`} aria-label="Finding enemy"><span className={styles.radarSlot}><Radar size={compact ? 20 : 36} /></span><span className={styles.searching}>Finding enemy<span className={styles.dots}><i /><i /><i /></span></span><span className={styles.bar} /></li>;
				})}
			</ul>
		);
	}
	const playing = room.phase === "playing";
	const { sorted, live, rankOf } = rankPlayers(room, frames, myId, liveOrder);
	return (
		<ul ref={listRef} className={cls} aria-label="Standings">
			{/* Rows are keyed by seat, not player id: the search's pending seats become the room's players (bots get their real
			    ids then), and a row that keeps its element does not fade in again when that happens. */}
			{sorted.map((p, i) => p.id === skipId ? null : <Row key={liveOrder ? p.id : "seat" + i} seat={liveOrder ? p.id : "seat" + i} p={p} rank={rankOf[p.id]} me={p.id === myId || !!p.isYou} frame={live[p.id] || null} playing={playing} place={(placeOf && placeOf[p.id]) || null} renderName={renderName} onClick={onRowClick ? () => onRowClick(p) : undefined} focused={focusId === p.id} big={big} roomy={roomy} />)}
		</ul>
	);
}

function Row({ p, seat, rank, me, frame, playing, place, roomy, renderName, onClick, focused, big }: { p: RoomPlayer; seat: string; rank: number; me: boolean; frame: GameFrame | null; playing: boolean; place: number | null; roomy?: boolean; renderName?: (p: RoomPlayer) => ReactNode; onClick?: () => void; focused?: boolean; big?: boolean }) {
	const nameRef = useRef<HTMLSpanElement>(null);
	useFitText(nameRef, p.name, !!roomy);   // roomy sets the name large: it shrinks to fit before it ever shows dots
	const finished = !!(frame && frame.finished);
	const hit = !!(frame && frame.frozenUntil && frame.frozenUntil > Date.now());
	const pct = finished ? 100 : Math.round(((frame && frame.progress) || 0) * 100);
	const placeCls = finished && place === 1 ? styles.place1 : finished && place === 2 ? styles.place2 : finished && place === 3 ? styles.place3 : "";
	const pctText = <span className={`${styles.pct} ${placeCls}`}>{finished && place ? ordinal(place) : pct + "%"}</span>;
	// --seat-fill is how far the row has filled: roomy draws the tint, the leading edge and the coloured part
	// of the ring from it, so the three can never disagree about where the front is.
	// The fill is not tied to the round being live: when a round ends every bar stays where it finished, and it
	// is the frames being cleared for the next round that empties them.
	return (
		<li data-flip-id={seat} className={`${styles.row} ${me ? styles.me : ""} ${finished ? styles.finished : ""} ${hit ? styles.hit : ""} ${focused ? styles.focusedRow : ""} ${onClick ? styles.clickableRow : ""} ${big ? styles.big : ""}`} style={roomy ? { "--seat-fill": pct + "%" } as React.CSSProperties : undefined} onClick={onClick}>
			<span className={styles.avatarSlot}><AvatarChip avatar={p.avatar} country={p.country} px={big ? 44 : 36} className={styles.avatar} />{hit && <span className={styles.burst} aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>}</span>
			{/* roomy gives the name a line of its own and puts the flag and the percentage together on the one below,
			    so the name has the row's whole width to grow into. Everywhere else they sit on one line, the
			    percentage in its own column at the right. */}
			{roomy ? (
				<span className={styles.who}>
					<span ref={nameRef} className={styles.nameText}>{p.name}</span>
					<span className={styles.meta}><FlagChip country={p.country} px={13} />{pctText}</span>
				</span>
			) : (
				<span className={styles.name}><span ref={nameRef} className={styles.nameText}>{renderName ? renderName(p) : p.name}</span><FlagChip country={p.country} px={14} /></span>
			)}
			{/* The bar and the percentage are there from the moment the player joins (0% before the round), so the row is complete at once. */}
			<span className={styles.bar}><span className={styles.fill} style={{ width: pct + "%" }} /></span>
			{!roomy && <span className={styles.stat}>{pctText}</span>}
		</li>
	);
}
