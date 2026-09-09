// Admin "Board animations" lab (/admin/countdown): a tabbed live preview of the three board animation
// systems, each looping on its own 16x20 board (ranked's medium size): the round-start countdown
// digits, the one-shot "go" sweep that precedes them, and the idle twinkle shown while a casual room
// waits for its series. The controls edit the same style objects a real round reads
// (board-session.ts), so tuning here tunes the actual game. Ported from the legacy admin/CountdownLab.js;
// the legacy lab's alternative digit/sweep/idle styles were not carried into the React engine (it
// ships one style each), so only the tuning that exists there is exposed.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BoardSession, COUNTDOWN_STYLE, BOARD_GO_STYLE, BOARD_IDLE_STYLE, naturalCountdownTotalMs } from "../../game/board-session";
import { countDown, cancelCountdown } from "../../game/countdown";
import { DPR } from "../../game/board-render";
import { AdminPage } from "./admin-shared";
import { Seg, SliderRow, ColorRow, labStyles } from "./lab-shared";
import styles from "./CountdownLab.module.scss";

const ROWS = 16, COLS = 20;
type Tab = "digit" | "go" | "idle";
const TABS: { id: Tab; label: string }[] = [{ id: "digit", label: "Countdown digit" }, { id: "go", label: "Go sweep" }, { id: "idle", label: "Idle" }];
const DEFAULTS = {
	countdown: { fadeInMs: 200, holdMs: 300, fadeOutMs: 500, gapMs: 100 },
	go: { durationMs: 700, width: 3, brightness: 0.7, color: "#bfdbfe", pauseAfterMs: 300 },
	idle: { speed: 3, brightness: 0.7, color: "#bfdbfe" }
};
const ms = (v: number) => Math.round(v) + "ms";
const times = (v: number) => v.toFixed(2) + "×";

export default function CountdownLab() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const sessionRef = useRef<BoardSession | null>(null);
	const [tab, setTab] = useState<Tab>("digit");
	const [runSeq, setRunSeq] = useState(0); // bump to restart the active loop (reset to defaults)
	const [, bump] = useState(0);
	const rerender = () => bump(v => v + 1);

	// A covered board bound to the canvas; nothing here accepts input (mode() is null).
	useLayoutEffect(() => {
		const canvas = canvasRef.current!;
		canvas.width = Math.round(600 * DPR); canvas.height = Math.round(480 * DPR);
		const session = new BoardSession({ mode: () => null });
		session.canvas = canvas;
		session.setBoard(ROWS, COLS, () => 0);
		sessionRef.current = session;
		return () => { session.resetAnimations(); session.canvas = null; sessionRef.current = null; };
	}, []);

	// Drive whichever animation the active tab previews, forever, until the tab changes or we unmount.
	useEffect(() => {
		const session = sessionRef.current; if (!session) return;
		let timer: ReturnType<typeof setTimeout> | null = null, alive = true;
		if (tab === "digit") {
			// The real round-start sequence (sweep, then 3-2-1), sized to its natural length, then a breather.
			const loop = () => { if (!alive) return; countDown(session, naturalCountdownTotalMs(), () => { timer = setTimeout(loop, 700); }); };
			loop();
		} else if (tab === "go") {
			const loop = () => { if (!alive) return; session.startBoardGo(); timer = setTimeout(loop, Math.max(700, BOARD_GO_STYLE.durationMs + 500)); };
			loop();
		} else {
			session.setIdle(true);
		}
		return () => {
			alive = false;
			if (timer) clearTimeout(timer);
			cancelCountdown();
			session.setIdle(false);
			session.resetAnimations();
			session.render();
		};
	}, [tab, runSeq]);

	const reset = () => {
		Object.assign(COUNTDOWN_STYLE, DEFAULTS.countdown);
		Object.assign(BOARD_GO_STYLE, DEFAULTS.go);
		Object.assign(BOARD_IDLE_STYLE, DEFAULTS.idle);
		rerender();
		setRunSeq(s => s + 1);
	};
	const edit = (target: any, key: string) => (v: number | string) => { target[key] = v; rerender(); };

	return (
		<AdminPage title="Board animations" sub="Live preview of three separate board animations on their own board (16×20, ranked's medium size); pick a tab to focus on. The controls edit the real style objects a match reads, so this is the exact code, not a copy of it." wide>
			<div className={styles.tabs}>
				{TABS.map(t => <button key={t.id} type="button" className={`${styles.tab} ${t.id === tab ? styles.tabActive : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
			</div>
			<div className={styles.layout}>
				<div className={styles.canvasCard}><canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" /></div>
				<div className={styles.controls}>
					{tab === "digit" && (
						<>
							<h2 className={labStyles.panelTitle}>Tuning</h2>
							<p className={styles.panelSub}>Each digit fades in, holds, fades out, then waits before the next one. A negative delay overlaps consecutive digits.</p>
							<SliderRow label="Fade-in" value={COUNTDOWN_STYLE.fadeInMs} min={0} max={1000} step={50} format={ms} onChange={edit(COUNTDOWN_STYLE, "fadeInMs")} />
							<SliderRow label="Hold" value={COUNTDOWN_STYLE.holdMs} min={0} max={1000} step={50} format={ms} onChange={edit(COUNTDOWN_STYLE, "holdMs")} />
							<SliderRow label="Fade-out" value={COUNTDOWN_STYLE.fadeOutMs} min={0} max={1000} step={50} format={ms} onChange={edit(COUNTDOWN_STYLE, "fadeOutMs")} />
							<SliderRow label="Delay between numbers" value={COUNTDOWN_STYLE.gapMs} min={-900} max={1000} step={50} format={ms} onChange={edit(COUNTDOWN_STYLE, "gapMs")} />
						</>
					)}
					{tab === "go" && (
						<>
							<h2 className={labStyles.panelTitle}>Style</h2>
							<p className={styles.panelSub}>Plays once, the instant the game is ready to start: right before the countdown begins, not after it finishes. Purely decorative, doesn't affect when input actually unlocks.</p>
							<Seg options={[{ id: "diagonal", label: "Diagonal" }]} value="diagonal" onChange={() => undefined} ariaLabel="Style" />
							<ColorRow label="Sweep colour" value={BOARD_GO_STYLE.color} onChange={edit(BOARD_GO_STYLE, "color")} />
							<h2 className={labStyles.panelTitle}>Tuning</h2>
							<SliderRow label="Duration" value={BOARD_GO_STYLE.durationMs} min={150} max={2000} step={50} format={ms} onChange={edit(BOARD_GO_STYLE, "durationMs")} />
							<SliderRow label="Width" value={BOARD_GO_STYLE.width} min={0.5} max={10} step={0.5} format={v => v.toFixed(1) + " cells"} onChange={edit(BOARD_GO_STYLE, "width")} />
							<SliderRow label="Brightness" value={BOARD_GO_STYLE.brightness} min={0.2} max={2} step={0.05} format={times} onChange={edit(BOARD_GO_STYLE, "brightness")} />
							<SliderRow label="Pause after (before the countdown starts)" value={BOARD_GO_STYLE.pauseAfterMs} min={0} max={1500} step={50} format={ms} onChange={edit(BOARD_GO_STYLE, "pauseAfterMs")} />
							<button type="button" className={`btn ${styles.playGo}`} onClick={() => sessionRef.current?.startBoardGo()}>Play sweep now</button>
						</>
					)}
					{tab === "idle" && (
						<>
							<h2 className={labStyles.panelTitle}>Style</h2>
							<p className={styles.panelSub}>Plays continuously while a casual room is waiting for its series to start.</p>
							<Seg options={[{ id: "twinkle", label: "Twinkle" }]} value="twinkle" onChange={() => undefined} ariaLabel="Style" />
							<ColorRow label="Colour" value={BOARD_IDLE_STYLE.color} onChange={edit(BOARD_IDLE_STYLE, "color")} />
							<h2 className={labStyles.panelTitle}>Tuning</h2>
							<SliderRow label="Speed" value={BOARD_IDLE_STYLE.speed} min={0.2} max={3} step={0.1} format={v => v.toFixed(1) + "×"} onChange={edit(BOARD_IDLE_STYLE, "speed")} />
							<SliderRow label="Brightness" value={BOARD_IDLE_STYLE.brightness} min={0.2} max={2} step={0.05} format={times} onChange={edit(BOARD_IDLE_STYLE, "brightness")} />
						</>
					)}
					<button type="button" className={`btn ${styles.reset}`} onClick={reset}>Reset to defaults</button>
				</div>
			</div>
		</AdminPage>
	);
}
