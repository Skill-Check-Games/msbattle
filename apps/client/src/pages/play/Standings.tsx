// The battle standings (3 to 6 players), in the arena's language: every player in their seat, you included
// and highlighted (no rank numbers: seats are fixed, the bars and percentages tell the race). A row is avatar, name, a
// progress bar in the row's colour (blue for you, red for the rest, green once finished, red-hot during
// a mine penalty) and the percentage. compact: the landscape phone's 158px panel (one line per player, the
// bar under the name). During a ranked search the seats fill in one
// by one; an empty seat shows the radar where the avatar will land and "Finding enemy" where the name will.
import { useRef } from "react";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { useFlip } from "../../shared/use-flip";
import { Radar } from "./MatchFound";
import { ordinal } from "../../shared/ranking";
import type { RoomState, GameFrame, RoomPlayer } from "../../game/match-store";
import styles from "./Standings.module.scss";

// skipId: a player shown elsewhere (the phone's leader card) is left out of the list; the ranks still count them.
interface Props { room: RoomState | null; search?: { members: RoomPlayer[]; size: number } | null; frames: GameFrame[] | null; myId: string | null; placeOf?: Record<string, number>; compact?: boolean; skipId?: string | null; }

// Whether the cards and rows re-sort live as ranks change (sliding into place, use-flip.ts). Off: every
// player keeps the seat they joined in and only their rank number moves. A trial switch: both feels are
// wired, this picks one.
export const LIVE_RANK_ORDER = false;

// The live ranking every battle view shares: during a round by progress (finishers first, in finish
// order), otherwise by series score then rating. `sorted` is the display order (rank order, or the join
// order when LIVE_RANK_ORDER is off); `rankOf` is always the rank.
export function rankPlayers(room: RoomState, frames: GameFrame[] | null): { sorted: RoomPlayer[]; live: Record<string, GameFrame>; rankOf: Record<string, number> } {
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
	return { sorted: LIVE_RANK_ORDER ? sorted : room.players.slice(), live, rankOf };
}

export default function Standings({ room, search, frames, myId, placeOf, compact, skipId }: Props) {
	const cls = `${styles.list} ${compact ? styles.compact : ""}`;
	const listRef = useRef<HTMLUListElement>(null);
	useFlip(listRef);   // a rank change slides the rows to their new places
	if (!room) {
		if (!search) return null;
		return (
			<ul ref={listRef} className={cls} aria-label="Players">
				{Array.from({ length: search.size }, (_, i) => {
					const p = search.members[i];
					return p ? <Row key={"seat" + i} seat={"seat" + i} p={p} rank={i + 1} me={!!p.isYou || p.id === myId} frame={null} playing={false} place={null} /> : <li key={"seat" + i} data-flip-id={"seat" + i} className={`${styles.row} ${styles.waiting}`} aria-label="Finding enemy"><span className={styles.radarSlot}><Radar size={compact ? 20 : 36} /></span><span className={styles.searching}>Finding enemy<span className={styles.dots}><i /><i /><i /></span></span><span className={styles.bar} /></li>;
				})}
			</ul>
		);
	}
	const playing = room.phase === "playing";
	const { sorted, live, rankOf } = rankPlayers(room, frames);
	return (
		<ul ref={listRef} className={cls} aria-label="Standings">
			{/* Rows are keyed by seat, not player id: the search's pending seats become the room's players (bots get their real
			    ids then), and a row that keeps its element does not fade in again when that happens. */}
			{sorted.map((p, i) => p.id === skipId ? null : <Row key={"seat" + i} seat={"seat" + i} p={p} rank={rankOf[p.id]} me={p.id === myId} frame={live[p.id] || null} playing={playing} place={(placeOf && placeOf[p.id]) || null} />)}
		</ul>
	);
}

function Row({ p, seat, rank, me, frame, playing, place }: { p: RoomPlayer; seat: string; rank: number; me: boolean; frame: GameFrame | null; playing: boolean; place: number | null }) {
	const finished = !!(frame && frame.finished);
	const hit = !!(frame && frame.frozenUntil && frame.frozenUntil > Date.now());
	const pct = finished ? 100 : Math.round(((frame && frame.progress) || 0) * 100);
	const placeCls = finished && place === 1 ? styles.place1 : finished && place === 2 ? styles.place2 : finished && place === 3 ? styles.place3 : "";
	return (
		<li data-flip-id={seat} className={`${styles.row} ${me ? styles.me : ""} ${finished ? styles.finished : ""} ${hit ? styles.hit : ""}`}>
			<span className={styles.avatarSlot}><AvatarChip avatar={p.avatar} country={p.country} px={36} className={styles.avatar} />{hit && <span className={styles.burst} aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>}</span>
			<span className={styles.name}><span className={styles.nameText}>{p.name}</span><FlagChip country={p.country} px={14} /></span>
			{/* The bar and the percentage are there from the moment the player joins (0% before the round), so the row is complete at once. */}
			<span className={styles.bar}><span className={styles.fill} style={{ width: (playing ? pct : 0) + "%" }} /></span>
			<span className={styles.stat}><span className={`${styles.pct} ${placeCls}`}>{finished && place ? ordinal(place) : pct + "%"}</span></span>
		</li>
	);
}
