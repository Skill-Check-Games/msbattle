// End-of-series dialogs: the ranked result (how you placed, what it did to your rating or your placement
// run, and how the field finished) and the casual one (winner, rematch or leave). One panel serves the 1v1
// and the 6-player free-for-all: the hero and the rating block are shared, only the context block differs
// (the two duellists with their times, or the whole field as a list).
import { useEffect, useMemo, useRef, useState } from "react";
import { ResultPanel, ResultActions } from "../../game/ResultPanel";
import { RankBadge, PlacementBadge } from "../../shared/RankBadge";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { tierFor, tierProgress, ordinal, formatClearTime } from "../../shared/ranking";
import { sound } from "../../audio/sound";
import { match, MODE_LABELS, SeriesResult, Standing } from "../../game/match-store";
import { useAuth } from "../../shared/auth";
import type { Account } from "../../shared/types";
import { useMediaQuery, LANDSCAPE_PHONE_MQ } from "./mobile";
import styles from "./ResultModals.module.scss";
import { RankBadgeSwap, RANK_BADGE_SWAP_MS } from "../../game/RankBadgeSwap";
import { PlacementReveal, PLACEMENT_REVEAL_MS, PLACEMENT_REVEAL_SOUND_MS } from "../../game/PlacementReveal";

const deltaText = (d: number) => (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d);
const deltaCls = (d: number) => d > 0 ? styles.gain : d < 0 ? styles.loss : styles.flat;
const styleField = (mode: string | null): "ratingSprint" | "ratingStandard" | null => !mode ? null : mode.indexOf("sprint") === 0 ? "ratingSprint" : mode.indexOf("standard") === 0 ? "ratingStandard" : null;
const playedField = (mode: string | null): "playedSprint" | "playedStandard" | null => !mode ? null : mode.indexOf("sprint") === 0 ? "playedSprint" : mode.indexOf("standard") === 0 ? "playedStandard" : null;
// A player's line in the standings: their clear time, or how far they got if they never cleared.
const resultOf = (s: Standing) => s.finished && typeof s.finishMs === "number" ? formatClearTime(s.finishMs) : Math.round((s.progress || 0) * 100) + "%";

// compact: the landscape-phone layout (two columns side by side, sized to a short viewport).
export function SeriesResultModal({ result, myId, compact }: { result: SeriesResult; myId: string | null; compact?: boolean }) {
	const landscapePhone = useMediaQuery(LANDSCAPE_PHONE_MQ);   // the play page also passes compact for a force-rotated portrait phone
	return result.ranked ? <RankedResult result={result} myId={myId} compact={compact || landscapePhone} /> : <CasualResult result={result} myId={myId} />;
}

// Each result is applied to the local account exactly once, however often this panel is mounted (a phone
// rotating between the two play layouts remounts it with the same result object).
const applied = new WeakSet<object>();

function RankedResult({ result, myId, compact }: { result: SeriesResult; myId: string | null; compact?: boolean }) {
	const { account, update } = useAuth();
	const standings = result.standings || [];
	// Who am I in this list? By id, and failing that by name (an id can change under a reconnect or a
	// hand-off to a game server). Never guessed: an unidentified player is shown no place at all, rather
	// than the first one, which is where "1st place" used to come from after finishing fifth.
	const mine = useMemo<Standing | null>(() => {
		const byId = standings.find(s => s.id === myId);
		if (byId) return byId;
		const name = account && account.name;
		const byName = name ? standings.filter(s => s.name === name) : [];
		return byName.length === 1 ? byName[0] : null;
	}, [standings, myId, account && account.name]);

	const isDuo = standings.length === 2;
	const rank = mine && typeof mine.rank === "number" ? mine.rank : null;
	// A 1v1 with no winner is a draw (both share rank 1), which is neither a victory nor a defeat.
	const drew = isDuo && !result.winnerId;
	const won = drew ? false : isDuo ? (mine ? rank === 1 : result.winnerId === myId) : rank === 1;
	const field = styleField(result.mode), playedKey = playedField(result.mode);

	// Everything about "before" is captured at mount, ahead of the account patch below.
	const beforeRef = useRef<{ rating: number | null; played: number | null }>({
		rating: account && field && typeof account[field] === "number" ? account[field] : null,
		played: account && playedKey && typeof account[playedKey] === "number" ? account[playedKey] : null
	});
	const oldRating = beforeRef.current.rating;
	const newRating = typeof mine?.rating === "number" ? mine.rating : (oldRating ?? 0);
	const need = (account && account.placementGames) || 5;
	const playedAfter = beforeRef.current.played == null ? null : beforeRef.current.played + 1;
	// Still in placement after this match (the server decides); the rating stays hidden until the run ends.
	const placing = !!mine?.provisional;
	const revealed = !placing && playedAfter != null && playedAfter === need;   // this match completed the run

	const [shown, setShown] = useState(oldRating ?? newRating);
	const [fill, setFill] = useState(tierProgress(oldRating ?? newRating).fill);
	const crossed = oldRating != null && tierFor(oldRating).name !== tierFor(newRating).name;
	// The badge's icon / colour changed (a base tier, not just a sub-tier): swap it with the shipped animation.
	const tierChanged = oldRating != null && tierFor(oldRating).color !== tierFor(newRating).color;
	const [badgeSwap, setBadgeSwap] = useState(false);
	// The run just ended: the locked plate shakes and shatters to reveal the first rank badge (PlacementReveal).
	const [revealing, setRevealing] = useState(revealed);
	const tier = tierFor(newRating);
	const prog = tierProgress(newRating);

	useEffect(() => {
		// The account carries this match: the new rating, whether placement is over, and one more game
		// played in this style — so the home page's rank chip is right without a reload.
		if (!applied.has(result)) {
			applied.add(result);
			const patch: Partial<Account> = {};
			if (field && typeof mine?.rating === "number") patch[field] = mine.rating;
			if (typeof mine?.provisional === "boolean") patch.provisional = mine.provisional;
			if (playedKey && beforeRef.current.played != null) patch[playedKey] = beforeRef.current.played + 1;
			if (account && typeof account.played === "number") patch.played = account.played + 1;
			if (Object.keys(patch).length) update(patch);
		}
		if (placing) return;   // no rating animation during a placement run: the rings tell that story
		const from = oldRating ?? newRating, to = newRating, start = Date.now(), dur = 950;
		const t1 = setTimeout(() => {
			const frame = () => { const t = Math.min(1, (Date.now() - start) / dur), e = 1 - Math.pow(1 - t, 3); setShown(Math.round(from + (to - from) * e)); if (t < 1) requestAnimationFrame(frame); };
			requestAnimationFrame(frame);
			setFill(crossed ? (newRating > from ? 1 : 0) : prog.fill);
		}, 400);
		const t2 = setTimeout(() => { if (crossed) setFill(prog.fill); }, 1300);
		// The fanfare lands on the plate giving way for a reveal, and on the rating settling for a tier change.
		const t3 = setTimeout(() => { if (crossed || revealed) (newRating > (oldRating ?? 0) || revealed ? sound.rankUp : sound.rankDown)(); }, revealed ? PLACEMENT_REVEAL_SOUND_MS : 1700);
		const t4 = setTimeout(() => { if (tierChanged && !revealed) setBadgeSwap(true); }, 1300);
		const t5 = setTimeout(() => setBadgeSwap(false), 1300 + RANK_BADGE_SWAP_MS);
		const t6 = setTimeout(() => setRevealing(false), PLACEMENT_REVEAL_MS);
		return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); clearTimeout(t6); };
	}, []);

	// The panel's frame: green for a win, red only for a finish in the bottom half of the field (a podium
	// place in a six-player free-for-all is not a defeat), neutral in between.
	const kind: "win" | "lose" | "neutral" = won ? "win" : drew || !rank ? "neutral" : isDuo ? "lose" : rank <= Math.ceil(standings.length / 2) ? "neutral" : "lose";
	const opp = isDuo && mine ? standings.find(s => s !== mine) || null : null;
	const heading = drew ? "Draw" : !mine ? "Match complete" : isDuo ? (rank === 1 ? "Victory" : "Defeat") : rank ? ordinal(rank) + " place" : "Match complete";
	const placeCls = rank === 1 ? styles.p1 : rank === 2 ? styles.p2 : rank === 3 ? styles.p3 : "";

	return (
		<ResultPanel slow kind={kind} className={`${styles.ranked} ${won ? styles.rankedWin : styles.rankedLose} ${compact ? styles.compact : ""}`}>
			<div className={styles.hero}>
				<div className={styles.heroBadge}>{placing ? <PlacementBadge size={compact ? 10 : 13} /> : revealing ? <PlacementReveal rating={newRating} size={compact ? 10 : 13} /> : badgeSwap && oldRating != null ? <RankBadgeSwap kind="rank" from={oldRating} to={newRating} size={compact ? 10 : 13} /> : <RankBadge rating={newRating} size={compact ? 10 : 13} />}</div>
				<div className={styles.heroText}>
					<div className={`${styles.heading} ${won ? styles.headingWin : ""} ${placeCls}`}>{heading}</div>
					<div className={styles.sub}>{MODE_LABELS[result.mode || ""] || "Ranked match"}{!isDuo && rank ? " · " + standings.length + " players" : ""}</div>
				</div>
			</div>

			{placing
				? <PlacementCard played={playedAfter} need={need} />
				: (
					<div className={styles.ratingCard}>
						{revealed && <div className={styles.revealLine}>Placement complete · your rank is <b style={{ color: tier.color }}>{tier.name}</b></div>}
						<div className={styles.cols}>
							<div className={styles.col}><div className={styles.colLabel}>Before</div><div className={`${styles.colNum} ${styles.old}`}>{oldRating ?? newRating}</div></div>
							<div className={`${styles.col} ${styles.center}`}>{typeof mine?.ratingDelta === "number" && <div className={`${styles.colNum} ${deltaCls(mine.ratingDelta)}`}>{deltaText(mine.ratingDelta)}</div>}</div>
							<div className={`${styles.col} ${styles.right}`}><div className={styles.colLabel}>After</div><div className={styles.colNum}>{shown}</div></div>
						</div>
						<div className={styles.track}><span className={styles.trackFill} style={{ width: Math.round(fill * 100) + "%" }} /></div>
						<div className={styles.progLabels}><span style={{ color: tier.color }}>{tier.name}</span><span>{prog.atMax ? "Top tier reached" : prog.pointsToNext + " to " + prog.nextName}</span></div>
					</div>
				)}

			{opp && mine ? (
				<div className={styles.context}>
					<div className={styles.duel}>
						<PlayerLine s={mine} me compact={compact} need={need} />
						<PlayerLine s={opp} compact={compact} need={need} />
					</div>
				</div>
			) : (
				<div className={styles.context}>
					<div className={styles.standings}>{standings.map(s => {
						const isMe = !!mine && s === mine;
						return (
							<div key={s.id} className={`${styles.srow} ${isMe ? styles.srowMe : ""}`}>
								<div className={`${styles.srank} ${s.rank === 1 ? styles.p1 : s.rank === 2 ? styles.p2 : s.rank === 3 ? styles.p3 : ""}`}>{s.rank}</div>
								<AvatarChip avatar={s.avatar || "anon"} country={s.country} px={compact ? 20 : 26} className={styles.savatar} />
								<div className={styles.sname}><span className={styles.snameText}>{s.name}</span>{s.country && <FlagChip country={s.country} px={compact ? 11 : 13} />}</div>
								<div className={`${styles.stime} ${s.finished ? "" : styles.dnf}`}>{resultOf(s)}</div>
								<RankCell s={s} size={compact ? 5 : 5.2} need={need} />
							</div>
						);
					})}</div>
				</div>
			)}

			<ResultActions>
				<button className={`btn btn-primary ${styles.again}`} onClick={() => match.playAnother()}>Play another</button>
				<button className="btn" onClick={() => match.leaveRoom()}>Leave</button>
			</ResultActions>
		</ResultPanel>
	);
}

// A placement run, in place of the rating bar: one ring per match, filled for the ones played. The ring
// this match just earned lands with a soft pop and a pulse. No tier bar and no rating total: the number is
// still swinging wildly at this K, and the run's progress is the thing worth reading.
function PlacementCard({ played, need }: { played: number | null; need: number }) {
	const done = played == null ? null : Math.max(0, Math.min(need, played));
	const left = done == null ? null : Math.max(0, need - done);
	return (
		<div className={`${styles.ratingCard} ${styles.placementCard}`}>
			<div className={styles.placeHead}>
				<span className={styles.placeTitle}>Placement</span>
				{done != null && <span className={styles.placeCount}>{done} of {need}</span>}
			</div>
			<div className={styles.rings} role="img" aria-label={done == null ? "Placement match played" : `${done} of ${need} placement matches played`}>
				{Array.from({ length: need }, (_, i) => {
					const filled = done != null && i < done;
					const isNew = done != null && i === done - 1;
					return <span key={i} className={`${styles.ring} ${filled ? styles.ringOn : ""} ${isNew ? styles.ringNew : ""}`} style={{ ["--i" as any]: i }} />;
				})}
			</div>
			<div className={styles.placeFoot}>{left == null ? "Your rank appears once placement is done" : left > 0 ? `${left} more ${left === 1 ? "match" : "matches"} to your rank` : "Your rank is being revealed"}</div>
		</div>
	);
}

// One duellist in the 1v1 context: avatar, name and clear time on the left; the rank badge and rating change on the right.
function PlayerLine({ s, me, compact, need }: { s: Standing; me?: boolean; compact?: boolean; need: number }) {
	const finished = s.finished && typeof s.finishMs === "number";
	return (
		<div className={`${styles.pline} ${me ? styles.plineMe : ""}`}>
			<AvatarChip avatar={s.avatar || "anon"} country={s.country} px={compact ? 28 : 36} className={styles.savatar} />
			<div className={styles.pinfo}>
				<div className={styles.pname}><span className={styles.snameText}>{s.name}</span>{s.country && <FlagChip country={s.country} px={compact ? 11 : 14} />}</div>
				<div className={styles.ptime}><span className={`${styles.ptimeVal} ${finished ? (me ? styles.you : styles.oppc) : styles.dnf}`}>{resultOf(s)}</span> cleared</div>
			</div>
			<RankCell s={s} size={compact ? 5.6 : 6.4} need={need} />
		</div>
	);
}

// The right-hand pair of every row (design T·02): the rank badge and the rating change. A player still in
// placement shows the dashed placement plate and, since their rating stays hidden, their placement dots.
function RankCell({ s, size, need }: { s: Standing; size: number; need: number }) {
	const placing = !!s.provisional;
	return (
		<>
			<div className={styles.sbadge}>{typeof s.rating === "number" ? <RankBadge rating={s.rating} provisional={placing} size={size} /> : <PlacementBadge size={size} />}</div>
			<div className={`${styles.sdelta} ${!placing && typeof s.ratingDelta === "number" ? deltaCls(s.ratingDelta) : styles.flat}`}>
				{placing ? <PlacementDots played={s.played} need={need} /> : typeof s.ratingDelta === "number" ? deltaText(s.ratingDelta) : "—"}
			</div>
		</>
	);
}
// One dot per placement match, filled for the ones played (the same mark as the home page's ranked chip).
function PlacementDots({ played, need }: { played?: number; need: number }) {
	const done = typeof played === "number" ? Math.max(0, Math.min(need, played)) : 0;
	return <span className={styles.pdots} role="img" aria-label={typeof played === "number" ? `${done} of ${need} placement matches played` : "In placement"}>{Array.from({ length: need }, (_, i) => <i key={i} className={i < done ? styles.pdotOn : ""} />)}</span>;
}

function CasualResult({ result, myId }: { result: SeriesResult; myId: string | null }) {
	const won = result.winnerId === myId;
	return (
		<ResultPanel slow kind={won ? "win" : "lose"}>
			<div className={styles.casualHeader}>{!result.winnerId ? "Draw" : won ? "You win!" : (result.winnerName || "Opponent") + " wins"}</div>
			<ResultActions>
				<button className="btn btn-primary" onClick={() => match.dismissSeriesResult()}>Rematch</button>
				<button className="btn" onClick={() => match.leaveRoom()}>Leave</button>
			</ResultActions>
		</ResultPanel>
	);
}
