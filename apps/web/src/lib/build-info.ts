/**
 * What this bundle is: the app's version and the commit it was built from, frozen in at build
 * time by Vite's `define` (see vite.config.mts). A deployed app has no other way to say which
 * code it is actually running, which is the whole point of showing them.
 */

/** Where the source lives, and the base for links into it. */
export const REPOSITORY_URL = 'https://github.com/koenigstag/finance-pal';

/** The version from the app's package.json. */
export const APP_VERSION = __APP_VERSION__;

/** The full commit hash, or '' for a build with no git history to read (e.g. a source tarball). */
export const APP_COMMIT = __APP_COMMIT__;

/** How a hash is shown: the first characters are enough to recognise one and to search for it. */
export const shortCommit = (commit: string) => commit.slice(0, 7);

/** That commit on GitHub, or null when the build didn't record one. */
export const commitUrl = (commit: string) => (commit ? `${REPOSITORY_URL}/commit/${commit}` : null);
