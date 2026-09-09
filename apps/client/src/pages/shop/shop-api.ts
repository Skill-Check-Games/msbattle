// Shop HTTP calls: Stripe Checkout (real) or the admin/dev fake grant. Ownership lives on the
// account payload (ownedItems) and is re-synced through the refresh_owned_items round trip.
import ShopCatalog from "core/src/common/ShopCatalog.js";
import { getSocket } from "../../online/socket";

export interface ShopItem { id: string; kind: "avatar" | "skin" | "revealEffect"; label: string; priceCents: number; tier?: string; imagePath?: string; }
export const shopItems: ShopItem[] = ShopCatalog.ITEMS;
export const itemById = (id: string): ShopItem | null => ShopCatalog.byId(id) || null;
export const isPurchasable = (kind: string, id: string): boolean => ShopCatalog.isPurchasable(kind, id);
export const priceLabel = (id: string) => { const it = itemById(id); return it ? "$" + (it.priceCents / 100).toFixed(2) : ""; };
export function itemUnlocked(kind: string, id: string, owned: string[] | undefined): boolean { return !isPurchasable(kind, id) || !!(owned && owned.indexOf(id) !== -1); }

function headers(): Record<string, string> {
	let token: string | null = null; try { token = localStorage.getItem("ms_session"); } catch { /* storage blocked */ }
	return token ? { "X-Session-Token": token } : {};
}
export type BuyResult = { ok: true; redirected?: boolean; owned?: boolean } | { ok: false; error: string };

export async function buyItem(item: ShopItem, fake: boolean): Promise<BuyResult> {
	try {
		if (fake) {
			const r = await fetch("/api/shop/fake-grant", { method: "POST", headers: { "Content-Type": "application/json", ...headers() }, body: JSON.stringify({ itemId: item.id }) });
			const d = await r.json();
			if (d.ok) { getSocket().emit("refresh_owned_items"); return { ok: true, owned: true }; }
			return { ok: false, error: "Couldn't activate item. Try again." };
		}
		const r = await fetch("/api/shop/checkout", { method: "POST", headers: { "Content-Type": "application/json", ...headers() }, body: JSON.stringify({ itemId: item.id }) });
		const d = await r.json();
		if (d.alreadyOwned) { getSocket().emit("refresh_owned_items"); return { ok: true, owned: true }; }
		if (d.url) { window.location.href = d.url; return { ok: true, redirected: true }; }
		return { ok: false, error: d.error === "guest_not_allowed" ? "Sign in to buy items." : "Couldn't start checkout. Try again." };
	} catch { return { ok: false, error: fake ? "Couldn't activate item. Try again." : "Couldn't start checkout. Try again." }; }
}

// The redirect back from Stripe Checkout lands with ?purchase=success&session_id=... ; poll the
// session status briefly since the webhook (the authoritative grant) can lag the redirect.
export async function checkPurchaseReturn(sessionId: string): Promise<{ status: "owned" | "processing" | "unpaid" | "error"; itemId?: string }> {
	for (let attempt = 0; attempt < 7; attempt++) {
		try {
			const r = await fetch("/api/shop/session-status?session_id=" + encodeURIComponent(sessionId), { headers: headers() });
			const d = await r.json();
			if (d.owned) { getSocket().emit("refresh_owned_items"); return { status: "owned", itemId: d.itemId }; }
			if (!d.paid) return { status: "unpaid" };
		} catch { return { status: "error" }; }
		await new Promise(res => setTimeout(res, 1500));
	}
	return { status: "processing" };
}
