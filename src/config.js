/**
 * config.js — monetisation switches.
 *
 * The ad slots are built and wired now, but switched off for the soft launch:
 * every reward is simply granted. Flip `adsEnabled` to true at full launch and
 * the same slots start serving real ads, with no other change.
 *
 * Override at runtime for testing with `?ads=on`, `?ads=off` or `?ads=demo`.
 */

export const MONETISATION = {
  /**
   * Master switch. While false the rescue is free, no midgame ad is requested,
   * and the SDK is still used for gameplay events and saved progress.
   */
  adsEnabled: false,

  /** Request a midgame ad when the player starts another round. */
  midgameOnRestart: true,

  /** Offer the "Save the box" rescue in exchange for a rewarded ad. */
  rewardedRescue: true,
};

/**
 * CrazyGames requires their SDK to be loaded from their own CDN, so it cannot
 * be bundled. Off their site it would be a pointless third-party request, so
 * it is only fetched where it does something.
 */
export function shouldLoadPortalSdk() {
  const host = location.hostname;
  if (/(^|\.)crazygames\.com$/i.test(host)) return true;
  if (/(^|\.)crazygames\.[a-z]{2,}$/i.test(host)) return true;
  // Their review tools and local testing both run the game in an iframe.
  return new URLSearchParams(location.search).get('sdk') === 'on';
}

/** Apply a `?ads=` override. Returns the mode actually in force. */
export function applyAdOverride(search = location.search) {
  const mode = new URLSearchParams(search).get('ads');
  if (mode === 'on') MONETISATION.adsEnabled = true;
  else if (mode === 'off') MONETISATION.adsEnabled = false;
  return mode;
}
