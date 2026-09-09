// Session and identity. Mirrors the legacy Auth.js handshake exactly, since the server is unchanged:
//   server "connected" {id, oauth}  ->  we send "authenticate" {token} (stored) or "guest_session"
//   server "authenticated" {account} ->  account state; a fresh guest's token is persisted
// There is no login wall: a visitor with no token becomes a guest, and Sign in upgrades that guest in
// place through the OAuth redirect (/auth/<provider>?upgrade=<token>), which lands back on /#token=...
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
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
	signIn(provider: "google" | "discord" | "dev"): void;
	signOut(): void;
	update(patch: Partial<Account>): void;
}

const AuthContext = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [account, setAccount] = useState<Account | null>(null);
	const [socketId, setSocketId] = useState<string | null>(null);
	const [providers, setProviders] = useState<ProviderFlags>({});

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
		return () => { offConnected(); offAuthed(); };
	}, []);

	const value: AuthState = {
		account, socketId, providers,
		signIn(provider) {
			const token = readToken();
			const upgrade = token ? `?upgrade=${encodeURIComponent(token)}` : "";
			location.href = provider === "dev" ? `/auth/dev${upgrade}` : `/auth/${provider}${upgrade}`;
		},
		signOut() {
			getSocket().emit("sign_out");
			writeToken(null);
			setAccount(null);
			getSocket().emit("guest_session"); // back to a fresh guest, never a login wall
		},
		update(patch) { setAccount(a => (a ? { ...a, ...patch } : a)); }
	};
	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState { return useContext(AuthContext); }
