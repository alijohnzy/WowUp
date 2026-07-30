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
// The fallback always sits at the build root, so `/_app/` → `./_app/` is exact. This is only safe
// because the app has no client-side routing: it is a single route whose "tabs" are state, so the
// document URL never changes and relative URLs never go stale. Adding a second navigable route
// means revisiting this.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
