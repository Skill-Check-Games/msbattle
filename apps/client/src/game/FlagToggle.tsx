// The flag-mode toggle (design G·09): one 46px button in the board card's bottom-right corner, the same flag in
// both states — grey when taps reveal, red on a red-tinted, red-bordered button when taps flag. Shared by the
// puzzle page and the play page (1v1 and 6-player) on phones; the host must be position: relative.
import styles from "./FlagToggle.module.scss";

export function FlagToggle({ on, onToggle, className }: { on: boolean; onToggle: () => void; className?: string }) {
	return (
		<button type="button" className={`${styles.toggle} ${on ? styles.on : ""} ${className || ""}`} aria-pressed={on} aria-label={on ? "Flag mode on: taps place flags" : "Flag mode off: taps reveal"} onClick={onToggle}>
			<svg width="27" height="27" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M7 3v18" stroke={on ? "#e2e8f0" : "var(--muted)"} strokeWidth="2.2" strokeLinecap="round" />
				<path d="M7 4l11 3.5L7 11.5z" fill={on ? "var(--danger)" : "var(--muted)"} />
			</svg>
		</button>
	);
}
