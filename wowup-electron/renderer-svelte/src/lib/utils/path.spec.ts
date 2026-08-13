import { afterEach, describe, expect, it, vi } from 'vitest';
import nodePath from 'node:path';
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	normalizePath,
	samePath,
	split
} from './path';

// These run under the vitest "server" project (node environment), where `window` is
// undefined, so the helpers take their POSIX branch. That lets us assert directly against
// Node's own path implementation rather than against hand-written expectations.

describe('join', () => {
	const cases: string[][] = [
		['/home/user', 'Documents'],
		['/home/user/', 'Documents'],
		['a', 'b', 'c'],
		['/a', 'b', 'c.toc'],
		['/Applications/World of Warcraft/_retail_', 'Interface', 'AddOns'],
		['relative', 'path']
	];

	it.each(cases)('matches node for %s', (...segments) => {
		expect(join(...segments)).toBe(nodePath.posix.join(...segments));
	});

	it('returns "." for no usable segments', () => {
		expect(join()).toBe('.');
		expect(join('')).toBe('.');
	});

	it('accepts backslash input and normalises it', () => {
		expect(join('C:\\Games\\WoW', 'Interface')).toBe('C:/Games/WoW/Interface');
	});
});

describe('basename', () => {
	const cases = [
		'/home/user/file.toc',
		'/home/user/file.toc/',
		'file.toc',
		'/a',
		'/home/user/.hidden'
	];

	it.each(cases)('matches node for %s', (p) => {
		expect(basename(p)).toBe(nodePath.posix.basename(p));
	});

	it('strips a supplied extension', () => {
		expect(basename('/a/DBM.toc', '.toc')).toBe('DBM');
	});

	it('handles windows separators', () => {
		expect(basename('C:\\Games\\WoW\\Wow.exe')).toBe('Wow.exe');
	});
});

describe('dirname', () => {
	const cases = ['/home/user/file.toc', '/home/user/', 'file.toc', '/a', '/'];

	it.each(cases)('matches node for %s', (p) => {
		expect(dirname(p)).toBe(nodePath.posix.dirname(p));
	});

	it('handles windows separators', () => {
		expect(dirname('C:\\Games\\WoW\\Wow.exe')).toBe('C:\\Games\\WoW');
	});
});

describe('extname', () => {
	const cases = ['DBM.toc', 'archive.tar.gz', 'noext', '.hidden', '/a/b/DBM.toc', 'trailing.'];

	it.each(cases)('matches node for %s', (p) => {
		expect(extname(p)).toBe(nodePath.posix.extname(p));
	});
});

describe('isAbsolute', () => {
	it('recognises posix and windows roots', () => {
		expect(isAbsolute('/home')).toBe(true);
		expect(isAbsolute('C:\\Games')).toBe(true);
		expect(isAbsolute('C:/Games')).toBe(true);
		expect(isAbsolute('relative/path')).toBe(false);
		expect(isAbsolute('')).toBe(false);
	});
});

describe('split', () => {
	it('splits on either separator and drops empties', () => {
		expect(split('/a/b/c')).toEqual(['a', 'b', 'c']);
		expect(split('C:\\a\\b')).toEqual(['C:', 'a', 'b']);
	});
});

describe('samePath', () => {
	it('folds separators', () => {
		expect(samePath('/home/user/wow', '\\home\\user\\wow')).toBe(true);
	});

	it('ignores a trailing separator', () => {
		expect(samePath('/home/user/wow/', '/home/user/wow')).toBe(true);
	});

	it('does not fold case off Windows, where two such folders are two folders', () => {
		expect(samePath('/home/user/WoW', '/home/user/wow')).toBe(false);
	});

	it('matches nothing when either side is missing', () => {
		expect(samePath(undefined, '/a')).toBe(false);
		expect(samePath('/a', '')).toBe(false);
	});
});

// The node environment leaves `window` undefined, so everything above takes the POSIX
// branch. These stub it to reach the Windows one — which is the only branch the reported
// bug ever ran in.
describe('on Windows', () => {
	afterEach(() => vi.unstubAllGlobals());

	const onWindows = () => vi.stubGlobal('window', { platform: 'win32' });

	it('joins with the native separator', () => {
		onWindows();
		expect(join('C:\\Games\\WoW\\_retail_', 'Interface', 'AddOns')).toBe(
			'C:\\Games\\WoW\\_retail_\\Interface\\AddOns'
		);
	});

	/**
	 * The two spellings a single WoW folder had in the bug report: the left from the Electron
	 * data import (Node's `path.join`), the right from this app's own `join` while
	 * `window.platform` went unset under Tauri. They were listed as two separate games.
	 */
	it('recognises the two spellings one folder was listed under', () => {
		onWindows();
		expect(
			samePath(
				'C:\\Program Files (x86)\\World of Warcraft\\_retail_\\Wow.exe',
				'C:/Program Files (x86)/World of Warcraft/_retail_/Wow.exe'
			)
		).toBe(true);
	});

	it('folds case, which the filesystem does not distinguish', () => {
		onWindows();
		expect(samePath('C:\\Games\\WoW', 'c:\\games\\wow')).toBe(true);
		expect(normalizePath('C:\\Games\\WoW')).toBe('c:/games/wow');
	});
});
