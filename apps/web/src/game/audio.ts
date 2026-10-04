/**
 * All sound is synthesised with the Web Audio API: no asset files, no licences.
 * Sound effects are one-shot oscillator/noise bursts; the music is a small
 * original chiptune loop played by a look-ahead step scheduler.
 */

export type SfxName =
  | "place"
  | "explosion"
  | "powerup"
  | "death"
  | "win"
  | "lose"
  | "draw"
  | "kick"
  | "land"
  | "lift"
  | "throw"
  | "shield"
  | "skull"
  | "mount"
  | "petLost"
  | "dash"
  | "jump"
  | "push"
  | "haunt"
  | "hurry"
  | "go"
  | "thud"
  | "bonk";
import { readPref, writePref } from "../config";

export type TrackName = "menu" | "battle" | "battle2" | "hurry";
export const CHANNELS = ["music", "sfx"] as const;
export type Channel = (typeof CHANNELS)[number];

const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ------------------------------------------------------------------ music data
// One bar = 16 sixteenth-note steps. `_` is a rest. Notes are MIDI numbers.
const _ = null;
type Bar = (number | null)[];

/** Lobby: C major, bouncy and friendly. C - Am - F - G. */
const MENU = {
  bpm: 104,
  gain: 0.15,
  roots: [48, 45, 41, 43],
  melody: [
    [76, _, 79, _, 84, _, 79, _, 76, _, 79, _, 76, _, 74, _],
    [72, _, 76, _, 81, _, 76, _, 72, _, 76, _, 69, _, 72, _],
    [77, _, 81, _, 84, _, 81, _, 77, _, 72, _, 77, _, 81, _],
    [74, _, 79, _, 83, _, 79, _, 74, _, 71, _, 74, _, 79, _],
  ] as Bar[],
};

/**
 * Battle: D minor, fast and dark. Dm - Dm - Bb - A | Dm - Gm - Bb - A.
 * Leans on tritones (Ab over D, E over Bb) and the C# leading tone for dread.
 */
const BATTLE = {
  bpm: 176,
  gain: 0.19,
  roots: [38, 38, 34, 33, 38, 43, 34, 33],
  melody: [
    [74, _, 77, _, 81, _, 80, _, 81, _, 77, _, 74, _, 73, _],
    [74, 74, _, 74, _, 77, _, 76, 74, _, 73, _, 74, _, _, _],
    [70, _, 74, _, 77, _, 76, _, 77, _, 74, _, 70, _, 69, _],
    [69, _, 73, _, 76, _, 77, _, 76, _, 73, _, 76, 77, 76, 73],
    [74, _, 77, _, 81, _, 80, _, 81, _, 84, _, 81, _, 80, _],
    [67, _, 70, _, 74, _, 73, _, 74, _, 70, _, 67, _, 66, _],
    [77, _, 74, _, 70, _, 74, _, 77, _, 81, _, 80, _, 77, _],
    [81, _, 80, _, 77, _, 76, _, 73, _, 76, _, 69, 73, 76, 80],
  ] as Bar[],
  /** bass note offsets (semitones above the bar root) on each eighth note */
  bassPattern: [0, 0, 0, 12, 0, 1, 0, 12],
  transpose: 0,
};

/** Second battle theme: E minor, syncopated riff over Em - C - D - B (the major B keeps it tense). */
const BATTLE2 = {
  bpm: 160,
  gain: 0.18,
  roots: [40, 36, 38, 35, 40, 36, 38, 35],
  melody: [
    [76, _, _, 76, 79, _, 76, _, 83, _, 81, _, 79, _, 76, _],
    [72, _, _, 72, 76, _, 72, _, 79, _, 77, _, 76, _, 72, _],
    [74, _, _, 74, 78, _, 74, _, 81, _, 79, _, 78, _, 74, _],
    [75, _, _, 75, 78, _, 75, _, 83, _, 81, _, 78, _, 75, 71],
    [83, _, 81, _, 79, _, 76, _, 79, _, 81, _, 83, _, _, _],
    [84, _, 83, _, 79, _, 76, _, 79, _, 76, _, 72, _, _, _],
    [81, _, 79, _, 78, _, 74, _, 78, _, 79, _, 81, _, _, _],
    [83, _, _, _, 78, _, 75, _, 71, _, 75, _, 78, _, 83, _],
  ] as Bar[],
  bassPattern: [0, 12, 0, 7, 0, 12, 10, 7],
  transpose: 0,
};

/** Sudden death: the first battle theme, faster and a minor third higher. */
const HURRY = { ...BATTLE, bpm: 204, gain: 0.2, transpose: 3 };

type BattleTrack = typeof BATTLE;
const BATTLE_TRACKS: Record<Exclude<TrackName, "menu">, BattleTrack> = { battle: BATTLE, battle2: BATTLE2, hurry: HURRY };


const TRACKS: Record<TrackName, { bpm: number; gain: number; melody: Bar[] }> = { menu: MENU, ...BATTLE_TRACKS };
const stepSeconds = (track: TrackName) => 60 / TRACKS[track].bpm / 4;

const LOOKAHEAD_S = 0.25;
const SCHEDULER_MS = 80;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** independent on/off switches so music and effects can be muted separately */
  private musicSwitch!: GainNode;
  private sfxSwitch!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private bassBus!: BiquadFilterNode;
  private boomBus!: GainNode;
  private noise!: AudioBuffer;
  private track: TrackName | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  /** per channel: muted, and a 0..1 volume applied on top */
  muted: Record<Channel, boolean> = { music: false, sfx: false };
  volume: Record<Channel, number> = { music: 1, sfx: 1 };

  constructor() {
    const legacy = readPref("muted") === "1"; // old single mute button
    for (const ch of CHANNELS) {
      this.muted[ch] = readPref(`${ch}Muted`) === "1" || legacy;
      this.volume[ch] = Number(readPref(`${ch}Volume`) ?? 1);
    }
  }

  private level = (ch: Channel) => (this.muted[ch] ? 0 : this.volume[ch]);

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.setup(ctx);
    return ctx;
  }

  /** Builds the mixer on `ctx` (a live or an offline context). */
  private setup(ctx: BaseAudioContext) {
    this.ctx = ctx as AudioContext;
    this.master = ctx.createGain();
    // transparent soft clipper at the very end: overlapping loud sounds saturate instead of clipping
    const safetyIn = ctx.createGain();
    safetyIn.gain.value = 0.5; // the shaper only sees -1..1, so the curve below covers signals up to +-2
    const safety = ctx.createWaveShaper();
    const safetyCurve = new Float32Array(4096);
    for (let i = 0; i < safetyCurve.length; i++) safetyCurve[i] = Math.tanh(((i / (safetyCurve.length - 1)) * 2 - 1) * 2);
    safety.curve = safetyCurve;
    this.master.connect(safetyIn).connect(safety).connect(ctx.destination);
    this.musicSwitch = ctx.createGain();
    this.musicSwitch.gain.value = this.level("music");
    this.musicSwitch.connect(this.master);
    this.sfxSwitch = ctx.createGain();
    this.sfxSwitch.gain.value = this.level("sfx");
    this.sfxSwitch.connect(this.master);
    // explosions go through a soft clipper: much louder and grittier, never above full scale
    this.boomBus = ctx.createGain();
    this.boomBus.gain.value = 0.5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1)) * 6 - 3) / Math.tanh(3);
    shaper.curve = curve;
    const boomOut = ctx.createGain();
    boomOut.gain.value = 1.3;
    this.boomBus.connect(shaper).connect(boomOut).connect(this.sfxSwitch);
    // synthetic "big open space" reverb: gives the blast a long rolling tail
    const reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.8);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    reverb.buffer = impulse;
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.38;
    boomOut.connect(reverbSend).connect(reverb).connect(this.sfxSwitch);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.55;
    this.sfxBus.connect(this.sfxSwitch);
    this.musicBus = ctx.createGain(); // level set per track by playMusic
    this.musicBus.connect(this.musicSwitch);
    // dark bass: a sawtooth with the top rolled off
    this.bassBus = ctx.createBiquadFilter();
    this.bassBus.type = "lowpass";
    this.bassBus.frequency.value = 650;
    this.bassBus.connect(this.musicBus);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  resume() {
    const ctx = this.ensure();
    if (ctx?.state === "suspended") void ctx.resume();
    if (this.track && !this.timer) this.startScheduler();
  }

  setMuted(ch: Channel, muted: boolean) {
    this.muted[ch] = muted;
    writePref(`${ch}Muted`, muted ? "1" : "0");
    this.applyLevel(ch);
  }

  setVolume(ch: Channel, volume: number) {
    this.volume[ch] = Math.max(0, Math.min(1, volume));
    writePref(`${ch}Volume`, String(this.volume[ch]));
    this.applyLevel(ch);
  }

  private applyLevel(ch: Channel) {
    if (!this.ctx) return;
    const node = ch === "music" ? this.musicSwitch : this.sfxSwitch;
    node.gain.setTargetAtTime(this.level(ch), this.ctx.currentTime, 0.02);
  }

  // ------------------------------------------------------------------ music
  /** Switch to `track` (no-op if already playing), or stop the music with null. */
  playMusic(track: TrackName | null) {
    if (track === null) return this.stopMusic();
    if (this.track === track && this.timer) return;
    this.stopMusic();
    this.track = track;
    this.step = 0;
    const ctx = this.ensure();
    if (ctx) {
      this.musicBus.gain.setTargetAtTime(TRACKS[track].gain, ctx.currentTime, 0.05);
      this.startScheduler();
    }
  }

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.track = null;
  }

  private startScheduler() {
    const ctx = this.ctx;
    if (!ctx || !this.track) return;
    this.nextTime = ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), SCHEDULER_MS);
    this.schedule();
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.track) return;
    const stepDur = stepSeconds(this.track);
    // if the tab slept, don't try to play the backlog
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(this.track, this.step, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step = (this.step + 1) % (TRACKS[this.track].melody.length * 16);
    }
  }

  private playStep(track: TrackName, step: number, t: number, dur: number) {
    if (track === "menu") this.menuStep(step, t, dur);
    else this.battleStep(BATTLE_TRACKS[track], step, t, dur);
  }

  private menuStep(step: number, t: number, dur: number) {
    const bar = Math.floor(step / 16);
    const i = step % 16;
    const root = MENU.roots[bar];

    // bouncy bass: root on the beat, fifth on the off-beat
    if (i % 4 === 0) this.tone("triangle", midiToHz(root), t, dur * 3, 0.9, this.musicBus);
    if (i % 8 === 6) this.tone("triangle", midiToHz(root + 7), t, dur * 2, 0.6, this.musicBus);

    const lead = MENU.melody[bar][i];
    if (lead !== null) {
      this.tone("triangle", midiToHz(lead), t, dur * 3, 0.75, this.musicBus);
      this.tone("sine", midiToHz(lead + 12), t, dur * 2, 0.18, this.musicBus); // little bell on top
    }

    if (i === 0 || i === 8) this.slide("sine", 120, 50, t, 0.12, 0.55, this.musicBus);
    if (i % 4 === 2) this.noiseHit(t, 0.025, 8000, 0.1, this.musicBus, "highpass");
  }

  private battleStep(track: BattleTrack, step: number, t: number, dur: number) {
    const bar = Math.floor(step / 16);
    const i = step % 16;
    const root = track.roots[bar] + track.transpose;
    const lastBar = bar === track.melody.length - 1;

    // relentless eighth-note bass
    if (i % 2 === 0) {
      const note = root + track.bassPattern[i / 2];
      this.tone("sawtooth", midiToHz(note), t, dur * 1.7, 0.85, this.bassBus);
    }

    // two slightly detuned square voices: thick and uneasy
    const lead = track.melody[bar][i];
    if (lead !== null) {
      const f = midiToHz(lead + track.transpose);
      this.tone("square", f, t, dur * 1.6, 0.34, this.musicBus);
      this.tone("square", f * 1.006, t, dur * 1.6, 0.26, this.musicBus);
    }

    // drums: kick on every beat, backbeat snare, driving hats
    if (i % 4 === 0) this.slide("sine", 165, 42, t, 0.17, 1, this.musicBus);
    if (i === 10 && bar % 4 === 3) this.slide("sine", 165, 42, t, 0.17, 0.9, this.musicBus);
    if (i === 4 || i === 12) this.noiseHit(t, 0.13, 1800, 0.55, this.musicBus, "highpass");
    if (i % 2 === 0) this.noiseHit(t, 0.03, 7500, i % 4 === 2 ? 0.2 : 0.12, this.musicBus, "highpass");
    // snare roll leading back into the loop
    if (lastBar && i >= 8 && i % 2 === 1) this.noiseHit(t, 0.06, 2600, 0.3 + (i - 8) * 0.03, this.musicBus, "highpass");
  }

  /** Briefly lowers the music so a big sound effect cuts through. */
  private duckMusic(t: number) {
    if (!this.track) return;
    const base = TRACKS[this.track].gain;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(base, t);
    g.linearRampToValueAtTime(base * 0.3, t + 0.02);
    g.linearRampToValueAtTime(base, t + 0.7);
  }

  /** Renders one sound effect offline (for level checks without speakers). */
  async renderSfx(name: SfxName, seconds = 3): Promise<AudioBuffer> {
    const rate = 44100;
    const offline = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
    const engine = new AudioEngine();
    engine.muted = { music: false, sfx: false }; // measure the sound itself, not the user's preferences
    engine.setup(offline);
    engine.playSfx(name);
    return offline.startRendering();
  }

  /** Renders a track offline (used by tests/tools to check the music without speakers). */
  async renderTrack(track: TrackName, bars = TRACKS[track].melody.length): Promise<AudioBuffer> {
    const stepDur = stepSeconds(track);
    const rate = 44100;
    const offline = new OfflineAudioContext(1, Math.ceil(bars * 16 * stepDur * rate) + rate, rate);
    const engine = new AudioEngine();
    engine.muted = { music: false, sfx: false }; // measure the sound itself, not the user's preferences
    engine.setup(offline);
    engine.musicBus.gain.value = TRACKS[track].gain;
    for (let s = 0; s < bars * 16; s++) engine.playStep(track, s, s * stepDur, stepDur);
    return offline.startRendering();
  }

  // ----------------------------------------------------------- sound effects
  sfx(name: SfxName, delaySeconds = 0) {
    const ctx = this.ensure();
    if (!ctx || this.muted.sfx) return;
    if (ctx.state === "suspended") void ctx.resume();
    this.playSfx(name, delaySeconds);
  }

  private playSfx(name: SfxName, delaySeconds = 0) {
    const t = this.ctx!.currentTime + delaySeconds;
    const bus = this.sfxBus;
    switch (name) {
      case "place":
        this.slide("square", 330, 120, t, 0.09, 0.5, bus);
        break;
      case "explosion":
        this.noiseHit(t, 0.06, 3800, 1.5, this.boomBus, "highpass"); // sharp crack
        this.noiseHit(t, 1.5, 2600, 1.9, this.boomBus, "lowpass", 45); // roaring body that dies away slowly
        this.slide("sine", 140, 22, t, 1.2, 1.9, this.boomBus); // deep boom
        this.slide("sine", 90, 30, t + 0.12, 0.6, 0.9, this.boomBus); // second rolling thump
        this.slide("sawtooth", 95, 24, t, 0.7, 0.5, this.boomBus); // gritty rumble
        for (let k = 0; k < 10; k++) {
          // falling debris crackling after the blast
          const at = t + 0.15 + k * 0.07 + Math.random() * 0.05;
          this.noiseHit(at, 0.04, 2500 + Math.random() * 2000, 0.55 * (1 - k / 10), this.boomBus, "highpass");
        }
        this.duckMusic(t);
        break;
      case "powerup":
        [660, 880, 1320].forEach((f, i) => this.tone("square", f, t + i * 0.06, 0.07, 0.4, bus));
        break;
      case "death":
        this.noiseHit(t, 0.4, 2200, 0.8, this.boomBus, "lowpass", 120); // pop of the bomber bursting
        this.slide("sine", 100, 30, t, 0.5, 0.9, this.boomBus);
        this.slide("sawtooth", 640, 45, t, 0.9, 0.45, bus); // sad falling whistle
        break;
      case "kick":
        this.slide("square", 220, 80, t, 0.09, 0.55, bus);
        this.noiseHit(t, 0.06, 1600, 0.5, bus, "lowpass");
        break;
      case "land":
        this.noiseHit(t, 0.14, 900, 0.9, bus, "lowpass", 200);
        this.slide("sine", 130, 45, t, 0.16, 0.9, bus);
        break;
      case "lift":
        this.slide("sine", 280, 720, t, 0.09, 0.4, bus);
        this.noiseHit(t, 0.05, 5000, 0.3, bus, "highpass");
        break;
      case "throw":
        this.noiseHit(t, 0.28, 500, 0.4, bus, "bandpass", 2400); // whoosh
        this.slide("sine", 260, 640, t, 0.22, 0.25, bus);
        break;
      case "shield":
        [1320, 1980].forEach((f, i) => this.tone("sine", f, t + i * 0.03, 0.35, 0.5, bus));
        this.noiseHit(t, 0.08, 6000, 0.45, bus, "highpass");
        break;
      case "skull":
        this.slide("sawtooth", 260, 90, t, 0.55, 0.4, bus);
        this.tone("square", 98, t + 0.05, 0.4, 0.35, bus);
        this.tone("square", 92.5, t + 0.3, 0.45, 0.35, bus);
        break;
      case "mount":
        [523, 659, 784, 1047].forEach((f, i) => this.tone("triangle", f, t + i * 0.05, 0.12, 0.6, bus));
        this.slide("sine", 900, 1500, t + 0.2, 0.1, 0.3, bus); // happy chirp
        break;
      case "petLost":
        this.slide("sine", 1100, 320, t, 0.35, 0.5, bus); // startled squeak as it runs off
        this.slide("square", 700, 200, t + 0.05, 0.25, 0.18, bus);
        this.noiseHit(t, 0.1, 3000, 0.3, bus, "highpass");
        break;
      case "dash":
        this.noiseHit(t, 0.35, 400, 0.5, bus, "bandpass", 3000);
        this.slide("sawtooth", 140, 420, t, 0.2, 0.25, bus);
        break;
      case "jump":
        this.slide("sine", 220, 760, t, 0.18, 0.6, bus); // boing
        this.slide("square", 330, 900, t, 0.12, 0.15, bus);
        break;
      case "push":
        this.noiseHit(t, 0.18, 700, 0.7, bus, "lowpass", 250); // scrape of brick on stone
        this.slide("sine", 95, 60, t, 0.15, 0.7, bus);
        break;
      case "bonk":
        // a bomb bouncing off a head: hollow knock, then a dizzy twinkle
        this.noiseHit(t, 0.05, 1200, 0.7, bus, "bandpass", 600);
        this.slide("square", 520, 180, t, 0.12, 0.45, bus);
        [1568, 1319, 1568, 1319].forEach((f, i) => this.tone("triangle", f, t + 0.12 + i * 0.07, 0.06, 0.25, bus));
        break;
      case "haunt":
        // ghostly wobble: two slightly detuned voices gliding down
        this.slide("triangle", 660, 330, t, 0.7, 0.35, bus);
        this.slide("triangle", 672, 318, t, 0.7, 0.3, bus);
        break;
      case "hurry":
        // alarm: three rising two-tone beeps
        for (let k = 0; k < 3; k++) {
          this.tone("square", 880, t + k * 0.32, 0.13, 0.45, bus);
          this.tone("square", 1175, t + k * 0.32 + 0.15, 0.13, 0.45, bus);
        }
        break;
      case "go":
        // the starting gun of "Ready… Go!": a short blip, then a bright held note an octave and a fifth up
        this.tone("square", 784, t, 0.08, 0.45, bus);
        this.tone("square", 1175, t + 0.09, 0.32, 0.45, bus);
        this.tone("triangle", 1568, t + 0.09, 0.32, 0.3, bus);
        break;
      case "thud":
        this.noiseHit(t, 0.12, 700, 0.8, this.boomBus, "lowpass", 150); // a stone block slamming down
        this.slide("sine", 110, 40, t, 0.14, 0.9, this.boomBus);
        break;
      case "win":
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone("square", f, t + i * 0.11, i === 5 ? 0.4 : 0.1, 0.4, bus));
        break;
      case "lose":
        [392, 330, 262].forEach((f, i) => this.tone("triangle", f, t + i * 0.16, 0.22, 0.7, bus));
        break;
      case "draw":
        [330, 330].forEach((f, i) => this.tone("triangle", f, t + i * 0.18, 0.2, 0.7, bus));
        break;
    }
  }

  // ------------------------------------------------------------- primitives
  private tone(type: OscillatorType, freq: number, t: number, dur: number, gain: number, out: AudioNode) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, 0.03));
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + Math.max(dur, 0.03) + 0.02);
  }

  private slide(type: OscillatorType, from: number, to: number, t: number, dur: number, gain: number, out: AudioNode) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseHit(
    t: number,
    dur: number,
    freq: number,
    gain: number,
    out: AudioNode,
    filter: BiquadFilterType = "lowpass",
    sweepTo?: number,
  ) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}

export const audio = new AudioEngine();

// browsers only allow sound after a user gesture; (re)start the shared engine on any input
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => audio.resume());
  window.addEventListener("keydown", () => audio.resume());
}
