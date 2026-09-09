// The avatar tile and the small square flag chip, as components over the canvas builder.
import { useLayoutEffect, useRef } from "react";
import { buildAvatarCanvas, DEFAULT_AVATAR } from "../game/board-render";
import { countryFlagSrcSquare, countryName } from "./countries";

interface AvatarProps { avatar: string | null | undefined; country?: string | null; px?: number; corner?: number | null; rim?: string | null; className?: string; title?: string; }

export function AvatarChip({ avatar, country, px = 28, corner, rim, className, title }: AvatarProps) {
	const ref = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		const host = ref.current; if (!host) return;
		host.replaceChildren(buildAvatarCanvas(avatar || DEFAULT_AVATAR, px, country || null, corner ?? null, rim ?? null));
	}, [avatar, country, px, corner, rim]);
	return <span ref={ref} className={"avatar-chip" + (className ? " " + className : "")} title={title ?? (country ? countryName(country) : "")} />;
}

export function FlagChip({ country, px = 16, className }: { country: string | null | undefined; px?: number; className?: string }) {
	const src = countryFlagSrcSquare(country);
	if (!src) return null;
	return <img className={"flag-chip" + (className ? " " + className : "")} src={src} alt="" title={countryName(country)} width={px} height={px} style={{ width: px, height: px }} />;
}
