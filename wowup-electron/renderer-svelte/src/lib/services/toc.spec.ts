// Addon names come from the TOC's "## Title:" line. A TOC can carry several, each guarded
// by an inline [AllowLoadGameType …] / [ExcludeLoadGameType …] condition, and the game shows
// the last one that applies to it. WowUp showed the first, directive and all: GW2 UI listed as
// "GW2 UI [AllowLoadGameType mainline]".

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WowClientType } from 'wowup-lib-core';

const files: Record<string, string> = {};
vi.mock('./files', () => ({
	readFile: vi.fn((path: string) => Promise.resolve(files[path] ?? '')),
	listFiles: vi.fn(() => Promise.resolve([]))
}));

const { parse, getTocForGameType2 } = await import('./toc');

const TOC = '/wow/Interface/AddOns/GW2_UI/GW2_UI.toc';

async function titleFor(text: string, clientType: WowClientType): Promise<string | undefined> {
	files[TOC] = text;
	const toc = await parse(TOC);
	return getTocForGameType2('GW2_UI', [toc], clientType)?.title;
}

beforeEach(() => {
	for (const key of Object.keys(files)) delete files[key];
});

describe('TOC title', () => {
	it('never shows a load directive', async () => {
		const text = '## Interface: 110200\n## Title: GW2 UI [AllowLoadGameType mainline]\n';
		expect(await titleFor(text, WowClientType.Retail)).toBe('GW2 UI');
	});

	it('picks the title meant for the installation’s game', async () => {
		const text = [
			'## Interface: 110200, 11507, 10600',
			'## Title: GW2 UI',
			'## Title: GW2 UI |cffff0000Era|r [AllowLoadGameType vanilla]',
			'## Title: GW2 UI Forever [AllowLoadGameType forever]'
		].join('\n');

		expect(await titleFor(text, WowClientType.Retail)).toBe('GW2 UI');
		expect(await titleFor(text, WowClientType.ClassicEra)).toBe('GW2 UI Era');
		expect(await titleFor(text, WowClientType.Forever)).toBe('GW2 UI Forever');
	});

	it('strips directives from dependency lists too', async () => {
		files[TOC] = '## Title: GW2 UI\n## Dependencies: Ace3 [AllowLoadGameType mainline], LibStub\n';
		const toc = await parse(TOC);
		expect(toc.dependencyList.map((d) => d.trim())).toEqual(['Ace3', 'LibStub']);
	});
});
