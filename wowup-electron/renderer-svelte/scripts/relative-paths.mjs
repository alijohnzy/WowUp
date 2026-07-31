// Rewrites the SPA fallback page's asset URLs from absolute to relative.
//
// `paths.relative: true` makes SvelteKit emit relative URLs from *prerendered* pages, which know
// their own depth. The adapter-static `fallback` page does not — it has to work for any route —
// so it is emitted with absolute `/_app/...` URLs.
//
// Over http:// that is correct. Over file://, which is how Electron loads the renderer, `/_app/…`
// resolves against the filesystem root and every module 404s:
//
//     Failed to fetch dynamically imported module: file:///_app/immutable/entry/start.*.js
//
// The window shows nothing and the main process reports a bare ERR_FAILED (-2), so this is worth
// failing loudly on rather than rediscovering.
//
// The fallback always sits at the build root, so `/_app/` → `./_app/` is exact. The document URL
// never changes despite there now being five routes, because `router.type: 'hash'` keeps the
// route in the fragment — so relative URLs never go stale.
//
// Tauri is the opposite case and must be skipped: it serves the app from tauri://localhost, a
// real origin with a root, where `/_app/…` is already correct. Rewriting to `./_app/…` there
// made SvelteKit derive a base that turned goto() into a full-page navigation, and since
// index.html redirects to /my-addons on mount, the app reloaded and redirected in a loop —
// roughly thirty page loads a second, with nothing logged to say why.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.BUILD_SHELL === 'tauri') {
	console.log('relative-paths: skipped (BUILD_SHELL=tauri serves from a real origin)');
	process.exit(0);
}

const indexPath = fileURLToPath(new URL('../build/index.html', import.meta.url));

const original = readFileSync(indexPath, 'utf8');
const rewritten = original.replaceAll('"/_app/', '"./_app/');

const remaining = rewritten.match(/["(]\/(?!\/)[^"')]*/g);
if (remaining) {
	console.error('relative-paths: absolute URLs remain in build/index.html:', remaining);
	process.exit(1);
}

if (rewritten === original) {
	console.warn('relative-paths: nothing to rewrite — check whether the adapter changed.');
} else {
	writeFileSync(indexPath, rewritten);
	console.log(`relative-paths: rewrote ${original.split('"/_app/').length - 1} URLs in index.html`);
}
