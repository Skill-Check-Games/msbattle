// HUD pieces shared by the duel and 6-player layouts: identity panels, progress bars, the round
// timer, and the finish-place stamp.
import { useEffect, useState } from "react";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { RankBadge } from "../../shared/RankBadge";
import { tierFor, ordinal } from "../../shared/ranking";
import type { RoomPlayer, GameFrame } from "../../game/match-store";
import styles from "./hud.module.scss";

// plain: no mirroring for the opponent (both arenas read left to right); ring: the landscape-phone
// portrait frame (a circle in the side colour).
// skeleton: while the seat is empty (searching), shimmer placeholders sit exactly where the avatar, name
// and tier will land, so the row does not move when the player arrives.
export function DuelIdentity({ player, side, vertical, plain, ring, skeleton }: { player: RoomPlayer | null; side: "you" | "opp"; vertical?: boolean; plain?: boolean; ring?: boolean; skeleton?: boolean }) {
	const cls = `${styles.id} ${styles[side]} ${vertical ? styles.vertical : ""} ${plain ? styles.plain : ""} ${ring ? styles.ring : ""}`;
	if (!player && skeleton) return (
		<div className={cls} aria-label="Waiting for an opponent">
			<span className={`skel-shimmer ${styles.skelAvatar} ${vertical ? styles.skelAvatarBig : ""}`} />
			<div className={styles.idInfo}><span className={`skel-shimmer ${styles.skelName}`} /><span className={`skel-shimmer ${styles.skelTier}`} /></div>
		</div>
	);
	if (!player) return <div className={cls} />;
	const tier = typeof player.rating === "number" ? tierFor(player.rating, player.provisional) : null;
	return (
		<div className={cls}>
			<AvatarChip avatar={player.avatar} country={player.country} px={vertical ? 64 : 52} className={styles.idAvatar} />
			<div className={styles.idInfo}>
				<div className={styles.idName}><span className={styles.idNameText}>{player.name || "Anonymous"}</span><FlagChip country={player.country} px={16} /></div>
				{tier && <div className={styles.idTier}><RankBadge rating={player.rating!} size={7} /><span style={{ color: tier.color }}>{tier.name}</span></div>}
			</div>
		</div>
	);
}

// A progress bar in the side colour; the percentage sits inline before or after it (or not at all)
// and the cells-left caption goes underneath.
export function ProgressBar({ frame, side, showLeft = true, pct: pctPos = "after" }: { frame: GameFrame | null; side: "you" | "opp"; showLeft?: boolean; pct?: "before" | "after" | false }) {
	const pct = Math.round(((frame && frame.progress) || 0) * 100);
	const left = frame ? Math.max(0, (frame.totalSafe || 0) - (frame.safeCount || 0)) : null;
	const label = <b className={styles.barPct}>{pct}%</b>;
	return (
		<div className={`${styles.barRow} ${styles[side]}`}>
			<div className={styles.barLine}>
				{pctPos === "before" && label}
				<div className={styles.bar}><span className={styles.barFill} style={{ width: pct + "%" }} /></div>
				{pctPos === "after" && label}
			</div>
			{showLeft && <span className={styles.cellsLeft}>{left == null ? "\u00a0" : left + (left === 1 ? " cell left" : " cells left")}</span>}
		</div>
	);
}
// The desktop 1v1 bar: square, thick, filling from the arena's outer edge toward the centre of the
// screen in a gradient of the side colour. Percentage and cells left sit inside the bar at the centre
// end; a second copy in the bar's background colour is clipped to the fill, so the text flips colour
// exactly where the fill passes under it.
export function DuelBar({ frame, side }: { frame: GameFrame | null; side: "you" | "opp" }) {
	const pct = Math.round(((frame && frame.progress) || 0) * 100);
	const labels = <><b className={styles.duelPct}>{pct}%</b><span className={styles.duelLeft}>{cellsLeftOf(frame)}</span></>;
	const clip = side === "you" ? `inset(0 ${100 - pct}% 0 0)` : `inset(0 0 0 ${100 - pct}%)`;
	return (
		<div className={`${styles.duelBar} ${styles[side]}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
			<span className={styles.duelFill} style={{ width: pct + "%" }} />
			<div className={styles.duelLabels}>{labels}</div>
			<div className={`${styles.duelLabels} ${styles.duelLabelsDark}`} style={{ clipPath: clip }} aria-hidden="true">{labels}</div>
		</div>
	);
}

// The desktop 1v1 lead bar above the two cards: two halves wearing the card treatment (side colour
// border, ring, glow, outer corners), flat fills, meeting at a slanted cut. The seam is the balance of
// cells left: with 1 of yours and 9 of theirs to go the blue half is 90%, and a finished player owns the
// whole bar. Before the round both have everything left, so it starts at the middle. --x is the seam.
// flat: the phone landscape version, a thin strip with square corners and no glow, stuck to the screen's top edge.
// Where the seam sits: lead is the blue share (0 to 1), x the CSS position of the seam. The seam runs from
// 14px left of the bar at lead 0 to 10px past its right edge at lead 1, so the moment someone wins the whole
// slanted seam (blue's slant, the 4px gap, red's slant) has just left the bar and the winner's colour fills
// it edge to edge (leadSeg geometry in hud.module.scss).
export function leadSeam(myLeft: number, opLeft: number): { lead: number; x: string } {
	const total = myLeft + opLeft, lead = total > 0 ? opLeft / total : 0.5;
	return { lead, x: `calc(-14px + ${lead.toFixed(4)} * (100% + 24px))` };
}
export function LeadBar({ myLeft, opLeft, flat }: { myLeft: number; opLeft: number; flat?: boolean }) {
	const { lead, x } = leadSeam(myLeft, opLeft);
	return (
		<div className={`${styles.leadBar} ${flat ? styles.leadFlat : ""}`} style={{ "--x": x } as React.CSSProperties} role="img" aria-label={`Lead ${Math.round(lead * 100)}% you`}>
			<span className={`${styles.leadSeg} ${styles.you}`} />
			<span className={`${styles.leadSeg} ${styles.opp}`} />
		</div>
	);
}
// The card's head-row readout: percentage in the side colour with the cells left beneath.
// hit: the player is in a mine penalty; the readout says so (the card's --p fades the red back out).
export function ArenaStat({ frame, side, hit }: { frame: GameFrame | null; side: "you" | "opp"; hit?: boolean }) {
	const pct = Math.round(((frame && frame.progress) || 0) * 100);
	const left = cellsLeftOf(frame);
	return <div className={`${styles.arenaStat} ${styles[side]}`}><span className={styles.statPct}>{pct}%</span><span className={`${styles.statLeft} ${hit ? styles.statHit : ""}`}>{hit && left ? "Mine hit, " + left : left || "\u00a0"}</span></div>;
}

export const cellsLeftOf = (frame: GameFrame | null): string => { if (!frame) return ""; const left = Math.max(0, (frame.totalSafe || 0) - (frame.safeCount || 0)); return left + (left === 1 ? " cell left" : " cells left"); };

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
