// Every translation key referenced by a ported component must exist in en.json.
//
// A missing key does not throw — t() falls back to returning the key itself — so the UI
// silently renders "PAGES.OPTIONS.APPLICATION.USE_SYMLINK_SUPPORT_LABEL" as body text. That
// is exactly the mistake this catches (it found one on first run), and it is the kind of
// thing a component test would only catch if it happened to assert on that string.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..');
const enJson = JSON.parse(
	fs.readFileSync(path.resolve(srcRoot, '../../src/assets/i18n/en.json'), 'utf8')
) as Record<string, unknown>;

function walk(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(p);
		return /\.(svelte|ts)$/.test(entry.name) && !entry.name.endsWith('.spec.ts') ? [p] : [];
	});
}

function lookup(key: string): unknown {
	let node: unknown = enJson;
	for (const part of key.split('.')) {
		if (typeof node !== 'object' || node === null) return undefined;
		node = (node as Record<string, unknown>)[part];
	}
	return node;
}

// Matches t('KEY') / i18n.t('KEY') / t("KEY"), including keys with an args object after.
const T_CALL = /\bt\(\s*['"]([A-Z0-9_]+(?:\.[A-Z0-9_]+)+)['"]/g;

const files = walk(srcRoot);

const referenced = new Map<string, string[]>();
for (const file of files) {
	const source = fs.readFileSync(file, 'utf8');
	for (const match of source.matchAll(T_CALL)) {
		const key = match[1];
		const list = referenced.get(key) ?? [];
		list.push(path.relative(srcRoot, file));
		referenced.set(key, list);
	}
}

describe('translation keys', () => {
	it('finds keys to check', () => {
		expect(referenced.size).toBeGreaterThan(30);
	});

	it('every referenced key resolves to a string in en.json', () => {
		const missing: string[] = [];

		for (const [key, usedIn] of referenced) {
			const value = lookup(key);
			if (typeof value !== 'string') {
				missing.push(`${key}  (${[...new Set(usedIn)].join(', ')})`);
			}
		}

		expect(missing, `Missing or non-string translation keys:\n${missing.join('\n')}`).toEqual([]);
	});
});
