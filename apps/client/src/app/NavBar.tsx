import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { useAuth } from "../shared/auth";
import { AvatarChip } from "../shared/Avatar";
import { tierFor, overallRating } from "../shared/ranking";
import type { Account } from "../shared/types";
import FullscreenButton from "../shared/FullscreenButton";
import styles from "./NavBar.module.scss";

const LINKS: Array<[string, string]> = [
	["/", "Play"], ["/learn", "Learn"], ["/leaderboard", "Leaderboard"], ["/profile", "Profile"], ["/shop", "Shop"], ["/settings", "Settings"], ["/help", "Help"]
];

// Desktop: brand, centred links, fullscreen + identity. Below the portrait breakpoint the links and the
// identity fold into a burger panel (state-driven; the icons are CSS so the button never changes size).
// A signed-in account is a round avatar (the provider photo, else a letter) opening a small popover;
// the same for every provider, dev login included, so localhost looks like production.
export default function NavBar() {
	const { account, signIn, signOut, providers } = useAuth();
	const [open, setOpen] = useState(false);
	const location = useLocation();
	useEffect(() => { setOpen(false); }, [location.pathname]);

	const signedIn = !!account && !account.guest;
	const links = account && account.isAdmin ? [...LINKS, ["/admin", "Admin"] as [string, string]] : LINKS;
	const signInBtn = <button className="btn btn-primary" onClick={() => signIn(providers.google ? "google" : providers.discord ? "discord" : "dev")}>Sign in</button>;

	return (
		<header className={styles.topbar}>
			<Link to="/" className={styles.brand} aria-label="MSBattle home">
				<img src="/logo.svg" alt="" width="28" height="28" />
				<span className={styles.brandName}>MSBattle</span>
			</Link>
			<nav className={styles.links}>
				{links.map(([to, label]) => (
					<NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}>{label}</NavLink>
				))}
			</nav>
			<div className={styles.identity}>
				<FullscreenButton />
				{signedIn ? <AccountMenu account={account!} onSignOut={signOut} /> : signInBtn}
			</div>
			<button className={styles.burger} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(o => !o)}>
				<span className={open ? styles.iconClose : styles.iconMenu} aria-hidden="true" />
			</button>
			{open && (
				<div className={styles.panel}>
					{links.map(([to, label]) => (
						<NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? `${styles.panelLink} ${styles.active}` : styles.panelLink}>{label}</NavLink>
					))}
					<div className={styles.menuAccount}>
						{signedIn && <MenuAccountRow account={account!} />}
						<div className={styles.menuActions}>
							<FullscreenButton />
							{signedIn ? <button className={`btn btn-ghost ${styles.menuBtn}`} onClick={signOut}>Sign out</button> : signInBtn}
						</div>
					</div>
				</div>
			)}
		</header>
	);
}

// Desktop identity: the avatar circle and its popover (provider logo + name, Profile, Admin, Sign out).
function AccountMenu({ account, onSignOut }: { account: Account; onSignOut: () => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const location = useLocation();
	useEffect(() => { setOpen(false); }, [location.pathname]);
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
		document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
		return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
	}, [open]);
	return (
		<div className={styles.account} ref={ref}>
			<button type="button" className={styles.avatarBtn} aria-haspopup="true" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen(o => !o)}>
				{account.avatarUrl ? <img className={styles.avatarImg} src={account.avatarUrl} alt="" /> : <span className={styles.avatarFallback} aria-hidden="true">{(account.name || "?").charAt(0).toUpperCase()}</span>}
			</button>
			{open && (
				<div className={styles.popover}>
					<div className={styles.popoverHead}><ProviderLogo provider={account.provider} /><strong>{account.name}</strong></div>
					<Link to="/profile" className={styles.popoverLink}>Profile</Link>
					{account.isAdmin && <Link to="/admin" className={styles.popoverLink}>Admin</Link>}
					<button type="button" className={`${styles.popoverLink} ${styles.popoverSignOut}`} onClick={onSignOut}>Sign out</button>
				</div>
			)}
		</div>
	);
}

// Burger-panel identity: cosmetic avatar chip, name and rank tier, linking to the profile.
function MenuAccountRow({ account }: { account: Account }) {
	const overall = overallRating(account), tier = tierFor(overall, account.provisional);
	return (
		<Link to="/profile" className={styles.menuAccountId}>
			<AvatarChip avatar={account.avatarColor} country={account.country} px={44} title="" />
			<span className={styles.menuAccountText}>
				<strong>{account.name}</strong>
				<span className={styles.menuAccountTier}><b style={{ color: tier.color }}>{tier.name}</b> · {overall}</span>
			</span>
		</Link>
	);
}

function ProviderLogo({ provider }: { provider?: string }) {
	if (provider === "google") return (
		<span className={styles.providerLogo}><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" /></svg></span>
	);
	if (provider === "discord") return (
		<span className={styles.providerLogo}><svg viewBox="0 0 24 24" fill="#5865F2" aria-hidden="true"><path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.371-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.245.198.372.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg></span>
	);
	return null;
}
