/**
 * main.js — boots the game and wires everything together.
 */

import { Game, PHASE } from './game.js';
import { WORLD_W, WORLD_H, radiusOf } from './physics.js';
import { BoxRenderer } from './render.js';
import { UI } from './ui.js';
import { save } from './storage.js';
import { portal } from './sdk.js';
import { audio } from './audio.js';
import { preload } from './emoji.js';
import { THEMES, THEME_KEYS, MAX_TIER, themeOf } from './themes.js';
import { MONETISATION, shouldLoadPortalSdk, applyAdOverride } from './config.js';

const params = new URLSearchParams(location.search);
/** `?ads=demo` shows the design's ad placeholder when no portal SDK is present. */
const DEMO_ADS = params.get('ads') === 'demo';
applyAdOverride();
const DEBUG = params.has('debug');

const ui = new UI(save);
const canvas = document.getElementById('canvas');
const renderer = new BoxRenderer(canvas);

let tutorialStep = null;
let cancelAd = null;
let loopHandle = null;
/** The record to beat this round; `best` itself climbs live during play. */
let bestAtRoundStart = 0;

const game = new Game({
  onDrop: ({ tier, x, y }) => {
    audio.drop();
    ui.dust(x, Math.min(y + radiusOf(tier), WORLD_H - 4), tier);
    if (tutorialStep === 'tap') setTutorial('merge');
    refreshHeld();
  },

  onImpact: ({ speed, tier }) => audio.impact(speed, tier),

  onMerge: ({ tier, x, y, gain, combo, triple }) => {
    audio.merge(tier, combo);
    if (triple) audio.triple(tier);
    if (combo >= 2) audio.combo(combo);
    ui.mergeBurst(x, y, tier, gain, { triple });
    ui.shakeBox();
    if (save.get('haptics') && navigator.vibrate) {
      navigator.vibrate(triple ? [18, 40, 28] : combo >= 2 ? 24 : 12);
    }
    if (tutorialStep === 'merge') setTutorial(null);

    const patch = { merges: save.get('merges') + 1 };
    if (triple) {
      patch.triples = save.get('triples') + 1;
      // Name the move the first time it happens, so it reads as a skill the
      // player just pulled off rather than a lucky flash.
      if (!save.get('seenTriple')) {
        patch.seenTriple = true;
        ui.toast('✨', 'Triple! Two tiers at once.');
      }
    }
    save.update(patch);
  },

  onScore: (score) => {
    // The design shows the crown climbing during the run, not only at the end.
    if (score > save.get('best')) {
      save.set('best', score);
      ui.setBest(score);
    }
    ui.setScore(score, save.get('best'));
    ui.setSkyTarget(save.get('dayMode'), score);
  },

  onCombo: (count) => ui.setCombo(count),

  onDanger: (on) => {
    ui.setDanger(on);
    ui.setRescueOffer(game.shouldOfferRescue);
  },

  onDiscovery: (tier) => {
    save.set('discovered', Math.max(save.get('discovered'), tier));
    ui.buildEvolution(game.themeKey);
    ui.buildCollection(game.themeKey);
    audio.discovery();
    portal.gameplayStop();
    ui.showDiscovery(tier, game.themeKey);
  },

  onGameOver: ({ score, merges, maxTier }) => {
    // `best` climbs live during a run, so compare against where it started.
    const isNewBest = score > bestAtRoundStart;
    const best = Math.max(save.get('best'), score);
    if (isNewBest) {
      audio.newBest();
      portal.happytime();
    } else {
      audio.gameOver();
    }
    save.update({ games: save.get('games') + 1 });
    portal.gameplayStop();
    ui.setRescueOffer(false);
    ui.setHeldVisible(false);
    ui.showGameOver({
      score,
      best,
      merges,
      maxTier,
      themeKey: game.themeKey,
      isNewBest,
    });
  },
});

// ---------------------------------------------------------------- helpers

function refreshHeld() {
  ui.setHeld(game.currentEmoji, game.currentTier);
  ui.setNext(game.nextEmoji);
  ui.setAim(game.dropX);
}

function setTutorial(step) {
  tutorialStep = step;
  ui.setTutorial(step);
  if (step === 'merge') ui.setTutorialMergeText(game.chain, game.currentTier);
  if (step === null) save.set('seenTutorial', true);
}

function applySettings() {
  audio.setSfxEnabled(save.get('sound'));
  audio.setMusicEnabled(save.get('music'));
  ui.setAimVisible(save.get('hints'));
}

function resize() {
  renderer.resize();
  ui.setHeld(game.currentEmoji, game.currentTier);
}

// -------------------------------------------------------------- round flow

function startRound() {
  audio.unlock();
  bestAtRoundStart = save.get('best');
  ui.clearEffects();
  ui.hideAll();
  ui.setDanger(false);
  ui.setCombo(0);
  ui.setRescueOffer(false);
  ui.setHeldVisible(true);
  ui.el.box.classList.remove('is-small');
  game.setTheme(save.get('theme'));
  game.start({ discovered: save.get('discovered') });
  refreshHeld();
  ui.setScore(0, save.get('best'));
  ui.setSkyTarget(save.get('dayMode'), 0);
  setTutorial(save.get('seenTutorial') ? null : 'tap');
  portal.gameplayStart();
}

function goTitle() {
  portal.gameplayStop();
  game.setPhase(PHASE.TITLE);
  game.seedTitlePile();
  ui.clearEffects();
  ui.setDanger(false);
  ui.setCombo(0);
  ui.setRescueOffer(false);
  ui.setHeldVisible(false);
  ui.setTutorial(null);
  ui.el.box.classList.remove('is-small');
  ui.show('title');
}

/**
 * Show an ad, then run `after`. Falls back to running `after` straight away
 * when there is no portal to serve one.
 */
async function withAd(kind, after) {
  const previousPhase = game.phase;
  game.setPhase(PHASE.AD);
  audio.muteForAd();
  portal.gameplayStop();
  // "Ensure that a user cannot progress the game while requesting or showing
  // an ad." Clearing the overlays removes every button until the ad is done.
  ui.hideAll();

  const finish = (rewarded) => {
    audio.unmuteAfterAd();
    ui.hideAll();
    if (game.phase === PHASE.AD) game.setPhase(previousPhase);
    after(rewarded);
  };

  if (portal.available) {
    // No cooldown of our own: the SDK paces midgame ads itself and ignores a
    // request that comes too soon, so gating here would only lose fill.
    const result = await portal.requestAd(kind);
    if (result === 'unavailable') finish(kind === 'rewarded');
    else finish(kind !== 'rewarded' || result === 'finished');
    return;
  }

  if (DEMO_ADS) {
    cancelAd = ui.showAdPlaceholder(kind, 3, () => finish(true));
    return;
  }

  finish(true);
}

/** True when a real ad should be served rather than the reward simply given. */
function adsActive() {
  return (MONETISATION.adsEnabled && portal.available) || DEMO_ADS;
}

function playAgain() {
  const restart = () => startRound();
  // A rewarded "keep playing" offer and a midgame ad may not be combined on
  // the same screen, so the restart ad is skipped while the rescue is still
  // on the table. Once the rescue is spent, the restart is a clean break.
  const rescueOnOffer = game.phase === PHASE.OVER && game.rescueAvailable && MONETISATION.rewardedRescue;

  if (adsActive() && MONETISATION.midgameOnRestart && !rescueOnOffer) {
    withAd('midgame', restart);
  } else {
    restart();
  }
}

function grantRescue() {
  game.rescue();
  audio.rescue();
  ui.shakeBox();
  ui.setRescueOffer(false);
  ui.setHeldVisible(true);
  ui.el.box.classList.remove('is-small');
  ui.toast('📦', 'Saved! Three small ones gone.');
  portal.gameplayStart();
}

function doRescue() {
  // With ads switched off the rescue is simply given; the button, the reward
  // and the wiring are identical, so turning ads on changes nothing else.
  if (!adsActive() || !MONETISATION.rewardedRescue) {
    grantRescue();
    return;
  }

  withAd('rewarded', (rewarded) => {
    if (!rewarded) {
      ui.toast('📺', 'No ad available right now.');
      // The player asked for the rescue and it is not their fault an ad
      // failed, so give it anyway rather than punishing them.
      grantRescue();
      return;
    }
    grantRescue();
  });
}

// ------------------------------------------------------------------- input

function pointerToWorld(event) {
  const rect = ui.el.boxInner.getBoundingClientRect();
  return (event.clientX - rect.left) / rect.width;
}

function bindInput() {
  const inner = ui.el.boxInner;
  let pressing = false;

  inner.addEventListener('pointerdown', (event) => {
    if (game.phase !== PHASE.PLAYING) return;
    pressing = true;
    inner.setPointerCapture?.(event.pointerId);
    ui.setAim(game.aim(pointerToWorld(event)));
    refreshHeld();
  });

  inner.addEventListener('pointermove', (event) => {
    if (game.phase !== PHASE.PLAYING) return;
    // A mouse aims on hover; a finger only aims while it is down.
    if (event.pointerType !== 'mouse' && !pressing) return;
    ui.setAim(game.aim(pointerToWorld(event)));
  });

  const release = (event) => {
    if (!pressing) return;
    pressing = false;
    inner.releasePointerCapture?.(event.pointerId);
    if (game.phase !== PHASE.PLAYING) return;
    game.aim(pointerToWorld(event));
    game.drop();
  };

  inner.addEventListener('pointerup', release);
  inner.addEventListener('pointercancel', () => {
    pressing = false;
  });

  window.addEventListener('keydown', (event) => {
    if (game.phase === PHASE.PLAYING) {
      const step = event.shiftKey ? 0.02 : 0.05;
      if (event.key === 'ArrowLeft') {
        ui.setAim(game.aim(game.dropX / WORLD_W - step));
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowRight') {
        ui.setAim(game.aim(game.dropX / WORLD_W + step));
        event.preventDefault();
        return;
      }
      if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowDown') {
        game.drop();
        event.preventDefault();
        return;
      }
    }
    if (event.key === 'Escape' || event.key === 'p' || event.key === 'P') {
      if (game.phase === PHASE.PLAYING) pauseGame();
      else if (game.phase === PHASE.PAUSED) resumeGame();
    }
  });
}

function pauseGame() {
  if (game.phase !== PHASE.PLAYING) return;
  game.pause();
  portal.gameplayStop();
  ui.showPause(game.score, game.merges);
}

function resumeGame() {
  ui.hideAll();
  game.resume();
  portal.gameplayStart();
}

function bindUI() {
  ui.el.playBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    startRound();
  });
  ui.el.title.addEventListener('click', () => startRound());

  ui.el.pauseBtn.addEventListener('click', () => {
    audio.click();
    pauseGame();
  });
  ui.el.resumeBtn.addEventListener('click', () => {
    audio.click();
    resumeGame();
  });
  ui.el.restartFromPause.addEventListener('click', () => {
    audio.click();
    playAgain();
  });
  ui.el.againBtn.addEventListener('click', () => {
    audio.click();
    playAgain();
  });
  ui.el.rescueBtn.addEventListener('click', () => {
    audio.click();
    doRescue();
  });
  ui.el.shakeBtn.addEventListener('click', () => {
    audio.click();
    doRescue();
  });

  ui.el.discovery.addEventListener('click', () => {
    ui.hideAll();
    game.resume();
    portal.gameplayStart();
  });

  ui.el.creditsBtn.addEventListener('click', () => {
    audio.click();
    ui.show('credits', { returnTo: ui.openOverlay });
  });

  // Buttons that open a panel remember where to go back to.
  document.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      audio.click();
      const from = ui.openOverlay;
      ui.show(btn.dataset.open, { returnTo: from });
    });
  });

  document.querySelectorAll('[data-action="close"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.click();
      const back = ui.close();
      if (!back && game.phase === PHASE.PLAYING) portal.gameplayStart();
    });
  });

  document.querySelectorAll('[data-action="title"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.click();
      goTitle();
    });
  });

  ui.el.askResetBtn.addEventListener('click', () => {
    ui.el.askResetBtn.hidden = true;
    ui.el.confirmReset.hidden = false;
  });
  ui.el.keepBtn.addEventListener('click', () => {
    ui.el.askResetBtn.hidden = false;
    ui.el.confirmReset.hidden = true;
  });
  ui.el.eraseBtn.addEventListener('click', () => {
    save.resetProgress();
    ui.el.askResetBtn.hidden = false;
    ui.el.confirmReset.hidden = true;
    ui.setBest(0);
    ui.setStreak(save.get('streak'));
    ui.buildEvolution(game.themeKey);
    ui.buildCollection(game.themeKey);
    ui.toast('🧹', 'Progress erased.');
  });

  ui.el.shareBtn.addEventListener('click', async () => {
    audio.click();
    const chain = themeOf(game.themeKey);
    const tier = Math.max(0, Math.min(MAX_TIER, game.maxTierThisRound));
    const text = `I scored ${game.score.toLocaleString('en-US')} in Emoji Merge and reached ${chain.e[tier]} ${chain.n[tier]}!`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      ui.toast('🔗', 'Score copied to clipboard.');
    } catch {
      ui.toast('🔗', text.slice(0, 40));
    }
  });

  ui.buildSettings({
    onSetting: (key) => {
      applySettings();
      if (key === 'sound' || key === 'music') audio.unlock();
      audio.click();
    },
    onDayMode: (key) => {
      save.set('dayMode', key);
      ui.setSkyTarget(key, game.score);
      audio.click();
    },
    onTheme: (key) => {
      save.set('theme', key);
      game.setTheme(key);
      ui.applyTheme(key);
      refreshHeld();
      audio.click();
    },
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.phase === PHASE.PLAYING) pauseGame();
  });
}

// -------------------------------------------------------------------- loop

function startLoop() {
  let last = performance.now();
  let rafTicked = false;

  const tick = (now) => {
    const dt = Math.min(now - last, 100);
    last = now;
    game.update(dt);
    ui.updateSky(dt);
    renderer.draw(game.world.pieces, game.chain);
    if (game.phase === PHASE.PLAYING) ui.setRescueOffer(game.shouldOfferRescue);
  };

  const rafLoop = (now) => {
    rafTicked = true;
    tick(now);
    loopHandle = requestAnimationFrame(rafLoop);
  };
  loopHandle = requestAnimationFrame(rafLoop);

  // Some embedded webviews never fire requestAnimationFrame. Fall back to a
  // timer so the game still runs there.
  setTimeout(() => {
    if (rafTicked) return;
    console.warn('requestAnimationFrame is not firing; using a timer instead');
    cancelAnimationFrame(loopHandle);
    last = performance.now();
    setInterval(() => tick(performance.now()), 1000 / 60);
  }, 500);
}

// -------------------------------------------------------------------- boot

async function boot() {
  ui.setLoading(true);
  if (shouldLoadPortalSdk()) portal.init();
  portal.loadingStart();

  save.load();
  const themeKey = THEME_KEYS.includes(save.get('theme')) ? save.get('theme') : 'animals';
  game.setTheme(themeKey);

  // Everything the interface and the box can show, fetched before first paint.
  const chainEmoji = THEME_KEYS.flatMap((k) => THEMES[k].e);
  const uiEmoji = ['👑', '🔥', '👇', '🎉', '📦', '😴', '🥳', '😵', '🔊', '🔇',
    '🎵', '📳', '📏', '🔄', '☀️', '🌇', '🌙', '🧹', '📺', '🔗'];
  await preload([...chainEmoji, ...uiEmoji]);

  ui.twemojifyStatic();
  ui.applyTheme(themeKey);
  ui.setSkyTarget(save.get('dayMode'), 0, true);
  ui.setBest(save.get('best'));
  ui.setStreak(save.get('streak'));
  ui.setScore(0, save.get('best'));
  applySettings();

  renderer.resize();
  bindInput();
  bindUI();

  ui.setLoading(false);
  portal.loadingStop();

  // The intro animation starts the box off screen. If a webview never runs CSS
  // animations the box would stay there, so drop the class on a timer rather
  // than waiting for an animationend that may never fire.
  ui.el.box.classList.add('intro');
  setTimeout(() => ui.el.box.classList.remove('intro'), 1700);

  goTitle();
  refreshHeld();
  ui.setHeldVisible(false);
  startLoop();

  // The first gesture anywhere unlocks audio, as browsers require.
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  if (DEBUG) {
    window.EmojiMerge = { game, ui, save, portal, audio, renderer, startRound, goTitle };
    console.info('debug API available as window.EmojiMerge');
  }
}

boot().catch((error) => {
  console.error('Emoji Merge failed to start:', error);
  ui.setLoading(false);
  ui.toast('⚠️', 'Something went wrong. Please reload.');
});
