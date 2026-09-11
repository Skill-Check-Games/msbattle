// A screen-centred result dialog (round or series result, solo outcome). Its buttons form a
// keyboard group: the primary is focused on open, arrows move between buttons, Enter activates.
import { useEffect, useRef, ReactNode } from "react";
import styles from "./ResultPanel.module.scss";

// slow: a longer, plain fade-in (the round-end banner lifts away over the same time, so the two cross).
export function ResultPanel({ kind, children, className, slow }: { kind?: "win" | "lose" | "neutral"; children: ReactNode; className?: string; slow?: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const panel = ref.current!;
		const buttons = () => Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
		buttons()[0]?.focus();
		const onKey = (e: KeyboardEvent) => {
			const list = buttons(); if (!list.length) return;
			const i = list.indexOf(document.activeElement as HTMLButtonElement);
			if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); list[(i + 1 + list.length) % list.length].focus(); }
			else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
			else if (e.key === "Enter" && i === -1) { e.preventDefault(); list[0].click(); }
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);
	return (
		<div ref={ref} className={`${styles.panel} ${slow ? styles.slow : ""} ${kind === "win" ? styles.win : kind === "lose" ? styles.lose : ""} ${className || ""} kbd-btn-group`} role="dialog" aria-modal="true">
			{children}
		</div>
	);
}

export function ResultHeader({ children }: { children: ReactNode }) { return <div className={styles.header}>{children}</div>; }
export function ResultDetail({ children, color }: { children: ReactNode; color?: string }) { return <div className={styles.detail} style={color ? { color } : undefined}>{children}</div>; }
export function ResultFoot({ children }: { children: ReactNode }) { return <div className={styles.foot}>{children}</div>; }
export function ResultActions({ children }: { children: ReactNode }) { return <div className={styles.actions}>{children}</div>; }
