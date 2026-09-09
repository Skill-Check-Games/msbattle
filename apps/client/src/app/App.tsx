// Every route in one place (react-router). Match-flow screens (searching, playing, results) are
// view state inside the game page, not URLs, same as achtung-royale.
import { Routes, Route } from "react-router-dom";
import NavBar from "./NavBar";
import Footer from "./Footer";
import HomePage from "../pages/home/HomePage";
import SoloPage from "../pages/solo/SoloPage";
import PlayPage from "../pages/play/PlayPage";
import PuzzlePage from "../pages/puzzles/PuzzlePage";
import Placeholder from "../pages/Placeholder";
import styles from "./App.module.scss";

// Routes not ported yet render a placeholder so links work and the smoke test can visit them.
const PENDING: Array<[string, string]> = [
	["/learn", "Learn"], ["/custom", "Custom rooms"],
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
					<Route path="/solo" element={<SoloPage />} />
					<Route path="/play" element={<PlayPage />} />
					<Route path="/puzzles" element={<HomePage openPuzzles />} />
					<Route path="/puzzles/play" element={<PuzzlePage mode="rated" />} />
					<Route path="/puzzles/streak" element={<PuzzlePage mode="streak" />} />
					<Route path="/puzzles/storm" element={<PuzzlePage mode="storm" />} />
					<Route path="/puzzles/daily" element={<PuzzlePage mode="daily" />} />
					{PENDING.map(([path, title]) => <Route key={path} path={path} element={<Placeholder title={title} />} />)}
					<Route path="*" element={<Placeholder title="Not found" />} />
				</Routes>
			</main>
			<Footer />
		</div>
	);
}
