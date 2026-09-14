// /admin landing: one card per admin tool, plus the "reset my puzzle progress" test action.
// Port of renderAdminLanding / makeAdminCard (legacy admin/PuzzleLab.js).
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getSocket, onSocket } from "../../online/socket";
import { useAuth } from "../../shared/auth";
import { PUZZLE_TIERS, LEVELS_PER_TIER, pointsForTierLevel, puzzleLadder } from "../../shared/puzzle-ladder";
import { AdminPage, adminStyles } from "./admin-shared";
import styles from "./AdminHome.module.scss";

const CARDS: { title: string; desc: string; label: string; href: string }[] = [
	{ title: "Puzzle Lab", desc: "Generate new puzzles, tune density and difficulty, inspect tier distribution.", label: "Open Lab", href: "/admin/lab" },
	{ title: "All puzzles", desc: "Browse the entire pool. Sort by rating, filter by tier.", label: "Browse pool", href: "/admin/puzzles" },
	{ title: "Ranked bots", desc: "Browse the benchmarked bot pool, inspect variables and per-mode Elo, and watch any bot play.", label: "Browse bots", href: "/admin/bots" },
	{ title: "Starting positions", desc: "Enumerated cascade patterns rated by analyzer difficulty.", label: "Browse positions", href: "/admin/starting-positions" },
	{ title: "Deduction patterns", desc: "Minimal first-move templates extracted from starting positions.", label: "Browse patterns", href: "/admin/patterns" },
	{ title: "Start patterns", desc: "Unique first-deduction building blocks enumerated from 3×3 / 3×4 starting cascades.", label: "Browse start patterns", href: "/admin/start-patterns" },
	{ title: "Combined puzzles", desc: "Script-generated boards that compose two start patterns at a shared seam. Play and analyze each.", label: "Browse combined puzzles", href: "/admin/combined-puzzles" },
	{ title: "Marathon boards", desc: "Long, dense, no-guess-solvable boards from the hill-climb generator. Sort by difficulty, play any of them.", label: "Browse marathon boards", href: "/admin/marathon-boards" },
	{ title: "Design", desc: "Visual design reference: the full rank ladder (every tier and sub-tier) rendered with the live badge component.", label: "Open design", href: "/admin/design" },
	{ title: "Board animations", desc: "Live preview of the round-start countdown digit and the \"go\" sweep that follows it, looping forever, with sliders for style, colour, and timing.", label: "Open lab", href: "/admin/countdown" },
	{ title: "Sound Lab", desc: "Every sound effect in the game, each with its own Play button and a shared speed control, plus a set of alternate takes on the idle to ready sweep sound to compare.", label: "Open lab", href: "/admin/sounds" },
	{ title: "Match debug", desc: "Client versus server board state for this tab's live match, with the socket event log. Open it in the tab that is playing.", label: "Open debug", href: "/admin/debug" }
];

export default function AdminHome() {
	const { account, update } = useAuth();
	// Both test actions below echo the fresh values; apply them so the account reflects them without a reload.
	useEffect(() => onSocket("puzzles_reset", (d) => {
		if (!account || !d) return;
		update({ puzzlePoints: d.puzzlePoints, puzzleRating: d.puzzleRating, puzzleStreak: d.puzzleStreak || 0 });
	}), [account, update]);
	return (
		<AdminPage title="Admin" sub="Puzzle pool tools. Generation requires DEV_AUTH locally or a PUZZLE_ADMIN_TOKEN on the server (set via ?token=… on the URL).">
			<div className={adminStyles.cards}>
				{CARDS.map(c => (
					<Link key={c.href} to={c.href} className={`${adminStyles.card} ${styles.card}`}>
						<h2 className={adminStyles.cardTitle}>{c.title}</h2>
						<p className={adminStyles.cardText}>{c.desc}</p>
						<span className={styles.action}>{c.label} →</span>
					</Link>
				))}
				<ResetCard />
				<SetRankCard />
			</div>
		</AdminPage>
	);
}

// Testing: reset my own puzzle progress (server re-checks admin). Inline confirm, then admin_reset_puzzles.
function ResetCard() {
	const [confirming, setConfirming] = useState(false);
	const [done, setDone] = useState(false);
	const timer = useRef<number | null>(null);
	useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
	const fire = () => {
		getSocket().emit("admin_reset_puzzles");
		setConfirming(false); setDone(true);
		timer.current = window.setTimeout(() => setDone(false), 1600);
	};
	return (
		<div className={adminStyles.card}>
			<h2 className={adminStyles.cardTitle}>Reset puzzle progress</h2>
			<p className={adminStyles.cardText}>Wipe your own puzzle rating back to the starting 450 and Puzzle Ladder points to 0. Admin only.</p>
			{confirming ? (
				<div className={styles.confirm}>
					<span>Reset your puzzle rating to 450 and Ladder points to 0?</span>
					<div className={adminStyles.row}>
						<button type="button" className={`${styles.btn} ${styles.danger}`} onClick={fire}>Reset</button>
						<button type="button" className={styles.btn} onClick={() => setConfirming(false)}>Cancel</button>
					</div>
				</div>
			) : (
				<button type="button" className={styles.btn} disabled={done} onClick={() => setConfirming(true)}>{done ? "✓ Reset" : "Reset my puzzle progress"}</button>
			)}
		</div>
	);
}

// Testing: put my own Ladder at an exact tier + level (server re-checks admin), optionally with a puzzle
// rating so the served difficulty matches the rank being tested.
function SetRankCard() {
	const { account } = useAuth();
	const current = puzzleLadder(account?.puzzlePoints || 0);
	const [tier, setTier] = useState(current.tierIndex);
	const [level, setLevel] = useState(current.level);
	const [rating, setRating] = useState("");
	const [done, setDone] = useState(false);
	const timer = useRef<number | null>(null);
	useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
	const points = pointsForTierLevel(tier, level);
	const fire = () => {
		getSocket().emit("admin_set_puzzle_rank", { points, rating: rating.trim() === "" ? null : Number(rating) });
		setDone(true);
		timer.current = window.setTimeout(() => setDone(false), 1600);
	};
	return (
		<div className={adminStyles.card}>
			<h2 className={adminStyles.cardTitle}>Set puzzle rank</h2>
			<p className={adminStyles.cardText}>Jump your own Puzzle Ladder to a tier and level (sets the points total to the start of that level). Rating is optional. Admin only.</p>
			<div className={styles.fields}>
				<label>Tier <select value={tier} onChange={e => setTier(Number(e.target.value))}>{PUZZLE_TIERS.map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}</select></label>
				<label>Level <input type="number" min={1} max={LEVELS_PER_TIER} value={level} onChange={e => setLevel(Math.min(LEVELS_PER_TIER, Math.max(1, Number(e.target.value) || 1)))} /></label>
				<label>Rating <input type="number" min={0} max={5000} placeholder={String(account?.puzzleRating ?? "")} value={rating} onChange={e => setRating(e.target.value)} /></label>
			</div>
			<p className={adminStyles.cardText}>= {points} pts{rating.trim() !== "" ? ", rating " + rating : ""}</p>
			<button type="button" className={styles.btn} disabled={done} onClick={fire}>{done ? "✓ Set" : "Set my puzzle rank"}</button>
		</div>
	);
}
