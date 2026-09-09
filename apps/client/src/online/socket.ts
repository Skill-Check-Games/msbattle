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

// Subscribe for the lifetime of a React effect: returns the cleanup function.
export function onSocket(event: string, cb: (msg: any) => void): () => void {
	const s = getSocket();
	s.on(event, cb);
	return () => { s.off(event, cb); };
}
