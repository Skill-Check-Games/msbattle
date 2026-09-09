// Settings: on-device preferences. Gameplay (auto fullscreen), Audio (effects volume; music once
// the music layer lands), and Controls (rebindable keys, click a key to capture a new one).
import { useEffect, useState } from "react";
import { sound } from "../../audio/sound";
import { keybindings, KEY_ACTIONS, KeyAction } from "../../shared/keybindings";
import styles from "./SettingsPage.module.scss";

const AUTO_FS_KEY = "ms_auto_fullscreen";
export function autoFullscreenEnabled(): boolean { try { return localStorage.getItem(AUTO_FS_KEY) === "1"; } catch { return false; } }
export function setAutoFullscreenEnabled(on: boolean) { try { localStorage.setItem(AUTO_FS_KEY, on ? "1" : "0"); } catch { /* storage blocked */ } }

export default function SettingsPage() {
	const [autoFs, setAutoFs] = useState(autoFullscreenEnabled());
	const [effects, setEffects] = useState(Math.round(sound.getVolume() * 100));
	return (
		<section>
			<h1 className={styles.title}>Settings</h1>
			<div className={styles.card}>
				<h2 className={styles.cardTitle}>Gameplay</h2>
				<div className={styles.row}>
					<div className={styles.rowText}><span className={styles.rowLabel}>Auto fullscreen</span><span className={styles.rowNote}>Jump into fullscreen the moment a game starts. Off by default. The in-game fullscreen button works any time.</span></div>
					<button type="button" className={`${styles.toggle} ${autoFs ? styles.on : ""}`} aria-pressed={autoFs} onClick={() => { const n = !autoFs; setAutoFs(n); setAutoFullscreenEnabled(n); }} />
				</div>
			</div>
			<div className={styles.card}>
				<h2 className={styles.cardTitle}>Audio</h2>
				<div className={styles.row}>
					<div className={styles.rowText}><span className={styles.rowLabel}>Effects</span></div>
					<input type="range" className={styles.slider} min={0} max={100} step={1} value={effects} aria-label="Effects volume" onChange={(e) => { const v = Number(e.target.value); setEffects(v); sound.unlock(); sound.setVolume(v / 100); sound.setMuted(v === 0); }} />
				</div>
			</div>
			<ControlsCard />
		</section>
	);
}

export function ControlsCard() {
	const [, bump] = useState(0);
	const [capturing, setCapturing] = useState<KeyAction | null>(null);
	useEffect(() => {
		if (!capturing) return;
		const onKey = (e: KeyboardEvent) => {
			e.preventDefault(); e.stopPropagation();
			const k = e.key;
			if (k === "Escape") { setCapturing(null); return; }
			if (k === "Shift" || k === "Control" || k === "Alt" || k === "Meta") return;
			keybindings.set(capturing, k); setCapturing(null); bump(n => n + 1);
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [capturing]);
	return (
		<div className={styles.card}>
			<h2 className={styles.cardTitle}>Controls</h2>
			<p className={styles.note}>Keyboard controls for solving. Click a key to rebind it. Hold Shift with movement to skip revealed cells.</p>
			<div className={styles.keys}>
				{KEY_ACTIONS.map(act => {
					const bound = keybindings.get(act.id);
					return (
						<div key={act.id} className={styles.keyRow}>
							<span className={styles.keyLabel}>{act.label}</span>
							<button type="button" className={`${styles.key} ${capturing === act.id ? styles.capturing : ""} ${!bound ? styles.unbound : ""}`} onClick={() => setCapturing(act.id)}>{capturing === act.id ? "Press a key…" : keybindings.label(bound)}</button>
						</div>
					);
				})}
			</div>
			<button type="button" className="btn" onClick={() => { keybindings.reset(); bump(n => n + 1); }}>Reset to defaults</button>
		</div>
	);
}
