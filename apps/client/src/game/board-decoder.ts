// The server XOR-masks each round's mine layout and ships the bytes. The decoder resolves (r, c)
// lazily so the raw layout is harder to dump from the console; the bytes never leave this closure.
import { MINE } from "./board-render";
import type { CellAt } from "./board-session";

function base64ToBytes(s: string): Uint8Array {
	const bin = atob(s), out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export function makeBoardDecoder(dataB64: string, maskB64: string, cols: number): CellAt {
	const data = base64ToBytes(dataB64), mask = base64ToBytes(maskB64);
	return (r, c) => { const idx = r * cols + c; const v = data[idx] ^ mask[idx % mask.length]; return v === 9 ? MINE : v; };
}
