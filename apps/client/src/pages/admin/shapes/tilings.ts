// Cell geometries for the shape playground (/admin/shapes). Each generator returns raw polygons in
// abstract units (one cell is roughly one unit across); buildTiling turns a pile of polygons into a
// playable board: a bounding box, a centroid and a glyph radius per cell, and the neighbour graph.
//
// The neighbour graph is derived from shared corners, so no generator has to spell its own adjacency
// out: two cells that share two or more corners touch along an edge, two that share exactly one are
// diagonal neighbours (a square grid's 8 neighbours, a triangle grid's 12). The odd one out is the
// Voronoi mix, whose corners are computed per cell and so never match bit for bit; it hands in its
// own edge list instead.
//
// Note on the 7- and 8-sided tilings: no convex heptagon or octagon tiles the plane (a convex tile
// tops out at six sides), so those two wave their sides in and out — a bump on one cell is the dent
// on its neighbour. The shapes are real 7- and 8-gons; they just aren't convex.

export type Pt = [number, number];

export interface Tiling {
	polys: Pt[][];
	edgeNeighbors: number[][];      // cells sharing a side
	cornerNeighbors: number[][];    // cells meeting at a single corner only
	centroids: Pt[];
	radius: number[];               // centroid to the nearest side: what a digit or mine is sized to
	sides: number[];
	width: number;
	height: number;
}

export type Rng = () => number;

const SQ3 = Math.sqrt(3);
const VERTEX_EPS = 0.01;   // corners closer than this are the same corner (cells are ~1 unit across)

// A seeded RNG so a board can be reproduced from its seed (mulberry32).
export function makeRng(seed: number): Rng {
	let a = (seed >>> 0) || 1;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---- geometry helpers ----

function polyCentroid(p: Pt[]): Pt {
	let a = 0, cx = 0, cy = 0;
	for (let i = 0; i < p.length; i++) {
		const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
		const f = x0 * y1 - x1 * y0;
		a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
	}
	if (Math.abs(a) < 1e-12) {   // degenerate: fall back to the average corner
		let sx = 0, sy = 0;
		for (const [x, y] of p) { sx += x; sy += y; }
		return [sx / p.length, sy / p.length];
	}
	return [cx / (3 * a), cy / (3 * a)];
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax, dy = by - ay;
	const len = dx * dx + dy * dy;
	let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	const qx = ax + t * dx - px, qy = ay + t * dy - py;
	return Math.sqrt(qx * qx + qy * qy);
}

function inradius(p: Pt[], c: Pt): number {
	let min = Infinity;
	for (let i = 0; i < p.length; i++) {
		const a = p[i], b = p[(i + 1) % p.length];
		const d = segDist(c[0], c[1], a[0], a[1], b[0], b[1]);
		if (d < min) min = d;
	}
	return min;
}

export function pointInPoly(p: Pt[], x: number, y: number): boolean {
	let inside = false;
	for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
		const [xi, yi] = p[i], [xj, yj] = p[j];
		if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

// ---- assembly ----

function neighborsFromCorners(polys: Pt[][]): { edge: number[][]; corner: number[][] } {
	const n = polys.length;
	const buckets = new Map<string, number[]>();
	const canon: Pt[] = [];
	const owners: number[][] = [];
	for (let i = 0; i < n; i++) {
		for (const [x, y] of polys[i]) {
			const gx = Math.floor(x / VERTEX_EPS), gy = Math.floor(y / VERTEX_EPS);
			let hit = -1;
			for (let dx = -1; dx <= 1 && hit < 0; dx++) for (let dy = -1; dy <= 1 && hit < 0; dy++) {
				const list = buckets.get((gx + dx) + ":" + (gy + dy));
				if (!list) continue;
				for (const id of list) {
					const c = canon[id];
					if (Math.abs(c[0] - x) < VERTEX_EPS && Math.abs(c[1] - y) < VERTEX_EPS) { hit = id; break; }
				}
			}
			if (hit < 0) {
				hit = canon.length; canon.push([x, y]); owners.push([]);
				const k = gx + ":" + gy;
				const list = buckets.get(k);
				if (list) list.push(hit); else buckets.set(k, [hit]);
			}
			const own = owners[hit];
			if (own[own.length - 1] !== i) own.push(i);   // cells are walked in order, so this dedupes
		}
	}
	const shared = new Map<number, number>();
	for (const own of owners) {
		for (let a = 0; a < own.length; a++) for (let b = a + 1; b < own.length; b++) {
			const key = own[a] * n + own[b];
			shared.set(key, (shared.get(key) || 0) + 1);
		}
	}
	const edge: number[][] = [], corner: number[][] = [];
	for (let i = 0; i < n; i++) { edge.push([]); corner.push([]); }
	shared.forEach((count, key) => {
		const i = Math.floor(key / n), j = key % n;
		const into = count >= 2 ? edge : corner;
		into[i].push(j); into[j].push(i);
	});
	return { edge, corner };
}

function buildTiling(raw: Pt[][], explicitEdges?: number[][]): Tiling {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of raw) for (const [x, y] of p) {
		if (x < minX) minX = x; if (x > maxX) maxX = x;
		if (y < minY) minY = y; if (y > maxY) maxY = y;
	}
	const polys: Pt[][] = raw.map(p => p.map(([x, y]) => [x - minX, y - minY] as Pt));
	const centroids = polys.map(polyCentroid);
	const radius = polys.map((p, i) => inradius(p, centroids[i]));
	const nb = explicitEdges ? { edge: explicitEdges, corner: polys.map(() => [] as number[]) } : neighborsFromCorners(polys);
	return {
		polys, edgeNeighbors: nb.edge, cornerNeighbors: nb.corner, centroids, radius,
		sides: polys.map(p => p.length), width: maxX - minX, height: maxY - minY
	};
}

// rows and cols that land near `target` cells on a landscape board, given one cell's advance in x and y.
function gridFor(target: number, cellW: number, cellH: number, aspect = 1.4): [number, number] {
	const rows = Math.max(3, Math.round(Math.sqrt((target * cellW) / (aspect * cellH))));
	return [rows, Math.max(3, Math.round(target / rows))];
}

// ---- the tilings ----

function squares(target: number): Pt[][] {
	const [rows, cols] = gridFor(target, 1, 1);
	const out: Pt[][] = [];
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]]);
	return out;
}

// Equilateral triangles, every other one pointing down, so a row interlocks with the row above it.
function triangles(target: number): Pt[][] {
	const h = SQ3 / 2;
	const [rows, cols] = gridFor(target, 0.5, h);
	const out: Pt[][] = [];
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
		const x = c / 2;
		out.push((r + c) % 2 === 0
			? [[x, (r + 1) * h], [x + 1, (r + 1) * h], [x + 0.5, r * h]]
			: [[x, r * h], [x + 1, r * h], [x + 0.5, (r + 1) * h]]);
	}
	return out;
}

function hexCorners(cx: number, cy: number): Pt[] {
	const v: Pt[] = [];
	for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; v.push([cx + Math.sin(a), cy - Math.cos(a)]); }
	return v;   // 0 is the top corner, going clockwise
}

function hexagons(target: number): Pt[][] {
	const [rows, cols] = gridFor(target, SQ3, 1.5);
	const out: Pt[][] = [];
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(hexCorners((c + (r & 1) * 0.5) * SQ3, r * 1.5));
	return out;
}

// The Cairo pentagonal tiling. Four pentagons pinwheel around every other lattice point: each one
// has two right angles (at the two points where four pentagons meet), three 120 degree corners, four
// equal sides and a shorter base. t is the one free parameter, set to the value that makes those
// corners exactly 120 degrees.
function cairo(target: number): Pt[][] {
	const t = 1 / (2 * SQ3);
	const base: Pt[] = [[0, 0], [0.5 + t, 0.5 - t], [1, 1], [0.5 - t, 1.5 - t], [t - 0.5, t + 0.5]];
	// A pinwheel spans two units each way, so the loop bounds come in two short of the grid size.
	const cols = Math.max(4, Math.round(Math.sqrt(target * 1.4))) - 2;
	const rows = Math.max(4, Math.round(target / (cols + 2))) - 2;
	const turn = (p: Pt, k: number): Pt => k === 0 ? [p[0], p[1]] : k === 1 ? [-p[1], p[0]] : k === 2 ? [-p[0], -p[1]] : [p[1], -p[0]];
	const out: Pt[][] = [];
	// Four pentagons around every point with both coordinates even; the odd-odd points are where the
	// other four corners meet, and the two together are the tiling's four-pentagon corners.
	for (let j = 0; j <= rows; j += 2) for (let i = 0; i <= cols; i += 2) {
		for (let k = 0; k < 4; k++) out.push(base.map(p => { const q = turn(p, k); return [q[0] + i, q[1] + j] as Pt; }));
	}
	return out;
}

// Squares with waved sides: a side's midpoint is pushed out on one cell and so dented in on its
// neighbour. Wave all four and the tile is an octagon; leave one flat and it is a heptagon. The flat
// side has to pair up (a cell's flat right side meets its neighbour's flat left side), so the columns
// are read in twos.
function waved(target: number, sides: 7 | 8): Pt[][] {
	const [rows, cols] = gridFor(target, 1, 1);
	const d = 0.24;
	const out: Pt[][] = [];
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
		const x0 = c, y0 = r, x1 = c + 1, y1 = r + 1;
		const flatRight = sides === 7 && c % 2 === 0;
		const flatLeft = sides === 7 && c % 2 === 1;
		const p: Pt[] = [[x0, y0], [x0 + 0.5, y0 + d], [x1, y0]];
		if (!flatRight) p.push([x1 + d, y0 + 0.5]);
		p.push([x1, y1], [x0 + 0.5, y1 + d], [x0, y1]);
		if (!flatLeft) p.push([x0 + d, y0 + 0.5]);
		out.push(p);
	}
	return out;
}

// Truncated square tiling: regular octagons on a square grid with a small tilted square in every gap.
// Two shapes, and the only board here where an octagon's eight neighbours are all edge neighbours.
function octagonsAndSquares(target: number): Pt[][] {
	const [rows, cols] = gridFor(target / 2, 1, 1);
	const s = Math.SQRT2 / (2 + Math.SQRT2);   // the octagon's side when the grid pitch is 1
	const a = s / 2, q = 0.5 - a;
	const out: Pt[][] = [];
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
		const cx = c + 0.5, cy = r + 0.5;
		out.push([[cx - a, cy - 0.5], [cx + a, cy - 0.5], [cx + 0.5, cy - a], [cx + 0.5, cy + a],
			[cx + a, cy + 0.5], [cx - a, cy + 0.5], [cx - 0.5, cy + a], [cx - 0.5, cy - a]]);
	}
	for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
		const cx = c + 1, cy = r + 1;
		out.push([[cx, cy - q], [cx + q, cy], [cx, cy + q], [cx - q, cy]]);
	}
	return out;
}

// Voronoi cells around a jittered grid of points: the side count drifts from cell to cell, four to
// eight or so. With `gradient` on, the jitter ramps up left to right, so the board starts as squares
// and dissolves into irregular polygons. Adjacency is read off the finished cells: a side's midpoint
// is equidistant from exactly the two points that own it.
function voronoi(target: number, jitter: number, gradient: boolean, rng: Rng): { polys: Pt[][]; edges: number[][] } {
	const [rows, cols] = gridFor(target, 1, 1);
	const n = rows * cols;
	const sites: Pt[] = [];
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
		const ramp = gradient ? (cols > 1 ? c / (cols - 1) : 1) : 1;
		const j = jitter * ramp;
		sites.push([c + 0.5 + (rng() * 2 - 1) * j, r + 0.5 + (rng() * 2 - 1) * j]);
	}
	const rect: Pt[] = [[0, 0], [cols, 0], [cols, rows], [0, rows]];
	const candidates = (i: number): number[] => {
		const r = Math.floor(i / cols), c = i % cols, out: number[] = [];
		for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
			if (!dr && !dc) continue;
			const rr = r + dr, cc = c + dc;
			if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
			out.push(rr * cols + cc);
		}
		return out;
	};
	const cellFor = (i: number): Pt[] => {
		let poly = rect.map(p => [p[0], p[1]] as Pt);
		const si = sites[i];
		for (const j of candidates(i)) {
			const sj = sites[j];
			// keep the side of the bisector nearer to si: f(p) <= 0
			const ax = 2 * (sj[0] - si[0]), ay = 2 * (sj[1] - si[1]);
			const b = sj[0] * sj[0] + sj[1] * sj[1] - si[0] * si[0] - si[1] * si[1];
			const next: Pt[] = [];
			for (let k = 0; k < poly.length; k++) {
				const p = poly[k], q = poly[(k + 1) % poly.length];
				const fp = ax * p[0] + ay * p[1] - b, fq = ax * q[0] + ay * q[1] - b;
				if (fp <= 0) next.push(p);
				if ((fp <= 0) !== (fq <= 0)) {
					const t = fp / (fp - fq);
					next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
				}
			}
			poly = next;
			if (poly.length < 3) return [];
		}
		// drop the slivers a near-tangent bisector leaves behind
		const clean: Pt[] = [];
		for (const p of poly) {
			const last = clean[clean.length - 1];
			if (last && Math.abs(last[0] - p[0]) < 1e-7 && Math.abs(last[1] - p[1]) < 1e-7) continue;
			clean.push(p);
		}
		if (clean.length > 2) {
			const f = clean[0], l = clean[clean.length - 1];
			if (Math.abs(f[0] - l[0]) < 1e-7 && Math.abs(f[1] - l[1]) < 1e-7) clean.pop();
		}
		return clean;
	};
	// one gentle relaxation pass: nudge each point toward its cell's centroid to kill the worst slivers
	// without flattening the jitter back into a grid.
	const relaxed = sites.map((s, i) => {
		const cell = cellFor(i);
		if (cell.length < 3) return s;
		const c = polyCentroid(cell);
		return [s[0] + (c[0] - s[0]) * 0.4, s[1] + (c[1] - s[1]) * 0.4] as Pt;
	});
	for (let i = 0; i < n; i++) sites[i] = relaxed[i];

	const polys: Pt[][] = [];
	const keep: number[] = [];
	for (let i = 0; i < n; i++) {
		const cell = cellFor(i);
		if (cell.length >= 3) { keep.push(i); polys.push(cell); }
	}
	const slot = new Map<number, number>();
	keep.forEach((site, idx) => slot.set(site, idx));
	const edges: number[][] = polys.map(() => []);
	for (let idx = 0; idx < polys.length; idx++) {
		const i = keep[idx], p = polys[idx], si = sites[i];
		for (let k = 0; k < p.length; k++) {
			const a = p[k], b = p[(k + 1) % p.length];
			const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
			const di = Math.hypot(mx - si[0], my - si[1]);
			let best = -1, bestD = Infinity;
			for (const j of candidates(i)) {
				const d = Math.hypot(mx - sites[j][0], my - sites[j][1]);
				if (d < bestD) { bestD = d; best = j; }
			}
			if (best < 0 || bestD > di + 1e-6) continue;   // a board edge, not a shared side
			const other = slot.get(best);
			if (other == null || other === idx) continue;
			if (edges[idx].indexOf(other) < 0) { edges[idx].push(other); edges[other].push(idx); }
		}
	}
	return { polys, edges };
}

// ---- the catalogue ----

export type TilingId = "triangle" | "square" | "pentagon" | "hexagon" | "heptagon" | "octagon" | "trunc" | "voronoi";

export interface TilingSpec {
	id: TilingId;
	label: string;
	sides: string;
	blurb: string;
	density: number;         // mines as a fraction of cells: the default for this geometry
	make: (target: number, opts: { jitter: number; gradient: boolean; rng: Rng }) => Tiling;
}

export const TILINGS: TilingSpec[] = [
	{
		id: "triangle", label: "Triangle", sides: "3 sides", density: 0.13,
		blurb: "Equilateral triangles, every other one upside down. Corners included, a triangle touches twelve others, so the numbers run far higher than on a square board.",
		make: t => buildTiling(triangles(t))
	},
	{
		id: "square", label: "Square", sides: "4 sides", density: 0.16,
		blurb: "The board the rest of the game plays on, here for comparison.",
		make: t => buildTiling(squares(t))
	},
	{
		id: "pentagon", label: "Pentagon", sides: "5 sides", density: 0.17,
		blurb: "The Cairo tiling: four pentagons pinwheel around every other corner, and each pentagon has two right angles and three 120 degree ones. Five neighbours share a side, two more meet at a corner.",
		make: t => buildTiling(cairo(t))
	},
	{
		id: "hexagon", label: "Hexagon", sides: "6 sides", density: 0.19,
		blurb: "Six neighbours, no diagonals at all: every neighbour shares a full side. The cleanest board of the lot to read.",
		make: t => buildTiling(hexagons(t))
	},
	{
		id: "heptagon", label: "Heptagon", sides: "7 sides", density: 0.16,
		blurb: "No convex heptagon tiles the plane, so this one waves three of its four sides and leaves the fourth flat. Cells pair up along the flat side.",
		make: t => buildTiling(waved(t, 7))
	},
	{
		id: "octagon", label: "Octagon", sides: "8 sides", density: 0.16,
		blurb: "All four sides waved: a bump on one cell is the dent on its neighbour. Eight sides, and the square grid's eight neighbours underneath.",
		make: t => buildTiling(waved(t, 8))
	},
	{
		id: "trunc", label: "Octagon + square", sides: "8 and 4 sides", density: 0.16,
		blurb: "Regular octagons with a tilted square in every gap. The only board here where all eight of an octagon's neighbours share a real side with it.",
		make: t => buildTiling(octagonsAndSquares(t))
	},
	{
		id: "voronoi", label: "Mixed", sides: "4 to 9 sides", density: 0.19,
		blurb: "Voronoi cells around a jittered grid: the side count changes from cell to cell. Turn the gradient on and the board starts as squares on the left and dissolves as it goes right.",
		make: (t, o) => { const v = voronoi(t, o.jitter, o.gradient, o.rng); return buildTiling(v.polys, v.edges); }
	}
];

export const TILING_BY_ID: Record<TilingId, TilingSpec> = TILINGS.reduce((m, t) => { m[t.id] = t; return m; }, {} as Record<TilingId, TilingSpec>);

// The neighbour graph a game plays on: sides only, or sides plus the cells that only touch at a corner.
export function neighborGraph(tiling: Tiling, diagonals: boolean): number[][] {
	if (!diagonals) return tiling.edgeNeighbors;
	return tiling.edgeNeighbors.map((e, i) => e.concat(tiling.cornerNeighbors[i]));
}
