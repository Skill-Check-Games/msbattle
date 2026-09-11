// The mine explosion, painted over the board around the cell that went off: a flash, a fireball, two
// shockwave rings and a burst of sparks in the first second, a few puffs of smoke that drift up and
// thin out, and a column of smoke rising out of the cell for as long as the mine penalty lasts. All
// sizes are in cell units (u = one cell's width in canvas pixels), so it scales with the board.
export interface Spark { vx: number; vy: number; size: number; delay: number; color: string; }
export interface Puff { dx: number; dy: number; size: number; delay: number; alpha: number; }
export interface Explosion { r: number; c: number; start: number; sparks: Spark[]; puffs: Puff[]; column: Puff[]; until?: number; }   // until: the penalty's end (Date.now() time) once known

const BLAST_MS = 900;            // everything but the smoke is over by then
const PUFFS_MS = 1500;           // the drifting puffs
const COLUMN_PUFF_MS = 1500;     // each column puff's own life
export const EXPLOSION_MIN_LIFE = 1800;   // the column when no penalty is known
const SPARK_YELLOW = "253,224,71", SPARK_ORANGE = "251,146,60";

const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const smoke = (a: number) => `rgba(148, 163, 184, ${a})`;

export function makeExplosion(r: number, c: number, start: number): Explosion {
	const rnd = Math.random;
	const sparks: Spark[] = [];
	for (let i = 0; i < 20; i++) { const a = rnd() * Math.PI * 2, v = 0.06 + rnd() * 0.11; sparks.push({ vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.05, size: 1.5 + rnd() * 2.5, delay: rnd() * 60, color: rnd() < 0.5 ? SPARK_YELLOW : SPARK_ORANGE }); }
	const puffs: Puff[] = [];
	for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i - 3.5) * 0.42 + (rnd() - 0.5) * 0.4, d = 26 + rnd() * 34; puffs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, size: 18 + rnd() * 16, delay: 160 + rnd() * 200, alpha: 0.5 + rnd() * 0.3 }); }
	const column: Puff[] = [];
	for (let i = 0; i < 22; i++) column.push({ dx: (rnd() - 0.5) * 16, dy: -6 - rnd() * 8, size: 12 + rnd() * 12, delay: i, alpha: 0.45 + rnd() * 0.3 });   // delay: the puff's index; placed along the life at paint time
	return { r, c, start, sparks, puffs, column };
}

// How long the whole thing lives: the column keeps rising until a second before the penalty lifts.
// The penalty's end is remembered on the explosion the first time it is known, so the effect plays out
// in full even if the round ends (and the session's freeze is cleared) while it is still smoking.
// frozenUntil is a Date.now() time, e.start a performance.now() one, so the two clocks are bridged here.
export function explosionLife(e: Explosion, frozenUntil: number, now: number): number {
	if (!e.until && frozenUntil > Date.now()) e.until = frozenUntil;
	const remaining = (e.until || 0) - Date.now();
	return Math.max(EXPLOSION_MIN_LIFE, (now - e.start) + remaining - 1000);
}

function puff(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, a: number) {
	if (a <= 0.005) return;
	ctx.fillStyle = smoke(Math.min(1, a));
	for (const [ox, oy, s] of [[0, 0, 1], [-0.45, 0.15, 0.7], [0.45, 0.1, 0.75], [0.1, -0.4, 0.65]]) { ctx.beginPath(); ctx.arc(x + ox * size, y + oy * size, size * s * 0.55, 0, Math.PI * 2); ctx.fill(); }
}

// Paints one explosion at time t (ms since it started) around canvas point (cx, cy); u = cell width / 40.
export function paintExplosion(ctx: CanvasRenderingContext2D, e: Explosion, t: number, cx: number, cy: number, u: number, life: number) {
	if (t < 0) return;
	ctx.save();
	// column of smoke: it smokes heavily right after the blast, then the puffs come further and further
	// apart, smaller and thinner, until the last one leaves a second before the penalty lifts (the spawn
	// times follow a power curve over the life, so the gaps grow steadily rather than stopping dead)
	const n = e.column.length, span = Math.max(600, life - COLUMN_PUFF_MS);
	for (const p of e.column) {
		const f = p.delay / (n - 1), tt = t - (160 + span * Math.pow(f, 1.9)); if (tt < 0 || tt > COLUMN_PUFF_MS) continue;
		const k = tt / COLUMN_PUFF_MS, taper = 1 - 0.45 * f;
		puff(ctx, cx + (p.dx + Math.sin(tt / 400 + p.dx) * 5) * u, cy + (p.dy - 0.05 * tt) * u, p.size * u * taper * (0.5 + 1.2 * k), p.alpha * taper * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85));
	}
	// drifting puffs from the blast itself
	for (const p of e.puffs) {
		const k = (t - p.delay) / PUFFS_MS; if (k < 0 || k > 1) continue;
		puff(ctx, cx + p.dx * eo(k) * u, cy + (p.dy * eo(k) - 18 * k) * u, p.size * u * (0.4 + 0.9 * eo(k)), p.alpha * (1 - k) * (k < 0.15 ? k / 0.15 : 1));
	}
	if (t <= BLAST_MS) {
		// fireball
		{ const k = t / 640; if (k <= 1) { const rad = 74 * u * (0.25 + 0.75 * eo(k)), a = 1 - k; const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, `rgba(254,240,138,${a})`); g.addColorStop(0.35, `rgba(251,146,60,${a})`); g.addColorStop(0.75, `rgba(239,68,68,${a * 0.85})`); g.addColorStop(1, "rgba(120,20,20,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); } }
		// two shockwave rings
		const ring = (delay: number, r0: number, r1: number, width: number, color: string, alpha: number) => { const k = (t - delay) / 760; if (k < 0 || k > 1) return; ctx.strokeStyle = `rgba(${color},${alpha * (1 - k)})`; ctx.lineWidth = width * u * (1 - k * 0.6); ctx.beginPath(); ctx.arc(cx, cy, (r0 + (r1 - r0) * eo(k)) * u, 0, Math.PI * 2); ctx.stroke(); };
		ring(40, 12, 118, 6, "255,255,255", 0.8); ring(160, 12, 96, 3, "251,191,36", 0.7);
		// sparks under gravity
		for (const p of e.sparks) {
			const tt = t - p.delay, k = tt / 900; if (k < 0 || k > 1) continue;
			ctx.fillStyle = `rgba(${p.color},${1 - k})`; ctx.beginPath(); ctx.arc(cx + p.vx * tt * u, cy + (p.vy * tt + 0.0009 * tt * tt) * u, p.size * u * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
		}
		// the flash at the very start
		if (t <= 120) { const k = t / 120; ctx.fillStyle = `rgba(255,255,255,${(1 - k) * 0.9})`; ctx.beginPath(); ctx.arc(cx, cy, 26 * u * (0.4 + 0.6 * k), 0, Math.PI * 2); ctx.fill(); }
	}
	ctx.restore();
}
