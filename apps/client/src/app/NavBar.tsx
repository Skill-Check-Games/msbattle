import { useEffect, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { useAuth } from "../shared/auth";
import styles from "./NavBar.module.scss";

const LINKS: Array<[string, string]> = [
	["/", "Play"], ["/learn", "Learn"], ["/leaderboard", "Leaderboard"], ["/profile", "Profile"], ["/shop", "Shop"], ["/settings", "Settings"], ["/help", "Help"]
];

// Desktop: brand, centred links, identity. Below the portrait breakpoint the links and the identity
// fold into a burger panel (state-driven; the icons are CSS so the button never changes size).
export default function NavBar() {
	const { account, signIn, signOut, providers } = useAuth();
	const [open, setOpen] = useState(false);
	const location = useLocation();
	useEffect(() => { setOpen(false); }, [location.pathname]);

	const signedIn = account && !account.guest;
	const links = account && account.isAdmin ? [...LINKS, ["/admin", "Admin"] as [string, string]] : LINKS;
	const identity = signedIn ? (
		<>
			<span className={styles.name}>{account.name}</span>
			<button className="btn btn-ghost" onClick={signOut}>Sign out</button>
		</>
	) : (
		<button className="btn btn-primary" onClick={() => signIn(providers.google ? "google" : providers.discord ? "discord" : "dev")}>Sign in</button>
	);

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
			<div className={styles.identity}>{identity}</div>
			<button className={styles.burger} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(o => !o)}>
				<span className={open ? styles.iconClose : styles.iconMenu} aria-hidden="true" />
			</button>
			{open && (
				<div className={styles.panel}>
					{links.map(([to, label]) => (
						<NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? `${styles.panelLink} ${styles.active}` : styles.panelLink}>{label}</NavLink>
					))}
					<div className={styles.panelIdentity}>{identity}</div>
				</div>
			)}
		</header>
	);
}
