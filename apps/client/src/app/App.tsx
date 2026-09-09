// Every route in one place (react-router). Match-flow screens (searching, playing, results) are
// view state inside the game page, not URLs, same as achtung-royale.
import { Routes, Route } from "react-router-dom";
import NavBar from "./NavBar";
import Footer from "./Footer";
import HomePage from "../pages/home/HomePage";
import Placeholder from "../pages/Placeholder";
import styles from "./App.module.scss";

// Routes not ported yet render a placeholder so links work and the smoke test can visit them.
const PENDING: Array<[string, string]> = [
	["/learn", "Learn"], ["/custom", "Custom rooms"], ["/solo", "Solo"], ["/ranked/sprint", "Sprint"], ["/ranked/standard", "Standard"], ["/puzzles", "Puzzles"],
	["/puzzles/play", "Puzzle Ladder"], ["/puzzles/streak", "Streak"], ["/puzzles/storm", "Time Trial"], ["/puzzles/daily", "Daily puzzle"],
	["/leaderboard", "Leaderboard"], ["/profile", "Profile"], ["/settings", "Settings"], ["/shop", "Shop"],
	["/replay", "Replay"], ["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"], ["/admin", "Admin"]
];

export default function App() {
	return (
		<div className={styles.shell}>
			<NavBar />
			<main className={styles.main}>
				<Routes>
					<Route path="/" element={<HomePage />} />
					{PENDING.map(([path, title]) => <Route key={path} path={path} element={<Placeholder title={title} />} />)}
					<Route path="*" element={<Placeholder title="Not found" />} />
				</Routes>
			</main>
			<Footer />
		</div>
	);
}
