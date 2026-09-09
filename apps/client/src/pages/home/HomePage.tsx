// Home dashboard: identity row (avatar tile, name + stat strip, flag tile), the three mode rows
// (Sprint, Standard, Puzzles) with live board previews and rank chips, and the daily puzzle hero.
import { useEffect, useRef, useState } from "react";
import RankedPicker, { RankedStyle } from "./RankedPicker";
import PuzzlesPicker from "./PuzzlesPicker";
import Modal from "../../app/Modal";
import CustomizeLab from "../shop/CustomizeLab";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../shared/auth";
import { AvatarChip } from "../../shared/Avatar";
import { RankBadge, PlacementBadge, PuzzleRankBadge, PuzzleLockedBadge } from "../../shared/RankBadge";
import { tierFor } from "../../shared/ranking";
import { puzzleLadder } from "../../shared/puzzle-ladder";
import { countryFlagSrcSquare, countryName } from "../../shared/countries";
import { useCosmetics } from "../../shared/cosmetics";
import { getSocket, onSocket } from "../../online/socket";
import PreviewBoard, { BoardSpec } from "../../game/PreviewBoard";
import { useMatchHistory, useDailyStatus, sessionStats, formatDailyDate } from "./home-data";
import type { Account } from "../../shared/types";
import styles from "./HomePage.module.scss";

// Fixed previews per mode. All three share Standard's 6x9 so they render the same size.
const MODE_BOARDS: Record<string, BoardSpec> = {
	sprint: { rows: 6, cols: 9, mines: [[0, 0], [0, 3], [1, 1], [3, 3], [3, 7], [3, 8], [5, 1], [5, 4], [5, 8]], revealStart: [3, 5], flagged: [[3, 3], [3, 7], [3, 8]] },
	standard: { rows: 6, cols: 9, mines: [[0, 2], [0, 3], [1, 1], [1, 6], [2, 0], [2, 6], [2, 8], [3, 0], [3, 6], [3, 7], [3, 8], [4, 1], [4, 8], [5, 2]], revealStart: [3, 4], flagged: [[1, 6], [2, 6], [3, 6], [3, 7], [5, 2]] },
	puzzles: { rows: 6, cols: 9, mines: [[0, 3], [1, 0], [1, 2], [2, 0], [3, 5], [4, 3], [5, 2]], revealed: [[1, 1], [1, 3], [1, 4], [2, 1], [2, 2], [2, 3], [2, 4], [3, 1], [3, 2], [3, 3], [3, 4], [4, 1], [4, 2], [4, 4]], flagged: [] }
};

export default function HomePage({ openPuzzles = false }: { openPuzzles?: boolean }) {
	const { account } = useAuth();
	const { skin } = useCosmetics();
	const matches = useMatchHistory(account);
	const daily = useDailyStatus(account);
	const [picker, setPicker] = useState<RankedStyle | null>(null);
	const [puzzles, setPuzzles] = useState(openPuzzles);
	const navigate = useNavigate();
	return (
		<section className={styles.dash}>
			<RankedPicker style={picker} onClose={() => setPicker(null)} />
			<PuzzlesPicker open={puzzles} onClose={() => { setPuzzles(false); if (location.pathname === "/puzzles") navigate("/", { replace: true }); }} />
			<IdentityRow account={account} matches={matches} />
			<div className={styles.main}>
				<div className={styles.modes}>
					<ModeRow onOpen={() => setPicker("sprint")} title="Sprint" sub="Quick rounds, fewer mines" spec={MODE_BOARDS.sprint} skin={skin}
						chip={<RankedChip account={account} rating={account?.ratingSprint} played={account?.playedSprint} />} />
					<ModeRow onOpen={() => setPicker("standard")} title="Standard" sub="Bigger boards, more mines" spec={MODE_BOARDS.standard} skin={skin}
						chip={<RankedChip account={account} rating={account?.ratingStandard} played={account?.playedStandard} />} />
					<ModeRow onOpen={() => setPuzzles(true)} title="Puzzles" sub="Rated deduction positions, one at a time" spec={MODE_BOARDS.puzzles} skin={skin}
						chip={<PuzzleChip account={account} />} />
				</div>
				<aside className={styles.aside}>
					<DailyHero account={account} daily={daily} skin={skin} />
				</aside>
			</div>
		</section>
	);
}

// ---- identity row ----
function IdentityRow({ account, matches }: { account: Account | null; matches: ReturnType<typeof useMatchHistory> }) {
	const { signIn, update } = useAuth();
	const [lab, setLab] = useState(false);
	const stats = matches ? sessionStats(matches) : null;
	const flagSrc = countryFlagSrcSquare(account?.country);
	return (
		<div className={styles.you}>
			<Modal open={lab} onClose={() => setLab(false)} width={1200} title="Customize" labelledBy="lab_title" className={styles.labDialog}>{lab && <CustomizeLab host="modal" />}<div className={styles.labFoot}><button className="btn btn-primary" type="button" onClick={() => setLab(false)}>Done</button></div></Modal>
			<button type="button" className={`${styles.youBox} ${styles.youAvatar}`} title="Edit avatar" onClick={() => setLab(true)}>
				{account ? <AvatarChip avatar={account.avatarColor} country={account.country} px={73} corner={0} title="" /> : <span className={`skel-shimmer ${styles.avatarSkel}`} />}
			</button>
			<div className={`${styles.youBox} ${styles.youMain}`}>
				<div className={styles.youText}>
					<NameRow account={account} onRenamed={(name) => update({ name })} />
					{account && account.guest && <a href="#" className={styles.signin} onClick={(e) => { e.preventDefault(); signIn("google"); }}>Sign in to save your stats</a>}
				</div>
				<div className={`${styles.stats} ${stats && !stats.isToday ? styles.statsPast : ""}`}>
					{stats ? (
						<>
							<Cell label={stats.isToday ? "Played today" : "Played"} value={String(stats.played)} />
							<Cell label="Win rate" value={stats.winRate + "%"} />
							{stats.streak >= 2 && <Cell label="Win streak" value={"🔥 " + stats.streak} />}
							<Cell label="Rank change" value={<em className={stats.gain > 0 ? styles.up : stats.gain < 0 ? styles.dn : ""}>{(stats.gain > 0 ? "+" : "") + stats.gain}</em>} />
						</>
					) : ["Played today", "Win rate", "Win streak", "Rank change"].map((l) => (
						<Cell key={l} label={l} empty value={matches === null && account ? <i className={`skel-shimmer ${styles.cellSkel}`} /> : "—"} />
					))}
				</div>
			</div>
			<div className={`${styles.youBox} ${styles.youFlag}`} title={account?.country ? countryName(account.country) : "Pick a flag"}>
				{flagSrc ? <img src={flagSrc} alt="" /> : <span className={styles.flagEmpty}>+</span>}
			</div>
		</div>
	);
}

function Cell({ label, value, empty }: { label: string; value: React.ReactNode; empty?: boolean }) {
	return <span className={`${styles.cell} ${empty ? styles.cellEmpty : ""}`}><span>{label}</span><b>{value}</b></span>;
}

// Name with an inline rename: pencil swaps the text for an input; Enter or blur commits, Escape cancels.
function NameRow({ account, onRenamed }: { account: Account | null; onRenamed: (name: string) => void }) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => onSocket("name_accepted", (d) => { if (d && d.name) onRenamed(d.name); }), [onRenamed]);
	useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
	const commit = () => {
		setEditing(false);
		const name = draft.trim();
		if (name && account && name !== account.name) getSocket().emit("set_name", { name });
	};
	return (
		<div className={styles.nameRow}>
			{editing ? (
				<input ref={inputRef} className={styles.nameInput} value={draft} maxLength={24} autoComplete="off" aria-label="Display name"
					onChange={(e) => setDraft(e.target.value)} onBlur={commit}
					onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setEditing(false); }} />
			) : (
				<div className={styles.name}>{account ? account.name : "Player"}</div>
			)}
			{account && !editing && (
				<button type="button" className={styles.editName} aria-label="Change name" title="Change name" onClick={() => { setDraft(account.name); setEditing(true); }}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
				</button>
			)}
		</div>
	);
}

// ---- mode rows ----
function ModeRow({ to, onOpen, title, sub, spec, skin, chip }: { to?: string; onOpen?: () => void; title: string; sub: string; spec: BoardSpec; skin: string; chip: React.ReactNode }) {
	const inner = (
		<>
			<span className={styles.rowBoard}><span className={styles.previewFrame}><PreviewBoard spec={spec} skin={skin} className={styles.previewCanvas} /></span></span>
			<span className={styles.rowInfo}>
				<h4 className={styles.rowTitle}>{title}</h4>
				<p className={styles.rowSub}>{sub}</p>
			</span>
			<span className={styles.rowStat}>{chip}</span>
		</>
	);
	if (onOpen) return <button type="button" className={styles.row} aria-label={"Play " + title} onClick={onOpen}>{inner}</button>;
	return <Link to={to!} className={styles.row} aria-label={"Play " + title}>{inner}</Link>;
}

// Tier only, never the exact rating. Below the placement threshold: a locked badge, "Placement" and
// one dot per match played, since a rating of 0 would otherwise wear Bronze I unearned.
function RankedChip({ account, rating, played }: { account: Account | null; rating?: number; played?: number }) {
	if (!account || typeof rating !== "number") return null;
	const need = account.placementGames || 5;
	if (typeof played === "number" && played < need) {
		return (
			<>
				<PlacementBadge size={9} />
				<span className={styles.statText}>
					<span className={`${styles.tier} ${styles.tierPlacing}`}>Placement</span>
					<span className={styles.dots} title={`${played} of ${need} placement matches played`}>
						{Array.from({ length: need }, (_, i) => <i key={i} className={i < played ? styles.on : ""} />)}
					</span>
				</span>
			</>
		);
	}
	const t = tierFor(rating, account.provisional);
	return (
		<>
			<RankBadge rating={rating} size={9} />
			<span className={styles.statText}><span className={styles.tier} style={{ color: t.color }}>{t.name}</span></span>
		</>
	);
}

function PuzzleChip({ account }: { account: Account | null }) {
	if (!account) return null;
	if (!(account.puzzlePoints > 0)) {
		return (
			<>
				<PuzzleLockedBadge size={9} />
				<span className={styles.statText}><span className={`${styles.tier} ${styles.tierPlacing}`}>Unranked</span></span>
			</>
		);
	}
	const pl = puzzleLadder(account.puzzlePoints);
	return (
		<>
			<PuzzleRankBadge points={account.puzzlePoints} size={9} />
			<span className={styles.statText}>
				<span className={styles.tier} style={{ color: pl.tierColor }}>{pl.tierName}</span>
				<span className={styles.tierSub}>{pl.atMax ? "Max level" : "Lvl " + pl.level}</span>
			</span>
		</>
	);
}

// ---- daily hero ----
function DailyHero({ account, daily, skin }: { account: Account | null; daily: ReturnType<typeof useDailyStatus>; skin: string }) {
	const navigate = useNavigate();
	const attempt = daily ? daily.attempt : account?.dailyAttempt || null;
	const state = !account ? "" : !attempt ? styles.dailyFresh : attempt.solved ? styles.dailySolved : styles.dailyMissed;
	const label = !account ? "Sign in to play" : !attempt ? "Play today's puzzle" : attempt.solved ? "Solved. Back tomorrow" : "Try again";
	const disabled = !account || !!(attempt && attempt.solved);
	const streak = daily ? daily.streak : account?.dailyStreak || 0;
	const board = daily?.board || null;
	return (
		<div className={`${styles.daily} ${state}`}>
			<div className={styles.dailyHead}>
				<span className={styles.dailyTag}>Daily puzzle</span>
				<span className={styles.dailyDate}>{daily?.date ? formatDailyDate(daily.date) : ""}</span>
			</div>
			<div className={styles.dailyBody}>
				<div className={styles.dailyBoardWrap}>
					<div className={styles.dailyBoard}>
						{board ? <span className={`${styles.previewFrame} ${styles.dailyPreview}`}><PreviewBoard spec={{ rows: board.rows, cols: board.cols, mines: board.mines, revealed: board.revealed }} skin={skin} className={styles.dailyCanvas} /></span>
							: daily ? <div className={styles.dailyEmpty}>No puzzle available today.</div> : <span className={`skel-shimmer ${styles.dailySkel}`} />}
					</div>
					<span className={styles.dailyBadge} aria-hidden="true" />
				</div>
				<div className={styles.dailyMeta}>
					<span className={styles.dailyCell}><span className={styles.dailyLabel}>Streak</span><span className={styles.dailyValue}>{account ? "🔥 " + streak : "—"}</span></span>
					<span className={styles.dailyCell}><span className={styles.dailyLabel}>Today</span><span className={styles.dailyValue}>{!account ? "" : !attempt ? "Not played" : attempt.solved ? "Solved today" : "Missed today"}</span></span>
				</div>
				<button className={`btn btn-primary ${styles.dailyAction}`} disabled={disabled} onClick={() => navigate("/puzzles/daily")}>{label}</button>
			</div>
		</div>
	);
}
