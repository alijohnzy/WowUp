// CHANNEL_PARAMS (ipc-tauri.ts) must name exactly the arguments each Rust command takes.
//
// Tauri matches invoke arguments by key, so a mismatch does not fail at build time on
// either side: the renderer sends `{ request: {...} }`, the command wanted `dirPath`, and
// the user gets "command get_directory_tree missing required key dirPath" in the WTF
// explorer. The other IPC specs check the table against itself; this one checks it against
// the Rust signatures it is supposed to mirror.

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'linux' }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(), openPath: vi.fn() }));

import { CHANNEL_PARAMS } from './ipc-tauri';

const here = path.dirname(fileURLToPath(import.meta.url));
const rustSrc = path.resolve(here, '../../../src-tauri/src');

// Parameters Tauri supplies itself; they never appear in the invoke payload.
const INJECTED = /^(tauri::)?(AppHandle|State|Window|WebviewWindow|Webview|ipc::Request)\b/;

function rustFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) return rustFiles(p);
		return e.name.endsWith('.rs') ? [p] : [];
	});
}

/** Split on commas that are not inside <...>, (...) or [...]. */
function splitTopLevel(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of s) {
		if ('<([{'.includes(ch)) depth++;
		if ('>)]}'.includes(ch)) depth--;
		if (ch === ',' && depth === 0) {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	if (cur.trim()) out.push(cur);
	return out.map((p) => p.trim()).filter(Boolean);
}

const camel = (snake: string): string =>
	snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** command name -> the argument keys its invoke payload must carry. */
function rustCommands(): Map<string, string[]> {
	const commands = new Map<string, string[]>();
	for (const file of rustFiles(rustSrc)) {
		const src = fs.readFileSync(file, 'utf8');
		// Commands may be private (`fn get_locale` in lib.rs) or pub; attributes and doc
		// comments may sit between the macro and the fn.
		const re =
			/#\[tauri::command[^\]]*\]\s*(?:(?:#\[[^\]]*\]|\/\/\/[^\n]*)\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
		for (const m of src.matchAll(re)) {
			// Walk to the matching close paren of the parameter list.
			let i = m.index! + m[0].length;
			let depth = 1;
			const start = i;
			while (depth > 0 && i < src.length) {
				if (src[i] === '(') depth++;
				if (src[i] === ')') depth--;
				i++;
			}
			const params = splitTopLevel(src.slice(start, i - 1))
				.map((p) => {
					const [name, ...type] = p.split(':');
					return { name: name.replace(/^mut\s+/, '').trim(), type: type.join(':').trim() };
				})
				.filter((p) => !INJECTED.test(p.type))
				.map((p) => camel(p.name));
			commands.set(m[1], params);
		}
	}
	return commands;
}

const commands = rustCommands();

describe('Tauri IPC contract', () => {
	it('finds the Rust commands', () => {
		expect(commands.size).toBeGreaterThan(50);
	});

	it.each(Object.entries(CHANNEL_PARAMS))('%s matches its Rust command', (channel, params) => {
		const command = channel.replace(/-/g, '_');
		expect(commands.has(command), `no #[tauri::command] fn ${command}`).toBe(true);
		expect([...params].sort(), `CHANNEL_PARAMS["${channel}"] vs fn ${command}`).toEqual(
			[...commands.get(command)!].sort()
		);
	});
});
