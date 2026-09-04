/**
 * game.js — rules, scoring and the round lifecycle.
 *
 * This module owns no DOM. It drives the physics world and reports what
 * happened through callbacks, so the interface layer can stay a thin skin over
 * the design's markup.
 */

import { MergeWorld, WORLD_W, WORLD_H, DANGER_Y, radiusOf } from './physics.js';
import { PTS, MAX_TIER, DROPPABLE_TIERS, themeOf } from './themes.js';

/** Time a piece must sit above the danger line before the round ends. */
const OVERFLOW_GRACE = 1.5;
/**
 * The pile counts as dangerous once it reaches the top 30% of the box, well
 * before the line at 16%. That band is the player's warning, and the window in
 * which the rescue is worth offering.
 */
const DANGER_HEIGHT = WORLD_H * 0.3;
/** Merges closer together than this keep the combo running. */
const COMBO_WINDOW = 1.4;
/** Minimum gap between drops, so a fast tapper cannot stack pieces in mid-air. */
const DROP_COOLDOWN = 340;
/** No round can end in the first moments after it starts. */
const START_GRACE = 1.0;

export const PHASE = {
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  DISCOVERY: 'discovery',
  OVER: 'over',
  AD: 'ad',
};

export class Game {
  constructor(handlers = {}) {
    this.on = {
      merge: handlers.onMerge ?? (() => {}),
      drop: handlers.onDrop ?? (() => {}),
      impact: handlers.onImpact ?? (() => {}),
      score: handlers.onScore ?? (() => {}),
      combo: handlers.onCombo ?? (() => {}),
      discovery: handlers.onDiscovery ?? (() => {}),
      gameOver: handlers.onGameOver ?? (() => {}),
      danger: handlers.onDanger ?? (() => {}),
      phase: handlers.onPhase ?? (() => {}),
    };

    this.world = new MergeWorld({
      onMerge: (info) => this._handleMerge(info),
      onImpact: (info) => this.on.impact(info),
    });

    this.phase = PHASE.TITLE;
    this.themeKey = 'animals';
    this.discovered = 0;

    this.score = 0;
    this.merges = 0;
    this.combo = 0;
    this.maxTierThisRound = 0;

    this.dropX = WORLD_W / 2;
    this.currentTier = 0;
    this.nextTier = 0;

    this._comboTimer = 0;
    this._sinceDrop = DROP_COOLDOWN;
    this._roundTime = 0;
    this._inDanger = false;
    this._rescueUsed = false;
    this._pendingDiscovery = null;
    this._mergesSinceDrop = 0;
    this._sinceLastMerge = Infinity;
    this._hasDropped = false;
  }

  get chain() {
    return themeOf(this.themeKey).e;
  }

  get currentEmoji() {
    return this.chain[this.currentTier];
  }

  get nextEmoji() {
    return this.chain[this.nextTier];
  }

  get rescueAvailable() {
    return !this._rescueUsed;
  }

  setTheme(key) {
    this.themeKey = key;
  }

  setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.on.phase(phase);
  }

  /** Begin a fresh round. */
  start({ discovered = 0 } = {}) {
    this.world.reset();
    this.score = 0;
    this.merges = 0;
    this.combo = 0;
    this.maxTierThisRound = 0;
    this.discovered = discovered;
    this.dropX = WORLD_W / 2;
    this.currentTier = this._randomTier();
    this.nextTier = this._randomTier();
    this._comboTimer = 0;
    this._sinceDrop = DROP_COOLDOWN;
    this._roundTime = 0;
    this._inDanger = false;
    this._rescueUsed = false;
    this._pendingDiscovery = null;
    this._mergesSinceDrop = 0;
    this._sinceLastMerge = Infinity;
    this._hasDropped = false;
    this.setPhase(PHASE.PLAYING);
    this.on.score(this.score, 0);
  }

  _randomTier() {
    return Math.floor(Math.random() * DROPPABLE_TIERS);
  }

  /** Move the aim. `percent` is 0..1 across the box interior. */
  aim(percent) {
    const r = radiusOf(this.currentTier);
    const min = r + 2;
    const max = WORLD_W - r - 2;
    this.dropX = Math.min(max, Math.max(min, percent * WORLD_W));
    return this.dropX;
  }

  canDrop() {
    return this.phase === PHASE.PLAYING && this._sinceDrop >= DROP_COOLDOWN;
  }

  /** Release the held piece. Returns the body, or null if the drop was refused. */
  drop() {
    if (!this.canDrop()) return null;
    this._sinceDrop = 0;

    // A drop that produced nothing breaks the combo, as in the design. The
    // time guard covers a chain that is still resolving from the last drop.
    if (this._hasDropped && this._mergesSinceDrop === 0 && this._sinceLastMerge > COMBO_WINDOW * 1000) {
      if (this.combo > 0) {
        this.combo = 0;
        this.on.combo(0);
      }
    }
    this._mergesSinceDrop = 0;
    this._hasDropped = true;

    const tier = this.currentTier;
    const r = radiusOf(tier);
    const body = this.world.addPiece(tier, this.dropX, r + 14);

    this.currentTier = this.nextTier;
    this.nextTier = this._randomTier();

    this.on.drop({ tier, x: this.dropX, y: r + 14, body });
    return body;
  }

  _handleMerge({ tier, x, y }) {
    // The title screen runs the same physics for show. Merges there are
    // decorative and must not score or unlock anything.
    if (this.phase !== PHASE.PLAYING) return;

    this.combo = this._comboTimer > 0 ? this.combo + 1 : 1;
    this._comboTimer = COMBO_WINDOW;
    this._mergesSinceDrop += 1;
    this._sinceLastMerge = 0;

    const multiplier = Math.max(1, this.combo);
    const gain = PTS[tier] * multiplier;
    this.score += gain;
    this.merges += 1;
    if (tier > this.maxTierThisRound) this.maxTierThisRound = tier;

    this.on.merge({ tier, x, y, gain, combo: this.combo });
    this.on.score(this.score, gain);
    if (this.combo >= 2) this.on.combo(this.combo);

    if (tier > this.discovered) {
      this.discovered = tier;
      // Show the reveal once the piece has actually landed, not mid-collision.
      this._pendingDiscovery = tier;
    }
  }

  /**
   * Advance the round.
   * @param {number} dtMs elapsed milliseconds
   */
  update(dtMs) {
    const dt = dtMs / 1000;
    this._sinceDrop += dtMs;

    if (this.phase !== PHASE.PLAYING) {
      // Physics keeps running on the title screen so the box looks alive, but
      // no rules are evaluated.
      if (this.phase === PHASE.TITLE) this.world.step(dtMs);
      return;
    }

    this._roundTime += dt;
    this._sinceLastMerge += dtMs;
    this.world.step(dtMs);

    if (this._comboTimer > 0) {
      this._comboTimer -= dt;
      if (this._comboTimer <= 0) {
        this._comboTimer = 0;
        if (this.combo > 0) {
          this.combo = 0;
          this.on.combo(0);
        }
      }
    }

    const danger = this.world.topOfPile({ settledOnly: true }) < DANGER_HEIGHT;
    if (danger !== this._inDanger) {
      this._inDanger = danger;
      this.on.danger(danger);
    }

    if (this._pendingDiscovery !== null && this.world.isSettled()) {
      const tier = this._pendingDiscovery;
      this._pendingDiscovery = null;
      this.setPhase(PHASE.DISCOVERY);
      this.on.discovery(tier);
      return;
    }

    if (this._roundTime > START_GRACE && this.world.overflowTime() >= OVERFLOW_GRACE) {
      this.endRound();
    }
  }

  endRound() {
    if (this.phase === PHASE.OVER) return;
    this.setPhase(PHASE.OVER);
    this.on.gameOver({
      score: this.score,
      merges: this.merges,
      maxTier: Math.max(this.maxTierThisRound, this.world.highestTier()),
    });
  }

  /** Rewarded-ad rescue: drop the three smallest pieces and shake the box. */
  rescue() {
    this._rescueUsed = true;
    const removed = this.world.removeSmallest(3);
    this.world.shake(3.5);
    this._roundTime = 0; // fresh grace period so the round does not end at once
    if (this.phase === PHASE.OVER) this.setPhase(PHASE.PLAYING);
    return removed;
  }

  /** True when the pile is high enough that the rescue button is worth offering. */
  get shouldOfferRescue() {
    return this._inDanger && !this._rescueUsed && this.phase === PHASE.PLAYING;
  }

  get dangerRatio() {
    const top = this.world.topOfPile({ settledOnly: true });
    return Math.min(1, Math.max(0, 1 - top / WORLD_H));
  }

  pause() {
    if (this.phase === PHASE.PLAYING) this.setPhase(PHASE.PAUSED);
  }

  resume() {
    if (this.phase === PHASE.PAUSED || this.phase === PHASE.DISCOVERY) this.setPhase(PHASE.PLAYING);
  }

  /** Fill the box with a decorative pile for the title screen. */
  seedTitlePile() {
    this.world.reset();
    const layout = [
      [0, 0.22, 0.86], [1, 0.7, 0.87], [2, 0.5, 0.74], [1, 0.12, 0.7], [1, 0.9, 0.72],
      [0, 0.34, 0.63], [2, 0.66, 0.62], [0, 0.5, 0.57], [3, 0.22, 0.58], [0, 0.82, 0.59],
    ];
    for (const [tier, fx, fy] of layout) {
      this.world.addPiece(tier, fx * WORLD_W, fy * WORLD_H);
    }
  }
}

export { WORLD_W, WORLD_H, DANGER_Y, MAX_TIER };
