// A still Learn demo board: draws a spec once (revealAll/covered/xray aware, unlike PreviewBoard).
import { useLayoutEffect, useRef } from "react";
import { BoardView, sizeCellCanvas } from "../../game/board-render";
import { buildModel, LEARN_CELL_PX } from "./learn-model";
import type { BoardSpec } from "./learn-data";
import styles from "./LearnPage.module.scss";

export default function LearnBoard({ spec, cellPx = LEARN_CELL_PX }: { spec: BoardSpec; cellPx?: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useLayoutEffect(() => {
		const canvas = ref.current; if (!canvas) return;
		sizeCellCanvas(canvas, spec.cols, spec.rows, cellPx);
		const m = buildModel(spec);
		new BoardView(canvas, m.R, m.C, m.state, m.cellAt, { xray: spec.xray, skin: spec.skin || null }).draw();
	}, [spec, cellPx]);
	return <div className={styles.board}><canvas ref={ref} aria-hidden="true" /></div>;
}
