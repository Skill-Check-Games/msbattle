// Synthesised sound effects (WebAudio, no assets). Muted state and volume persist in localStorage.
// The adaptive music layer can plug in through setMusicSource so effects follow the current chord.
import { music } from "./music";
// out: where the sound goes (the master gain unless a bus is given). pan: -1 (left) to 1 (right).
interface ToneOpts { type?: OscillatorType; freq: number; toFreq?: number; dur: number; gain?: number; delay?: number; attack?: number; cutoff?: number; pan?: number; out?: AudioNode; }
interface PadOpts { type?: OscillatorType; freq: number; dur: number; gain?: number; delay?: number; attack?: number; release?: number; cutoff?: number; pan?: number; out?: AudioNode; }
interface NoiseOpts { dur?: number; cutoff?: number; gain?: number; delay?: number; pan?: number; out?: AudioNode; }
interface WhooshOpts { dur: number; from: number; to: number; gain?: number; delay?: number; peakAt?: number; q?: number; pan?: number; out?: AudioNode; }
export interface MusicSource { currentChord(): { scale: number[]; bassRoot: number } | null; intensity(): number; isMuted(): boolean; }

let ctx: AudioContext | null = null, master: GainNode | null = null;
let muted = false, volume = 0.6, rate = 1;
try { muted = localStorage.getItem("ms_muted") === "1"; const v = parseFloat(localStorage.getItem("ms_volume") || ""); if (!isNaN(v)) volume = v; } catch { /* storage blocked */ }
let musicSource: MusicSource | null = null;

function ensure(): AudioContext | null {
	if (ctx) return ctx;
	const AC = window.AudioContext || (window as any).webkitAudioContext;
	if (!AC) return null;
	ctx = new AC(); master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
	return ctx;
}
// Every primitive starts the same way: nothing while muted or without WebAudio, and the context is nudged
// awake in case it is suspended. Returns the start time, in context seconds, for the given delay.
function begin(delay: number | undefined): number | null {
	if (muted || !ensure()) return null;
	if (ctx!.state === "suspended") ctx!.resume();
	return ctx!.currentTime + (delay || 0) / rate;
}
function route(node: AudioNode, pan: number | undefined, out: AudioNode | undefined) {
	const dest = out || master!;
	if (pan && ctx!.createStereoPanner) { const p = ctx!.createStereoPanner(); p.pan.value = pan; node.connect(p); p.connect(dest); }
	else node.connect(dest);
}
function darken(node: AudioNode, cutoff: number | undefined): AudioNode {
	if (!cutoff) return node;
	const lp = ctx!.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cutoff; node.connect(lp);
	return lp;
}
// A plucked note: a near-instant attack (or a short swell) and an exponential decay to silence.
function tone(o: ToneOpts) {
	const t0 = begin(o.delay); if (t0 == null) return;
	const dur = o.dur / rate;
	const osc = ctx!.createOscillator(), g = ctx!.createGain();
	osc.type = o.type || "sine";
	osc.frequency.setValueAtTime(o.freq, t0);
	if (o.toFreq) osc.frequency.exponentialRampToValueAtTime(o.toFreq, t0 + dur);
	const peak = o.gain != null ? o.gain : 0.2, attack = Math.min(dur * 0.5, (o.attack != null ? o.attack : 0.005) / rate);
	g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	darken(osc, o.cutoff).connect(g); route(g, o.pan, o.out); osc.start(t0); osc.stop(t0 + dur + 0.02);
}
// A held note: a linear swell in, a hold, a linear fade out. No transient at all: pads and drones.
function pad(o: PadOpts) {
	const t0 = begin(o.delay); if (t0 == null) return;
	const dur = o.dur / rate;
	const attack = Math.min(dur * 0.5, (o.attack != null ? o.attack : o.dur * 0.4) / rate), release = Math.min(dur - attack, (o.release != null ? o.release : o.dur * 0.4) / rate);
	const osc = ctx!.createOscillator(), g = ctx!.createGain();
	osc.type = o.type || "sine"; osc.frequency.value = o.freq;
	const peak = o.gain != null ? o.gain : 0.05;
	g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + attack); g.gain.setValueAtTime(peak, t0 + dur - release); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
	darken(osc, o.cutoff).connect(g); route(g, o.pan, o.out); osc.start(t0); osc.stop(t0 + dur + 0.02);
}
// A burst of filtered noise that starts loud and dies away: cracks, thuds, blasts.
function noise(o: NoiseOpts) {
	const t0 = begin(o.delay); if (t0 == null) return;
	const dur = (o.dur || 0.3) / rate;
	const buf = ctx!.createBuffer(1, Math.floor(ctx!.sampleRate * dur), ctx!.sampleRate), data = buf.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
	const src = ctx!.createBufferSource(); src.buffer = buf;
	const lp = ctx!.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = o.cutoff || 800;
	const g = ctx!.createGain(); g.gain.value = o.gain != null ? o.gain : 0.4;
	src.connect(lp); lp.connect(g); route(g, o.pan, o.out); src.start(t0);
}
// A swell of noise through a bandpass sweeping from one frequency to another: something big sliding
// past. The level peaks at peakAt (a fraction of the duration) and is gone by the end.
function whoosh(o: WhooshOpts) {
	const t0 = begin(o.delay); if (t0 == null) return;
	const dur = o.dur / rate;
	const buf = ctx!.createBuffer(1, Math.floor(ctx!.sampleRate * dur), ctx!.sampleRate), data = buf.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	const src = ctx!.createBufferSource(); src.buffer = buf;
	const bp = ctx!.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = o.q || 1.2;
	bp.frequency.setValueAtTime(o.from, t0); bp.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
	const g = ctx!.createGain(), peak = o.gain != null ? o.gain : 0.15, tp = t0 + dur * Math.max(0.05, Math.min(0.95, o.peakAt != null ? o.peakAt : 0.6));
	g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, tp); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	src.connect(bp); bp.connect(g); route(g, o.pan, o.out); src.start(t0);
}
function arp(freqs: number[], step: number, dur: number, gain: number) { freqs.forEach((f, i) => tone({ type: "triangle", freq: f, dur, gain, delay: i * step })); }
function liveMusic() {
	if (!musicSource || musicSource.isMuted()) return null;
	const chord = musicSource.currentChord(); if (!chord) return null;
	return { chord, intensity: musicSource.intensity() };
}

// ---- The search loop: the radar. The "Finding enemy" card's radar (MatchFound.module.scss .sweep) turns
// once every SEARCH_SWEEP_S; a soft sonar ping marks each turn, stepping up and back down the A-minor
// pentatonic so it never reads as one note repeating, over a hushed Am pad that breathes in and out every
// fourth turn, with a slow heartbeat in between the pings. Everything runs through its own bus so stopping
// is a short fade rather than a cut, and the found sting can take over at once.
const SEARCH_SWEEP_S = 2;
const SEARCH_PINGS = [440, 523.25, 587.33, 659.25, 587.33, 523.25];   // A4 C5 D5 E5 D5 C5
let searchBus: GainNode | null = null, searchTimer: number | null = null, searchTurnIdx = 0;
function searchTurn() {
	searchTimer = null;
	if (!searchBus || !ctx) return;
	// A suspended context (a queue rejoined after a reload, before any click) would stack every turn onto the
	// same instant and let them all go at once when it wakes: skip the turn instead.
	if (ctx.state === "running" && !muted) {
		const i = searchTurnIdx, out = searchBus;
		if (i % 4 === 0) [220, 261.63, 329.63].forEach(f => pad({ freq: f, dur: SEARCH_SWEEP_S * 4.2, gain: 0.028, attack: SEARCH_SWEEP_S * 1.6, release: SEARCH_SWEEP_S * 1.8, out }));
		tone({ type: "sine", freq: SEARCH_PINGS[i % SEARCH_PINGS.length], dur: 1.1, gain: i % SEARCH_PINGS.length === 0 ? 0.05 : 0.036, attack: 0.02, out });
		if (i % 2 === 1) { tone({ type: "sine", freq: 110, toFreq: 80, dur: 0.22, gain: 0.07, delay: 1.0, out }); tone({ type: "sine", freq: 110, toFreq: 80, dur: 0.18, gain: 0.045, delay: 1.3, out }); }
	}
	searchTurnIdx++;
	searchTimer = window.setTimeout(searchTurn, SEARCH_SWEEP_S / rate * 1000);
}

export const sound = {
	cascade(n: number) {
		const ticks = Math.max(1, Math.min(n, 7)), live = liveMusic();
		for (let i = 0; i < ticks; i++) {
			const delay = i * 0.028;
			if (!live || live.intensity < 0.15) { tone({ type: "triangle", freq: 560 + i * 70, dur: 0.045, gain: 0.05, delay }); continue; }
			const scale = live.chord.scale; let note = scale[i % scale.length]; if (i >= scale.length) note *= 2;
			if (live.intensity < 0.5) tone({ type: "triangle", freq: note, dur: 0.05, gain: 0.055, delay });
			else if (live.intensity < 0.8) tone({ type: "square", freq: note, dur: 0.05, gain: 0.06, delay });
			else { tone({ type: "square", freq: note, dur: 0.055, gain: 0.07, delay }); tone({ type: "triangle", freq: note / 2, dur: 0.07, gain: 0.04, delay }); }
		}
	},
	opponentDone(n: number) { const base = 720 + Math.min(n, 4) * 70; tone({ type: "triangle", freq: base, dur: 0.09, gain: 0.06 }); tone({ type: "triangle", freq: base * 1.34, dur: 0.12, gain: 0.06, delay: 0.085 }); },
	flag() {
		const live = liveMusic();
		if (live && live.intensity > 0.15) { const f = live.chord.bassRoot * 2; tone({ type: "square", freq: f, toFreq: f * 0.75, dur: 0.08, gain: 0.07 }); if (live.intensity > 0.6) noise({ dur: 0.05, cutoff: 3500, gain: 0.05 }); }
		else tone({ type: "square", freq: 420, toFreq: 300, dur: 0.06, gain: 0.06 });
	},
	unflag() { const live = liveMusic(); if (live && live.intensity > 0.15) tone({ type: "square", freq: live.chord.bassRoot * 1.5, dur: 0.04, gain: 0.05 }); else tone({ type: "square", freq: 300, dur: 0.04, gain: 0.04 }); },
	mine() { noise({ dur: 0.35, cutoff: 500, gain: 0.5 }); tone({ type: "sine", freq: 150, toFreq: 50, dur: 0.4, gain: 0.22 }); },
	// An opponent's mine (1v1): the same blast heard from further away, muffled and quieter.
	opponentMine() { noise({ dur: 0.3, cutoff: 260, gain: 0.2 }); tone({ type: "sine", freq: 110, toFreq: 40, dur: 0.35, gain: 0.09 }); },
	beep(freq: number) { tone({ type: "sine", freq, dur: 0.12, gain: 0.12 }); },
	sweep() { [392, 440, 523, 587, 659, 784, 880].forEach((f, i) => tone({ type: "triangle", freq: f, dur: 0.17, gain: 0.065, delay: i * 0.09 })); },
	go() { tone({ type: "sine", freq: 880, dur: 0.25, gain: 0.16 }); },
	win() { arp([523, 659, 784, 1047], 0.09, 0.28, 0.12); },
	lose() { tone({ type: "sine", freq: 320, toFreq: 200, dur: 0.32, gain: 0.11 }); },
	seriesWin() { arp([523, 659, 784, 1047, 1319], 0.11, 0.34, 0.13); },
	rankUp() { arp([659, 880, 1047, 1319, 1568], 0.10, 0.38, 0.14); },
	rankDown() { tone({ type: "sine", freq: 440, toFreq: 233, dur: 0.42, gain: 0.12 }); },
	// The radar's sound, for as long as a seat is empty. Idempotent: a second start while running is ignored.
	startSearch() {
		if (searchBus || !ensure()) return;
		if (ctx!.state === "suspended") ctx!.resume();
		searchBus = ctx!.createGain(); searchBus.gain.value = 1; searchBus.connect(master!);
		searchTurnIdx = 0;
		searchTurn();
	},
	stopSearch() {
		if (searchTimer != null) { clearTimeout(searchTimer); searchTimer = null; }
		const bus = searchBus; searchBus = null;
		if (!bus || !ctx) return;
		const t = ctx.currentTime;
		bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0.0001, t + 0.25);
		setTimeout(() => bus.disconnect(), 400);
	},
	isSearching() { return !!searchBus; },
	// Target acquired: three pings closing in on the target (A5 C6 E6, faster and louder), the lock (a click
	// with a low thud under it as the radar's blip holds), then a two-note confirmation rising out of it.
	matchFound() {
		[880, 1046.5, 1318.5].forEach((f, i) => tone({ type: "sine", freq: f, dur: 0.16, gain: 0.06 + i * 0.015, delay: [0, 0.11, 0.2][i] }));
		tone({ type: "square", freq: 1760, dur: 0.045, gain: 0.05, delay: 0.3 });
		noise({ dur: 0.06, cutoff: 2500, gain: 0.12, delay: 0.3 });
		tone({ type: "sine", freq: 95, toFreq: 55, dur: 0.3, gain: 0.14, delay: 0.3 });
		tone({ type: "triangle", freq: 659.25, dur: 0.24, gain: 0.09, delay: 0.42 });
		tone({ type: "triangle", freq: 880, dur: 0.5, gain: 0.11, delay: 0.54 });
	},
	// The 1v1 banner, timed from its mount (MatchFound.module.scss): the two slabs slide in over 0.7s, one
	// from each side (a whoosh on each side, a thud as they land), the VS punches in from 0.5s and lands
	// with its overshoot around 0.85s (the impact: a boom, a crack and a dark A power chord), a low drone
	// holds the tension under the banner until $hold (2.4s), when the slabs fly off up and down (one wide
	// falling whoosh).
	vsDuel() {
		whoosh({ dur: 0.65, from: 300, to: 2600, gain: 0.13, peakAt: 0.55, pan: -0.8 });
		whoosh({ dur: 0.65, from: 300, to: 2600, gain: 0.13, peakAt: 0.55, pan: 0.8 });
		tone({ type: "sine", freq: 130, toFreq: 48, dur: 0.28, gain: 0.14, delay: 0.6 });
		noise({ dur: 0.07, cutoff: 900, gain: 0.22, delay: 0.6 });
		noise({ dur: 0.16, cutoff: 1600, gain: 0.4, delay: 0.85 });
		tone({ type: "sine", freq: 85, toFreq: 30, dur: 0.7, gain: 0.32, delay: 0.85 });
		[110, 164.81].forEach(f => tone({ type: "sawtooth", freq: f, dur: 0.55, gain: 0.06, cutoff: 1100, delay: 0.85 }));
		pad({ type: "sawtooth", freq: 55, dur: 1.55, gain: 0.05, attack: 0.9, release: 0.3, cutoff: 320, delay: 0.9 });
		pad({ type: "sawtooth", freq: 82.41, dur: 1.55, gain: 0.03, attack: 0.9, release: 0.3, cutoff: 320, delay: 0.9 });
		whoosh({ dur: 0.5, from: 2400, to: 250, gain: 0.11, peakAt: 0.3, delay: 2.4 });
	},
	// The 6-player starting grid, timed from its mount: the six slots glide in from 0.3s and settle around
	// 1.1s (a riser on both sides into a landing boom and a short A-minor fanfare), then a low thump on
	// every beat of the battle theme's tempo idles under the hold, like engines on a grid, until $gridHold
	// (4.3s) when they glide back out (a falling whoosh).
	vsSix() {
		whoosh({ dur: 0.85, from: 250, to: 3200, gain: 0.12, peakAt: 0.7, delay: 0.25, pan: -0.6 });
		whoosh({ dur: 0.85, from: 250, to: 3200, gain: 0.12, peakAt: 0.7, delay: 0.25, pan: 0.6 });
		tone({ type: "sine", freq: 220, toFreq: 880, dur: 0.8, gain: 0.04, attack: 0.3, delay: 0.25 });
		noise({ dur: 0.14, cutoff: 1400, gain: 0.35, delay: 1.1 });
		tone({ type: "sine", freq: 90, toFreq: 32, dur: 0.6, gain: 0.3, delay: 1.1 });
		[440, 523.25, 659.25].forEach((f, i) => tone({ type: "triangle", freq: f, dur: 0.22, gain: 0.085, delay: 1.15 + i * 0.08 }));
		tone({ type: "triangle", freq: 880, dur: 0.7, gain: 0.1, delay: 1.39 });
		for (let b = 0; b < 6; b++) tone({ type: "sine", freq: 110, toFreq: 70, dur: 0.2, gain: 0.05 + b * 0.008, delay: 1.9 + b * 0.469 });
		whoosh({ dur: 0.55, from: 2800, to: 220, gain: 0.11, peakAt: 0.3, delay: 4.3 });
	},
	// Player actions drive the soundtrack's intensity (music.pulse); the session hook calls this per action.
	pulse() { music.pulse(); },
	unlock() { if (ensure() && ctx!.state === "suspended") ctx!.resume(); },
	setMuted(m: boolean) { muted = m; try { localStorage.setItem("ms_muted", m ? "1" : "0"); } catch { /* storage blocked */ } },
	isMuted() { return muted; },
	setVolume(v: number) { volume = v; try { localStorage.setItem("ms_volume", String(v)); } catch { /* storage blocked */ } if (master) master.gain.value = v; },
	getVolume() { return volume; },
	setRate(r: number) { rate = r > 0 ? r : 1; },
	getRate() { return rate; },
	setMusicSource(src: MusicSource | null) { musicSource = src; },
	lab: { tone, pad, noise, whoosh, arp }
};

// Browsers only start audio after a user gesture: the first click or key unlocks the context.
document.addEventListener("click", () => { sound.unlock(); music.unlock(); }, { once: true });
document.addEventListener("keydown", () => sound.unlock(), { once: true });
sound.setMusicSource(music);

// Dev builds expose the sound module for probes (never in production).
if (import.meta.env.DEV) (window as any).__sound = sound;
