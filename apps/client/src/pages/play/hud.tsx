// HUD pieces shared by the duel and 6-player layouts: identity panels, progress bars, the round
// timer, and the finish-place stamp.
import { useEffect, useState } from "react";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { RankBadge } from "../../shared/RankBadge";
import { tierFor, ordinal } from "../../shared/ranking";
import type { RoomPlayer, GameFrame } from "../../game/match-store";
import styles from "./hud.module.scss";

export function DuelIdentity({ player, side }: { player: RoomPlayer | null; side: "you" | "opp" }) {
	if (!player) return <div className={`${styles.id} ${styles[side]}`} />;
	const tier = typeof player.rating === "number" ? tierFor(player.rating, player.provisional) : null;
	return (
		<div className={`${styles.id} ${styles[side]}`}>
			<AvatarChip avatar={player.avatar} country={player.country} px={52} className={styles.idAvatar} />
			<div className={styles.idInfo}>
				<div className={styles.idName}>{player.name || "Anonymous"}<FlagChip country={player.country} px={16} /></div>
				{tier && <div className={styles.idTier}><RankBadge rating={player.rating!} size={7} /><span style={{ color: tier.color }}>{tier.name}</span></div>}
			</div>
		</div>
	);
}

export function ProgressBar({ frame, side, showLeft = true }: { frame: GameFrame | null; side: "you" | "opp"; showLeft?: boolean }) {
	const pct = Math.round(((frame && frame.progress) || 0) * 100);
	const left = frame ? Math.max(0, (frame.totalSafe || 0) - (frame.safeCount || 0)) : null;
	return (
		<div className={`${styles.barRow} ${styles[side]}`}>
			<div className={styles.bar}><span className={styles.barFill} style={{ width: pct + "%" }} /><b className={styles.barPct}>{pct}%</b></div>
			{showLeft && <span className={styles.cellsLeft}>{left == null ? "" : left + (left === 1 ? " cell left" : " cells left")}</span>}
		</div>
	);
}

// Countdown from a server deadline; urgent under 10s, warning under 30s.
export function useRoundTimer(deadline: number | null): { text: string; cls: string; remaining: number } {
	const [now, setNow] = useState(Date.now());
	useEffect(() => { if (!deadline) return; const h = setInterval(() => setNow(Date.now()), 500); setNow(Date.now()); return () => clearInterval(h); }, [deadline]);
	if (!deadline) return { text: "", cls: "", remaining: 0 };
	const remaining = Math.max(0, Math.round((deadline - now) / 1000));
	const cls = remaining <= 10 && remaining > 0 ? styles.urgent : remaining <= 30 && remaining > 10 ? styles.warning : "";
	return { text: formatRoundTime(remaining), cls, remaining };
}
export function formatRoundTime(s: number): string { const m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; }

export function PlaceStamp({ place }: { place: number | null | undefined }) {
	if (!place) return null;
	return <div className={`${styles.place} ${place === 1 ? styles.place1 : place === 2 ? styles.place2 : place === 3 ? styles.place3 : ""}`}>{ordinal(place)}</div>;
}
