// The live game view: ranked search and play share this screen. 1v1 gets two equal boards facing
// off across a VS column; 3 to 6 players get a big own board with every opponent tiled on the right;
// custom rooms get the waiting-room lobby while planning and the classic board-plus-scoreboard while
// playing. The match store drives it; this file only lays it out.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { getSocket } from "../../online/socket";
import { sound } from "../../audio/sound";
import { music } from "../../audio/music";
import { match, useMatch, MODE_LABELS, STYLE_LABELS, GameFrame, RoomPlayer } from "../../game/match-store";
import GameBoard, { SHAKE_PAD_X, SHAKE_PAD_Y } from "../../game/GameBoard";
import { useCellPx, fitCellPx, CellPxOptions, DESKTOP_CELL_MIN } from "../../game/use-cell-px";
import { animateZoom, measureZoomStart, attachPanAnywhere, attachPinchZoom, clearZoomTransform, ZOOMED_IN_CELL_PX, ZoomAnchor, PinchCommit } from "../../game/duel-zoom";
import type { InputOptions } from "../../game/board-input";
import { DuelIdentity, LeadBar, ArenaStat, PlaceStamp, ClearedDial, useRoundTimer, formatRoundTime, cellsLeftOf } from "./hud";
import { phoneSizedDevice } from "../../game/fullscreen";
import FullscreenButton from "../../shared/FullscreenButton";
import { FindingEnemy, MatchFoundBanner, MatchFoundSix, RoundEndBanner, MATCH_FOUND_MS, MATCH_FOUND_SIX_MS, FOUND_CARD_MS, CARD_LEAVE_MS, WIN_BANNER_MS, WIN_LEAVE_MS } from "./MatchFound";
import OpponentBoard from "./OpponentBoard";
import Scoreboard from "./Scoreboard";
import Standings from "./Standings";
import OpponentCards from "./OpponentCards";
import RoomLobby from "./RoomLobby";
import { SeriesResultModal } from "./ResultModals";
import { AvatarChip, FlagChip } from "../../shared/Avatar";
import { tierFor } from "../../shared/ranking";
import { useAuth } from "../../shared/auth";
import { useMediaQuery, useInGameBody, PORTRAIT_MQ, LANDSCAPE_PHONE_MQ } from "./mobile";
import { FlagToggle } from "../../game/FlagToggle";
import styles from "./PlayPage.module.scss";
import { useAdminClearBoard } from "../../game/admin-clear";
import Modal from "../../app/Modal";

const DUEL_GAP_PX = 16;  // .duelGrid's gap between the two cards (PlayPage.module.scss)
const LS_PANEL_W = 158;  // the landscape side panels' width (matches .landscape's grid columns in PlayPage.module.scss)
const BATTLE_BACKDROP = "/backdrops/ice.webp";   // the scene behind online battles (trial: the ice concept)
const FOUND_GAP_MS = 300;        // the match-found banner is gone at least this long before the 3-2-1 begins
const FOUND_FIELD_BREATH_MS = 1100;  // 6 players: the pause between the last seat filling and the field's presentation (a breath, so it does not feel rushed)
const FOUND_WAIT_MAX_MS = 4000;  // how long the found card waits for start_game beyond its natural length before giving up
const LS_SHORT_MAX_H = 370;   // landscape layouts this short (small phones) use the compact side panels (.lsShort)
// Everything on your side panel other than the mode box, top to bottom, in px (page padding, panel padding, the
// identity block, the gaps, the arrows, the clock, the cells-left line), for the normal and the short (lsShort)
// panels. Must follow the sizes in .landscape / .lsShort in PlayPage.module.scss; a few px of slack included.
const LS_FIXED_H = 262, LS_FIXED_H_SHORT = 224;
// 6 players: the standings column has no panel around it, so the only thing above and below the list is the
// page's own padding. What is left is the list's, and the rows share it: a 30px row (the compact floor) up to
// LS_ROW_MAX, the desktop row's height. Follows .landscape in PlayPage.module.scss.
const LS_LIST_CHROME = 16, LS_ROW_GAP = 6, LS_ROW_MIN = 30, LS_ROW_MAX = 56;
// 6 players: the standings panel also takes whatever width the board does not want. The landscape board is
// normally limited by its height (16 rows in a phone's short side), so the centre column has width to spare;
// the panel grows into it up to LS_OPP_W_MAX and never past what the board needs, so a narrow phone or a wide
// board (16x30) keeps the panel at LS_PANEL_W. The 1v1 panel is always LS_PANEL_W (its mini board follows it).
const LS_OPP_W_MAX = 196;
const LS_BOARD_CHROME_W = 2 + 2 * 9.6 + 2 * 6;    // the board card's border, its side padding (0.6rem) and the board's shake gutter
const LS_BOARD_CHROME_H = 16 + 2 + 2 * 9.6 + 2 * 3;   // the page's padding, the card's border and padding, and the shake gutter (no bar above the board in a 6-player battle)
const LS_GRID_CHROME_W = 16 + 2 * 9.6;   // the page's side padding and the two column gaps (0.5rem / 0.6rem)
const PORTRAIT_GUTTER_X = 3;  // the board scroller's side padding in the narrow layout (matches .portrait .board in PlayPage.module.scss)
const FORCE_LANDSCAPE = true;   // phones play battles in landscape; a portrait-held phone gets the layout rotated (body.duel-force-rotate)
// Desktop 1v1 (DESKTOP_CELL_MIN cells): the cards sit side by side when the window is wide enough for two
// boards at that size; when it is not, they stack one above the other if the height holds that; and when
// neither fits (a short, narrow window) they stay side by side with cells down to DESKTOP_FIT_MIN_CELL. A live
// desktop page never scrolls (base.scss clips it), so the layout has to fit rather than overflow.
const DUO_CARD_CHROME_W = 50;   // an arena's padding + border + the shake gutter, either side of its board
const DUO_CARD_CHROME_H = 120;  // an arena's padding, head row, gap and border above and below its board
const DUO_STACK_CHROME_H = 330; // header, clock, lead bar, gaps and page padding around the stacked cards
const MAIN_GUTTER_PX = 56;      // main's side padding while live (1.75rem each side, base.scss)
const DESKTOP_FIT_MIN_CELL = 14;   // a desktop board may shrink to this to fit the window (1v1 side by side, 6-player)
const MULTI_BOTTOM_GAP = 72;    // desktop 6-player: below your board sit the arena's padding and the page padding (as in the 1v1)
const MULTI_STACK_MAX_W = 960;  // desktop 6-player windows narrower than this stack (your arena over the compact list)
const MULTI_STACK_LIST_H = 6 * 30 + 5 * 5 + 16;   // the compact list under your arena when stacked (.compact rows in Standings.module.scss) plus the gap
// Desktop 6-player, the players' column: six cards two by three that together are exactly as tall as your arena.
// The card size follows from the height your arena will have (your board at its cap or the window's height
// budget), and the column's width follows from the card size; your board then takes the width that is left.
// Two passes: a narrow window may shrink your board by width, which lowers the arena and so the cards.
const MULTI_ARENA_CHROME_H = 110;   // your arena's head row, paddings, gap and border above and below the board
const MULTI_CARD_CHROME_H = 78, MULTI_CARD_CHROME_W = 18, MULTI_CARD_GAP = 10;   // a card's head, bar, paddings, border (OpponentCards.module.scss)
function multiLayout(vw: number, vh: number, rows: number, cols: number): { cardPx: number; columnW: number } {
	if (!rows || !cols) return { cardPx: 6, columnW: 300 };
	let myPx = Math.min(54, Math.floor((vh - 250 - MULTI_BOTTOM_GAP) / rows)), cardPx = 4, columnW = 300;
	for (let pass = 0; pass < 2; pass++) {
		const arenaH = myPx * rows + MULTI_ARENA_CHROME_H;
		cardPx = Math.max(4, Math.floor(((arenaH - 2 * MULTI_CARD_GAP) / 3 - MULTI_CARD_CHROME_H) / rows));
		columnW = 2 * (cols * cardPx + MULTI_CARD_CHROME_W) + MULTI_CARD_GAP;
		myPx = Math.max(DESKTOP_FIT_MIN_CELL, Math.min(myPx, Math.floor((vw - MAIN_GUTTER_PX - columnW - DUEL_GAP_PX - DUO_CARD_CHROME_W) / cols)));
	}
	return { cardPx, columnW };
}
// Safe cells still to open; with no frame yet (before the round) everyone has the whole board left.
const cellsLeftNum = (f: GameFrame | null) => f ? Math.max(0, (f.totalSafe || 0) - (f.safeCount || 0)) : 1;

export default function PlayPage() {
	const s = useMatch();
	const navigate = useNavigate();
	const { account, update } = useAuth();
	const [flagMode, setFlagMode] = useState(false);
	const flagRef = useRef(flagMode); flagRef.current = flagMode;
	const session = match.session;
	useAdminClearBoard(session, account?.isAdmin);
	const boardHostRef = useRef<HTMLDivElement>(null);
	// Phone landscape zoom (duel-zoom.ts): the board starts at the whole-board overview every round (zoomCellPx
	// null: the fit, centred); the round's first tap zooms in on that cell, then taps play at any zoom and two
	// fingers pinch freely between the overview and ZOOMED_IN_CELL_PX (zoomCellPx: an explicit cell size); the
	// round's end zooms back out.
	const [zoomCellPx, setZoomCellPx] = useState<number | null>(null);
	const zoomRef = useRef<number | null>(null); zoomRef.current = zoomCellPx;
	const cellPxRef = useRef(0);
	const firstTapDone = useRef(false);
	const phoneLandscapeRef = useRef(false);
	const pendingZoom = useRef<ZoomAnchor | null>(null);
	const pendingPinch = useRef<(PinchCommit & { fromCellPx: number }) | null>(null);
	const zoomAnim = useRef<(() => void) | null>(null);
	const viewRef = useRef<HTMLElement>(null);
	// Match-found moment: when the opponent's seat fills during a ranked 1v1, play the banner once.
	const [searchSince, setSearchSince] = useState<number | null>(null);
	// card: Target acquired on the opponent's board; cardOut: the banner is in and the card slides away; banner: banner alone.
	const [foundPhase, setFoundPhase] = useState<"card" | "cardOut" | "banner" | null>(null);
	const oppId = (match.opponents()[0] || {}).id || null;
	const lastOppRef = useRef<string | null>(null);
	useEffect(() => { if (s.search && searchSince == null) setSearchSince(Date.now()); if (!s.search && !s.inRoom) setSearchSince(null); }, [s.search, s.inRoom]);
	// The heartbeat plays for as long as a seat is empty (the search ends the moment the room forms, in
	// both formats); the found sting and the VS stinger below follow the found phases, so each sound lands on
	// its visual rather than on the socket event.
	const searching = !!s.search;
	useEffect(() => { if (!searching) return; sound.startSearch(); return () => sound.stopSearch(); }, [searching]);
	const foundAt = useRef(0), foundCardMs = useRef(FOUND_CARD_MS), foundBannerMs = useRef(MATCH_FOUND_MS);   // the 1v1's card and slabs, or the 6-player breath and grid
	const foundWaitsForStart = useRef(true);   // 1v1: the card can wait for start_game before giving way; 6 players: nothing is on screen meanwhile, so no waiting
	useEffect(() => {
		// Only the seat filling during a search plays it, never a roster refresh mid-round.
		if (oppId && !lastOppRef.current && searchSince != null && match.isDuo() && !s.roundLive) {
			lastOppRef.current = oppId;
			foundAt.current = Date.now(); foundCardMs.current = FOUND_CARD_MS; foundBannerMs.current = MATCH_FOUND_MS; foundWaitsForStart.current = true;
			setFoundPhase("card"); sound.matchFound();
		}
		if (!oppId && !s.inRoom) lastOppRef.current = null;   // a new search starts fresh; a roster blip inside a room does not
	}, [oppId]);
	// 6 players: the field's banner plays once the room has formed (every seat filled). The seats' own radars
	// were the search, so there is no card beat, only a short breath before the slabs glide in.
	const fieldFormed = !!(s.room && s.room.ranked && match.isMulti() && s.room.players.length >= match.battleSize());
	const lastFieldRef = useRef<string | null>(null);
	useEffect(() => {
		const key = fieldFormed && s.room ? String(s.room.id) : null;
		if (key && lastFieldRef.current !== key && searchSince != null && !s.roundLive) {
			lastFieldRef.current = key;
			foundAt.current = Date.now(); foundCardMs.current = FOUND_FIELD_BREATH_MS; foundBannerMs.current = MATCH_FOUND_SIX_MS; foundWaitsForStart.current = false;
			setFoundPhase("card"); sound.matchFound();
		}
		if (!key && !s.inRoom) lastFieldRef.current = null;
	}, [fieldFormed]);
	// The card gives way to the banner after FOUND_CARD_MS, or sooner when the round's 3-2-1 is due sooner: the
	// banner (MATCH_FOUND_MS from the card's leave to its exit) must be gone FOUND_GAP_MS before the first digit,
	// whatever the gap between the roster's arrival and start_game turned out to be (on phones it varies).
	// Until start_game has said when the digits begin, the card waits (with a cap, in case it never comes).
	useEffect(() => {
		if (foundPhase !== "card") return;
		const natural = foundAt.current + foundCardMs.current, digitsAt = s.countdownDigitsAt;
		const at = digitsAt == null ? (foundWaitsForStart.current ? natural + FOUND_WAIT_MAX_MS : natural) : Math.min(natural, digitsAt - FOUND_GAP_MS - foundBannerMs.current);
		const t = setTimeout(() => setFoundPhase("cardOut"), Math.max(0, at - Date.now()));
		return () => clearTimeout(t);
	}, [foundPhase, s.countdownDigitsAt]);
	useEffect(() => {
		if (foundPhase !== "cardOut") return;
		// The banner mounts with this phase: its stinger is timed from here (see sound.vsDuel / vsSix).
		if (match.isDuo()) sound.vsDuel(); else sound.vsSix();
		const t1 = setTimeout(() => setFoundPhase("banner"), CARD_LEAVE_MS);
		// Once the slabs have landed, the board's idle twinkle dissolves and stays off for the countdown.
		const t3 = setTimeout(() => match.session.fadeIdleOut(900), 700);
		return () => { clearTimeout(t1); clearTimeout(t3); };
	}, [foundPhase]);
	// The banner's own end is timed from its phase (the cardOut effect's cleanup would cancel a timer set there).
	useEffect(() => {
		if (foundPhase !== "banner") return;
		const t = setTimeout(() => setFoundPhase(null), Math.max(0, foundBannerMs.current - CARD_LEAVE_MS));
		return () => clearTimeout(t);
	}, [foundPhase]);
	// The round's end (1v1): the winner's banner slides in over the cards, holds for WIN_BANNER_MS, then slides
	// back out; the series result modal, when there is one, waits for that moment and arrives as it leaves.
	const [winPhase, setWinPhase] = useState<"in" | "out" | null>(null);
	const roundWinnerId = s.roundResultShown && s.roundResult ? s.roundResult.winnerId : null;
	useEffect(() => {
		if (!roundWinnerId || !match.isBattle()) { setWinPhase(null); return; }   // the 1v1's winner slab, and the same one for the 6-player field
		setWinPhase("in");
		const t = setTimeout(() => setWinPhase(p => (p === "in" ? "out" : p)), WIN_BANNER_MS);
		return () => clearTimeout(t);
	}, [roundWinnerId]);
	useEffect(() => { if (winPhase !== "out") return; const t = setTimeout(() => setWinPhase(null), WIN_LEAVE_MS); return () => clearTimeout(t); }, [winPhase]);
	const timer = useRoundTimer(s.roundDeadline);
	const [, tick] = useState(0);
	const portrait = useMediaQuery(PORTRAIT_MQ), landscape = useMediaQuery(LANDSCAPE_PHONE_MQ);
	const portraitOrientation = useMediaQuery("(orientation: portrait)");
	useInGameBody({ music: false });
	// The battle theme waits for the first round to go live (the search, the VS banner and the 3-2-1 play
	// over silence and their own sounds), then runs for the rest of the series; a new search from here
	// (play another) silences it again, and leaving the page stops it.
	useEffect(() => { if (s.roundLive) music.resume(); }, [s.roundLive]);
	useEffect(() => { if (s.search || !s.inRoom) music.pause(); }, [!!s.search, s.inRoom]);
	useEffect(() => () => music.pause(), []);
	const oppFrozenUntil = (s.frames || []).slice(1).reduce((m, f) => Math.max(m, (f && f.frozenUntil) || 0), 0);
	// An opponent's mine is heard in every battle (the 1v1, the six-player boards and list alike): a frame whose
	// penalty is new since the last one plays the distant blast. One path, from the frames, so it never depends on
	// which view is showing or on a mirror board being mounted.
	const heardFrozen = useRef<Record<string, number>>({});
	useEffect(() => {
		if (!match.isBattle()) return;
		for (const f of (s.frames || []).slice(1)) {
			if (!f || !f.id) continue;
			const until = f.frozenUntil || 0, last = heardFrozen.current[f.id] || 0;
			if (until > last) { heardFrozen.current[f.id] = until; if (until > Date.now()) sound.opponentMine(); }
		}
	}, [s.frames]);
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
	// The landscape layout's height: the viewport's, or the viewport's width when force-rotated. Short screens
	// (small phones: 360px and under) get the compact side panels (lsShort) and a mini board that fits the budget.
	const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
	useEffect(() => { const on = () => setViewport({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
	const lsHeight = forceRotate ? viewport.w : viewport.h;
	const lsWidth = forceRotate ? viewport.h : viewport.w;   // force-rotated, the layout is laid out at 100vh x 100vw
	const lsShort = phoneLandscape && lsHeight <= LS_SHORT_MAX_H;
	useEffect(() => { document.body.classList.toggle("duel-force-rotate", forceRotate); return () => { document.body.classList.remove("duel-force-rotate"); }; }, [forceRotate]);
	const rows = session.rows, cols = session.cols;
	// 1v1: the board fits its own arena (padding + border, the bar row below); otherwise the board card.
	// The duel grid is centred in the viewport, so the 1v1 board's height budget comes from fixed chrome
	// sizes (main padding + header above; bar row, arena and main padding below), not the canvas position.
	// Landscape phones: a 40px floor keeps cells tappable; the board pans inside its own scroller.
	// Desktop 1v1: the two cards shrink-wrap their boards and sit side by side under the lead bar, so
	// the cell size comes from the view's width split in two; the height budget is fixed chrome (header,
	// lead bar, card head, paddings) since the stack is centred in the viewport.
	const desktopDuo = duo && !phoneLandscape && !portrait, desktopMulti = multi && !phoneLandscape && !portrait;
	// A narrow desktop window (a tall browser window, a small tablet) stacks the 6-player view: your arena on top,
	// the compact standings list beneath, no boards. The side-by-side needs room for two columns of cards.
	const multiStacked = desktopMulti && viewport.w < MULTI_STACK_MAX_W;
	const multiCols = multiLayout(viewport.w, viewport.h, rows, cols);
	const desktopArena = desktopDuo || desktopMulti;   // the arena-card layouts, sized from the view's width (share of it after the other column)
	const sideBySideNeeds = 2 * (cols * DESKTOP_CELL_MIN + DUO_CARD_CHROME_W) + DUEL_GAP_PX, stackFits = viewport.h >= 2 * (rows * DESKTOP_CELL_MIN + DUO_CARD_CHROME_H) + DUO_STACK_CHROME_H;
	const duoStacked = portrait || (!!cols && viewport.w - MAIN_GUTTER_PX < sideBySideNeeds && stackFits);   // the two cards one above the other
	// Landscape phones: the overview is the whole board fitted to the scroller box (lsOverview); a zoom level
	// pins the cell size exactly (min = max).
	const lsOverview: CellPxOptions = { rows, cols, minCell: 1, maxCell: ZOOMED_IN_CELL_PX, chrome: 0, fitBox: "[data-board-scroll]", bottomGap: 64, desktopFit: true };
	const lsBranch = phoneLandscape && battle && !planningLobby;   // the landscape branch is what is rendered (the search still shows the desktop branch)
	const cellPx = useCellPx(desktopArena ? viewRef : boardHostRef, phoneLandscape ? { ...lsOverview, minCell: zoomCellPx ?? 1, maxCell: zoomCellPx ?? ZOOMED_IN_CELL_PX, key: lsBranch } : { rows, cols, maxCell: duo ? 100 : 54, minCell: (desktopDuo && !duoStacked) || multi ? DESKTOP_FIT_MIN_CELL : undefined, chrome: duo || multi ? 38 : 42, gutterX: portrait ? PORTRAIT_GUTTER_X : undefined, bottomGap: duo ? 72 : multi ? (multiStacked ? MULTI_BOTTOM_GAP + MULTI_STACK_LIST_H : MULTI_BOTTOM_GAP) : undefined, desktopFit: false, topOffset: desktopArena ? 250 : undefined, reserve: desktopDuo && !duoStacked ? DUEL_GAP_PX : desktopMulti && !multiStacked ? multiCols.columnW + DUEL_GAP_PX : undefined, share: desktopDuo && !duoStacked ? 2 : undefined });
	cellPxRef.current = cellPx;

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
	const stopZoomAnim = () => { if (zoomAnim.current) { zoomAnim.current(); zoomAnim.current = null; } };
	// Landscape phones: the board floats in a scroll area padded on every side by half the box, so at any zoom
	// it can be pushed until its edge reaches the box's centre (a quarter of the box's worth of board always
	// stays in view) and it stays where a gesture left it instead of snapping to the centre. Only the round's
	// start (and a resize while still at the untouched overview) centres it, here. Declared before the zoom
	// effects below, which read the canvas's offset (margins included) in the same commit.
	// Runs every commit (the landscape branch mounts a fresh canvas without any size input changing) but only
	// acts when the canvas, its size or the box's size differ from the last time, so a panned overview is not
	// re-centred by the frames arriving during the round.
	const padKey = useRef("");
	useLayoutEffect(() => {
		const canvas = session.canvas, sc = canvas && canvas.parentElement; if (!canvas || !sc) return;
		if (!phoneLandscape) { if (padKey.current) { canvas.style.margin = ""; padKey.current = ""; } return; }
		const key = [canvas.offsetWidth, canvas.offsetHeight, sc.clientWidth, sc.clientHeight, zoomCellPx].join(",");
		if (padKey.current === key && padCanvas.current === canvas) return;
		padKey.current = key; padCanvas.current = canvas;
		const mx = Math.max(0, Math.round(sc.clientWidth / 2) - SHAKE_PAD_X), my = Math.max(0, Math.round(sc.clientHeight / 2) - SHAKE_PAD_Y);   // measured from the scroller's padding edge
		canvas.style.margin = `${my}px ${mx}px`;
		if (zoomRef.current === null && !pendingZoom.current && !pendingPinch.current) {
			sc.scrollLeft = canvas.offsetLeft - (sc.clientWidth - canvas.offsetWidth) / 2;
			sc.scrollTop = canvas.offsetTop - (sc.clientHeight - canvas.offsetHeight) / 2;
		}
	});
	const padCanvas = useRef<HTMLCanvasElement | null>(null);
	// The animated zoom (a tap zooming in, the round's end zooming out): to `target` (null: the overview), centred on a cell.
	const zoomTo = (target: number | null, r: number, c: number) => {
		const canvas = session.canvas; if (!canvas || !session.cols || zoomRef.current === target) return;
		stopZoomAnim(); pendingPinch.current = null;
		pendingZoom.current = measureZoomStart(canvas, session.cols, r, c);
		setZoomCellPx(target);
		if (navigator.vibrate) navigator.vibrate(8);
	};
	// Once the canvas has been laid out at the new cell size (GameBoard's own layout effect runs first), play the zoom.
	useLayoutEffect(() => {
		const a = pendingZoom.current, canvas = session.canvas;
		if (!a || !canvas) return;
		if (Math.abs(canvas.clientWidth / session.cols - a.fromCellPx) < 0.5) return;   // the resize has not landed yet
		pendingZoom.current = null;
		const cancel = animateZoom(canvas, session.rows, session.cols, a, () => { zoomAnim.current = null; });
		zoomAnim.current = cancel;
		return () => { if (zoomAnim.current === cancel) { cancel(); zoomAnim.current = null; } };
	}, [cellPx, zoomCellPx]);
	// A pinch has ended: the board is laid out at the new size (or is already, when the size did not change);
	// scroll so the anchored board point sits where the fingers left it, then drop the gesture's transform.
	const applyPinch = (c: PinchCommit) => {
		const canvas = session.canvas, sc = canvas && canvas.parentElement; if (!canvas || !sc) return;
		sc.scrollLeft = c.fx * canvas.offsetWidth + canvas.offsetLeft - c.mx;
		sc.scrollTop = c.fy * canvas.offsetHeight + canvas.offsetTop - c.my;
		clearZoomTransform(canvas);
	};
	useLayoutEffect(() => {
		const a = pendingPinch.current, canvas = session.canvas;
		if (!a || !canvas) return;
		if (Math.abs(canvas.offsetWidth / session.cols - a.fromCellPx) < 0.05) return;   // the resize has not landed yet
		pendingPinch.current = null;
		applyPinch(a);
	}, [cellPx, zoomCellPx]);
	// Every round starts at the overview: the overview is restored both when a round ends (the result is not
	// seen through a close-up) and at GO, so nothing done during the countdown can carry a close-up into the round.
	// (padKey reset: the padding effect re-centres the overview even when nothing about the canvas changed.)
	useEffect(() => { stopZoomAnim(); pendingZoom.current = null; pendingPinch.current = null; firstTapDone.current = false; padKey.current = ""; if (session.canvas) clearZoomTransform(session.canvas); setZoomCellPx(null); }, [s.roundLive]);
	// The round's end: back to exactly the start position, the whole board centred (the zoom-out is anchored on
	// the board's middle cell, so it ends with every cell in view wherever the player was), unless already there.
	// From here the board is held (boardHeld) until the next round's GO.
	useEffect(() => {
		const canvas = session.canvas, sc = canvas && canvas.parentElement;
		if (!s.roundResultShown || !canvas || !sc || !phoneLandscapeRef.current) return;
		const atOverview = zoomRef.current === null && Math.abs(sc.scrollLeft - (canvas.offsetLeft - (sc.clientWidth - canvas.offsetWidth) / 2)) < 2 && Math.abs(sc.scrollTop - (canvas.offsetTop - (sc.clientHeight - canvas.offsetHeight) / 2)) < 2;
		if (atOverview) return;
		if (zoomRef.current === null) {   // already the overview size, only panned: a quick scroll back to the centre
			sc.scrollTo({ left: canvas.offsetLeft - (sc.clientWidth - canvas.offsetWidth) / 2, top: canvas.offsetTop - (sc.clientHeight - canvas.offsetHeight) / 2, behavior: "smooth" });
			return;
		}
		zoomTo(null, (session.rows - 1) / 2, (session.cols - 1) / 2);
	}, [s.roundResultShown]);
	// The board is held (no pan, pinch, tap or area jump moves it) before GO and once the round's result is up.
	const boardHeld = () => !match.state.roundLive || match.state.roundResultShown;
	// Phone landscape: a drag anywhere in the board card pans the board, two fingers pinch-zoom it. Keyed on the
	// landscape branch being rendered (not just the media query): the board card these listen on only exists once
	// the match is on.
	useEffect(() => {
		const host = boardHostRef.current; if (!host || !lsBranch) return;
		const scroller = () => host.querySelector<HTMLElement>("[data-board-scroll]");
		// A mine penalty blocks playing, not looking: pan and pinch stay live (a desktop player sees the whole board
		// throughout, a phone player should get to look around too). The board is held still before GO and once
		// the round's result is up (it animates back to the start position then).
		const blocked = boardHeld;
		const detachPan = attachPanAnywhere(host, scroller, blocked);
		const detachPinch = attachPinchZoom(host, {
			canvas: () => session.canvas, maxPx: ZOOMED_IN_CELL_PX, blocked,
			cellPxNow: canvas => canvas.offsetWidth / Math.max(1, session.cols),
			overviewPx: () => fitCellPx(host, session.canvas, { ...lsOverview, rows: session.rows, cols: session.cols }),
			onStart: () => { stopZoomAnim(); pendingZoom.current = null; pendingPinch.current = null; if (session.canvas) clearZoomTransform(session.canvas); },
			onCommit: c => {
				firstTapDone.current = true;   // zooming by hand is the round's first action too: no tap-to-zoom after it
				if (Math.abs(cellPxRef.current - c.cellPx) < 0.25) { applyPinch(c); return; }   // no relayout coming: settle the scroll now
				pendingPinch.current = { ...c, fromCellPx: cellPxRef.current };
				setZoomCellPx(c.cellPx);
			},
		});
		return () => { detachPan(); detachPinch(); };
	}, [lsBranch]);
	// The round's first tap, from the untouched overview, zooms in on that cell instead of acting (it shows the
	// board zooms, and "go here" is what the first tap means); every later tap plays at whatever zoom. While the
	// board is held (the countdown, the wait for an opponent, the result) a tap does nothing at all.
	const firstTapPending = () => phoneLandscapeRef.current && (boardHeld() || (!firstTapDone.current && zoomRef.current === null));
	const zoomInput = useMemo<Partial<InputOptions>>(() => ({
		swallowingTaps: firstTapPending,
		interceptTap: (x, y) => {
			if (!firstTapPending()) return false;
			if (boardHeld()) return true;
			firstTapDone.current = true;
			const cell = session.cellFromClient(x, y); if (cell) zoomTo(ZOOMED_IN_CELL_PX, cell.r, cell.c);
			return true;
		},
	}), [session]);
	const me = match.me(), opps = match.opponents();
	// Desktop 6-player: the players' column shows every board (cards, you included) or the plain standings list.
	// Remembered on the account (set_pref, so it follows you between devices) and in this browser as the fallback.
	const [oppView, setOppView] = useState<"boards" | "list">(() => { const p = account && account.prefs && account.prefs.playersView; if (p) return p; try { return localStorage.getItem("ms_opp_view") === "list" ? "list" : "boards"; } catch { return "boards"; } });
	const pickedView = useRef(false);
	useEffect(() => { const p = account && account.prefs && account.prefs.playersView; if (p && !pickedView.current) setOppView(p); }, [account && account.prefs && account.prefs.playersView]);   // the account may arrive after the page
	const pickOppView = (v: "boards" | "list") => {
		pickedView.current = true; setOppView(v);
		try { localStorage.setItem("ms_opp_view", v); } catch { /* storage blocked */ }
		if (account) { update({ prefs: { ...(account.prefs || {}), playersView: v } }); getSocket().emit("set_pref", { key: "playersView", value: v }); }
	};
	const overlayUp = foundPhase !== null || winPhase !== null || !!s.seriesResult;
	const frames = s.frames || [];
	const myFrame = frames[0] || null;
	const frameOf = (p: RoomPlayer) => frames.find(f => f && f.id === p.id) || null;
	const winnerNow = roundWinnerId ? match.roster().find(p => p.id === roundWinnerId) || null : null;
	const winner = winnerNow ? match.asAtStart(winnerNow) : null; // the rank they played as, not the one the result just gave them
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

	// A ranked match still running (the series hasn't ended): leaving counts as a loss, so the exit asks first.
	const [confirmLeave, setConfirmLeave] = useState(false);

	// After every hook: leaving a match unmounts the room state, and the redirect must not change hook order.
	if (!s.inRoom && !s.search) return <Navigate to="/" replace />;

	const rankedLive = !!(s.inRoom && s.room && s.room.ranked && s.room.phase === "playing" && !s.seriesResult);
	const exit = () => {
		if (s.search) { match.cancelSearch(); navigate("/"); return; }
		if (rankedLive) { setConfirmLeave(true); return; }
		match.leaveRoom(); navigate("/");
	};
	const leaveNow = () => { setConfirmLeave(false); match.leaveRoom(); navigate("/"); };
	const leaveConfirm = confirmLeave && (
		<Modal open onClose={() => setConfirmLeave(false)} width={360} title="Leave the match?" labelledBy="leave_title" hideClose>
			<p className={styles.leaveText}>Leaving a ranked match counts as a loss.</p>
			<div className={`${styles.leaveActions} kbd-btn-group`}>
				<button type="button" className="btn" onClick={() => setConfirmLeave(false)} autoFocus>Stay</button>
				<button type="button" className={`btn ${styles.leaveBtn}`} onClick={leaveNow}>Leave</button>
			</div>
		</Modal>
	);

	const boardOverlays = (
		<>
			{hitCount(s.frozenUntil, myHit)}
			{/* Cleared: the dial drains for the time the round has left, around your place ("Winner" for first). */}
			{s.waitingCleared && !s.roundResultShown && <div className={`${styles.overlay} ${styles.cleared}`}><ClearedDial place={me ? placeOf[me.id] || 0 : 0} deadline={s.roundDeadline} /></div>}
		</>
	);
	// The overlays (mine-hit freeze tint, "cleared" notice) cover the whole board card, not just the canvas.
	const board = <GameBoard session={session} cellPx={cellPx} flagMode={() => flagRef.current} input={zoomInput} className={styles.board} />;

	// Phones: the flag-mode toggle sits over the board card's bottom-right corner (game/FlagToggle, design G·09).
	const flagToggle = <FlagToggle on={flagMode} onToggle={() => setFlagMode(f => !f)} />;

	if (lsBranch) {
		const opp = opps[0] || null;
		// The opponent's mini board sits right under their name at the panel's inner width; the mode button on your
		// side is the same box (same height, same width) right under your name, with the two area jumps beneath it.
		// Cells are sized to the panel's inner width (minus its border and 0.5rem padding each side), and no taller
		// than what the panel's height leaves for the box, so a short screen never pushes the name under the box.
		const boxMaxH = Math.max(40, lsHeight - (lsShort ? LS_FIXED_H_SHORT : LS_FIXED_H));
		const miniPx = cols && rows ? Math.min((LS_PANEL_W - 2 - 16) / cols, boxMaxH / rows) : 6, miniH = rows ? Math.round(rows * miniPx) : 0;
		// 6 players: the standings rows split the right panel's height between them instead of huddling at its top,
		// and the avatar, name, bar and percentage grow with the row (Standings.module.scss reads these two vars).
		const lsBoardNeedW = rows && cols ? ((lsHeight - LS_BOARD_CHROME_H) / rows) * cols + LS_BOARD_CHROME_W : 0;
		const lsSpareW = lsWidth - LS_GRID_CHROME_W - 2 * LS_PANEL_W - lsBoardNeedW;
		const lsOppW = duo ? LS_PANEL_W : Math.round(Math.min(LS_OPP_W_MAX, LS_PANEL_W + Math.max(0, lsSpareW)));
		const seatCount = Math.max(1, room ? room.players.length : s.search ? s.search.size : 6);
		const lsListH = lsHeight - LS_LIST_CHROME;
		const lsRowH = Math.max(LS_ROW_MIN, Math.min(LS_ROW_MAX, Math.floor((lsListH - (seatCount - 1) * LS_ROW_GAP) / seatCount)));
		const lsAvatarPx = Math.max(20, Math.min(36, Math.round(lsRowH * 0.58)));
		return (
			<section className={`${styles.view} ${styles.landscape} ${lsShort ? styles.lsShort : ""} ${duo ? styles.duo : styles.multi}`} style={{ "--ls-mini-h": miniH + "px", "--ls-opp-w": lsOppW + "px" } as React.CSSProperties}>
				<div className={`${styles.lsPanel} ${styles.lsYou}`}>
					<button className={styles.lsBack} onClick={exit} aria-label="Exit game" title="Exit game">
						<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11" /></svg>
					</button>
					{/* Opposite the back button: a way back into fullscreen after an accidental exit (a swipe from the edge). */}
					<FullscreenButton className={styles.lsFs} lockLandscape />
					<DuelIdentity player={me || (account ? { id: "", name: account.name, avatar: account.avatarColor, country: account.country, rating: undefined } as any : null)} side="you" vertical ring noTier avatarPx={lsShort ? 48 : 64} />
					{s.search && !duo && <span className={styles.searchStatus}><span className={styles.spinner} />{s.search.members.length}/{s.search.size}</span>}
					<div className={`${styles.lsClock} ${!timer.text ? styles.clockIdle : ""}`}><span className={`${styles.duelTimer} ${timer.cls}`}>{clockText}</span></div>
					<span className={styles.lsLeft}>{cellsLeftOf(myFrame) || "\u00a0"}</span>
					<span className={styles.lsSpacer} />
				</div>
				{/* 1v1: two boxes, the outer one (no visible edges) holding the lead bar and the board card; the card below
				    the bar carries the border, square at the top where it meets the bar and rounded at the bottom.
				    6 players: no bar (your own progress is the first row of the standings panel), so the card is a
				    plain box on its own, bordered and rounded all the way round with even padding. */}
				<div className={`${styles.lsCenter} ${duo ? styles.lsCenterBar : ""} ${hitClass(myHit)}`} ref={boardHostRef} data-shake-host="">
					{duo && <div className={styles.lsBar}><LeadBar myLeft={cellsLeftNum(myFrame)} opLeft={cellsLeftNum(opp ? frameOf(opp) : null)} flat /></div>}
					<div className={styles.lsBoardCard}>
						<div className={`${styles.boardWrap} ${styles.lsBoardWrap}`}>{board}{!duo && <PlaceStamp place={me ? placeOf[me.id] : null} />}</div>
						{boardOverlays}
						{flagToggle}
					</div>
				</div>
				{/* 1v1: the opponent's mine hit reads like your own, the panel turns red with the penalty count over their mini
				    board. 6 players: the standings, every player ranked live (their mine hits show on their rows). */}
				<div className={`${styles.lsPanel} ${styles.lsOpp} ${duo ? hitClass(oppHit) : ""}`}>
					{duo ? (
						<>
							{/* The panel is laid out in full from the start (skeleton identity, board slot), so nothing moves when the opponent arrives. */}
							<DuelIdentity player={opp || null} side="opp" vertical ring noTier skeleton={!opp} avatarPx={lsShort ? 48 : 64} />
							<div className={styles.lsOppBoard}>{opp ? <OpponentBoard playerId={opp.id} skin={opp.skin || "classic"} frame={frameOf(opp)} rows={rows} cols={cols} cellPx={miniPx} className={styles.oppCanvas} covered /> : <span className={`skel-shimmer ${styles.lsOppSkel}`} />}{hitCount(oppFrozenUntil, oppHit)}</div>
							<span className={styles.lsLeft}>{(opp && cellsLeftOf(frameOf(opp))) || "\u00a0"}</span>
							<span className={styles.lsSpacer} />
							{searchSince != null && !s.roundLive && ((!opp && s.search) || foundPhase === "card" || foundPhase === "cardOut") && <FindingEnemy since={searchSince} found={foundPhase === "card" || foundPhase === "cardOut"} leaving={foundPhase === "cardOut"} compact />}
						</>
					) : (
						<>
							{/* The six players as the compact standings list, in their seats (no re-sorting, as on the desktop). */}
							<div className={styles.lsStandings} style={{ "--row-h": lsRowH + "px", "--av": lsAvatarPx + "px" } as React.CSSProperties}><Standings room={room} search={s.search} frames={s.frames} myId={match.myId} placeOf={placeOf} compact roomy /></div>
						</>
					)}
				</div>
				{(foundPhase === "banner" || foundPhase === "cardOut") && (duo ? <MatchFoundBanner me={me} opp={opp} compact /> : <MatchFoundSix players={match.roster()} myId={match.myId} compact />)}
				{winBanner(true)}
				{s.seriesResult && winPhase !== "in" && <SeriesResultModal result={s.seriesResult} myId={match.myId} compact />}
				{leaveConfirm}
			</section>
		);
	}

	return (
		<section ref={viewRef} className={`${styles.view} ${duo ? styles.duo : multi ? styles.multi : ""} ${s.mode ? styles.ranked : ""} ${portrait ? styles.portrait : ""} ${live ? styles.live : ""}`}>
			{/* A scene behind the boards for online battles (design-refs/skin-concepts): a trial with the ice one, tinted so the HUD keeps its contrast. */}
			{live && battle && <div className={styles.backdrop} style={{ backgroundImage: `url(${BATTLE_BACKDROP})` }} aria-hidden="true" />}
			<div className={styles.header}>
				<button className="btn btn-ghost" onClick={exit}>← Exit game</button>
				<div className={styles.headerRight}>
					{/* Battles say nothing here: the search shows on every empty seat, the mode on the clock; only custom rooms keep the readouts. */}
					{s.search && !duo && !multi && <span className={styles.searchStatus}><span className={styles.spinner} />Finding match · {s.search.members.length}/{s.search.size}</span>}
					{!duo && !multi && s.mode && !s.search && <span className={styles.rankedTag}>RANKED</span>}
					{!duo && !multi && <span className={styles.progressText}>{s.gameProgress}</span>}
					{!duo && !multi && timer.text && <span className={`${styles.roundTimer} ${timer.cls}`}>⏱ {timer.text}</span>}
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
					<div className={`${styles.duelGrid} ${duoStacked ? styles.duelGridStacked : ""}`}>
						<div className={`${styles.arena} ${styles.arenaYou} ${hitClass(myHit)}`} style={viewW ? ({ "--board-view-w": viewW + "px" } as React.CSSProperties) : undefined} ref={boardHostRef} data-shake-host="">
							{portrait && !planningLobby && flagToggle}
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
				</div>
			) : multi ? (
				<div className={`${styles.duelStack} ${styles.multiStack}`}>
					{(foundPhase === "banner" || foundPhase === "cardOut") && <MatchFoundSix players={match.roster()} myId={match.myId} />}
					{winBanner(false, portrait)}
					{/* Two columns with matching head rows: the clock centred over your arena, the Boards / List switch at the
					    right over the cards, so the cards start level with your arena. */}
					<div className={`${styles.duelGrid} ${styles.multiGrid} ${multiStacked ? styles.multiGridStacked : ""}`} style={{ "--players-w": multiCols.columnW + "px" } as React.CSSProperties}>
						<div className={styles.multiCol}>
							<div className={styles.multiHead}><div className={`${styles.timerBadge} ${!timer.text ? styles.clockIdle : ""}`}><div className={`${styles.duelTimer} ${timer.cls}`}>{clockText}</div></div></div>
							<div className={`${styles.arena} ${styles.arenaYou} ${hitClass(myHit)}`} ref={boardHostRef} data-shake-host="">
								<div className={styles.arenaHead}>
									<DuelIdentity player={me || (account ? { id: "", name: account.name, avatar: account.avatarColor, country: account.country, rating: undefined } as any : null)} side="you" plain />
									<ArenaStat frame={myFrame} side="you" hit={myHit === "on"} />
								</div>
								<div className={styles.boardWrap}>{board}<PlaceStamp place={me ? placeOf[me.id] : null} /></div>
								{boardOverlays}
							</div>
						</div>
						{/* Every player, you included: a grid of cards, each a standings row over that player's live board, ranked
						    live. No container around them: the cards are the arenas. */}
						{multiStacked ? (
							<aside className={styles.playersColumn} aria-label="Players"><div className={styles.stackedList}><Standings room={room} search={s.search} frames={s.frames} myId={match.myId} placeOf={placeOf} compact /></div></aside>
						) : (
						<aside className={styles.playersColumn} aria-label="Players">
							<div className={`${styles.multiHead} ${styles.multiHeadRight}`}>
								{/* Not while something is presented over the dimmed page (the field, the winner, the result): the page is not the thing on screen then. */}
								<div className={styles.viewSwitch} role="group" aria-label="Players view">
									<button type="button" className={oppView === "boards" ? styles.viewOn : ""} aria-pressed={oppView === "boards"} disabled={overlayUp} onClick={() => pickOppView("boards")}>Boards</button>
									<button type="button" className={oppView === "list" ? styles.viewOn : ""} aria-pressed={oppView === "list"} disabled={overlayUp} onClick={() => pickOppView("list")}>List</button>
								</div>
							</div>
							<div className={styles.standingsList}>
								{oppView === "boards" ? <OpponentCards room={room} search={s.search} searchSince={searchSince} frames={s.frames} myId={match.myId} rows={rows} cols={cols} cellPx={multiCols.cardPx} placeOf={placeOf} /> : <div className={styles.standingsScroll}><Standings room={room} search={s.search} frames={s.frames} myId={match.myId} placeOf={placeOf} /></div>}
							</div>
						</aside>
						)}
					</div>
				</div>
			) : (
				<div className={styles.grid}>
					<div className={styles.left} ref={boardHostRef}>
						<div className={`${styles.boardCard} ${hitClass(myHit)}`} data-shake-host="">{board}<PlaceStamp place={me ? placeOf[me.id] : null} />{boardOverlays}</div>
						<div className={styles.tools}>
							<button className={`btn ${flagMode ? styles.toolActive : ""}`} onClick={() => setFlagMode(f => !f)} aria-pressed={flagMode}>🚩 Flag mode</button>
						</div>
					</div>
					<aside className={styles.side}>
						<div className={styles.card}><h3 className={styles.sideTitle}>Scoreboard</h3><Scoreboard room={room} search={s.search} frames={s.frames} myId={match.myId} /></div>
					</aside>
				</div>
			)}
			{s.seriesResult && winPhase !== "in" && <SeriesResultModal result={s.seriesResult} myId={match.myId} />}
			{leaveConfirm}
		</section>
	);
}

