import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./shared/auth";
import App from "./app/App";
import { match } from "./game/match-store";
import "./styles/global.scss";

if (import.meta.env.DEV) (window as any).__match = match;
match.wire(); // the live-match socket handlers live for the app's lifetime, so a match can be joined from any page

createRoot(document.getElementById("root")!).render(
	<AuthProvider>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</AuthProvider>
);
