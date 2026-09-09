// Replay input-log decoder + re-simulation (mirror of runtime/replay.js and GameCreator's click logic).
// The wire payload is the gunzipped binary; events are cumulative-time clicks per player per round.
import BoardLogic from "core/src/common/BoardLogic.js";
import { MINE, UNKNOWN, KNOWN, FLAGGED } from "../../game/board-render";

class Reader {
	pos = 0;
	constructor(private b: Uint8Array) {}
	u8() { return this.b[this.pos++]; }
	varint() { let x = 0, s = 0, byte: number; do { byte = this.b[this.pos++]; x |= (byte & 0x7f) << s; s += 7; } while (byte & 0x80); return x >>> 0; }
	str() { const n = this.varint(); const slice = this.b.subarray(this.pos, this.pos + n); this.pos += n; try { return new TextDecoder("utf-8").decode(slice); } catch { let s = ""; for (let i = 0; i < slice.length; i++) s += String.fromCharCode(slice[i]); return s; } }
	bits(n: number) { const out = this.b.subarray(this.pos, this.pos + n); this.pos += n; return out; }
}

export interface ReplayPlayer { name: string; userId: number | null; skin: string | null; avatar: string | null; country: string | null; }
export interface ReplayEvent { ct: number; cell: number; button: number; }
export interface ReplayRound { startR: number; startC: number; mines: Uint8Array; known: Uint8Array; tracks: ReplayEvent[][]; }
export interface Replay { version: number; rows: number; cols: number; mineCount: number; gameCount: number; style: string; mode: string; players: ReplayPlayer[]; rounds: ReplayRound[]; }

export function decodeReplay(u8: Uint8Array): Replay {
	const rd = new Reader(u8);
	if (rd.u8() !== 0x4d || rd.u8() !== 0x52) throw new Error("bad replay magic");
	const version = rd.u8(); rd.u8();
	const rows = rd.varint(), cols = rd.varint(), mineCount = rd.varint(), gameCount = rd.varint();
	const style = rd.str(), mode = rd.str();
	const pc = rd.varint(), players: ReplayPlayer[] = [];
	for (let p = 0; p < pc; p++) {
		const name = rd.str(); rd.u8(); // bot flag byte: consumed, never surfaced (hidden information)
		const userId = rd.varint() || null;
		const skin = version >= 2 ? (rd.str() || null) : null;
		let avatar: string | null = null, country: string | null = null;
		if (version >= 3) { avatar = rd.str() || null; country = rd.str() || null; }
		players.push({ name, userId, skin, avatar, country });
	}
	const bitLen = Math.ceil((rows * cols) / 8), rounds: ReplayRound[] = [];
	for (let g = 0; g < gameCount; g++) {
		const startR = rd.varint(), startC = rd.varint();
		const mines = rd.bits(bitLen).slice(), known = rd.bits(bitLen).slice();
		const tracks: ReplayEvent[][] = [];
		for (let pi = 0; pi < pc; pi++) {
			const ec = rd.varint(); let ct = 0; const evs: ReplayEvent[] = [];
			for (let e = 0; e < ec; e++) { ct += rd.varint(); const packed = rd.varint(); evs.push({ ct, cell: packed >>> 1, button: packed & 1 }); }
			tracks.push(evs);
		}
		rounds.push({ startR, startC, mines, known, tracks });
	}
	return { version, rows, cols, mineCount, gameCount, style, mode, players, rounds };
}

const bitSet = (bits: Uint8Array, idx: number) => (bits[idx >> 3] >> (idx & 7)) & 1;

export interface RoundModel { R: number; C: number; mines: boolean[][]; clue: number[][]; cellAt: (r: number, c: number) => number; freshState: () => number[][]; }
export function buildRoundModel(rep: Replay, round: ReplayRound): RoundModel {
	const R = rep.rows, C = rep.cols, mines: boolean[][] = [];
	for (let r = 0; r < R; r++) { mines[r] = []; for (let c = 0; c < C; c++) mines[r][c] = !!bitSet(round.mines, r * C + c); }
	const clue: number[][] = BoardLogic.buildClueGrid(R, C, (r: number, c: number) => mines[r][c]);
	return {
		R, C, mines, clue, cellAt: (r, c) => mines[r][c] ? MINE : clue[r][c],
		freshState: () => { const s: number[][] = []; for (let r = 0; r < R; r++) { s[r] = []; for (let c = 0; c < C; c++) s[r][c] = bitSet(round.known, r * C + c) ? KNOWN : UNKNOWN; } return s; }
	};
}

// One player's board after applying their events up to cumulative time T.
export function stateAt(model: RoundModel, events: ReplayEvent[], T: number): { state: number[][]; applied: number } {
	const s = model.freshState(), { R, C, mines, clue } = model;
	const dfs = (r: number, c: number) => BoardLogic.cascadeReveal(r, c, R, C,
		(rr: number, cc: number) => s[rr][cc] === UNKNOWN || s[rr][cc] === FLAGGED,
		(rr: number, cc: number) => { s[rr][cc] = KNOWN; return false; },
		(rr: number, cc: number) => mines[rr][cc] ? -1 : clue[rr][cc]);
	const chord = (r: number, c: number) => {
		const ctx = BoardLogic.chordContext(r, c, R, C, (rr: number, cc: number) => s[rr][cc] === FLAGGED, (rr: number, cc: number) => s[rr][cc] === KNOWN && mines[rr][cc], (rr: number, cc: number) => s[rr][cc] === UNKNOWN);
		if (ctx.flagCount === clue[r][c]) for (const cell of ctx.covered) dfs(cell[0], cell[1]);
	};
	let applied = 0;
	for (const ev of events) {
		if (ev.ct > T) break;
		applied++;
		const r = (ev.cell / C) | 0, c = ev.cell % C;
		if (ev.button === 0) { if (s[r][c] === UNKNOWN) dfs(r, c); else if (s[r][c] === KNOWN) chord(r, c); }
		else { if (s[r][c] === UNKNOWN) s[r][c] = FLAGGED; else if (s[r][c] === FLAGGED) s[r][c] = UNKNOWN; else if (s[r][c] === KNOWN) chord(r, c); }
	}
	return { state: s, applied };
}

export function roundDuration(round: ReplayRound): number {
	let max = 0; for (const t of round.tracks) if (t.length) max = Math.max(max, t[t.length - 1].ct); return max;
}
