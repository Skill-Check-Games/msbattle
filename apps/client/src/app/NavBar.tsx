import { NavLink, Link } from "react-router-dom";
import { useAuth } from "../shared/auth";
import styles from "./NavBar.module.scss";

const LINKS: Array<[string, string]> = [
	["/", "Play"], ["/learn", "Learn"], ["/leaderboard", "Leaderboard"], ["/profile", "Profile"], ["/shop", "Shop"], ["/settings", "Settings"]
];

export default function NavBar() {
	const { account, signIn, signOut, providers } = useAuth();
	const signedIn = account && !account.guest;
	return (
		<header className={styles.topbar}>
			<Link to="/" className={styles.brand} aria-label="MSBattle home">
				<img src="/logo.svg" alt="" width="28" height="28" />
				<span><b>MS</b>Battle</span>
			</Link>
			<nav className={styles.links}>
				{LINKS.map(([to, label]) => (
					<NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}>{label}</NavLink>
				))}
			</nav>
			<div className={styles.identity}>
				{signedIn ? (
					<>
						<span className={styles.name}>{account.name}</span>
						<button className="btn btn-ghost" onClick={signOut}>Sign out</button>
					</>
				) : (
					<button className="btn btn-primary" onClick={() => signIn(providers.google ? "google" : providers.discord ? "discord" : "dev")}>Sign in</button>
				)}
			</div>
		</header>
	);
}
