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
import HelpPage from "../pages/help/HelpPage";
import LearnPage from "../pages/learn/LearnPage";
import ReplayPage from "../pages/replay/ReplayPage";
import CustomPage from "../pages/custom/CustomPage";
import AdminHome from "../pages/admin/AdminHome";
import PuzzlesAdmin from "../pages/admin/PuzzlesAdmin";
import CombinedPuzzlesAdmin from "../pages/admin/CombinedPuzzlesAdmin";
import PuzzleLab from "../pages/admin/PuzzleLab";
import StartingPositionsAdmin from "../pages/admin/StartingPositionsAdmin";
import PatternsAdmin from "../pages/admin/PatternsAdmin";
import StartPatternsAdmin from "../pages/admin/StartPatternsAdmin";
import BotsAdmin from "../pages/admin/BotsAdmin";
import MarathonBoardsAdmin from "../pages/admin/MarathonBoardsAdmin";
import DebugAdmin from "../pages/admin/DebugAdmin";
import DesignAdmin from "../pages/admin/DesignAdmin";
import CountdownLab from "../pages/admin/CountdownLab";
import SoundLab from "../pages/admin/SoundLab";
import { Toasts, useAchievementUnlocks } from "./Toasts";
import Placeholder from "../pages/Placeholder";
import styles from "./App.module.scss";

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
					<Route path="/customize/:tab" element={<HomePage customize />} />
					<Route path="/customize" element={<HomePage customize />} />
					<Route path="/puzzles/play" element={<PuzzlePage mode="rated" />} />
					<Route path="/puzzles/streak" element={<PuzzlePage mode="streak" />} />
					<Route path="/puzzles/storm" element={<PuzzlePage mode="storm" />} />
					<Route path="/puzzles/daily" element={<PuzzlePage mode="daily" />} />
					<Route path="/leaderboard" element={<LeaderboardPage />} />
					<Route path="/profile" element={<ProfilePage />} />
					<Route path="/shop" element={<ShopPage />} />
					<Route path="/shop/:tab" element={<ShopPage />} />
					<Route path="/help" element={<HelpPage />} />
					<Route path="/learn" element={<LearnPage />} />
					<Route path="/replay" element={<ReplayPage />} />
					<Route path="/custom" element={<CustomPage />} />
					<Route path="/admin" element={<AdminHome />} />
					<Route path="/admin/lab" element={<PuzzleLab />} />
					<Route path="/admin/puzzles" element={<PuzzlesAdmin />} />
					<Route path="/admin/combined-puzzles" element={<CombinedPuzzlesAdmin />} />
					<Route path="/admin/starting-positions" element={<StartingPositionsAdmin />} />
					<Route path="/admin/patterns" element={<PatternsAdmin />} />
					<Route path="/admin/start-patterns" element={<StartPatternsAdmin />} />
					<Route path="/admin/bots" element={<BotsAdmin />} />
					<Route path="/admin/marathon-boards" element={<MarathonBoardsAdmin />} />
					<Route path="/admin/debug" element={<DebugAdmin />} />
					<Route path="/admin/design" element={<DesignAdmin />} />
					<Route path="/admin/countdown" element={<CountdownLab />} />
					<Route path="/admin/sounds" element={<SoundLab />} />
					<Route path="/settings" element={<SettingsPage />} />
					<Route path="/privacy" element={<PrivacyPage />} />
					<Route path="/terms" element={<TermsPage />} />
					<Route path="*" element={<Placeholder title="Not found" />} />
				</Routes>
			</main>
			<Footer />
			<Toasts />
		</div>
	);
}
