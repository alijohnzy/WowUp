// Guards against invented IPC channel names.
//
// A wrong channel does not fail loudly: `invoke()` rejects asynchronously with "No handler
// registered for 'x'", which surfaces as a console error in the Electron main log and nowhere
// else. Three had already slipped in this way — `window-unmaximize`, `window-close` and
// `window-leave-full-screen`, none of which the main process registers. The renderer's own
// tests all passed, because they stub the bridge and never assert the channel is real.
//
// This walks every literal string passed to invoke/send/sendSync/on in the renderer source and
// requires it to be either a value declared in src/common/constants.ts (the shared registry) or
// listed below as a deliberate exception.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');
const constantsPath = path.resolve(here, '../../../src/common/constants.ts');

/**
 * Channels that legitimately do not appear in constants.ts.
 *
 * - The DOM/BrowserWindow events (`blur`, `focus`, …) are forwarded by app/preload.ts and are
 *   not IPC handlers at all.
 * - The rest are registered in app/ipc-events.ts with inline string literals rather than
 *   constants; they are real channels, just not declared in the shared file.
 */
const ALLOWED_WITHOUT_CONSTANT = new Set([
	// Forwarded BrowserWindow events, not IPC handlers.
	'blur',
	'focus',
	// Registered in app/ipc-events.ts with inline literals rather than constants.
	'base64-decode',
	'base64-encode',
	'clipboard-read-text',
	'rename-file',
	'set-release-channel',
	'show-item-in-folder',
	'wago-token-received',
	'webview-new-window',
	'zip-file',
	'zip-list-files',
	'zip-read-file',
	'zoom-changed'
]);


function sourceFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			sourceFiles(full, acc);
		} else if (/\.(ts|svelte)$/.test(entry) && !/\.spec\.ts$/.test(entry)) {
			acc.push(full);
		}
	}
	return acc;
}

/** Every string literal assigned to an exported const in constants.ts. */
function declaredChannels(): Set<string> {
	const source = readFileSync(constantsPath, 'utf8');
	const values = new Set<string>();
	for (const match of source.matchAll(/^export const [A-Z0-9_]+ = "([^"]+)";/gm)) {
		values.add(match[1]);
	}
	return values;
}

/**
 * Channel strings the renderer uses, from both shapes that occur:
 *
 *   invoke('some-channel', …)          — literal at the call site
 *   const IPC_FOO = 'some-channel';    — module-local constant, then passed by name
 *
 * The call-site pattern deliberately rejects a preceding `.` so that `emitter.on('remove')`
 * and `webContents.on('close')` are not mistaken for the ipc helper imported from $lib/ipc.
 */
function literalChannelUses(): { channel: string; file: string }[] {
	const uses: { channel: string; file: string }[] = [];
	const patterns = [
		/(?<![.\w])(?:invoke|send|sendSync|on)(?:<[^>]*>)?\(\s*['"]([a-z0-9][a-z0-9-]*)['"]/g,
		/\bconst\s+IPC_[A-Z0-9_]+\s*=\s*['"]([a-z0-9][a-z0-9-]*)['"]/g
	];

	for (const file of sourceFiles(srcRoot)) {
		const source = readFileSync(file, 'utf8');
		for (const pattern of patterns) {
			for (const match of source.matchAll(pattern)) {
				uses.push({ channel: match[1], file: path.relative(srcRoot, file) });
			}
		}
	}
	return uses;
}

/** Every string literal that appears anywhere in the main process sources. */
function mainProcessLiterals(): Set<string> {
	const appRoot = path.resolve(here, '../../../app');
	const values = new Set<string>();
	for (const file of readdirSync(appRoot, { recursive: true, encoding: 'utf8' })) {
		const full = path.join(appRoot, file);
		if (!/\.ts$/.test(file) || statSync(full).isDirectory()) continue;
		for (const match of readFileSync(full, 'utf8').matchAll(/['"]([a-z0-9][a-z0-9-]*)['"]/g)) {
			values.add(match[1]);
		}
	}
	return values;
}

describe('IPC channel names', () => {
	const declared = declaredChannels();

	it('constants.ts parses', () => {
		expect(declared.size).toBeGreaterThan(100);
	});

	// The allowlist above claims each entry is a real channel registered with an inline literal.
	// That claim was taken on trust and one entry was wrong: `restart-application` is handled
	// nowhere — the main process registers `restart-app` — so the Options restart button
	// rejected silently. Verifying the exceptions is the whole point of having them.
	it('every allowlisted channel actually appears in the main process', () => {
		const literals = mainProcessLiterals();
		const phantom = [...ALLOWED_WITHOUT_CONSTANT].filter((channel) => !literals.has(channel));

		// An entry that IS in constants.ts does not belong here either — it is covered by the
		// check above, and leaving it makes the allowlist look longer than it is.
		const redundant = [...ALLOWED_WITHOUT_CONSTANT].filter((channel) => declared.has(channel));
		expect(redundant, 'Allowlist entries already declared in constants.ts').toEqual([]);

		expect(
			phantom,
			`Allowlisted channels that the main process never mentions:\n` +
				phantom.map((c) => `  ${c}`).join('\n')
		).toEqual([]);
	});

	it('every literal channel is declared in constants.ts or explicitly allowed', () => {
		const unknown = literalChannelUses().filter(
			({ channel }) => !declared.has(channel) && !ALLOWED_WITHOUT_CONSTANT.has(channel)
		);

		expect(
			unknown,
			`Unknown IPC channels — add the constant, fix the name, or extend ALLOWED_WITHOUT_CONSTANT:\n` +
				unknown.map((u) => `  ${u.channel}  (${u.file})`).join('\n')
		).toEqual([]);
	});

	it('the allow-list has no stale entries', () => {
		const used = new Set(literalChannelUses().map((u) => u.channel));
		const stale = [...ALLOWED_WITHOUT_CONSTANT].filter((c) => !used.has(c) && !declared.has(c));
		expect(stale, `Allowed channels no longer used anywhere: ${stale.join(', ')}`).toEqual([]);
	});
});
