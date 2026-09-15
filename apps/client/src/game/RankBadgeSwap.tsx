// The rank badge changing tier, animated: Shatter & Reform going up, Climb / Drop coming down (the two
// Design Lab candidates that shipped). Used by the ranked result modal and the puzzle rank card. Mount it
// in place of the badge for the duration (RANK_BADGE_SWAP_MS) and put the plain badge back afterwards.
import { useMemo } from "react";
import { RankBadge, PuzzleRankBadge } from "../shared/RankBadge";
import { tierFor } from "../shared/ranking";
import { puzzleLadder } from "../shared/puzzle-ladder";
import styles from "./RankBadgeSwap.module.scss";

export const RANK_BADGE_SWAP_MS = 2000;

interface Shard { x: number; y: number; rot: number; delay: number; }
function shards(count: number, minDist: number, spread: number): Shard[] {
	const out: Shard[] = [];
	for (let i = 0; i < count; i++) {
		const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4, dist = minDist + Math.random() * spread;
		out.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, rot: Math.round((Math.random() - 0.5) * 420), delay: +(Math.random() * 0.05).toFixed(2) });
	}
	return out;
}

export function RankBadgeSwap({ kind, from, to, size }: { kind: "rank" | "puzzle"; from: number; to: number; size: number }) {
	const up = to > from;
	const px = size * 5; // a badge is 5em at font-size `size`px (badges.scss)
	const fromColor = kind === "rank" ? tierFor(from).color : puzzleLadder(from).tierColor;
	const parts = useMemo(() => shards(9, px * 0.72, px * 0.47), [px, from, to]);
	const Badge = kind === "rank" ? RankBadge : PuzzleRankBadge;
	return (
		<div className={styles.box} style={{ fontSize: px + "px" }} aria-hidden="true">
			{up && parts.map((s, i) => <div key={i} className={styles.shard} style={{ "--shard-color": fromColor, "--sx": s.x.toFixed(1) + "px", "--sy": s.y.toFixed(1) + "px", "--srot": s.rot + "deg", animationDelay: s.delay + "s" } as any} />)}
			<div className={`${styles.face} ${up ? styles.shatterOld : styles.dropOld}`}><Badge rating={from} size={size} /></div>
			<div className={`${styles.face} ${up ? styles.shatterNew : styles.dropNew}`}><Badge rating={to} size={size} /></div>
		</div>
	);
}
