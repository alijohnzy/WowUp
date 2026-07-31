// Guards against a network call that skips the HTTP seam.
//
// Under Electron `webSecurity: false` means a bare `fetch()` to api.curseforge.com works, so
// nothing about writing one looks wrong — no lint error, no failing test, and it keeps
// working for whoever wrote it. Under Tauri the same call is blocked by CORS and fails as an
// opaque network error with no status, which surfaces as "an error occurred checking for
// updates" and an addon list that still renders from the local database.
//
// So the failure mode is: correct on the shell you tested, silently broken on the other one.
// This walks the renderer source and requires every call to go through `httpFetch`
// ($lib/http), which picks the right transport.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');

/** `$lib/http` is where the swap lives, so it is the one file allowed to name `fetch`. */
const ALLOWED_FILES = new Set([path.join(srcRoot, 'lib', 'http.ts')]);

/**
 * A call to `fetch(...)` that is not a property access (`res.fetch`, `axios.fetch`) and not
 * part of a longer identifier (`httpFetch(`, `tauriFetch(`).
 */
const BARE_FETCH = /(?<![.\w$])fetch\s*\(/g;

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...sourceFiles(full));
		} else if (/\.(ts|svelte)$/.test(entry) && !/\.spec\.ts$/.test(entry)) {
			out.push(full);
		}
	}
	return out;
}

describe('renderer HTTP calls', () => {
	it('all go through $lib/http, not global fetch', () => {
		const offenders: string[] = [];

		for (const file of sourceFiles(srcRoot)) {
			if (ALLOWED_FILES.has(file)) continue;

			const source = readFileSync(file, 'utf8');
			for (const match of source.matchAll(BARE_FETCH)) {
				const line = source.slice(0, match.index).split('\n').length;
				offenders.push(`${path.relative(srcRoot, file)}:${line}`);
			}
		}

		expect(
			offenders,
			`bare fetch() found — import { httpFetch } from '$lib/http' instead:\n  ${offenders.join('\n  ')}`
		).toEqual([]);
	});
});
