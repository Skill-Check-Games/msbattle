// Session and identity. Mirrors the legacy Auth.js handshake exactly, since the server is unchanged:
//   server "connected" {id, oauth}  ->  we send "authenticate" {token} (stored) or "guest_session"
//   server "authenticated" {account} ->  account state; a fresh guest's token is persisted
// There is no login wall: a visitor with no token becomes a guest, and Sign in upgrades that guest in
// place through the OAuth redirect (/auth/<provider>?upgrade=<token>), which lands back on /#token=...
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import SignInModal from "../app/SignInModal";
import signStyles from "../app/SignInModal.module.scss";
import { getSocket, onSocket } from "../online/socket";
import type { Account, ProviderFlags } from "./types";
import { announceCosmetics } from "./cosmetics";
import { guessCountry } from "./countries";

const TOKEN_KEY = "ms_session";

function readToken(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
function writeToken(token: string | null) {
	try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
	// Mirrored into a cookie so a plain HTTP GET (the server's early paint) can identify the session.
	const secure = location.protocol === "https:" ? "; secure" : "";
	document.cookie = token
		? `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${secure}`
		: `${TOKEN_KEY}=; path=/; max-age=0; samesite=lax${secure}`;
}

// The OAuth callback returns the session token in the URL fragment. Consume it before connecting.
function takeTokenFromHash() {
	const m = /[#&]token=([^&]+)/.exec(location.hash);
	if (!m) return;
	writeToken(decodeURIComponent(m[1]));
	history.replaceState(null, "", location.pathname + location.search);
}

interface AuthState {
	account: Account | null;
	socketId: string | null;
	providers: ProviderFlags;
	signingIn: string | null;       // the provider the browser is being handed off to (a spinner shows until it leaves)
	openSignIn(): void;             // the sign-in chooser (SignInModal)
	signIn(provider: "google" | "discord" | "dev"): void;
	signOut(): void;
	update(patch: Partial<Account>): void;
}

const AuthContext = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [account, setAccount] = useState<Account | null>(null);
	const [socketId, setSocketId] = useState<string | null>(null);
	const [providers, setProviders] = useState<ProviderFlags>({});
	const [signingIn, setSigningIn] = useState<string | null>(null);
	const [chooserOpen, setChooserOpen] = useState(false);

	useEffect(() => {
		takeTokenFromHash();
		const socket = getSocket();
		const offConnected = onSocket("connected", (data) => {
			setSocketId(data.id);
			setProviders(data.oauth || {});
			const token = readToken();
			if (token) { writeToken(token); socket.emit("authenticate", { token }); }
			else socket.emit("guest_session");
		});
		const offAuthed = onSocket("authenticated", (data: Account) => {
			if (data.token) writeToken(data.token);
			// A fresh guest has no flag: guess one from the browser and store it, guests only and only while unset.
			if (data.guest && !data.country) { const g = guessCountry(); if (g) { data.country = g; socket.emit("set_country", { country: g }); } }
			setAccount(data);
			announceCosmetics(data.ownedItems || []);
		});
		// The admin rank-setter (Design page) echoes the new ratings; keep the account in step.
		const offRating = onSocket("admin_rating_set", (d) => { if (d) setAccount(a => a ? { ...a, ...(typeof d.ratingSprint === "number" ? { ratingSprint: d.ratingSprint } : {}), ...(typeof d.ratingStandard === "number" ? { ratingStandard: d.ratingStandard } : {}) } : a); });
		return () => { offConnected(); offAuthed(); offRating(); };
	}, []);

	const value: AuthState = {
		account, socketId, providers, signingIn,
		openSignIn() { setChooserOpen(true); },
		// The provider's login route is /auth/<provider>/login (oauth.js); the dev login is /auth/dev. A guest's
		// session token rides along as ?upgrade= so the account keeps the guest's stats.
		signIn(provider) {
			const token = readToken();
			const upgrade = token ? `?upgrade=${encodeURIComponent(token)}` : "";
			setSigningIn(provider);
			// a beat so the veil paints before the browser leaves (a redirect can otherwise sit on a frozen page)
			setTimeout(() => { location.href = provider === "dev" ? `/auth/dev${upgrade}` : `/auth/${provider}/login${upgrade}`; }, 60);
		},
		signOut() {
			getSocket().emit("sign_out");
			writeToken(null);
			setAccount(null);
			getSocket().emit("guest_session"); // back to a fresh guest, never a login wall
		},
		update(patch) { setAccount(a => (a ? { ...a, ...patch } : a)); }
	};
	const providerName = signingIn === "google" ? "Google" : signingIn === "discord" ? "Discord" : "the dev login";
	return (
		<AuthContext.Provider value={value}>
			{children}
			<SignInModal open={chooserOpen} onClose={() => setChooserOpen(false)} />
			{signingIn && <div className={signStyles.veil} role="status" aria-live="polite"><div className={signStyles.veilBox}><span className={signStyles.spinner} />Signing in<small>Taking you to {providerName}…</small></div></div>}
		</AuthContext.Provider>
	);
}

export function useAuth(): AuthState { return useContext(AuthContext); }
