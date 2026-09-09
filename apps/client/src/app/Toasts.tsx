// Bottom-right toast stack (achievement unlocks). Auto-dismisses, click or swipe to dismiss.
// Unlocks are detected by diffing each achievement's reached tiers against the last snapshot
// whenever fresh match history lands; the first snapshot after connect baselines silently.
import { useEffect, useRef, useState } from "react";
import { onSocket } from "../online/socket";
import { useAuth } from "../shared/auth";
import { computeAll, Computed } from "../shared/achievements";
import { sound } from "../audio/sound";
import styles from "./Toasts.module.scss";

interface Toast { id: number; icon: string; label: string; name: string; complete: boolean; }
const listeners = new Set<(t: Toast) => void>();
let seq = 0;
export function pushToast(t: Omit<Toast, "id">) { const toast = { ...t, id: ++seq }; listeners.forEach(cb => cb(toast)); }

export function Toasts() {
	const [toasts, setToasts] = useState<Toast[]>([]);
	useEffect(() => { const cb = (t: Toast) => setToasts(list => [...list, t]); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
	return <div className={styles.stack}>{toasts.map(t => <ToastItem key={t.id} toast={t} onDone={() => setToasts(list => list.filter(x => x.id !== t.id))} />)}</div>;
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
	const [phase, setPhase] = useState<"in" | "shown" | "out">("in");
	const [drag, setDrag] = useState<{ x: number; dx: number } | null>(null);
	const dismissed = useRef(false);
	const dismiss = (exitDX = 0) => { if (dismissed.current) return; dismissed.current = true; setPhase("out"); setDrag(exitDX ? { x: 0, dx: exitDX } : null); setTimeout(onDone, 450); };
	useEffect(() => { const a = requestAnimationFrame(() => setPhase("shown")); const t = setTimeout(() => dismiss(), 5000); sound.beep(toast.complete ? 1175 : 988); return () => { cancelAnimationFrame(a); clearTimeout(t); }; }, []);
	const style = drag ? { transform: `translateX(${phase === "out" ? (drag.dx > 0 ? "125%" : "-125%") : drag.dx + "px"})`, opacity: phase === "out" ? 0 : Math.max(0.15, 1 - Math.abs(drag.dx) / 200), transition: phase === "out" ? undefined : "none" } : undefined;
	return (
		<div className={`${styles.toast} ${toast.complete ? styles.complete : ""} ${phase === "shown" ? styles.in : phase === "out" ? styles.out : ""}`} style={style} onClick={() => dismiss()}
			onTouchStart={(e) => setDrag({ x: e.touches[0].clientX, dx: 0 })}
			onTouchMove={(e) => drag && setDrag({ x: drag.x, dx: e.touches[0].clientX - drag.x })}
			onTouchEnd={() => { if (!drag) return; if (Math.abs(drag.dx) > 60) dismiss(drag.dx); else setDrag(null); }}>
			<span className={styles.icon}>{toast.icon}</span>
			<div><div className={styles.label}>{toast.label}</div><div className={styles.name}>{toast.name}</div></div>
		</div>
	);
}

// Watches match_history payloads (which carry the achievement stats) and toasts new tiers.
export function useAchievementUnlocks() {
	const { account } = useAuth();
	const last = useRef<number[] | null>(null);
	const accountRef = useRef(account); accountRef.current = account;
	useEffect(() => onSocket("match_history", (d) => {
		const acc = accountRef.current; if (!acc) { last.current = null; return; }
		const computed: Computed[] = computeAll({ ...acc, ...((d && d.stats) || {}) });
		const now = computed.map(c => c.reached);
		if (last.current) computed.forEach((c, i) => { if (now[i] > (last.current![i] || 0)) pushToast({ icon: c.icon, label: c.complete ? "Achievement complete" : "Achievement unlocked", name: c.name, complete: c.complete }); });
		last.current = now;
	}), []);
	useEffect(() => { if (!account) last.current = null; }, [account && account.name]);
}
