/**
 * render.js — draws the pieces inside the box on a canvas.
 *
 * Only the pieces live on the canvas. Everything else in the design — the box
 * chrome, the score, the overlays, the burst effects — stays as DOM so it keeps
 * the exact CSS from the approved mockup.
 */

import { WORLD_W, WORLD_H } from './physics.js';
import { spriteFor } from './emoji.js';

/** Matches the design's `drop-shadow(0 4px 0 rgba(59,42,30,.18))` on pieces. */
const SHADOW_COLOR = 'rgba(59,42,30,0.18)';
const SHADOW_OFFSET = 4 / 470; // 4px at the design's reference box width

/** @type {Map<string, HTMLCanvasElement>} */
const shadowCache = new Map();

function shadowSpriteFor(emoji, px) {
  const sprite = spriteFor(emoji, px);
  if (!sprite) return null;

  const key = `${emoji}@${sprite.width}`;
  const cached = shadowCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sprite, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = SHADOW_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  shadowCache.set(key, canvas);
  return canvas;
}

export class BoxRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.dpr = 1;
    this.cssWidth = 0;
    this.cssHeight = 0;
  }

  /** Match the canvas to its CSS box and the device pixel ratio. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.dpr = dpr;
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.scale = width / WORLD_W;
    return true;
  }

  /** World units to CSS pixels, for placing DOM effects over the canvas. */
  worldToPercent(x, y) {
    return { left: `${(x / WORLD_W) * 100}%`, top: `${(y / WORLD_H) * 100}%` };
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * @param {Array} pieces bodies from MergeWorld
   * @param {string[]} chain the current theme's emoji, indexed by tier
   */
  draw(pieces, chain) {
    const ctx = this.ctx;
    const scale = this.scale;
    this.clear();

    const shadowOffset = SHADOW_OFFSET * this.canvas.width;

    for (const body of pieces) {
      const emoji = chain[body.tier];
      if (!emoji) continue;

      const radius = body.circleRadius * scale;
      // Twemoji artwork sits inside a square with a little padding, so the
      // glyph reads slightly small at exactly 2r. Nudging it up matches the
      // visual weight of the design's font-rendered emoji.
      const size = radius * 2.16;
      const sprite = spriteFor(emoji, size * 1.2);
      if (!sprite) continue;

      const x = body.position.x * scale;
      const y = body.position.y * scale;

      // Pop-in for a piece that was just created by a merge: overshoot, settle.
      let pop = 1;
      if (body.popIn > 0) {
        const t = 1 - body.popIn;
        pop = 0.55 + 0.45 * t + Math.sin(t * Math.PI) * 0.28;
      }

      const squash = body.squash;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(body.angle);

      if (squash > 0.02) {
        // Flatten along the direction of the impact.
        const local = body.squashAngle - body.angle;
        ctx.rotate(local);
        ctx.scale(1 - squash * 0.18, 1 + squash * 0.18);
        ctx.rotate(-local);
      }
      if (pop !== 1) ctx.scale(pop, pop);

      const half = size / 2;
      const shadow = shadowSpriteFor(emoji, size * 1.2);
      if (shadow) ctx.drawImage(shadow, -half, -half + shadowOffset, size, size);
      ctx.drawImage(sprite, -half, -half, size, size);

      ctx.restore();
    }
  }
}
