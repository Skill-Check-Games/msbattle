// Puzzle Builder (/admin/builder): draw a position by hand (reveal cells and pick their numbers, mark mines
// and safe cells), have the solver check it as you go (is it consistent, which cells the clues determine, what
// the solver's next move costs, what the finished puzzle would rate), finish it by hand or autocomplete it,
// and save it to your collection, where it sits with its rating and can be published into the pool.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Cosmetics from "core/src/common/Cosmetics.js";
import { AdminPage, adminStyles, adminHeaders } from "./admin-shared";
import { LabSection, labStyles } from "./lab-shared";
import styles from "./PuzzleBuilder.module.scss";

type Cell = "?" | "M" | "S" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
type Tool = Cell | "erase";
interface Spec { rows: number; cols: number; cells: Cell[][]; }
interface Move { method: string; action: string; complexity: number; cells: number[][]; changed: number[][]; splitCell: number[] | null; }
interface Preview { solved: boolean; difficulty: number; score: number; rating: number | null; maxComplexity: number; moves: number; safeLeft: number; mines: number; }
interface Analysis { clues: number; layouts: number; capped: boolean; contradiction: boolean; determinedSafe: number[][]; determinedMine: number[][]; ambiguous: number[][]; free: number[][]; nextMove: Move | null; preview: Preview | null; error?: string; }
interface Saved { id: number; name: string; rows: number; cols: number; mines: number[][]; revealed: number[][]; solved: boolean; difficulty: number; score: number; rating: number | null; cspMethod: string | null; maxComplexity: number | null; poolPuzzleId: number | null; createdAt: number; }

const NUMBER_COLORS: Record<string, string> = Cosmetics.BOARD_SKINS.classic.numbers;
const TIER_NAMES = ["Unsolvable", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5", "Tier 6"];
const tierOfCost = (c: number) => c <= 1.5 ? 1 : c <= 3 ? 2 : c <= 5 ? 3 : c <= 7 ? 4 : c <= 10 ? 5 : 6;
const emptyCells = (rows: number, cols: number): Cell[][] => Array.from({ length: rows }, () => Array<Cell>(cols).fill("?"));
const has = (list: number[][] | undefined, r: number, c: number) => !!list && list.some(x => x[0] === r && x[1] === c);
const api = (path: string, init?: RequestInit) => fetch(path, { ...init, headers: { "Content-Type": "application/json", ...adminHeaders(), ...(init && init.headers) } }).then(r => r.json());
const specFromSaved = (p: Saved): Spec => {
	const cells = emptyCells(p.rows, p.cols);
	p.mines.forEach(([r, c]) => { cells[r][c] = "M"; });
	for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) if (cells[r][c] !== "M") cells[r][c] = "S";
	p.revealed.forEach(([r, c]) => { let n = 0; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if ((dr || dc) && rr >= 0 && rr < p.rows && cc >= 0 && cc < p.cols && cells[rr][cc] === "M") n++; } cells[r][c] = String(n) as Cell; });
	return { rows: p.rows, cols: p.cols, cells };
};

export default function PuzzleBuilder() {
	const [spec, setSpec] = useState<Spec>({ rows: 6, cols: 6, cells: emptyCells(6, 6) });
	const [tool, setTool] = useState<Tool>("2");
	const [sel, setSel] = useState<[number, number] | null>(null);   // the selected cell: hotkeys change its content
	const selRef = useRef(sel); selRef.current = sel;
	const [analysis, setAnalysis] = useState<Analysis | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [status, setStatus] = useState<{ text: string; kind: "ok" | "warn" | "err" } | null>(null);
	const [name, setName] = useState("");
	const [saved, setSaved] = useState<Saved[]>([]);
	const [showNext, setShowNext] = useState(true);
	const [density, setDensity] = useState(20);   // autocomplete: mines among the cells no clue touches, in percent
	const latest = useRef(0);

	const loadCollection = useCallback(() => { api("/api/builder/puzzles").then(d => { if (d && d.puzzles) setSaved(d.puzzles); else if (d && d.error) setStatus({ text: d.error, kind: "err" }); }).catch(() => {}); }, []);
	useEffect(() => { loadCollection(); }, [loadCollection]);

	// Every edit re-analyses after a short pause; only the latest request's answer is shown.
	useEffect(() => {
		const seq = ++latest.current;
		const hasClue = spec.cells.some(row => row.some(v => v !== "?" && v !== "M" && v !== "S"));
		if (!hasClue) { setAnalysis(null); return; }
		const t = setTimeout(() => {
			setBusy("Analysing");
			api("/api/builder/analyze", { method: "POST", body: JSON.stringify({ spec }) }).then(d => { if (seq !== latest.current) return; setAnalysis(d); setBusy(null); }).catch(e => { if (seq === latest.current) { setStatus({ text: String(e), kind: "err" }); setBusy(null); } });
		}, 350);
		return () => clearTimeout(t);
	}, [spec]);

	const setCell = (r: number, c: number, v: Cell) => setSpec(s => { if (s.cells[r][c] === v) return s; const cells = s.cells.map(row => row.slice()); cells[r][c] = v; return { ...s, cells }; });
	const paint = (r: number, c: number) => { if (tool === "erase") setCell(r, c, "?"); else setCell(r, c, tool); };
	// Hotkeys: 0 to 8 a clue, M a mine, S safe, Backspace, Delete or ? erase. With a cell selected they change that
	// cell (and become the tool); with none they pick the tool. Arrows move the selection, Escape drops it.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement | null)?.tagName || "";
			if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.ctrlKey || e.metaKey || e.altKey) return;
			const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
			let t: Tool | null = null;
			if (k >= "0" && k <= "8" && k.length === 1) t = k as Tool; else if (k === "m") t = "M"; else if (k === "s") t = "S"; else if (k === "?" || k === "Backspace" || k === "Delete") t = "erase";
			const cur = selRef.current;
			if (t) { e.preventDefault(); setTool(t); if (cur) setCell(cur[0], cur[1], t === "erase" ? "?" : t); return; }
			if (k === "Escape") { setSel(null); return; }
			const d = k === "ArrowUp" ? [-1, 0] : k === "ArrowDown" ? [1, 0] : k === "ArrowLeft" ? [0, -1] : k === "ArrowRight" ? [0, 1] : null;
			if (!d) return;
			e.preventDefault();
			const from = cur || [0, 0], next: [number, number] = [Math.max(0, Math.min(spec.rows - 1, from[0] + d[0])), Math.max(0, Math.min(spec.cols - 1, from[1] + d[1]))];
			selRef.current = next; setSel(next);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [spec.rows, spec.cols]);
	const resize = (rows: number, cols: number) => { setSel(null); setSpec(s => { const cells = emptyCells(rows, cols); for (let r = 0; r < Math.min(rows, s.rows); r++) for (let c = 0; c < Math.min(cols, s.cols); c++) cells[r][c] = s.cells[r][c]; return { rows, cols, cells }; }); }
	const clearBoard = () => { setSpec(s => ({ ...s, cells: emptyCells(s.rows, s.cols) })); setStatus(null); setSel(null); };
	const autocomplete = () => {
		setBusy("Autocompleting"); setStatus(null);
		api("/api/builder/autocomplete", { method: "POST", body: JSON.stringify({ spec, density: density / 100 }) }).then(d => {
			setBusy(null);
			if (!d || d.error) { setStatus({ text: (d && d.error) || "failed", kind: "err" }); return; }
			if (!d.ok) { setStatus({ text: d.contradiction ? "No layout fits these clues." : "Nothing to complete.", kind: "err" }); return; }
			setSpec(s => ({ ...s, cells: d.best.cells }));
			setStatus(d.best.solved ? { text: `Completed: ${TIER_NAMES[d.best.difficulty]}, score ${d.best.score}, rating ${d.best.rating}. ${d.solvable} of ${d.tried} fills${d.capped ? " (of many more)" : ""} were solvable; this is the hardest.`, kind: "ok" }
				: { text: `None of ${d.tried} fills${d.capped ? " tried" : ""} is solvable by the solver; filled in the one it gets furthest on (${d.best.safeLeft} safe cells left).`, kind: "warn" });
		}).catch(e => { setBusy(null); setStatus({ text: String(e), kind: "err" }); });
	};
	const save = () => {
		setBusy("Saving"); setStatus(null);
		api("/api/builder/puzzles", { method: "POST", body: JSON.stringify({ name, spec }) }).then(d => {
			setBusy(null);
			if (!d || d.error) { setStatus({ text: (d && d.error) || "failed", kind: "err" }); return; }
			setStatus({ text: `Saved "${d.puzzle.name}": ${TIER_NAMES[d.puzzle.difficulty]}${d.puzzle.rating != null ? ", rating " + d.puzzle.rating : ""}.`, kind: "ok" });
			setName(""); loadCollection();
		}).catch(e => { setBusy(null); setStatus({ text: String(e), kind: "err" }); });
	};
	const publish = (p: Saved) => { api(`/api/builder/puzzles/${p.id}/publish`, { method: "POST" }).then(d => { if (d && d.error) setStatus({ text: d.error, kind: "err" }); else { setStatus({ text: `Published as pool puzzle #${d.poolPuzzleId}.`, kind: "ok" }); loadCollection(); } }); };
	const remove = (p: Saved) => { api(`/api/builder/puzzles/${p.id}`, { method: "DELETE" }).then(() => loadCollection()); };
	const load = (p: Saved) => { setSpec(specFromSaved(p)); setName(p.name); setStatus({ text: `Loaded "${p.name}".`, kind: "ok" }); window.scrollTo({ top: 0 }); };

	const complete = spec.cells.every(row => row.every(v => v !== "?"));
	const a = analysis;
	const cellPx = Math.max(34, Math.min(56, Math.floor(520 / Math.max(spec.rows, spec.cols))));
	const tools: { id: Tool; label: string; title: string }[] = [
		...(["0", "1", "2", "3", "4", "5", "6", "7", "8"] as Cell[]).map(d => ({ id: d as Tool, label: d, title: `Reveal with a ${d} (key ${d})` })),
		{ id: "M", label: "Mine", title: "A covered mine" }, { id: "S", label: "Safe", title: "A covered safe cell" }, { id: "erase", label: "Clear", title: "Back to undecided" }
	];

	return (
		<AdminPage title="Puzzle Builder" sub="Draw a position: pick a tool, click cells. Numbers reveal a cell with that clue; Mine and Safe decide covered cells. Keys work too: 0 to 8, M, S and Backspace change the selected cell, arrows move the selection. The solver checks the position after every edit." wide>
			<div className={styles.layout}>
				<div className={styles.editor}>
					<div className={styles.toolbar}>
						<div className={styles.tools}>{tools.map(t => <button key={t.id} type="button" title={t.title} className={`${styles.tool} ${tool === t.id ? styles.toolActive : ""} ${t.id === "M" ? styles.toolMine : t.id === "S" ? styles.toolSafe : ""}`} style={NUMBER_COLORS[t.id] ? { color: NUMBER_COLORS[t.id] } : undefined} onClick={() => setTool(t.id)}>{t.label}</button>)}</div>
						<div className={adminStyles.row}>
							<label className={adminStyles.label}>Size</label>
							<select className={adminStyles.input} value={spec.rows} onChange={e => resize(Number(e.target.value), spec.cols)}>{[3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} rows</option>)}</select>
							<select className={adminStyles.input} value={spec.cols} onChange={e => resize(spec.rows, Number(e.target.value))}>{[3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} cols</option>)}</select>
							<button type="button" className="btn" onClick={clearBoard}>Clear board</button>
							<label className={styles.checkRow}><input type="checkbox" checked={showNext} onChange={e => setShowNext(e.target.checked)} /> Show next move</label>
						</div>
					</div>
					<div className={styles.board} style={{ gridTemplateColumns: `repeat(${spec.cols}, ${cellPx}px)`, gridAutoRows: cellPx + "px" }} onContextMenu={e => e.preventDefault()}>
						{spec.cells.map((row, r) => row.map((v, c) => {
							const digit = v !== "?" && v !== "M" && v !== "S";
							const mark = !a ? "" : has(a.determinedSafe, r, c) ? styles.detSafe : has(a.determinedMine, r, c) ? styles.detMine : has(a.ambiguous, r, c) ? styles.amb : has(a.free, r, c) ? styles.free : "";
							const next = showNext && a && a.nextMove && has(a.nextMove.cells, r, c) ? styles.next : "";
							const split = showNext && a && a.nextMove && a.nextMove.splitCell && a.nextMove.splitCell[0] === r && a.nextMove.splitCell[1] === c ? styles.split : "";
							const selected = sel && sel[0] === r && sel[1] === c ? styles.selected : "";
							return (
								<button key={r + "," + c} type="button" className={`${styles.cell} ${digit ? styles.revealed : styles.covered} ${v === "M" ? styles.mine : v === "S" ? styles.safe : ""} ${mark} ${next} ${split} ${selected}`}
									style={digit ? { color: NUMBER_COLORS[v] } : undefined} title={`(${r},${c})`}
									onClick={() => { paint(r, c); setSel([r, c]); }} onContextMenu={() => { setCell(r, c, v === "M" ? "?" : "M"); setSel([r, c]); }}>
									{digit ? (v === "0" ? "" : v) : v === "M" ? "●" : v === "S" ? "○" : ""}
								</button>
							);
						}))}
					</div>
					<div className={styles.legend}><span><i className={styles.detSafe} /> clues force safe</span><span><i className={styles.detMine} /> clues force a mine</span><span><i className={styles.amb} /> ambiguous</span><span><i className={styles.free} /> no clue touches it</span><span><i className={styles.next} /> solver's next move</span><span>right-click: toggle mine</span></div>
				</div>

				<aside className={styles.panel}>
					<div className={labStyles.panelTitle}>Solver{busy ? <span className={styles.busy}> {busy}…</span> : null}</div>
					{!a ? <p className={adminStyles.muted}>Reveal a cell with a number to start.</p> : a.error ? <p className={styles.err}>{a.error}</p> : (
						<>
							<div className={`${styles.verdict} ${a.contradiction ? styles.verdictErr : complete || a.layouts === 1 ? styles.verdictOk : styles.verdictWarn}`}>
								{a.contradiction ? "Contradiction: no mine layout fits these clues." : complete ? "Complete: every cell is decided and the clues agree." : a.layouts === 1 ? "Determined: exactly one layout fits the clues." : `Ambiguous: ${a.capped ? "more than " : ""}${a.layouts} layouts fit the clues.`}
							</div>
							<div className={styles.stats}>
								<div><span className={adminStyles.label}>Clues</span><b>{a.clues}</b></div>
								<div><span className={adminStyles.label}>Forced safe</span><b>{a.determinedSafe.length}</b></div>
								<div><span className={adminStyles.label}>Forced mine</span><b>{a.determinedMine.length}</b></div>
								<div><span className={adminStyles.label}>Ambiguous</span><b>{a.ambiguous.length}</b></div>
								<div><span className={adminStyles.label}>Untouched</span><b>{a.free.length}</b></div>
							</div>
							<div className={styles.block}>
								<div className={styles.blockTitle}>Next move</div>
								{a.contradiction ? <p className={adminStyles.muted}>Nothing to solve.</p> : !a.nextMove ? <p className={styles.warnText}>{a.determinedSafe.length || a.determinedMine.length ? "The clues force cells, but the solver finds no move: this needs a deduction it does not make." : "The solver finds no move from these clues."}</p> : (
									<p>{a.nextMove.method === "case" ? `Case split on (${a.nextMove.splitCell}): ${a.nextMove.action === "reveal" || a.nextMove.changed.length ? a.nextMove.changed.length + " cell(s)" : ""}` : `${a.nextMove.method} ${a.nextMove.action}: ${a.nextMove.cells.length} cell(s)`}, cost <b>{a.nextMove.complexity}</b> <span className={adminStyles.muted}>({TIER_NAMES[tierOfCost(a.nextMove.complexity)]} territory)</span></p>
								)}
							</div>
							<div className={styles.block}>
								<div className={styles.blockTitle}>{complete ? "This puzzle" : "Completed with the first fitting layout"}</div>
								{!a.preview ? <p className={adminStyles.muted}>No layout to complete.</p> : a.preview.solved ? (
									<p><b>{TIER_NAMES[a.preview.difficulty]}</b>, score {a.preview.score}, rating <b>{a.preview.rating}</b>, {a.preview.moves} moves, hardest {a.preview.maxComplexity}, {a.preview.mines} mines.</p>
								) : <p className={styles.warnText}>Not solvable by the solver as completed: it gets stuck with {a.preview.safeLeft} safe cells left. {complete ? "" : "Autocomplete searches for a layout that is."}</p>}
							</div>
						</>
					)}
					<div className={styles.actions}>
						<button type="button" className="btn" disabled={!!busy || !a || a.contradiction} onClick={autocomplete}>Autocomplete</button>
						<label className={styles.densityField} title="Mines among the cells no clue touches. The rest of the board is seeded at this share, and the fill that makes the hardest solvable puzzle wins."><span>Rest</span><input type="number" className={adminStyles.input} min={0} max={60} step={5} value={density} onChange={e => setDensity(Math.max(0, Math.min(60, parseInt(e.target.value, 10) || 0)))} /><span>%</span></label>
						<input className={adminStyles.input} placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
						<button type="button" className="btn btn-primary" disabled={!!busy || !complete || !a} title={complete ? "" : "Decide every cell first (or Autocomplete)"} onClick={save}>Save to collection</button>
					</div>
					{status && <div className={`${adminStyles.status} ${status.kind === "err" ? styles.err : status.kind === "warn" ? styles.warnText : styles.okText}`}>{status.text}</div>}
				</aside>
			</div>

			<LabSection title="Your collection" sub="Saved puzzles with the solver's rating. Publish puts one into the pool as an ordinary puzzle, playable at its /puzzles link and served by the ladder.">
				{!saved.length ? <p className={adminStyles.muted}>Nothing saved yet.</p> : (
					<div className={adminStyles.tableWrap}><table className={adminStyles.table}><thead><tr><th>Name</th><th>Size</th><th>Tier</th><th>Rating</th><th>Score</th><th>Method</th><th>Saved</th><th></th></tr></thead><tbody>
						{saved.map(p => <tr key={p.id}>
							<td><strong>{p.name}</strong></td><td className={adminStyles.mono}>{p.rows}x{p.cols}</td>
							<td>{p.solved ? TIER_NAMES[p.difficulty] : <span className={styles.err}>Unsolvable</span>}</td>
							<td className={adminStyles.mono}>{p.rating ?? "–"}</td><td className={adminStyles.mono}>{p.score}</td><td>{p.cspMethod || "–"}</td>
							<td className={adminStyles.muted}>{new Date(p.createdAt).toLocaleDateString()}</td>
							<td className={styles.rowActions}>
								<button type="button" className="btn" onClick={() => load(p)}>Load</button>
								{p.poolPuzzleId ? <Link className="btn" to={`/puzzles/${p.poolPuzzleId}`}>Play #{p.poolPuzzleId}</Link> : <button type="button" className="btn" disabled={!p.solved} onClick={() => publish(p)}>Publish</button>}
								<button type="button" className={`btn ${styles.danger}`} onClick={() => remove(p)}>Delete</button>
							</td>
						</tr>)}
					</tbody></table></div>
				)}
			</LabSection>
		</AdminPage>
	);
}
