// "How to play": rules, two example boards, and the live (rebindable) controls. Opened from the navbar.
import { Link } from "react-router-dom";
import Modal from "./Modal";
import { keybindings } from "../shared/keybindings";
import LearnBoard from "../pages/learn/LearnBoard";
import type { BoardSpec } from "../pages/learn/learn-data";
import styles from "./HelpModal.module.scss";

const MINES = [[0, 1], [1, 0], [1, 1]];
const SAFE: number[][] = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!MINES.some(m => m[0] === r && m[1] === c)) SAFE.push([r, c]);
const NUMBERS: BoardSpec = { rows: 4, cols: 4, mines: MINES, revealed: SAFE };
const FLAGS: BoardSpec = { rows: 4, cols: 4, mines: MINES, revealed: SAFE, flagged: MINES };

export default function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
	const key = (a: "reveal" | "flag" | "next") => keybindings.label(keybindings.get(a));
	return (
		<Modal open={open} onClose={onClose} title="How to play" width={540}>
			<ul className={styles.list}>
				<li><b>Reveal</b> tiles to uncover them. A number tells you how many of the 8 neighbouring tiles are mines.</li>
				<li><b>Flag</b> the tiles you've worked out are mines.</li>
				<li>Clear <b>every safe tile</b> to win. Reveal a mine and the game ends.</li>
				<li>Every board is <b>always solvable with logic</b>. You never have to guess.</li>
			</ul>
			<div className={styles.examples}>
				<figure className={styles.example}><div className={styles.board}><LearnBoard spec={NUMBERS} cellPx={21} /></div><figcaption className={styles.cap}>Each number = mines in the 8 tiles around it</figcaption></figure>
				<figure className={styles.example}><div className={styles.board}><LearnBoard spec={FLAGS} cellPx={21} /></div><figcaption className={styles.cap}>Flag the mines, clear the rest to win</figcaption></figure>
			</div>
			<p className={styles.foot}>Want a guided walkthrough? Try the <Link to="/learn" onClick={onClose}>Learn</Link> lessons.</p>
			<h3 className={styles.sectionTitle}>Controls</h3>
			<div className={styles.controls}>
				<div className={styles.ctrl}><span className={styles.act}>Reveal a tile</span><span className={styles.keys}>Left-click <i>or</i> <kbd>{key("reveal")}</kbd></span></div>
				<div className={styles.ctrl}><span className={styles.act}>Flag / unflag</span><span className={styles.keys}>Right-click <i>or</i> <kbd>{key("flag")}</kbd></span></div>
				<div className={styles.ctrl}><span className={styles.act}>Chord (clear neighbours)</span><span className={styles.keys}>Click a number once its mines are flagged</span></div>
				<div className={styles.ctrl}><span className={styles.act}>Move the cursor</span><span className={styles.keys}><kbd>↑ ↓ ← →</kbd></span></div>
				<div className={styles.ctrl}><span className={styles.act}>Jump to next area</span><span className={styles.keys}><kbd>{key("next")}</kbd></span></div>
			</div>
			<p className={styles.foot}>Keys are rebindable on the <Link to="/settings" onClick={onClose}>Settings</Link> page.</p>
		</Modal>
	);
}
