/**
 * sdk.js — CrazyGames integration, with a safe fallback everywhere else.
 *
 * The CrazyGames SDK must be served from their own CDN, so it is the single
 * external resource the game loads. If it is absent (itch.io, a local file, an
 * offline test) every call degrades to a no-op and the game shows its own ad
 * placeholder instead, exactly as drawn in the design.
 *
 * Docs: https://docs.crazygames.com/sdk/html5-v3/
 */

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const SCRIPT_TIMEOUT = 6000;

/** Portals ask for no more than one midgame ad every three minutes. */
export const MIDGAME_COOLDOWN_MS = 3 * 60 * 1000;

const STORAGE_PREFIX = 'emojimerge.';

class LocalStore {
  getItem(key) {
    try {
      return window.localStorage.getItem(STORAGE_PREFIX + key);
    } catch {
      return this._memory?.get(key) ?? null;
    }
  }

  setItem(key, value) {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, value);
    } catch {
      if (!this._memory) this._memory = new Map();
      this._memory.set(key, value);
    }
  }

  removeItem(key) {
    try {
      window.localStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      this._memory?.delete(key);
    }
  }
}

export class Portal {
  constructor() {
    this.sdk = null;
    this.available = false;
    this.environment = 'none';
    this._local = new LocalStore();
    this._lastMidgame = 0;
    this._gameplayRunning = false;
  }

  /** Load and initialise the SDK. Always resolves; never throws. */
  async init() {
    try {
      await this._loadScript();
      const sdk = window.CrazyGames?.SDK;
      if (!sdk) throw new Error('SDK global missing');
      await sdk.init();
      this.sdk = sdk;
      this.available = true;
      this.environment = sdk.environment ?? 'crazygames';
      console.info(`CrazyGames SDK ready (environment: ${this.environment})`);
    } catch (error) {
      this.available = false;
      this.environment = 'none';
      console.info(`CrazyGames SDK not available (${error.message}); running standalone`);
    }
    return this.available;
  }

  _loadScript() {
    return new Promise((resolve, reject) => {
      if (window.CrazyGames?.SDK) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;

      const timer = setTimeout(() => {
        script.remove();
        reject(new Error('timed out'));
      }, SCRIPT_TIMEOUT);

      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error('failed to load'));
      };
      document.head.append(script);
    });
  }

  // -- lifecycle -----------------------------------------------------------

  loadingStart() {
    this._safe(() => this.sdk.game.loadingStart());
  }

  loadingStop() {
    this._safe(() => this.sdk.game.loadingStop());
  }

  /** Call when the player actually starts playing, not when the page opens. */
  gameplayStart() {
    if (this._gameplayRunning) return;
    this._gameplayRunning = true;
    this._safe(() => this.sdk.game.gameplayStart());
  }

  gameplayStop() {
    if (!this._gameplayRunning) return;
    this._gameplayRunning = false;
    this._safe(() => this.sdk.game.gameplayStop());
  }

  /** A moment of delight — used on a new best score. */
  happytime() {
    this._safe(() => this.sdk.game.happytime());
  }

  // -- ads -----------------------------------------------------------------

  /**
   * Only the offline placeholder needs this. CrazyGames paces midgame ads
   * itself — at most one every three minutes, with extra safeguards around
   * game start and rewarded ads — and quietly ignores a request that arrives
   * too soon, so the game must not gate requests on a timer of its own.
   */
  canShowMidgame() {
    return Date.now() - this._lastMidgame >= MIDGAME_COOLDOWN_MS;
  }

  /**
   * Request an ad.
   * @param {'midgame'|'rewarded'} type
   * @returns {Promise<'finished'|'error'|'unavailable'>}
   */
  requestAd(type) {
    if (!this.available) return Promise.resolve('unavailable');

    return new Promise((resolve) => {
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        if (type === 'midgame') this._lastMidgame = Date.now();
        resolve(result);
      };

      // A portal ad can silently never call back; do not strand the player.
      const guard = setTimeout(() => done('error'), 45000);

      try {
        this.sdk.ad.requestAd(type, {
          adStarted: () => {},
          adFinished: () => {
            clearTimeout(guard);
            done('finished');
          },
          adError: () => {
            clearTimeout(guard);
            done('error');
          },
        });
      } catch {
        clearTimeout(guard);
        done('error');
      }
    });
  }

  // -- storage -------------------------------------------------------------

  /**
   * CrazyGames' data module survives third-party-cookie restrictions inside
   * their iframe, so prefer it and fall back to localStorage.
   */
  getItem(key) {
    if (this.available && this.sdk.data) {
      try {
        const value = this.sdk.data.getItem(key);
        if (value !== null && value !== undefined) return value;
      } catch {
        // fall through
      }
    }
    return this._local.getItem(key);
  }

  setItem(key, value) {
    if (this.available && this.sdk.data) {
      try {
        this.sdk.data.setItem(key, value);
        return;
      } catch {
        // fall through
      }
    }
    this._local.setItem(key, value);
  }

  removeItem(key) {
    if (this.available && this.sdk.data) {
      try {
        this.sdk.data.removeItem(key);
      } catch {
        // fall through
      }
    }
    this._local.removeItem(key);
  }

  _safe(fn) {
    if (!this.available) return;
    try {
      fn();
    } catch (error) {
      console.warn('CrazyGames SDK call failed:', error.message);
    }
  }
}

export const portal = new Portal();
