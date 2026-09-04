/**
 * emoji.js — local Twemoji artwork, used everywhere so the game looks the same
 * on every platform instead of inheriting the host system's emoji font.
 *
 * Artwork: Twemoji by Twitter, CC-BY 4.0 (see LICENSES.md).
 */

const BASE = 'assets/emoji/';
const U200D = '‍';
const VARIATION_SELECTOR = /️/g;

/** Sizes we pre-rasterise to. A request picks the smallest one that fits. */
const BUCKETS = [32, 64, 128, 256, 512];

/** @type {Map<string, HTMLImageElement>} */
const images = new Map();
/** @type {Map<string, HTMLCanvasElement>} */
const sprites = new Map();
/** @type {Map<string, Promise<HTMLImageElement>>} */
const pending = new Map();

/** Twemoji's filename rule: drop FE0F unless the sequence contains a ZWJ. */
export function codePoints(emoji) {
  const source = emoji.indexOf(U200D) < 0 ? emoji.replace(VARIATION_SELECTOR, '') : emoji;
  const points = [];
  let high = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (high) {
      points.push((0x10000 + ((high - 0xd800) << 10) + (code - 0xdc00)).toString(16));
      high = 0;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      high = code;
    } else {
      points.push(code.toString(16));
    }
  }
  return points.join('-');
}

export function emojiUrl(emoji) {
  return `${BASE}${codePoints(emoji)}.svg`;
}

function loadOne(emoji) {
  if (images.has(emoji)) return Promise.resolve(images.get(emoji));
  if (pending.has(emoji)) return pending.get(emoji);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      images.set(emoji, img);
      pending.delete(emoji);
      resolve(img);
    };
    img.onerror = () => {
      // A missing file must never take the game down; the renderer falls back
      // to drawing the character with the system font.
      console.warn(`emoji: could not load ${emoji} (${emojiUrl(emoji)})`);
      pending.delete(emoji);
      resolve(null);
    };
    img.src = emojiUrl(emoji);
  });

  pending.set(emoji, promise);
  return promise;
}

/** Load a batch of emoji. Resolves once every one has loaded or failed. */
export function preload(list) {
  return Promise.all([...new Set(list)].map(loadOne));
}

/**
 * A canvas holding `emoji` drawn at a size at least `pxNeeded` across.
 * Returns null until the artwork has loaded.
 */
export function spriteFor(emoji, pxNeeded) {
  const img = images.get(emoji);
  if (!img) {
    loadOne(emoji);
    return null;
  }

  let bucket = BUCKETS[BUCKETS.length - 1];
  for (const size of BUCKETS) {
    if (size >= pxNeeded) {
      bucket = size;
      break;
    }
  }

  const key = `${emoji}@${bucket}`;
  const cached = sprites.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = bucket;
  canvas.height = bucket;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.drawImage(img, 0, 0, bucket, bucket);
  } catch {
    return null;
  }
  sprites.set(key, canvas);
  return canvas;
}

const EMOJI_PATTERN = /\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu;

/**
 * Characters that are pictographic by category but render as text by default,
 * so Twemoji ships no artwork for them on their own. Replacing a bare © with
 * an image would leave a broken picture in the credits.
 */
const TEXT_DEFAULT = new Set(['©', '®', '™', '‼', '⁉', 'ℹ', '↔', '↕', '▪', '▫']);

function isTextSymbol(match) {
  return match.length === 1 && TEXT_DEFAULT.has(match);
}

/**
 * Replace emoji characters in a DOM subtree with local Twemoji images, so the
 * interface matches the artwork used inside the box.
 */
export function twemojify(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !EMOJI_PATTERN.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      EMOJI_PATTERN.lastIndex = 0;
      const parent = node.parentElement;
      if (!parent || parent.closest('[data-no-twemoji]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);

  for (const node of targets) {
    const fragment = document.createDocumentFragment();
    const text = node.nodeValue;
    let last = 0;
    EMOJI_PATTERN.lastIndex = 0;
    let match;
    while ((match = EMOJI_PATTERN.exec(text)) !== null) {
      if (isTextSymbol(match[0])) continue;
      if (match.index > last) fragment.append(text.slice(last, match.index));
      const img = document.createElement('img');
      img.className = 'twe';
      img.src = emojiUrl(match[0]);
      img.alt = match[0];
      img.draggable = false;
      fragment.append(img);
      last = match.index + match[0].length;
    }
    if (last < text.length) fragment.append(text.slice(last));
    node.parentNode.replaceChild(fragment, node);
  }
}

/** Set an element's content to a single emoji image. */
export function setEmoji(el, emoji) {
  if (!el) return;
  if (el.dataset.emoji === emoji) return;
  el.dataset.emoji = emoji;
  el.replaceChildren();
  if (!emoji) return;
  const img = document.createElement('img');
  img.className = 'twe';
  img.src = emojiUrl(emoji);
  img.alt = emoji;
  img.draggable = false;
  el.append(img);
}
