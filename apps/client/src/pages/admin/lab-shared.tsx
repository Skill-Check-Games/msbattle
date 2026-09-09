// Widgets the admin labs share: the segmented picker, slider and colour rows, an on/off switch, and
// the section + candidate-card shells (title, description, a Play button) every lab page uses.
import { ReactNode } from "react";
import styles from "./lab-shared.module.scss";

export function Seg<T extends string>({ options, value, onChange, ariaLabel, className }: { options: { id: T; label: string }[]; value: T; onChange: (id: T) => void; ariaLabel?: string; className?: string }) {
	return (
		<div className={`${styles.seg} ${className || ""}`} role="group" aria-label={ariaLabel}>
			{options.map(o => (
				<button key={o.id} type="button" className={o.id === value ? styles.segActive : undefined} onClick={() => onChange(o.id)}>{o.label}</button>
			))}
		</div>
	);
}

export function SliderRow({ label, note, value, min, max, step, format, onChange }: { label: string; note?: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
	return (
		<div className={styles.sliderRow}>
			<div className={styles.rowText}><span className={styles.rowLabel}>{label}</span>{note && <span className={styles.rowNote}>{note}</span>}</div>
			<span className={styles.val}>{format(value)}</span>
			<input type="range" className={styles.slider} min={min} max={max} step={step} value={value} aria-label={label} onChange={e => onChange(parseFloat(e.target.value))} />
		</div>
	);
}

export function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
	return (
		<div className={styles.colorRow}>
			<span className={styles.rowLabel}>{label}</span>
			<span className={styles.val}>{value}</span>
			<input type="color" className={styles.color} value={value} aria-label={label} onChange={e => onChange(e.target.value)} />
		</div>
	);
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label?: string }) {
	return <button type="button" className={`${styles.toggle} ${on ? styles.on : ""}`} aria-pressed={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function LabSection({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
	return (
		<section className={styles.section}>
			<h2 className={styles.sectionTitle}>{title}</h2>
			{sub && <p className={styles.sectionSub}>{sub}</p>}
			{children}
		</section>
	);
}

export function LabCard({ name, badge, desc, children }: { name: string; badge?: string; desc?: string; children?: ReactNode }) {
	return (
		<div className={styles.card}>
			<div className={styles.cardHead}><span className={styles.cardName}>{name}</span>{badge && <span className={styles.cardBadge}>{badge}</span>}</div>
			{desc && <p className={styles.cardDesc}>{desc}</p>}
			{children}
		</div>
	);
}

export { styles as labStyles };
