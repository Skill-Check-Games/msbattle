// The live board surface: a canvas the session paints, inside the shared BoardFrame chrome, with the
// focus ring and press highlight overlays. Sizing is the caller's decision (cellPx); this component
// applies it and keeps the session's canvas bound.
import { useLayoutEffect, useRef, useState, ReactNode, useEffect } from "react";
import { BoardSession } from "./board-session";
import { attachBoardInput, attachBoardKeyboard, InputOptions } from "./board-input";
import { sizeCellCanvas } from "./board-render";
import BoardFrame from "./BoardFrame";
import ExplosionLayer from "./ExplosionLayer";
import styles from "./GameBoard.module.scss";
export { SHAKE_PAD_X, SHAKE_PAD_Y } from "./BoardFrame";

interface Props {
	session: BoardSession;
	cellPx: number;
	flagMode?: () => boolean;
	input?: Partial<InputOptions>;
	keyboard?: boolean;
	interactive?: boolean;   // false: a mirror board (an opponent's) that only displays
	className?: string;
	children?: ReactNode;   // overlays laid over the board card (start button, countdown text, results)
}

export default function GameBoard({ session, cellPx, flagMode, input, keyboard = true, interactive = true, className, children }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const focusRef = useRef<HTMLDivElement>(null);
	const pressRef = useRef<HTMLDivElement>(null);
	// A new board (setBoard) arrives outside React's render: subscribe so the sizing effect below sees it.
	const [, bump] = useState(0);
	useEffect(() => session.subscribe(() => bump(n => n + 1)), [session]);

	// Bind the session to this canvas and the overlays; wire input for the component's lifetime.
	useLayoutEffect(() => {
		const canvas = canvasRef.current!;
		session.canvas = canvas;
		session.focusRingEl = focusRef.current;
		session.pressHighlightEl = pressRef.current;
		const detachInput = interactive ? attachBoardInput(session, canvas, { flagMode: flagMode || (() => false), ...input }) : () => {};
		const detachKeys = interactive && keyboard ? attachBoardKeyboard(session) : () => {};
		return () => { detachInput(); detachKeys(); if (session.canvas === canvas) session.canvas = null; };
	}, [session]);

	// Resize the backing store when the cell size or board changes, then repaint (a resize clears it).
	useLayoutEffect(() => {
		const canvas = canvasRef.current!;
		if (session.rows && session.cols) sizeCellCanvas(canvas, session.cols, session.rows, cellPx);
		session.render();
	}, [session, cellPx, session.rows, session.cols]);

	return (
		<BoardFrame ref={canvasRef} className={className} inScroll={<><div ref={focusRef} className={styles.focusRing} hidden /><div ref={pressRef} className={styles.pressHighlight} hidden /></>}>
			<ExplosionLayer session={session} />
			{children}
		</BoardFrame>
	);
}
