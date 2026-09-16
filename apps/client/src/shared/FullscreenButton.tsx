// Fullscreen toggle: a square icon button (corner brackets out = enter, in = exit). Lives in the
// navbar beside the identity, and in the live-game header where the navbar is hidden. The click is
// the user gesture the Fullscreen API needs.
import { useEffect, useState } from "react";
import { enterGameFullscreen, exitGameFullscreen, fullscreenSupported, isInFullscreen } from "../game/fullscreen";
import styles from "./FullscreenButton.module.scss";
import { pushToast } from "../app/Toasts";

// lockLandscape: after entering, ask for a landscape orientation lock (the phone duel layout).
export default function FullscreenButton({ className, lockLandscape }: { className?: string; lockLandscape?: boolean }) {
	const [on, setOn] = useState(isInFullscreen());
	// Track the real state through the standard and webkit events, plus a resize (the fullscreen transition on
	// phones), so the icon never lies about which way the next tap goes.
	useEffect(() => {
		const sync = () => setOn(isInFullscreen());
		document.addEventListener("fullscreenchange", sync); document.addEventListener("webkitfullscreenchange", sync); window.addEventListener("resize", sync);
		return () => { document.removeEventListener("fullscreenchange", sync); document.removeEventListener("webkitfullscreenchange", sync); window.removeEventListener("resize", sync); };
	}, []);
	if (!fullscreenSupported()) return null;
	const refused = (reason: string) => pushToast({ icon: "⚠️", label: "Fullscreen", name: "Couldn't enter fullscreen: " + reason, complete: false });
	return (
		<button type="button" className={`${styles.btn} ${className || ""}`} title={on ? "Exit fullscreen" : "Fullscreen"} aria-label={on ? "Exit fullscreen" : "Fullscreen"} onClick={() => on ? exitGameFullscreen() : enterGameFullscreen(true, !!lockLandscape, refused)}>
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
				{on ? <path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" /> : <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />}
			</svg>
		</button>
	);
}
