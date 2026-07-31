import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards the shape of the CurseForge key that vite.config.ts bakes into the bundle.
//
// A wrong key does not fail the build and does not fail any renderer test — it fails at runtime
// as a 403 on every CurseForge call, which the UI reports as "an error occurred checking for
// updates from Curse". The addon list still renders from the local database, so the app looks
// broadly healthy while Get Addons silently returns nothing from CurseForge.
//
// That shipped, because of how the key reaches the build. `.env` holds it double-quoted:
//
//     CURSEFORGE_API_KEY="$2a$10$…"
//
// Building with `set -a; . ./.env; set +a` makes bash expand `$2a`, `$10` and `$7…` as
// variables inside those quotes, turning 60 valid characters into 54 invalid ones — and the
// plugin preferred process.env over parsing the file. Both halves are fixed; this pins it.

const here = path.dirname(fileURLToPath(import.meta.url));
const immutable = path.resolve(here, '../../build/_app/immutable');

const CF_KEY = /\$2[aby]\$\d{2}\$[A-Za-z0-9./]{40,}/;
/** What the bundle holds for `apiKey`, however Rollup happened to minify around it. */
const API_KEY_LITERAL = /apiKey\s*:\s*(["'`])(.*?)\1/g;

/** Every emitted chunk, not just `chunks/` — which entry the config lands in is Rollup's call. */
function bundleSources(): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.js')) out.push(readFileSync(full, 'utf8'));
		}
	};
	walk(immutable);
	return out;
}

describe('CurseForge API key in the built bundle', () => {
	it('is bcrypt-shaped, or absent entirely', () => {
		if (!existsSync(immutable)) {
			// Unit tests run without a build in CI; nothing to check.
			expect(true).toBe(true);
			return;
		}

		// Every `apiKey` literal has to be judged on its own. Asking whether the bundle
		// contains *some* acceptable value is not the same question: the `wago` flavour ships
		// `apiKey: ""` legitimately, and an any-of check lets that one empty literal vouch for
		// a mangled key sitting in another chunk.
		const values = bundleSources().flatMap((s) =>
			[...s.matchAll(API_KEY_LITERAL)].map((m) => m[2])
		);

		// Three valid states:
		//   ""                        the `wago` flavour, which ships CurseForge off on purpose
		//                             (environment.prod.ts / environment.dev.ts hardcode it)
		//   {{CURSEFORGE_API_KEY}}    `ow` built without a key in the environment
		//   $2a$10$… (60 chars)       `ow` built with one, which must be well formed
		//
		// Anything else is a substituted-but-mangled key: it 403s on every CurseForge call
		// while the addon list still renders from the local database, so nothing looks wrong.
		//
		// Collected rather than asserted in the loop, so that a build where every value is
		// legitimately skipped still asserts — vitest runs with `requireAssertions: true`,
		// and a loop of `continue`s reaches the end having asserted nothing, which fails as
		// surely as a real mismatch would.
		const malformed = values.filter(
			(v) => v !== '' && v !== '{{CURSEFORGE_API_KEY}}' && !(CF_KEY.test(v) && v.length === 60)
		);

		expect(
			malformed,
			`malformed CurseForge key(s) baked into the bundle: ${malformed
				.map((v) => `${v.length} chars starting ${JSON.stringify(v.slice(0, 4))}`)
				.join(', ')}`
		).toEqual([]);
	});
});
