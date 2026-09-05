# Emoji Merge

A cosy physics puzzle for browser game portals. Drop emoji into a wooden box;
two of the same kind that touch merge into the next one up the chain. Fill the
box past the red line and the round is over.

Built to the **Emoji Merge v6** design canvas, with real rigid-body physics
rather than the mockup's scripted placement.

---

## Running it

```bash
node serve.js
```

Then open <http://localhost:8765>. There is no build step and no install: the
game is plain ES modules, so what you run locally is exactly what ships.

Useful query parameters:

| Parameter | Effect |
|---|---|
| `?debug` | Exposes `window.EmojiMerge` for poking at the game from the console |
| `?ads=demo` | Shows the design's ad placeholder when no portal SDK is present |

---

## How it is put together

```
index.html          markup for every screen, matching the design canvas
src/
  main.js           boot, input, game loop, ad flow
  game.js           rules: scoring, combos, danger, round lifecycle
  physics.js        Matter.js wrapper: the box, tier radii, merge detection
  render.js         draws the pieces on the canvas
  ui.js             everything that touches the DOM
  themes.js         content tables carried over from the design
  config.js         monetisation switches and where the portal SDK loads
  sky.js            time of day as a continuous, blendable value
  emoji.js          local Twemoji artwork, sprite cache, DOM replacement
  audio.js          all sound, synthesised at runtime
  storage.js        progress and settings, with validation on load
  sdk.js            CrazyGames integration and its no-op fallback
  styles.css        the design's look, as classes
vendor/matter.min.js   physics engine (MIT)
assets/             emoji artwork and webfonts, all local
tools/              asset fetcher, licence check, release builder
test/               headless physics tests, browser layout audit
```

**Only the pieces are drawn on canvas.** The box, the score, the effects and
every overlay stay as DOM with the design's own CSS, so the look is the
approved one rather than a re-interpretation of it.

---

## The physics

Matter.js does the rigid-body work; `src/physics.js` owns everything specific
to this game.

- The simulation runs at a **fixed internal size of 500 × 620 units**, so the
  game behaves identically on every screen. The renderer scales the result.
- It steps at a **fixed 120 Hz** regardless of display refresh rate. Halving
  the timestep against the usual 60 Hz halves how far a fast piece travels
  between collision checks, which is what stops a hard landing from visibly
  sinking into the floor.
- Piece speed is **capped at 15 units per step**, comfortably under the
  smallest piece's radius of 17.5, so nothing can tunnel through a gap.
- **Rolling resistance** bleeds off spin while a piece rests against something.
  Matter approximates a circle with a polygon, which otherwise rolls further
  than a real one and makes pieces wander away from where the player aimed.
- Merging is decided **once per step**, from the full set of active contacts,
  rather than pair by pair as each collision arrives. Same-tier contacts are
  grouped into connected clusters first, then resolved. Deciding per pair would
  consume two pieces before a third was ever considered.

### The triple

Drop a third piece across the gap between two of a kind and all three merge at
once, **skipping a tier**, for double points.

Two pieces resting apart cannot be touching each other — they would already
have merged — so a trio only appears when a third lands across the gap. The
rule therefore needs no delay and no waiting to see whether a third arrives.

**A strict contact test makes the move unreachable.** A falling piece almost
never reaches both neighbours on the same physics step: a horizontal error of
one pixel is enough for one contact to register a step earlier, and the pair
merges before the third is considered. So when a pair is about to merge,
`_findWedgedThird` also accepts a same-tier piece within `TRIPLE_REACH` of
either member — slack sized to cover one step of travel, about 7.5 world units.

The geometry is forgiving but bounded. The third wedges against both only while
their centres are under two diameters apart; past that it falls straight
between them. The aim may miss the middle of the gap by about a fifth of a
radius, and a wider miss is an ordinary pair.

One consequence worth knowing: a trio spawns a piece **two** tiers up, which is
far larger than its parents. Scaling the shove that clears its neighbours to
*its* radius flung small pieces through the floor, so the shove is capped
against the piece being moved and clamped to the box.

In ordinary play it fires around **5% of merges**, roughly ten times a game,
so it is a flourish rather than a change to the economy. `TRIPLE_SIZE` and
`TRIPLE_TIER_SKIP` in `src/physics.js` and `TRIPLE_BONUS` in `src/game.js`
control it.

### The summit

Two pieces of the top tier **vanish** rather than growing, for `JACKPOT_POINTS`
times the combo multiplier, with a fanfare and a `happytime` call to the
portal. Before this the chain's top was a dead end: two of the largest piece
sat there forever and all but guaranteed an overflow, which punished exactly
the player who had done the hardest thing possible. Three of the top tier
landing together vanish the same way.

### Earning the sets

Only *Animals* is open at first. *Snacks* opens on discovering the Puppy and
*Space* on discovering the Unicorn (`THEME_UNLOCK` in `src/themes.js`;
`discovered` is the highest tier ever reached, in any set). Locked sets stay
visible in the settings, greyed with a lock, and tapping one names the goal in
the emoji of the set the player is currently using. The unlock is announced
once, after the discovery reveal that earned it closes, so the two moments do
not talk over each other.

Each set also changes the **backdrop** — the hills, ground, grass and fence the
design drew for the meadow are recoloured and repatterned per theme (`SCENES`):
a picnic with a gingham cloth and white pickets for Snacks, lilac dunes with a
cratered floor, a metal rail and a ringed sun for Space. The sky and its day
cycle are shared. The design canvas only styled the box; the backdrops are an
extension of its shapes, so adjust freely.

### Your best runs

The design's "#N this week" chip implied a leaderboard there is no server for,
so it now ranks the run against the player's own history: `#2 best run`, or
`beyond top 5`. The five best runs, with date and biggest piece, are listed on
the collection screen. `HISTORY_SIZE` in `src/storage.js`.

Tuning lives at the top of `src/physics.js` and `src/game.js`. The values worth
knowing:

| Constant | Where | Meaning |
|---|---|---|
| `gravity.y = 1.3` | physics.js | How briskly pieces fall |
| `MAX_SPEED = 15` | physics.js | Speed cap per step |
| `ROLLING_RESISTANCE` | physics.js | Spin retained per step while resting |
| `TRIPLE_TIER_SKIP` | physics.js | Tiers gained when three merge at once |
| `TRIPLE_REACH` | physics.js | Slack that lets a near-touching third join |
| `TRIPLE_BONUS` | game.js | Score multiplier for a triple |
| `JACKPOT_POINTS` | game.js | Base points when two top-tier pieces vanish |
| `THEME_UNLOCK` | themes.js | Tier to discover before each set opens |
| `HISTORY_SIZE` | storage.js | How many best runs are kept |
| `OVERFLOW_GRACE = 1.5` | game.js | Seconds above the line before the round ends |
| `DANGER_HEIGHT` | game.js | Top 30% of the box triggers the warning |
| `COMBO_WINDOW = 1.4` | game.js | Seconds a combo survives |
| `DROP_COOLDOWN = 340` | game.js | Milliseconds between drops |
| `SCORE_AT` | sky.js | Scores at which morning, sunset and night are reached |
| `SCORE_PER_DAY` | sky.js | Score for one full day before the sky loops |
| `SKY_HALF_LIFE_AUTO` | ui.js | How slowly the sky drifts with the score |

---

## Testing

```bash
node test/physics.test.mjs
```

Runs headless against the same vendored Matter.js the browser loads. It checks
that pieces rest where they should, that same-tier pairs merge and two of the
top tier vanish, that a trio fires across a gap and survives an off-centre
drop, that sixty drops never escape the box or leave it jittering, that a
heavy piece dropped from height cannot punch through a pile, that overflow
detection and the rescue behave, and that a saved box restores. It also reports
the per-frame cost.

For layout, load `test/layout-audit.js` in the browser console and call
`auditLayout()`. It verifies the box keeps its 5:6.2 ratio, that the wooden rim
that overhangs the box stays on screen, that the score and the next-piece
bubble do not cover the box, and that nothing spills off the viewport. It has
been run at 360×640, 375×812, 768×1024, 900×420 and 1280×720.

---

## Publishing

```bash
node tools/license-check.mjs   # must print PASS
node tools/build.mjs           # writes dist/emoji-merge.zip
```

The builder copies only what `tools/ship-manifest.mjs` lists, runs the licence
check **against the built folder** rather than the source tree, and packages a
zip with `index.html` at its root. The current build is about 0.25 MB zipped.

### Ads

**Ads are switched off.** `src/config.js` holds one flag, `adsEnabled`, set to
`false` for the soft launch. The slots are fully built and wired: the rescue is
simply granted instead of being sold. Flip the flag at full launch and the same
buttons start serving real ads, with nothing else to change.

| Slot | Type | Where | Now | At full launch |
|---|---|---|---|---|
| Save the box | Rewarded | Game over card, and the "Shake the box!" button while the pile is high | Granted free | Rewarded ad |
| Another round | Midgame | PLAY AGAIN, and Restart in the pause menu | No ad | Midgame ad |

Test either mode without editing the file: `?ads=on`, `?ads=off`, or
`?ads=demo` for the design's placeholder screen.

Two portal rules shape this and are easy to break by accident:

- **A rewarded "keep playing" offer and a midgame ad may not be combined.**
  While the rescue is still on the table, PLAY AGAIN restarts without an ad.
  Once the rescue is spent, the restart is a clean break and may carry one.
- **Do not add a cooldown of your own.** CrazyGames paces midgame ads itself,
  at most one every three minutes with extra safeguards around game start and
  rewarded ads, and silently ignores a request that comes too soon. Gating
  requests locally only loses fill.

Audio is muted for the duration of every ad, and the overlays are cleared while
one is requested or playing so no button can be pressed through it.

### CrazyGames

`src/sdk.js` wraps the HTML5 SDK v3 and handles the rest of what their review
checks: `loadingStart` / `loadingStop` around asset loading, `gameplayStart` /
`gameplayStop` around actual play including pauses and ad breaks, `happytime`
on a new best score, and progress stored through the SDK's data module with
`localStorage` and then memory as fallbacks.

The SDK must be served from `https://sdk.crazygames.com/crazygames-sdk-v3.js`
and so cannot be bundled. It is **only requested when the game is running on
crazygames.com** (`shouldLoadPortalSdk` in `src/config.js`; add `?sdk=on` to
test it locally). Anywhere else — itch.io, a static host, a local file — the
build makes no network request at all. If the SDK is absent or times out every
call degrades to a no-op, so the same build works everywhere.

### Licences

See `LICENSES.md` for the full audit. In short: the game code, the design and
all sound are original; Matter.js is MIT; the emoji artwork is Twemoji under
CC-BY 4.0 and is credited in game; both fonts are OFL. Nothing is share-alike,
so the game's own code stays proprietary.

---

## Things worth knowing

- **The sky is a continuous loop, not three states.** The design gives morning,
  sunset and night, but their gradients had different numbers of colour stops,
  and a browser will not interpolate between those — so a CSS transition on
  the background did nothing and the sky cut instantly. `src/sky.js` resamples
  all three onto the same four stops and mixes them in JavaScript at whatever
  point the score puts the game, easing toward it each frame.
  The three presets form a **loop**: past night the sky carries on through a
  dawn back to morning, so a long run keeps cycling instead of sitting on night
  forever. One full day is `SCORE_PER_DAY` points. The dawn is not a fourth
  preset, it is simply the night-to-morning leg of the blend.
  Position is measured in preset units and runs on unbounded, so easing is
  plain arithmetic with no wrap-around special case. In auto mode a target
  behind the current position means the next time round, so time only ever runs
  forwards — restarting at night eases through dawn rather than rewinding. A
  time picked by hand takes the shorter way round instead, and uses a faster
  half-life, so the choice feels answered.
- **Tightening the combo window does not make the multiplier more earned.**
  It was tried and measured. Average multiplier, blind tapping versus aiming
  at a match: at 1.4 s, 4.8 vs 7.0; at 1.2 s, 3.9 vs 5.1; at 1.0 s, 3.3 vs
  3.4. A deliberate cascade takes longer to resolve than an accidental one, so
  a short window strips the skilled player's chains first and the skill gap
  disappears. The window stays at 1.4 s. If the multiplier must be reined in,
  count it per *drop that merged*, so a cascade is one step, not many.
- **A CSS animation replaces the whole `transform` property.** Anything that
  positions itself with a base `translate(-50%, -50%)` loses it the moment an
  animation starts, so the keyframes for those elements fold the base
  transform back in. Worth remembering before adding a new animated element.
- **The game loop falls back to a timer.** Some embedded webviews never fire
  `requestAnimationFrame`. If no frame arrives within half a second, the loop
  switches to `setInterval`. For the same reason the box's intro animation is
  cleared on a timer rather than on `animationend`, so a webview that never
  runs CSS animations cannot leave the box parked off screen.
- **Emoji are bundled, not system.** The same character looks different on
  Windows, Android, iOS and macOS. Twemoji artwork is rasterised into a sprite
  cache for the canvas and swapped into the DOM as `<img>` elsewhere.
- **All sound is synthesised.** `src/audio.js` builds every cue from
  oscillators and shaped noise, so there is no audio file to load or license.
  Merge pitch rises with tier and combo, and impacts are rate-limited so a busy
  pile does not machine-gun.
- **Saves are validated on load.** A corrupted or hand-edited save falls back
  to defaults field by field rather than breaking the game.
- **Adding a theme** means one entry in `THEMES` in `src/themes.js` with eleven
  emoji, names and descriptions, plus a `BOXES` entry for the box styling. Then
  run `node tools/fetch-assets.mjs` to pull the new artwork.
