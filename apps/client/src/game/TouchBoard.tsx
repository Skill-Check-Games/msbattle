// The board box every phone board lives in: GameBoard plus everything a touch screen needs, so no page wires
// it by hand. With `touch` on, the box is a pan/zoom viewport (duel-zoom.ts): the board opens at the overview
// (`fitCellPx`: the whole board in the box), one finger anywhere in the box pans it, two fingers pinch between
// the overview and ZOOMED_IN_CELL_PX, and the flag-mode toggle (design G·09) sits in the box's bottom-right
// corner and feeds the board's input. With `touch` off it is a plain GameBoard at `fitCellPx` (desktop: flags by
// right-click, no toggle). `overviewKey` changing (a new board) returns the viewport to the overview.
import { CSSProperties, ReactNode, useLayoutEffect, useEffect, useRef, useState } from "react";
import { BoardSession } from "./board-session";
import GameBoard, { SHAKE_PAD_X, SHAKE_PAD_Y } from "./GameBoard";
import { FlagToggle } from "./FlagToggle";
import { attachPanAnywhere, attachPinchZoom, clearZoomTransform, ZOOMED_IN_CELL_PX, PinchCommit } from "./duel-zoom";
import styles from "./TouchBoard.module.scss";

interface Props {
	session: BoardSession;
	fitCellPx: number;                 // the overview cell size (the whole board fits the box at this size)
	touch: boolean;                    // phone: pan + pinch + flag toggle; otherwise a plain board
	overviewKey?: string | number;     // changes when a new board arrives: back to the overview
	restOffsetY?: number;              // the overview rests this many px above the box's centre (room for an overlay at the bottom)
	className?: string;                // the box (host) — position: relative; give it a fixed size when `touch`
	style?: CSSProperties;
	boardClassName?: string;
	keyboard?: boolean;
	children?: ReactNode;              // extra overlays inside the box
}

export default function TouchBoard({ session, fitCellPx, touch, overviewKey, restOffsetY = 0, className, style, boardClassName, keyboard = true, children }: Props) {
	const hostRef = useRef<HTMLDivElement>(null);
	// The board input is wired once (GameBoard), so it reads the CURRENT flag mode through the ref.
	const [flagMode, setFlagMode] = useState(false);
	const flagRef = useRef(false); flagRef.current = flagMode;
	// null = the overview; a number = an explicit cell size a pinch settled on.
	const [zoomCellPx, setZoomCellPx] = useState<number | null>(null);
	const zoomRef = useRef<number | null>(null); zoomRef.current = zoomCellPx;
	const cellPx = touch && zoomCellPx != null ? zoomCellPx : fitCellPx;
	const cellPxRef = useRef(0); cellPxRef.current = cellPx;
	const fitRef = useRef(fitCellPx); fitRef.current = fitCellPx;
	const pendingPinch = useRef<(PinchCommit & { fromCellPx: number }) | null>(null);
	const padKey = useRef("");
	// A board arriving outside React's render (session.setBoard) must re-run the centring below: subscribe like GameBoard does.
	const [, bump] = useState(0);
	useEffect(() => session.subscribe(() => bump(n => n + 1)), [session]);

	// A new board opens at the overview.
	const firstKey = useRef(true);
	useLayoutEffect(() => {
		if (firstKey.current) { firstKey.current = false; return; }
		pendingPinch.current = null; padKey.current = ""; if (session.canvas) clearZoomTransform(session.canvas); setZoomCellPx(null);
	}, [overviewKey]);

	// Touch: the canvas floats in the scroller with margins of half the box on every side, so at any zoom it can be
	// pushed until its edge reaches the box's centre, and it stays where a gesture left it; only the overview (a new
	// board, a resize) is centred. Runs every commit but only acts when the sizes changed.
	useLayoutEffect(() => {
		const canvas = session.canvas, sc = canvas && canvas.parentElement; if (!canvas || !sc) return;
		if (!touch) { if (padKey.current) { canvas.style.margin = ""; padKey.current = ""; } return; }
		const key = [canvas.offsetWidth, canvas.offsetHeight, sc.clientWidth, sc.clientHeight, zoomCellPx].join(",");
		if (padKey.current === key) return;
		padKey.current = key;
		const mx = Math.max(0, Math.round(sc.clientWidth / 2) - SHAKE_PAD_X), my = Math.max(0, Math.round(sc.clientHeight / 2) - SHAKE_PAD_Y);
		canvas.style.margin = `${my}px ${mx}px`;
		if (zoomRef.current === null && !pendingPinch.current) {
			sc.scrollLeft = canvas.offsetLeft - (sc.clientWidth - canvas.offsetWidth) / 2;
			sc.scrollTop = canvas.offsetTop - (sc.clientHeight - canvas.offsetHeight) / 2 + restOffsetY / 2;
		}
	});
	// A pinch has ended: once the board is laid out at the new size, scroll so the anchored board point sits where
	// the fingers left it, then drop the gesture's transform (the picture never jumps, it only turns crisp).
	const applyPinch = (c: PinchCommit) => {
		const canvas = session.canvas, sc = canvas && canvas.parentElement; if (!canvas || !sc) return;
		sc.scrollLeft = c.fx * canvas.offsetWidth + canvas.offsetLeft - c.mx;
		sc.scrollTop = c.fy * canvas.offsetHeight + canvas.offsetTop - c.my;
		clearZoomTransform(canvas);
	};
	useLayoutEffect(() => {
		const a = pendingPinch.current, canvas = session.canvas;
		if (!a || !canvas) return;
		if (Math.abs(canvas.offsetWidth / session.cols - a.fromCellPx) < 0.05) return; // the resize has not landed yet
		pendingPinch.current = null;
		applyPinch(a);
	}, [cellPx, zoomCellPx]);
	// One finger anywhere in the box pans, two fingers pinch — attached only in touch mode.
	useEffect(() => {
		const host = hostRef.current; if (!host || !touch) return;
		const scroller = () => host.querySelector<HTMLElement>("[data-board-scroll]");
		const never = () => false; // looking around is always allowed
		const detachPan = attachPanAnywhere(host, scroller, never);
		const detachPinch = attachPinchZoom(host, {
			canvas: () => session.canvas, maxPx: ZOOMED_IN_CELL_PX, blocked: never,
			cellPxNow: canvas => canvas.offsetWidth / Math.max(1, session.cols),
			overviewPx: () => fitRef.current,
			onStart: () => { pendingPinch.current = null; if (session.canvas) clearZoomTransform(session.canvas); },
			onCommit: c => {
				if (Math.abs(cellPxRef.current - c.cellPx) < 0.25) { applyPinch(c); return; } // no relayout coming: settle the scroll now
				pendingPinch.current = { ...c, fromCellPx: cellPxRef.current };
				setZoomCellPx(c.cellPx);
			},
		});
		return () => { detachPan(); detachPinch(); };
	}, [touch, session]);

	return (
		<div ref={hostRef} className={`${styles.box} ${touch ? styles.panZoom : ""} ${className || ""}`} style={style} data-shake-host="">
			<GameBoard session={session} cellPx={cellPx} className={boardClassName} keyboard={keyboard} flagMode={() => flagRef.current} />
			{touch && <FlagToggle on={flagMode} onToggle={() => setFlagMode(f => !f)} />}
			{children}
		</div>
	);
}
