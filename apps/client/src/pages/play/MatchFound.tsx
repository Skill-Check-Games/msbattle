// The 1v1 match-found moment (desktop duel): while searching, the opponent's board sits dimmed under a
// "Finding enemy" pill; when the opponent arrives the stage dims and a banner slams in over both cards:
// your black badge end and blue slab from the left, the opponent's red slab and black badge end from the
// right, a black VS block between them. It holds a beat, splits apart and the countdown takes over.
import { useEffect, useState } from "react";
import { AvatarChip } from "../../shared/Avatar";
import { RankBadge, PlacementBadge } from "../../shared/RankBadge";
import type { RoomPlayer } from "../../game/match-store";
import styles from "./MatchFound.module.scss";

// Finding enemy -> Enemy found (the card locks on) -> A vs B banner -> the countdown. Relaxed on purpose.
export const FOUND_CARD_MS = 2600;
export const MATCH_FOUND_MS = 3300;
export const CARD_LEAVE_MS = 600;   // the card slides out to the right while the banner flies in

// compact: the column version for the narrow opponent panel of the phone landscape layout.
export function FindingEnemy({ since, found, leaving, compact }: { since: number; found?: boolean; leaving?: boolean; compact?: boolean }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => { const h = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(h); }, []);
	const s = Math.max(0, Math.floor((now - since) / 1000));
	const clock = Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
	return (
		<div className={`${styles.finding} ${leaving ? styles.findingLeaving : ""}`} aria-live="polite">
			<div className={`${styles.card} ${compact ? styles.cardCompact : ""} ${found ? styles.cardFound : ""} ${leaving ? styles.cardLeaving : ""}`}>
				<div className={styles.radar} aria-hidden="true"><span className={styles.sweep} /><span className={styles.ringA} /><span className={styles.ringB} /><span className={styles.dot} /><span className={styles.blip} /></div>
				<div className={styles.textStack}>
					<div className={`${styles.findText} ${styles.textFinding}`}>
						<div className={styles.findTitle}>Finding enemy<span className={styles.dots}><i /><i /><i /></span></div>
						<div className={styles.findSub}>Searching the ladder for a worthy opponent</div>
					</div>
					<div className={`${styles.findText} ${styles.textFound}`} aria-hidden={!found}>
						<div className={styles.findTitle}>Target acquired!</div>
						<div className={styles.findSub}>Get ready</div>
					</div>
				</div>
				<div className={styles.findClock}>{clock}</div>
			</div>
		</div>
	);
}

function Badge({ player, size = 14 }: { player: RoomPlayer | null; size?: number }) {
	return player && typeof player.rating === "number" ? <RankBadge rating={player.rating} size={size} /> : <PlacementBadge size={size} />;
}

// Mounted only while the banner plays; the parent unmounts it after MATCH_FOUND_MS.
export const WIN_BANNER_MS = 4200;   // how long the round-end banner stays before it leaves (the result modal waits for this)
export const WIN_LEAVE_MS = 600;     // it lifts away over this (as the modal arrives)

// The round's end: the winner's slab alone. From their side: the badge end, then the avatar, then the
// name on the slab in their colour, closed by a black WINNER block at the far end that slides in a beat
// later; a gold sheen then sweeps across. leaving: it slides back out the way it came.
export function RoundEndBanner({ winner, side, leaving, compact, stacked }: { winner: RoomPlayer | null; side: "you" | "opp"; leaving?: boolean; compact?: boolean; stacked?: boolean }) {
	const px = stacked ? 44 : 62, badge = stacked ? 10 : 14;
	return (
		<div className={`${styles.stage} ${compact ? styles.stageCompact : ""} ${stacked ? styles.stageStacked : ""} ${styles.winStage} ${leaving ? styles.winLeaving : ""}`} role="status" aria-label={`${winner ? winner.name : "Opponent"} wins the round`}>
			<div className={styles.dim} />
			<div className={`${styles.winRow} ${side === "opp" ? styles.winOpp : ""}`}>
				<div className={styles.winGroup}>
					<div className={`${styles.end} ${styles.pg} ${styles.winEnd}`}><Badge player={winner} size={badge} /></div>
					<div className={`${styles.slab} ${styles.pg} ${styles.winSlab}`}><AvatarChip avatar={winner ? winner.avatar : null} country={winner ? winner.country : null} px={px} className={styles.avatar} /><span className={styles.name}>{winner ? winner.name : "Opponent"}</span></div>
					<div className={`${styles.winBlock} ${styles.pg}`}>WINNER</div>
				</div>
			</div>
		</div>
	);
}

// compact: the same banner scaled down for a phone held in landscape. stacked: the narrow layout, where
// the two slabs go one above the other (you on top, the opponent below) with the VS between them.
export function MatchFoundBanner({ me, opp, compact, stacked }: { me: RoomPlayer | null; opp: RoomPlayer | null; compact?: boolean; stacked?: boolean }) {
	const px = stacked ? 44 : 62, badge = stacked ? 10 : 14;   // the stacked slabs are 60px tall: smaller badges clear the slant
	return (
		<div className={`${styles.stage} ${compact ? styles.stageCompact : ""} ${stacked ? styles.stageStacked : ""}`} role="status" aria-label={`${me ? me.name : "You"} versus ${opp ? opp.name : "opponent"}`}>
			<div className={styles.dim} />
			<div className={styles.row}>
				<div className={`${styles.group} ${styles.groupL}`}>
					<div className={`${styles.end} ${styles.pg}`}><Badge player={me} size={badge} /></div>
					<div className={`${styles.slab} ${styles.slabL} ${styles.pg}`}><span className={styles.name}>{me ? me.name : "You"}</span><AvatarChip avatar={me ? me.avatar : null} country={me ? me.country : null} px={px} className={styles.avatar} /></div>
				</div>
				<div className={`${styles.mid} ${styles.pg}`}>VS</div>
				<div className={`${styles.group} ${styles.groupR}`}>
					<div className={`${styles.slab} ${styles.slabR} ${styles.pg}`}><AvatarChip avatar={opp ? opp.avatar : null} country={opp ? opp.country : null} px={px} className={styles.avatar} /><span className={styles.name}>{opp ? opp.name : "Opponent"}</span></div>
					<div className={`${styles.end} ${styles.pg}`}><Badge player={opp} size={badge} /></div>
				</div>
			</div>
		</div>
	);
}
