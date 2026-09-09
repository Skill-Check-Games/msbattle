// Puzzles picker: the Puzzle Ladder (with your tier and level progress inline) and Time Trial.
import { useNavigate } from "react-router-dom";
import Modal from "../../app/Modal";
import { useAuth } from "../../shared/auth";
import { puzzleLadder } from "../../shared/puzzle-ladder";
import { PuzzleRankBadge } from "../../shared/RankBadge";
import styles from "./RankedPicker.module.scss";
import own from "./PuzzlesPicker.module.scss";

export default function PuzzlesPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
	const { account } = useAuth();
	const navigate = useNavigate();
	if (!open) return null;
	const l = puzzleLadder(account?.puzzlePoints || 0);
	const go = (path: string) => { onClose(); navigate(path); };
	return (
		<Modal open onClose={onClose} width={620} labelledBy="puzzles_modal_title" className={styles.dialog}>
			<div className={styles.head}>
				<div className={styles.icon} style={{ color: "#60a5fa" }} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 4l2.5 2.5L20 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
				<div><h2 id="puzzles_modal_title" className={styles.title}>Puzzles</h2><p className={styles.sub}>Rated deduction positions, one at a time</p></div>
			</div>
			<div className={`${styles.options} ${own.options}`}>
				<button className={styles.option} type="button" onClick={() => go("/puzzles/play")}>
					<span className={styles.optionIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 4l2.5 2.5L20 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
					<span className={styles.optionTitle}>Puzzle Ladder</span>
					<span className={styles.optionSub}>Earn points on every solve and climb the tiers.</span>
					{account && (
						<span className={own.progress}>
							<span className={own.progHead}><PuzzleRankBadge points={account.puzzlePoints || 0} size={6} /><span style={{ color: l.tierColor }}>{l.tierName}</span><span className={own.level}>{l.atMax ? "Max level" : "Lvl " + l.level + " · " + l.pointsIntoLevel + "/" + l.pointsPerLevel}</span></span>
							<span className={own.bar}><span className={own.barFill} style={{ width: l.levelPct + "%", background: l.tierColor }} /></span>
						</span>
					)}
				</button>
				<button className={styles.option} type="button" onClick={() => go("/puzzles/storm")}>
					<span className={styles.optionIcon} aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 8v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M9 2h6M12 2v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></span>
					<span className={styles.optionTitle}>Time Trial</span>
					<span className={styles.optionSub}>Crack as many as you can in three minutes.</span>
				</button>
			</div>
		</Modal>
	);
}
