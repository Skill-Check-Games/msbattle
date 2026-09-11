// The live match: one store (subscribed through useMatch) that owns the socket handlers for rooms,
// ranked search, rounds and results, plus the local player's BoardSession. Pages render from it;
// nothing here touches the DOM except through the session's canvas, which GameBoard binds.
import { useSyncExternalStore } from "react";
import MoveHash from "core/src/common/MoveHash.js";
import { getSocket, activeSocket, startMatchSocket, teardownMatchSocket } from "../online/socket";
import { pushToast } from "../app/Toasts";
import { BoardSession, ActionResult } from "./board-session";
import { KNOWN, UNKNOWN, MINE } from "./board-render";
import { makeBoardDecoder } from "./board-decoder";
import { countDown, cancelCountdown } from "./countdown";
import { sound } from "../audio/sound";
import BoardLogic from "core/src/common/BoardLogic.js";

export interface RoomPlayer { id: string; name: string; avatar: string | null; country: string | null; ready: boolean; score: number; isOwner: boolean; isBot: boolean; difficulty?: string; rating?: number; provisional?: boolean; finished?: boolean; skin?: string | null; isYou?: boolean; }
export interface RoomState {
	id: number; owner: string; ranked: boolean; rankedMode: string | null; gameMode: string; phase: "planning" | "playing";
	gameCount: number; gamesPlayed: number; scoreTarget: number | null; roundSeconds: number; deathPenalty: number; mineDensity: number; boardSize: string;
	modifier: "noFlags" | "onlyFlags" | null; rows: number; cols: number; roundDeadline: number | null;
	lastGameWinner: string | null; lastGameWinnerName: string | null; seriesWinner: string | null; seriesWinnerName: string | null;
	gameCountOptions: number[]; roundSecondsOptions: number[]; deathPenaltyOptions: number[]; boardSizeOptions: string[]; botDifficultyOptions: string[];
	botCount: number; maxBots: number; maxPlayers: number; players: RoomPlayer[];
}
export interface GameFrame { id: string; playerName: string; skin: string | null; revealEffect?: string | null; avatar: string | null; country: string | null; state: number[][]; finished: boolean; finishedAt: number; safeCount: number; totalSafe: number; progress: number; frozenUntil: number; playing: boolean; }
export interface Standing { id: string; name: string; rank?: number; score?: number; finished?: boolean; finishMs?: number; progress?: number; rating?: number; ratingDelta?: number; provisional?: boolean; }
export interface RankedSearch { mode: string; size: number; members: RoomPlayer[]; roundSeconds?: number; }
export interface SeriesResult { winnerId: string | null; winnerName: string | null; ranked: boolean; mode: string | null; standings: Standing[]; scores: Array<{ id: string; name: string; score: number }>; }

export interface RoomSummary { id: number; ownerName: string; playerCount: number; humanCount: number; maxPlayers: number; phase: string; gameMode: string; gameCount: number; gamesPlayed: number; roundSeconds: number; deathPenalty: number; boardSize?: string; mineDensity?: number; players?: string[]; }
export interface CreateRoomOptions { players: number; boardSize: string; mineDensity: number; roundSeconds: number; deathPenalty: number; gameCount: number; modifier: string | null; }

export interface MatchState {
	inRoom: boolean;
	rooms: RoomSummary[] | null;   // the custom-room lobby list (room_list broadcasts)
	room: RoomState | null;
	search: RankedSearch | null;
	mode: string | null;               // the ranked mode this match was found through
	roundLive: boolean;                // GO has happened and the round is not over
	roundResultShown: boolean;
	roundDeadline: number | null;
	gameProgress: string;              // "Game 2 of 5"
	frames: GameFrame[] | null;        // the last draw_board frame, [me, ...opponents]
	seriesResult: SeriesResult | null; // shown as the result modal
	roundResult: { winnerId: string | null; standings: Standing[] } | null;
	frozenUntil: number;
	roundEndLeft: number | null;       // seconds left on the clock when the round ended (the clock holds there through the result)
	waitingCleared: boolean;           // I finished the round, others still playing
	message: string | null;            // a lobby/join error to flash
}

const rankedModeSize = (mode: string) => /_six$/.test(mode) ? 7 : 2;

class MatchStore {
	state: MatchState = { inRoom: false, rooms: null, room: null, search: null, mode: null, roundLive: false, roundResultShown: false, roundDeadline: null, gameProgress: "", frames: null, seriesResult: null, roundResult: null, frozenUntil: 0, waitingCleared: false, roundEndLeft: null, message: null };
	session: BoardSession;
	myId: string | null = null;
	private listeners = new Set<() => void>();
	private moveSeq = 0; private moveHash: number = MoveHash.SEED; private moveLog: Array<{ seq: number; r: number; c: number; flag: boolean }> = [];
	private pendingReveal = false;
	private lastFinished: Record<string, boolean> = {};
	private opponentSessions = new Map<string, BoardSession>();
	private mainId: string | null = null;   // the lobby socket's player id, restored when a match connection ends
	// Closes the per-match game-server connection (split deployment) and goes back to the main identity.
	private dropMatchSocket() { teardownMatchSocket(); if (this.mainId) this.myId = this.mainId; }
	private lastCursorAt = 0;
	private searchAckTimer: number | null = null;
	private wired = false;

	constructor() {
		this.session = new BoardSession({
			mode: () => (this.state.inRoom && this.state.room && this.state.room.phase === "playing" && this.state.roundLive && !this.state.roundResultShown) ? "multiplayer" : null,
			rules: () => this.state.room ? { noFlags: this.state.room.modifier === "noFlags", onlyFlags: this.state.room.modifier === "onlyFlags", deathPenalty: this.state.room.deathPenalty } : null,
			// Opponents see where your pointer is (throttled; only during a live round).
			onCursor: (r, c) => { const now = Date.now(); if (!this.state.roundLive || now - this.lastCursorAt < 80) return; this.lastCursorAt = now; activeSocket().emit("cursor", { r, c }); },
			sound,
			onAction: (r, c, asFlag, result) => this.emitMove(r, c, asFlag, result),
			onFreeze: (until) => this.set({ frozenUntil: until })
		});
		this.session.ownBoard = true;
	}

	// ---- subscription ----
	subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };
	getSnapshot = () => this.state;
	private set(patch: Partial<MatchState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(cb => cb()); }

	// ---- helpers the layouts need ----
	// A ranked mode fixes the size for the whole flow (search, the moment the room forms, play), so the
	// layout never flips while the roster is still filling in; custom rooms go by their player count.
	battleSize(): number {
		const s = this.state;
		if (s.mode) return rankedModeSize(s.mode);
		if (s.room && s.room.players && (s.room.gameMode || "race") === "race") return s.room.players.length;
		if (s.search) return s.search.size;
		return 0;
	}
	isDuo() { return this.battleSize() === 2; }
	isMulti() { const n = this.battleSize(); return n >= 3 && n <= 7; }
	isBattle() { return this.isDuo() || this.isMulti(); }
	battleActive() { const s = this.state; return !!(s.search) || !!(s.room && (s.room.phase === "playing" || s.room.ranked)); }
	roster(): RoomPlayer[] { const s = this.state; if (s.room && s.room.players) return s.room.players; if (s.search) return s.search.members; return []; }
	me(): RoomPlayer | null { return this.roster().find(p => p.id === this.myId || p.isYou) || null; }
	opponents(): RoomPlayer[] { return this.roster().filter(p => !(p.id === this.myId || p.isYou)); }
	registerOpponentSession(id: string, session: BoardSession | null) { if (session) this.opponentSessions.set(id, session); else this.opponentSessions.delete(id); }

	// ---- socket wiring (once) ----
	wire() {
		if (this.wired) return; this.wired = true;
		const socket = getSocket();
		socket.on("connected", (d) => { this.myId = d.id; this.mainId = d.id; });
		// Split deployment: the match is played on a game server. On that server this client's id is the
		// GAME socket's id (matches are keyed by socket id), so it is adopted for the match: which board is
		// mine, winnerId and standings all compare against it. The main id comes back on teardown.
		socket.on("match_handoff", (d) => {
			if (!d || !d.gameUrl || !d.token) return;
			startMatchSocket(d.gameUrl, d.token, (id) => { this.myId = id; this.set({});  });
		});
		socket.on("joined_room", (d) => {
			this.set({ inRoom: true, mode: d && d.mode ? d.mode : this.state.mode, search: null, seriesResult: null, roundResult: null, gameProgress: "", roundDeadline: null, waitingCleared: false });
			this.resetRound();
		});
		socket.on("ranked_searching", (info) => {
			if (!this.state.search) return;
			if (this.searchAckTimer) { clearTimeout(this.searchAckTimer); this.searchAckTimer = null; }
			this.set({ search: { ...this.state.search, members: (info && info.members) || [], size: (info && info.size) || this.state.search.size, roundSeconds: (info && typeof info.roundSeconds === "number") ? info.roundSeconds : this.state.search.roundSeconds } });
		});
		socket.on("ranked_rejected", (d) => this.failSearch((d && d.reason) || "Couldn't start the ranked search."));
		socket.on("join_failed", (d) => this.flash((d && d.reason) || "Couldn't join lobby"));
		socket.on("room_list", (d) => this.set({ rooms: (d && d.rooms) || [] }));
		socket.on("room_state", (room: RoomState) => {
			const prev = this.state.room;
			if (!prev || prev.rows !== room.rows || prev.cols !== room.cols) this.session.rows = room.rows, this.session.cols = room.cols;
			// Opponent finish chime, once per opponent per round.
			if (room.phase === "playing" && !this.state.roundResultShown) {
				let done = 0; room.players.forEach(p => { if (p.id !== this.myId && p.finished) done++; });
				room.players.forEach(p => { if (p.id !== this.myId && p.finished && !this.lastFinished[p.id]) sound.opponentDone(done); });
			}
			room.players.forEach(p => { this.lastFinished[p.id] = !!p.finished; });
			const me = room.players.find(p => p.id === this.myId);
			const planning = room.phase === "planning";
			this.set({ room, roundDeadline: room.phase === "playing" ? room.roundDeadline : null, waitingCleared: room.phase === "playing" && !!(me && me.finished) && !this.state.roundResultShown });
			if (planning && !this.state.roundResultShown) { this.session.setIdle(!this.state.search); if (this.isBattle()) this.setCoveredBoard(); }
		});
		socket.on("start_game", (d) => {
			sound.unlock();
			this.set({ roundResultShown: false, roundLive: false, frozenUntil: 0, roundResult: null, roundEndLeft: null, waitingCleared: false, gameProgress: formatGameProgress(d.gameNumber, d.gameCount, (this.state.room && this.state.room.scoreTarget) || d.scoreTarget) });
			this.lastFinished = {};
			if (d.boardData && d.boardMask) {
				const rows = d.rows || this.session.rows, cols = d.cols || this.session.cols;
				this.session.setBoard(rows, cols, makeBoardDecoder(d.boardData, d.boardMask, cols), null);
			}
			this.setCoveredBoard();
			this.session.focusedR = Math.floor(this.session.rows / 2); this.session.focusedC = Math.floor(this.session.cols / 2);
			// The 3-2-1 is spelled out on every board in view, the opponents' mirrors included.
			countDown(this.session, d.startDelayMs || 0, () => this.localRoundStartReveal(), { sound, onDigit: (n) => { const at = performance.now(); this.session.startCountdownGlyph(n, at); this.opponentSessions.forEach(o => o.startCountdownGlyph(n, at)); } });
		});
		socket.on("draw_board", (d) => {
			if (this.state.search) return;
			const frames: GameFrame[] = d.games || [];
			const me = frames[0];
			if (me && this.session.state && me.state) {
				// Keep the local prediction ahead of the server: never un-reveal, keep our flags.
				const s = this.session.state;
				for (let r = 0; r < s.length; r++) for (let c = 0; c < s[r].length; c++) {
					if (s[r][c] === KNOWN && me.state[r][c] !== KNOWN) me.state[r][c] = KNOWN;
					else if (s[r][c] === -2 && me.state[r][c] === UNKNOWN) me.state[r][c] = -2;
					else if (s[r][c] === UNKNOWN && me.state[r][c] === -2) me.state[r][c] = UNKNOWN;
				}
				if (!this.pendingReveal) this.session.applyServerState(me.state);
				if (me.finished && me.totalSafe > 0 && (me.safeCount || 0) >= me.totalSafe) this.reportClear();
			}
			this.set({ frames });
		});
		socket.on("game_result", (d) => {
			const left = this.state.roundDeadline ? Math.max(0, Math.round((this.state.roundDeadline - Date.now()) / 1000)) : 0;
			this.set({ roundResultShown: true, frozenUntil: 0, roundDeadline: null, roundEndLeft: left, roundResult: { winnerId: d.winnerId, standings: d.standings || [] } });
			const room = this.state.room, target = (room && room.scoreTarget) || d.scoreTarget;
			const seriesOver = target ? !!(room && room.players.some(p => (p.score || 0) >= target)) : d.gameNumber >= d.gameCount;
			if (!seriesOver) (d.winnerId === this.myId ? sound.win : sound.lose)();
		});
		socket.on("mine_hit", (d) => {
			const sec = (d && d.penaltySeconds) || (this.state.room && this.state.room.deathPenalty) || 0;
			this.session.freeze(sec * 1000);
		});
		socket.on("series_ended", (d: SeriesResult) => {
			this.set({ gameProgress: "", roundDeadline: null });
			(d.winnerId === this.myId ? sound.seriesWin : sound.lose)();
			setTimeout(() => { if (this.state.inRoom) this.set({ seriesResult: d }); }, 1200);
			getSocket().emit("get_match_history");
		});
		socket.on("match_reveal", () => { this.setCoveredBoard(); sound.matchFound(); });
		socket.on("opp_cursor", (d) => { const s = d && this.opponentSessions.get(d.id); if (s) s.setMirrorFocus(d.r, d.c, typeof d.eta === "number" ? d.eta : undefined); });
		socket.on("left_room", (d) => {
			if (d && typeof d.rating === "number") this.onRatingKnown(d.rating, d.ratingDelta, d.provisional);
			if (this.state.search) return;
			this.teardown();
		});
		socket.on("move_resync_needed", (d) => {
			if (!this.state.room) return;
			const fromSeq = (d && d.fromSeq) || 0;
			const missing = this.moveLog.filter(m => m.seq > fromSeq);
			if (!missing.length) return;
			activeSocket().emit("resync_moves", this.withSync({ id: this.myId, moves: missing.map(m => ({ r: m.r, c: m.c, flag: m.flag })) }));
		});
		setInterval(() => {
			if (this.session.hooks.mode() !== "multiplayer" || !this.state.room || !this.moveLog.length) return;
			activeSocket().emit("move_sync", this.withSync({ id: this.myId }));
		}, 5000);
	}

	ratingListeners = new Set<(rating: number, delta: number | undefined, provisional: boolean | undefined) => void>();
	private onRatingKnown(rating: number, delta?: number, provisional?: boolean) { this.ratingListeners.forEach(cb => cb(rating, delta, provisional)); }

	// ---- actions ----
	findRanked(mode: string) {
		this.set({ search: { mode, size: rankedModeSize(mode), members: [] }, room: null, inRoom: false, mode, roundResultShown: false, roundLive: false, seriesResult: null, roundResult: null, frames: null, gameProgress: "", waitingCleared: false });
		this.session.rows = 16; this.session.cols = 20; // ranked race boards are the medium preset
		this.session.setBoard(16, 20, () => 0, null);
		this.session.idleSuppressed = false;
		this.session.setIdle(true);
		getSocket().emit("find_ranked", { mode });
		// The server answers a queue request at once; silence means it was refused or never arrived.
		if (this.searchAckTimer) clearTimeout(this.searchAckTimer);
		this.searchAckTimer = window.setTimeout(() => { this.searchAckTimer = null; if (this.state.search && !this.state.inRoom) this.failSearch("Couldn't join the matchmaking queue. Please try again."); }, 5000);
	}
	// A refused or unanswered search: back to the lobby with a visible reason instead of an endless 0/2.
	private failSearch(reason: string) {
		if (this.searchAckTimer) { clearTimeout(this.searchAckTimer); this.searchAckTimer = null; }
		getSocket().emit("cancel_ranked");
		this.teardown();
		pushToast({ icon: "⚠️", label: "Ranked", name: reason, complete: false });
	}
	requestRoomList() { getSocket().emit("list_rooms"); }
	createRoom(opts: CreateRoomOptions) { getSocket().emit("create_room", opts); }
	joinRoom(roomId: number) { getSocket().emit("join_room", { roomId }); }
	cancelSearch() { if (this.searchAckTimer) { clearTimeout(this.searchAckTimer); this.searchAckTimer = null; } getSocket().emit("cancel_ranked"); this.set({ search: null, mode: null }); this.teardown(); }
	leaveRoom() { activeSocket().emit("leave_room"); this.teardown(); }
	playAnother() { const mode = this.state.mode || "sprint_duo"; activeSocket().emit("leave_room"); this.dropMatchSocket(); this.findRanked(mode); }
	dismissSeriesResult() { this.set({ seriesResult: null }); }
	ready() { activeSocket().emit("ready"); }
	flash(message: string) { this.set({ message }); setTimeout(() => { if (this.state.message === message) this.set({ message: null }); }, 4000); }
	teardown() {
		this.dropMatchSocket();
		cancelCountdown();
		this.session.idleSuppressed = false;
		this.session.setIdle(false);
		this.session.clear();
		this.set({ inRoom: false, room: null, search: null, roundLive: false, roundResultShown: false, roundDeadline: null, gameProgress: "", frames: null, seriesResult: null, roundResult: null, frozenUntil: 0, waitingCleared: false });
	}

	// ---- round helpers ----
	private resetRound() { this.lastFinished = {}; this.set({ frames: null, roundLive: false }); }
	private setCoveredBoard() {
		if (!this.session.rows || !this.session.cols) return;
		this.moveSeq = 0; this.moveHash = MoveHash.SEED; this.moveLog = [];
		this.session.clearNoFlag = true; this.session.clearNoReveal = true;
		this.session.state = this.session.coveredState();
		this.session.prevState = this.session.clone(this.session.state);
		this.session.resetAnimations();
		this.pendingReveal = true;
		this.session.render();
		this.set({ frames: null });
	}
	// GO: reveal the shared opening (a cascade from the centre) locally, with the wave, and mirror the
	// same reveal onto every opponent thumbnail since everyone shares one layout per round.
	private localRoundStartReveal() {
		this.set({ roundLive: true });
		if (!this.pendingReveal) return;
		this.pendingReveal = false;
		const s = this.session;
		if (!s.rows || !s.cols || !s.state) return;
		const initial = s.coveredState();
		BoardLogic.cascadeReveal(Math.floor(s.rows / 2), Math.floor(s.cols / 2), s.rows, s.cols,
			(r: number, c: number) => initial[r][c] === UNKNOWN,
			(r: number, c: number) => { initial[r][c] = KNOWN; return s.cellAt(r, c) === MINE; },
			(r: number, c: number) => s.cellAt(r, c));
		s.queueRevealAnimations(initial);
		s.state = initial; s.prevState = s.clone(initial);
		s.render();
		// Everyone shares the layout: the opponents' mirrors open the same centre at the same moment.
		this.opponentSessions.forEach(o => { if (o.rows === s.rows && o.cols === s.cols) o.applyServerState(s.clone(initial)); });
	}
	private withSync<T extends object>(data: T): T & { seq: number; hash: number } { return { ...data, seq: this.moveSeq, hash: this.moveHash }; }
	private recordMove(r: number, c: number, flag: boolean) { this.moveSeq++; this.moveHash = MoveHash.next(this.moveHash, r, c, flag); this.moveLog.push({ seq: this.moveSeq, r, c, flag }); }
	private emitMove(r: number, c: number, asFlag: boolean, result: ActionResult | null) {
		const socket = activeSocket();
		this.recordMove(r, c, asFlag);
		socket.emit(asFlag ? "right_click" : "left_click", this.withSync({ r, c, id: this.myId }));
		if (result && result.clearedFlags) for (const [cr, cc] of result.clearedFlags) { this.recordMove(cr, cc, true); socket.emit("right_click", this.withSync({ r: cr, c: cc, id: this.myId })); }
	}
	private clearReported = false;
	private reportClear() {
		if (this.clearReported) return; this.clearReported = true;
		activeSocket().emit("record_clear", { noFlag: this.session.clearNoFlag, noReveal: this.session.clearNoReveal });
		setTimeout(() => { this.clearReported = false; }, 2000);
	}
}

export function formatGameProgress(gameNumber: number, gameCount: number, scoreTarget?: number | null): string {
	if (scoreTarget) return "Game " + gameNumber + " · first to " + scoreTarget;
	return "Game " + gameNumber + " of " + gameCount;
}
export const MODE_LABELS: Record<string, string> = { sprint_duo: "1v1 Sprint", sprint_six: "7-player Sprint", standard_duo: "1v1 Standard", standard_six: "7-player Standard" };
export const STYLE_LABELS: Record<string, string> = { sprint: "Sprint", standard: "Standard" };

export const match = new MatchStore();
if (import.meta.env.DEV) (window as any).__match = match;
export function useMatch(): MatchState { return useSyncExternalStore(match.subscribe, match.getSnapshot); }
