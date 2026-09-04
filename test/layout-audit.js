/**
 * layout-audit.js — pasted into the page console (or run through the debug
 * API) to check the game fits a given viewport. Reports the box geometry, the
 * wooden rim that overhangs it, and anything that spills off screen.
 *
 * Usage in the browser: copy this file's contents into the console, then call
 *   auditLayout()
 */

function auditLayout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const box = document.getElementById('box').getBoundingClientRect();
  const rim = document.querySelector('.box-rim').getBoundingClientRect();
  const base = document.querySelector('.box-base').getBoundingClientRect();
  const score = document.querySelector('.score').getBoundingClientRect();
  const hudRight = document.querySelector('.hud-right').getBoundingClientRect();

  const spill = [];
  for (const el of document.querySelectorAll('.game *, .stage > .credits-btn')) {
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.right > vw + 1 || b.left < -1 || b.bottom > vh + 1) {
      spill.push({ el: el.className || el.tagName, left: Math.round(b.left), right: Math.round(b.right), bottom: Math.round(b.bottom) });
    }
  }

  // The discovery burst spins, so it must clear the viewport diagonal or its
  // circular edge shows as a gap in the corners on a wide screen.
  const rays = document.querySelector('.rays');
  const raysRect = rays.getBoundingClientRect();
  const raysHidden = rays.closest('[hidden]') !== null;
  const raysCovers = raysHidden
    ? null
    : raysRect.left <= 0 && raysRect.right >= vw && raysRect.top <= 0 && raysRect.bottom >= vh
      && raysRect.width >= Math.hypot(vw, vh);

  const result = {
    viewport: `${vw} x ${vh}`,
    rays: raysHidden ? 'not shown' : `${Math.round(raysRect.width)}px vs ${Math.round(Math.hypot(vw, vh))}px diagonal`,
    box: { w: Math.round(box.width), h: Math.round(box.height), ratio: +(box.height / box.width).toFixed(3) },
    checks: {
      'box keeps its 5:6.2 ratio': Math.abs(box.height / box.width - 6.2 / 5) < 0.02,
      'rim fits on screen': rim.left >= -1 && rim.right <= vw + 1,
      'base sits above the bottom edge': base.bottom <= vh + 1,
      'score does not cover the box': !(score.bottom > box.top && score.right > box.left),
      'next and pause do not cover the box': !(hudRight.bottom > box.top && hudRight.left < box.right),
      'page does not scroll': document.documentElement.scrollWidth <= vw && document.documentElement.scrollHeight <= vh,
      'nothing spills off screen': spill.length === 0,
      ...(raysCovers === null ? {} : { 'discovery burst covers the screen': raysCovers }),
    },
    spill: spill.slice(0, 6),
  };
  result.pass = Object.values(result.checks).every(Boolean);
  return result;
}

if (typeof window !== 'undefined') window.auditLayout = auditLayout;
