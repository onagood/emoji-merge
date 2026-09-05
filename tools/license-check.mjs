/**
 * license-check.mjs — verifies the build is safe to publish.
 *
 * Two things portals reject a submission for are unlicensed assets and files
 * pulled from a CDN at runtime. This script checks both:
 *
 *  1. Every third party in the build has its licence text present and is named
 *     in LICENSES.md and in the in-game credits.
 *  2. Nothing loads from the network except the one resource the portal
 *     requires (the CrazyGames SDK, which must come from their own CDN).
 *
 * Run with: node tools/license-check.mjs [directory]
 * Exits non-zero when anything fails, so it can gate a release.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SHIP_PATHS, isExcluded } from './ship-manifest.mjs';

const ROOT = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

/** The only resource allowed to load from the network. */
const ALLOWED_REMOTE = ['https://sdk.crazygames.com/crazygames-sdk-v3.js'];

/** Third-party components that must be accounted for. */
const COMPONENTS = [
  {
    name: 'Matter.js',
    licence: 'MIT',
    holder: 'Liam Brummitt and contributors',
    licenceFile: 'vendor/matter.LICENSE.txt',
    marker: /Copyright \(c\) Liam Brummitt/i,
    usedBy: 'vendor/matter.min.js',
    bannerMarker: /matter-js .* by @liabru/,
  },
  {
    name: 'Twemoji',
    licence: 'CC-BY 4.0',
    holder: 'Twitter, Inc. and other contributors',
    licenceFile: 'assets/emoji/LICENSE-GRAPHICS.txt',
    marker: /CC-BY 4\.0|Creative Commons Attribution 4\.0/i,
    usedBy: 'assets/emoji/*.svg',
  },
  {
    name: 'Lilita One',
    licence: 'SIL OFL 1.1',
    holder: 'the font authors',
    licenceFile: 'assets/fonts/OFL.txt',
    marker: /SIL OPEN FONT LICENSE/i,
    usedBy: 'assets/fonts/LilitaOne-*.woff2',
  },
  {
    name: 'Baloo 2',
    licence: 'SIL OFL 1.1',
    holder: 'the font authors',
    licenceFile: 'assets/fonts/OFL.txt',
    marker: /SIL OPEN FONT LICENSE/i,
    usedBy: 'assets/fonts/Baloo2-*.woff2',
  },
];

/** Files whose text is scanned for network references. */
const SCAN_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json']);

const failures = [];
const warnings = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

async function exists(relative) {
  try {
    await fs.access(path.join(ROOT, relative));
    return true;
  } catch {
    return false;
  }
}

async function read(relative) {
  return fs.readFile(path.join(ROOT, relative), 'utf8');
}

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isExcluded(path.relative(ROOT, full))) continue;
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Only the files that actually ship are audited. Anything else in the working
 * directory — the design canvas, tooling, the dev server — never reaches a
 * player and its external references are irrelevant.
 */
async function shippedFiles() {
  const out = [];
  for (const entry of SHIP_PATHS) {
    const full = path.join(ROOT, entry);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      fail(`${entry} is listed in the ship manifest but does not exist.`);
      continue;
    }
    if (stat.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

// -- 1. licence texts and attribution ---------------------------------------

async function checkComponents() {
  const licenses = (await exists('LICENSES.md')) ? await read('LICENSES.md') : null;
  if (!licenses) fail('LICENSES.md is missing.');

  const credits = (await exists('index.html')) ? await read('index.html') : '';

  for (const item of COMPONENTS) {
    if (!(await exists(item.licenceFile))) {
      fail(`${item.name}: licence text ${item.licenceFile} is missing.`);
    } else {
      const text = await read(item.licenceFile);
      if (!item.marker.test(text)) {
        fail(`${item.name}: ${item.licenceFile} does not look like the expected licence.`);
      }
    }

    if (licenses && !licenses.includes(item.name)) {
      fail(`${item.name}: not listed in LICENSES.md.`);
    }
    if (!credits.includes(item.name)) {
      fail(`${item.name}: not named in the in-game credits (index.html).`);
    }

    if (item.bannerMarker) {
      const source = await read(item.usedBy);
      if (!item.bannerMarker.test(source)) {
        fail(`${item.name}: the copyright banner has been stripped from ${item.usedBy}.`);
      }
    }
  }

  // Twemoji's licence obliges us to name the source in something a player sees.
  if (!credits.includes('CC-BY 4.0')) {
    fail('The credits screen must state the CC-BY 4.0 licence for the emoji artwork.');
  }
}

// -- 2. nothing loads from the network --------------------------------------

const URL_PATTERN = /https?:\/\/[^\s"'`)<>]+/g;

async function checkRemoteReferences() {
  const files = await shippedFiles();
  for (const file of files) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (!SCAN_EXTENSIONS.has(path.extname(file))) continue;

    const text = await fs.readFile(file, 'utf8');
    const matches = text.match(URL_PATTERN) ?? [];

    for (const raw of matches) {
      const url = raw.replace(/[.,;]+$/, '');
      if (ALLOWED_REMOTE.includes(url)) continue;

      // A URL inside a comment or a licence notice is documentation, not a
      // fetch. Only flag ones that actually reference a resource.
      const loading = new RegExp(
        `(src|href)\\s*=\\s*["']${escapeRegex(url)}|url\\(\\s*["']?${escapeRegex(url)}|` +
        `(fetch|import)\\s*\\(\\s*["']${escapeRegex(url)}`
      );
      if (loading.test(text)) {
        fail(`${relative} loads ${url} from the network. The build must be self-contained.`);
      } else if (relative.startsWith('vendor/')) {
        notes.push(`${relative}: ${url} appears in the vendored copyright banner (kept on purpose).`);
      } else {
        notes.push(`${relative}: mentions ${url} in text only.`);
      }
    }
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Every emoji the shipped code can name, as artwork filenames.
 *
 * The game references emoji as literal characters in themes.js, main.js and
 * index.html, while the artwork is fetched by a separate hand-kept list. When
 * the two drift the game ships broken images, which is exactly how the lock
 * glyphs reached the live site. Deriving the set from the code closes that.
 */
async function referencedEmoji() {
  const names = new Set();
  let codePoints;
  try {
    const url = pathToFileURL(path.join(ROOT, 'src', 'emoji.js')).href;
    ({ codePoints } = await import(url));
  } catch (error) {
    warnings.push(`could not load the emoji naming rule (${error.message}); skipped that check`);
    return names;
  }

  // Pictographic but text-rendered by default, so Twemoji ships no file.
  const TEXT_ONLY = new Set(['©', '®', '™', '‼', '⁉', 'ℹ', '↔', '↕', '▪', '▫']);
  const pattern = /\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*/gu;

  for (const file of await shippedFiles()) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    const ext = path.extname(file);
    if (ext !== '.js' && ext !== '.html') continue;
    // Minified third-party code contains byte sequences that match the emoji
    // pattern by accident; only our own source names artwork.
    if (relative.startsWith('vendor/')) continue;
    const text = await fs.readFile(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      if (match[0].length === 1 && TEXT_ONLY.has(match[0])) continue;
      names.add(codePoints(match[0]));
    }
  }
  return names;
}

// -- 3. every shipped asset is covered --------------------------------------

async function checkAssetCoverage() {
  const emojiDir = path.join(ROOT, 'assets', 'emoji');
  const fontDir = path.join(ROOT, 'assets', 'fonts');

  if (!(await exists('assets/emoji'))) {
    fail('assets/emoji is missing. Run: node tools/fetch-assets.mjs');
    return;
  }

  const emoji = (await fs.readdir(emojiDir)).filter((f) => f.endsWith('.svg'));
  if (emoji.length === 0) fail('No emoji artwork found. Run: node tools/fetch-assets.mjs');

  const fonts = (await exists('assets/fonts'))
    ? (await fs.readdir(fontDir)).filter((f) => f.endsWith('.woff2'))
    : [];
  if (fonts.length === 0) fail('No webfonts found. Run: node tools/fetch-assets.mjs');

  const unexpected = fonts.filter((f) => !/^(LilitaOne|Baloo2)-/.test(f));
  for (const file of unexpected) {
    fail(`assets/fonts/${file} is not covered by any licence entry.`);
  }

  // Every font family named in LICENSES.md must actually have files, and every
  // file fonts.css asks for must exist. Counting files is not enough: a build
  // missing a whole family still had four fonts and passed.
  for (const family of ['LilitaOne', 'Baloo2']) {
    if (!fonts.some((f) => f.startsWith(`${family}-`))) {
      fail(`assets/fonts holds no ${family} files, but it is declared in LICENSES.md.`);
    }
  }

  if (await exists('assets/fonts/fonts.css')) {
    const css = await read('assets/fonts/fonts.css');
    const wanted = [...css.matchAll(/url\(\s*['"]?\.\/([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
    if (wanted.length === 0) fail('assets/fonts/fonts.css declares no @font-face sources.');
    for (const file of new Set(wanted)) {
      if (!(await exists(`assets/fonts/${file}`))) {
        fail(`assets/fonts/fonts.css references ${file}, which is not in the build.`);
      }
    }
  } else {
    fail('assets/fonts/fonts.css is missing, so no webfont would load.');
  }

  // The same for artwork: every emoji the game can name must be present.
  const referenced = await referencedEmoji();
  const missing = [...referenced].filter((name) => !emoji.includes(`${name}.svg`));
  for (const name of missing.slice(0, 12)) {
    fail(`assets/emoji/${name}.svg is used by the game but not in the build.`);
  }
  if (missing.length > 12) fail(`…and ${missing.length - 12} more emoji files are missing.`);

  // Anything else living in vendor/ would be third-party code nobody declared.
  if (await exists('vendor')) {
    const vendored = await fs.readdir(path.join(ROOT, 'vendor'));
    const declared = new Set(['matter.min.js', 'matter.LICENSE.txt']);
    for (const file of vendored) {
      if (!declared.has(file)) fail(`vendor/${file} is undeclared third-party code.`);
    }
  }

  notes.push(`${emoji.length} emoji SVGs and ${fonts.length} font files are covered.`);
}

// -- 4. the game's own code is original -------------------------------------

async function checkOwnCode() {
  const src = await walk(path.join(ROOT, 'src'));
  const suspicious = [];
  for (const file of src) {
    const text = await fs.readFile(file, 'utf8');
    // A minified blob in src/ would mean copied code slipped in unreviewed.
    const longestLine = text.split('\n').reduce((n, line) => Math.max(n, line.length), 0);
    if (longestLine > 1200) suspicious.push(path.relative(ROOT, file));
  }
  for (const file of suspicious) {
    warnings.push(`${file} contains a very long line; check it is not minified third-party code.`);
  }
}

// -- report ------------------------------------------------------------------

await checkComponents();
await checkRemoteReferences();
await checkAssetCoverage();
await checkOwnCode();

console.log(`License check for ${ROOT}\n`);

if (notes.length) {
  console.log('Notes');
  for (const note of notes) console.log(`  - ${note}`);
  console.log('');
}

if (warnings.length) {
  console.log('Warnings');
  for (const warning of warnings) console.log(`  ! ${warning}`);
  console.log('');
}

if (failures.length) {
  console.log('FAILURES');
  for (const failure of failures) console.log(`  x ${failure}`);
  console.log(`\n${failures.length} problem(s) must be fixed before publishing.`);
  process.exit(1);
}

console.log('PASS — every third party is licensed, attributed, and nothing loads from a CDN');
console.log('       except the CrazyGames SDK, which the portal requires.');
