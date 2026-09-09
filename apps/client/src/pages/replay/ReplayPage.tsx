// Replay playback: one focused board above a filmstrip of every player, scrubbable on a timeline.
// Each player's state is re-simulated once per frame and drawn into every view showing it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getSocket, onSocket } from "../../online/socket";
import { useAuth } from "../../shared/auth";
import { AvatarChip } from "../../shared/Avatar";
import { BoardView, BOARD_SKIN_LIST, DEFAULT_AVATAR, sizeCellCanvas } from "../../game/board-render";
import { decodeReplay, buildRoundModel, stateAt, roundDuration, Replay } from "./replay-decode";
import styles from "./ReplayPage.module.scss";

interface ReplayData { id: number; createdAt?: number; winnerId?: number | null; error?: string; data?: ArrayBuffer | { buffer: ArrayBuffer }; }
const fmtTime = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); };
const styleName = (rep: Replay) => { const m = (rep.mode || rep.style || "").replace(/_/g, " "); return m ? m.charAt(0).toUpperCase() + m.slice(1) : "Match"; };
const stageCellPx = (cols: number) => Math.max(12, Math.min(32, Math.floor(560 / cols)));
const thumbCellPx = (cols: number) => Math.max(5, Math.min(12, Math.floor(150 / cols)));
const skinFor = (skin: string | null) => (skin && BOARD_SKIN_LIST.indexOf(skin) >= 0) ? skin : "classic";
const SPEEDS = [0.5, 1, 2, 4];

export default function ReplayPage() {
	const [params] = useSearchParams();
	const id = parseInt(params.get("id") || "", 10);
	const { account } = useAuth();
	const [status, setStatus] = useState("Loading replay…");
	const [rep, setRep] = useState<{ rep: Replay; winnerId: number | null; createdAt?: number } | null>(null);

	// Wait for the session to attach: the server resolves the replay against the signed-in user.
	useEffect(() => {
		if (!id) { setStatus("Replay not found."); return; }
		if (!account) return;
		const off = onSocket("replay_data", (d: ReplayData) => {
			if (!d || d.id !== id) return;
			if (d.error) { setStatus(`Replay unavailable (${d.error}).`); return; }
			try {
				const raw = d.data as any; const u8 = raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer || raw);
				setRep({ rep: decodeReplay(u8), winnerId: d.winnerId || null, createdAt: d.createdAt });
			} catch { setStatus("Replay could not be decoded."); }
		});
		getSocket().emit("get_replay", { id });
		return off;
	}, [id, !!account]);

	if (!rep) return <section><Link to="/profile" className={styles.back}>← Back to profile</Link><div className={styles.status}>{status}</div></section>;
	return <Player rep={rep.rep} winnerId={rep.winnerId} createdAt={rep.createdAt} myUserId={account?.userId ?? null} />;
}

function Player({ rep, winnerId, createdAt, myUserId }: { rep: Replay; winnerId: number | null; createdAt?: number; myUserId: number | null }) {
	const [roundIdx, setRoundIdx] = useState(0);
	const [focus, setFocus] = useState(() => { const i = rep.players.findIndex(p => p.userId && p.userId === myUserId); return i < 0 ? 0 : i; });
	const [playing, setPlaying] = useState(false);
	const [speed, setSpeed] = useState(1);
	const [playT, setPlayT] = useState(0);
	const round = rep.rounds[roundIdx];
	const model = useMemo(() => buildRoundModel(rep, round), [rep, round]);
	const duration = useMemo(() => roundDuration(round), [round]);
	// Shared mutable state per player; every view of that player draws from the same array.
	const states = useMemo(() => rep.players.map(() => model.freshState()), [model]);
	const views = useRef<BoardView[][]>([]);
	const lastApplied = useRef<number[]>([]);
	const playTRef = useRef(0); playTRef.current = playT;

	const viewsModel = useRef<unknown>(null);
	const bound = useRef(new WeakSet<HTMLCanvasElement>());
	// Callback ref: binds a BoardView once per canvas; a canvas that unmounts drops its stale view.
	const registerCanvas = (p: number, canvas: HTMLCanvasElement | null, px: number) => {
		if (viewsModel.current !== model) { viewsModel.current = model; views.current = []; }
		if (!canvas) { views.current[p] = (views.current[p] || []).filter(v => v.canvas.isConnected); return; }
		if (bound.current.has(canvas)) return;
		bound.current.add(canvas);
		sizeCellCanvas(canvas, rep.cols, rep.rows, px);
		const v = new BoardView(canvas, rep.rows, rep.cols, states[p], model.cellAt, { skin: skinFor(rep.players[p].skin) });
		(views.current[p] ||= []).push(v);
		v.draw();
	};
	// Re-sim + draw. Skips players whose applied-event count is unchanged unless forced.
	const renderFrame = (T: number, force: boolean) => {
		for (let p = 0; p < states.length; p++) {
			const res = stateAt(model, round.tracks[p], T);
			if (!force && res.applied === lastApplied.current[p]) continue;
			lastApplied.current[p] = res.applied;
			const st = states[p];
			for (let r = 0; r < model.R; r++) for (let c = 0; c < model.C; c++) st[r][c] = res.state[r][c];
			for (const v of views.current[p] || []) v.draw();
		}
	};
	useEffect(() => { lastApplied.current = []; setPlayT(0); playTRef.current = 0; setPlaying(false); renderFrame(0, true); }, [model]);
	useEffect(() => { renderFrame(playTRef.current, true); }, [focus]);
	useEffect(() => {
		if (!playing) return;
		let raf = 0, last = 0;
		const tick = (ts: number) => {
			if (!last) last = ts;
			let t = playTRef.current + (ts - last) * speed; last = ts;
			if (t >= duration) { t = duration; setPlaying(false); }
			playTRef.current = t; setPlayT(t); renderFrame(t, false);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing, speed, duration]);

	const togglePlay = () => {
		if (!playing && playT >= duration) { setPlayT(0); playTRef.current = 0; lastApplied.current = []; renderFrame(0, true); }
		setPlaying(p => !p);
	};
	const scrub = (v: number) => { setPlaying(false); setPlayT(v); playTRef.current = v; renderFrame(v, true); };
	const selectRound = (i: number) => { setRoundIdx(i); };

	// A plain render helper (not a nested component) so canvases are not remounted on every frame.
	const board = (p: number, px: number, stage?: boolean) => {
		const pl = rep.players[p];
		return (
			<div className={`${styles.board} ${stage ? styles.stageBoard : styles.thumb} ${!stage && p === focus ? styles.focused : ""}`} onClick={stage ? undefined : () => setFocus(p)}>
				<div className={styles.label}>
					<AvatarChip avatar={pl.avatar || DEFAULT_AVATAR} country={pl.country} px={stage ? 40 : 28} />
					<span>{pl.name}</span>
					{winnerId && pl.userId === winnerId && <span>🏆</span>}
				</div>
				<canvas key={`${roundIdx}-${p}-${px}`} ref={el => registerCanvas(p, el, px)} className={styles.canvas} />
			</div>
		);
	};

	return (
		<section>
			<div className={styles.topbar}>
				<Link to="/profile" className={styles.back}>← Back</Link>
				<div className={styles.title}>{styleName(rep)} · {rep.rows}×{rep.cols}</div>
				<div className={styles.when}>{createdAt ? new Date(createdAt).toLocaleString() : ""}</div>
			</div>
			{rep.gameCount > 1 && (
				<div className={styles.rounds}>
					{rep.rounds.map((_, g) => <button key={g} type="button" className={`${styles.roundTab} ${g === roundIdx ? styles.active : ""}`} onClick={() => selectRound(g)}>Game {g + 1}</button>)}
				</div>
			)}
			<div className={styles.stage} key={`stage-${roundIdx}-${focus}`}>{board(focus, stageCellPx(rep.cols), true)}</div>
			<div className={styles.strip} key={`strip-${roundIdx}`}>{rep.players.map((_, p) => <div key={p}>{board(p, thumbCellPx(rep.cols))}</div>)}</div>
			<div className={styles.controls}>
				<button type="button" className={styles.play} onClick={togglePlay}>{playing ? "❚❚ Pause" : "▶ Play"}</button>
				<input type="range" className={styles.slider} min={0} max={Math.round(duration)} step={50} value={Math.round(playT)} onChange={e => scrub(parseInt(e.target.value, 10) || 0)} />
				<span className={styles.time}>{fmtTime(playT)} / {fmtTime(duration)}</span>
				<div className={styles.speeds}>{SPEEDS.map(m => <button key={m} type="button" className={`${styles.speed} ${m === speed ? styles.active : ""}`} onClick={() => setSpeed(m)}>{m}×</button>)}</div>
			</div>
		</section>
	);
}
