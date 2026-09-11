// The chrome every board canvas sits in: the shake wrapper, the padded scroll container and the
// canvas itself. The local player's live board (GameBoard) and every opponent board (OpponentBoard)
// render through this one component, so their padding, gutter and sizing can never differ.
import { forwardRef, ReactNode } from "react";
import styles from "./GameBoard.module.scss";

// The mine-hit shake moves the canvas by up to 5x2 px. The scroll container reserves that much around
// the canvas (padding in GameBoard.module.scss), so the shake stays inside the component's own box and
// no host can clip the edge cells. Anything fitting a board to a width must subtract 2 * SHAKE_PAD_X.
export const SHAKE_PAD_X = 6, SHAKE_PAD_Y = 3;

interface Props { className?: string; canvasClassName?: string; inScroll?: ReactNode; children?: ReactNode; ariaHidden?: boolean; }

const BoardFrame = forwardRef<HTMLCanvasElement, Props>(function BoardFrame({ className, canvasClassName, inScroll, children, ariaHidden }, ref) {
	return (
		<div className={`${styles.wrap} ${className || ""}`}>
			<div className={styles.scroll} data-board-scroll="">
				<canvas ref={ref} className={`${styles.canvas} ${canvasClassName || ""}`} aria-hidden={ariaHidden || undefined} />
				{inScroll}
			</div>
			{children}
		</div>
	);
});
export default BoardFrame;
