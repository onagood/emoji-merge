/**
 * ship-manifest.mjs — the single definition of what goes into a release.
 *
 * Both the builder and the licence check read this, so a file can never be
 * shipped without also being audited.
 */

/** Files and directories copied into a build, relative to the project root. */
export const SHIP_PATHS = [
  'index.html',
  'src',
  'vendor',
  'assets',
  'LICENSES.md',
];

/** Never copied, even when nested inside a shipped directory. */
export const EXCLUDE = [
  /(^|\/)\.[^/]+$/,        // dotfiles
  /(^|\/)node_modules(\/|$)/,
  /\.map$/,
];

export function isExcluded(relativePath) {
  const normalised = relativePath.split('\\').join('/');
  return EXCLUDE.some((pattern) => pattern.test(normalised));
}
