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
export function startMatchSocket(gameUrl: string, token: string, onConnect?: (id: string) => void) {
	teardownMatchSocket();
	const main = getSocket() as unknown as Socket;
	const gs = io(gameUrl, { transports: ["websocket"], forceNew: true, auth: { token } });
	matchSocket = gs;
	gs.on("connect", () => { if (onConnect && gs.id) onConnect(gs.id); });
	gs.onAny((event: string, ...args: any[]) => {
		if (event === "connected" || event === "authenticated") return;   // lobby-only, never from the game socket
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
