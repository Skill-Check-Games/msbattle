// Dialog chrome shared by every modal: backdrop, centred card, close on Escape or backdrop click,
// body scroll lock while open.
import { useEffect, ReactNode } from "react";
import styles from "./Modal.module.scss";

interface Props { open: boolean; onClose: () => void; title?: string; width?: number; children: ReactNode; className?: string; labelledBy?: string; }

export default function Modal({ open, onClose, title, width, children, className, labelledBy }: Props) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		document.addEventListener("keydown", onKey);
		document.body.classList.add("modal-open");
		return () => { document.removeEventListener("keydown", onKey); if (!document.querySelector("[data-modal-open]")) document.body.classList.remove("modal-open"); };
	}, [open, onClose]);
	if (!open) return null;
	return (
		<div className={styles.modal} data-modal-open="">
			<div className={styles.backdrop} onClick={onClose} />
			<div className={`${styles.dialog} ${className || ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={width ? { width: `min(${width}px, 100%)` } : undefined}>
				{title && <div className={styles.head}><h2 id={labelledBy}>{title}</h2></div>}
				<button className={styles.close} type="button" onClick={onClose} aria-label="Close">×</button>
				{children}
			</div>
		</div>
	);
}
