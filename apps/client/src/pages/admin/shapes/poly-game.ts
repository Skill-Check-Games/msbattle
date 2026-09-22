// A minesweeper that knows nothing about rows and columns: it plays on any neighbour graph, so the
// same code runs the triangle, pentagon, heptagon and Voronoi boards in the shape playground.
// Local only, nothing here talks to the server.
//
// The solver is the generic version of what the real game's CSPSolver does on a square grid: trivial
// counting, the subset rule between two overlapping clues, and a bounded enumeration of each frontier
// component for everything those two miss. It is what makes the no-guess boards no-guess, and what
// the Hint and Auto-solve buttons run.

import { Rng } from "./tilings";

export const COVERED = 0, REVEALED = 1, FLAGGED = 2;

const MAX_ENUM_CELLS = 16;      // a frontier component bigger than this is left to the other rules
const ENUM_NODE_BUDGET = 60000; // per component, so a nasty one can't freeze the tab

export interface SolveView {
	n: number;
	neighbors: number[][];
	counts: Int8Array;
	revealed: Uint8Array;
	known: Uint8Array;     // cells already deduced as mines
	minesLeft: number;
	coveredLeft: number;   // covered and not settled either way: what the enumeration may still place mines in
}

// One pass's working state: what the pass has settled so far, on top of the view it started from.
interface Working { known: Uint8Array; safe: Uint8Array; minesLeft: number; coveredLeft: number; }

export interface Deduction { safe: number[]; mines: number[]; }

interface Constraint { cells: number[]; mines: number; }

function constraintsFor(v: SolveView, w: Working): Constraint[] {
	const out: Constraint[] = [];
	for (let i = 0; i < v.n; i++) {
		if (!v.revealed[i]) continue;
		let mines = v.counts[i];
		const cells: number[] = [];
		for (const j of v.neighbors[i]) {
			if (v.revealed[j] || w.safe[j]) continue;   // a cell already settled carries no information
			if (w.known[j]) mines--; else cells.push(j);
		}
		if (cells.length) out.push({ cells, mines });
	}
	return out;
}

// Trivial counting plus the subset rule: if one clue's cells sit inside another's, the difference is
// a clue of its own.
function ruleSweep(cons: Constraint[], safe: Set<number>, mines: Set<number>) {
	const apply = (c: Constraint) => {
		if (c.mines === 0) for (const x of c.cells) safe.add(x);
		else if (c.mines === c.cells.length) for (const x of c.cells) mines.add(x);
	};
	for (const c of cons) apply(c);
	for (let a = 0; a < cons.length; a++) for (let b = 0; b < cons.length; b++) {
		if (a === b) continue;
		const A = cons[a], B = cons[b];
		if (A.cells.length >= B.cells.length) continue;
		let inside = true;
		for (const x of A.cells) if (B.cells.indexOf(x) < 0) { inside = false; break; }
		if (!inside) continue;
		apply({ cells: B.cells.filter(x => A.cells.indexOf(x) < 0), mines: B.mines - A.mines });
	}
}

// Every mine layout the clues allow, for one clump of cells. Cells that are a mine in all of them are
// forced mines; cells that are a mine in none are forced safe. Bails out on a clump that is too big.
function enumerate(cells: number[], cons: Constraint[], total: number | null, safe: Set<number>, mines: Set<number>) {
	const k = cells.length;
	if (k === 0 || k > MAX_ENUM_CELLS) return;
	const slot = new Map<number, number>();
	cells.forEach((c, i) => slot.set(c, i));
	const conCells = cons.map(c => c.cells.map(x => slot.get(x)!));
	const conMines = cons.map(c => c.mines);
	const touching: number[][] = cells.map(() => []);
	conCells.forEach((cc, ci) => cc.forEach(i => touching[i].push(ci)));
	const assign = new Int8Array(k).fill(-1);
	const hits = new Int32Array(k);
	let solutions = 0, budget = ENUM_NODE_BUDGET, aborted = false;

	const feasible = (i: number): boolean => {
		for (const ci of touching[i]) {
			let sum = 0, open = 0;
			for (const j of conCells[ci]) { if (assign[j] === 1) sum++; else if (assign[j] === -1) open++; }
			if (sum > conMines[ci]) return false;
			if (sum + open < conMines[ci]) return false;
		}
		return true;
	};
	const rec = (i: number, placed: number) => {
		if (aborted) return;
		if (budget-- <= 0) { aborted = true; return; }
		if (total != null && placed > total) return;
		if (i === k) {
			if (total != null && placed !== total) return;
			solutions++;
			for (let j = 0; j < k; j++) if (assign[j] === 1) hits[j]++;
			return;
		}
		for (let v = 0; v <= 1; v++) {
			assign[i] = v as any;
			if (feasible(i)) rec(i + 1, placed + v);
			assign[i] = -1;
		}
	};
	rec(0, 0);
	if (aborted || solutions === 0) return;
	for (let i = 0; i < k; i++) {
		if (hits[i] === 0) safe.add(cells[i]);
		else if (hits[i] === solutions) mines.add(cells[i]);
	}
}

// Everything the position forces, in one call: the rules run, the mines they prove get folded back
// into what is known, and the rules run again until nothing new comes out. Keeping this a closure
// (rather than one pass) is what makes the in-game Hint and Auto-solve exactly as strong as the
// generator's own simulation, so a board it certified never stalls on the player.
export function deduce(v: SolveView): Deduction {
	const w: Working = { known: Uint8Array.from(v.known), safe: new Uint8Array(v.n), minesLeft: v.minesLeft, coveredLeft: v.coveredLeft };
	const safe = new Set<number>(), mines = new Set<number>();
	for (let pass = 0; pass < 100; pass++) {
		const step = deduceOnce(v, w);
		let fresh = 0;
		for (const i of step.mines) if (!w.known[i] && !v.revealed[i]) { w.known[i] = 1; w.minesLeft--; w.coveredLeft--; mines.add(i); fresh++; }
		for (const i of step.safe) if (!w.safe[i] && !v.revealed[i]) { w.safe[i] = 1; w.coveredLeft--; safe.add(i); fresh++; }
		if (!fresh) break;
	}
	return { safe: [...safe], mines: [...mines] };
}

function deduceOnce(v: SolveView, w: Working): Deduction {
	const safe = new Set<number>(), mines = new Set<number>();
	const cons = constraintsFor(v, w);
	ruleSweep(cons, safe, mines);

	const loose = (i: number) => !v.revealed[i] && !w.known[i] && !w.safe[i];
	if (w.minesLeft === 0) {                 // nothing left to find: everything still covered is safe
		for (let i = 0; i < v.n; i++) if (loose(i)) safe.add(i);
	} else if (w.minesLeft === w.coveredLeft) {
		for (let i = 0; i < v.n; i++) if (loose(i)) mines.add(i);
	}

	if (!safe.size && !mines.size && cons.length) {
		// Split the frontier into clumps of cells that share a clue, then enumerate each clump.
		const parent = new Map<number, number>();
		const find = (x: number): number => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; while (parent.get(x) !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; } return r; };
		for (const c of cons) for (const x of c.cells) if (!parent.has(x)) parent.set(x, x);
		for (const c of cons) for (let i = 1; i < c.cells.length; i++) {
			const a = find(c.cells[0]), b = find(c.cells[i]);
			if (a !== b) parent.set(a, b);
		}
		const groups = new Map<number, number[]>();
		parent.forEach((_, x) => { const r = find(x); const g = groups.get(r); if (g) g.push(x); else groups.set(r, [x]); });
		groups.forEach(cells => {
			const set = new Set(cells);
			enumerate(cells, cons.filter(c => set.has(c.cells[0])), null, safe, mines);
		});
	}

	// Endgame: few enough cells left that the mine counter itself is a clue, so enumerate the lot.
	if (!safe.size && !mines.size && w.coveredLeft > 0 && w.coveredLeft <= MAX_ENUM_CELLS) {
		const cells: number[] = [];
		for (let i = 0; i < v.n; i++) if (loose(i)) cells.push(i);
		const set = new Set(cells);
		enumerate(cells, cons.filter(c => c.cells.every(x => set.has(x))), w.minesLeft, safe, mines);
	}
	return { safe: [...safe], mines: [...mines] };
}

// ---- the board ----

export class PolyGame {
	n: number;
	neighbors: number[][];
	mines: Uint8Array;
	counts: Int8Array;
	state: Uint8Array;
	mineCount = 0;
	flags = 0;
	revealedCount = 0;
	dead = false;
	won = false;
	explodedAt = -1;
	startedAt = 0;
	endedAt = 0;

	constructor(neighbors: number[][], mines: Uint8Array) {
		this.n = neighbors.length;
		this.neighbors = neighbors;
		this.mines = mines;
		this.state = new Uint8Array(this.n);
		this.counts = countsFor(neighbors, mines);
		for (let i = 0; i < this.n; i++) if (mines[i]) this.mineCount++;
	}

	get flagsLeft(): number { return this.mineCount - this.flags; }
	get over(): boolean { return this.dead || this.won; }
	get elapsedMs(): number { return this.startedAt ? (this.endedAt || Date.now()) - this.startedAt : 0; }

	private start() { if (!this.startedAt) this.startedAt = Date.now(); }

	reveal(i: number): boolean {
		if (this.over || this.state[i] !== COVERED) return false;
		this.start();
		if (this.mines[i]) {
			this.state[i] = REVEALED;
			this.dead = true; this.explodedAt = i; this.endedAt = Date.now();
			return true;
		}
		this.flood(i);
		this.checkWin();
		return true;
	}

	// The opening the board is generated around, revealed before the clock starts.
	open(i: number) {
		this.flood(i);
		this.checkWin();
	}

	private flood(start: number) {
		const queue = [start];
		while (queue.length) {
			const i = queue.pop()!;
			if (this.state[i] === REVEALED) continue;
			if (this.state[i] === FLAGGED) { this.flags--; }
			this.state[i] = REVEALED;
			this.revealedCount++;
			if (this.counts[i] === 0) for (const j of this.neighbors[i]) if (this.state[j] !== REVEALED && !this.mines[j]) queue.push(j);
		}
	}

	toggleFlag(i: number): boolean {
		if (this.over || this.state[i] === REVEALED) return false;
		this.start();
		if (this.state[i] === FLAGGED) { this.state[i] = COVERED; this.flags--; }
		else { this.state[i] = FLAGGED; this.flags++; }
		return true;
	}

	// Clicking a number whose flags add up opens everything else around it.
	chord(i: number): boolean {
		if (this.over || this.state[i] !== REVEALED || this.counts[i] <= 0) return false;
		let flagged = 0;
		const open: number[] = [];
		for (const j of this.neighbors[i]) {
			if (this.state[j] === FLAGGED) flagged++;
			else if (this.state[j] === COVERED) open.push(j);
		}
		if (flagged !== this.counts[i] || !open.length) return false;
		for (const j of open) {
			if (this.mines[j]) { this.state[j] = REVEALED; this.dead = true; this.explodedAt = j; this.endedAt = Date.now(); return true; }
			this.flood(j);
		}
		this.checkWin();
		return true;
	}

	private checkWin() {
		if (this.revealedCount === this.n - this.mineCount) { this.won = true; this.endedAt = Date.now(); }
	}

	// What the solver sees: flags are ignored, since a wrong flag would poison the deduction.
	view(): SolveView {
		const known = new Uint8Array(this.n);
		const revealed = new Uint8Array(this.n);
		let covered = 0;
		for (let i = 0; i < this.n; i++) {
			if (this.state[i] === REVEALED) revealed[i] = 1; else covered++;
		}
		return { n: this.n, neighbors: this.neighbors, counts: this.counts, revealed, known, minesLeft: this.mineCount, coveredLeft: covered };
	}
}

export function countsFor(neighbors: number[][], mines: Uint8Array): Int8Array {
	const counts = new Int8Array(neighbors.length);
	for (let i = 0; i < neighbors.length; i++) {
		let c = 0;
		for (const j of neighbors[i]) if (mines[j]) c++;
		counts[i] = c;
	}
	return counts;
}

// ---- generation ----

interface SimResult { solved: boolean; frontier: number[]; covered: number[]; }

// Play the board out with nothing but deduction, from the opening. No guessing allowed: the moment
// the solver runs dry with cells still covered, the layout has a coin flip in it somewhere.
function simulate(neighbors: number[][], mines: Uint8Array, counts: Int8Array, start: number, mineCount: number): SimResult {
	const n = neighbors.length;
	const revealed = new Uint8Array(n), known = new Uint8Array(n);
	let revealedCount = 0, minesLeft = mineCount, coveredLeft = n;
	const flood = (from: number) => {
		const queue = [from];
		while (queue.length) {
			const i = queue.pop()!;
			if (revealed[i]) continue;
			revealed[i] = 1; revealedCount++; coveredLeft--;
			if (counts[i] === 0) for (const j of neighbors[i]) if (!revealed[j] && !mines[j]) queue.push(j);
		}
	};
	flood(start);
	for (;;) {
		if (revealedCount === n - mineCount) return { solved: true, frontier: [], covered: [] };
		const d = deduce({ n, neighbors, counts, revealed, known, minesLeft, coveredLeft });
		if (!d.safe.length && !d.mines.length) {
			const frontier: number[] = [], covered: number[] = [];
			for (let i = 0; i < n; i++) {
				if (revealed[i] || known[i]) continue;
				covered.push(i);
				if (neighbors[i].some(j => revealed[j])) frontier.push(i);
			}
			return { solved: false, frontier, covered };
		}
		for (const i of d.mines) if (!known[i] && !revealed[i]) { known[i] = 1; minesLeft--; coveredLeft--; }
		for (const i of d.safe) if (!revealed[i]) flood(i);
	}
}

export interface GenResult { mines: Uint8Array; noGuess: boolean; attempts: number; ms: number; }

// Mines everywhere except the opening and its neighbours, so the first cell always cascades.
function scatter(n: number, mineCount: number, banned: Uint8Array, rng: Rng): Uint8Array {
	const pool: number[] = [];
	for (let i = 0; i < n; i++) if (!banned[i]) pool.push(i);
	for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
	const mines = new Uint8Array(n);
	for (let i = 0; i < mineCount && i < pool.length; i++) mines[pool[i]] = 1;
	return mines;
}

// No-guess boards by repair, not by luck: play the layout out, and when the solver stalls, move one
// mine out of the stuck frontier (or into it) and play it again. Re-rolling from scratch every time
// almost never lands a solvable board at these densities; nudging the spot that actually stalled does.
export function generateBoard(neighbors: number[][], mineCount: number, start: number, opts: { noGuess: boolean; rng: Rng; budgetMs?: number }): GenResult {
	const n = neighbors.length;
	const rng = opts.rng;
	const banned = new Uint8Array(n);
	banned[start] = 1;
	for (const j of neighbors[start]) banned[j] = 1;
	const room = n - neighbors[start].length - 1;
	mineCount = Math.max(1, Math.min(mineCount, room - 1));
	let mines = scatter(n, mineCount, banned, rng);
	const t0 = performance.now();
	if (!opts.noGuess) return { mines, noGuess: false, attempts: 1, ms: 0 };

	const deadline = t0 + (opts.budgetMs || 2000);
	const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
	let attempts = 0, sinceReroll = 0;
	while (attempts < 3000) {
		attempts++; sinceReroll++;
		const counts = countsFor(neighbors, mines);
		const sim = simulate(neighbors, mines, counts, start, mineCount);
		if (sim.solved) return { mines, noGuess: true, attempts, ms: performance.now() - t0 };
		if (performance.now() > deadline) break;
		if (sinceReroll > 120) { mines = scatter(n, mineCount, banned, rng); sinceReroll = 0; continue; }
		const frontierMines = sim.frontier.filter(i => mines[i]);
		const outside = sim.covered.filter(i => !banned[i] && sim.frontier.indexOf(i) < 0);
		const outsideFree = outside.filter(i => !mines[i]);
		const outsideMines = outside.filter(i => mines[i]);
		const frontierFree = sim.frontier.filter(i => !mines[i] && !banned[i]);
		if (frontierMines.length && outsideFree.length && (rng() < 0.75 || !outsideMines.length || !frontierFree.length)) {
			mines[pick(frontierMines)] = 0; mines[pick(outsideFree)] = 1;
		} else if (outsideMines.length && frontierFree.length) {
			mines[pick(outsideMines)] = 0; mines[pick(frontierFree)] = 1;
		} else {
			mines = scatter(n, mineCount, banned, rng); sinceReroll = 0;
		}
	}
	return { mines, noGuess: false, attempts, ms: performance.now() - t0 };
}

// The cell nearest the middle of the board: every board opens there, the way a ranked round does.
export function centerCell(centroids: [number, number][], width: number, height: number): number {
	let best = 0, bestD = Infinity;
	for (let i = 0; i < centroids.length; i++) {
		const dx = centroids[i][0] - width / 2, dy = centroids[i][1] - height / 2;
		const d = dx * dx + dy * dy;
		if (d < bestD) { bestD = d; best = i; }
	}
	return best;
}
