// The room scoreboard: during a round it ranks by live progress (finishers first), otherwise by
// series score then rating. Big fields fold to the top five plus the rows around you.
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { tierFor } from "../../shared/ranking";
import type { RoomState, GameFrame, RoomPlayer } from "../../game/match-store";
import styles from "./Scoreboard.module.scss";

interface Props { room: RoomState | null; search?: { members: RoomPlayer[]; size: number } | null; frames: GameFrame[] | null; myId: string | null; }

export default function Scoreboard({ room, search, frames, myId }: Props) {
	if (!room) return search ? <SearchList search={search} /> : null;
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
	const TOP = 5, NEAR = 2;
	const myIdx = sorted.findIndex(p => p.id === myId);
	let rows: Array<{ p: RoomPlayer; rank: number } | null>;
	if (sorted.length <= TOP + 1 + 2 * NEAR + 1 || myIdx < TOP + NEAR) rows = sorted.map((p, i) => ({ p, rank: i + 1 }));
	else {
		rows = sorted.slice(0, TOP).map((p, i) => ({ p, rank: i + 1 }));
		const start = Math.max(TOP, myIdx - NEAR); if (start > TOP) rows.push(null);
		for (let k = start; k < Math.min(sorted.length, myIdx + NEAR + 1); k++) rows.push({ p: sorted[k], rank: k + 1 });
	}
	return (
		<ul className={styles.list}>
			{rows.map((row, i) => row ? <Row key={row.p.id} p={row.p} rank={row.rank} me={row.p.id === myId} live={live[row.p.id] || null} playing={playing} room={room} /> : <li key={"gap" + i} className={`${styles.row} ${styles.gap}`}>···</li>)}
		</ul>
	);
}

function Row({ p, rank, me, live, playing, room }: { p: RoomPlayer; rank: number; me: boolean; live: GameFrame | null; playing: boolean; room: RoomState }) {
	const tier = typeof p.rating === "number" ? tierFor(p.rating, p.provisional) : null;
	const pct = Math.round(((live && live.progress) || 0) * 100);
	const left = live ? Math.max(0, (live.totalSafe || 0) - (live.safeCount || 0)) : 0;
	return (
		<li className={`${styles.row} ${me ? styles.me : ""}`}>
			<span className={styles.rank}>{rank}.</span>
			<AvatarChip avatar={p.avatar} country={p.country} px={32} className={styles.avatar} />
			<span className={styles.name}>
				{p.name}{p.isOwner ? " ★" : ""}<FlagChip country={p.country} px={14} />
				{p.isBot && !room.ranked && <span className={styles.botTag}>BOT</span>}
				{tier && <span className={styles.tier} style={{ color: tier.color }}>{tier.name}</span>}
			</span>
			{playing ? (
				<>
					<span className={`${styles.progress} ${live && live.finished ? styles.finished : ""}`}><span className={styles.progressFill} style={{ width: (live && live.finished ? 100 : pct) + "%" }} /></span>
					<span className={styles.pct}>{live && live.finished ? "✓" : pct + "%"}</span>
					<span className={styles.left}>{live && live.finished ? "" : left + " left"}</span>
				</>
			) : (
				<>
					<span className={`${styles.meta} ${p.ready ? styles.ready : styles.waiting}`}>{p.ready ? "Ready" : "Waiting"}</span>
					{room.gamesPlayed > 0 && !room.ranked && <span className={styles.points}>{p.score}</span>}
				</>
			)}
		</li>
	);
}

function SearchList({ search }: { search: { members: RoomPlayer[]; size: number } }) {
	return (
		<ul className={styles.list}>
			{Array.from({ length: search.size }, (_, i) => {
				const p = search.members[i];
				const tier = p && typeof p.rating === "number" ? tierFor(p.rating, p.provisional) : null;
				return (
					<li key={p ? p.id : "w" + i} className={`${styles.row} ${p && p.isYou ? styles.me : ""} ${p ? "" : styles.waitingRow}`}>
						<span className={styles.rank}>{i + 1}.</span>
						<AvatarChip avatar={p ? p.avatar : "anon"} country={p ? p.country : null} px={32} className={styles.avatar} />
						<span className={styles.name}>{p ? p.name : "Searching…"}{p && <FlagChip country={p.country} px={14} />}</span>
						<span className={styles.meta} style={tier ? { color: tier.color, fontWeight: 700 } : undefined}>{tier ? tier.name : p ? "Found" : "Waiting…"}</span>
					</li>
				);
			})}
		</ul>
	);
}
