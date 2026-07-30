// Fails if the CurseForge API key did not make it into the built renderer intact.
//
// This exists because the failure is otherwise invisible. A missing or mangled key substitutes
// cleanly, builds, and passes every test — it only surfaces at runtime as "an error occurred
// checking for updates from Curse", with the addon list still rendering from the local database
// so the app looks broadly healthy. Two ways it has actually gone wrong here:
//
//   - the secret is unset, so the {{CURSEFORGE_API_KEY}} placeholder ships verbatim
//   - the key reaches the build through a shell that expanded it: `set -a; . ./.env` on a value
//     of the form "$2a$10$…" eats the $-segments and leaves 54 invalid characters
//
// A script rather than `node -e` in the workflow, so it behaves the same on every runner OS.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const CHUNKS = 'renderer-svelte/build/_app/immutable/chunks';
const PLACEHOLDER = '{{CURSEFORGE_API_KEY}}';
// CurseForge keys are bcrypt-shaped and 60 characters.
const CF_KEY = /\$2[aby]\$\d{2}\$[A-Za-z0-9./]{40,}/;
const EXPECTED_LENGTH = 60;

if (!existsSync(CHUNKS)) {
	console.error(`No renderer build at ${CHUNKS} — run the build first.`);
	process.exit(1);
}

let key;
let placeholder = false;

for (const file of readdirSync(CHUNKS).filter((f) => f.endsWith('.js'))) {
	const source = readFileSync(join(CHUNKS, file), 'utf8');
	if (source.includes(PLACEHOLDER)) placeholder = true;
	key ??= source.match(CF_KEY)?.[0];
}

if (placeholder) {
	console.error('CURSEFORGE_API_KEY was never substituted — the placeholder is still in the bundle.');
	console.error('Is the repository secret set? Environment secrets need `environment:` on the job.');
	process.exit(1);
}

if (!key) {
	console.error('No CurseForge key found in the bundle, and no placeholder either.');
	console.error('Something substituted a value that is not a key at all.');
	process.exit(1);
}

if (key.length !== EXPECTED_LENGTH) {
	console.error(
		`The key in the bundle is ${key.length} characters, expected ${EXPECTED_LENGTH}. ` +
			'A shell that expanded the $-segments is the usual cause.'
	);
	process.exit(1);
}

console.log(`CurseForge key present and well formed (${key.length} characters).`);
