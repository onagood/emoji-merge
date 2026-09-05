/**
 * audio.js — all sound is synthesised with the Web Audio API at runtime.
 *
 * Nothing is sampled or downloaded, so there is no audio asset to license and
 * nothing to load. Every cue is built from oscillators and shaped noise.
 */

const MASTER_SFX = 0.32;
const MASTER_MUSIC = 0.1;

/** A pentatonic scale keeps random merge pitches consonant. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class Audio {
  constructor() {
    this.ctx = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.masterGain = null;
    this.noiseBuffer = null;

    this.sfxEnabled = true;
    this.musicEnabled = true;
    this.suspendedByAd = false;

    this._musicTimer = null;
    this._musicStep = 0;
    this._lastImpact = 0;
  }

  /** Must be called from a user gesture the first time. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;
    this.masterGain.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxEnabled ? MASTER_SFX : 0;
    this.sfxGain.connect(this.masterGain);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.masterGain);

    // Two seconds of white noise, reused for every percussive cue.
    const frames = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    if (this.musicEnabled) this.startMusic();
  }

  setSfxEnabled(on) {
    this.sfxEnabled = on;
    if (this.sfxGain) this.sfxGain.gain.value = on && !this.suspendedByAd ? MASTER_SFX : 0;
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (!this.ctx) return;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  /** Silence everything while an ad plays, as the portals require. */
  muteForAd() {
    this.suspendedByAd = true;
    if (this.masterGain) this._ramp(this.masterGain.gain, 0, 0.08);
  }

  unmuteAfterAd() {
    this.suspendedByAd = false;
    if (this.masterGain) this._ramp(this.masterGain.gain, 1, 0.2);
  }

  _ramp(param, value, seconds) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + seconds);
  }

  _ready() {
    return this.ctx && this.sfxEnabled && !this.suspendedByAd;
  }

  _tone({ freq, type = 'sine', duration = 0.18, gain = 1, sweepTo = null, delay = 0, destination = null }) {
    const ctx = this.ctx;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), start + duration);

    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0008, start + duration);

    osc.connect(env);
    env.connect(destination ?? this.sfxGain);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  _noise({ duration = 0.12, gain = 0.6, filterFreq = 900, type = 'lowpass', delay = 0 }) {
    const ctx = this.ctx;
    const start = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFreq, start);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0008, start + duration);

    source.connect(filter);
    filter.connect(env);
    env.connect(this.sfxGain);
    source.start(start);
    source.stop(start + duration + 0.05);
  }

  // -- cues ----------------------------------------------------------------

  drop() {
    if (!this._ready()) return;
    this._noise({ duration: 0.09, gain: 0.35, filterFreq: 500 });
    this._tone({ freq: 220, type: 'triangle', duration: 0.1, gain: 0.18, sweepTo: 130 });
  }

  /** A landing or a knock. `speed` comes straight from the solver. */
  impact(speed, tier) {
    if (!this._ready()) return;
    const now = this.ctx.currentTime;
    // Busy piles produce dozens of contacts a second; thin them out.
    if (now - this._lastImpact < 0.045) return;
    this._lastImpact = now;

    const strength = Math.min(1, speed / 12);
    if (strength < 0.12) return;
    const size = 1 - tier / 12;
    this._noise({ duration: 0.05 + strength * 0.05, gain: 0.1 + strength * 0.3, filterFreq: 300 + size * 1400 });
    this._tone({
      freq: 90 + size * 150,
      type: 'sine',
      duration: 0.08,
      gain: 0.06 + strength * 0.12,
      sweepTo: 60 + size * 90,
    });
  }

  /** Rising pitch with tier, so bigger merges feel like progress. */
  merge(tier, combo = 1) {
    if (!this._ready()) return;
    const root = 261.63; // middle C
    const step = SCALE[Math.min(tier, SCALE.length - 1)] + Math.min(combo - 1, 5) * 2;
    const freq = root * Math.pow(2, step / 12);

    this._tone({ freq, type: 'triangle', duration: 0.22, gain: 0.5 });
    this._tone({ freq: freq * 1.5, type: 'sine', duration: 0.3, gain: 0.22, delay: 0.045 });
    this._tone({ freq: freq * 2, type: 'sine', duration: 0.34, gain: 0.12, delay: 0.09 });
    this._noise({ duration: 0.16, gain: 0.14, filterFreq: 2600, type: 'highpass' });
  }

  /**
   * Three at once. A bright rising arpeggio over the merge tone, so the moment
   * is unmistakable without being louder than everything else.
   */
  triple(tier) {
    if (!this._ready()) return;
    const root = 523.25 * Math.pow(2, Math.min(tier, 8) / 24);
    [0, 4, 7, 12].forEach((semitone, i) => {
      this._tone({
        freq: root * Math.pow(2, semitone / 12),
        type: 'triangle',
        duration: 0.34,
        gain: 0.26 - i * 0.03,
        delay: i * 0.055,
      });
    });
    this._tone({ freq: root * 3, type: 'sine', duration: 0.5, gain: 0.1, delay: 0.2 });
    this._noise({ duration: 0.3, gain: 0.16, filterFreq: 3400, type: 'highpass' });
  }

  /**
   * Two of the top tier leaving the box. The one moment in the game that
   * deserves a proper fanfare: a rising major chord, a shimmer on top, and a
   * low thump underneath so it is felt as well as heard.
   */
  jackpot() {
    if (!this._ready()) return;
    const root = 261.63;
    [0, 4, 7, 12, 16, 19, 24].forEach((semitone, i) => {
      this._tone({
        freq: root * Math.pow(2, semitone / 12),
        type: 'triangle',
        duration: 0.7,
        gain: 0.28 - i * 0.02,
        delay: i * 0.07,
      });
    });
    for (let i = 0; i < 6; i++) {
      this._tone({
        freq: root * 4 * Math.pow(2, (i * 7) / 12),
        type: 'sine',
        duration: 0.4,
        gain: 0.08,
        delay: 0.5 + i * 0.06,
      });
    }
    this._tone({ freq: root / 2, type: 'sine', duration: 1.1, gain: 0.4, sweepTo: root / 4 });
    this._noise({ duration: 0.8, gain: 0.2, filterFreq: 5000, type: 'highpass', delay: 0.1 });
  }

  /** Extra flourish layered on top of a merge when a combo is running. */
  combo(count) {
    if (!this._ready()) return;
    const base = 523.25;
    for (let i = 0; i < Math.min(count, 5); i++) {
      this._tone({
        freq: base * Math.pow(2, SCALE[Math.min(i + 2, SCALE.length - 1)] / 12),
        type: 'square',
        duration: 0.12,
        gain: 0.08,
        delay: i * 0.055,
      });
    }
  }

  discovery() {
    if (!this._ready()) return;
    const notes = [0, 4, 7, 12, 16];
    notes.forEach((semitone, i) => {
      this._tone({
        freq: 392 * Math.pow(2, semitone / 12),
        type: 'triangle',
        duration: 0.45,
        gain: 0.3 - i * 0.03,
        delay: i * 0.085,
      });
    });
  }

  gameOver() {
    if (!this._ready()) return;
    [0, -2, -5, -9].forEach((semitone, i) => {
      this._tone({
        freq: 330 * Math.pow(2, semitone / 12),
        type: 'triangle',
        duration: 0.5,
        gain: 0.3,
        delay: i * 0.14,
      });
    });
    this._noise({ duration: 0.7, gain: 0.12, filterFreq: 400, delay: 0.1 });
  }

  newBest() {
    if (!this._ready()) return;
    [0, 4, 7, 12, 19, 24].forEach((semitone, i) => {
      this._tone({
        freq: 523.25 * Math.pow(2, semitone / 12),
        type: 'square',
        duration: 0.3,
        gain: 0.16,
        delay: i * 0.07,
      });
    });
  }

  click() {
    if (!this._ready()) return;
    this._tone({ freq: 880, type: 'square', duration: 0.05, gain: 0.09 });
  }

  rescue() {
    if (!this._ready()) return;
    this._noise({ duration: 0.4, gain: 0.3, filterFreq: 1200 });
    this._tone({ freq: 160, type: 'sawtooth', duration: 0.35, gain: 0.14, sweepTo: 90 });
  }

  // -- music ---------------------------------------------------------------

  /** A slow, quiet arpeggio. Deliberately unobtrusive. */
  startMusic() {
    if (!this.ctx || this._musicTimer) return;
    this._ramp(this.musicGain.gain, MASTER_MUSIC, 1.5);

    const chords = [
      [0, 4, 7, 11],
      [-3, 2, 5, 9],
      [-5, 0, 4, 7],
      [-1, 4, 7, 11],
    ];

    this._musicTimer = setInterval(() => {
      if (!this.ctx || this.suspendedByAd || !this.musicEnabled) return;
      const chord = chords[Math.floor(this._musicStep / 4) % chords.length];
      const semitone = chord[this._musicStep % 4];
      const freq = 261.63 * Math.pow(2, (semitone + 12) / 12);
      this._tone({
        freq,
        type: 'sine',
        duration: 1.4,
        gain: 0.5,
        destination: this.musicGain,
      });
      if (this._musicStep % 8 === 0) {
        this._tone({
          freq: freq / 4,
          type: 'sine',
          duration: 2.4,
          gain: 0.7,
          destination: this.musicGain,
        });
      }
      this._musicStep++;
    }, 620);
  }

  stopMusic() {
    if (this.musicGain) this._ramp(this.musicGain.gain, 0, 0.6);
    clearInterval(this._musicTimer);
    this._musicTimer = null;
  }
}

export const audio = new Audio();
