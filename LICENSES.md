# Licences and attribution

This file is the licence audit for **Emoji Merge**. It lists every file that
ships in the build, who owns it, and what the licence requires of us. Run
`node tools/license-check.mjs` to verify the build still matches this document.

Last audited: 2026-09-04.

---

## 1. Summary

| Component | Licence | Commercial use | Attribution required | Where it ships |
|---|---|---|---|---|
| Game code, design and sound | Proprietary, original work | Owned by the author | — | `src/`, `index.html` |
| Matter.js 0.20.0 | MIT | Yes | Copyright notice retained | `vendor/matter.min.js` |
| Twemoji 14.0.2 artwork | CC-BY 4.0 | Yes | Yes, credited in game | `assets/emoji/*.svg` |
| Lilita One | SIL OFL 1.1 | Yes | Notice retained | `assets/fonts/LilitaOne-*.woff2` |
| Baloo 2 | SIL OFL 1.1 | Yes | Notice retained | `assets/fonts/Baloo2-*.woff2` |
| CrazyGames HTML5 SDK v3 | CrazyGames terms | Yes, on CrazyGames | — | Loaded from their CDN |

Every licence above permits commercial distribution on CrazyGames, Poki,
itch.io and comparable portals. Nothing here is share-alike, so the game's own
code stays proprietary.

---

## 2. Original work

Written from scratch for this project, with no third-party code or assets:

- All game logic, rendering, interface and build tooling in `src/`, `tools/`,
  `test/`, `serve.js` and `index.html`.
- **All sound.** Every effect and the background music are synthesised at
  runtime with the Web Audio API in `src/audio.js`. No sample, loop or audio
  file is used, so there is no audio licence to satisfy and no audio asset in
  the build.
- The visual design, carried over from the project's own design canvas.

---

## 3. Matter.js — MIT

- Version 0.20.0, © Liam Brummitt and contributors.
- Licence text: `vendor/matter.LICENSE.txt`.
- Used for the rigid-body simulation inside the box.

**What MIT requires:** the copyright notice and permission notice must be kept
with the software.

**How we comply:** `vendor/matter.min.js` is the unmodified distribution and
still carries its `/*! matter-js 0.20.0 by @liabru ... License MIT */` banner.
The full licence sits beside it, Matter.js is named on the in-game credits
screen, and `tools/license-check.mjs` fails the build if the banner is stripped.

---

## 4. Twemoji — CC-BY 4.0 (graphics)

- Version 14.0.2, © Twitter, Inc. and other contributors.
- Licence text: `assets/emoji/LICENSE-GRAPHICS.txt`.
- Used for every emoji drawn in the game, both the pieces and the interface.

**Why bundled artwork instead of system emoji:** the same emoji looks
different on Windows, Android, iOS and macOS. Shipping one set keeps the game
looking identical everywhere, which portals expect.

**What CC-BY 4.0 requires:** credit the creator, state the licence, and
indicate whether changes were made.

**How we comply:**

- The in-game credits screen (the small **i** button, bottom left) names
  Twemoji, Twitter Inc. and contributors, and states CC-BY 4.0.
- The full licence text ships inside the build.
- **Changes made:** the SVG root element of each file has explicit `width` and
  `height` attributes added by `tools/fetch-assets.mjs`, so browsers can
  rasterise them into a canvas. The artwork itself is unaltered.

A hyperlink to the licence is normally offered as well, but CrazyGames does not
permit outbound links from a game. CC-BY 4.0 asks for the URI only "to the
extent reasonably practicable", and shipping the full licence text in the build
satisfies the requirement in this context.

The Twemoji *source code* is MIT, but none of it is used here; only the
artwork ships.

---

## 5. Fonts — SIL Open Font License 1.1

- **Lilita One** and **Baloo 2**, obtained from Google Fonts.
- Licence text: `assets/fonts/OFL.txt`.
- Subsetted to latin and latin-ext by Google Fonts; the files are served
  unmodified from `assets/fonts/`.

**What the OFL requires:** the fonts may be bundled and sold with software, the
licence must travel with them, and the fonts must not be sold on their own. A
Reserved Font Name may not be reused for a modified version.

**How we comply:** both fonts ship unmodified with the licence text, are named
on the credits screen, and are not distributed as a standalone font product.

---

## 6. CrazyGames HTML5 SDK v3

Loaded at runtime from `https://sdk.crazygames.com/crazygames-sdk-v3.js`.

This is the **only** resource the game fetches from the network, and the portal
requires that it be loaded from their CDN rather than bundled. Everything else
is local, so the game runs fully offline when the SDK is absent: `src/sdk.js`
degrades every call to a no-op and falls back to `localStorage`.

Its use is governed by the CrazyGames developer terms accepted when the game is
submitted.

---

## 7. What is deliberately absent

- No analytics, tracking or advertising code of our own. Ads are served only
  through the portal SDK.
- No fetch to any other host. `tools/license-check.mjs` fails the build if one
  appears.
- No copied game code. The merge rules, scoring, effects and interface are
  original.
- No AI-generated image or audio assets, so there is no question over their
  rights.

---

## 8. Before publishing

```bash
node tools/license-check.mjs
```

The check must print `PASS`. It verifies that every licence file is present and
genuine, that each component is named both here and on the credits screen, that
the Matter.js banner is intact, that no undeclared file sits in `vendor/`, and
that nothing except the CrazyGames SDK is loaded from the network.
