// The local player's cosmetic picks: apply locally, persist, tell the server (which re-checks
// ownership and answers skin_rejected / reveal_effect_rejected if a stored pick is not owned).
import { useEffect, useReducer } from "react";
import { applyBoardSkin, applyRevealEffect, localBoardSkin, localRevealEffect, onCosmeticsChange } from "../game/board-render";
import { getSocket } from "../online/socket";

export function setBoardSkin(id: string) {
	applyBoardSkin(id);
	try { localStorage.setItem("ms_board_skin", localBoardSkin); } catch { /* storage blocked */ }
	getSocket().emit("set_skin", { skin: localBoardSkin });
}
export function setRevealEffect(id: string) {
	applyRevealEffect(id);
	try { localStorage.setItem("ms_reveal_effect", localRevealEffect); } catch { /* storage blocked */ }
	getSocket().emit("set_reveal_effect", { effect: localRevealEffect });
}

// After sign-in: announce the stored picks, falling back to the free defaults if not owned (an
// unowned stored pick would be rejected server-side anyway).
export function announceCosmetics(ownedItems: string[]) {
	const skinOwned = localBoardSkin === "classic" || ownedItems.indexOf(localBoardSkin) !== -1;
	getSocket().emit("set_skin", { skin: skinOwned ? localBoardSkin : "classic" });
	getSocket().emit("set_reveal_effect", { effect: localRevealEffect });
}

// Re-render a component whenever the local skin or reveal effect changes.
export function useCosmetics(): { skin: string; effect: string } {
	const [, bump] = useReducer((n: number) => n + 1, 0);
	useEffect(() => onCosmeticsChange(bump), []);
	return { skin: localBoardSkin, effect: localRevealEffect };
}
