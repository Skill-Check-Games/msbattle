// The live game view: ranked search and play share this screen. 1v1 gets two equal boards facing
// off across a VS column; 3 to 7 players get a big own board with every opponent tiled on the right;
// custom rooms get the waiting-room lobby while planning and the classic board-plus-scoreboard while
// playing. The match store drives it; this file only lays it out.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { match, useMatch, MODE_LABELS, STYLE_LABELS, GameFrame, RoomPlayer } from "../../game/match-store";
import GameBoard from "../../game/GameBoard";
import { useCellPx } from "../../game/use-cell-px";
import { animateZoom, measureZoomStart, viewportCenterCell, DoubleTapTracker, attachPanAnywhere, ZOOMED_IN_CELL_PX, ZoomAnchor } from "../../game/duel-zoom";
import type { InputOptions } from "../../game/board-input";
import { DuelIdentity, ProgressBar, LeadBar, ArenaStat, PlaceStamp, useRoundTimer, formatRoundTime, cellsLeftOf } from "./hud";
import { phoneSizedDevice } from "../../game/fullscreen";
import FullscreenButton from "../../shared/FullscreenButton";
import { FindingEnemy, MatchFoundBanner, RoundEndBanner, MATCH_FOUND_MS, FOUND_CARD_MS, CARD_LEAVE_MS, WIN_BANNER_MS, WIN_LEAVE_MS } from "./MatchFound";
import OpponentBoard from "./OpponentBoard";
import Scoreboard from "./Scoreboard";
import RoomLobby from "./RoomLobby";
import { SeriesResultModal } from "./ResultModals";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { tierFor } from "../../shared/ranking";
import { useAuth } from "../../shared/auth";
import { useMediaQuery, useInGameBody, ActionBar, jumpArea, PORTRAIT_MQ, LANDSCAPE_PHONE_MQ } from "./mobile";
import styles from "./PlayPage.module.scss";

const DUEL_GAP_PX = 16;  // .duelGrid's gap between the two cards (PlayPage.module.scss)
const LS_PANEL_W = 158;  // the landscape side panels' width (matches .landscape's grid columns in PlayPage.module.scss)
const PORTRAIT_GUTTER_X = 3;  // the board scroller's side padding in the narrow layout (matches .portrait .board in PlayPage.module.scss)
const FORCE_LANDSCAPE = true;   // phones play battles in landscape; a portrait-held phone gets the layout rotated (body.duel-force-rotate)
const DUEL_STACK_MQ = "(max-width: 1100px)";  // below this the 1v1 cards stack (must match $bp-duel-stack in PlayPage.module.scss)
// Safe cells still to open; with no frame yet (before the round) everyone has the whole board left.
const cellsLeftNum = (f: GameFrame | null) => f ? Math.max(0, (f.totalSafe || 0) - (f.safeCount || 0)) : 1;

export default function PlayPage() {
	const s = useMatch();
	const navigate = useNavigate();
	const { account } = useAuth();
	const [flagMode, setFlagMode] = useState(false);
	const flagRef = useRef(flagMode); flagRef.current = flagMode;
	const session = match.session;
	const boardHostRef = useRef<HTMLDivElement>(null);
	// Phone landscape zoom (duel-zoom.ts): the board starts at the whole-board overview every round; a tap
	// zooms in on that cell, a double tap that changed nothing zooms back out, and the round's end zooms out.
	const [zoomedOut, setZoomedOut] = useState(true);
	const zoomedOutRef = useRef(true); zoomedOutRef.current = zoomedOut;
	const phoneLandscapeRef = useRef(false);
	const pendingZoom = useRef<ZoomAnchor | null>(null);
	const doubleTap = useRef(new DoubleTapTracker());
	const viewRef = useRef<HTMLElement>(null);
	// Match-found moment: when the opponent's seat fills during a ranked 1v1, play the banner once.
	const [searchSince, setSearchSince] = useState<number | null>(null);
	// card: Target acquired on the opponent's board; cardOut: the banner is in and the card slides away; banner: banner alone.
	const [foundPhase, setFoundPhase] = useState<"card" | "cardOut" | "banner" | null>(null);
	const oppId = (match.opponents()[0] || {}).id || null;
	const lastOppRef = useRef<string | null>(null);
	useEffect(() => { if (s.search && searchSince == null) setSearchSince(Date.now()); if (!s.search && !s.inRoom) setSearchSince(null); }, [s.search, s.inRoom]);
	useEffect(() => {
		// Only the seat filling during a search plays it, never a roster refresh mid-round.
		if (oppId && !lastOppRef.current && searchSince != null && match.isDuo() && !s.roundLive) {
			lastOppRef.current = oppId;
			setFoundPhase("card");
			const t1 = setTimeout(() => setFoundPhase("cardOut"), FOUND_CARD_MS), t1b = setTimeout(() => setFoundPhase("banner"), FOUND_CARD_MS + CARD_LEAVE_MS), t2 = setTimeout(() => setFoundPhase(null), FOUND_CARD_MS + MATCH_FOUND_MS);
			// Once the slabs have landed, the board's idle twinkle dissolves and stays off for the countdown.
			const t3 = setTimeout(() => match.session.fadeIdleOut(900), FOUND_CARD_MS + 700);
			return () => { clearTimeout(t1); clearTimeout(t1b); clearTimeout(t2); clearTimeout(t3); };
		}
		if (!oppId && !s.inRoom) lastOppRef.current = null;   // a new search starts fresh; a roster blip inside a room does not
	}, [oppId]);
	// The round's end (1v1): the winner's banner slides in over the cards, holds for WIN_BANNER_MS, then slides
	// back out; the series result modal, when there is one, waits for that moment and arrives as it leaves.
	const [winPhase, setWinPhase] = useState<"in" | "out" | null>(null);
	const roundWinnerId = s.roundResultShown && s.roundResult ? s.roundResult.winnerId : null;
	useEffect(() => {
		if (!roundWinnerId || !match.isDuo()) { setWinPhase(null); return; }
		setWinPhase("in");
		const t = setTimeout(() => setWinPhase(p => (p === "in" ? "out" : p)), WIN_BANNER_MS);
		return () => clearTimeout(t);
	}, [roundWinnerId]);
	useEffect(() => { if (winPhase !== "out") return; const t = setTimeout(() => setWinPhase(null), WIN_LEAVE_MS); return () => clearTimeout(t); }, [winPhase]);
	const timer = useRoundTimer(s.roundDeadline);
	const [, tick] = useState(0);
	const portrait = useMediaQuery(PORTRAIT_MQ), landscape = useMediaQuery(LANDSCAPE_PHONE_MQ);
	const portraitOrientation = useMediaQuery("(orientation: portrait)");
	useInGameBody();
	const oppFrozenUntil = (s.frames || []).slice(1).reduce((m, f) => Math.max(m, (f && f.frozenUntil) || 0), 0);
	useEffect(() => { if (!s.frozenUntil && !oppFrozenUntil) return; const h = setInterval(() => tick(n => n + 1), 100); return () => clearInterval(h); }, [s.frozenUntil, oppFrozenUntil]);

	const duo = match.isDuo(), multi = match.isMulti(), battle = match.battleActive() && (duo || multi);
	const room = s.room;
	const planningLobby = !!room && room.phase === "planning" && !battle && !room.ranked && (room.gameMode || "race") === "race";
	// The search, the moment a room is joined, the countdown and the live rounds all use the same
	// full-width view with the site navbar hidden; only the custom-room lobby is a normal page.
	const live = !!s.search || (s.inRoom && !planningLobby);
	useEffect(() => {
		document.body.classList.toggle("game-live", live);
		// The navbar hiding changes the space above the board: let the cell-size hooks re-measure.
		const raf = requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
		return () => { cancelAnimationFrame(raf); document.body.classList.remove("game-live"); };
	}, [live]);
	// Phones play every battle against other players in landscape: a phone still held in portrait gets
	// the landscape layout rotated 90 degrees by CSS (body.duel-force-rotate; the board's hit-testing
	// undoes the rotation). Puzzles and solo never do this.
	const forceRotate = FORCE_LANDSCAPE && battle && !planningLobby && !landscape && portraitOrientation && phoneSizedDevice();
	const phoneLandscape = landscape || forceRotate;
	useEffect(() => { document.body.classList.toggle("duel-force-rotate", forceRotate); return () => { document.body.classList.remove("duel-force-rotate"); }; }, [forceRotate]);
	const rows = session.rows, cols = session.cols;
	// 1v1: the board fits its own arena (padding + border, the bar row below); otherwise the board card.
	// The duel grid is centred in the viewport, so the 1v1 board's height budget comes from fixed chrome
	// sizes (main padding + header above; bar row, arena and main padding below), not the canvas position.
	// Landscape phones: a 40px floor keeps cells tappable; the board pans inside its own scroller.
	// Desktop 1v1: the two cards shrink-wrap their boards and sit side by side under the lead bar, so
	// the cell size comes from the view's width split in two; the height budget is fixed chrome (header,
	// lead bar, card head, paddings) since the stack is centred in the viewport.
	const desktopDuo = duo && !phoneLandscape && !portrait;
	const duoStacked = useMediaQuery(DUEL_STACK_MQ);   // the two cards one above the other
	const cellPx = useCellPx(desktopDuo ? viewRef : boardHostRef, { rows, cols, maxCell: duo ? 100 : 54, chrome: phoneLandscape ? 0 : duo ? 38 : 42, minCell: phoneLandscape ? (zoomedOut ? 1 : ZOOMED_IN_CELL_PX) : undefined, fitBox: phoneLandscape ? "[data-board-scroll]" : undefined, gutterX: portrait && !phoneLandscape ? PORTRAIT_GUTTER_X : undefined, bottomGap: phoneLandscape ? 64 : duo ? 64 : undefined, desktopFit: phoneLandscape, topOffset: desktopDuo ? 250 : undefined, reserve: desktopDuo && !duoStacked ? DUEL_GAP_PX : undefined, share: desktopDuo && !duoStacked ? 2 : undefined });

	phoneLandscapeRef.current = phoneLandscape;
	// Narrow layout: the scroller is cropped to whole columns (no sliver of a partial column at the edge)
	// and centred in the card, and the board starts scrolled to its middle, where the opening reveal is.
	const portraitBoard = portrait && !phoneLandscape;
	const [viewW, setViewW] = useState<number | null>(null);
	useLayoutEffect(() => {
		const host = boardHostRef.current;
		if (!portraitBoard || !cols || !host) { setViewW(null); return; }
		const cs = getComputedStyle(host);
		const inner = host.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - PORTRAIT_GUTTER_X * 2;
		setViewW(Math.max(1, Math.min(cols, Math.floor(inner / cellPx))) * cellPx + PORTRAIT_GUTTER_X * 2);
	}, [portraitBoard, cols, cellPx]);
	useLayoutEffect(() => {
		const sc = session.canvas && session.canvas.parentElement;
		if (!portraitBoard || !sc) return;
		sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2; sc.scrollTop = (sc.scrollHeight - sc.clientHeight) / 2;
	}, [portraitBoard, viewW, rows, cols, s.roundLive]);
	const zoomTo = (out: boolean, r: number, c: number) => {
		const canvas = session.canvas; if (!canvas || !session.cols || zoomedOutRef.current === out) return;
		pendingZoom.current = measureZoomStart(canvas, session.cols, r, c);
		setZoomedOut(out);
		if (navigator.vibrate) navigator.vibrate(8);
	};
	// Once the canvas has been laid out at the new cell size (GameBoard's own layout effect runs first), play the zoom.
	useLayoutEffect(() => {
		const a = pendingZoom.current, canvas = session.canvas;
		if (!a || !canvas) return;
		if (Math.abs(canvas.clientWidth / session.cols - a.fromCellPx) < 0.5) return;   // the resize has not landed yet
		pendingZoom.current = null;
		return animateZoom(canvas, session.rows, session.cols, a);
	}, [cellPx, zoomedOut]);
	// Every round starts at the overview; the round's end zooms back out so the result is not seen through a close-up.
	useEffect(() => { if (!s.roundLive) { pendingZoom.current = null; setZoomedOut(true); } }, [s.roundLive]);
	useEffect(() => {
		if (!s.roundResultShown || zoomedOutRef.current || !session.canvas) return;
		const mid = viewportCenterCell(session.canvas, session.rows, session.cols); zoomTo(true, mid.r, mid.c);
	}, [s.roundResultShown]);
	// A drag anywhere in the board card pans the board (phone landscape only).
	useEffect(() => {
		const host = boardHostRef.current; if (!host || !phoneLandscape) return;
		return attachPanAnywhere(host, () => host.querySelector<HTMLElement>("[data-board-scroll]"), () => session.isFrozen());
	}, [phoneLandscape]);
	const zoomInput = useMemo<Partial<InputOptions>>(() => ({
		// Zoomed out, cells are too small to tap precisely: any tap means "zoom in here" instead of acting.
		swallowingTaps: () => phoneLandscapeRef.current && zoomedOutRef.current,
		interceptTap: (x, y) => {
			if (!phoneLandscapeRef.current || !zoomedOutRef.current) return false;
			const cell = session.cellFromClient(x, y); if (cell) zoomTo(false, cell.r, cell.c);
			return true;
		},
		onTap: (x, y, changed) => {
			if (!phoneLandscapeRef.current || !doubleTap.current.tap(x, y, changed) || !session.canvas) return;
			const mid = viewportCenterCell(session.canvas, session.rows, session.cols); zoomTo(true, mid.r, mid.c);
		},
	}), [session]);
	const me = match.me(), opps = match.opponents();
	const frames = s.frames || [];
	const myFrame = frames[0] || null;
	const frameOf = (p: RoomPlayer) => frames.find(f => f && f.id === p.id) || null;
	const winner = roundWinnerId ? match.roster().find(p => p.id === roundWinnerId) || null : null;
	const winBanner = (compact?: boolean, stacked?: boolean) => winPhase && roundWinnerId ? <RoundEndBanner winner={winner} side={roundWinnerId === match.myId ? "you" : "opp"} leaving={winPhase === "out"} compact={compact} stacked={stacked} /> : null;
	const modeLine = s.mode ? "RANKED · " + (STYLE_LABELS[s.mode.replace(/_(duo|six)$/, "")] || "").toUpperCase() : "";
	// Before the round is live the clock shows the full round length (it starts counting at GO).
	// The round length comes from the room, or from the search status before the room exists; the last
	// numbers are only a fallback for the instant before the server has said anything.
	const roundSeconds = (room && room.roundSeconds) || (s.search && s.search.roundSeconds) || (s.mode && s.mode.indexOf("standard") === 0 ? 360 : 300);
	// Before the round the clock shows the full length; after it ends it holds where it stopped (0:00 on a timeout).
	const clockText = timer.text || (s.roundResultShown && s.roundEndLeft != null ? formatRoundTime(s.roundEndLeft) : formatRoundTime(roundSeconds));
	// The mine-hit treatment: the whole card takes the hit (red border and edge glow, dimmed board, one big
	// numeral, "Mine hit" in the readout), holds it for the whole penalty, and the instant the timer hits 0
	// everything fades out together in a quick transition (HIT_OUT_MS, matched in PlayPage.module.scss).
	const HIT_OUT_MS = 250;
	const hitState = (until: number): "on" | "out" | null => until > Date.now() ? "on" : until + HIT_OUT_MS > Date.now() ? "out" : null;
	const myHit = hitState(s.frozenUntil), oppHit = hitState(oppFrozenUntil);
	const hitClass = (h: "on" | "out" | null) => (h === "on" ? styles.hit : "");
	const hitCount = (until: number, h: "on" | "out" | null) => h && <div className={`${styles.frozen} ${h === "out" ? styles.frozenOut : ""}`} onContextMenu={e => e.preventDefault()}><span className={styles.frozenCount}>{Math.max(1, Math.ceil((until - Date.now()) / 1000))}</span></div>;

	// Finish places from live frames (1v1 and 6-player).
	const placeOf = useMemo(() => {
		const out: Record<string, number> = {};
		if (s.roundResult) s.roundResult.standings.forEach((st, i) => { out[st.id] = i + 1; });
		else frames.filter(f => f && f.finished).sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0)).forEach((f, i) => { out[f.id] = i + 1; });
		return out;
	}, [frames, s.roundResult]);

	// After every hook: leaving a match unmounts the room state, and the redirect must not change hook order.
	if (!s.inRoom && !s.search) return <Navigate to="/" replace />;

	const exit = () => {
		if (s.search) { match.cancelSearch(); navigate("/"); return; }
		match.leaveRoom(); navigate("/");
	};

	const boardOverlays = (
		<>
			{hitCount(s.frozenUntil, myHit)}
			{s.waitingCleared && !s.roundResultShown && <div className={`${styles.overlay} ${styles.cleared}`}>Cleared, waiting for others</div>}
		</>
	);
	// The overlays (mine-hit freeze tint, "cleared" notice) cover the whole board card, not just the canvas.
	const board = <GameBoard session={session} cellPx={cellPx} flagMode={() => flagRef.current} input={zoomInput} className={styles.board} />;

	const actionBar = <ActionBar flagMode={flagMode} setFlagMode={setFlagMode} session={session} navDisabled={s.frozenUntil > Date.now()} />;

	if (phoneLandscape && battle && !planningLobby) {
		const opp = opps[0] || null;
		// The opponent's mini board fills its panel edge to edge; the bottom block on your side (cells left,
		// the jumps, the mode button) is given the same height, so the two "cells left" lines sit level.
		const miniPx = cols ? (LS_PANEL_W - 4) / cols : 6, miniH = rows ? Math.round(rows * miniPx) : 0;   // panel width minus its border and a 1px margin each side
		return (
			<section className={`${styles.view} ${styles.landscape} ${duo ? styles.duo : styles.multi}`} style={{ "--ls-mini-h": miniH + "px" } as React.CSSProperties}>
				<div className={`${styles.lsPanel} ${styles.lsYou}`}>
					<button className={styles.lsBack} onClick={exit} aria-label="Exit game">‹</button>
					<DuelIdentity player={me || (account ? { id: "", name: account.name, avatar: account.avatarColor, country: account.country, rating: undefined } as any : null)} side="you" vertical ring />
					{s.search && !duo && <span className={styles.searchStatus}><span className={styles.spinner} />{s.search.members.length}/{s.search.size}</span>}
					<span className={styles.lsSpacer} />
					{/* the clock sits down by the cells-left line, above the controls */}
					<div className={`${styles.lsClock} ${!timer.text ? styles.clockIdle : ""}`}><span className={`${styles.duelTimer} ${timer.cls}`}>{clockText}</span></div>
					<span className={styles.lsLeft}>{cellsLeftOf(myFrame) || "\u00a0"}</span>
					<div className={styles.lsBottom}>
						<div className={styles.lsNav}>
							{/* During a mine penalty nothing moves: the jumps are off, only the mode button stays live. */}
							<button type="button" className={styles.navBtn} aria-label="Previous unsolved area" disabled={myHit === "on"} onClick={() => jumpArea(session, -1)}>‹</button>
							<button type="button" className={styles.navBtn} aria-label="Next unsolved area" disabled={myHit === "on"} onClick={() => jumpArea(session, 1)}>›</button>
						</div>
						{/* One button that flips between the two tools: a card with Reveal (a covered cell) on the front and Flag on the red back. */}
						<button type="button" className={`${styles.lsMode} ${flagMode ? styles.lsModeFlag : ""}`} onClick={() => setFlagMode(!flagMode)} aria-pressed={flagMode} aria-label={flagMode ? "Flag mode, tap for reveal" : "Reveal mode, tap for flag"}>
							<span className={styles.flipCard} aria-hidden="true">
								<span className={styles.flipFace}><i className={styles.cellIcon} />Reveal</span>
								<span className={`${styles.flipFace} ${styles.flipBack}`}>🚩 Flag</span>
							</span>
						</button>
					</div>
				</div>
				{/* Two boxes: the outer one (no visible edges) holds the bar and the board card; the board card below the bar
				    carries the border, square at the top where it meets the bar and rounded at the bottom. */}
				<div className={`${styles.lsCenter} ${duo ? styles.lsCenterBar : ""} ${hitClass(myHit)}`} ref={boardHostRef} data-shake-host="">
					{duo && <div className={styles.lsBar}><LeadBar myLeft={cellsLeftNum(myFrame)} opLeft={cellsLeftNum(opp ? frameOf(opp) : null)} flat /></div>}
					<div className={styles.lsBoardCard}>
						<div className={`${styles.boardWrap} ${styles.lsBoardWrap}`}>{board}{!duo && <PlaceStamp place={me ? placeOf[me.id] : null} />}</div>
						{boardOverlays}
					</div>
				</div>
				<div className={`${styles.lsPanel} ${styles.lsOpp}`}>
					{duo ? (
						<>
							{/* The panel is laid out in full from the start (skeleton identity, board slot), so nothing moves when the opponent arrives. */}
							<DuelIdentity player={opp || null} side="opp" vertical ring skeleton={!opp} />
							<span className={styles.lsSpacer} />
							<span className={styles.lsLeft}>{(opp && cellsLeftOf(frameOf(opp))) || "\u00a0"}</span>
							<div className={styles.lsOppBoard}>{opp ? <OpponentBoard playerId={opp.id} skin={opp.skin || "classic"} frame={frameOf(opp)} rows={rows} cols={cols} cellPx={miniPx} className={styles.oppCanvas} covered /> : <span className={`skel-shimmer ${styles.lsOppSkel}`} />}</div>
							{searchSince != null && !s.roundLive && ((!opp && s.search) || foundPhase === "card" || foundPhase === "cardOut") && <FindingEnemy since={searchSince} found={foundPhase === "card" || foundPhase === "cardOut"} leaving={foundPhase === "cardOut"} compact />}
						</>
					) : <Scoreboard room={room} search={s.search} frames={s.frames} myId={match.myId} />}
				</div>
				{(foundPhase === "banner" || foundPhase === "cardOut") && <MatchFoundBanner me={me} opp={opp} compact />}
				{winBanner(true)}
				{s.seriesResult && winPhase !== "in" && <SeriesResultModal result={s.seriesResult} myId={match.myId} />}
			</section>
		);
	}

	return (
		<section ref={viewRef} className={`${styles.view} ${duo ? styles.duo : multi ? styles.multi : ""} ${s.mode ? styles.ranked : ""} ${portrait ? styles.portrait : ""} ${live ? styles.live : ""}`}>
			<div className={styles.header}>
				<button className="btn btn-ghost" onClick={exit}>← Exit game</button>
				<div className={styles.headerRight}>
					{s.search && !duo && <span className={styles.searchStatus}><span className={styles.spinner} />Finding match · {s.search.members.length}/{s.search.size}</span>}
					{!duo && s.mode && !s.search && <span className={styles.rankedTag}>RANKED</span>}
					{!duo && <span className={styles.progressText}>{s.gameProgress}</span>}
					{!duo && timer.text && <span className={`${styles.roundTimer} ${timer.cls}`}>⏱ {timer.text}</span>}
					<FullscreenButton className={styles.fsBtn} />
				</div>
			</div>
			{s.message && <p className={styles.message}>{s.message}</p>}

			{planningLobby && room ? <RoomLobby room={room} myId={match.myId} /> : duo ? (
				<div className={styles.duelStack}>
					{(foundPhase === "banner" || foundPhase === "cardOut") && <MatchFoundBanner me={me} opp={opps[0] || null} stacked={portrait} />}
					{winBanner(false, portrait)}
					<div className={styles.stackTimer}><div className={`${styles.timerBadge} ${!timer.text ? styles.clockIdle : ""}`}><div className={`${styles.duelTimer} ${timer.cls}`}>{clockText}</div></div></div>
					{/* Narrow layout: one row above the bar with the exit cross at the left and the clock centred (the header and head are hidden). */}
					{portrait && <div className={styles.topRow}><button type="button" className={styles.topExit} onClick={exit} aria-label="Exit game">×</button><div className={`${styles.timerBadge} ${styles.topClock} ${!timer.text ? styles.clockIdle : ""}`}><div className={`${styles.duelTimer} ${timer.cls}`}>{clockText}</div></div></div>}
					<LeadBar myLeft={cellsLeftNum(myFrame)} opLeft={cellsLeftNum(opps[0] ? frameOf(opps[0]) : null)} />
					<div className={styles.duelGrid}>
						<div className={`${styles.arena} ${styles.arenaYou} ${hitClass(myHit)}`} style={viewW ? ({ "--board-view-w": viewW + "px" } as React.CSSProperties) : undefined} ref={boardHostRef} data-shake-host="">
							<div className={styles.arenaHead}>
								<DuelIdentity player={me || (account ? { id: "", name: account.name, avatar: account.avatarColor, country: account.country, rating: undefined } as any : null)} side="you" plain />
								<ArenaStat frame={myFrame} side="you" hit={myHit === "on"} />
							</div>
							<div className={styles.boardWrap}>
								{board}
							</div>
							{boardOverlays}
						</div>
						<div className={`${styles.arena} ${styles.arenaOpp} ${!opps[0] ? styles.searching : ""} ${hitClass(oppHit)}`} data-shake-host="">
							<div className={`${styles.arenaHead} ${styles.arenaHeadOpp}`}>
								<DuelIdentity player={opps[0] || null} side="opp" skeleton={!opps[0]} />
								<ArenaStat frame={opps[0] ? frameOf(opps[0]) : null} side="opp" hit={oppHit === "on"} />
							</div>
							<div className={styles.boardWrap}>
								<OpponentBoard playerId={opps[0] ? opps[0].id : "slot1"} skin={opps[0] ? opps[0].skin || "classic" : "classic"} frame={opps[0] ? frameOf(opps[0]) : null} rows={rows} cols={cols} cellPx={cellPx} covered />
								{searchSince != null && !s.roundLive && ((!opps[0] && s.search) || foundPhase === "card" || foundPhase === "cardOut") && <FindingEnemy since={searchSince} found={foundPhase === "card" || foundPhase === "cardOut"} leaving={foundPhase === "cardOut"} />}
							</div>
							{hitCount(oppFrozenUntil, oppHit)}
						</div>
					</div>
					{portrait && !planningLobby && actionBar}
				</div>
			) : (
				<div className={`${styles.grid} ${multi ? styles.gridMulti : ""}`}>
					<div className={styles.left} ref={boardHostRef}>
						{multi && <DuelIdentity player={me} side="you" />}
						<div className={`${styles.boardCard} ${hitClass(myHit)}`} data-shake-host="">{board}<PlaceStamp place={me ? placeOf[me.id] : null} />{boardOverlays}</div>
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
			{s.seriesResult && winPhase !== "in" && <SeriesResultModal result={s.seriesResult} myId={match.myId} />}
		</section>
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
