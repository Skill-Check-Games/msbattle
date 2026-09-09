// Puzzle Lab: the server-side puzzle pool (SQLite) and the background generation job that fills it.
// Generate posts a job; while it runs we poll /api/puzzles every 500 ms for progress + pool contents
// and stop once the server reports no job.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../shared/auth";
import LearnPuzzle from "../learn/LearnPuzzle";
import { AdminPage, adminStyles } from "./admin-shared";
import { ChipRow, boardStyles } from "./admin-boards";
import styles from "./PuzzleLab.module.scss";

const BATCHES = [20, 50, 100, 200];
const SOURCE_OPTIONS = [{ key: "random", label: "Random + analyze" }, { key: "inside_out", label: "Inside-out" }];
const TARGET_RATING_OPTIONS: { key: number | null; label: string }[] = [
	{ key: null, label: "Any" }, { key: 200, label: "~200" }, { key: 500, label: "~500" }, { key: 900, label: "~900" }, { key: 1300, label: "~1300" }, { key: 1700, label: "~1700" }
];
const DENSITY_OPTIONS: { key: number | null; label: string }[] = [
	{ key: null, label: "Mix" }, { key: 0.10, label: "10%" }, { key: 0.15, label: "15%" }, { key: 0.20, label: "20%" }, { key: 0.25, label: "25%" },
	{ key: 0.30, label: "30%" }, { key: 0.35, label: "35%" }, { key: 0.40, label: "40%" }, { key: 0.45, label: "45%" }
];
const DIFF_OPTIONS: { key: number | null; label: string; className?: string }[] = [
	{ key: null, label: "All" }, ...[1, 2, 3, 4, 5, 6].map(d => ({ key: d, label: String(d) }))
];

// Generate / clear carry the session token; the server resolves it and checks is_admin.
function adminHeaders(): Record<string, string> {
	try { const t = localStorage.getItem("ms_session"); return t ? { "X-Session-Token": t } : {}; } catch { return {}; }
}

interface Job { id: number; done: number; target: number; diff?: number | null; density?: number | null; dupes?: number; }
interface Puzzle { id: number; rows: number; cols: number; mines: number[][]; revealed: number[][]; difficulty: number; rating?: number; score: number; coveredSafe: number; cspMethod?: string; maxEnumSize?: number; }

export default function PuzzleLab() {
	const { account } = useAuth();
	const ready = !!account;
	const [count, setCount] = useState(50);
	const [diff, setDiff] = useState<number | null>(null);
	const [density, setDensity] = useState<number | null>(null);
	const [source, setSource] = useState("random");
	const [targetRating, setTargetRating] = useState<number | null>(null);
	const [status, setStatus] = useState("");
	const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
	const [polling, setPolling] = useState(false);
	const pollingRef = useRef(false); pollingRef.current = polling;

	const refreshPool = useCallback(async () => {
		try {
			const r = await fetch("/api/puzzles" + (diff ? "?diff=" + diff : ""));
			const data = await r.json();
			const list: Puzzle[] = (data && data.puzzles) || [];
			const poolSize = data && data.pool != null ? data.pool : list.length;
			const job: Job | null = (data && data.job) || null;
			if (pollingRef.current && !job) setPolling(false);
			const bits = ["Pool: " + poolSize + " puzzles"];
			if (diff) bits.push("filter: diff " + diff + " (" + list.length + ")");
			if (job) {
				let jobBit = "job " + job.id + ", " + job.done + "/" + job.target;
				if (job.diff) jobBit += " · diff " + job.diff;
				if (job.density != null) jobBit += " · density " + Math.round(job.density * 100) + "%";
				if (job.dupes) jobBit += " (" + job.dupes + " dupes skipped)";
				bits.push(jobBit);
			}
			setStatus(bits.join(" · "));
			list.sort((a, b) => (a.score || 0) - (b.score || 0));
			setPuzzles(list);
		} catch (e: any) { setStatus("Error: " + e.message); }
	}, [diff]);

	useEffect(() => { if (ready) refreshPool(); }, [ready, refreshPool]);
	useEffect(() => {
		if (!polling) return;
		const t = setInterval(refreshPool, 500);
		return () => clearInterval(t);
	}, [polling, refreshPool]);

	async function startJob(n: number) {
		setCount(n);
		setStatus("Starting generation job…");
		const url = "/api/puzzles?count=" + n
			+ (diff ? "&diff=" + diff : "")
			+ (density != null ? "&density=" + density : "")
			+ (source !== "random" ? "&source=" + source : "")
			+ (source === "inside_out" && targetRating != null ? "&targetRating=" + targetRating : "");
		try {
			const r = await fetch(url, { method: "POST", headers: adminHeaders() });
			const data = await r.json().catch(() => null);
			if (!r.ok) { setStatus("Couldn't start: " + (data && data.error ? data.error : "HTTP " + r.status)); return; }
			refreshPool();
			setPolling(true);
		} catch (e: any) { setStatus("Error: " + e.message); }
	}

	return (
		<AdminPage title="Puzzle Lab" sub="Server-side puzzle pool, persisted in SQLite. Each puzzle has a chess-style rating calibrated from the solver score (rating ≈ 400 + 350·score^0.6). Badge shows rating + tier; meta line shows board size, density, raw score, and the hardest CSP deduction needed.">
			<p className={styles.browse}><Link to="/admin/puzzles">Browse all puzzles →</Link></p>
			<div className={styles.actions}>
				{BATCHES.map(n => (
					<button key={n} type="button" className={`${styles.batch} ${n === count ? styles.batchPrimary : ""}`} onClick={() => startJob(n)}>Generate {n}</button>
				))}
			</div>
			<ChipRow label="Generator" options={SOURCE_OPTIONS} value={source} onChange={setSource} />
			{source === "inside_out" && <ChipRow label="Target rating" options={TARGET_RATING_OPTIONS} value={targetRating} onChange={setTargetRating} />}
			<ChipRow label="Mine density" options={DENSITY_OPTIONS} value={density} onChange={setDensity} />
			<ChipRow label="Difficulty" options={DIFF_OPTIONS} value={diff} onChange={setDiff} />
			<p className={boardStyles.status}>{status}</p>
			<div className={boardStyles.puzzlesGrid}>
				{puzzles.map(p => <PuzzleCard key={p.id} p={p} />)}
			</div>
		</AdminPage>
	);
}

function PuzzleCard({ p }: { p: Puzzle }) {
	let method = p.cspMethod || "trivial";
	if (p.cspMethod === "enum" && p.maxEnumSize) method += "(" + p.maxEnumSize + ")";
	const density = Math.round((p.mines.length / (p.rows * p.cols)) * 100);
	return (
		<div className={`${adminStyles.card} ${styles.card}`}>
			<div className={styles.cardHead}>
				<span className={`${styles.badge} ${styles["diff" + p.difficulty] || ""}`}>{(p.rating != null ? p.rating : "?") + " · t" + p.difficulty}</span>
				<span className={styles.meta}>{p.rows}×{p.cols} · {p.coveredSafe} covered · {density}% · score {p.score.toFixed(1)} · {method}</span>
			</div>
			<LearnPuzzle puzzle={{ rows: p.rows, cols: p.cols, mines: p.mines, revealed: p.revealed }} compact hideKbdHint />
		</div>
	);
}
