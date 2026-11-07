import { describe, expect, it, vi } from 'vitest';

const listFiles = vi.fn();
const readFile = vi.fn();
const statFiles = vi.fn();
vi.mock('$lib/services/files', () => ({
	listFiles: (...a: unknown[]) => listFiles(...a),
	readFile: (...a: unknown[]) => readFile(...a),
	statFiles: (...a: unknown[]) => statFiles(...a)
}));

import { buildIssueUrl, MAX_ISSUE_URL_LENGTH, readLogTail } from './bug-report';

const info = {
	repoUrl: 'https://github.com/alijohnzy/WowUpNight/',
	version: '2.25.4+18',
	platform: 'linux',
	locale: 'tr',
	logLines: ['first line', 'last line']
};

const bodyOf = (url: string): string => decodeURIComponent(url.split('?body=')[1]);

describe('buildIssueUrl', () => {
	it("opens a new issue on the fork's repository", () => {
		expect(
			buildIssueUrl(info).startsWith('https://github.com/alijohnzy/WowUpNight/issues/new?body=')
		).toBe(true);
	});

	it('fills in version, platform, language and the log', () => {
		const body = bodyOf(buildIssueUrl(info));
		expect(body).toContain('- WowUp: v2.25.4+18 (Tauri)');
		expect(body).toContain('- OS: linux');
		expect(body).toContain('- Language: tr');
		expect(body).toContain('first line\nlast line');
	});

	it('drops the oldest log lines to stay under the URL limit, keeping the newest', () => {
		const logLines = Array.from({ length: 500 }, (_, i) => `line ${i} ${'x'.repeat(40)}`);
		const url = buildIssueUrl({ ...info, logLines });
		expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
		const body = bodyOf(url);
		expect(body).toContain('line 499 ');
		expect(body).not.toContain('line 0 ');
	});

	it('keeps recent lines even when the newest one is enormous', () => {
		const logLines = [
			'older line',
			'recent line',
			`[wago] getFeaturedAddons ${'x'.repeat(17_757)}`
		];
		const url = buildIssueUrl({ ...info, logLines });
		expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
		const body = bodyOf(url);
		expect(body).not.toContain('No log lines found');
		expect(body).toContain('recent line');
		expect(body).toContain(`[wago] getFeaturedAddons ${'x'.repeat(100)}`);
		expect(body).toContain(' …');
	});

	it('still produces a report with no log at all', () => {
		expect(bodyOf(buildIssueUrl({ ...info, logLines: [] }))).toContain('No log lines found');
	});
});

describe('readLogTail', () => {
	it('reads the most recently written log, whatever the app was called', async () => {
		listFiles.mockResolvedValue([
			'WowUp-CF-Tauri.log',
			'WowUpNight.log',
			'WowUpNight_2026-11-05_10-00-00.log'
		]);
		statFiles.mockResolvedValue({
			'/logs/WowUp-CF-Tauri.log': { mtimeMs: 1000 },
			'/logs/WowUpNight.log': { mtimeMs: 3000 },
			'/logs/WowUpNight_2026-11-05_10-00-00.log': { mtimeMs: 2000 }
		});
		readFile.mockResolvedValue('a\nb\n\nc\nd\n');
		expect(await readLogTail('/logs', 2)).toEqual(['c', 'd']);
		expect(readFile).toHaveBeenCalledWith('/logs/WowUpNight.log');
	});

	it('gives up quietly when the log cannot be read', async () => {
		listFiles.mockRejectedValue(new Error('nope'));
		expect(await readLogTail('/logs')).toEqual([]);
		expect(await readLogTail('')).toEqual([]);
	});
});
