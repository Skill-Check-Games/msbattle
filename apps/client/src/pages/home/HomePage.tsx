import { useAuth } from "../../shared/auth";
import styles from "./HomePage.module.scss";

export default function HomePage() {
	const { account } = useAuth();
	return (
		<section className={styles.dash}>
			<div className={styles.identity}>
				<div className={styles.name}>{account ? account.name : "…"}</div>
				<div className={styles.sub}>{account ? (account.guest ? "Guest" : account.provider) : "Connecting"}</div>
			</div>
		</section>
	);
}
