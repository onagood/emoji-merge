/**
 * Headless checks for the merge box. Run with: node test/physics.test.mjs
 *
 * Matter.js is loaded from the vendored UMD bundle exactly as the browser
 * loads it, so these tests exercise the same code path the game ships.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

// Evaluate the vendored UMD bundle the way a browser's <script> tag would.
// `require()` cannot be used: this package is an ES module, so Node would try
// to load matter.min.js as ESM and its UMD wrapper would fail.
const matterSource = fs.readFileSync(path.join(here, '..', 'vendor', 'matter.min.js'), 'utf8');
const matterModule = { exports: {} };
new Function('module', 'exports', matterSource)(matterModule, matterModule.exports);
globalThis.Matter = matterModule.exports;

const { MergeWorld, WORLD_W, WORLD_H, radiusOf, DANGER_Y } = await import('../src/physics.js');
const { MAX_TIER } = await import('../src/themes.js');

const FRAME = 1000 / 60;
let failures = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

function run(world, seconds) {
  const frames = Math.round((seconds * 1000) / FRAME);
  for (let i = 0; i < frames; i++) world.step(FRAME);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function stats(world) {
  let escaped = 0;
  let nan = 0;
  let maxOverlap = 0;
  let awake = 0;
  let wallPenetration = 0;

  for (const b of world.pieces) {
    const r = b.circleRadius;
    if (!Number.isFinite(b.position.x) || !Number.isFinite(b.position.y)) nan++;
    // "Escaped" means the piece is genuinely outside, not merely pressed into
    // a wall for a frame or two while the solver pushes it back.
    if (b.position.x + r < 0 || b.position.x - r > WORLD_W || b.position.y - r > WORLD_H) escaped++;
    wallPenetration = Math.max(
      wallPenetration,
      r - b.position.x,
      b.position.x + r - WORLD_W,
      b.position.y + r - WORLD_H
    );
    if (!b.isSleeping && b.speed > 0.4) awake++;
  }

  const list = world.pieces;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const d = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
      maxOverlap = Math.max(maxOverlap, a.circleRadius + b.circleRadius - d);
    }
  }
  return { escaped, nan, maxOverlap, awake, wallPenetration };
}

// ---------------------------------------------------------------------------
section('a single piece falls and rests on the floor');
{
  const world = new MergeWorld();
  const b = world.addPiece(0, WORLD_W / 2, 40);
  run(world, 5);
  const rest = WORLD_H - radiusOf(0);
  check('rests on the floor', Math.abs(b.position.y - rest) < 2, `y=${b.position.y.toFixed(2)} expected≈${rest.toFixed(2)}`);
  // Matter approximates a circle with a polygon, so a piece rolls a little
  // after a long fall. That reads as natural; it just must not wander far.
  check('lands near where it was dropped', Math.abs(b.position.x - WORLD_W / 2) < WORLD_W * 0.08, `drifted ${Math.abs(b.position.x - WORLD_W / 2).toFixed(1)} of ${WORLD_W}`);
  check('came to rest', b.isSleeping || b.speed < 0.4, `speed=${b.speed.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
section('a piece dropped in a corner stays inside the box');
{
  const world = new MergeWorld();
  const b = world.addPiece(10, 10, 40, { vx: -14 });
  run(world, 6);
  const r = radiusOf(10);
  check('stayed right of the left wall', b.position.x >= r - 2, `x=${b.position.x.toFixed(2)} r=${r}`);
  check('rests on the floor', Math.abs(b.position.y - (WORLD_H - r)) < 3, `y=${b.position.y.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
section('two of the same tier merge into the next one');
{
  const merges = [];
  const world = new MergeWorld({ onMerge: (m) => merges.push(m) });
  world.addPiece(2, WORLD_W / 2 - radiusOf(2), WORLD_H - 120);
  world.addPiece(2, WORLD_W / 2 + radiusOf(2) * 0.6, WORLD_H - 120);
  run(world, 3);

  check('exactly one merge fired', merges.length === 1, `${merges.length} merges`);
  check('produced the next tier', merges[0]?.tier === 3, `tier=${merges[0]?.tier}`);
  check('one piece remains', world.pieces.length === 1, `${world.pieces.length} pieces`);
  check('remaining piece is tier 3', world.pieces[0]?.tier === 3);
  check('new piece has the right radius', Math.abs(world.pieces[0].circleRadius - radiusOf(3)) < 0.01);
}

// ---------------------------------------------------------------------------
section('the top tier does not merge further');
{
  const merges = [];
  const world = new MergeWorld({ onMerge: (m) => merges.push(m) });
  world.addPiece(MAX_TIER, WORLD_W / 2 - radiusOf(MAX_TIER) * 0.8, WORLD_H - 150);
  world.addPiece(MAX_TIER, WORLD_W / 2 + radiusOf(MAX_TIER) * 0.8, WORLD_H - 150);
  run(world, 3);
  check('no merge at the top tier', merges.length === 0, `${merges.length} merges`);
  check('both pieces survive', world.pieces.length === 2, `${world.pieces.length} pieces`);
}

// ---------------------------------------------------------------------------
section('a stack of same-tier pieces cascades');
{
  const merges = [];
  const world = new MergeWorld({ onMerge: (m) => merges.push(m) });
  for (let i = 0; i < 8; i++) {
    world.addPiece(0, WORLD_W / 2 + (i % 2 ? 4 : -4), WORLD_H - 30 - i * radiusOf(0) * 2.2);
    run(world, 0.25);
  }
  run(world, 6);
  const s = stats(world);
  check('cascade produced merges', merges.length >= 4, `${merges.length} merges`);
  check('reached at least tier 2', world.highestTier() >= 2, `highest=${world.highestTier()}`);
  check('no NaN', s.nan === 0);
  check('nothing escaped', s.escaped === 0, `${s.escaped} escaped`);
  check('pile came to rest', s.awake === 0, `${s.awake} still moving`);
}

// ---------------------------------------------------------------------------
section('sixty drops behave like a real game');
{
  const rand = rng(20260904);
  const merges = [];
  const world = new MergeWorld({ onMerge: (m) => merges.push(m) });
  let worstOverlap = 0;
  let worstPenetration = 0;
  let escapedEver = 0;

  for (let i = 0; i < 60; i++) {
    const tier = Math.floor(rand() * 4);
    const r = radiusOf(tier);
    const x = r + rand() * (WORLD_W - r * 2);
    world.addPiece(tier, x, r + 12);
    // Sample every frame, not just once the piece has settled, so a momentary
    // sink into the floor on a hard landing is caught.
    for (let f = 0; f < 27; f++) {
      world.step(FRAME);
      const s = stats(world);
      worstOverlap = Math.max(worstOverlap, s.maxOverlap);
      worstPenetration = Math.max(worstPenetration, s.wallPenetration);
      escapedEver += s.escaped;
    }
    if (stats(world).nan > 0) break;
  }
  run(world, 8);
  const s = stats(world);

  console.log(`  info ${merges.length} merges, ${world.pieces.length} pieces left, highest tier ${world.highestTier()}`);
  console.log(`  info worst wall penetration ${worstPenetration.toFixed(2)} of ${WORLD_W} world units`);
  check('no NaN anywhere', s.nan === 0);
  check('nothing ever escaped the box', escapedEver === 0 && s.escaped === 0, `${escapedEver} escapes`);
  check('never sinks visibly into a wall', worstPenetration < WORLD_W * 0.015, `${worstPenetration.toFixed(2)} world units`);
  check('settles flush against the walls', s.wallPenetration < 1.5, `${s.wallPenetration.toFixed(2)} world units`);
  check('merges actually happened', merges.length > 20, `${merges.length} merges`);
  check('overlap stays bounded', worstOverlap < radiusOf(0), `worstOverlap=${worstOverlap.toFixed(2)}`);
  check('pile settles to rest', s.awake === 0, `${s.awake} of ${world.pieces.length} still moving`);
  check('settled overlap is small', s.maxOverlap < 4, `maxOverlap=${s.maxOverlap.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
section('a big piece dropped from height does not punch through');
{
  const world = new MergeWorld();
  for (let i = 0; i < 14; i++) {
    world.addPiece(1, 40 + (i % 7) * 60, WORLD_H - 40 - Math.floor(i / 7) * 40);
  }
  run(world, 3);
  const heavy = world.addPiece(10, WORLD_W / 2, -160, { vy: 25 });
  run(world, 8);
  const s = stats(world);
  check('no NaN', s.nan === 0);
  check('nothing escaped', s.escaped === 0, `${s.escaped} escaped`);
  check('heavy piece stayed above the floor', heavy.position.y + heavy.circleRadius <= WORLD_H + 2, `y=${heavy.position.y.toFixed(1)}`);
  check('pile settles again', s.awake === 0, `${s.awake} still moving`);
}

// ---------------------------------------------------------------------------
section('overflow detection and the rescue');
{
  const world = new MergeWorld();
  // Top-tier pieces never merge away, so the box genuinely fills up.
  const rBig = radiusOf(MAX_TIER);
  for (let i = 0; i < 12; i++) {
    world.addPiece(MAX_TIER, rBig + (i % 2) * (WORLD_W - rBig * 2), 40);
    run(world, 0.7);
  }
  world.addPiece(4, WORLD_W / 2, 40);
  world.addPiece(4, WORLD_W / 2, 40);
  run(world, 6);

  check('pile reaches above the danger line', world.topOfPile() < DANGER_Y, `top=${world.topOfPile().toFixed(1)} line=${DANGER_Y.toFixed(1)}`);
  check('overflow timer is running', world.overflowTime() > 0.5, `overflow=${world.overflowTime().toFixed(2)}s`);

  const before = world.pieces.length;
  const smallestTier = Math.min(...world.pieces.map((p) => p.tier));
  const removed = world.removeSmallest(3);
  check('rescue removed three pieces', removed.length === 3 && world.pieces.length === before - 3, `${removed.length} removed`);
  check('rescue took the smallest tiers first', removed[0].tier === smallestTier, removed.map((p) => p.tier).join(','));

  world.shake(4);
  run(world, 4);
  const s = stats(world);
  check('box is stable after a shake', s.nan === 0 && s.escaped === 0);
}

// ---------------------------------------------------------------------------
section('save and restore');
{
  const world = new MergeWorld();
  for (let i = 0; i < 10; i++) world.addPiece(i % 3, 50 + i * 40, WORLD_H - 80);
  run(world, 4);
  const saved = world.serialize();

  const other = new MergeWorld();
  other.restore(saved);
  check('restores the same number of pieces', other.pieces.length === saved.length, `${other.pieces.length} vs ${saved.length}`);
  check('restores tiers', other.pieces.every((b, i) => b.tier === saved[i].tier));
  check('rejects nonsense entries', (() => {
    const w = new MergeWorld();
    w.restore([{ tier: 99, x: 0, y: 0 }, { tier: -1, x: 0, y: 0 }, { tier: 'x', x: 0, y: 0 }, { tier: 2, x: 100, y: 100 }]);
    return w.pieces.length === 1;
  })());
}

// ---------------------------------------------------------------------------
section('performance');
{
  const world = new MergeWorld();
  const rand = rng(3);
  for (let i = 0; i < 45; i++) {
    // Alternate tiers so nothing merges away and the load stays high.
    world.addPiece(i % 2 === 0 ? 3 : 4, 30 + rand() * (WORLD_W - 60), WORLD_H - 40 - i * 6);
    run(world, 0.1);
  }
  const start = process.hrtime.bigint();
  run(world, 10);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const perFrame = ms / 600;
  console.log(`  info ${world.pieces.length} pieces: ${perFrame.toFixed(3)} ms per frame`);
  check('leaves plenty of frame budget', perFrame < 4, `${perFrame.toFixed(3)} ms/frame`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
