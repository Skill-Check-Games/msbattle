// Admin "Sound Lab" (/admin/sounds): every sound effect the game has, each with its own Play button,
// plus a shared playback-rate slider. Four sections: the real sound.* methods (audio/sound.ts) played
// exactly as in a match; alternate takes on the idle-to-ready sweep built from the same
// sound.lab.tone primitive; "Search theme" candidates, subtle loops for the currently silent
// "Finding match" phase (Play/Stop, one at a time); and the "Battle theme lab", independent voice /
// rhythm / progression pickers for the battle theme's layers (music.lab, audio/music.js), looping
// whichever combination is selected. Ported from the legacy admin/SoundLab.js.
import { useEffect, useRef, useState } from "react";
import { sound } from "../../audio/sound";
import { music } from "../../audio/music";
import { AdminPage } from "./admin-shared";
import { Seg, SliderRow, Toggle, LabSection, LabCard, labStyles } from "./lab-shared";
import styles from "./SoundLab.module.scss";

const lab: any = (music as any).lab;
const unlockAudio = () => { sound.unlock(); music.unlock(); };

type Ctx = AudioContext;
type Master = AudioNode;
type Synth = (ctx: Ctx, master: Master, freq: number, t: number, dur: number, gain: number) => void;
type Perc = (ctx: Ctx, master: Master, t: number, gain: number) => void;
interface Kit { kick: Perc; snare: Perc; hihat: Perc; }
interface PercGain { kick: number; snare: number; hat: number; }

// ---- game sounds: every real gameplay sound, with the args it needs to make noise standalone ----
const GAME_SOUNDS: { name: string; desc: string; play: () => void }[] = [
	{ name: "cascade", desc: "A safe cell opens more than one neighbour at once.", play: () => sound.cascade(4) },
	{ name: "opponentDone", desc: "An opponent finishes their board before you, in a race mode.", play: () => sound.opponentDone(2) },
	{ name: "flag", desc: "Placing a flag.", play: () => sound.flag() },
	{ name: "unflag", desc: "Removing a flag.", play: () => sound.unflag() },
	{ name: "mine", desc: "Revealing a mine.", play: () => sound.mine() },
	{ name: "beep", desc: "Generic short blip, used for the 3-2-1 countdown digits.", play: () => sound.beep(440) },
	{ name: "sweep", desc: "The idle-to-ready board sweep, right as a round is about to start.", play: () => sound.sweep() },
	{ name: "go", desc: "The moment a round actually goes live, at the end of the countdown.", play: () => sound.go() },
	{ name: "win", desc: "You clear the board.", play: () => sound.win() },
	{ name: "lose", desc: "You hit a mine and lose.", play: () => sound.lose() },
	{ name: "seriesWin", desc: "You win an entire ranked series.", play: () => sound.seriesWin() },
	{ name: "rankUp", desc: "You climb a rank tier.", play: () => sound.rankUp() },
	{ name: "rankDown", desc: "You drop a rank tier.", play: () => sound.rankDown() },
	{ name: "matchFound", desc: "A ranked queue forms a match.", play: () => sound.matchFound() }
];

// ---- sweep variants: all built from sound.lab.tone, so a candidate is byte-for-byte what would ship ----
function playArp(freqs: number[], step: number, dur: number, gain: number) {
	freqs.forEach((f, i) => sound.lab.tone({ type: "triangle", freq: f, dur, gain, delay: i * step }));
}
const SWEEP_VARIANTS: { name: string; badge?: string; desc: string; play: () => void }[] = [
	{ name: "Shimmer", badge: "Shipped", desc: "Seven-note ascending arpeggio, evenly spaced. What sound.sweep() plays today.", play: () => playArp([392, 440, 523, 587, 659, 784, 880], 0.09, 0.17, 0.065) },
	{ name: "Shimmer: Wide", desc: "Fewer notes with bigger jumps between them, spaced further apart. More of a sweep, less of a twinkle.", play: () => playArp([330, 440, 587, 784, 1047], 0.12, 0.22, 0.07) },
	{ name: "Shimmer: Dense", desc: "Ten notes packed tightly. A smoother, faster cascade of sparkle instead of a clear staircase.", play: () => playArp([392, 440, 494, 523, 587, 659, 698, 784, 880, 988], 0.055, 0.13, 0.05) },
	{ name: "Shimmer: Bloom", desc: "Same seven notes as the shipped version, but held long enough to overlap into a chordal bloom rather than a staircase.", play: () => playArp([392, 440, 523, 587, 659, 784, 880], 0.05, 0.35, 0.045) }
];

// ---- search theme: subtle looping candidates for the "Finding match" phase ----
// All stay in A minor and reuse the battle theme's voices or the pentatonic notes sound.sweep()
// climbs, so whichever ships, the ear is already tuned to the right key before the handoff.
const SEARCH_PAD_AM = [220.00, 261.63, 329.63];                        // A3 C4 E4
const SEARCH_SCALE = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00]; // A minor pentatonic

function noiseBuffer(ctx: Ctx, dur: number, curve: number): AudioBufferSourceNode {
	const samples = Math.floor(ctx.sampleRate * dur);
	const buf = ctx.createBuffer(1, samples, ctx.sampleRate), data = buf.getChannelData(0);
	for (let i = 0; i < samples; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / samples, curve);
	const src = ctx.createBufferSource(); src.buffer = buf;
	return src;
}
// A soft sine ping with a long, reverb-like decay: a sonar blip rather than a percussive attack.
function searchPing(ctx: Ctx, master: Master, freq: number, t: number, dur: number, gain: number) {
	const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = freq;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.05);
}
// A hushed held chord (slow fade in/out, no attack transient).
function searchPad(ctx: Ctx, master: Master, freqs: number[], t: number, dur: number, gain: number) {
	for (const f of freqs) {
		const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = f;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur);
		osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.05);
	}
}
function searchSonarDrift(ctx: Ctx, master: Master, t: number, beatS: number, cycleIdx: number, rate: number) {
	if (cycleIdx % 4 === 0) searchPad(ctx, master, SEARCH_PAD_AM, t, beatS * 16, 0.035);
	if (cycleIdx % 2 === 0) searchPing(ctx, master, SEARCH_SCALE[(cycleIdx / 2) % SEARCH_SCALE.length], t + beatS * 0.5, 1.4 / rate, 0.05);
}
function searchSlowArp(_ctx: Ctx, _master: Master, t: number, beatS: number, cycleIdx: number) {
	const idx = cycleIdx % SEARCH_SCALE.length, note = SEARCH_SCALE[idx];
	lab.triangleArp(note, t, beatS * 1.6, 0.045);
	if (idx % 3 === 0) lab.triangleArp(note / 2, t + beatS * 1.0, beatS * 1.2, 0.02);
}
function searchHeartbeat(ctx: Ctx, master: Master, t: number, beatS: number, cycleIdx: number, rate: number) {
	lab.subGrowlBass(110.00, t, beatS * 0.5, 0.05);
	lab.subGrowlBass(110.00, t + beatS * 0.9, beatS * 0.35, 0.03);
	if (cycleIdx % 4 === 2) searchPing(ctx, master, SEARCH_SCALE[(cycleIdx * 3) % SEARCH_SCALE.length] * 2, t + beatS * 1.5, 0.9 / rate, 0.035);
}
// A deep tom/taiko hit: a sine sweeping through a low tom's range plus a short noise "skin" transient.
function warDrumHit(ctx: Ctx, master: Master, t: number, gain: number, dur: number) {
	const osc = ctx.createOscillator(); osc.type = "sine";
	osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(65, t + dur * 0.85);
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.02);
	const noiseDur = 0.05, src = noiseBuffer(ctx, noiseDur, 2.2);
	const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 220; bp.Q.value = 1.1;
	const ng = ctx.createGain();
	ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(gain * 0.6, t + 0.003); ng.gain.exponentialRampToValueAtTime(0.0001, t + noiseDur);
	src.connect(bp); bp.connect(ng); ng.connect(master); src.start(t);
}
// A sharp, bright noise crack: the "call to arms" accent.
function warAccent(ctx: Ctx, master: Master, t: number, gain: number) {
	const dur = 0.16, src = noiseBuffer(ctx, dur, 1.3);
	const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 0.9;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	src.connect(bp); bp.connect(g); g.connect(master); src.start(t);
}
// A distant horn call: a slow-swelling sawtooth dyad through a dark lowpass.
function warHorn(ctx: Ctx, master: Master, freqs: number[], t: number, dur: number, gain: number) {
	for (const f of freqs) {
		const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = f;
		const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 900;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
		osc.connect(filt); filt.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.05);
	}
}
// A 2-bar marching phrase that escalates over its first ~3 phrases (stage 0 to 3) then holds.
function searchWarDrums(ctx: Ctx, master: Master, t: number, beatS: number, cycleIdx: number) {
	const stage = Math.min(3, Math.floor(cycleIdx / 3)), hitDur = beatS * 0.7;
	if (cycleIdx % 2 === 0) searchPad(ctx, master, [110.00, 164.81], t, beatS * 16, 0.026);
	warDrumHit(ctx, master, t, 0.06, hitDur);
	warDrumHit(ctx, master, t + beatS * 4, 0.06, hitDur);
	if (stage >= 1) { warDrumHit(ctx, master, t + beatS * 2, 0.045, hitDur * 0.8); warDrumHit(ctx, master, t + beatS * 6, 0.045, hitDur * 0.8); }
	if (stage >= 2) { warDrumHit(ctx, master, t + beatS * 3.5, 0.035, hitDur * 0.5); warDrumHit(ctx, master, t + beatS * 7.5, 0.035, hitDur * 0.5); }
	if (stage >= 3) { warAccent(ctx, master, t + 0.01, 0.05); if (cycleIdx % 4 === 0) warHorn(ctx, master, [110.00, 164.81], t + beatS * 0.5, beatS * 3, 0.03); }
}
interface SearchVariant { id: string; name: string; cycleBeats: number; desc: string; schedule: (ctx: Ctx, master: Master, t: number, beatS: number, cycleIdx: number, rate: number) => void; }
const SEARCH_VARIANTS: SearchVariant[] = [
	{ id: "sonar", name: "Sonar Drift", cycleBeats: 4, schedule: searchSonarDrift, desc: "A hushed Am pad breathing underneath, with an occasional soft ping stepping up through the same notes sound.sweep() climbs. The most spacious, ambient of the four." },
	{ id: "slowarp", name: "Slow Arpeggio", cycleBeats: 2, schedule: searchSlowArp, desc: "sound.sweep()'s own scale and voice, unhurried: one note every couple of beats instead of a fast climb. The most direct preview of the handoff into sweep." },
	{ id: "heartbeat", name: "Heartbeat", cycleBeats: 8, schedule: searchHeartbeat, desc: "A soft double pulse on the battle theme's own bass voice, like a waiting-room heartbeat, with rare high blips for other players joining. The most tension-flavoured." },
	{ id: "wardrums", name: "War Drums", cycleBeats: 8, schedule: searchWarDrums, desc: "Heartbeat's idea, more involved: taiko-style drum hits over a dark open-fifth drone, starting as a sparse marching pulse and layering in backbeats, pickup triplets, a call-to-arms crack and a distant horn over ~30s, then holding there, like troops mustering before the fight." }
];

// ---- battle theme lab: bass / melody / percussion, each independently switchable ----
const BASS_PREVIEW_GAIN = 0.24;
const MELODY_PREVIEW_GAIN = 0.09;
const PERC_PREVIEW_GAIN: PercGain = { kick: 0.24, snare: 0.13, hat: 0.03 };

// music.lab's real synths reach ctx/master through music.js's closure; adapted to the shared shape.
const playPulseBass: Synth = (_c, _m, freq, t, dur, gain) => lab.pulseBass(freq, t, dur, gain);
const playSubGrowlBass: Synth = (_c, _m, freq, t, dur, gain) => lab.subGrowlBass(freq, t, dur, gain);
const bassSaw: Synth = (ctx, master, freq, t, dur, gain) => {
	const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = freq;
	const filt = ctx.createBiquadFilter(); filt.type = "lowpass";
	filt.frequency.setValueAtTime(1100, t); filt.frequency.exponentialRampToValueAtTime(320, t + dur * 0.7);
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * 0.85, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	osc.connect(filt); filt.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.02);
};
const bassWobbleFilter: Synth = (ctx, master, freq, t, dur, gain) => {
	const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = freq;
	const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.Q.value = 9; filt.frequency.value = 550;
	const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 5.5;
	const lfoGain = ctx.createGain(); lfoGain.gain.value = 420;
	lfo.connect(lfoGain); lfoGain.connect(filt.frequency);
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	osc.connect(filt); filt.connect(g); g.connect(master);
	lfo.start(t); lfo.stop(t + dur + 0.02); osc.start(t); osc.stop(t + dur + 0.02);
};
interface Timbre { id: string; label: string; desc: string; synth: Synth; }
const BASS_TIMBRES: Timbre[] = [
	{ id: "subgrowl", label: "Sub Growl", desc: "A square pulse layered with a sine an octave down: the shipped bass's own voice.", synth: playSubGrowlBass },
	{ id: "pulse", label: "Pulse", desc: "The plain square pulse Sub Growl is built on, without the sub-octave layer. Thinner, punchier.", synth: playPulseBass },
	{ id: "saw", label: "Sawtooth Drive", desc: "Sawtooth instead of square, same envelope. Brighter, more aggressive.", synth: bassSaw },
	{ id: "wobble", label: "Wobble Filter", desc: "Sawtooth through an LFO-wobbled resonant filter: a dubstep-lite \"wub\".", synth: bassWobbleFilter }
];

type BassRhythm = (synth: Synth, ctx: Ctx, master: Master, freq: number, t: number, beatS: number, gain: number) => void;
const rhythmSyncopated: BassRhythm = (synth, ctx, master, freq, t, beatS, gain) => { // mirrors music.js BASS_SYNCOPATED_HITS
	for (const h of [{ at: 0, dur: 0.9, g: 1.0 }, { at: 0.75, dur: 0.4, g: 0.6 }, { at: 1.5, dur: 0.4, g: 0.85 }, { at: 2.25, dur: 0.4, g: 0.55 }, { at: 3, dur: 0.9, g: 0.9 }, { at: 3.75, dur: 0.4, g: 0.5 }]) synth(ctx, master, freq, t + h.at * beatS, h.dur * beatS, gain * h.g);
};
const rhythmStraight16: BassRhythm = (synth, ctx, master, freq, t, beatS, gain) => {
	const sixteenth = beatS * 0.25;
	for (let s = 0; s < 16; s++) synth(ctx, master, freq, t + s * sixteenth, sixteenth * 0.85, gain * ((s % 4 === 0) ? 1.0 : (s % 2 === 0 ? 0.55 : 0.4)));
};
const rhythmFourFloor: BassRhythm = (synth, ctx, master, freq, t, beatS, gain) => { for (let b = 0; b < 4; b++) synth(ctx, master, freq, t + b * beatS, beatS * 0.92, gain); };
const rhythmOctaveBounce: BassRhythm = (synth, ctx, master, freq, t, beatS, gain) => {
	const sixteenth = beatS * 0.25;
	for (let s = 0; s < 16; s++) synth(ctx, master, (s % 2 === 1) ? freq * 2 : freq, t + s * sixteenth, sixteenth * 0.85, gain * ((s % 4 === 0) ? 1.0 : (s % 2 === 0 ? 0.55 : 0.4)));
};
const rhythmHalfTime: BassRhythm = (synth, ctx, master, freq, t, beatS, gain) => {
	const eighth = beatS * 0.5;
	for (let e = 0; e < 8; e++) synth(ctx, master, freq, t + e * eighth, eighth * 0.88, gain * ((e % 2 === 0) ? 1.0 : 0.55));
};
interface BassRhythmOpt { id: string; label: string; desc: string; schedule: BassRhythm; }
const BASS_RHYTHMS: BassRhythmOpt[] = [
	{ id: "syncopated", label: "Syncopated", desc: "Hits push ahead of some beats instead of landing squarely on them. Section A's bass rhythm.", schedule: rhythmSyncopated },
	{ id: "straight16", label: "Straight 16ths", desc: "16 evenly-spaced hits per bar, loud on the downbeats. Section B's bass rhythm, a steadier pump instead of a groove.", schedule: rhythmStraight16 },
	{ id: "fourfloor", label: "Four-on-the-floor", desc: "One sustained note per beat instead of short hits. Steadier, more spacious.", schedule: rhythmFourFloor },
	{ id: "octavebounce", label: "Octave Bounce", desc: "16 evenly-spaced hits, alternating root / octave-up. A bouncier, more melodic \"oom-pah\" line.", schedule: rhythmOctaveBounce },
	{ id: "halftime", label: "Half-time 8ths", desc: "8 hits per bar instead of 16: half the density, a heavier, more deliberate feel.", schedule: rhythmHalfTime }
];

const playTriangleArp: Synth = (_c, _m, freq, t, dur, gain) => lab.triangleArp(freq, t, dur, gain);
const melodySquare: Synth = (ctx, master, freq, t, dur, gain) => {
	const osc = ctx.createOscillator(); osc.type = "square"; osc.frequency.value = freq;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * 0.8, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.02);
};
const melodyBell: Synth = (ctx, master, freq, t, dur, gain) => {
	const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = freq * 2;
	const osc2 = ctx.createOscillator(); osc2.type = "sine"; osc2.frequency.value = freq * 3.01;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.6);
	const g2 = ctx.createGain();
	g2.gain.setValueAtTime(0.0001, t); g2.gain.linearRampToValueAtTime(gain * 0.35, t + 0.002); g2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.1);
	osc.connect(g); g.connect(master); osc2.connect(g2); g2.connect(master);
	osc.start(t); osc.stop(t + dur * 1.6 + 0.02); osc2.start(t); osc2.stop(t + dur * 1.1 + 0.02);
};
const melodyPluck: Synth = (ctx, master, freq, t, dur, gain) => {
	const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = freq;
	const filt = ctx.createBiquadFilter(); filt.type = "lowpass";
	filt.frequency.setValueAtTime(freq * 6, t); filt.frequency.exponentialRampToValueAtTime(freq * 1.2, t + dur * 0.8);
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	osc.connect(filt); filt.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.02);
};
const MELODY_TIMBRES: Timbre[] = [
	{ id: "triangle", label: "Triangle", desc: "Fast triangle-wave notes: the shipped arpeggio's own voice, straight NES chiptune.", synth: playTriangleArp },
	{ id: "square", label: "Square", desc: "Buzzier square wave instead of triangle. Punchier, more 8-bit.", synth: melodySquare },
	{ id: "bell", label: "Bell", desc: "Two sine partials layered up an octave and a fifth: a chiming, metallic ring instead of a chip blip.", synth: melodyBell },
	{ id: "pluck", label: "Pluck", desc: "Sawtooth through a fast-closing filter: a plucked, pizzicato character.", synth: melodyPluck }
];

type MelodyRhythm = (synth: Synth, ctx: Ctx, master: Master, notes: number[], t: number, beatS: number, gain: number) => void;
const melodyRunning8ths: MelodyRhythm = (synth, ctx, master, notes, t, beatS, gain) => {
	const sixteenth = beatS * 0.25;
	for (let a = 0; a < 8; a++) synth(ctx, master, notes[a % notes.length], t + a * sixteenth * 2, sixteenth * 1.6, gain);
};
const melodyQuarters: MelodyRhythm = (synth, ctx, master, notes, t, beatS, gain) => { for (let b = 0; b < 4; b++) synth(ctx, master, notes[b % notes.length], t + b * beatS, beatS * 0.85, gain); };
const melodySixteenths: MelodyRhythm = (synth, ctx, master, notes, t, beatS, gain) => {
	const sixteenth = beatS * 0.25;
	for (let s = 0; s < 16; s++) synth(ctx, master, notes[s % notes.length], t + s * sixteenth, sixteenth * 0.8, gain * (s % 4 === 0 ? 1.0 : 0.7));
};
const melodySyncopated: MelodyRhythm = (synth, ctx, master, notes, t, beatS, gain) => {
	for (const h of [{ at: 0, idx: 0, dur: 0.4 }, { at: 0.75, idx: 1, dur: 0.3 }, { at: 1.5, idx: 2, dur: 0.3 }, { at: 2.5, idx: 3, dur: 0.4 }, { at: 3.25, idx: 1, dur: 0.3 }]) synth(ctx, master, notes[h.idx % notes.length], t + h.at * beatS, h.dur * beatS, gain);
};
interface MelodyRhythmOpt { id: string; label: string; desc: string; schedule: MelodyRhythm; }
const MELODY_RHYTHMS: MelodyRhythmOpt[] = [
	{ id: "running8ths", label: "Running 8ths", desc: "8 notes per bar cycling through the chord tones. Section A's melody rhythm.", schedule: melodyRunning8ths },
	{ id: "sixteenths", label: "Sixteenth run", desc: "16 notes per bar, a fast machine-gun arpeggio. Section B's melody rhythm, paired there with a quieter per-note gain so the density reads as faster, not louder.", schedule: melodySixteenths },
	{ id: "quarters", label: "Sparse quarters", desc: "One note per beat instead of 8. A calmer, more spacious line.", schedule: melodyQuarters },
	{ id: "syncopated", label: "Syncopated", desc: "A handful of notes pushed off the beat instead of an even cycle. More of a riff, less of a scale run.", schedule: melodySyncopated }
];

const percKick: Perc = (_c, _m, t, gain) => lab.kick(t, gain);
const percSnare: Perc = (_c, _m, t, gain) => lab.snare(t, gain);
const percHihat: Perc = (_c, _m, t, gain) => lab.hihat(t, gain);
const punchyKick: Perc = (ctx, master, t, gain) => {
	const osc = ctx.createOscillator(); osc.type = "sine";
	osc.frequency.setValueAtTime(190, t); osc.frequency.exponentialRampToValueAtTime(35, t + 0.16);
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * 1.15, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
	osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + 0.26);
};
const punchySnare: Perc = (ctx, master, t, gain) => {
	const dur = 0.11, src = noiseBuffer(ctx, dur, 0.9);
	const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 2.2;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * 1.2, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	src.connect(bp); bp.connect(g); g.connect(master); src.start(t);
};
const punchyHihat: Perc = (ctx, master, t, gain) => {
	const src = noiseBuffer(ctx, 0.035, 2.5);
	const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 8500;
	const g = ctx.createGain(); g.gain.value = gain * 1.1;
	src.connect(hp); hp.connect(g); g.connect(master); src.start(t);
};
const lofiKick: Perc = (ctx, master, t, gain) => {
	const osc = ctx.createOscillator(); osc.type = "sine";
	osc.frequency.setValueAtTime(130, t); osc.frequency.exponentialRampToValueAtTime(45, t + 0.1);
	const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 500;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * 0.85, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
	osc.connect(filt); filt.connect(g); g.connect(master); osc.start(t); osc.stop(t + 0.18);
};
const lofiSnare: Perc = (ctx, master, t, gain) => {
	const dur = 0.12, src = noiseBuffer(ctx, dur, 1.6);
	const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain * 0.8, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
	src.connect(lp); lp.connect(g); g.connect(master); src.start(t);
};
const lofiHihat: Perc = (ctx, master, t, gain) => {
	const src = noiseBuffer(ctx, 0.05, 2);
	const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 4500; bp.Q.value = 0.6;
	const g = ctx.createGain(); g.gain.value = gain * 0.7;
	src.connect(bp); bp.connect(g); g.connect(master); src.start(t);
};
const playElectroKick: Perc = (_c, _m, t, gain) => lab.electroKick(t, gain);
const playElectroSnare: Perc = (_c, _m, t, gain) => lab.electroSnare(t, gain);
const playElectroHihat: Perc = (_c, _m, t, gain) => lab.electroHihat(t, gain);
interface KitOpt extends Kit { id: string; label: string; desc: string; }
const PERC_KITS: KitOpt[] = [
	{ id: "electro", label: "Electro", desc: "808-style booming kick, a layered clap instead of a snare, crisp metallic hats: the shipped kit.", kick: playElectroKick, snare: playElectroSnare, hihat: playElectroHihat },
	{ id: "classic", label: "Classic", desc: "Sine kick, noise-burst snare, bright hi-hat. Simpler and punchier, less low-end.", kick: percKick, snare: percSnare, hihat: percHihat },
	{ id: "punchy", label: "Punchy", desc: "Harder-hitting kick and snare: more low-end thump, a tighter crack.", kick: punchyKick, snare: punchySnare, hihat: punchyHihat },
	{ id: "lofi", label: "Lo-fi", desc: "Everything filtered and softened. A muffled, vinyl-ish character.", kick: lofiKick, snare: lofiSnare, hihat: lofiHihat }
];

type PercRhythm = (kit: Kit, ctx: Ctx, master: Master, t: number, beatS: number, gain: PercGain) => void;
const percBreakbeat: PercRhythm = (kit, ctx, master, t, beatS, gain) => { // mirrors music.js DRUM_KICK_BEATS / DRUM_SNARE_BEATS
	for (const b of [0, 1.5, 2.75]) kit.kick(ctx, master, t + b * beatS, gain.kick);
	kit.snare(ctx, master, t + 1 * beatS, gain.snare); kit.snare(ctx, master, t + 3 * beatS, gain.snare);
	for (let h = 0; h < 16; h++) kit.hihat(ctx, master, t + h * beatS * 0.25, gain.hat * (h % 4 === 0 ? 1.1 : 0.6));
};
const percFourFloor: PercRhythm = (kit, ctx, master, t, beatS, gain) => {
	for (let b = 0; b < 4; b++) kit.kick(ctx, master, t + b * beatS, gain.kick);
	kit.snare(ctx, master, t + 1 * beatS, gain.snare); kit.snare(ctx, master, t + 3 * beatS, gain.snare);
	for (let h = 0; h < 8; h++) kit.hihat(ctx, master, t + h * beatS * 0.5, gain.hat * (h % 2 === 1 ? 1.2 : 0.7));
};
const percHalfTime: PercRhythm = (kit, ctx, master, t, beatS, gain) => {
	kit.kick(ctx, master, t, gain.kick); kit.snare(ctx, master, t + 2 * beatS, gain.snare);
	for (let h = 0; h < 4; h++) kit.hihat(ctx, master, t + h * beatS, gain.hat);
};
const percMinimal: PercRhythm = (kit, ctx, master, t, beatS, gain) => {
	kit.kick(ctx, master, t, gain.kick); kit.kick(ctx, master, t + 2 * beatS, gain.kick);
	kit.snare(ctx, master, t + 1 * beatS, gain.snare); kit.snare(ctx, master, t + 3.75 * beatS, gain.snare * 0.5); kit.snare(ctx, master, t + 3 * beatS, gain.snare);
	for (let h = 0; h < 16; h++) kit.hihat(ctx, master, t + h * beatS * 0.25, gain.hat * 0.8);
};
interface PercRhythmOpt { id: string; label: string; desc: string; schedule: PercRhythm; }
const PERC_RHYTHMS: PercRhythmOpt[] = [
	{ id: "breakbeat", label: "Breakbeat", desc: "Syncopated kick hits ahead of the beat, snare on 2 & 4, hi-hat 16ths: the shipped pattern.", schedule: percBreakbeat },
	{ id: "fourfloor", label: "Four-on-the-floor", desc: "Kick every beat, snare on 2 & 4, hi-hat 8ths. A steadier, less rolling groove.", schedule: percFourFloor },
	{ id: "halftime", label: "Half-time", desc: "Kick on 1, snare only on 3, hi-hat quarters: half the density, more space.", schedule: percHalfTime },
	{ id: "minimal", label: "Minimal", desc: "Kick on 1 & 3 only, a ghost snare before the backbeat, steady 16th hi-hats underneath.", schedule: percMinimal }
];

// 4 bars of {root, arp} in the same A-minor/C-major key centre; arp values are the real chord tones.
const Am = { root: 110.00, arp: [220.00, 261.63, 329.63, 440.00] };
const Em = { root: 82.41, arp: [164.81, 196.00, 246.94, 329.63] };
const F = { root: 87.31, arp: [174.61, 220.00, 261.63, 349.23] };
const C = { root: 130.81, arp: [261.63, 329.63, 392.00, 523.25] };
const Dm = { root: 73.42, arp: [146.83, 174.61, 220.00, 293.66] };
const G = { root: 98.00, arp: [196.00, 246.94, 293.66, 392.00] };
interface Progression { id: string; label: string; desc: string; bars: { root: number; arp: number[] }[]; }
const PROGRESSIONS: Progression[] = [
	{ id: "amemfc", label: "Am-Em-F-C", desc: "Em in place of the more usual second chord: moodier, more melancholic. Section A of the shipped song.", bars: [Am, Em, F, C] },
	{ id: "amdmgc", label: "Am-Dm-G-C", desc: "Descends through the circle of fifths, a more cinematic, driving pull toward C. Section B of the shipped song, paired there with a straight-16th bass and a sixteenth-run melody for a denser feel than Section A.", bars: [Am, Dm, G, C] },
	{ id: "amfcg", label: "Am-F-C-G", desc: "The \"axis of awesome\" progression. Brighter and more resolved than either shipped section.", bars: [Am, F, C, G] },
	{ id: "amgcf", label: "Am-G-C-F", desc: "Same four chords as the axis-of-awesome progression, reordered: resolves to F instead of G, a softer landing each loop.", bars: [Am, G, C, F] },
	{ id: "cgamf", label: "C-G-Am-F", desc: "The classic four-chord pop progression, same key centre. Opens major instead of minor.", bars: [C, G, Am, F] }
];

interface BattleSelection {
	progression: Progression;
	bass: { on: boolean; timbre: Timbre; rhythm: BassRhythmOpt };
	melody: { on: boolean; timbre: Timbre; rhythm: MelodyRhythmOpt };
	perc: { on: boolean; kit: KitOpt; rhythm: PercRhythmOpt };
}

// ---- page ----
export default function SoundLab() {
	const [rate, setRate] = useState(sound.getRate());
	const [, bump] = useState(0);
	const rerender = () => bump(v => v + 1);

	// Search theme loop: one variant at a time, a setTimeout chain sized to the variant's own cycle.
	const [searchId, setSearchId] = useState<string | null>(null);
	const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const searchCycle = useRef(0);
	const stopSearch = () => { if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null; } setSearchId(null); };
	const playSearchCycle = (variant: SearchVariant) => {
		const ctx: Ctx | null = lab.getCtx(), master: Master | null = lab.getMaster();
		if (!ctx || !master) return;
		const r = sound.getRate(), beatS = lab.BEAT_S / r, t = ctx.currentTime + 0.05;
		variant.schedule(ctx, master, t, beatS, searchCycle.current, r);
		searchCycle.current++;
		searchTimer.current = setTimeout(() => playSearchCycle(variant), variant.cycleBeats * beatS * 1000);
	};
	const startSearch = (variant: SearchVariant) => { stopSearch(); searchCycle.current = 0; setSearchId(variant.id); playSearchCycle(variant); };

	// Battle theme loop: reads the selection fresh every bar, so any change lands on the next bar.
	const sel = useRef<BattleSelection>({
		progression: PROGRESSIONS[0],
		bass: { on: true, timbre: BASS_TIMBRES[0], rhythm: BASS_RHYTHMS[0] },
		melody: { on: true, timbre: MELODY_TIMBRES[0], rhythm: MELODY_RHYTHMS[0] },
		perc: { on: true, kit: PERC_KITS[0], rhythm: PERC_RHYTHMS[0] }
	}).current;
	const [battlePlaying, setBattlePlaying] = useState(false);
	const battleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const barIdx = useRef(0);
	const stopBattle = () => { if (battleTimer.current) { clearTimeout(battleTimer.current); battleTimer.current = null; } setBattlePlaying(false); };
	const playBattleBar = () => {
		const ctx: Ctx | null = lab.getCtx(), master: Master | null = lab.getMaster();
		if (!ctx || !master) return;
		const r = sound.getRate(), beatS = lab.BEAT_S / r, barDurMs = (lab.BAR_DUR / r) * 1000;
		const bar = sel.progression.bars[barIdx.current % sel.progression.bars.length], t = ctx.currentTime + 0.05;
		if (sel.bass.on) sel.bass.rhythm.schedule(sel.bass.timbre.synth, ctx, master, bar.root, t, beatS, BASS_PREVIEW_GAIN);
		if (sel.melody.on) sel.melody.rhythm.schedule(sel.melody.timbre.synth, ctx, master, bar.arp, t, beatS, MELODY_PREVIEW_GAIN);
		if (sel.perc.on) sel.perc.rhythm.schedule(sel.perc.kit, ctx, master, t, beatS, PERC_PREVIEW_GAIN);
		barIdx.current++;
		battleTimer.current = setTimeout(playBattleBar, barDurMs);
	};
	const startBattle = () => { stopBattle(); setBattlePlaying(true); barIdx.current = 0; playBattleBar(); };

	// Leaving the page stops every loop and resets the shared playback rate, the only outside state touched.
	useEffect(() => () => {
		if (searchTimer.current) clearTimeout(searchTimer.current);
		if (battleTimer.current) clearTimeout(battleTimer.current);
		sound.setRate(1);
	}, []);

	const pick = <T extends { id: string }>(options: T[], id: string) => options.find(o => o.id === id)!;
	const axis = <T extends { id: string; label: string; desc: string }>(label: string, options: T[], current: T, onPick: (o: T) => void) => (
		<div className={styles.axis}>
			<div className={styles.axisLabel}>{label}</div>
			<p className={styles.axisDesc}>{current.desc}</p>
			<Seg className={styles.segTight} options={options.map(o => ({ id: o.id, label: o.label }))} value={current.id} onChange={id => { onPick(pick(options, id)); rerender(); }} ariaLabel={label} />
		</div>
	);
	const layer = (title: string, state: { on: boolean }, axes: React.ReactNode) => (
		<div className={`${styles.layer} ${state.on ? "" : styles.layerOff}`}>
			<div className={styles.layerHead}><span className={styles.layerTitle}>{title}</span><Toggle on={state.on} label={title + " on"} onChange={on => { state.on = on; rerender(); }} /></div>
			<div className={styles.layerAxes}>{axes}</div>
		</div>
	);

	return (
		<AdminPage title="Sound Lab" sub="Every sound effect the game has, each with its own Play button, at a speed you can dial up or down. The clips below call the exact code that ships, this isn't a copy of it." wide>
			<div className={labStyles.card}>
				<h2 className={labStyles.panelTitle}>Playback speed</h2>
				<SliderRow label="Speed" note="Stretches or compresses timing only, pitch stays put. Applies to every Play button below. Resets to 1× when you leave this page." value={rate} min={0.25} max={2.5} step={0.05} format={v => v.toFixed(2) + "×"} onChange={v => { sound.setRate(v); setRate(v); }} />
			</div>

			<LabSection title="Game sounds" sub="Exactly what plays in a real match.">
				<div className={labStyles.grid}>{GAME_SOUNDS.map(item => (
					<LabCard key={item.name} name={item.name} desc={item.desc}>
						<button type="button" className={`btn ${labStyles.playBtn}`} onClick={() => { unlockAudio(); item.play(); }}>▶ Play</button>
					</LabCard>
				))}</div>
			</LabSection>

			<LabSection title="Sweep variants" sub="Alternate takes on the idle-to-ready sweep (sound.sweep), for comparing candidates, not a proposal ranked in order.">
				<div className={labStyles.grid}>{SWEEP_VARIANTS.map(item => (
					<LabCard key={item.name} name={item.name} badge={item.badge} desc={item.desc}>
						<button type="button" className={`btn ${labStyles.playBtn}`} onClick={() => { unlockAudio(); item.play(); }}>▶ Play</button>
					</LabCard>
				))}</div>
			</LabSection>

			<LabSection title="Search theme (candidates)" sub="Nothing plays today while a ranked match is being found. These are subtle looping candidates to fill that gap, built to sit naturally against sound.sweep() and the battle theme (same A-minor key and voices). Starting one stops any other that's playing.">
				<div className={labStyles.grid}>{SEARCH_VARIANTS.map(v => {
					const active = searchId === v.id;
					return (
						<LabCard key={v.id} name={v.name} desc={v.desc}>
							<button type="button" className={`btn ${labStyles.playBtn} ${active ? labStyles.playActive : ""}`} onClick={() => { unlockAudio(); if (active) stopSearch(); else startSearch(v); }}>{active ? "■ Stop" : "▶ Play loop"}</button>
						</LabCard>
					);
				})}</div>
			</LabSection>

			<LabSection title="Battle theme lab" sub="Bass, melody and percussion, each with its own voice + rhythm and its own on/off switch: solo a layer, mute the drums, or play any combination together over a shared chord progression. Loops the current selection until you stop it; switching anything mid-loop takes effect on the next bar.">
				<div className={`${labStyles.card} ${styles.battleCard}`}>
					{axis("Progression", PROGRESSIONS, sel.progression, o => { sel.progression = o; })}
					{layer("Bass", sel.bass, <>{axis("Timbre", BASS_TIMBRES, sel.bass.timbre, o => { sel.bass.timbre = o; })}{axis("Rhythm", BASS_RHYTHMS, sel.bass.rhythm, o => { sel.bass.rhythm = o; })}</>)}
					{layer("Melody", sel.melody, <>{axis("Timbre", MELODY_TIMBRES, sel.melody.timbre, o => { sel.melody.timbre = o; })}{axis("Rhythm", MELODY_RHYTHMS, sel.melody.rhythm, o => { sel.melody.rhythm = o; })}</>)}
					{layer("Percussion", sel.perc, <>{axis("Kit", PERC_KITS, sel.perc.kit, o => { sel.perc.kit = o; })}{axis("Pattern", PERC_RHYTHMS, sel.perc.rhythm, o => { sel.perc.rhythm = o; })}</>)}
					<button type="button" className={`btn ${labStyles.playBtn} ${battlePlaying ? labStyles.playActive : ""}`} onClick={() => { unlockAudio(); if (battlePlaying) stopBattle(); else startBattle(); }}>{battlePlaying ? "■ Stop" : "▶ Play combination"}</button>
				</div>
			</LabSection>
		</AdminPage>
	);
}
