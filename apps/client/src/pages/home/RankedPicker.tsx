// Sprint / Standard picker: 1v1 or 7-player. Picking starts the ranked search and opens the play view.
import { useNavigate } from "react-router-dom";
import Modal from "../../app/Modal";
import { useAuth } from "../../shared/auth";
import { tierFor } from "../../shared/ranking";
import { match } from "../../game/match-store";
import { autoEnterGameFullscreen, enterDuelMobileFullscreen } from "../../game/fullscreen";
import styles from "./RankedPicker.module.scss";

const META = {
	sprint: { title: "Sprint", sub: "Quick rounds, fewer mines", pitch: "Fast boards, sharp openings. Speed wins, mistakes cost seconds.", duoSub: "Head-to-head race", sixSub: "Free-for-all sprint", color: "#fbbf24", icon: "M13 2L4 14h6l-1 8 9-12h-6l1-8z" },
	standard: { title: "Standard", sub: "Bigger boards, more mines", pitch: "Dense boards reward careful reading. Bad guesses end your match, every flag matters.", duoSub: "Head-to-head deduction", sixSub: "Dense free-for-all", color: "#a78bfa", icon: "M12 3a9 9 0 109 9 9 9 0 00-9-9zm0 4a5 5 0 11-5 5 5 5 0 015-5zm0 3a2 2 0 102 2 2 2 0 00-2-2z" }
};
export type RankedStyle = keyof typeof META;

export default function RankedPicker({ style, onClose }: { style: RankedStyle | null; onClose: () => void }) {
	const { account } = useAuth();
	const navigate = useNavigate();
	if (!style) return null;
	const meta = META[style];
	const rating = account ? (style === "sprint" ? account.ratingSprint : account.ratingStandard) : null;
	const tier = rating != null ? tierFor(rating, account?.provisional) : null;
	const pick = (mode: string) => { onClose(); autoEnterGameFullscreen(); if (mode.endsWith("_duo")) enterDuelMobileFullscreen(); match.findRanked(mode); navigate("/play"); };
	return (
		<Modal open onClose={onClose} width={620} labelledBy="ranked_modal_title" className={styles.dialog}>
			<div className={styles.head}>
				<div className={styles.icon} style={{ color: meta.color }} aria-hidden="true"><svg viewBox="0 0 24 24"><path d={meta.icon} fill="currentColor" /></svg></div>
				<div><h2 id="ranked_modal_title" className={styles.title}>{meta.title}</h2><p className={styles.sub}>{meta.sub}</p></div>
				<div className={styles.rating}>{tier ? <span className={styles.tier} style={{ color: tier.color }}>{tier.name}</span> : <span className={styles.tier}>—</span>}</div>
			</div>
			<p className={styles.pitch}>{meta.pitch}</p>
			<div className={styles.options}>
				<button className={styles.option} type="button" onClick={() => pick(style + "_duo")}><span className={styles.optionTitle}>1v1</span><span className={styles.optionSub}>{meta.duoSub}</span></button>
				<button className={styles.option} type="button" onClick={() => pick(style + "_six")}><span className={styles.optionTitle}>7-player</span><span className={styles.optionSub}>{meta.sixSub}</span></button>
			</div>
		</Modal>
	);
}
