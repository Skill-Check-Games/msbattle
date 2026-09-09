// Synthesised sound effects (WebAudio, no assets). Muted state and volume persist in localStorage.
// The adaptive music layer can plug in through setMusicSource so effects follow the current chord.
import { music } from "./music";
interface ToneOpts { type?: OscillatorType; freq: number; toFreq?: number; dur: number; gain?: number; delay?: number; }
interface NoiseOpts { dur?: number; cutoff?: number; gain?: number; delay?: number; }
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
function tone(o: ToneOpts) {
	if (muted || !ensure()) return;
	if (ctx!.state === "suspended") ctx!.resume();
	const dur = o.dur / rate, t0 = ctx!.currentTime + (o.delay || 0) / rate;
	const osc = ctx!.createOscillator(), g = ctx!.createGain();
	osc.type = o.type || "sine";
	osc.frequency.setValueAtTime(o.freq, t0);
	if (o.toFreq) osc.frequency.exponentialRampToValueAtTime(o.toFreq, t0 + dur);
	const peak = o.gain != null ? o.gain : 0.2;
	g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
	osc.connect(g); g.connect(master!); osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function noise(o: NoiseOpts) {
	if (muted || !ensure()) return;
	if (ctx!.state === "suspended") ctx!.resume();
	const dur = (o.dur || 0.3) / rate, t0 = ctx!.currentTime + (o.delay || 0) / rate;
	const buf = ctx!.createBuffer(1, Math.floor(ctx!.sampleRate * dur), ctx!.sampleRate), data = buf.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
	const src = ctx!.createBufferSource(); src.buffer = buf;
	const lp = ctx!.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = o.cutoff || 800;
	const g = ctx!.createGain(); g.gain.value = o.gain != null ? o.gain : 0.4;
	src.connect(lp); lp.connect(g); g.connect(master!); src.start(t0);
}
function arp(freqs: number[], step: number, dur: number, gain: number) { freqs.forEach((f, i) => tone({ type: "triangle", freq: f, dur, gain, delay: i * step })); }
function liveMusic() {
	if (!musicSource || musicSource.isMuted()) return null;
	const chord = musicSource.currentChord(); if (!chord) return null;
	return { chord, intensity: musicSource.intensity() };
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
	beep(freq: number) { tone({ type: "sine", freq, dur: 0.12, gain: 0.12 }); },
	sweep() { [392, 440, 523, 587, 659, 784, 880].forEach((f, i) => tone({ type: "triangle", freq: f, dur: 0.17, gain: 0.065, delay: i * 0.09 })); },
	go() { tone({ type: "sine", freq: 880, dur: 0.25, gain: 0.16 }); },
	win() { arp([523, 659, 784, 1047], 0.09, 0.28, 0.12); },
	lose() { tone({ type: "sine", freq: 320, toFreq: 200, dur: 0.32, gain: 0.11 }); },
	seriesWin() { arp([523, 659, 784, 1047, 1319], 0.11, 0.34, 0.13); },
	rankUp() { arp([659, 880, 1047, 1319, 1568], 0.10, 0.38, 0.14); },
	rankDown() { tone({ type: "sine", freq: 440, toFreq: 233, dur: 0.42, gain: 0.12 }); },
	matchFound() { arp([587, 880], 0.09, 0.22, 0.13); },
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
	lab: { tone, noise, arp }
};

// Browsers only start audio after a user gesture: the first click or key unlocks the context.
document.addEventListener("click", () => { sound.unlock(); music.unlock(); }, { once: true });
document.addEventListener("keydown", () => sound.unlock(), { once: true });
sound.setMusicSource(music);
