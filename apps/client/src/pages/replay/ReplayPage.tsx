// The replay: a broadcast of one round. The standings rail on the left reorders as the race runs, the
// focused board fills the stage, every board plays in the match's own opponent panel on the right, and
// the race timeline at the bottom (each player's progress over time, mine hits, clears) is the scrubber.
// Each player's board is re-simulated once per frame and drawn into every view showing it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getSocket, onSocket } from "../../online/socket";
import { useAuth } from "../../shared/auth";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { ordinal } from "../../shared/ranking";
import { BoardView, BOARD_SKIN_LIST, sizeCellCanvas } from "../../game/board-render";
import type { GameFrame, RoomPlayer, RoomState } from "../../game/match-store";
import Standings from "../play/Standings";
import { SeatCard } from "../play/OpponentCards";
import { decodeReplay, buildRoundModel, stateAt, roundDuration, trackTimeline, pointAt, Replay, TrackTimeline } from "./replay-decode";
import styles from "./ReplayPage.module.scss";

// The final standings as the server stores them with newer replays (results.persistResult): finishing order
// over the series with the rating change applied. Older replays carry none.
interface FinalStanding { name: string; userId: number | null; rank: number | null; progress: number | null; finishMs: number | null; rating: number | null; ratingDelta: number | null; score: number | null; }
interface ReplayData { id: number; createdAt?: number; winnerId?: number | null; standings?: FinalStanding[] | null; error?: string; data?: ArrayBuffer | { buffer: ArrayBuffer }; }

const fmtTime = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); };
const fmtClock = (ms: number) => { const t = Math.max(0, ms) / 1000; const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); };
const styleName = (rep: Replay) => { const m = (rep.style || rep.mode || "").replace(/_/g, " "); return m ? m.charAt(0).toUpperCase() + m.slice(1) : "Match"; };
const skinFor = (skin: string | null) => (skin && BOARD_SKIN_LIST.indexOf(skin) >= 0) ? skin : "classic";
const SPEEDS = [0.5, 1, 2, 4];
const PENALTY_MS = 5000;   // the ranked mine penalty; the replay does not carry a room's own setting
// Each player's line on the timeline (the seat order's colours; you are always blue when you are in the match).
const TRACK_COLORS = ["#60a5fa", "#4ade80", "#c084fc", "#fb923c", "#f472b6", "#facc15"];

// Layout, from the window like the arena's (PlayPage multiLayout): the cards column is two cards wide and
// the stage board takes what is left, both capped by the height between the top bar and the timeline.
const RAIL_W = 300, COL_GAP = 16, MAIN_GUTTER = 56, STACK_BELOW = 1000;
const TOP_H = 64 + 62, BOTTOM_H = 168 + 40;   // nav + topbar; controls + timeline + page padding
const CARD_CHROME_H = 78, CARD_CHROME_W = 18, CARD_GAP = 10, STAGE_CHROME_H = 70, STAGE_CHROME_W = 24;
// The cards column is two cards wide from four players up (the match's panel); a duel or trio stacks them in one.
function layoutFor(vw: number, vh: number, rows: number, cols: number, n: number) {
	const stacked = vw < STACK_BELOW, columns = n <= 3 ? 1 : 2;
	if (stacked) {
		const inner = vw - 32;
		return { stacked, columns: 2, stagePx: Math.max(8, Math.min(40, Math.floor((inner - STAGE_CHROME_W) / cols))), cardPx: Math.max(3, Math.min(14, Math.floor(((inner - CARD_GAP) / 2 - CARD_CHROME_W) / cols))), columnW: inner };
	}
	const h = Math.max(240, vh - TOP_H - BOTTOM_H), cardRows = Math.max(1, Math.ceil(n / columns));
	const cardPx = Math.max(4, Math.min(16, Math.floor(((h - (cardRows - 1) * CARD_GAP) / cardRows - CARD_CHROME_H) / rows)));
	const columnW = columns * (cols * cardPx + CARD_CHROME_W) + (columns - 1) * CARD_GAP;
	const stagePx = Math.max(10, Math.min(40, Math.floor(Math.min((h - STAGE_CHROME_H) / rows, (vw - MAIN_GUTTER - RAIL_W - columnW - 2 * COL_GAP - STAGE_CHROME_W) / cols))));
	return { stacked, columns, stagePx, cardPx, columnW };
}

export default function ReplayPage() {
	const [params] = useSearchParams();
	const id = parseInt(params.get("id") || "", 10);
	const { account } = useAuth();
	const [status, setStatus] = useState("Loading replay…");
	const [rep, setRep] = useState<{ rep: Replay; winnerId: number | null; createdAt?: number; standings: FinalStanding[] | null } | null>(null);
	// The page runs the arena's full width (base.scss), like a live game.
	useLayoutEffect(() => { document.body.classList.add("replay-wide"); return () => document.body.classList.remove("replay-wide"); }, []);

	// Wait for the session to attach: the server resolves the replay against the signed-in user.
	useEffect(() => {
		if (!id) { setStatus("Replay not found."); return; }
		if (!account) return;
		const off = onSocket("replay_data", (d: ReplayData) => {
			if (!d || d.id !== id) return;
			if (d.error) { setStatus(`Replay unavailable (${d.error}).`); return; }
			try {
				const raw = d.data as any; const u8 = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer || raw);
				setRep({ rep: decodeReplay(u8), winnerId: d.winnerId || null, createdAt: d.createdAt, standings: Array.isArray(d.standings) && d.standings.length ? d.standings : null });
			} catch { setStatus("Replay could not be decoded."); }
		});
		getSocket().emit("get_replay", { id });
		return off;
	}, [id, !!account]);

	if (!rep) return <section className={styles.page}><Link to="/profile" className={styles.back}>← Back to profile</Link><div className={styles.status}>{status}</div></section>;
	return <Player rep={rep.rep} winnerId={rep.winnerId} createdAt={rep.createdAt} standings={rep.standings} myUserId={account?.userId ?? null} />;
}

function Player({ rep, winnerId, createdAt, standings, myUserId }: { rep: Replay; winnerId: number | null; createdAt?: number; standings: FinalStanding[] | null; myUserId: number | null }) {
	const [roundIdx, setRoundIdx] = useState(0);
	const meIdx = rep.players.findIndex(p => p.userId && p.userId === myUserId);
	const [focus, setFocus] = useState(meIdx < 0 ? 0 : meIdx);
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeed] = useState(1);
	const [playT, setPlayT] = useState(0);
	const [copied, setCopied] = useState(false);
	const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
	useEffect(() => { const on = () => setViewport({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
	const round = rep.rounds[roundIdx];
	const model = useMemo(() => buildRoundModel(rep, round), [rep, round]);
	const duration = useMemo(() => roundDuration(round), [round]);
	const timelines = useMemo(() => round.tracks.map(t => trackTimeline(model, t)), [model, round]);
	const layout = layoutFor(viewport.w, viewport.h, rep.rows, rep.cols, rep.players.length);
	// Shared mutable state per player; every view of that player draws from the same array.
	const states = useMemo(() => rep.players.map(() => model.freshState()), [model]);
	const lastApplied = useRef<number[]>([]);
	const playTRef = useRef(0); playTRef.current = playT;
	const hostRef = useRef<HTMLElement>(null);
	// The views are found from the DOM at draw time (every board canvas carries its player and cell size as data
	// attributes) and built lazily, one per canvas per round model, so React's ref timing never matters.
	const viewCache = useRef(new WeakMap<HTMLCanvasElement, { model: unknown; view: BoardView }>());
	const viewFor = (canvas: HTMLCanvasElement, p: number, px: number) => {
		const hit = viewCache.current.get(canvas);
		if (hit && hit.model === model) return hit.view;
		sizeCellCanvas(canvas, rep.cols, rep.rows, px);
		const view = new BoardView(canvas, rep.rows, rep.cols, states[p], model.cellAt, { skin: skinFor(rep.players[p].skin) });
		viewCache.current.set(canvas, { model, view });
		view.draw();
		return view;
	};
	// Re-sim + draw. Skips players whose applied-event count is unchanged unless forced.
	const renderFrame = (T: number, force: boolean) => {
		const canvases = hostRef.current ? Array.from(hostRef.current.querySelectorAll<HTMLCanvasElement>("canvas[data-rp]")) : [];
		for (let p = 0; p < states.length; p++) {
			const res = stateAt(model, round.tracks[p], T);
			const changed = res.applied !== lastApplied.current[p];
			if (changed) {
				lastApplied.current[p] = res.applied;
				const st = states[p];
				for (let r = 0; r < model.R; r++) for (let c = 0; c < model.C; c++) st[r][c] = res.state[r][c];
			}
			for (const cv of canvases) {
				if (+cv.dataset.rp! !== p) continue;
				const fresh = !viewCache.current.has(cv);
				const view = viewFor(cv, p, +cv.dataset.px!);
				if ((changed || force) && !fresh) view.draw();
			}
		}
	};
	useEffect(() => { lastApplied.current = []; setPlayT(0); playTRef.current = 0; setPlaying(false); renderFrame(0, true); }, [model]);
	useEffect(() => { renderFrame(playTRef.current, true); }, [focus, layout.stagePx, layout.cardPx]);
	useEffect(() => {
		if (!playing) return;
		let raf = 0, last = 0;
		const tick = (ts: number) => {
			if (!last) last = ts;
			let t = playTRef.current + (ts - last) * speed; last = ts;
			if (t >= duration) { t = duration; setPlaying(false); }
			playTRef.current = t; setPlayT(t); renderFrame(t, false);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing, speed, duration]);

	const seek = (v: number) => { const t = Math.max(0, Math.min(duration, v)); setPlayT(t); playTRef.current = t; renderFrame(t, true); };
	const togglePlay = () => {
		if (!playing && playT >= duration) { lastApplied.current = []; seek(0); }
		setPlaying(p => !p);
	};
	const scrub = (v: number) => { setPlaying(false); seek(v); };
	// Space plays and pauses, the arrows step a second (five with shift), Home and End jump; typing elsewhere is left alone.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
			if (e.key === " ") { e.preventDefault(); togglePlay(); }
			else if (e.key === "ArrowLeft") { e.preventDefault(); scrub(playTRef.current - (e.shiftKey ? 5000 : 1000)); }
			else if (e.key === "ArrowRight") { e.preventDefault(); scrub(playTRef.current + (e.shiftKey ? 5000 : 1000)); }
			else if (e.key === "Home") { e.preventDefault(); scrub(0); }
			else if (e.key === "End") { e.preventDefault(); scrub(duration); }
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	const copyLink = () => {
		const url = location.origin + "/replay?id=" + new URLSearchParams(location.search).get("id");
		if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
	};

	// The match's own views (standings rail, opponent cards) read room and frame shapes: the replay builds
	// them at the playhead. Ids are seats ("p0"…); you are "me" when you were in the match. Seats stay put as
	// in the match (you first, then the others): the bars and percentages tell the race, the rows never move.
	const ids = rep.players.map((_, i) => "p" + i);
	const myId = meIdx < 0 ? null : ids[meIdx];
	const room = useMemo<RoomState>(() => ({
		id: 0, owner: "", ranked: true, rankedMode: rep.mode || null, gameMode: rep.style || "", phase: "playing",
		gameCount: rep.gameCount, gamesPlayed: roundIdx, scoreTarget: null, roundSeconds: 0, deathPenalty: PENALTY_MS / 1000, mineDensity: 0, boardSize: "",
		modifier: null, rows: rep.rows, cols: rep.cols, roundDeadline: null,
		lastGameWinner: null, lastGameWinnerName: null, seriesWinner: null, seriesWinnerName: null,
		players: rep.players.map((p, i): RoomPlayer => ({ id: ids[i], name: p.name, avatar: p.avatar, country: p.country, ready: true, score: 0, isOwner: false, isBot: false, skin: p.skin, isYou: i === meIdx }))
	} as RoomState), [rep, roundIdx]);
	const now = Date.now();
	const frames: GameFrame[] = rep.players.map((p, i) => {
		const tl = timelines[i], pt = pointAt(tl, playT);
		const finished = tl.finishMs != null && playT >= tl.finishMs;
		// A mine hit within the last penalty window freezes the row and card, on the replay's clock: the wall time it lifts is scaled by the speed.
		let frozenUntil = 0;
		for (const h of tl.hitTimes) if (playT >= h && playT < h + PENALTY_MS) frozenUntil = Math.max(frozenUntil, now + (h + PENALTY_MS - playT) / speed);
		return { id: ids[i], playerName: p.name, skin: p.skin, avatar: p.avatar, country: p.country, state: [], finished, finishedAt: tl.finishMs || 0, safeCount: Math.round(pt.progress * tl.totalSafe), totalSafe: tl.totalSafe, progress: pt.progress, frozenUntil, playing: !finished };
	});
	// Places among those who have cleared by now, in clear order.
	const placeOf: Record<string, number> = {};
	frames.filter(f => f.finished).sort((a, b) => a.finishedAt - b.finishedAt).forEach((f, i) => { placeOf[f.id] = i + 1; });
	const nameLink = (p: RoomPlayer) => { const pl = rep.players[ids.indexOf(p.id)]; return pl && pl.userId ? <Link to={"/profile?id=" + pl.userId} className={styles.playerLink} title={"Open " + p.name + "'s profile"} onClick={e => e.stopPropagation()}>{p.name}</Link> : <>{p.name}</>; };

	const fp = rep.players[focus], ff = frames[focus], ftl = timelines[focus], fpt = pointAt(ftl, playT);
	const focusPct = ff.finished ? 100 : Math.round(fpt.progress * 100);
	const focusHit = ff.frozenUntil > now;
	const cellsLeft = Math.max(0, ftl.totalSafe - Math.round(fpt.progress * ftl.totalSafe));
	const finals = standings ? standings.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99)) : null;

	return (
		<section ref={hostRef} className={styles.page}>
			<div className={styles.topbar}>
				<Link to="/profile" className={styles.back}>← Profile</Link>
				<div className={styles.titleBlock}>
					<div className={styles.title}>{styleName(rep)} · {rep.players.length} players</div>
					<div className={styles.sub}>{rep.rows}×{rep.cols} board · {rep.mineCount} mines{createdAt ? " · " + new Date(createdAt).toLocaleString() : ""}</div>
				</div>
				{rep.gameCount > 1 && (
					<div className={styles.rounds}>
						{rep.rounds.map((_, g) => <button key={g} type="button" className={`${styles.roundTab} ${g === roundIdx ? styles.active : ""}`} onClick={() => setRoundIdx(g)}>Round {g + 1}</button>)}
					</div>
				)}
				<div className={styles.spacer} />
				<button type="button" className={styles.copy} onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
			</div>

			<div className={`${styles.body} ${layout.stacked ? styles.bodyStacked : ""}`} style={{ "--rail-w": RAIL_W + "px", "--players-w": layout.columnW + "px" } as React.CSSProperties}>
				<aside className={styles.rail} aria-label="Standings">
					<div className={styles.railHead}><span className={styles.kicker}>Players at {fmtTime(playT)}</span><span className={styles.railHint}>Click a row to watch, a name for the profile</span></div>
					<Standings room={room} frames={frames} myId={myId} placeOf={placeOf} big renderName={nameLink} onRowClick={p => setFocus(ids.indexOf(p.id))} focusId={ids[focus]} />
					{finals && (
						<div className={styles.finals}>
							<div className={styles.kicker}>Final result</div>
							<ol className={styles.finalList}>
								{finals.map((s, i) => (
									<li key={i} className={styles.finalRow}>
										<span className={`${styles.finalRank} ${s.rank === 1 ? styles.gold : ""}`}>{s.rank ? ordinal(s.rank) : "–"}</span>
										<span className={styles.finalName}>{s.userId ? <Link to={"/profile?id=" + s.userId} className={styles.playerLink}>{s.name}</Link> : s.name}</span>
										<span className={styles.finalScore}>{s.score != null ? s.score + " pts" : ""}</span>
										{s.ratingDelta != null && <span className={`${styles.finalDelta} ${s.ratingDelta > 0 ? styles.up : s.ratingDelta < 0 ? styles.down : ""}`}>{s.ratingDelta > 0 ? "+" : ""}{s.ratingDelta}</span>}
									</li>
								))}
							</ol>
						</div>
					)}
					{!finals && winnerId && <div className={styles.finals}><div className={styles.kicker}>Winner</div><div className={styles.winnerName}>{rep.players.find(p => p.userId === winnerId)?.name || "Unknown"}</div></div>}
				</aside>

				<main className={styles.stage}>
					<div className={styles.stageHead} style={{ width: rep.cols * layout.stagePx + STAGE_CHROME_W }}>
						<AvatarChip avatar={fp.avatar} country={fp.country} px={40} />
						<div className={styles.stageWho}>
							<span className={styles.stageName}>{fp.userId ? <Link to={"/profile?id=" + fp.userId} className={styles.playerLink} title={"Open " + fp.name + "'s profile"}>{fp.name}</Link> : fp.name}<FlagChip country={fp.country} px={14} /></span>
							<span className={styles.stageNote}>{ff.finished ? "Cleared at " + fmtClock(ftl.finishMs || 0) + (placeOf[ff.id] ? " · " + ordinal(placeOf[ff.id]) + " to clear" : "") : focusHit ? "Mine penalty" : "Clearing"}</span>
						</div>
						<div className={styles.spacer} />
						<div className={styles.stageStat}>
							<span className={`${styles.stagePct} ${ff.finished ? styles.pctDone : focusHit ? styles.pctHit : ""}`}>{ff.finished && placeOf[ff.id] ? ordinal(placeOf[ff.id]) : focusPct + "%"}</span>
							<span className={styles.stageNote}>{cellsLeft} cells left · {fpt.hits} {fpt.hits === 1 ? "mine" : "mines"} hit</span>
						</div>
					</div>
					<div className={`${styles.stageCard} ${ff.finished ? styles.stageDone : focusHit ? styles.stageHit : ""}`}>
						<canvas key={`stage-${roundIdx}-${focus}-${layout.stagePx}`} data-rp={focus} data-px={layout.stagePx} className={styles.canvas} />
					</div>
				</main>

				<aside className={styles.players} aria-label="Boards">
					<div className={styles.cardGrid} style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, Math.ceil(rep.players.length / layout.columns))}, minmax(0, 1fr))` }}>
						{rep.players.map((p, i) => {
							const f = frames[i];
							return (
								<SeatCard key={i} avatar={p.avatar} country={p.country} name={nameLink(room.players[i])} pct={f.finished ? 100 : Math.round(f.progress * 100)} finished={f.finished} place={placeOf[f.id] || null} me={i === meIdx} hit={f.frozenUntil > now} focused={i === focus} onClick={() => setFocus(i)}>
									<canvas key={`card-${roundIdx}-${i}-${layout.cardPx}`} data-rp={i} data-px={layout.cardPx} className={styles.cardCanvas} />
								</SeatCard>
							);
						})}
					</div>
				</aside>
			</div>

			<div className={styles.dock}>
				<div className={styles.controls}>
					<button type="button" className={styles.play} onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
					<span className={styles.time}>{fmtTime(playT)} / {fmtTime(duration)}</span>
					<div className={styles.speeds}>{SPEEDS.map(m => <button key={m} type="button" className={`${styles.speed} ${m === speed ? styles.active : ""}`} onClick={() => setSpeed(m)}>{m}×</button>)}</div>
					<div className={styles.spacer} />
					<div className={styles.legend}><span><i className={styles.legLine} />progress</span><span><i className={styles.legDot} />mine hit</span><span><i className={styles.legFlag} />cleared</span><span className={styles.keys}>Space plays · arrows step</span></div>
				</div>
				<Timeline timelines={timelines} duration={duration} playT={playT} focus={focus} names={rep.players.map(p => p.name)} onScrub={scrub} onFocus={setFocus} />
			</div>
		</section>
	);
}

// The race timeline: one line per player (progress over the round), a dot where they hit a mine, a flag where
// they cleared, and the playhead. Dragging anywhere scrubs; clicking a line's end label focuses that player.
const TL_H = 96, TL_PAD_TOP = 10, TL_PAD_BOTTOM = 8;
function Timeline({ timelines, duration, playT, focus, names, onScrub, onFocus }: { timelines: TrackTimeline[]; duration: number; playT: number; focus: number; names: string[]; onScrub: (t: number) => void; onFocus: (i: number) => void }) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [w, setW] = useState(800);
	useLayoutEffect(() => {
		const el = hostRef.current; if (!el) return;
		const measure = () => setW(Math.max(200, el.clientWidth));
		measure();
		const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
		if (ro) ro.observe(el); window.addEventListener("resize", measure);
		return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
	}, []);
	const x = (t: number) => duration > 0 ? (t / duration) * w : 0;
	// The y axis runs from the opening (the cells everyone starts with, at 10% mines most of the board) up to a clear.
	const p0 = timelines.length ? Math.min(...timelines.map(tl => tl.points[0].progress)) : 0, span = Math.max(0.001, 1 - p0);
	const y = (progress: number) => TL_H - TL_PAD_BOTTOM - Math.max(0, progress - p0) / span * (TL_H - TL_PAD_TOP - TL_PAD_BOTTOM);
	const tAt = (clientX: number) => { const r = hostRef.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration; };
	const dragging = useRef(false);
	const px = x(playT);
	// The lines' end labels: at each player's final progress, nudged apart so they never overlap.
	const labels = timelines.map((tl, i) => ({ i, y: y(tl.points[tl.points.length - 1].progress) })).sort((a, b) => a.y - b.y);
	for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 12) labels[k].y = labels[k - 1].y + 12;
	for (let k = labels.length - 1; k >= 0; k--) { const cap = TL_H - 8 - (labels.length - 1 - k) * 12; if (labels[k].y > cap) labels[k].y = cap; }
	return (
		<div ref={hostRef} className={styles.timeline}
			onPointerDown={e => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onScrub(tAt(e.clientX)); }}
			onPointerMove={e => { if (dragging.current) onScrub(tAt(e.clientX)); }}
			onPointerUp={e => { dragging.current = false; (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); }}
			onPointerCancel={() => { dragging.current = false; }}>
			{duration > 0 && <svg width={w} height={TL_H} viewBox={`0 0 ${w} ${TL_H}`} className={styles.svg} aria-label="Race timeline: each player's progress over the round">
				<line x1={0} y1={TL_H - TL_PAD_BOTTOM} x2={w} y2={TL_H - TL_PAD_BOTTOM} className={styles.axis} />
				<line x1={0} y1={y(0.5)} x2={w} y2={y(0.5)} className={styles.axisFaint} />
				{timelines.map((tl, i) => i === focus ? null : <Track key={i} tl={tl} color={TRACK_COLORS[i % TRACK_COLORS.length]} x={x} y={y} dim />)}
				{timelines[focus] && <Track tl={timelines[focus]} color={TRACK_COLORS[focus % TRACK_COLORS.length]} x={x} y={y} />}
				<line x1={px} y1={0} x2={px} y2={TL_H} className={styles.playhead} />
				<rect x={px - 7} y={0} width={14} height={9} rx={2} className={styles.playheadCap} />
			</svg>}
			<div className={styles.tlLabels}>
				{labels.map(l => <button key={l.i} type="button" className={`${styles.tlLabel} ${l.i === focus ? styles.tlLabelFocus : ""}`} style={{ top: l.y, color: TRACK_COLORS[l.i % TRACK_COLORS.length] }} onPointerDown={e => e.stopPropagation()} onClick={() => onFocus(l.i)}>{names[l.i]}</button>)}
			</div>
			<span className={styles.tlStart}>0:00</span>
			<span className={styles.tlOpen}>{Math.round(p0 * 100)}% at the start</span>
		</div>
	);
}
function Track({ tl, color, x, y, dim }: { tl: TrackTimeline; color: string; x: (t: number) => number; y: (p: number) => number; dim?: boolean }) {
	const pts = tl.points.map(p => `${x(p.ct).toFixed(1)},${y(p.progress).toFixed(1)}`).join(" ");
	return (
		<g className={dim ? styles.trackDim : styles.track}>
			<polyline points={pts} fill="none" stroke={color} strokeWidth={dim ? 1.5 : 2.5} strokeLinejoin="round" />
			{tl.hitTimes.map((t, k) => <circle key={k} cx={x(t)} cy={y(pointAt(tl, t).progress)} r={dim ? 3 : 4} className={styles.hitDot} />)}
			{tl.finishMs != null && <rect x={x(tl.finishMs) - 4} y={y(1) - 4} width={8} height={8} fill={color} className={styles.flag} />}
		</g>
	);
}
