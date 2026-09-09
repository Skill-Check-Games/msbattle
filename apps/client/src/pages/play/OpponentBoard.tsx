// An opponent's live board, painted from each draw_board frame in that player's own skin. Only the
// cells that changed since the last frame are repainted. Registers its canvas with the match store
// so the round-start reveal wave can be mirrored onto it.
import { useEffect, useLayoutEffect, useRef } from "react";
import { BoardView, sizeCellCanvas, UNKNOWN } from "../../game/board-render";
import { match, GameFrame } from "../../game/match-store";

interface Props { playerId: string; skin: string | null; frame: GameFrame | null; rows: number; cols: number; cellPx: number; className?: string; covered?: boolean; }

export default function OpponentBoard({ playerId, skin, frame, rows, cols, cellPx, className, covered }: Props) {
	const ref = useRef<HTMLCanvasElement>(null);
	const lastRef = useRef<number[][] | null>(null);

	useEffect(() => { match.registerOpponentCanvas(playerId, ref.current, skin); return () => match.registerOpponentCanvas(playerId, null, skin); }, [playerId, skin]);

	useLayoutEffect(() => {
		const canvas = ref.current; if (!canvas || !rows || !cols) return;
		sizeCellCanvas(canvas, cols, rows, cellPx);
		lastRef.current = null; // a resize clears the canvas: repaint everything
		paint();
	}, [rows, cols, cellPx]);

	useLayoutEffect(() => { paint(); });

	function paint() {
		const canvas = ref.current; if (!canvas || !rows || !cols) return;
		let state = frame && frame.playing ? frame.state : null;
		if (!state && covered) { state = []; for (let r = 0; r < rows; r++) state.push(new Array(cols).fill(UNKNOWN)); }
		if (!state) { canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height); lastRef.current = null; return; }
		const prev = lastRef.current;
		const view = new BoardView(canvas, rows, cols, state, () => 0, { skin: skin || "classic" });
		if (!prev || prev.length !== rows || prev[0].length !== cols) view.draw();
		else {
			const dirty: number[][] = [];
			for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (prev[r][c] !== state[r][c]) dirty.push([r, c]);
			if (dirty.length) view.draw(dirty);
		}
		lastRef.current = state.map(row => row.slice());
	}

	return <canvas ref={ref} className={className} aria-hidden="true" />;
}
