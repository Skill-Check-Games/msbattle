// Country flag picker (the same shape as achtung-royale's): a searchable grid of named flag cards.
// Desktop: a popover anchored to the trigger (flips above when there is more room). Under 900px: a
// full-height sheet over a scrim. Closes on Escape, scrim/outside click, and (desktop only, where the
// popover is anchored) resize or scrolling the page outside the panel. The sheet ignores scroll and
// height-only resizes: raising the on-screen keyboard fires both, and it instead tracks the visual
// viewport so the grid stays above the keyboard. The search box only takes focus by itself on desktop,
// and its 16px type keeps iOS from zooming the page in on focus.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { countryList, countryFlagSrcSquare } from "./countries";
import styles from "./FlagPicker.module.scss";

const PANEL_W = 480, PANEL_H = 540, NARROW = 900;
interface Props { anchor: HTMLElement | null; current: string | null; onSelect: (code: string | null) => void; onClose: () => void; }

export default function FlagPicker({ anchor, current, onSelect, onClose }: Props) {
	const [q, setQ] = useState("");
	const panelRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const narrow = window.innerWidth < NARROW;
	const [vv, setVv] = useState<{ top: number; height: number } | null>(null);
	const items = useMemo(() => countryList(), []);
	const query = q.trim().toLowerCase();
	const filtered = query ? items.filter(it => it.name.toLowerCase().includes(query) || it.code.toLowerCase().includes(query)) : items;
	const showNone = !query || "no flag".startsWith(query) || "none".startsWith(query);

	useEffect(() => {
		if (!narrow) searchRef.current?.focus();
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		const onScroll = (e: Event) => { if (narrow || (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target))) return; onClose(); };
		const startW = window.innerWidth;
		const onResize = () => { if (!narrow || window.innerWidth !== startW) onClose(); };
		const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node) && !(anchor && anchor.contains(e.target as Node))) onClose(); };
		document.addEventListener("keydown", onKey); window.addEventListener("scroll", onScroll, true); window.addEventListener("resize", onResize); document.addEventListener("mousedown", onDown);
		return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll, true); window.removeEventListener("resize", onResize); document.removeEventListener("mousedown", onDown); };
	}, [onClose, anchor, narrow]);

	useEffect(() => {
		const v = window.visualViewport;
		if (!narrow || !v) return;
		const sync = () => setVv({ top: v.offsetTop, height: v.height });
		sync();
		v.addEventListener("resize", sync); v.addEventListener("scroll", sync);
		return () => { v.removeEventListener("resize", sync); v.removeEventListener("scroll", sync); };
	}, [narrow]);

	let pos: React.CSSProperties = {};
	if (!narrow && anchor) {
		const r = anchor.getBoundingClientRect(), spaceBelow = window.innerHeight - r.bottom;
		const flipUp = spaceBelow < PANEL_H + 12 && r.top > spaceBelow;
		pos = { top: Math.round(flipUp ? Math.max(8, r.top - PANEL_H - 6) : r.bottom + 6), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - PANEL_W - 8))) };
	}
	if (narrow && vv) pos = { top: Math.round(vv.top + 20), height: Math.round(vv.height - 40) };
	const cell = (code: string | null, name: string, src: string | null) => (
		<button key={code || "none"} type="button" className={`${styles.cell} ${code === current ? styles.active : ""}`} onClick={() => { onSelect(code); onClose(); }}>
			<span className={styles.cellImg}>{src && <img src={src} alt="" loading="lazy" />}</span>
			<span className={styles.cellLabel}>{name}</span>
		</button>
	);
	return createPortal(
		<>
			{narrow && <div className={styles.scrim} onClick={onClose} />}
			<div ref={panelRef} className={`${styles.panel} ${narrow ? styles.narrow : ""}`} style={pos} role="dialog" aria-label="Choose your flag">
				<div className={styles.head}><span className={styles.title}>Choose your flag</span><button type="button" className={styles.close} aria-label="Close" onClick={onClose}>×</button></div>
				<input ref={searchRef} type="text" className={styles.search} placeholder="Search" aria-label="Search flags" value={q} onChange={e => setQ(e.target.value)} />
				<div className={styles.grid}>
					{showNone && cell(null, "No flag", null)}
					{filtered.map(it => cell(it.code, it.name, countryFlagSrcSquare(it.code)))}
					{!filtered.length && !showNone && <div className={styles.empty}>No flags match "{q.trim()}".</div>}
				</div>
			</div>
		</>, document.body);
}
