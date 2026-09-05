/**
 * ui.js — everything that touches the DOM.
 *
 * The markup mirrors the design canvas, so this file mostly fills in text,
 * toggles classes and spawns the little effect elements the design specifies.
 */

import {
  THEMES, THEME_KEYS, SIZES, COLLECTION_BG, CONFETTI_COLORS,
  MAX_TIER, themeOf, boxOf, sceneOf, isThemeUnlocked, THEME_UNLOCK,
} from './themes.js';
import { HISTORY_SIZE } from './storage.js';
import {
  SKY_PRESETS, CYCLE, positionForScore, positionForKey, skyAt, ease,
  forwardFrom, nearestFrom,
} from './sky.js';
import { WORLD_W, WORLD_H } from './physics.js';
import { setEmoji, twemojify, emojiUrl } from './emoji.js';

/**
 * Seconds for the sky to cover half the distance to its target. The automatic
 * drift is deliberately slow so the sky changes under the player rather than
 * at them; an explicit pick in the settings should answer more promptly.
 */
const SKY_HALF_LIFE_AUTO = 1.1;
const SKY_HALF_LIFE_MANUAL = 0.4;

const $ = (id) => document.getElementById(id);

const OVERLAYS = {
  title: 'titleScreen',
  pause: 'pauseScreen',
  discovery: 'discoveryScreen',
  over: 'overScreen',
  ad: 'adScreen',
  howto: 'howtoScreen',
  collection: 'collectionScreen',
  settings: 'settingsScreen',
  credits: 'creditsScreen',
};

export class UI {
  constructor(save) {
    this.save = save;
    this.el = {};
    for (const id of [
      'stage', 'stars', 'grass', 'fence', 'sun', 'box', 'boxInner', 'canvas', 'fx',
      'score', 'best', 'nextEmoji', 'nextBubble', 'evo', 'evoCore', 'combo',
      'held', 'heldEmoji', 'aim', 'dangerLine', 'loading', 'tutTap', 'tutMerge', 'tutMergeText',
      'shakeBtn', 'toast', 'toastIcon', 'toastText', 'pauseBtn',
      'titleBest', 'titleStreak', 'heroA', 'heroB', 'heroC', 'playBtn',
      'pauseScore', 'pauseMerges', 'resumeBtn', 'restartFromPause',
      'discEmoji', 'discName', 'discDesc',
      'overFace', 'overTitle', 'overScore', 'overBest', 'overBiggest', 'overRankChip', 'bestRuns',
      'rescueBtn', 'againBtn', 'shareBtn', 'confetti',
      'adKicker', 'adTime', 'adNote', 'adFill',
      'howtoPair', 'chainStrip', 'collGrid', 'collCount',
      'settingRows', 'dayChips', 'themeChips', 'askResetBtn', 'confirmReset', 'eraseBtn', 'keepBtn',
      'creditsBtn',
    ]) {
      this.el[id] = $(id);
    }
    for (const [name, id] of Object.entries(OVERLAYS)) this.el[name] = $(id);

    this._toastTimer = null;
    this._shakeFlip = false;
    this._openOverlay = null;
    this._returnTo = null;
    this._fxNodes = new Set();
    // Time of day as a continuous position: 0 morning, 1 sunset, 2 night.
    this._skyPosition = 0;
    this._skyTarget = 0;
    this._skyWritten = -1;
    this._skyHalfLife = SKY_HALF_LIFE_AUTO;

    this.buildDecor();
  }

  // -- one-time decoration -------------------------------------------------

  buildDecor() {
    const stars = document.createDocumentFragment();
    for (let i = 0; i < 40; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      s.style.left = `${(i * 37) % 100}%`;
      s.style.top = `${(i * 53) % 55}%`;
      const size = 2 + (i % 3);
      s.style.width = `${size}px`;
      s.style.height = `${size}px`;
      s.style.animationDuration = `${1.6 + (i % 5) * 0.4}s`;
      s.style.animationDelay = `${(i * 0.23) % 2}s`;
      stars.append(s);
    }
    this.el.stars.append(stars);

    const grass = document.createDocumentFragment();
    for (let i = 0; i < 60; i++) {
      const b = document.createElement('div');
      b.className = 'blade';
      b.style.height = `${10 + ((i * 7) % 16)}px`;
      b.style.transform = `rotate(${((i * 13) % 20) - 10}deg)`;
      grass.append(b);
    }
    this.el.grass.append(grass);

    const fence = document.createDocumentFragment();
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('div');
      p.className = 'picket';
      p.style.height = `${56 + (i % 3) * 6}px`;
      fence.append(p);
    }
    this.el.fence.append(fence);

    const confetti = document.createDocumentFragment();
    for (let i = 0; i < 26; i++) {
      const c = document.createElement('div');
      c.className = 'confetti-bit';
      c.style.left = `${i * 3.9 + 1}%`;
      c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      c.style.animationDuration = `${2.2 + (i % 4) * 0.5}s`;
      c.style.animationDelay = `${(i * 0.37) % 2}s`;
      confetti.append(c);
    }
    this.el.confetti.append(confetti);
  }

  /** Replace every emoji character in the static markup with Twemoji images. */
  twemojifyStatic() {
    twemojify(document.body);
  }

  // -- theming -------------------------------------------------------------

  applyTheme(themeKey) {
    const box = boxOf(themeKey);
    const root = document.documentElement.style;
    root.setProperty('--box-edge', box.edge);
    root.setProperty('--box-inner', box.inner);
    root.setProperty('--box-wall-l', box.wallL);
    root.setProperty('--box-wall-r', box.wallR);
    root.setProperty('--box-base', box.base);
    root.setProperty('--box-rim', box.rim);

    document.querySelector('.space-extras').hidden = !box.isSpace;
    document.querySelector('.food-tape').hidden = !box.isFood;

    // The backdrop follows the set: meadow, picnic, another world.
    const scene = sceneOf(themeKey);
    root.setProperty('--hill-1', scene.hill1);
    root.setProperty('--hill-2', scene.hill2);
    root.setProperty('--hill-3', scene.hill3);
    root.setProperty('--ground', scene.ground);
    root.setProperty('--ground-pattern', scene.groundPattern);
    root.setProperty('--grass', scene.grass);
    root.setProperty('--fence-fill', scene.fenceFill);
    root.setProperty('--fence-edge', scene.fenceEdge);
    root.setProperty('--fence-opacity', String(scene.fenceOpacity));
    root.setProperty('--sun-ring', scene.sunRing ? '1' : '0');

    const chain = themeOf(themeKey).e;
    setEmoji(this.el.heroA, chain[2]);
    setEmoji(this.el.heroB, chain[3]);
    setEmoji(this.el.heroC, chain[8]);

    this.buildEvolution(themeKey);
    this.buildChainStrip(themeKey);
    this.buildCollection(themeKey);
    this.el.howtoPair.replaceChildren();
    const pairImg = () => {
      const img = document.createElement('img');
      img.className = 'twe';
      img.src = emojiUrl(chain[0]);
      img.alt = chain[0];
      return img;
    };
    this.el.howtoPair.append(pairImg(), '+', pairImg());
  }

  /**
   * Aim the sky at a time of day. In "auto" the target follows the score, so
   * it drifts continuously rather than snapping at a threshold.
   * @param {string} dayKey 'auto' or a preset key
   * @param {number} score
   * @param {boolean} immediate skip the fade, for the first paint
   */
  setSkyTarget(dayKey, score, immediate = false) {
    const auto = dayKey === 'auto';
    const raw = auto ? positionForScore(score) : positionForKey(dayKey);
    // In auto the day only ever runs forwards, so a target behind the current
    // position means the next one round. A hand-picked time takes the short
    // way instead, so the change is as brief as the player expects.
    this._skyTarget = auto
      ? forwardFrom(this._skyPosition, raw)
      : nearestFrom(this._skyPosition, raw);
    this._skyHalfLife = auto ? SKY_HALF_LIFE_AUTO : SKY_HALF_LIFE_MANUAL;
    if (immediate) {
      this._skyPosition = this._skyTarget;
      this._writeSky(true);
    }
    return this._skyTarget;
  }

  /** Ease the sky toward its target. Called once per frame. */
  updateSky(dtMs) {
    if (this._skyPosition === this._skyTarget) return;
    this._skyPosition = ease(this._skyPosition, this._skyTarget, dtMs / 1000, this._skyHalfLife);
    this._writeSky();
    // Once settled, fold both back into the first cycle so a very long run
    // cannot drift the numbers away from useful precision.
    if (this._skyPosition === this._skyTarget) {
      const folded = ((this._skyPosition % CYCLE) + CYCLE) % CYCLE;
      this._skyPosition = folded;
      this._skyTarget = folded;
    }
  }

  _writeSky(force = false) {
    // Rewriting a gradient forces a repaint, so skip changes too small to see.
    if (!force && Math.abs(this._skyPosition - this._skyWritten) < 0.002) return;
    this._skyWritten = this._skyPosition;

    const sky = skyAt(this._skyPosition);
    const root = document.documentElement.style;
    root.setProperty('--sky-bg', sky.background);
    root.setProperty('--sun', sky.sun);
    root.setProperty('--halo', sky.halo);
    root.setProperty('--star-op', sky.stars.toFixed(3));
    root.setProperty('--cloud-op', sky.cloudOpacity.toFixed(3));
    root.setProperty('--ground-filter', sky.groundFilter);
  }

  buildEvolution(themeKey) {
    const chain = themeOf(themeKey).e;
    const discovered = this.save.get('discovered');
    const container = this.el.evo;
    container.querySelectorAll('.evo-item').forEach((n) => n.remove());

    const N = chain.length;
    const R = 50;
    const frag = document.createDocumentFragment();
    chain.forEach((emoji, i) => {
      const a = -Math.PI / 2 + (i / N) * Math.PI * 2;
      const item = document.createElement('div');
      item.className = 'evo-item';
      item.style.left = `${50 + R * Math.cos(a)}%`;
      item.style.top = `${50 + R * Math.sin(a)}%`;
      item.style.fontSize = `clamp(${12 + i * 0.6}px, ${1.6 + i * 0.12}vw, ${16 + i * 1.1}px)`;
      const unlocked = i <= discovered;
      item.style.opacity = unlocked ? '1' : '0.35';
      item.style.filter = unlocked ? 'none' : 'grayscale(1)';
      setEmoji(item, emoji);
      frag.append(item);
    });
    container.append(frag);
    setEmoji(this.el.evoCore, chain[Math.min(discovered, MAX_TIER)]);
  }

  buildChainStrip(themeKey) {
    const chain = themeOf(themeKey).e;
    const frag = document.createDocumentFragment();
    chain.forEach((emoji, i) => {
      const item = document.createElement('div');
      item.className = 'chain-item';
      item.style.fontSize = `${18 + i * 2}px`;
      setEmoji(item, emoji);
      frag.append(item);
    });
    this.el.chainStrip.replaceChildren(frag);
  }

  buildCollection(themeKey) {
    const theme = themeOf(themeKey);
    const discovered = this.save.get('discovered');
    const frag = document.createDocumentFragment();

    theme.e.forEach((emoji, i) => {
      const open = i <= discovered;
      const cell = document.createElement('div');
      cell.className = `coll-cell${open ? '' : ' locked'}`;
      if (open) cell.style.background = COLLECTION_BG[i];

      const face = document.createElement('div');
      face.className = 'coll-emoji';
      setEmoji(face, emoji);

      const name = document.createElement('div');
      name.className = 'coll-name';
      name.textContent = open ? theme.n[i] : '???';

      cell.append(face, name);
      frag.append(cell);
    });

    this.el.collGrid.replaceChildren(frag);
    this.el.collCount.textContent = String(Math.min(discovered + 1, theme.e.length));
    this.renderBestRuns();
  }

  /** The player's own best runs, in place of a leaderboard we cannot honestly show. */
  renderBestRuns(latestDate = null, latestScore = null) {
    const history = this.save.get('history') ?? [];
    const container = this.el.bestRuns;
    if (!container) return;

    if (history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'best-runs-empty';
      empty.textContent = 'Finish a round to start your list.';
      container.replaceChildren(empty);
      return;
    }

    const chain = themeOf(this.save.get('theme')).e;
    const frag = document.createDocumentFragment();
    history.forEach((run, i) => {
      const row = document.createElement('div');
      const isLatest = latestDate !== null && run.date === latestDate && run.score === latestScore;
      row.className = `best-run${isLatest ? ' is-latest' : ''}`;

      const rank = document.createElement('span');
      rank.className = 'best-run-rank';
      rank.textContent = `#${i + 1}`;

      const score = document.createElement('span');
      score.className = 'best-run-score';
      score.textContent = run.score.toLocaleString('en-US');

      const biggest = document.createElement('span');
      biggest.className = 'best-run-emoji';
      setEmoji(biggest, chain[Math.min(run.maxTier, MAX_TIER)]);

      const date = document.createElement('span');
      date.className = 'best-run-date';
      date.textContent = run.date;

      row.append(rank, score, biggest, date);
      frag.append(row);
    });
    container.replaceChildren(frag);
  }

  buildSettings(handlers) {
    const rows = [
      ['sound', this.save.get('sound') ? '🔊' : '🔇', 'Sounds'],
      ['music', '🎵', 'Music'],
      ['haptics', '📳', 'Vibration'],
      ['hints', '📏', 'Aim line'],
    ];

    const frag = document.createDocumentFragment();
    for (const [key, icon, label] of rows) {
      const row = document.createElement('div');
      row.className = 'setting-row';

      const left = document.createElement('div');
      left.className = 'setting-label';
      const ico = document.createElement('span');
      ico.className = 'setting-ico';
      setEmoji(ico, icon);
      left.append(ico, document.createTextNode(label));

      const track = document.createElement('div');
      track.className = `track${this.save.get(key) ? ' on' : ''}`;
      const knob = document.createElement('div');
      knob.className = 'knob';
      track.append(knob);

      row.append(left, track);
      row.addEventListener('click', () => {
        const next = !this.save.get(key);
        this.save.set(key, next);
        track.classList.toggle('on', next);
        if (key === 'sound') setEmoji(ico, next ? '🔊' : '🔇');
        handlers.onSetting?.(key, next);
      });
      frag.append(row);
    }
    this.el.settingRows.replaceChildren(frag);

    const dayOptions = [
      { key: 'auto', icon: '🔄', label: 'Auto' },
      ...SKY_PRESETS.map((p) => ({ key: p.key, icon: p.icon, label: p.label })),
    ];
    this.buildChips(this.el.dayChips, dayOptions, this.save.get('dayMode'),
      (k) => handlers.onDayMode?.(k));

    this._onTheme = handlers.onTheme ?? null;
    this.refreshThemeChips();
  }

  /**
   * Theme chips, with the ones not yet earned shown locked. Rebuilt whenever
   * `discovered` changes, so a set unlocked mid-round is selectable at once.
   */
  refreshThemeChips() {
    const discovered = this.save.get('discovered');
    const current = this.save.get('theme');
    const items = THEME_KEYS.map((k) => {
      const locked = !isThemeUnlocked(k, discovered);
      const goalTier = THEME_UNLOCK[k]?.discovered ?? 0;
      return {
        key: k,
        icon: THEMES[k].e[5],
        label: THEMES[k].label,
        locked,
        // The goal is named in the set the player is currently using.
        hint: locked ? `Reach ${themeOf(current).e[goalTier]} ${themeOf(current).n[goalTier]} to unlock` : '',
      };
    });
    this.buildChips(this.el.themeChips, items, current, (k, meta) => this._onTheme?.(k, meta));
  }

  /** The unlock requirement for a theme, as a toastable line. */
  unlockHint(themeKey) {
    const goalTier = THEME_UNLOCK[themeKey]?.discovered ?? 0;
    const inTheme = themeOf(this.save.get('theme'));
    return `Reach ${inTheme.e[goalTier]} ${inTheme.n[goalTier]} to unlock ${THEMES[themeKey].label}`;
  }

  buildChips(container, items, selected, onPick) {
    const frag = document.createDocumentFragment();
    for (const item of items) {
      const btn = document.createElement('button');
      btn.className = `choice${item.key === selected ? ' selected' : ''}${item.locked ? ' locked' : ''}`;
      btn.dataset.key = item.key;
      if (item.hint) btn.title = item.hint;
      btn.setAttribute('aria-disabled', item.locked ? 'true' : 'false');
      const ico = document.createElement('span');
      ico.className = 'choice-ico';
      setEmoji(ico, item.icon);
      btn.append(ico, document.createTextNode(item.label));
      if (item.locked) {
        const lock = document.createElement('span');
        lock.className = 'choice-lock';
        setEmoji(lock, '🔒');
        btn.append(lock);
      }
      btn.addEventListener('click', () => {
        if (item.locked) {
          onPick(item.key, { locked: true });
          return;
        }
        container.querySelectorAll('.choice').forEach((n) => n.classList.toggle('selected', n === btn));
        onPick(item.key, { locked: false });
      });
      frag.append(btn);
    }
    container.replaceChildren(frag);
  }

  // -- live values ---------------------------------------------------------

  setScore(score, best) {
    this.el.score.textContent = score.toLocaleString('en-US');
    this.el.score.classList.toggle('is-best', score >= best && score > 0);
  }

  setBest(best) {
    this.el.best.textContent = best.toLocaleString('en-US');
    this.el.titleBest.textContent = best.toLocaleString('en-US');
  }

  setStreak(streak) {
    this.el.titleStreak.textContent = String(streak);
  }

  setNext(emoji) {
    setEmoji(this.el.nextEmoji, emoji);
  }

  /**
   * Size and place the held piece so it matches the physics body exactly once
   * dropped: the renderer draws a piece at 2.16 x its radius.
   */
  setHeld(emoji, tier) {
    setEmoji(this.el.heldEmoji, emoji);
    const width = this.el.boxInner.clientWidth;
    const px = (SIZES[tier] / 100) * width * 1.08;
    document.documentElement.style.setProperty('--held-size', `${px}px`);
  }

  setAim(worldX) {
    document.documentElement.style.setProperty('--drop-x', `${(worldX / WORLD_W) * 100}%`);
  }

  setAimVisible(on) {
    document.documentElement.style.setProperty('--aim-op', on ? '1' : '0');
  }

  setDanger(on) {
    this.el.stage.classList.toggle('is-danger', on);
    const root = document.documentElement.style;
    root.setProperty('--danger-color', on ? '#ff4d4d' : 'rgba(255,77,77,.5)');
    root.setProperty('--danger-anim', on ? 'blink .7s ease-in-out infinite' : 'none');
  }

  setCombo(count) {
    if (count >= 2) {
      this.el.combo.textContent = `×${count} COMBO!`;
      this.el.combo.hidden = false;
      // Restart the pop animation on every increment.
      this.el.combo.style.animation = 'none';
      void this.el.combo.offsetWidth;
      this.el.combo.style.animation = '';
    } else {
      this.el.combo.hidden = true;
    }
  }

  setHeldVisible(on) {
    this.el.held.hidden = !on;
  }

  shakeBox() {
    this._shakeFlip = !this._shakeFlip;
    const box = this.el.box;
    box.classList.remove('shake-a', 'shake-b');
    void box.offsetWidth;
    box.classList.add(this._shakeFlip ? 'shake-a' : 'shake-b');
  }

  setRescueOffer(on) {
    this.el.shakeBtn.hidden = !on;
  }

  toast(icon, text) {
    clearTimeout(this._toastTimer);
    setEmoji(this.el.toastIcon, icon);
    this.el.toastText.textContent = text;
    this.el.toast.hidden = false;
    this.el.toast.style.animation = 'none';
    void this.el.toast.offsetWidth;
    this.el.toast.style.animation = '';
    this._toastTimer = setTimeout(() => {
      this.el.toast.hidden = true;
    }, 2600);
  }

  // -- effects -------------------------------------------------------------

  _place(node, x, y) {
    node.style.left = `${(x / WORLD_W) * 100}%`;
    node.style.top = `${(y / WORLD_H) * 100}%`;
  }

  _spawn(node, lifeMs) {
    this.el.fx.append(node);
    this._fxNodes.add(node);
    setTimeout(() => {
      node.remove();
      this._fxNodes.delete(node);
    }, lifeMs);
  }

  /** Puff of dust where a piece lands. */
  dust(x, y, tier) {
    const width = this.el.boxInner.clientWidth;
    const node = document.createElement('div');
    node.className = 'fx-dust';
    this._place(node, x, y);
    // The `dust` keyframes already translate by -50%, so no margin offset here.
    node.style.width = `${(SIZES[tier] / 100) * width * 1.6}px`;
    this._spawn(node, 480);
  }

  /** The full merge flourish: sparks, an expanding ring, points and a note. */
  mergeBurst(x, y, tier, points, { triple = false, jackpot = false } = {}) {
    const width = this.el.boxInner.clientWidth;
    const colors = ['#ffe36e', '#ff7a59', '#fff', '#8fd45f', '#6fc3f0'];

    // A trio throws more sparks; a jackpot throws the most.
    const sparkCount = jackpot ? 24 : triple ? 16 : 8;
    for (let i = 0; i < sparkCount; i++) {
      const spark = document.createElement('div');
      spark.className = 'fx-spark';
      spark.style.setProperty('--a', `${(i * 360) / sparkCount}deg`);
      spark.style.background = colors[i % colors.length];
      this._place(spark, x, y);
      this._spawn(spark, 640);
    }

    const size = (SIZES[tier] / 100) * width;
    const ring = document.createElement('div');
    ring.className = `fx-ring${jackpot ? ' fx-ring-jackpot' : triple ? ' fx-ring-triple' : ''}`;
    // Likewise, the `ring` keyframes centre it with translate(-50%, -50%).
    ring.style.width = `${size}px`;
    ring.style.height = `${size}px`;
    this._place(ring, x, y);
    this._spawn(ring, 540);

    if (triple || jackpot) {
      // A second, wider ring a beat later reads as "that was bigger".
      const echo = document.createElement('div');
      echo.className = `fx-ring fx-ring-echo${jackpot ? ' fx-ring-jackpot' : ''}`;
      echo.style.width = `${size * (jackpot ? 1.6 : 1.35)}px`;
      echo.style.height = `${size * (jackpot ? 1.6 : 1.35)}px`;
      this._place(echo, x, y);
      this._spawn(echo, jackpot ? 900 : 700);

      const label = document.createElement('div');
      label.className = jackpot ? 'fx-jackpot' : 'fx-triple';
      label.textContent = jackpot ? 'JACKPOT!' : 'TRIPLE!';
      this._place(label, x, y);
      this._spawn(label, jackpot ? 1440 : 1040);
    }

    const note = document.createElement('div');
    note.className = 'fx-note';
    note.textContent = '♪';
    this._place(note, x, y);
    this._spawn(note, 1040);

    const pts = document.createElement('div');
    pts.className = `fx-points${jackpot ? ' fx-points-jackpot' : triple ? ' fx-points-triple' : ''}`;
    pts.textContent = `+${points}`;
    this._place(pts, x, y);
    this._spawn(pts, 1040);
  }

  clearEffects() {
    for (const node of this._fxNodes) node.remove();
    this._fxNodes.clear();
  }

  // -- overlays ------------------------------------------------------------

  get openOverlay() {
    return this._openOverlay;
  }

  show(name, { returnTo = null } = {}) {
    this.hideAll();
    const el = this.el[name];
    if (!el) return;
    // The best-runs list changes at every game over; draw it fresh on open.
    if (name === 'collection') this.renderBestRuns();
    el.hidden = false;
    this._openOverlay = name;
    this._returnTo = returnTo;
    // Replay the entrance animation each time the overlay opens.
    const card = el.querySelector('.card, .discovery-inner, .title-art');
    if (card) {
      card.style.animation = 'none';
      void card.offsetWidth;
      card.style.animation = '';
    }
  }

  hideAll() {
    for (const name of Object.keys(OVERLAYS)) this.el[name].hidden = true;
    this._openOverlay = null;
  }

  close() {
    const back = this._returnTo;
    this.hideAll();
    if (back) this.show(back);
    return back;
  }

  showGameOver({ score, best, merges, maxTier, themeKey, isNewBest, rank = 0, canRescue = true }) {
    // One rescue per round, as in the design's `canRescue: !rescueUsed`.
    this.el.rescueBtn.hidden = !canRescue;
    const chain = themeOf(themeKey).e;
    this.el.overScore.textContent = score.toLocaleString('en-US');
    this.el.overBest.textContent = best.toLocaleString('en-US');
    setEmoji(this.el.overBiggest, chain[Math.max(0, maxTier)]);
    // Rank among the player's own runs. The design's "#N this week" implied a
    // leaderboard we have no server for; this says something true instead.
    this.el.overRankChip.textContent = rank > 0 ? `#${rank} best run` : `beyond top ${HISTORY_SIZE}`;
    this.el.overTitle.textContent = isNewBest ? 'NEW BEST!' : 'GAME OVER';
    setEmoji(this.el.overFace, isNewBest ? '🥳' : '😵');
    this.el.over.classList.toggle('is-best', isNewBest);
    this.el.confetti.hidden = !isNewBest;
    this.el.box.classList.toggle('is-small', isNewBest);
    this.el.pauseScore.textContent = score.toLocaleString('en-US');
    this.el.pauseMerges.textContent = String(merges);
    this.show('over');
  }

  showDiscovery(tier, themeKey) {
    const theme = themeOf(themeKey);
    setEmoji(this.el.discEmoji, theme.e[tier]);
    this.el.discName.textContent = theme.n[tier].toUpperCase();
    this.el.discDesc.textContent = theme.d[tier];
    this.show('discovery');
  }

  showPause(score, merges) {
    this.el.pauseScore.textContent = score.toLocaleString('en-US');
    this.el.pauseMerges.textContent = String(merges);
    this.show('pause');
  }

  /** Fallback ad screen, shown only when the portal SDK is not available. */
  showAdPlaceholder(kind, seconds, onDone) {
    this.el.adKicker.textContent = kind === 'rewarded' ? 'Rewarded ad' : 'Ad break';
    this.el.adNote.textContent = kind === 'rewarded'
      ? 'Reward: shake the box, lose the 3 smallest emoji.'
      : 'Between rounds, never more than once in 3 minutes.';
    this.el.adFill.style.width = '0%';
    this.show('ad');

    let left = seconds;
    this.el.adTime.textContent = `${left}s`;
    const tick = setInterval(() => {
      left -= 1;
      this.el.adTime.textContent = `${Math.max(0, left)}s`;
      this.el.adFill.style.width = `${((seconds - left) / seconds) * 100}%`;
      if (left <= 0) {
        clearInterval(tick);
        this.hideAll();
        onDone();
      }
    }, 1000);
    return () => clearInterval(tick);
  }

  setLoading(on) {
    this.el.loading.hidden = !on;
  }

  setTutorial(step) {
    this.el.tutTap.hidden = step !== 'tap';
    this.el.tutMerge.hidden = step !== 'merge';
  }

  setTutorialMergeText(chain, tier) {
    this.el.tutMergeText.replaceChildren();
    const img = (emoji) => {
      const node = document.createElement('img');
      node.className = 'twe';
      node.src = emojiUrl(emoji);
      node.alt = emoji;
      return node;
    };
    const next = Math.min(tier + 1, MAX_TIER);
    this.el.tutMergeText.append(img(chain[tier]), ' + ', img(chain[tier]), ' = ', img(chain[next]));
  }
}

export { WORLD_W, WORLD_H };
