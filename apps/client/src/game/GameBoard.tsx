// The live board surface: a canvas the session paints, inside a scroll container, with the focus
// ring and press highlight overlays and the shake wrapper. Sizing is the caller's decision
// (cellPx); this component applies it and keeps the session's canvas bound.
import { useLayoutEffect, useRef, ReactNode } from "react";
import { BoardSession } from "./board-session";
import { attachBoardInput, attachBoardKeyboard, InputOptions } from "./board-input";
import { sizeCellCanvas } from "./board-render";
import styles from "./GameBoard.module.scss";

interface Props {
	session: BoardSession;
	cellPx: number;
	flagMode?: () => boolean;
	input?: Partial<InputOptions>;
	keyboard?: boolean;
	className?: string;
	children?: ReactNode;   // overlays laid over the board card (start button, countdown text, results)
}

export default function GameBoard({ session, cellPx, flagMode, input, keyboard = true, className, children }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const focusRef = useRef<HTMLDivElement>(null);
	const pressRef = useRef<HTMLDivElement>(null);

	// Bind the session to this canvas and the overlays; wire input for the component's lifetime.
	useLayoutEffect(() => {
		const canvas = canvasRef.current!;
		session.canvas = canvas;
		session.focusRingEl = focusRef.current;
		session.pressHighlightEl = pressRef.current;
		const detachInput = attachBoardInput(session, canvas, { flagMode: flagMode || (() => false), ...input });
		const detachKeys = keyboard ? attachBoardKeyboard(session) : () => {};
		return () => { detachInput(); detachKeys(); if (session.canvas === canvas) session.canvas = null; };
	}, [session]);

	// Resize the backing store when the cell size or board changes, then repaint (a resize clears it).
	useLayoutEffect(() => {
		const canvas = canvasRef.current!;
		if (session.rows && session.cols) sizeCellCanvas(canvas, session.cols, session.rows, cellPx);
		session.render();
	}, [session, cellPx, session.rows, session.cols]);

	return (
		<div className={`${styles.wrap} ${className || ""}`}>
			<div className={styles.scroll}>
				<canvas ref={canvasRef} className={styles.canvas} />
				<div ref={focusRef} className={styles.focusRing} hidden />
				<div ref={pressRef} className={styles.pressHighlight} hidden />
			</div>
			{children}
		</div>
	);
}
