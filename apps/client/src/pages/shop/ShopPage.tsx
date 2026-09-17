// The Shop page IS the customize lab hosted as a page, plus the Stripe return status.
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import CustomizeLab, { TAB_SLUGS, tabFromSlug } from "./CustomizeLab";
import { checkPurchaseReturn } from "./shop-api";
import { useMediaQuery, PHONE_SHEET_MQ } from "../play/mobile";
import { pushToast } from "../../app/Toasts";
import styles from "./ShopPage.module.scss";

export default function ShopPage() {
	const [params, setParams] = useSearchParams();
	const { tab: slug } = useParams();
	const navigate = useNavigate();
	const location = useLocation();
	const tab = tabFromSlug(slug);
	const [banner, setBanner] = useState<{ text: string; kind: string } | null>(null);
	// Phones: the same full-screen sheet as the Customize modal on the home page (design CL·01a / CP·01), with the
	// back arrow leading home; the purchase status goes to a toast since the sheet has no page chrome to hold a banner.
	const phoneSheet = useMediaQuery(PHONE_SHEET_MQ);
	useEffect(() => { if (banner && phoneSheet) pushToast({ icon: banner.kind === "success" ? "✅" : banner.kind === "error" ? "⚠️" : "🛒", label: "Shop", name: banner.text, complete: banner.kind === "success" }); }, [banner, phoneSheet]);
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
	if (!tab) return <Navigate to={"/shop/avatar" + location.search} replace />;
	if (phoneSheet) return (
		<div className={styles.sheet}>
			<CustomizeLab host="modal" sheet onBack={() => navigate("/")} tab={tab} onTabChange={t => navigate("/shop/" + TAB_SLUGS[t] + location.search, { replace: true })} />
		</div>
	);
	return (
		<section>
			<h1 className={styles.title}>Shop</h1>
			<p className={styles.sub}>Cosmetics only. Avatars and board skins never change how the game plays.</p>
			{banner && <div className={`${styles.banner} ${banner.kind === "success" ? styles.ok : banner.kind === "error" ? styles.err : ""}`}>{banner.text}</div>}
			<CustomizeLab host="page" tab={tab} onTabChange={t => navigate("/shop/" + TAB_SLUGS[t] + location.search, { replace: true })} />
		</section>
	);
}
