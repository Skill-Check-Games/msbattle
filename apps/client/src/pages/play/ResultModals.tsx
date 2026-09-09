// End-of-series dialogs: the ranked result (rating before/after, tier progress, opponent or full
// standings) and the casual one (winner, rematch or leave).
import { useEffect, useRef, useState } from "react";
import { ResultPanel, ResultActions } from "../../game/ResultPanel";
import { RankBadge } from "../../shared/RankBadge";
import { tierFor, tierProgress, ordinal, formatClearTime } from "../../shared/ranking";
import { sound } from "../../audio/sound";
import { match, MODE_LABELS, SeriesResult, Standing } from "../../game/match-store";
import { useAuth } from "../../shared/auth";
import styles from "./ResultModals.module.scss";

const deltaText = (d: number) => (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d);
const deltaCls = (d: number) => d > 0 ? styles.gain : d < 0 ? styles.loss : styles.flat;
const styleField = (mode: string | null): "ratingSprint" | "ratingStandard" | null => !mode ? null : mode.indexOf("sprint") === 0 ? "ratingSprint" : mode.indexOf("standard") === 0 ? "ratingStandard" : null;

export function SeriesResultModal({ result, myId }: { result: SeriesResult; myId: string | null }) {
	return result.ranked ? <RankedResult result={result} myId={myId} /> : <CasualResult result={result} myId={myId} />;
}

function RankedResult({ result, myId }: { result: SeriesResult; myId: string | null }) {
	const { account, update } = useAuth();
	const standings = result.standings || [];
	const mine: Standing = standings.find(s => s.id === myId) || ({} as Standing);
	const isDuo = standings.length === 2;
	const won = isDuo ? result.winnerId === myId : mine.rank === 1;
	const field = styleField(result.mode);
	const oldRef = useRef<number | null>(account && field && typeof account[field] === "number" ? account[field] : null);
	const oldRating = oldRef.current;
	const newRating = typeof mine.rating === "number" ? mine.rating : (oldRating ?? 0);
	const [shown, setShown] = useState(oldRating ?? newRating);
	const [fill, setFill] = useState(tierProgress(oldRating ?? newRating).fill);
	const crossed = oldRating != null && tierFor(oldRating, mine.provisional).name !== tierFor(newRating, mine.provisional).name;
	const tier = tierFor(newRating, mine.provisional);
	const prog = tierProgress(newRating);

	useEffect(() => {
		// Apply the new rating to the account once, then animate the number and the bar toward it.
		if (field && typeof mine.rating === "number") update({ [field]: mine.rating, provisional: mine.provisional ?? account?.provisional } as any);
		const from = oldRating ?? newRating, to = newRating, start = Date.now(), dur = 950;
		const t1 = setTimeout(() => {
			const frame = () => { const t = Math.min(1, (Date.now() - start) / dur), e = 1 - Math.pow(1 - t, 3); setShown(Math.round(from + (to - from) * e)); if (t < 1) requestAnimationFrame(frame); };
			requestAnimationFrame(frame);
			setFill(crossed ? (newRating > from ? 1 : 0) : prog.fill);
		}, 400);
		const t2 = setTimeout(() => { if (crossed) setFill(prog.fill); }, 1300);
		const t3 = setTimeout(() => { if (crossed) (newRating > (oldRating ?? 0) ? sound.rankUp : sound.rankDown)(); }, 1700);
		return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
	}, []);

	const opp = isDuo ? standings.find(s => s.id !== myId) : null;
	return (
		<ResultPanel kind={won ? "win" : "lose"}>
			<div className={styles.hero}>
				<div className={styles.heroBadge}><RankBadge rating={newRating} size={13} /></div>
				<div>
					<div className={`${styles.heading} ${won ? styles.headingWin : ""}`}>{isDuo ? (won ? "Victory" : "Defeat") : ordinal(mine.rank || 1) + " Place"}</div>
					<div className={styles.sub}>{MODE_LABELS[result.mode || ""] || "Ranked match"}</div>
				</div>
			</div>
			<div className={styles.ratingCard}>
				<div className={styles.cols}>
					<div className={styles.col}><div className={styles.colLabel}>Before</div><div className={`${styles.colNum} ${styles.old}`}>{oldRating ?? newRating}</div></div>
					<div className={`${styles.col} ${styles.center}`}>{typeof mine.ratingDelta === "number" && <div className={`${styles.colNum} ${deltaCls(mine.ratingDelta)}`}>{deltaText(mine.ratingDelta)}</div>}</div>
					<div className={`${styles.col} ${styles.right}`}><div className={styles.colLabel}>After</div><div className={styles.colNum}>{shown}</div></div>
				</div>
				<div className={styles.track}><span className={styles.trackFill} style={{ width: Math.round(fill * 100) + "%" }} /></div>
				<div className={styles.progLabels}><span style={{ color: tier.color }}>{tier.name}</span><span>{prog.atMax ? "Top tier reached" : prog.pointsToNext + " to " + prog.nextName}</span></div>
			</div>
			<div className={styles.divider} />
			{opp ? (
				<div className={styles.context}>
					<div className={styles.oppLine}><span className={styles.oppName}>{opp.name}</span>{typeof opp.rating === "number" && <span style={{ color: tierFor(opp.rating, opp.provisional).color }}>{tierFor(opp.rating, opp.provisional).name}</span>}</div>
					<div className={styles.times}><TimeChip label="Your time" s={mine} you /><TimeChip label="Their time" s={opp} /></div>
				</div>
			) : (
				<div className={styles.context}>
					<div className={styles.eyebrow}>All players</div>
					<div className={styles.standings}>{standings.map(s => (
						<div key={s.id} className={`${styles.srow} ${s.id === myId ? styles.srowMe : ""}`}>
							<div className={`${styles.srank} ${s.rank === 1 ? styles.g1 : s.rank === 2 ? styles.g2 : s.rank === 3 ? styles.g3 : ""}`}>{s.rank}</div>
							<div className={styles.sname}>{s.name}</div>
							<div className={`${styles.stime} ${s.finished ? "" : styles.dnf}`}>{s.finished && typeof s.finishMs === "number" ? formatClearTime(s.finishMs) : Math.round((s.progress || 0) * 100) + "% cleared"}</div>
							<div className={typeof s.ratingDelta === "number" ? deltaCls(s.ratingDelta) : styles.flat}>{typeof s.ratingDelta === "number" ? deltaText(s.ratingDelta) : "—"}</div>
						</div>
					))}</div>
				</div>
			)}
			<ResultActions>
				<button className="btn btn-primary" onClick={() => match.playAnother()}>Play another</button>
				<button className="btn" onClick={() => match.leaveRoom()}>Leave</button>
			</ResultActions>
		</ResultPanel>
	);
}

function TimeChip({ label, s, you }: { label: string; s: Standing; you?: boolean }) {
	const finished = s.finished && typeof s.finishMs === "number";
	return <div className={styles.timeChip}><div className={styles.timeLabel}>{label}</div><div className={`${styles.timeVal} ${finished ? (you ? styles.you : styles.oppc) : styles.dnf}`}>{finished ? formatClearTime(s.finishMs!) : Math.round((s.progress || 0) * 100) + "% cleared"}</div></div>;
}

function CasualResult({ result, myId }: { result: SeriesResult; myId: string | null }) {
	const won = result.winnerId === myId;
	return (
		<ResultPanel kind={won ? "win" : "lose"}>
			<div className={styles.casualHeader}>{!result.winnerId ? "Draw" : won ? "You win!" : (result.winnerName || "Opponent") + " wins"}</div>
			<ResultActions>
				<button className="btn btn-primary" onClick={() => match.dismissSeriesResult()}>Rematch</button>
				<button className="btn" onClick={() => match.leaveRoom()}>Leave</button>
			</ResultActions>
		</ResultPanel>
	);
}
