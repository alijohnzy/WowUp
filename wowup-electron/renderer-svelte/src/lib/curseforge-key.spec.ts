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
const chunks = path.resolve(here, '../../build/_app/immutable/chunks');

const CF_KEY = /\$2[aby]\$\d{2}\$[A-Za-z0-9./]{40,}/;

describe('CurseForge API key in the built bundle', () => {
	it('is bcrypt-shaped, or absent entirely', () => {
		if (!existsSync(chunks)) {
			// Unit tests run without a build in CI; nothing to check.
			expect(true).toBe(true);
			return;
		}

		const sources = readdirSync(chunks)
			.filter((f) => f.endsWith('.js'))
			.map((f) => readFileSync(path.join(chunks, f), 'utf8'));

		const placeholder = sources.some((s) => s.includes('{{CURSEFORGE_API_KEY}}'));
		const key = sources.map((s) => s.match(CF_KEY)?.[0]).find(Boolean);

		// Either the key was never supplied (placeholder intact, CurseForge features off) or it
		// was supplied and must be well formed. What must never ship is a substituted-but-mangled
		// value, which is neither and 403s on every request.
		expect(placeholder || key !== undefined).toBe(true);
		if (key) expect(key).toHaveLength(60);
	});
});
