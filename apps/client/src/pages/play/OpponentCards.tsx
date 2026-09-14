// The desktop 6-player view of the field: a grid of cards, you included, each a standings row (avatar,
// name, percentage, progress bar) over that player's live mini board, one fixed seat per player. A card
// wears its player's colour: blue for you, red for the rest, red-hot with the penalty count during a mine
// penalty, green with the place once finished. During a ranked search the seats that are still empty
// shimmer. The cards stretch to share the column's height in three equal rows (the page sizes the column
// and the mini boards so that the six cards together are exactly as tall as your arena: multiLayout).
import { useEffect, useRef, useState } from "react";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { ordinal } from "../../shared/ranking";
import OpponentBoard from "./OpponentBoard";
import type { RoomState, GameFrame, RoomPlayer } from "../../game/match-store";
import { rankPlayers, seatOrder } from "./Standings";
import { FindingEnemy } from "./MatchFound";
import { useFlip } from "../../shared/use-flip";
import styles from "./OpponentCards.module.scss";

interface Props { room: RoomState | null; search?: { members: RoomPlayer[]; size: number } | null; searchSince?: number | null; frames: GameFrame[] | null; myId: string | null; rows: number; cols: number; cellPx?: number; placeOf: Record<string, number>; }

const CARD_CHROME_H = 78;   // a card's padding, head row, bar and gaps above and below its mini board
const CARD_CHROME_W = 18;   // a card's padding and border either side of its mini board
const GRID_GAP = 10;

// cellPx: the mini boards' cell size; without it the grid measures its own box and fits the boards to it.
export default function OpponentCards({ room, search, searchSince, frames, myId, rows, cols, cellPx: givenPx, placeOf }: Props) {
	const gridRef = useRef<HTMLDivElement>(null);
	useFlip(gridRef);   // a rank change slides the cards to their new slots
	const [fitPx, setFitPx] = useState(8);
	const cellPx = givenPx || fitPx;
	// Seats: every player ranked once the room exists; the search's found members, then empty seats, before.
	const ranked = room ? rankPlayers(room, frames, myId) : null;
	const seats: Array<{ p: RoomPlayer; rank: number } | null> = ranked
		? ranked.sorted.map(p => ({ p, rank: ranked.rankOf[p.id] }))
		: search ? Array.from({ length: search.size }, (_, i) => { const p = seatOrder(search.members, myId)[i]; return p ? { p, rank: i + 1 } : null; }) : [];
	const count = Math.max(1, seats.length), columns = 2, cardRows = Math.ceil(count / columns);
	useEffect(() => {
		const grid = gridRef.current; if (!grid || givenPx) return;
		const compute = () => {
			const w = (grid.clientWidth - (columns - 1) * GRID_GAP) / columns - CARD_CHROME_W;
			const h = (grid.clientHeight - (cardRows - 1) * GRID_GAP) / cardRows - CARD_CHROME_H;
			const px = Math.floor(Math.min(cols ? w / cols : 8, rows ? h / rows : 8));
			setFitPx(Math.max(4, Math.min(20, px)));
		};
		compute();
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(compute) : null;
		if (ro) ro.observe(grid); window.addEventListener("resize", compute);
		return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", compute); };
	}, [rows, cols, columns, cardRows, givenPx]);
	const live: Record<string, GameFrame> = {};
	for (const f of frames || []) if (f && f.id) live[f.id] = f;
	return (
		<div ref={gridRef} className={styles.grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${cardRows}, minmax(0, 1fr))` }}>
			{seats.map((seat, i) => <Seat key={"seat" + i} seat={seat} myId={myId} live={live} playing={!!room && room.phase === "playing"} placeOf={placeOf} rows={rows} cols={cols} cellPx={cellPx} searchSince={searchSince} />)}
		</div>
	);
}

// One seat of the grid: a card that stays put. Empty, it shows the search (a shimmer where the player will
// land, the radar over the board slot); when the player arrives that layer fades out over their card fading
// in, so nothing jumps. The same card element carries both, which is what makes the crossfade possible.
const SEAT_FADE_MS = 450;
function Seat({ seat, myId, live, playing, placeOf, rows, cols, cellPx, searchSince }: { seat: { p: RoomPlayer; rank: number } | null; myId: string | null; live: Record<string, GameFrame>; playing: boolean; placeOf: Record<string, number>; rows: number; cols: number; cellPx: number; searchSince?: number | null }) {
	const p = seat ? seat.p : null;
	const [finding, setFinding] = useState(!p);
	useEffect(() => {
		if (!p) { setFinding(true); return; }
		if (!finding) return;
		const t = setTimeout(() => setFinding(false), SEAT_FADE_MS);
		return () => clearTimeout(t);
	}, [p]);
	const me = !!p && (p.id === myId || !!p.isYou);
	const frame = p ? live[p.id] || null : null;
	const finished = !!(frame && frame.finished);
	const hitUntil = (frame && frame.frozenUntil) || 0, hit = hitUntil > Date.now();
	const pct = finished ? 100 : Math.round(((frame && frame.progress) || 0) * 100);
	const place = p ? placeOf[p.id] || null : null;
	const placeCls = finished && place === 1 ? styles.place1 : finished && place === 2 ? styles.place2 : finished && place === 3 ? styles.place3 : "";
	return (
		<div className={`${styles.card} ${me ? styles.me : ""} ${finished ? styles.finished : ""} ${hit ? styles.hit : ""} ${!p ? styles.waiting : ""}`} aria-label={p ? undefined : "Searching"}>
			{p && (
				<div className={`${styles.seatPlayer} ${finding ? styles.arriving : ""}`}>
					<div className={styles.head}>
						<AvatarChip avatar={p.avatar} country={p.country} px={36} className={styles.avatar} />
						<span className={styles.name}><span className={styles.nameText}>{p.name}</span><FlagChip country={p.country} px={13} /></span>
						<span className={`${styles.pct} ${placeCls}`}>{finished && place ? ordinal(place) : pct + "%"}</span>
						<span className={styles.bar}><span className={styles.fill} style={{ width: (playing ? pct : 0) + "%" }} /></span>
					</div>
					<div className={styles.boardWrap}>
						<OpponentBoard playerId={p.id} skin={p.skin || "classic"} frame={frame} rows={rows} cols={cols} cellPx={cellPx} className={styles.board} covered />
						{hit && <div className={styles.penalty}><span className={styles.penaltyCount}>{Math.max(1, Math.ceil((hitUntil - Date.now()) / 1000))}</span></div>}
					</div>
				</div>
			)}
			{finding && (
				<div className={`${styles.seatFinding} ${p ? styles.leaving : ""}`} aria-hidden={!!p}>
					<div className={styles.head}><span className={`skel-shimmer ${styles.skelAvatar}`} /><span className={`skel-shimmer ${styles.skelName}`} /><span className={styles.bar} /></div>
					<div className={styles.boardWrap}><span className={styles.boardSlot} style={{ width: cols * cellPx, height: rows * cellPx }}><span className={`skel-shimmer ${styles.skelBoard}`} />{searchSince != null && <FindingEnemy since={searchSince} mini />}</span></div>
				</div>
			)}
		</div>
	);
}

// One player's card. me: your own (blue). compact: the landscape phone's leader card at the top of its standings panel.
export function OpponentCard({ p, rank, me, frame, playing, place, rows, cols, cellPx, compact }: { p: RoomPlayer; rank: number; me?: boolean; frame: GameFrame | null; playing: boolean; place: number | null; rows: number; cols: number; cellPx: number; compact?: boolean }) {
	const finished = !!(frame && frame.finished);
	const hitUntil = (frame && frame.frozenUntil) || 0, hit = hitUntil > Date.now();
	const pct = finished ? 100 : Math.round(((frame && frame.progress) || 0) * 100);
	const placeCls = finished && place === 1 ? styles.place1 : finished && place === 2 ? styles.place2 : finished && place === 3 ? styles.place3 : "";
	return (
		<div data-flip-id={p.id} className={`${styles.card} ${me ? styles.me : ""} ${compact ? styles.compact : ""} ${finished ? styles.finished : ""} ${hit ? styles.hit : ""}`}>
			{/* The head is the standings row's shape: the avatar spans both lines, name and percentage on the first, the bar on the second from the avatar's bottom-right. */}
			<div className={styles.head}>
				<AvatarChip avatar={p.avatar} country={p.country} px={compact ? 26 : 36} className={styles.avatar} />
				<span className={styles.name}><span className={styles.nameText}>{p.name}</span><FlagChip country={p.country} px={13} /></span>
				<span className={`${styles.pct} ${placeCls}`}>{playing ? (finished && place ? ordinal(place) : pct + "%") : "\u00a0"}</span>
				<span className={styles.bar}><span className={styles.fill} style={{ width: (playing ? pct : 0) + "%" }} /></span>
			</div>
			<div className={styles.boardWrap}>
				<OpponentBoard playerId={p.id} skin={p.skin || "classic"} frame={frame} rows={rows} cols={cols} cellPx={cellPx} className={styles.board} covered />
				{hit && <div className={styles.penalty}><span className={styles.penaltyCount}>{Math.max(1, Math.ceil((hitUntil - Date.now()) / 1000))}</span></div>}
			</div>
		</div>
	);
}
