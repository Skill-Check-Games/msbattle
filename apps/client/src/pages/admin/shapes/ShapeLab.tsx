// Admin "Shape playground" (/admin/shapes): minesweeper on cells that aren't squares. Triangles,
// pentagons, hexagons, heptagons, octagons, and a mixed board whose cells change side count as you
// cross it. Local only — nothing here touches the server, there is no rating, no clock pressure and
// no opponent, it exists to find out which geometries are actually fun to read.
//
// The board, the solver and the painter are geometry-agnostic and live next door: tilings.ts makes
// the polygons and the neighbour graph, poly-game.ts plays and solves any such graph, poly-render.ts
// paints it. Boards open in the middle and are no-guess by default, same as a real round.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BOARD_SKINS, BOARD_SKIN_LIST, DPR, localBoardSkin } from "../../../game/board-render";
import { AdminPage, adminStyles } from "../admin-shared";
import { SliderRow, Toggle, labStyles } from "../lab-shared";
import { TILINGS, TILING_BY_ID, TilingId, Tiling, makeRng, neighborGraph } from "./tilings";
import { PolyGame, generateBoard, centerCell, deduce, COVERED, REVEALED, FLAGGED } from "./poly-game";
import { paint, cellAt, transformFor } from "./poly-render";
import styles from "./ShapeLab.module.scss";

const SIZES: { id: string; label: string; cells: number }[] = [
	{ id: "s", label: "Small", cells: 120 },
	{ id: "m", label: "Medium", cells: 280 },
	{ id: "l", label: "Large", cells: 520 }
];
const LONG_PRESS_MS = 320;

interface Board { tiling: Tiling; neighbors: number[][]; game: PolyGame; start: number; noGuess: boolean; attempts: number; genMs: number; avgNeighbors: number; }

export default function ShapeLab() {
	const [tilingId, setTilingId] = useState<TilingId>("hexagon");
	const [sizeId, setSizeId] = useState("m");
	const [densities, setDensities] = useState<Record<string, number>>({});
	const [noGuess, setNoGuess] = useState(true);
	const [diagonals, setDiagonals] = useState(true);
	const [jitter, setJitter] = useState(0.42);
	const [gradient, setGradient] = useState(false);
	const [seed, setSeed] = useState(1);
	const [skin, setSkin] = useState(localBoardSkin);
	const [xray, setXray] = useState(false);
	const [showSides, setShowSides] = useState(false);
	const [flagMode, setFlagMode] = useState(false);
	const [hover, setHover] = useState<number | null>(null);
	const [hint, setHint] = useState<number[]>([]);
	const [note, setNote] = useState("");
	const [auto, setAuto] = useState(false);
	const [, bump] = useState(0);
	const rerender = () => bump(v => v + 1);

	const spec = TILING_BY_ID[tilingId];
	const density = densities[tilingId] ?? spec.density;
	const cells = SIZES.find(s => s.id === sizeId)!.cells;

	// A whole board in one memo: change any input and you get a new board, which is what you want in
	// a playground. "New board" just bumps the seed.
	const board: Board = useMemo(() => {
		const rng = makeRng(seed * 7919 + cells + Math.round(density * 1000) + tilingId.length * 31 + (gradient ? 5 : 0) + Math.round(jitter * 100));
		const tiling = spec.make(cells, { jitter, gradient, rng });
		const neighbors = neighborGraph(tiling, diagonals);
		const start = centerCell(tiling.centroids, tiling.width, tiling.height);
		const wanted = Math.max(1, Math.round(tiling.polys.length * density));
		const gen = generateBoard(neighbors, wanted, start, { noGuess, rng, budgetMs: 1200 });
		const game = new PolyGame(neighbors, gen.mines);
		game.open(start);
		let total = 0;
		for (const nb of neighbors) total += nb.length;
		return { tiling, neighbors, game, start, noGuess: gen.noGuess, attempts: gen.attempts, genMs: gen.ms, avgNeighbors: total / neighbors.length };
	}, [tilingId, cells, density, noGuess, diagonals, jitter, gradient, seed, spec]);

	useEffect(() => {
		setHint([]); setHover(null); setAuto(false);
		setNote(noGuess && !board.noGuess ? "Could not reach a no-guess layout in the time budget, so this board may need a guess. Try fewer mines." : "");
	}, [board, noGuess]);

	// ---- canvas: size to the card, repaint on any change ----
	const wrapRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [box, setBox] = useState({ w: 0, h: 0 });
	useLayoutEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || box.w < 2 || box.h < 2) return;
		const w = Math.round(box.w * DPR), h = Math.round(box.h * DPR);
		if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }   // reassigning clears the canvas, so only on a real resize
		paint(canvas, { tiling: board.tiling, game: board.game, skin, hover, xray, hint, showSides });
	});

	// ---- input ----
	const hit = (clientX: number, clientY: number): number | null => {
		const canvas = canvasRef.current;
		if (!canvas) return null;
		const rect = canvas.getBoundingClientRect();
		const t = transformFor(rect.width, rect.height, board.tiling);
		return cellAt(board.tiling, t, clientX - rect.left, clientY - rect.top);
	};
	const act = (i: number | null, asFlag: boolean) => {
		if (i == null) return;
		const g = board.game;
		if (asFlag) g.toggleFlag(i);
		else if (g.state[i] === REVEALED) g.chord(i);
		else g.reveal(i);
		setHint([]);
		rerender();
	};
	const touch = useRef({ x: 0, y: 0, moved: false, long: false, timer: 0 as any });
	const onTouchStart = (e: React.TouchEvent) => {
		const t = e.touches[0];
		touch.current = { x: t.clientX, y: t.clientY, moved: false, long: false, timer: 0 };
		touch.current.timer = window.setTimeout(() => {
			if (touch.current.moved) return;
			touch.current.long = true;
			act(hit(touch.current.x, touch.current.y), true);
			if (navigator.vibrate) navigator.vibrate(15);
		}, LONG_PRESS_MS);
	};
	const onTouchMove = (e: React.TouchEvent) => {
		const t = e.touches[0];
		if (Math.abs(t.clientX - touch.current.x) > 12 || Math.abs(t.clientY - touch.current.y) > 12) {
			touch.current.moved = true;
			window.clearTimeout(touch.current.timer);
		}
	};
	const onTouchEnd = (e: React.TouchEvent) => {
		window.clearTimeout(touch.current.timer);
		e.preventDefault();
		if (touch.current.long || touch.current.moved) return;
		act(hit(touch.current.x, touch.current.y), flagMode);
	};

	// ---- clock ----
	const [, tick] = useState(0);
	useEffect(() => {
		if (!board.game.startedAt || board.game.over) return;
		const id = window.setInterval(() => tick(v => v + 1), 250);
		return () => window.clearInterval(id);
	}, [board, board.game.startedAt, board.game.over]);

	// ---- solver buttons ----
	const solveOnce = (): boolean => {
		const g = board.game;
		if (g.over) return false;
		const d = deduce(g.view());
		let did = false;
		for (const i of d.mines) if (g.state[i] === COVERED) { g.toggleFlag(i); did = true; }
		for (const i of d.safe) if (g.state[i] !== REVEALED) { if (g.state[i] === FLAGGED) g.toggleFlag(i); g.reveal(i); did = true; }
		if (did) rerender();
		return did;
	};
	useEffect(() => {
		if (!auto) return;
		const id = window.setInterval(() => {
			if (!solveOnce()) { setAuto(false); setNote(board.game.won ? "Solved with deduction alone." : "The solver ran out of forced moves: from here the board needs a guess."); }
		}, 220);
		return () => window.clearInterval(id);
	}, [auto, board]);
	const showHint = () => {
		const g = board.game;
		if (g.over) return;
		const d = deduce(g.view());
		const safe = d.safe.filter(i => g.state[i] !== REVEALED);
		if (safe.length) { setHint(safe.slice(0, 3)); setNote(safe.length + " cell" + (safe.length === 1 ? " is" : "s are") + " provably safe right now."); }
		else if (d.mines.length) { setHint([]); setNote(d.mines.length + " cell" + (d.mines.length === 1 ? " is" : "s are") + " provably a mine, but nothing is provably safe."); }
		else { setHint([]); setNote("No forced move: from here the board needs a guess."); }
	};

	const g = board.game;
	const secs = Math.floor(g.elapsedMs / 1000);
	const status = g.won ? "Cleared" : g.dead ? "Boom" : g.startedAt ? "Playing" : "Ready";
	const sideCounts = useMemo(() => {
		const m = new Map<number, number>();
		for (const s of board.tiling.sides) m.set(s, (m.get(s) || 0) + 1);
		return [...m.entries()].sort((a, b) => a[0] - b[0]);
	}, [board]);

	return (
		<AdminPage title="Shape playground" sub="Minesweeper on cells that are not squares. Local only: no server, no rating, no clock you have to beat. Every board opens in the middle and is no-guess by default, so each geometry can be judged on how it actually plays." wide>
			<div className={styles.shapes}>
				{TILINGS.map(t => (
					<button key={t.id} type="button" className={`${styles.shape} ${t.id === tilingId ? styles.shapeActive : ""}`} onClick={() => setTilingId(t.id)}>
						<ShapeIcon id={t.id} />
						<span className={styles.shapeName}>{t.label}</span>
						<span className={styles.shapeSides}>{t.sides}</span>
					</button>
				))}
			</div>
			<p className={styles.blurb}>{spec.blurb}</p>

			<div className={styles.layout}>
				<div className={styles.boardCard}>
					<div className={styles.hud}>
						<span className={styles.hudItem}><span className={styles.hudLabel}>Mines</span>{g.flagsLeft}</span>
						<span className={styles.hudItem}><span className={styles.hudLabel}>Time</span>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
						<span className={`${styles.hudItem} ${g.won ? styles.win : g.dead ? styles.lose : ""}`}><span className={styles.hudLabel}>State</span>{status}</span>
						<span className={styles.hudSpacer} />
						<button type="button" className={`btn ${styles.hudBtn}`} onClick={() => setSeed(s => s + 1)}>New board</button>
					</div>
					<div className={styles.canvasWrap} ref={wrapRef}>
						<canvas
							ref={canvasRef}
							className={styles.canvas}
							onMouseMove={e => setHover(hit(e.clientX, e.clientY))}
							onMouseLeave={() => setHover(null)}
							onContextMenu={e => { e.preventDefault(); act(hit(e.clientX, e.clientY), true); }}
							onClick={e => act(hit(e.clientX, e.clientY), false)}
							onTouchStart={onTouchStart}
							onTouchMove={onTouchMove}
							onTouchEnd={onTouchEnd}
						/>
					</div>
					<div className={styles.boardFoot}>
						<button type="button" className={`btn ${flagMode ? styles.toolOn : ""}`} onClick={() => setFlagMode(f => !f)}>Tap to flag{flagMode ? ": on" : ": off"}</button>
						<button type="button" className="btn" onClick={showHint} disabled={g.over}>Hint</button>
						<button type="button" className={`btn ${auto ? styles.toolOn : ""}`} onClick={() => setAuto(a => !a)} disabled={g.over}>{auto ? "Stop solver" : "Auto-solve"}</button>
						<span className={styles.note}>{note}</span>
					</div>
				</div>

				<div className={styles.controls}>
					<h2 className={labStyles.panelTitle}>Board</h2>
					<div className={styles.segRow}>
						{SIZES.map(s => <button key={s.id} type="button" className={s.id === sizeId ? styles.segOn : undefined} onClick={() => setSizeId(s.id)}>{s.label}</button>)}
					</div>
					<SliderRow label="Mines" note="As a share of the cells. More neighbours per cell means a lower share plays the same." value={density} min={0.04} max={0.34} step={0.01} format={v => Math.round(v * 100) + "%"} onChange={v => setDensities(d => ({ ...d, [tilingId]: v }))} />
					<div className={styles.switchRow}><span className={styles.switchText}><b>No-guess</b><i>Rebuild until the board is solvable by deduction alone.</i></span><Toggle on={noGuess} onChange={setNoGuess} label="No-guess" /></div>
					<div className={styles.switchRow}><span className={styles.switchText}><b>Corner neighbours</b><i>Count cells that only touch at a corner. Off, only shared sides count.</i></span><Toggle on={diagonals} onChange={setDiagonals} label="Corner neighbours" /></div>
					{tilingId === "voronoi" && (
						<>
							<SliderRow label="Jitter" note="How far each cell's seed point wanders off the grid." value={jitter} min={0} max={0.48} step={0.02} format={v => v.toFixed(2)} onChange={setJitter} />
							<div className={styles.switchRow}><span className={styles.switchText}><b>Gradient</b><i>Ramp the jitter left to right: squares on one side, irregular on the other.</i></span><Toggle on={gradient} onChange={setGradient} label="Gradient" /></div>
						</>
					)}

					<h2 className={labStyles.panelTitle}>View</h2>
					<div className={styles.fieldRow}>
						<span className={styles.switchText}><b>Skin</b></span>
						<select className={adminStyles.select} value={skin} onChange={e => setSkin(e.target.value)}>
							{BOARD_SKIN_LIST.map(id => <option key={id} value={id}>{BOARD_SKINS[id].label}</option>)}
						</select>
					</div>
					<div className={styles.switchRow}><span className={styles.switchText}><b>X-ray</b><i>Show where the mines are.</i></span><Toggle on={xray} onChange={setXray} label="X-ray" /></div>
					<div className={styles.switchRow}><span className={styles.switchText}><b>Side count</b><i>Print each covered cell's number of sides.</i></span><Toggle on={showSides} onChange={setShowSides} label="Side count" /></div>

					<h2 className={labStyles.panelTitle}>This board</h2>
					<dl className={styles.stats}>
						<div><dt>Cells</dt><dd>{board.tiling.polys.length}</dd></div>
						<div><dt>Mines</dt><dd>{g.mineCount} ({Math.round((g.mineCount / board.tiling.polys.length) * 100)}%)</dd></div>
						<div><dt>Neighbours</dt><dd>{board.avgNeighbors.toFixed(1)} avg</dd></div>
						<div><dt>Sides</dt><dd>{sideCounts.map(([s, c]) => s + "×" + c).join(", ")}</dd></div>
						<div><dt>No-guess</dt><dd>{board.noGuess ? "yes, in " + board.attempts + " pass" + (board.attempts === 1 ? "" : "es") : "no"}</dd></div>
						<div><dt>Built in</dt><dd>{Math.round(board.genMs)} ms</dd></div>
					</dl>
					<p className={styles.help}>Left click opens, right click flags, clicking a number with its flags placed opens the rest. On a phone, long press flags.</p>
				</div>
			</div>
		</AdminPage>
	);
}

// One cell of each geometry, drawn from the real generator so the chip can never drift from the board.
const ICONS: Record<string, string> = {};
function shapeIcon(id: TilingId): string {
	if (ICONS[id]) return ICONS[id];
	const spec = TILING_BY_ID[id];
	const tiling = spec.make(60, { jitter: 0.42, gradient: false, rng: makeRng(9) });
	const maxSides = Math.max(...tiling.sides);
	let best = 0, bestD = Infinity;
	for (let i = 0; i < tiling.polys.length; i++) {
		if (tiling.sides[i] !== maxSides) continue;
		const dx = tiling.centroids[i][0] - tiling.width / 2, dy = tiling.centroids[i][1] - tiling.height / 2;
		const d = dx * dx + dy * dy;
		if (d < bestD) { bestD = d; best = i; }
	}
	const poly = tiling.polys[best];
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const [x, y] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
	const s = 18 / Math.max(maxX - minX, maxY - minY);
	const ox = (22 - (maxX - minX) * s) / 2, oy = (22 - (maxY - minY) * s) / 2;
	ICONS[id] = poly.map(([x, y], i) => (i ? "L" : "M") + (ox + (x - minX) * s).toFixed(2) + " " + (oy + (y - minY) * s).toFixed(2)).join(" ") + " Z";
	return ICONS[id];
}

function ShapeIcon({ id }: { id: TilingId }) {
	const d = useMemo(() => shapeIcon(id), [id]);
	return <svg className={styles.icon} viewBox="0 0 22 22" aria-hidden="true"><path d={d} /></svg>;
}
