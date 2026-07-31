// Guards against session signals that have a publisher and no subscriber.
//
// This is the defect class the migration's emitter audit was built to find, and it recurred
// anyway: `autoUpdateCompleteAt` was written by the auto-update job and read by nothing, so an
// update discovered while the app sat open on My Addons never reached the grid. It survived
// because the audit ran once, over the code as it stood — and the publisher was added later, in
// that same audit's own round of fixes. A one-off sweep cannot catch what comes after it.
//
// The check is deliberately crude: every public member of the Session singleton must be named
// at least once elsewhere in the renderer. A field only ever assigned from inside the class is
// a signal nobody is listening to.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '../..');
const sessionPath = path.resolve(here, 'session.svelte.ts');

/**
 * Members with no consumer in the Angular app either — carried over so the two stay
 * comparable, not migration defects. Verified against src/app: `notifyAddonsChanged` has a
 * single commented-out caller in wow-client-options.component.ts, and the other three have
 * none at all.
 *
 * Removing one from this list is fine. Adding one needs the same check first: if Angular
 * calls it and the port does not, that is a defect, not an exception.
 */
const DEAD_IN_ANGULAR_TOO = new Set([
	'myAddonsHiddenColumns',
	'isAuthenticated',
	'notifyAddonsChanged',
	'rescanCompleted'
]);

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(ts|svelte)$/.test(entry) && full !== sessionPath) out.push(full);
	}
	return out;
}

/** Top-level members of `class Session` — one indent level, excluding `#private` ones. */
function sessionMembers(): string[] {
	const source = readFileSync(sessionPath, 'utf8');
	const body = source.slice(source.indexOf('class Session'));
	const names = new Set<string>();
	for (const match of body.matchAll(/^\t(?:readonly )?([a-zA-Z][a-zA-Z0-9]*)\s*(?:=|\(|:)/gm)) {
		names.add(match[1]);
	}
	return [...names];
}

describe('session signals', () => {
	const members = sessionMembers();
	const renderer = walk(srcRoot)
		.map((file) => readFileSync(file, 'utf8'))
		.join('\n');

	it('finds the members to check', () => {
		// A regex that silently matched nothing would make every assertion below vacuous.
		expect(members.length).toBeGreaterThan(20);
		expect(members).toContain('autoUpdateCompleteAt');
	});

	it.each(members.filter((name) => !DEAD_IN_ANGULAR_TOO.has(name)))(
		'session.%s has a consumer',
		(name) => {
			expect(new RegExp(`session\\.${name}\\b`).test(renderer)).toBe(true);
		}
	);

	it.each([...DEAD_IN_ANGULAR_TOO])('session.%s is still unused, as in Angular', (name) => {
		// If one of these grows a consumer, take it off the list rather than leaving a stale
		// exception that would hide the next real one.
		expect(new RegExp(`session\\.${name}\\b`).test(renderer)).toBe(false);
	});
});
