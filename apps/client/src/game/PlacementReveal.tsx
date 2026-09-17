// The end of a placement run: the locked plate shakes, the padlock springs open and drops off, the plate
// splits into wedges and the player's first rank badge reforms underneath ("Lock pops" from the Design Lab).
// Mount it in place of the badge for PLACEMENT_REVEAL_MS, then put the plain RankBadge back. The fanfare
// belongs at PLACEMENT_REVEAL_SOUND_MS, when the plate gives way and the badge appears.
import { useMemo } from "react";
import { RankBadge } from "../shared/RankBadge";
import { placementRevealSVG } from "../shared/ranking";
import styles from "./PlacementReveal.module.scss";

const HOLD_MS = 500;                                   // the result panel is still fading in; let it settle first
export const PLACEMENT_REVEAL_SOUND_MS = HOLD_MS + 1550; // plate splits, badge reforms
export const PLACEMENT_REVEAL_MS = HOLD_MS + 2300;       // badge at rest, wedges gone

export function PlacementReveal({ rating, size }: { rating: number; size: number }) {
	const px = size * 5; // a badge is 5em at font-size `size`px (badges.scss)
	const plate = useMemo(() => placementRevealSVG({ wedge: styles.wedge, lock: styles.lock, shackle: styles.shackle }), []);
	return (
		<div className={styles.box} style={{ fontSize: px + "px", "--t0": HOLD_MS + "ms" } as any} aria-hidden="true">
			<div className={`${styles.face} ${styles.under}`}><RankBadge rating={rating} size={size} /></div>
			<div className={`${styles.face} ${styles.plate} rank-badge rank-badge-placement`} dangerouslySetInnerHTML={{ __html: plate }} />
		</div>
	);
}
