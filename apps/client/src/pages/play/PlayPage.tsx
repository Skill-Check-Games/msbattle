// The live game view: ranked search and play share this screen. 1v1 gets two equal boards facing
// off across a VS column; 3 to 7 players get a big own board with every opponent tiled on the right;
// custom rooms get the waiting-room lobby while planning and the classic board-plus-scoreboard while
// playing. The match store drives it; this file only lays it out.
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { match, useMatch, MODE_LABELS, STYLE_LABELS, GameFrame, RoomPlayer } from "../../game/match-store";
import GameBoard from "../../game/GameBoard";
import { useCellPx } from "../../game/use-cell-px";
import { DuelIdentity, ProgressBar, PlaceStamp, useRoundTimer } from "./hud";
import OpponentBoard from "./OpponentBoard";
import Scoreboard from "./Scoreboard";
import RoomLobby from "./RoomLobby";
import { SeriesResultModal } from "./ResultModals";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { tierFor } from "../../shared/ranking";
import { useAuth } from "../../shared/auth";
import styles from "./PlayPage.module.scss";

export default function PlayPage() {
	const s = useMatch();
	const navigate = useNavigate();
	const { account } = useAuth();
	const [flagMode, setFlagMode] = useState(false);
	const flagRef = useRef(flagMode); flagRef.current = flagMode;
	const session = match.session;
	const boardHostRef = useRef<HTMLDivElement>(null);
	const timer = useRoundTimer(s.roundDeadline);
	const [, tick] = useState(0);
	useEffect(() => { if (!s.frozenUntil) return; const h = setInterval(() => tick(n => n + 1), 100); return () => clearInterval(h); }, [s.frozenUntil]);

	if (!s.inRoom && !s.search) return <Navigate to="/" replace />;

	const duo = match.isDuo(), multi = match.isMulti(), battle = match.battleActive() && (duo || multi);
	const room = s.room;
	const planningLobby = !!room && room.phase === "planning" && !battle && !room.ranked && (room.gameMode || "race") === "race";
	const rows = session.rows, cols = session.cols;
	// 1v1: the board fits its own arena (padding 2 x 1rem + border); otherwise the board card (1.25rem padding).
	const cellPx = useCellPx(boardHostRef, { rows, cols, maxCell: duo ? 100 : 54, chrome: duo ? 34 : 42 });
	const me = match.me(), opps = match.opponents();
	const frames = s.frames || [];
	const myFrame = frames[0] || null;
	const frameOf = (p: RoomPlayer) => frames.find(f => f && f.id === p.id) || null;
	const modeLine = s.mode ? "RANKED · " + (STYLE_LABELS[s.mode.replace(/_(duo|six)$/, "")] || "").toUpperCase() : "";
	const frozenLeft = s.frozenUntil > Date.now() ? Math.ceil((s.frozenUntil - Date.now()) / 1000) : 0;

	// Finish places from live frames (1v1 and 6-player).
	const placeOf = useMemo(() => {
		const out: Record<string, number> = {};
		if (s.roundResult) s.roundResult.standings.forEach((st, i) => { out[st.id] = i + 1; });
		else frames.filter(f => f && f.finished).sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0)).forEach((f, i) => { out[f.id] = i + 1; });
		return out;
	}, [frames, s.roundResult]);

	const exit = () => {
		if (s.search) { match.cancelSearch(); navigate("/"); return; }
		match.leaveRoom(); navigate("/");
	};

	const boardOverlays = (
		<>
			{frozenLeft > 0 && <div className={`${styles.overlay} ${styles.frozen}`}>💥 {frozenLeft}</div>}
			{s.waitingCleared && !s.roundResultShown && <div className={`${styles.overlay} ${styles.cleared}`}>Cleared, waiting for others</div>}
		</>
	);
	const board = (
		<GameBoard session={session} cellPx={cellPx} flagMode={() => flagRef.current} className={styles.board}>{boardOverlays}</GameBoard>
	);

	return (
		<section className={`${styles.view} ${duo ? styles.duo : multi ? styles.multi : ""} ${s.mode ? styles.ranked : ""}`}>
			<div className={styles.header}>
				<button className="btn btn-ghost" onClick={exit}>← Exit game</button>
				{duo && <div className={styles.timerBadge}><div className={`${styles.duelTimer} ${timer.cls}`}>{timer.text}</div><div className={styles.timerMode}>{modeLine}</div></div>}
				<div className={styles.headerRight}>
					{s.search && <span className={styles.searchStatus}><span className={styles.spinner} />Finding match · {s.search.members.length}/{s.search.size}</span>}
					{!duo && s.mode && !s.search && <span className={styles.rankedTag}>RANKED</span>}
					{!duo && <span className={styles.progressText}>{s.gameProgress}</span>}
					{!duo && timer.text && <span className={`${styles.roundTimer} ${timer.cls}`}>⏱ {timer.text}</span>}
				</div>
			</div>
			{s.message && <p className={styles.message}>{s.message}</p>}

			{planningLobby && room ? <RoomLobby room={room} myId={match.myId} /> : duo ? (
				<div className={styles.duelGrid}>
					<div className={`${styles.arena} ${styles.arenaYou}`} ref={boardHostRef}>
						<DuelIdentity player={me || (account ? { id: "", name: account.name, avatar: account.avatarColor, country: account.country, rating: undefined } as any : null)} side="you" />
						<div className={styles.boardWrap}>{board}<PlaceStamp place={me ? placeOf[me.id] : null} /></div>
						<ProgressBar frame={myFrame} side="you" />
					</div>
					<div className={styles.center}>
						<div className={styles.vs} aria-hidden="true" />
						<DuelMeter myP={(myFrame && myFrame.progress) || 0} opP={(opps[0] && frameOf(opps[0])?.progress) || 0} oppName={opps[0] ? opps[0].name : "Opponent"} />
						<span className={styles.goalPill}>First to 100% wins</span>
					</div>
					<div className={`${styles.arena} ${styles.arenaOpp} ${!opps[0] ? styles.searching : ""}`}>
						<DuelIdentity player={opps[0] || (s.search ? { id: "", name: "Searching…", avatar: "anon", country: null } as any : null)} side="opp" />
						<div className={styles.boardWrap}>
							<OpponentBoard playerId={opps[0] ? opps[0].id : "slot1"} skin={opps[0] ? opps[0].skin || "classic" : "classic"} frame={opps[0] ? frameOf(opps[0]) : null} rows={rows} cols={cols} cellPx={cellPx} className={styles.oppCanvas} covered />
							<PlaceStamp place={opps[0] ? placeOf[opps[0].id] : null} />
						</div>
						<ProgressBar frame={opps[0] ? frameOf(opps[0]) : null} side="opp" />
					</div>
				</div>
			) : (
				<div className={`${styles.grid} ${multi ? styles.gridMulti : ""}`}>
					<div className={styles.left} ref={boardHostRef}>
						{multi && <DuelIdentity player={me} side="you" />}
						<div className={styles.boardCard}>{board}<PlaceStamp place={me ? placeOf[me.id] : null} /></div>
						{multi && <ProgressBar frame={myFrame} side="you" />}
						<div className={styles.tools}>
							<button className={`btn ${flagMode ? styles.toolActive : ""}`} onClick={() => setFlagMode(f => !f)} aria-pressed={flagMode}>🚩 Flag mode</button>
						</div>
					</div>
					<aside className={styles.side}>
						{multi ? (
							<div className={styles.oppGrid}>
								{(s.search ? Array.from({ length: Math.max(0, match.battleSize() - 1) }, (_, i) => opps[i] || null) : opps).map((p, i) => (
									<OpponentCard key={p ? p.id : "slot" + i} player={p} frame={p ? frameOf(p) : null} rows={rows} cols={cols} place={p ? placeOf[p.id] : null} />
								))}
							</div>
						) : (
							<div className={styles.card}><h3 className={styles.sideTitle}>Scoreboard</h3><Scoreboard room={room} search={s.search} frames={s.frames} myId={match.myId} /></div>
						)}
					</aside>
				</div>
			)}
			{s.seriesResult && <SeriesResultModal result={s.seriesResult} myId={match.myId} />}
		</section>
	);
}

function DuelMeter({ myP, opP, oppName }: { myP: number; opP: number; oppName: string }) {
	const total = myP + opP, lean = total > 0 ? myP / total : 0.5, diff = myP - opP;
	const text = Math.abs(diff) < 0.01 ? "Tied up" : diff > 0 ? "You're ahead" : oppName + " is ahead";
	const color = Math.abs(diff) < 0.01 ? undefined : diff > 0 ? "var(--duel-you)" : "var(--duel-opp)";
	return (
		<div className={styles.meter}>
			<div className={styles.meterTrack}><span className={styles.meterMarker} style={{ left: Math.round(lean * 100) + "%" }} /></div>
			<div className={styles.meterCallout} style={{ color }}>{text}</div>
		</div>
	);
}

function OpponentCard({ player, frame, rows, cols, place }: { player: RoomPlayer | null; frame: GameFrame | null; rows: number; cols: number; place: number | null }) {
	const ref = useRef<HTMLDivElement>(null);
	const [cellPx, setCellPx] = useState(13);
	useEffect(() => {
		const compute = () => { const w = ref.current ? ref.current.clientWidth - 24 : 0; setCellPx(Math.max(8, Math.min(26, w > 0 && cols ? Math.floor(w / cols) : 13))); };
		compute(); window.addEventListener("resize", compute); return () => window.removeEventListener("resize", compute);
	}, [cols]);
	const tier = player && typeof player.rating === "number" ? tierFor(player.rating, player.provisional) : null;
	const pct = Math.round(((frame && frame.progress) || 0) * 100);
	return (
		<div ref={ref} className={`${styles.oppCard} ${frame && frame.finished ? styles.oppFinished : ""} ${!player ? styles.searching : ""}`}>
			<div className={styles.oppHead}>
				<AvatarChip avatar={player ? player.avatar : "anon"} country={player ? player.country : null} px={32} />
				<span className={styles.oppName}>{player ? player.name : "Searching…"}{player && <FlagChip country={player.country} px={14} />}</span>
				{tier && <span className={styles.oppTier} style={{ color: tier.color }}>{tier.name}</span>}
				<span className={styles.oppPct}>{player ? pct + "%" : ""}</span>
			</div>
			<div className={styles.oppBoardWrap}>
				<OpponentBoard playerId={player ? player.id : "empty"} skin={player ? player.skin || "classic" : "classic"} frame={frame} rows={rows} cols={cols} cellPx={cellPx} className={styles.oppCanvas} covered />
				<PlaceStamp place={place} />
			</div>
		</div>
	);
}
