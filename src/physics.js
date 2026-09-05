/**
 * physics.js — Matter.js wrapper for the merge box.
 *
 * Matter.js (MIT, vendored in vendor/matter.min.js) does the rigid-body work.
 * This module owns everything specific to the game: the fixed internal world
 * size, tier radii, merge detection and the little bits of state the renderer
 * needs for squash and impact effects.
 *
 * The simulation always runs at a fixed internal resolution so behaviour is
 * identical on every screen; the renderer scales the result to fit the box.
 */

import { SIZES, MAX_TIER } from './themes.js';

/** Internal simulation size. Aspect ratio matches the design's 5 / 6.2 box. */
export const WORLD_W = 500;
export const WORLD_H = 620;

/** The dashed danger line sits at 16% of the box height, as in the design. */
export const DANGER_Y = WORLD_H * 0.16;

const WALL_THICKNESS = 60;

/**
 * The simulation runs at 120 Hz regardless of the display refresh rate.
 * Halving the timestep halves how far a fast piece moves between collision
 * checks, which is what keeps a hard landing from visibly sinking into the
 * floor. Matter 0.20 normalises velocities against a 60 Hz base, so the feel
 * of the game is unchanged by this.
 */
const FIXED_DT = 1000 / 120;
const MAX_SUBSTEPS = 6;

/**
 * Displacement cap per step, in world units. The smallest piece has a radius
 * of 17.5, so capping well below that bounds how deep a hard landing can sink
 * before the position solver pushes it back out.
 */
const MAX_SPEED = 15;
const MAX_SPIN = 0.5;

/** Spin retained per 120 Hz step while a piece is resting against something. */
const ROLLING_RESISTANCE = 0.94;

/**
 * Land a third piece across the gap between two of a kind and all three go at
 * once, skipping a tier. The geometry is forgiving — the two may sit anywhere
 * up to two diameters apart — but the setup is uncommon, so this stays a rare
 * flourish rather than a change to the economy of the game.
 */
export const TRIPLE_SIZE = 3;
export const TRIPLE_TIER_SKIP = 2;

/**
 * How much closer than touching a third piece may be and still join a merging
 * pair, as a fraction of the contact distance.
 *
 * Without this the rule is unreachable. A falling piece almost never reaches
 * both neighbours on the same physics step: a horizontal error of a single
 * pixel is enough for one contact to register a step earlier, and the pair
 * merges before the third is ever considered. The slack has to cover roughly
 * one step of travel, which is about 7.5 world units at the speed cap.
 */
const TRIPLE_REACH = 0.16;

/** Clearance kept between a freshly merged piece and the box boundary. */
const SPAWN_MARGIN = 1.5;

export function radiusOf(tier) {
  return (SIZES[tier] / 100) * WORLD_W * 0.5;
}

function matter() {
  const M = globalThis.Matter;
  if (!M) throw new Error('Matter.js is not loaded — vendor/matter.min.js must run first.');
  return M;
}

export class MergeWorld {
  /**
   * @param {object} handlers
   * @param {(info: {tier: number, x: number, y: number, a: object, b: object}) => void} [handlers.onMerge]
   * @param {(info: {speed: number, tier: number, x: number, y: number}) => void} [handlers.onImpact]
   */
  constructor(handlers = {}) {
    const { Engine, Bodies, Composite, Events } = matter();

    this.onMerge = handlers.onMerge ?? null;
    this.onImpact = handlers.onImpact ?? null;

    this.engine = Engine.create({
      positionIterations: 14,
      velocityIterations: 10,
      constraintIterations: 3,
      enableSleeping: true,
    });
    this.engine.gravity.y = 1.3;
    // Matter's default sleep threshold wakes bodies too eagerly for a tall
    // stack; a slightly longer delay keeps settled piles perfectly still.
    this.engine.timing.timeScale = 1;

    const wallOptions = {
      isStatic: true,
      friction: 0.4,
      frictionStatic: 0.6,
      restitution: 0.02,
      slop: 0.2,
      label: 'wall',
    };

    // Side walls run far above the box so a piece released high up is still
    // guided in, and far below so nothing can squeeze out of a corner.
    this.walls = [
      Bodies.rectangle(-WALL_THICKNESS / 2, WORLD_H / 2, WALL_THICKNESS, WORLD_H * 4, wallOptions),
      Bodies.rectangle(WORLD_W + WALL_THICKNESS / 2, WORLD_H / 2, WALL_THICKNESS, WORLD_H * 4, wallOptions),
      Bodies.rectangle(WORLD_W / 2, WORLD_H + WALL_THICKNESS / 2, WORLD_W + WALL_THICKNESS * 2, WALL_THICKNESS, wallOptions),
    ];
    Composite.add(this.engine.world, this.walls);

    /** @type {any[]} live merge pieces, in creation order */
    this.pieces = [];
    this._accumulator = 0;
    this._pendingMerges = [];
    this._nextPieceId = 1;

    Events.on(this.engine, 'collisionStart', (event) => this._onCollisionStart(event));
  }

  reset() {
    const { Composite } = matter();
    for (const body of this.pieces) Composite.remove(this.engine.world, body);
    this.pieces.length = 0;
    this._pendingMerges.length = 0;
    this._accumulator = 0;
  }

  /**
   * Add a piece to the box.
   * @param {number} tier
   * @param {number} x centre in world units
   * @param {number} y centre in world units
   */
  addPiece(tier, x, y, opts = {}) {
    const { Bodies, Composite, Body } = matter();
    const r = radiusOf(tier);

    // A higher side count keeps a piece from tipping off a polygon vertex and
    // wandering after it lands, which reads as "wrong" in a merge game.
    const body = Bodies.circle(x, y, r, {
      label: 'piece',
      restitution: 0.05,
      friction: 0.45,
      frictionStatic: 0.7,
      frictionAir: 0.008,
      density: 0.0012,
      slop: 0.2,
      sleepThreshold: 45,
    }, 48);

    body.tier = tier;
    body.pieceId = this._nextPieceId++;
    body.merged = false;
    body.spawnedAt = this.engine.timing.timestamp;
    body.squash = 0;
    body.squashAngle = 0;
    body.restTime = 0;
    body.bornFromMerge = opts.bornFromMerge === true;
    body.popIn = opts.bornFromMerge ? 1 : 0;

    if (opts.vx || opts.vy) Body.setVelocity(body, { x: opts.vx ?? 0, y: opts.vy ?? 0 });
    if (opts.angularVelocity) Body.setAngularVelocity(body, opts.angularVelocity);
    if (opts.angle) Body.setAngle(body, opts.angle);

    Composite.add(this.engine.world, body);
    this.pieces.push(body);
    return body;
  }

  removePiece(body) {
    const { Composite } = matter();
    const i = this.pieces.indexOf(body);
    if (i >= 0) this.pieces.splice(i, 1);
    Composite.remove(this.engine.world, body);
  }

  /**
   * Advance the simulation. Uses a fixed internal timestep so the feel of the
   * game does not change with frame rate.
   * @param {number} dtMs elapsed wall-clock milliseconds
   */
  step(dtMs) {
    const { Engine } = matter();
    this._accumulator += Math.min(dtMs, FIXED_DT * MAX_SUBSTEPS);

    let steps = 0;
    while (this._accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this._clampVelocities();
      Engine.update(this.engine, FIXED_DT);
      this._accumulator -= FIXED_DT;
      steps++;
      this._collectRestingMerges();
      this._applyRollingResistance();
      this._resolveMerges();
    }
    if (steps === MAX_SUBSTEPS) this._accumulator = 0;

    const dtSec = dtMs / 1000;
    for (const body of this.pieces) {
      body.squash = Math.max(0, body.squash - dtSec * 3.6);
      body.popIn = Math.max(0, body.popIn - dtSec * 4.2);
      if (body.isSleeping || body.speed < 0.35) body.restTime += dtSec;
      else body.restTime = 0;
    }
    return steps;
  }

  /**
   * Cap how far a piece can travel in one step. The smallest piece has a
   * radius of 17.5 world units, so keeping displacement well under that makes
   * tunnelling through a thin gap impossible no matter how hard the box is hit.
   */
  _clampVelocities() {
    const { Body } = matter();
    for (const body of this.pieces) {
      if (body.isSleeping) continue;
      const { x, y } = body.velocity;
      const speed = Math.hypot(x, y);
      if (speed > MAX_SPEED) {
        const k = MAX_SPEED / speed;
        Body.setVelocity(body, { x: x * k, y: y * k });
      }
      if (body.angularVelocity > MAX_SPIN) Body.setAngularVelocity(body, MAX_SPIN);
      else if (body.angularVelocity < -MAX_SPIN) Body.setAngularVelocity(body, -MAX_SPIN);
    }
  }

  _onCollisionStart(event) {
    const { Vector } = matter();
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      const aPiece = bodyA.label === 'piece';
      const bPiece = bodyB.label === 'piece';
      if (!aPiece && !bPiece) continue;

      const relative = aPiece && bPiece
        ? Vector.magnitude(Vector.sub(bodyA.velocity, bodyB.velocity))
        : Vector.magnitude(aPiece ? bodyA.velocity : bodyB.velocity);

      const primary = aPiece ? bodyA : bodyB;
      if (relative > 1.2 && this.onImpact) {
        this.onImpact({
          speed: relative,
          tier: primary.tier,
          x: pair.collision ? pair.collision.supports?.[0]?.x ?? primary.position.x : primary.position.x,
          y: pair.collision ? pair.collision.supports?.[0]?.y ?? primary.position.y : primary.position.y,
        });
      }

      const squash = Math.min(1, relative / 16);
      if (aPiece && squash > bodyA.squash) {
        bodyA.squash = squash;
        bodyA.squashAngle = Math.atan2(bodyB.position.y - bodyA.position.y, bodyB.position.x - bodyA.position.x);
      }
      if (bPiece && squash > bodyB.squash) {
        bodyB.squash = squash;
        bodyB.squashAngle = Math.atan2(bodyA.position.y - bodyB.position.y, bodyA.position.x - bodyB.position.x);
      }

      // Merging is decided once per step in _collectRestingMerges, which sees
      // every contact at once and so can spot a trio. Queueing pairs here
      // would consume two of the three before the third was ever considered.
    }
  }

  /**
   * collisionStart only fires when a contact begins. A piece created by a
   * merge can appear already touching a same-tier neighbour, so every step we
   * also scan the currently active pairs.
   */
  _collectRestingMerges() {
    for (const body of this.pieces) body.touching = false;

    /** @type {Map<any, Set<any>>} same-tier contacts found this step */
    const adjacency = new Map();
    const link = (a, b) => {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
    };

    const list = this.engine.pairs.list;
    for (let i = 0; i < list.length; i++) {
      const pair = list[i];
      if (!pair.isActive) continue;
      const { bodyA, bodyB } = pair;
      const aPiece = bodyA.label === 'piece';
      const bPiece = bodyB.label === 'piece';
      if (aPiece) bodyA.touching = true;
      if (bPiece) bodyB.touching = true;
      if (!aPiece || !bPiece) continue;
      if (bodyA.merged || bodyB.merged) continue;
      // The top tier merges too: two of them vanish rather than growing.
      if (bodyA.tier !== bodyB.tier) continue;
      link(bodyA, bodyB);
    }

    if (adjacency.size === 0) return;

    // Group the contacts before deciding anything. Two pieces resting apart
    // cannot be touching each other — they would already have merged — so a
    // group of three only ever appears when a third piece lands across the
    // gap between them in one step. That is the play worth rewarding, and
    // finding it costs nothing extra because the contacts are already here.
    const seen = new Set();
    for (const start of adjacency.keys()) {
      if (seen.has(start)) continue;

      const group = [];
      const stack = [start];
      while (stack.length > 0) {
        const node = stack.pop();
        if (seen.has(node)) continue;
        seen.add(node);
        group.push(node);
        for (const next of adjacency.get(node)) {
          if (!seen.has(next)) stack.push(next);
        }
      }

      // A pair that is about to merge may still be waiting on a third piece
      // that is a hair short of contact. Pull it in rather than losing it.
      if (group.length === 2) {
        const third = this._findWedgedThird(group[0], group[1]);
        if (third) group.push(third);
      }

      // Take a trio while one is available, then pair off whatever is left.
      while (group.length >= 2) {
        const members = group.splice(0, group.length >= TRIPLE_SIZE ? TRIPLE_SIZE : 2);
        for (const body of members) body.merged = true;
        this._pendingMerges.push(members);
      }
    }
  }

  /**
   * A same-tier piece a hair short of touching either member of a merging
   * pair. It is the piece that would have completed the trio had it reached
   * contact one physics step sooner.
   *
   * The two outer pieces of this move are deliberately far apart, so the
   * newcomer cannot be asked to be near both — and no angle test works either,
   * because the bridging piece sits in the wedge *on top of* the other two,
   * making the angle at it acute for a tight gap and obtuse for a wide one.
   * Plain proximity to the bridge is the honest test. How often it sweeps in
   * a bystander is a matter of measurement, not geometry; see the tests.
   */
  _findWedgedThird(a, b) {
    let best = null;
    let bestSlack = Infinity;

    for (const other of this.pieces) {
      if (other === a || other === b) continue;
      if (other.merged || other.tier !== a.tier) continue;

      for (const bridge of [a, b]) {
        const reach = (other.circleRadius + bridge.circleRadius) * (1 + TRIPLE_REACH);
        const d = Math.hypot(other.position.x - bridge.position.x, other.position.y - bridge.position.y);
        if (d > reach) continue;

        const slack = d / reach;
        if (slack < bestSlack) {
          bestSlack = slack;
          best = other;
        }
      }
    }
    return best;
  }

  /**
   * Matter approximates a circle with a polygon, which rolls further than a
   * real one would once it lands. Bleeding off spin while a piece is touching
   * something keeps pieces settling where the player aimed, without affecting
   * anything still falling freely.
   */
  _applyRollingResistance() {
    const { Body } = matter();
    for (const body of this.pieces) {
      if (body.isSleeping || !body.touching) continue;
      if (body.angularVelocity === 0) continue;
      Body.setAngularVelocity(body, body.angularVelocity * ROLLING_RESISTANCE);
    }
  }


  _resolveMerges() {
    if (this._pendingMerges.length === 0) return;
    const pending = this._pendingMerges;
    this._pendingMerges = [];

    for (const members of pending) {
      const count = members.length;
      const tier = members[0].tier;
      const mean = (pick) => members.reduce((sum, body) => sum + pick(body), 0) / count;

      const x = mean((b) => b.position.x);
      const y = mean((b) => b.position.y);
      const vx = mean((b) => b.velocity.x);
      const vy = mean((b) => b.velocity.y);
      const spin = mean((b) => b.angularVelocity);

      for (const body of members) this.removePiece(body);

      const triple = count >= TRIPLE_SIZE;

      // Two pieces of the top tier have nowhere to go, so they leave. Without
      // this the chain's summit was a dead end: two of the largest piece in
      // the game sat there forever and all but guaranteed an overflow, which
      // punished exactly the player who had done the hardest thing possible.
      if (tier >= MAX_TIER) {
        if (this.onMerge) {
          this.onMerge({ tier, fromTier: tier, x, y, count, triple, vanish: true, body: null });
        }
        continue;
      }

      const nextTier = Math.min(MAX_TIER, tier + (triple ? TRIPLE_TIER_SKIP : 1));

      // The merged piece is bigger than any of its parents — two tiers bigger
      // for a trio — so a centroid that was fine for them can put it inside a
      // wall or the floor. Spawning embedded shows as a visible sink while the
      // solver pushes it back out, so keep the centre clear of the boundary.
      const born_r = radiusOf(nextTier) + SPAWN_MARGIN;
      const sx = Math.min(WORLD_W - born_r, Math.max(born_r, x));
      const sy = Math.min(WORLD_H - born_r, y);

      const born = this.addPiece(nextTier, sx, sy, {
        vx: vx * 0.5,
        vy: vy * 0.5 - (triple ? 2.6 : 1.6),
        angularVelocity: spin * 0.7,
        bornFromMerge: true,
      });

      // Nudge neighbours so the new, larger piece settles into the pile
      // instead of shoving it sideways in one frame.
      this._relieve(born);

      if (this.onMerge) {
        this.onMerge({ tier: nextTier, fromTier: tier, x, y, count, triple, vanish: false, body: born });
      }
    }
  }

  /** Push overlapping neighbours gently away from a freshly merged piece. */
  _relieve(body) {
    const { Body } = matter();
    const r = body.circleRadius;
    for (const other of this.pieces) {
      if (other === body) continue;
      const dx = other.position.x - body.position.x;
      const dy = other.position.y - body.position.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const overlap = r + other.circleRadius - dist;
      if (overlap <= 0) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      // Cap against the piece being moved, not the one that just appeared. A
      // trio spawns a piece two tiers up, and scaling the shove to *its*
      // radius flung small neighbours clean through the floor.
      const push = Math.min(overlap, other.circleRadius * 0.5);
      const margin = other.circleRadius + SPAWN_MARGIN;
      Body.setPosition(other, {
        // Never shove a neighbour out of the box: the solver would then spend
        // several frames dragging it back, which reads as a piece sinking.
        x: Math.min(WORLD_W - margin, Math.max(margin, other.position.x + nx * push * 0.6)),
        y: Math.min(WORLD_H - margin, other.position.y + ny * push * 0.6),
      });
      Body.setVelocity(other, {
        x: other.velocity.x + nx * 0.6,
        y: other.velocity.y + ny * 0.6,
      });
      Body.set(other, 'isSleeping', false);
    }
  }

  /** Highest point of the pile in world units, ignoring pieces still falling. */
  topOfPile({ settledOnly = false } = {}) {
    let top = WORLD_H;
    for (const body of this.pieces) {
      if (settledOnly && body.restTime < 0.25) continue;
      const t = body.position.y - body.circleRadius;
      if (t < top) top = t;
    }
    return top;
  }

  /**
   * A piece counts against the player when it has come to rest with its top
   * above the danger line. Returns how long the worst offender has been there.
   */
  overflowTime() {
    let worst = 0;
    for (const body of this.pieces) {
      if (body.position.y - body.circleRadius >= DANGER_Y) continue;
      if (body.restTime > worst) worst = body.restTime;
    }
    return worst;
  }

  isSettled() {
    for (const body of this.pieces) {
      if (!body.isSleeping && body.speed > 0.4) return false;
    }
    return true;
  }

  /** Remove the `count` smallest pieces — the rewarded-ad rescue. */
  removeSmallest(count) {
    const sorted = [...this.pieces].sort((a, b) => a.tier - b.tier || b.position.y - a.position.y);
    const doomed = sorted.slice(0, Math.min(count, sorted.length));
    for (const body of doomed) this.removePiece(body);
    this.wakeAll();
    return doomed.map((b) => ({ tier: b.tier, x: b.position.x, y: b.position.y }));
  }

  /** Give the whole pile a sideways jolt. */
  shake(strength = 3) {
    const { Body } = matter();
    for (const body of this.pieces) {
      Body.set(body, 'isSleeping', false);
      Body.setVelocity(body, {
        x: body.velocity.x + (Math.random() - 0.5) * strength * 2,
        y: body.velocity.y - Math.random() * strength,
      });
      Body.setAngularVelocity(body, body.angularVelocity + (Math.random() - 0.5) * 0.1);
    }
  }

  wakeAll() {
    const { Body } = matter();
    for (const body of this.pieces) Body.set(body, 'isSleeping', false);
  }

  /** Highest tier currently in the box, or -1 when empty. */
  highestTier() {
    let best = -1;
    for (const body of this.pieces) if (body.tier > best) best = body.tier;
    return best;
  }

  serialize() {
    return this.pieces.map((b) => ({
      tier: b.tier,
      x: +b.position.x.toFixed(2),
      y: +b.position.y.toFixed(2),
      angle: +b.angle.toFixed(3),
    }));
  }

  restore(list) {
    this.reset();
    for (const p of list) {
      if (typeof p.tier !== 'number' || p.tier < 0 || p.tier > MAX_TIER) continue;
      this.addPiece(p.tier, p.x, p.y, { angle: p.angle ?? 0 });
    }
  }
}
