// The one socket.io connection to apps/server. Created lazily, shared by every hook and page.
// Same shape achtung-royale's SocketLike shim exposes, so page code never touches socket.io directly.
import { io, Socket } from "socket.io-client";

export interface SocketLike {
	connected: boolean;
	id?: string;
	on(event: string, cb: (msg: any) => void): SocketLike;
	off(event: string, cb?: (msg: any) => void): SocketLike;
	emit(event: string, payload?: any): SocketLike;
	disconnect(): void;
}

let socket: Socket | null = null;

// Dev: Vite proxies /socket.io to the Node server (vite.config.ts). Prod: same origin.
export function getSocket(): SocketLike {
	if (!socket) socket = io({ transports: ["websocket"] });
	return socket as unknown as SocketLike;
}

// ---- Split deployment: the per-match game-server connection ----
// In production a ranked match runs on a separate game server. On `match_handoff` the client opens a
// second socket to that server (the signed join token in the handshake) and plays the match over it;
// lobby, auth and matchmaking stay on the main socket. Every event the game server sends is delivered
// into the handlers registered on the main socket, so the match code does not care which connection a
// frame arrived on. activeSocket() is the connection in-match emits use. In the monolith (ROLE=both)
// `match_handoff` never fires and everything uses the one socket.
let matchSocket: Socket | null = null;
export function activeSocket(): SocketLike { return (matchSocket || getSocket()) as unknown as SocketLike; }
export function hasMatchSocket(): boolean { return !!matchSocket; }
export interface MatchSocketHooks {
	// The server names the id this socket plays as: its own socket id on a first attach, the seat's ORIGINAL
	// id after a mid-match reconnect (the seat keeps one id for the whole match; only the transport changes).
	onAttached?(id: string, reconnected: boolean): void;
	// The match connection dropped. "io server disconnect" = the game server closed it on purpose (the match
	// is over or it no longer knows this seat); anything else is a transport drop socket.io retries on its own.
	onDisconnect?(reason: string): void;
	onReconnecting?(attempt: number): void;
}
export function startMatchSocket(gameUrl: string, token: string, hooks: MatchSocketHooks = {}) {
	teardownMatchSocket();
	const main = getSocket() as unknown as Socket;
	// The join token rides in the handshake and is re-sent as-is on every reconnect, which is how the game
	// server recognises the seat. Quick retries: a phone's wifi→cellular handoff should be back in a second.
	const gs = io(gameUrl, { transports: ["websocket"], forceNew: true, auth: { token }, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
	matchSocket = gs;
	gs.on("match_attached", (d: any) => { if (matchSocket === gs && d && d.id && hooks.onAttached) hooks.onAttached(d.id, !!d.reconnected); });
	gs.on("disconnect", (reason: string) => { if (matchSocket === gs && hooks.onDisconnect) hooks.onDisconnect(reason); });
	gs.io.on("reconnect_attempt", (n: number) => { if (matchSocket === gs && hooks.onReconnecting) hooks.onReconnecting(n); });
	gs.onAny((event: string, ...args: any[]) => {
		if (event === "connected" || event === "authenticated" || event === "match_attached") return;   // lobby-only / handled above
		for (const h of main.listeners(event)) { try { (h as any)(...args); } catch (e) { console.error(`match event '${event}' handler error:`, e); } }
	});
}
export function teardownMatchSocket() {
	if (matchSocket) { try { matchSocket.close(); } catch { /* already closed */ } matchSocket = null; }
}

// Subscribe for the lifetime of a React effect: returns the cleanup function.
export function onSocket(event: string, cb: (msg: any) => void): () => void {
	const s = getSocket();
	s.on(event, cb);
	return () => { s.off(event, cb); };
}
