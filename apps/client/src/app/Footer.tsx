import { Link } from "react-router-dom";
import styles from "./Footer.module.scss";

export default function Footer() {
	return (
		<footer className={styles.footer}>
			<Link to="/terms">Terms of Service</Link>
			<span>© MSBattle</span>
			<Link to="/privacy">Privacy Policy</Link>
		</footer>
	);
}
