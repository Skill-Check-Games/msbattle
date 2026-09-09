// The Shop page IS the customize lab hosted as a page, plus the Stripe return status.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import CustomizeLab from "./CustomizeLab";
import { checkPurchaseReturn } from "./shop-api";
import styles from "./ShopPage.module.scss";

export default function ShopPage() {
	const [params, setParams] = useSearchParams();
	const [banner, setBanner] = useState<{ text: string; kind: string } | null>(null);
	useEffect(() => {
		const purchase = params.get("purchase");
		if (!purchase) return;
		if (purchase === "cancel") setBanner({ text: "Checkout cancelled. Nothing was charged.", kind: "info" });
		else if (purchase === "success") {
			const sessionId = params.get("session_id");
			if (!sessionId) setBanner({ text: "Purchase complete!", kind: "success" });
			else { setBanner({ text: "Payment received, finishing up…", kind: "info" }); checkPurchaseReturn(sessionId).then(r => setBanner(r.status === "owned" ? { text: "Purchase complete!", kind: "success" } : r.status === "processing" ? { text: "Still processing. Check back in a minute.", kind: "info" } : r.status === "unpaid" ? { text: "Payment not completed.", kind: "info" } : { text: "Couldn't confirm your purchase. Refresh to check again.", kind: "error" })); }
		}
		setParams({}, { replace: true });
	}, []);
	return (
		<section>
			<h1 className={styles.title}>Shop</h1>
			<p className={styles.sub}>Cosmetics only. Avatars and board skins never change how the game plays.</p>
			{banner && <div className={`${styles.banner} ${banner.kind === "success" ? styles.ok : banner.kind === "error" ? styles.err : ""}`}>{banner.text}</div>}
			<CustomizeLab host="page" />
		</section>
	);
}
