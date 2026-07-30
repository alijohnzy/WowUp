// Mirror the shared Angular assets into the SvelteKit static dir.
//
// src/assets (3.9 MB: window-control glyphs, WoW client logos, the i18n JSON, fonts) is
// consumed by both renderers. Rather than duplicate it in git, this copies it at build and
// dev time — static/assets is gitignored.
//
// It is a copy rather than a symlink because Vite's static handling and electron-builder's
// packaging both follow files more predictably than links.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../src/assets');
const dest = path.resolve(here, '../static/assets');

// Not copied:
//   i18n            - imported at build time by $lib/i18n.svelte via import.meta.glob, so
//                     shipping it again as a static asset would double the locale payload.
//   typeface-roboto - the app uses system-ui; the webfont is unreferenced.
const EXCLUDE = new Set(['i18n', 'typeface-roboto']);

if (!fs.existsSync(src)) {
	console.error(`[sync-assets] source not found: ${src}`);
	process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
	if (EXCLUDE.has(entry.name)) continue;
	fs.cpSync(path.join(src, entry.name), path.join(dest, entry.name), { recursive: true });
}

const count = fs.readdirSync(dest, { recursive: true }).length;
console.log(`[sync-assets] copied ${count} entries -> static/assets`);
