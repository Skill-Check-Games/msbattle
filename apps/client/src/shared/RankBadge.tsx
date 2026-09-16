// Badge elements. Sized by font-size: .rank-badge is a 5em box (styles/badges.scss), so a caller
// sets the size with `size` (px) and the artwork scales with it.
import { CSSProperties } from "react";
import { rankEmblemSVG, placementBadgeSVG, puzzleLockedBadgeSVG, puzzleBadgeFor } from "./ranking";

function box(size: number | undefined, extra?: CSSProperties): CSSProperties {
	return { fontSize: size != null ? size + "px" : undefined, ...extra };
}

// provisional: the player is still in placement, so the locked placement plate shows instead of a tier's emblem.
export function RankBadge({ rating, size, provisional }: { rating: number; size?: number; provisional?: boolean }) {
	if (provisional) return <PlacementBadge size={size} />;
	const { tierClass, svg } = rankEmblemSVG(rating);
	return <div className={"rank-badge tier-" + tierClass} style={box(size)} dangerouslySetInnerHTML={{ __html: svg }} />;
}
export function PlacementBadge({ size }: { size?: number }) {
	return <div className="rank-badge rank-badge-placement" style={box(size)} dangerouslySetInnerHTML={{ __html: placementBadgeSVG() }} />;
}
export function PuzzleLockedBadge({ size }: { size?: number }) {
	return <div className="rank-badge rank-badge-placement" style={box(size)} dangerouslySetInnerHTML={{ __html: puzzleLockedBadgeSVG() }} />;
}
export function PuzzleRankBadge({ rating, size }: { rating: number; size?: number }) {
	const { color, svg } = puzzleBadgeFor(rating);
	return <div className="rank-badge puzzle-rank-badge" style={box(size, { color })} dangerouslySetInnerHTML={{ __html: svg }} />;
}
