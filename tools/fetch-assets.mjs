/**
 * fetch-assets.mjs — download every asset the game needs into the repo.
 *
 * CrazyGames requires a self-contained build: nothing may be pulled from a CDN
 * at runtime. This script vendors the emoji artwork and the two webfonts, and
 * writes the licence text that ships alongside them.
 *
 * Run with: node tools/fetch-assets.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EMOJI_DIR = path.join(ROOT, 'assets', 'emoji');
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');

/** Twemoji release to pin. Graphics are CC-BY 4.0; see LICENSES.md. */
const TWEMOJI_TAG = '14.0.2';
const TWEMOJI_BASE = `https://cdn.jsdelivr.net/gh/twitter/twemoji@${TWEMOJI_TAG}/assets/svg`;

/**
 * Every emoji the game can display, read out of the game's own source.
 *
 * This used to be two hand-kept lists. They drifted from the code the first
 * time a glyph was added to the interface without being added here, and the
 * build shipped broken images. Scanning the source cannot drift.
 */
const SOURCE_GLOBS = ['index.html', 'src'];

/** Pictographic but text-rendered by default, so Twemoji ships no file. */
const TEXT_ONLY = new Set(['©', '®', '™', '‼', '⁉', 'ℹ', '↔', '↕', '▪', '▫']);
const EMOJI_PATTERN = /\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu;

async function collectSourceFiles(entry, out = []) {
  const full = path.join(ROOT, entry);
  const stat = await fs.stat(full);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(full)) {
      await collectSourceFiles(path.join(entry, name), out);
    }
  } else if (/\.(js|html)$/.test(full)) {
    out.push(full);
  }
  return out;
}

async function gatherEmoji() {
  const found = new Set();
  for (const entry of SOURCE_GLOBS) {
    for (const file of await collectSourceFiles(entry)) {
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(EMOJI_PATTERN)) {
        if (match[0].length === 1 && TEXT_ONLY.has(match[0])) continue;
        found.add(match[0]);
      }
    }
  }
  return [...found];
}

const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Lilita+One&family=Baloo+2:wght@600;800&display=swap';
// A modern desktop UA makes Google Fonts serve woff2 rather than ttf.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';


/**
 * Twemoji's filename rule, imported from the game so the tool and the runtime
 * can never disagree about what a file is called.
 */
const { codePoints: emojiFileName } = await import(
  pathToFileURL(path.join(ROOT, 'src', 'emoji.js')).href
);
export { emojiFileName };

async function download(url, extra = {}) {
  const response = await fetch(url, { headers: { 'user-agent': UA, ...extra } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response;
}

async function fetchEmoji() {
  await fs.mkdir(EMOJI_DIR, { recursive: true });
  const ALL_EMOJI = await gatherEmoji();
  let written = 0;
  let skipped = 0;
  const missing = [];

  for (const emoji of ALL_EMOJI) {
    const name = `${emojiFileName(emoji)}.svg`;
    const target = path.join(EMOJI_DIR, name);
    try {
      await fs.access(target);
      skipped++;
      continue;
    } catch {
      // not cached yet
    }
    try {
      const response = await download(`${TWEMOJI_BASE}/${name}`);
      const svg = await response.text();
      if (!svg.trimStart().startsWith('<svg')) throw new Error('not an SVG');
      // Give the root explicit dimensions so every browser can rasterise it
      // straight into a canvas without extra work at runtime.
      const sized = svg.replace(
        /<svg\b(?![^>]*\bwidth=)/,
        '<svg width="128" height="128"'
      );
      await fs.writeFile(target, sized, 'utf8');
      written++;
    } catch (error) {
      missing.push(`${emoji} (${name}): ${error.message}`);
    }
  }

  console.log(`emoji: ${written} downloaded, ${skipped} already present, ${ALL_EMOJI.length} total`);
  if (missing.length) {
    console.error('MISSING EMOJI:');
    for (const line of missing) console.error(`  ${line}`);
    throw new Error(`${missing.length} emoji could not be fetched`);
  }
}

async function fetchFonts() {
  await fs.mkdir(FONT_DIR, { recursive: true });
  const css = await (await download(FONT_CSS_URL)).text();

  // Keep only the latin and latin-ext blocks; the game's text is English.
  const blocks = css.split('/*').filter((block) => /^\s*latin(-ext)?\s*\*\//.test(block));
  if (blocks.length === 0) throw new Error('Google Fonts returned no latin subsets');

  const rules = [];
  const seen = new Set();

  for (const block of blocks) {
    const family = /font-family:\s*'([^']+)'/.exec(block)?.[1];
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] ?? '400';
    const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? 'normal';
    const url = /src:\s*url\(([^)]+)\)/.exec(block)?.[1];
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
    if (!family || !url) continue;

    const subset = /^\s*latin-ext/.test(block) ? 'latin-ext' : 'latin';
    const file = `${family.replace(/\s+/g, '')}-${weight}-${subset}.woff2`;
    if (!seen.has(file)) {
      const bytes = Buffer.from(await (await download(url)).arrayBuffer());
      await fs.writeFile(path.join(FONT_DIR, file), bytes);
      seen.add(file);
      console.log(`font: ${file} (${(bytes.length / 1024).toFixed(1)} KB)`);
    }

    rules.push(
      `@font-face {\n` +
        `  font-family: '${family}';\n` +
        `  font-style: ${style};\n` +
        `  font-weight: ${weight};\n` +
        `  font-display: swap;\n` +
        `  src: url('./${file}') format('woff2');\n` +
        (unicodeRange ? `  unicode-range: ${unicodeRange};\n` : '') +
        `}`
    );
  }

  const header =
    '/* Lilita One and Baloo 2, served locally.\n' +
    ' * Both are licensed under the SIL Open Font License 1.1.\n' +
    ' * Full licence text: assets/fonts/OFL.txt — see LICENSES.md.\n' +
    ' * Generated by tools/fetch-assets.mjs; do not edit by hand.\n' +
    ' */\n\n';

  await fs.writeFile(path.join(FONT_DIR, 'fonts.css'), header + rules.join('\n\n') + '\n', 'utf8');
  console.log(`font: fonts.css written with ${rules.length} @font-face rules`);
}

async function fetchFontLicense() {
  const url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/OFL.txt';
  try {
    const text = await (await download(url)).text();
    await fs.writeFile(path.join(FONT_DIR, 'OFL.txt'), text, 'utf8');
    console.log('font: OFL.txt saved');
  } catch (error) {
    console.warn(`font: could not fetch OFL.txt (${error.message}) — add it by hand`);
  }
}

async function fetchTwemojiLicense() {
  const url = `https://raw.githubusercontent.com/twitter/twemoji/v${TWEMOJI_TAG}/LICENSE-GRAPHICS`;
  try {
    const text = await (await download(url)).text();
    await fs.writeFile(path.join(EMOJI_DIR, 'LICENSE-GRAPHICS.txt'), text, 'utf8');
    console.log('emoji: LICENSE-GRAPHICS.txt saved');
  } catch (error) {
    console.warn(`emoji: could not fetch the graphics licence (${error.message})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('fetch-assets.mjs')) {
  await fetchEmoji();
  await fetchTwemojiLicense();
  await fetchFonts();
  await fetchFontLicense();
  console.log('\nAll assets are in place.');
}
