/**
 * storage.js — persistent progress and settings.
 *
 * Everything is funnelled through the portal adapter so the same code works
 * inside the CrazyGames iframe and on a plain static host. Reads are defensive:
 * a corrupted or hand-edited value must never break a player's save.
 */

import { portal } from './sdk.js';
import { THEME_KEYS, MAX_TIER } from './themes.js';

const KEY = 'save.v1';

const DEFAULTS = {
  best: 0,
  games: 0,
  merges: 0,
  triples: 0,
  discovered: 0,
  streak: 1,
  lastPlayed: null,
  theme: 'animals',
  dayMode: 'auto',
  sound: true,
  music: true,
  haptics: false,
  hints: true,
  seenTutorial: false,
  seenTriple: false,
};

function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/** Local calendar day, so a streak rolls over at the player's midnight. */
function today() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(a, b) {
  const parse = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((parse(b) - parse(a)) / 86400000);
}

export class Save {
  constructor() {
    this.data = { ...DEFAULTS };
    this._writeTimer = null;
  }

  load() {
    let raw = null;
    try {
      raw = portal.getItem(KEY);
    } catch {
      raw = null;
    }

    if (raw) {
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.warn('save: stored data was unreadable, starting fresh');
      }
      if (parsed && typeof parsed === 'object') this._merge(parsed);
    }

    this._updateStreak();
    return this.data;
  }

  _merge(parsed) {
    const d = this.data;
    d.best = clampInt(parsed.best, 0, 1e12, 0);
    d.games = clampInt(parsed.games, 0, 1e9, 0);
    d.merges = clampInt(parsed.merges, 0, 1e9, 0);
    d.triples = clampInt(parsed.triples, 0, 1e9, 0);
    d.discovered = clampInt(parsed.discovered, 0, MAX_TIER, 0);
    d.streak = clampInt(parsed.streak, 1, 1e6, 1);
    d.lastPlayed = typeof parsed.lastPlayed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.lastPlayed)
      ? parsed.lastPlayed
      : null;
    d.theme = THEME_KEYS.includes(parsed.theme) ? parsed.theme : DEFAULTS.theme;
    d.dayMode = ['auto', 'morning', 'sunset', 'night'].includes(parsed.dayMode) ? parsed.dayMode : DEFAULTS.dayMode;
    d.sound = bool(parsed.sound, DEFAULTS.sound);
    d.music = bool(parsed.music, DEFAULTS.music);
    d.haptics = bool(parsed.haptics, DEFAULTS.haptics);
    d.hints = bool(parsed.hints, DEFAULTS.hints);
    d.seenTutorial = bool(parsed.seenTutorial, DEFAULTS.seenTutorial);
    d.seenTriple = bool(parsed.seenTriple, DEFAULTS.seenTriple);
  }

  _updateStreak() {
    const day = today();
    const last = this.data.lastPlayed;
    if (!last) {
      this.data.streak = 1;
    } else {
      const gap = daysBetween(last, day);
      if (gap === 1) this.data.streak += 1;
      else if (gap > 1 || gap < 0) this.data.streak = 1;
    }
    this.data.lastPlayed = day;
    this.save();
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  update(patch) {
    Object.assign(this.data, patch);
    this.save();
  }

  /** Writes are debounced; a merge-heavy run would otherwise write constantly. */
  save() {
    clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    clearTimeout(this._writeTimer);
    this._writeTimer = null;
    try {
      portal.setItem(KEY, JSON.stringify(this.data));
    } catch (error) {
      console.warn('save: could not persist progress', error.message);
    }
  }

  resetProgress() {
    const keep = {
      theme: this.data.theme,
      dayMode: this.data.dayMode,
      sound: this.data.sound,
      music: this.data.music,
      haptics: this.data.haptics,
      hints: this.data.hints,
      lastPlayed: this.data.lastPlayed,
    };
    this.data = { ...DEFAULTS, ...keep, streak: 1, seenTutorial: false, seenTriple: false };
    this.flush();
  }
}

export const save = new Save();
