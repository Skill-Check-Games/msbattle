// Admin "Design" page: a living reference for the visual design system, rendered with the real
// components. The full rank ladder, an admin rank setter, and three candidate labs (rank change
// animation, cascade reveal effect, victory effect) plus the real post-game ranked modal on demand.
// Ported from the legacy admin/DesignView.js.
import { ReactNode, useEffect, useState } from "react";
import BoardLogic from "core/src/common/BoardLogic.js";
import { RankBadge } from "../../shared/RankBadge";
import { rankIconFor, tierFor, overallRating, TIER_BANDS, TIER_BASE_RATING, SUB_TIER_WIDTH, SUB_TIERS_PER_TIER, MASTER_THRESHOLD } from "../../shared/ranking";
import { useAuth } from "../../shared/auth";
import { getSocket } from "../../online/socket";
import { sound } from "../../audio/sound";
import { music } from "../../audio/music";
import { AvatarChip } from "../../shared/Avatar";
import { BOARD_SKINS } from "../../game/board-render";
import { SeriesResultModal } from "../play/ResultModals";
import type { SeriesResult, Standing } from "../../game/match-store";
import { AdminPage, adminStyles } from "./admin-shared";
import { LabSection, LabCard, labStyles } from "./lab-shared";
import styles from "./DesignAdmin.module.scss";

const unlockAudio = () => { sound.unlock(); music.unlock(); };
const rankLabel = (r: number) => { const info = rankIconFor(r); return info.label + (info.subNum ? " " + info.subNum : ""); };

// One rating per sub-tier (Bronze I through Diamond III) plus Master, from the ladder constants.
const LADDER_RATINGS: number[] = [];
for (let i = 0; i < TIER_BANDS.length * SUB_TIERS_PER_TIER; i++) LADDER_RATINGS.push(TIER_BASE_RATING + i * SUB_TIER_WIDTH);
LADDER_RATINGS.push(MASTER_THRESHOLD);

export default function DesignAdmin() {
	return (
		<AdminPage title="Design" sub="A living reference for the visual design system, rendered with the live components." wide>
			<LabSection title="Rank ladder" sub="Every tier is framed in a point-top hexagon with the sub-tier chevrons (a star for Master), filled with the tier's colour.">
				<div className={styles.ranks}>
					{LADDER_RATINGS.map(rating => {
						const tier = tierFor(rating);
						return (
							<div key={rating} className={styles.rank}>
								<RankBadge rating={rating} size={26} />
								<div className={styles.rankName} style={{ color: tier.color }}>{rankLabel(rating)}</div>
								<div className={styles.rankRating}>{rating}{rating >= MASTER_THRESHOLD ? "+" : ""}</div>
							</div>
						);
					})}
				</div>
			</LabSection>
			<RankSetter />
			<RankAnimLab />
			<ResultPreviewLab />
			<CascadeLab />
			<VictoryLab />
		</AdminPage>
	);
}

// ---- Admin: set your own rank (testing) ----
function RankSetter() {
	const { account } = useAuth();
	const current = overallRating(account);
	const highestAtOrBelow = (r: number) => { let best = LADDER_RATINGS[0]; for (const step of LADDER_RATINGS) if (step <= r) best = step; return best; };
	const [rating, setRating] = useState<number>(() => highestAtOrBelow(current));
	const [style, setStyle] = useState("all");
	useEffect(() => { setRating(highestAtOrBelow(current)); }, [current]); // the account arrives after first paint
	return (
		<LabSection title="Set your rank (admin)" sub="Set your own rating to preview ranks and test the ranked UI at any tier. Admins only.">
			<div className={styles.rankset}>
				<div className={styles.ranksetCurrent}>
					{account ? <><RankBadge rating={current} size={22} /><span className={styles.ranksetLabel}>Current: {rankLabel(current)} · {current}</span></> : "Sign in to set your rank."}
				</div>
				<div className={adminStyles.row}>
					<select className={adminStyles.select} value={rating} onChange={e => setRating(parseInt(e.target.value, 10))}>
						{LADDER_RATINGS.map(r => <option key={r} value={r}>{rankLabel(r)} ({r})</option>)}
					</select>
					<select className={adminStyles.select} value={style} onChange={e => setStyle(e.target.value)}>
						<option value="all">All modes</option><option value="sprint">Sprint</option><option value="standard">Standard</option>
					</select>
					<button type="button" className="btn btn-primary" onClick={() => getSocket().emit("admin_set_rating", { rating, style })}>Apply</button>
				</div>
			</div>
		</LabSection>
	);
}

// ---- Rank change animation lab: 5 candidate treatments for crossing a tier boundary ----
// Bronze III -> Silver I (and back): a real tier boundary, so the colour/chevron change reads.
const RANK_ANIM_UP = { from: 590, to: 600 };
const RANK_ANIM_DOWN = { from: 600, to: 590 };
interface Particle { x: number; y: number; rot: number; delay: number; }
interface RankRun { up: boolean; seq: number; shards: Particle[]; particles: Particle[]; }
const pairFor = (up: boolean) => up ? RANK_ANIM_UP : RANK_ANIM_DOWN;
const px = (n: number) => n.toFixed(1) + "px";

function Caption({ rating }: { rating: number }) {
	return <div className={styles.caption} style={{ color: tierFor(rating).color }}>{rankLabel(rating)}</div>;
}
function Badge({ rating, className }: { rating: number; className?: string }) {
	return <div className={`${styles.face} ${className || ""}`}><RankBadge rating={rating} /></div>;
}

const RANK_ANIM_CANDIDATES: { id: string; name: string; desc: string; render: (run: RankRun) => ReactNode }[] = [
	{ id: "crossfade", name: "Crossfade & Glow", desc: "The old badge sinks away, the new one blooms in under its own tier colour. The calmest option, closest to the app's existing rank-icon-in/out CSS.",
		render: run => { const p = pairFor(run.up); return <div className={styles.badgeBox}><Badge rating={p.from} className={styles.crossfadeOld} /><Badge rating={p.to} className={styles.crossfadeNew} /></div>; } },
	{ id: "flip", name: "Flip Reveal", desc: "A real 3D card flip: the badge turns over to reveal the new tier on its back face. Reads as a single deliberate reveal rather than a swap.",
		render: run => { const p = pairFor(run.up); return <div className={`${styles.badgeBox} ${styles.flip}`}><div className={styles.flipInner}><Badge rating={p.from} /><Badge rating={p.to} className={styles.flipBack} /></div></div>; } },
	{ id: "shatter", name: "Shatter & Reform", desc: "The old badge cracks into shards that fly outward while the new one bursts in with an overshoot bounce. The most dramatic option, best for a big multi-tier jump.",
		render: run => {
			const p = pairFor(run.up), shardColor = tierFor(p.from).color;
			return (
				<div className={styles.badgeBox}>
					{run.shards.map((s, i) => <div key={i} className={styles.shard} style={{ "--shard-color": shardColor, "--sx": px(s.x), "--sy": px(s.y), "--srot": s.rot + "deg", animationDelay: s.delay + "s" } as any} />)}
					<Badge rating={p.from} className={styles.shatterOld} /><Badge rating={p.to} className={styles.shatterNew} />
				</div>
			);
		} },
	{ id: "slide", name: "Climb / Drop", desc: "The new badge arrives from the direction of the change (from above on a promotion, from below on a demotion) while the old one travels off the opposite edge, motion-blurred. Literally climbing or falling the ladder.",
		render: run => { const p = pairFor(run.up); return <div className={styles.badgeBox}><Badge rating={p.from} className={run.up ? styles.slideOldUp : styles.slideOldDown} /><Badge rating={p.to} className={run.up ? styles.slideNewUp : styles.slideNewDown} /></div>; } },
	{ id: "burst", name: "Radial Burst", desc: "A plain crossfade swap plus a ring and particles radiating out in the app's win/loss colours: bright and outward on a promotion, falling like ash on a demotion. The most celebratory option.",
		render: run => {
			const p = pairFor(run.up), accent = run.up ? "var(--energy-win)" : "var(--danger)";
			return (
				<div className={`${styles.badgeBox} ${run.up ? styles.burstUp : styles.burstDown}`}>
					<div className={styles.ring} style={{ "--ring-color": accent } as any} />
					<Badge rating={p.from} className={styles.crossfadeOld} /><Badge rating={p.to} className={styles.crossfadeNew} />
					{run.particles.map((s, i) => <div key={i} className={styles.particle} style={{ "--pcolor": accent, "--px": px(s.x), "--py": px(s.y), animationDelay: s.delay + "s" } as any} />)}
				</div>
			);
		} }
];

function scatter(count: number, minDist: number, spread: number, rotSpread: number, maxDelay: number, evenAngles: boolean): Particle[] {
	const out: Particle[] = [];
	for (let i = 0; i < count; i++) {
		const angle = evenAngles ? (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4 : Math.random() * Math.PI * 2;
		const dist = minDist + Math.random() * spread;
		out.push({ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, rot: Math.round((Math.random() - 0.5) * rotSpread), delay: +(Math.random() * maxDelay).toFixed(2) });
	}
	return out;
}

function RankAnimCard({ candidate }: { candidate: typeof RANK_ANIM_CANDIDATES[number] }) {
	const [run, setRun] = useState<RankRun | null>(null);
	const play = (up: boolean) => {
		unlockAudio();
		if (up) sound.rankUp(); else sound.rankDown();
		setRun({ up, seq: (run?.seq || 0) + 1, shards: scatter(9, 46, 30, 420, 0.05, true), particles: scatter(10, 30, 40, 0, 0.15, false) });
	};
	return (
		<LabCard name={candidate.name} desc={candidate.desc}>
			<div key={run?.seq || 0} className={styles.stage}>{run && <>{candidate.render(run)}<Caption rating={pairFor(run.up).to} /></>}</div>
			<div className={labStyles.actions}>
				<button type="button" className="btn" onClick={() => play(true)}>▲ Rank up</button>
				<button type="button" className="btn" onClick={() => play(false)}>▼ Rank down</button>
			</div>
		</LabCard>
	);
}

function RankAnimLab() {
	return (
		<LabSection title="Rank change animation (candidates)" sub="Crossing a tier boundary today only plays a sound (sound.rankUp/rankDown), there is no animation on the badge itself. Five candidates below, each built on the real rank badge so whichever is picked ships as-is; every preview also plays the real fanfare, so you're judging the whole moment, not just the visual. Bronze III to Silver I (and back), a real tier boundary so the colour/chevron change actually reads.">
			<div className={labStyles.gridWide}>{RANK_ANIM_CANDIDATES.map(c => <RankAnimCard key={c.id} candidate={c} />)}</div>
		</LabSection>
	);
}

// ---- Post-game rank-up/down modal, in context ----
// Opens the real SeriesResultModal with a synthetic tier-crossing standings payload. The modal applies
// the new rating to the account for real (that is what makes it genuine), so the account is put at
// the "before" rating first and restored when the preview closes. Its own Play another / Leave
// buttons would act on a match that does not exist, so they are hidden behind a single Close preview.
const RESULT_PREVIEW_NAMES = ["Foxglove", "Ironclad99", "Nimbus", "Quartzite", "Redwood", "Silversmith"];
function buildPreviewStandings(totalPlayers: number, myRank: number, myRating: number, myDelta: number, myName: string): Standing[] {
	const entries: Standing[] = [];
	let nameIdx = 0;
	for (let rank = 1; rank <= totalPlayers; rank++) {
		if (rank === myRank) entries.push({ id: "me", name: myName, rank, rating: myRating, ratingDelta: myDelta, provisional: false, finished: true, finishMs: 42000, progress: 1 });
		else {
			const finished = rank <= Math.max(2, totalPlayers - 2); // a couple of trailing ranks still racing
			entries.push({ id: "preview-p" + rank, name: RESULT_PREVIEW_NAMES[nameIdx++ % RESULT_PREVIEW_NAMES.length], rank, rating: 500 + (totalPlayers - rank) * 15, ratingDelta: rank <= 2 ? 8 : -6, provisional: false, finished, finishMs: finished ? 18000 + rank * 6000 : undefined, progress: finished ? 1 : 0.4 + rank * 0.05 });
		}
	}
	return entries;
}

function ResultPreviewLab() {
	const { account, update } = useAuth();
	const [preview, setPreview] = useState<{ result: SeriesResult; from: number; saved: { ratingSprint: number; provisional: boolean } } | null>(null);
	const [armed, setArmed] = useState(false); // the modal mounts once the account shows the "before" rating
	useEffect(() => { if (preview && !armed && account && account.ratingSprint === preview.from) setArmed(true); }, [preview, armed, account]);

	const open = (up: boolean, totalPlayers: number) => {
		if (!account) return;
		unlockAudio();
		const pair = pairFor(up), isDuo = totalPlayers === 2, myRank = up ? 1 : (isDuo ? 2 : 5);
		const standings = buildPreviewStandings(totalPlayers, myRank, pair.to, pair.to - pair.from, account.name || "You");
		const winner = standings.find(s => s.rank === 1)!;
		setPreview({ result: { ranked: true, mode: isDuo ? "sprint_duo" : "sprint_six", winnerId: winner.id, winnerName: winner.name, standings, scores: [] }, from: pair.from, saved: { ratingSprint: account.ratingSprint, provisional: account.provisional } });
		update({ ratingSprint: pair.from });
	};
	const close = () => { const saved = preview?.saved; setArmed(false); setPreview(null); if (saved) update(saved); };

	return (
		<LabSection title="Post-game rank-up/down modal (in context)" sub={<>Opens the real post-game result modal with a fake tier-crossing match, instead of having to actually climb or drop a tier in a real ranked match to see it. This is the exact production modal (SeriesResultModal), not a mockup. "Close preview" stands in for Play another / Leave, which would otherwise try to act on a real match that doesn't exist here.</>}>
			<div className={labStyles.card}>
				{[{ label: "1v1 result", players: 2 }, { label: "7-player result", players: 7 }].map(g => (
					<div key={g.players} className={styles.previewRow}>
						<span className={styles.previewRowLabel}>{g.label}</span>
						<div className={labStyles.actions}>
							<button type="button" className="btn" disabled={!account} onClick={() => open(true, g.players)}>▲ Rank up</button>
							<button type="button" className="btn" disabled={!account} onClick={() => open(false, g.players)}>▼ Rank down</button>
						</div>
					</div>
				))}
			</div>
			{preview && armed && (
				<>
					<div className={styles.previewLayer}><SeriesResultModal result={preview.result} myId="me" /></div>
					<div className={styles.previewClose}><button type="button" className="btn btn-primary" autoFocus onClick={close}>Close preview</button></div>
				</>
			)}
		</LabSection>
	);
}

// ---- Cascade reveal effect lab: how a cell's lid comes off as a cascade uncovers it ----
// All five share one outward-wave stagger (Chebyshev distance from the click origin), so they are
// compared on the same reveal order; only the per-cell visual differs.
const CASCADE_ROWS = 5, CASCADE_COLS = 7;
const CASCADE_MINES = [[0, 0], [0, 6], [4, 0], [4, 6]]; // corners, well clear of the origin: just enough for real clue numbers
const CASCADE_ORIGIN = { r: 2, c: 3 };
const CASCADE_STEP_MS = 55;
const cascadeIsMine = (r: number, c: number) => CASCADE_MINES.some(m => m[0] === r && m[1] === c);
const CASCADE_CELLS = (() => {
	const cells: { r: number; c: number; clue: number; dist: number }[] = [];
	for (let r = 0; r < CASCADE_ROWS; r++) for (let c = 0; c < CASCADE_COLS; c++) {
		let clue = 0;
		BoardLogic.forEachNeighbour(r, c, CASCADE_ROWS, CASCADE_COLS, (nr: number, nc: number) => { if (cascadeIsMine(nr, nc)) clue++; });
		cells.push({ r, c, clue, dist: Math.max(Math.abs(r - CASCADE_ORIGIN.r), Math.abs(c - CASCADE_ORIGIN.c)) });
	}
	return cells;
})();
const CASCADE_CANDIDATES: { id: string; name: string; desc: string; fx: string }[] = [
	{ id: "ripple", name: "Ripple", desc: "The lid scales up and fades as it lifts, brightening for an instant right as it goes. Reads as a wave passing outward through the cascade, like a stone dropped in water.", fx: "fxRipple" },
	{ id: "spark", name: "Spark Trail", desc: "A quick bright spark flashes at the leading edge of each cell as it opens, on top of the same outward wave: a lit fuse racing along the flood-fill path.", fx: "fxSpark" },
	{ id: "shatter", name: "Shatter Reveal", desc: "The covered tile cracks into shards that fly outward and fade instead of just lifting off. Echoes the rank-up Shatter & Reform animation above, same visual language.", fx: "fxShatter" },
	{ id: "crt", name: "CRT Flicker", desc: "A brief brightness flicker plus a scanline sweep, like an old display waking up. Obvious pairing for the Tactical/Neon skins, could ship as a bundle.", fx: "fxCrt" },
	{ id: "dust", name: "Dust Puff", desc: "A soft puff blooms and fades as the lid lifts, like brushing away sand. Cheapest, most subtle option, fits any skin without competing with it.", fx: "fxDust" }
];

function CascadeCard({ candidate }: { candidate: typeof CASCADE_CANDIDATES[number] }) {
	const [run, setRun] = useState<{ seq: number; delays: number[]; shards: Particle[][] } | null>(null);
	const play = () => setRun({
		seq: (run?.seq || 0) + 1,
		delays: CASCADE_CELLS.map(cell => cell.dist * CASCADE_STEP_MS + Math.random() * 25),
		shards: CASCADE_CELLS.map(() => scatter(4, 14, 8, 300, 0, true))
	});
	const numbers = BOARD_SKINS.classic.numbers;
	return (
		<LabCard name={candidate.name} desc={candidate.desc}>
			<div key={run?.seq || 0} className={styles.cascadeStage}>
				{CASCADE_CELLS.map((cell, i) => {
					const delay = run ? { animationDelay: Math.round(run.delays[i]) + "ms" } : undefined;
					return (
						<div key={i} className={`${styles.cell} ${run ? styles.revealed + " " + styles[candidate.fx] : ""}`}>
							{cell.clue > 0 && <span className={styles.num} style={{ color: numbers[cell.clue] || "#e2e8f0" }}>{cell.clue}</span>}
							<div className={styles.fx}>
								{run && candidate.fx === "fxShatter" && run.shards[i].map((s, k) => <div key={k} className={styles.cellShard} style={{ ...delay, "--shard-color": "#2563eb", "--sx": px(s.x), "--sy": px(s.y), "--srot": s.rot + "deg" } as any} />)}
								{run && candidate.fx === "fxSpark" && <div className={styles.spark} style={delay} />}
								{run && candidate.fx === "fxDust" && <div className={styles.puff} style={delay} />}
								{run && candidate.fx === "fxCrt" && <div className={styles.scan} style={delay} />}
							</div>
							<div className={styles.lid} style={delay} />
						</div>
					);
				})}
			</div>
			<div className={labStyles.actions}><button type="button" className="btn" onClick={play}>▶ Preview</button></div>
		</LabCard>
	);
}

function CascadeLab() {
	return (
		<LabSection title="Cascade reveal effect (candidates)" sub="How your own board's cells look as a cascade opens them. Five candidates below, sharing the same outward-wave timing (by distance from the click point) so the reveal order is identical across all of them; only what happens to each tile's lid differs. These are the DOM mockups the canvas reveal effects (board-render.ts) were built from.">
			<div className={labStyles.gridWide}>{CASCADE_CANDIDATES.map(c => <CascadeCard key={c.id} candidate={c} />)}</div>
		</LabSection>
	);
}

// ---- Victory effect lab: a purchasable "finisher" around the result modal on a win ----
const VICTORY_CONFETTI_COLORS = ["#60a5fa", "#4ade80", "#f87171", "#c084fc", "#fbbf24", "#22d3ee"];
interface Fall { x: number; rot: number; delay: number; dur: number; }
const fallers = (count: number, rotMax: number, rotOffset: number, durBase: number, durSpread: number): Fall[] => {
	const out: Fall[] = [];
	for (let i = 0; i < count; i++) out.push({ x: Math.round(Math.random() * 100), rot: Math.round(Math.random() * rotMax - rotOffset), delay: +(Math.random() * 0.5).toFixed(2), dur: +(durBase + Math.random() * durSpread).toFixed(2) });
	return out;
};
const fallStyle = (f: Fall, extra?: Record<string, string>) => ({ "--fall-x": f.x + "%", "--fall-rot": f.rot + "deg", "--fall-delay": f.delay + "s", "--fall-dur": f.dur + "s", ...extra } as any);

function VictoryBanner() {
	return <div className={styles.banner}><div className={styles.bannerHeading}>Victory</div><div className={styles.bannerSub}>1v1 Sprint</div></div>;
}

const VICTORY_CANDIDATES: { id: string; name: string; desc: string; render: (seed: number) => ReactNode }[] = [
	{ id: "confetti", name: "Board Confetti", desc: "Confetti made of tiles in the real number-clue colours, raining over the modal. Literal, on-theme, and immediately reads as \"yours\" rather than a generic firework.",
		render: () => <div className={styles.victoryFx}>{fallers(26, 720, 360, 1.1, 0.7).map((f, i) => <div key={i} className={styles.confetti} style={fallStyle(f, { "--fall-color": VICTORY_CONFETTI_COLORS[i % VICTORY_CONFETTI_COLORS.length] })} />)}</div> },
	{ id: "mine", name: "Mine Defused", desc: "The mine icon spins down and sparks out. A twist, since the whole game is about not hitting mines: this makes the danger you avoided the star of the win, not a generic celebration.",
		render: () => (
			<div className={styles.mineWrap}>
				<AvatarChip avatar="mine" px={56} className={styles.mine} />
				{[0, 1, 2, 3, 4, 5].map(i => { const a = (i / 6) * Math.PI * 2; return <div key={i} className={styles.mineSpark} style={{ "--sx": Math.round(Math.cos(a) * 34) + "px", "--sy": Math.round(Math.sin(a) * 34) + "px", animationDelay: (0.25 + Math.random() * 0.1).toFixed(2) + "s" } as any} />; })}
			</div>
		) },
	{ id: "flags", name: "Flag Salute", desc: "A row of flags unfurl left to right in sequence, like a little victory parade. Reuses the game's own flag shape rather than a generic banner.",
		render: () => <div className={styles.flags}>{[0, 1, 2, 3, 4].map(i => <div key={i} className={styles.flag}><span className={styles.flagPole} /><span className={styles.flagCloth} style={{ animationDelay: (i * 0.09).toFixed(2) + "s" }} /></div>)}</div> },
	{ id: "gold", name: "Gold Rush", desc: "Gold shard/coin rain in the Gold skin's exact palette. A natural bundle: buy Gold, get this as its matching win effect.",
		render: () => <div className={styles.victoryFx}>{fallers(22, 500, 0, 1.2, 0.8).map((f, i) => <div key={i} className={`${styles.gold} ${i % 2 ? styles.goldDiamond : styles.goldCircle}`} style={fallStyle(f)} />)}</div> },
	{ id: "perfect", name: "Perfect Clear Shimmer", desc: "A light sweep ripples across a row of revealed tiles. Could be reserved for a genuinely flawless win (no wasted flags) rather than sold outright: a skill flex, not just inventory.",
		render: () => <div className={styles.strip}>{Array.from({ length: 9 }, (_, i) => <div key={i} className={styles.stripTile} style={{ animationDelay: (i * 0.05).toFixed(2) + "s" }} />)}</div> }
];

function VictoryCard({ candidate }: { candidate: typeof VICTORY_CANDIDATES[number] }) {
	const [seq, setSeq] = useState(0);
	return (
		<LabCard name={candidate.name} desc={candidate.desc}>
			<div key={seq} className={styles.stage}>{seq > 0 && <>{candidate.render(seq)}<VictoryBanner /></>}</div>
			<div className={labStyles.actions}><button type="button" className="btn" onClick={() => setSeq(seq + 1)}>▶ Preview</button></div>
		</LabCard>
	);
}

function VictoryLab() {
	return (
		<LabSection title="Victory effect (candidates)" sub={'A purchasable "finisher" that plays around the post-game result modal on a win; today that moment is sound-only. Five candidates below, each sharing the same banner so only the effect layer is being compared.'}>
			<div className={labStyles.gridWide}>{VICTORY_CANDIDATES.map(c => <VictoryCard key={c.id} candidate={c} />)}</div>
		</LabSection>
	);
}
