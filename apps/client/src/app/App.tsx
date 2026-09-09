// Every route in one place (react-router). Match-flow screens (searching, playing, results) are
// view state inside the game page, not URLs, same as achtung-royale.
import { Routes, Route } from "react-router-dom";
import NavBar from "./NavBar";
import Footer from "./Footer";
import HomePage from "../pages/home/HomePage";
import SoloPage from "../pages/solo/SoloPage";
import PlayPage from "../pages/play/PlayPage";
import PuzzlePage from "../pages/puzzles/PuzzlePage";
import LeaderboardPage from "../pages/leaderboard/LeaderboardPage";
import SettingsPage from "../pages/settings/SettingsPage";
import { PrivacyPage, TermsPage } from "../pages/legal/LegalPages";
import ProfilePage from "../pages/profile/ProfilePage";
import ShopPage from "../pages/shop/ShopPage";
import LearnPage from "../pages/learn/LearnPage";
import ReplayPage from "../pages/replay/ReplayPage";
import CustomPage from "../pages/custom/CustomPage";
import { Toasts, useAchievementUnlocks } from "./Toasts";
import Placeholder from "../pages/Placeholder";
import styles from "./App.module.scss";

// Routes not ported yet render a placeholder so links work and the smoke test can visit them.
const PENDING: Array<[string, string]> = [
	["/admin", "Admin"]
];

export default function App() {
	useAchievementUnlocks();
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
					<Route path="/leaderboard" element={<LeaderboardPage />} />
					<Route path="/profile" element={<ProfilePage />} />
					<Route path="/shop" element={<ShopPage />} />
					<Route path="/learn" element={<LearnPage />} />
					<Route path="/replay" element={<ReplayPage />} />
					<Route path="/custom" element={<CustomPage />} />
					<Route path="/settings" element={<SettingsPage />} />
					<Route path="/privacy" element={<PrivacyPage />} />
					<Route path="/terms" element={<TermsPage />} />
					{PENDING.map(([path, title]) => <Route key={path} path={path} element={<Placeholder title={title} />} />)}
					<Route path="*" element={<Placeholder title="Not found" />} />
				</Routes>
			</main>
			<Footer />
			<Toasts />
		</div>
	);
}
