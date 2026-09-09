// Profile: Overview (identity, lifetime stats, per-mode ranked ladders, Puzzle Ladder), Matches
// (rating history chart + recent games with replay links) and Achievements. With ?id=<userId> it is
// someone else's read-only public profile (Overview only).
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getSocket, onSocket } from "../../online/socket";
import { useAuth } from "../../shared/auth";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { RankBadge, PuzzleRankBadge, PuzzleLockedBadge } from "../../shared/RankBadge";
import { tierFor, SUB_TIER_WIDTH, ordinal } from "../../shared/ranking";
import { puzzleLadder } from "../../shared/puzzle-ladder";
import { computeAll, Computed } from "../../shared/achievements";
import { STYLE_LABELS } from "../../game/match-store";
import type { MatchRow } from "../home/home-data";
import styles from "./ProfilePage.module.scss";

type Tab = "overview" | "matches" | "achievements";
interface RatingPoint { style: string; rating_before: number; rating_after: number; created_at: number; }
interface History { matches: MatchRow[]; ratings: RatingPoint[]; stats: Record<string, any>; }

const formatMemberSince = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "Unknown" : d.toLocaleString(undefined, { month: "short", year: "numeric" }); };
function relTime(ms: number): string {
	const secs = Math.floor((Date.now() - ms) / 1000);
	if (secs < 60) return "just now";
	const m = Math.floor(secs / 60); if (m < 60) return m + "m ago";
	const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
	const d = Math.floor(h / 24); if (d < 30) return d + "d ago";
	return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ProfilePage() {
	const [params] = useSearchParams();
	const id = params.get("id");
	return id ? <PublicProfile userId={id} /> : <OwnProfile />;
}

function OwnProfile() {
	const { account } = useAuth();
	const [tab, setTab] = useState<Tab>("overview");
	const [history, setHistory] = useState<History | null>(null);
	useEffect(() => {
		if (!account) return;
		const off = onSocket("match_history", (d) => setHistory({ matches: (d && d.matches) || [], ratings: (d && d.ratings) || [], stats: (d && d.stats) || {} }));
		getSocket().emit("get_match_history");
		return off;
	}, [account && account.name]);
	if (!account) return <section><h1 className={styles.title}>Profile</h1><div className={styles.card}><p>Sign in to see your rating, win rate, and recent matches.</p></div></section>;
	const dailyBest = Math.max((history && history.stats.dailyStreakBest) || 0, account.dailyStreak || 0);
	return (
		<section>
			<h1 className={styles.title}>Profile</h1>
			<div className={styles.tabs}>{(["overview", "matches", "achievements"] as Tab[]).map(t => <button key={t} type="button" className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`} onClick={() => setTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}</div>
			{tab === "overview" && (
				<div className={styles.card}>
					<Summary name={account.name} avatar={account.avatarColor} country={account.country} createdAt={account.createdAt} />
					<div className={styles.stats}>
						<Stat label="Played" value={String(account.played || 0)} />
						<Stat label="Wins" value={String(account.wins || 0)} />
						<Stat label="Win rate" value={(account.played ? Math.round((account.wins || 0) / account.played * 100) : 0) + "%"} />
						<Stat label="Best daily streak" value={"🔥 " + dailyBest} />
					</div>
					<Ladders ratingStandard={account.ratingStandard || 0} ratingSprint={account.ratingSprint || 0} puzzlePoints={account.puzzlePoints || 0} puzzlesSolved={account.puzzlesSolved || 0} puzzlesAttempted={account.puzzlesAttempted || 0} streakBest={account.streakBest || 0} stormBest={account.stormBest || 0} />
				</div>
			)}
			{tab === "matches" && <Matches history={history} />}
			{tab === "achievements" && <Achievements metrics={{ ...account, ...((history && history.stats) || {}) }} />}
		</section>
	);
}

function PublicProfile({ userId }: { userId: string }) {
	const [profile, setProfile] = useState<any | undefined>(undefined);
	useEffect(() => {
		setProfile(undefined);
		const off = onSocket("public_profile", (d) => { if (d && String(d.userId) === String(userId)) setProfile(d.profile || null); });
		getSocket().emit("get_public_profile", { userId: Number(userId) });
		return off;
	}, [userId]);
	return (
		<section>
			<h1 className={styles.title}>Profile</h1>
			<div className={styles.card}>
				<Link to="/leaderboard" className={`btn btn-ghost ${styles.back}`}>← Back to leaderboard</Link>
				{profile === undefined ? <p>Loading player…</p> : profile === null ? <p>Player not found.</p> : (
					<>
						<Summary name={profile.name || "Player"} avatar={profile.avatarColor} country={profile.country} createdAt={profile.createdAt} />
						<div className={styles.stats}>
							<Stat label="Played" value={String(profile.played || 0)} />
							<Stat label="Wins" value={String(profile.wins || 0)} />
							<Stat label="Win rate" value={(profile.played ? Math.round((profile.wins || 0) / profile.played * 100) : 0) + "%"} />
						</div>
						<Ladders ratingStandard={profile.ratingStandard || 0} ratingSprint={profile.ratingSprint || 0} puzzlePoints={profile.puzzlePoints || 0} puzzlesSolved={profile.puzzlesSolved || 0} puzzlesAttempted={profile.puzzlesAttempted || 0} streakBest={profile.streakBest || 0} stormBest={profile.stormBest || 0} />
					</>
				)}
			</div>
		</section>
	);
}

function Summary({ name, avatar, country, createdAt }: { name: string; avatar: string | null; country: string | null; createdAt?: string }) {
	return (
		<div className={styles.summary}>
			<AvatarChip avatar={avatar} country={country} px={76} className={styles.avatar} />
			<div><div className={styles.name}>{name}<FlagChip country={country} px={20} /></div>{createdAt && <div className={styles.since}>Member since {formatMemberSince(createdAt)}</div>}</div>
		</div>
	);
}
function Stat({ label, value }: { label: string; value: string }) { return <div className={styles.stat}><div className={styles.statLabel}>{label}</div><div className={styles.statValue}>{value}</div></div>; }
function Ladders(p: { ratingStandard: number; ratingSprint: number; puzzlePoints: number; puzzlesSolved: number; puzzlesAttempted: number; streakBest: number; stormBest: number }) {
	const l = p.puzzlePoints > 0 ? puzzleLadder(p.puzzlePoints) : null;
	return (
		<>
			<h3 className={styles.sectionTitle}>Ranked ladders</h3>
			<div className={styles.ladders}><LadderCard label="Standard" rating={p.ratingStandard} /><LadderCard label="Sprint" rating={p.ratingSprint} /></div>
			<h3 className={styles.sectionTitle}>Puzzles</h3>
			<div className={styles.ladders}>
				<div className={styles.ladder}>
					{l ? <PuzzleRankBadge points={p.puzzlePoints} size={11} /> : <PuzzleLockedBadge size={11} />}
					<div className={styles.ladderInfo}><div className={styles.ladderMode}>Puzzle Ladder</div><div className={styles.ladderTier} style={{ color: l ? l.tierColor : undefined }}>{l ? l.tierName : "Unranked"}</div></div>
					<div className={styles.ladderRating}>{l ? (l.atMax ? "Max" : "Lvl " + l.level) : ""}</div>
				</div>
			</div>
			<div className={styles.stats}><Stat label="Solved" value={p.puzzlesSolved + " / " + p.puzzlesAttempted} /><Stat label="Best streak" value={String(p.streakBest)} /><Stat label="Best Time Trial" value={String(p.stormBest)} /></div>
		</>
	);
}
function LadderCard({ label, rating }: { label: string; rating: number }) {
	const t = tierFor(rating);
	return <div className={styles.ladder}><RankBadge rating={rating} size={11} /><div className={styles.ladderInfo}><div className={styles.ladderMode}>{label}</div><div className={styles.ladderTier} style={{ color: t.color }}>{t.name}</div></div><div className={styles.ladderRating}>{rating}</div></div>;
}

// ---- Matches tab ----
function Matches({ history }: { history: History | null }) {
	const [style, setStyle] = useState<string | null>(null);
	const buckets = useMemo(() => { const b: Record<string, RatingPoint[]> = {}; for (const p of (history?.ratings || [])) (b[p.style] = b[p.style] || []).push(p); return b; }, [history]);
	const styleKeys = Object.keys(buckets);
	const active = style && buckets[style] ? style : styleKeys.reduce((best, s) => buckets[s].length > (buckets[best]?.length || 0) ? s : best, styleKeys[0]);
	if (!history) return <div className={styles.card}><p>Loading…</p></div>;
	const hasRatings = styleKeys.length > 0, hasMatches = history.matches.length > 0;
	if (!hasRatings && !hasMatches) return <div className={styles.card}><p>No ranked matches yet. Play a ranked match to start building your history.</p></div>;
	// Chart points: a synthetic "before" seed, then each match's rating_after; timestamps strictly increasing.
	const rows = buckets[active] || [];
	const points: Array<{ t: number; r: number }> = [];
	if (rows.length) { const gap = rows.length > 1 ? rows[1].created_at - rows[0].created_at : 86400000; points.push({ t: rows[0].created_at - Math.max(1, gap * 0.5), r: rows[0].rating_before }); }
	for (const p of rows) points.push({ t: p.created_at, r: p.rating_after });
	for (let i = 1; i < points.length; i++) if (points[i].t <= points[i - 1].t) points[i].t = points[i - 1].t + 1;
	return (
		<>
			{hasRatings && (
				<div className={styles.card}>
					<h2 className={styles.cardTitle}>Rating history</h2>
					{styleKeys.length > 1 && <div className={styles.pills}>{styleKeys.map(s => <button key={s} type="button" className={`${styles.pill} ${s === active ? styles.pillActive : ""}`} onClick={() => setStyle(s)}>{STYLE_LABELS[s] || s}</button>)}</div>}
					<RatingChart points={points} />
				</div>
			)}
			{hasMatches && (
				<div className={styles.card}>
					<h2 className={styles.cardTitle}>Recent games</h2>
					<div className={styles.games}>{history.matches.slice(0, 20).map((m, i) => <GameRow key={i} m={m} />)}</div>
				</div>
			)}
		</>
	);
}
function GameRow({ m }: { m: MatchRow }) {
	const delta = (m.rating_after || 0) - (m.rating_before || 0);
	const inner = (
		<>
			<span className={styles.chip}>{STYLE_LABELS[m.style || ""] || m.style}</span>
			<span className={`${styles.result} ${m.won ? styles.won : styles.lost}`}>{(m.players || 2) <= 2 ? (m.won ? "Won" : "Lost") : ordinal(m.placement || 0) + " of " + m.players}</span>
			<span className={styles.opp}>{m.opponent ? "vs " + m.opponent : (m.players || 0) > 2 ? m.players + " players" : ""}</span>
			<span className={`${styles.delta} ${delta >= 0 ? styles.pos : styles.neg}`}>{(delta >= 0 ? "+" : "") + delta}</span>
			<span className={styles.time}>{relTime(m.created_at)}</span>
			<span className={styles.watch}>{m.replay_id ? "▶ Watch" : ""}</span>
		</>
	);
	return m.replay_id ? <Link to={"/replay?id=" + m.replay_id} className={`${styles.gameRow} ${styles.gameRowReplay}`}>{inner}</Link> : <div className={styles.gameRow}>{inner}</div>;
}
// Responsive SVG line chart with reference lines at tier boundaries.
function RatingChart({ points }: { points: Array<{ t: number; r: number }> }) {
	if (points.length < 2) return <div className={styles.chartEmpty}>Current rating: {points[0] ? points[0].r : "unrated"}. Play more matches to chart your progress.</div>;
	const W = 600, H = 170, L = 64, Rp = 14, Tp = 14, Bp = 22;
	const rs = points.map(p => p.r), ts = points.map(p => p.t);
	let rMin = Math.min(...rs), rMax = Math.max(...rs);
	if (rMax === rMin) { rMin = Math.max(0, rMin - 50); rMax += 50; }
	const span = rMax - rMin;
	rMin = Math.max(0, Math.floor((rMin - span * 0.1) / 10) * 10); rMax = Math.ceil((rMax + span * 0.1) / 10) * 10;
	const tMin = ts[0]; let tMax = ts[ts.length - 1]; if (tMax === tMin) tMax = tMin + 1;
	const X = (t: number) => L + (W - L - Rp) * (t - tMin) / (tMax - tMin), Y = (r: number) => Tp + (H - Tp - Bp) * (1 - (r - rMin) / (rMax - rMin));
	const d = points.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.r).toFixed(1)).join(" ");
	const area = d + " L " + X(tMax).toFixed(1) + " " + (H - Bp) + " L " + X(tMin).toFixed(1) + " " + (H - Bp) + " Z";
	const last = points[points.length - 1];
	let step = SUB_TIER_WIDTH; while ((rMax - rMin) / step > 8) step += SUB_TIER_WIDTH;
	const lines: number[] = []; for (let rv = Math.ceil(rMin / step) * step; rv <= rMax; rv += step) lines.push(rv);
	return (
		<svg viewBox={`0 0 ${W} ${H}`} className={styles.chart}>
			{lines.map(rv => { const y = Y(rv), band = tierFor(rv); return <g key={rv}><line x1={L} y1={y} x2={W - Rp} y2={y} stroke={band.color} strokeOpacity={0.3} /><text x={L - 6} y={y + 3.5} textAnchor="end" fill={band.color} fontSize={11}>{band.name}</text></g>; })}
			<path d={area} fill="rgba(99, 102, 241, 0.15)" />
			<path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
			<circle cx={X(last.t)} cy={Y(last.r)} r={3.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={1.5} />
		</svg>
	);
}

// ---- Achievements tab ----
function Achievements({ metrics }: { metrics: Record<string, any> }) {
	const computed: Computed[] = useMemo(() => computeAll(metrics), [metrics]);
	const reached = computed.reduce((s, c) => s + c.reached, 0), total = computed.reduce((s, c) => s + c.tierCount, 0);
	return (
		<div className={styles.card}>
			<div className={styles.achHead}><h2 className={styles.cardTitle}>Achievements</h2><span className={styles.achCount}>{reached} / {total} unlocked</span></div>
			<div className={styles.achGrid}>
				{computed.map((c, i) => (
					<div key={i} className={`${styles.ach} ${c.complete ? styles.achComplete : c.unlocked ? styles.achPartial : styles.achLocked}`}>
						<span className={styles.achIcon}>{c.icon}</span>
						<div className={styles.achBody}>
							<div className={styles.achName}>{c.name}</div>
							<div className={styles.achDesc}>{c.desc}</div>
							<div className={styles.achProg}><span className={styles.achBar} style={{ width: Math.round(c.frac * 100) + "%" }} /></div>
							<div className={styles.achText}>{c.progText}</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
