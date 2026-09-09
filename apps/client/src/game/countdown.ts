// The round-start countdown: the go sweep across the board, then 3-2-1 spelled out of covered cells
// (or, where the board is zoomed and panned, big digits in an overlay the caller shows), then GO.
// One generation counter cancels a sequence when the player leaves or a newer round starts.
import { BoardSession, countdownTickMs } from "./board-session";
import type { SoundLike } from "./board-session";

export interface CountdownSound { sweep?(): void; beep?(hz: number): void; go?(): void; }

let generation = 0;
export function cancelCountdown() { generation++; }

export function countDown(session: BoardSession, delayMs: number, onDone: () => void, opts: { sound?: CountdownSound & Partial<SoundLike>; onDigit?: (n: number) => void; onGo?: () => void } = {}) {
	const gen = ++generation;
	session.startBoardGo();
	opts.sound?.sweep?.();
	const digitsMs = countdownTickMs() * 3;
	const lead = Math.max(0, delayMs - digitsMs);
	const cycle = (n: number) => {
		if (gen !== generation || n <= 0) return;
		if (opts.onDigit) opts.onDigit(n); else session.startCountdownGlyph(n);
		opts.sound?.beep?.(392 + (3 - Math.min(n, 3)) * 110);
		setTimeout(() => cycle(n - 1), countdownTickMs());
	};
	setTimeout(() => { if (gen === generation) cycle(3); }, lead);
	setTimeout(() => { if (gen !== generation) return; opts.sound?.go?.(); opts.onGo?.(); onDone(); }, delayMs);
	return () => { if (gen === generation) generation++; };
}
