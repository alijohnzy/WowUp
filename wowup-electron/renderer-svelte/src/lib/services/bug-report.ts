// "Report a bug" on the Debug page: opens a new issue on this fork's repository with the
// details a maintainer always has to ask for — version, platform, language — and the tail of
// the current log, already filled in. Nothing is sent from the app; GitHub shows the draft and
// the user decides what to submit.

import { AppConfig } from '$config/environment';
import { listFiles, readFile, statFiles } from '$lib/services/files';
import { join } from '$lib/utils/path';

export interface BugReportInfo {
	/** `owner/repo` web URL, e.g. https://github.com/alijohnzy/WowUp */
	repoUrl: string;
	version: string;
	platform: string;
	locale: string;
	/** Most recent log lines, oldest first. */
	logLines: string[];
}

/**
 * Browsers and GitHub start refusing issue URLs somewhere past 8 KB. Staying well under keeps
 * the draft intact; the oldest log lines are what gets dropped.
 */
export const MAX_ISSUE_URL_LENGTH = 7000;

/**
 * Longer log lines are cut. The app logs whole API responses at debug level (one line of
 * 17,757 characters was the newest in a real log), and a single line that size used to push
 * the URL over the limit on its own, so every line was dropped and the report said "No log
 * lines found".
 */
export const MAX_LOG_LINE_LENGTH = 300;

const shorten = (line: string): string =>
	line.length > MAX_LOG_LINE_LENGTH ? `${line.slice(0, MAX_LOG_LINE_LENGTH)} …` : line;

function body(info: BugReportInfo, logLines: string[]): string {
	const log = logLines.length
		? ['<details><summary>Recent log</summary>', '', '```', ...logLines, '```', '</details>']
		: ['_No log lines found._'];

	return [
		'**What happened?**',
		'',
		'',
		'**What did you expect to happen?**',
		'',
		'',
		'**Steps to reproduce**',
		'',
		'',
		'---',
		`- WowUp: v${info.version} (Tauri)`,
		`- OS: ${info.platform}`,
		`- Language: ${info.locale}`,
		'',
		...log
	].join('\n');
}

/** The new-issue URL, trimmed from the oldest log line until it fits. */
export function buildIssueUrl(info: BugReportInfo): string {
	const base = `${info.repoUrl.replace(/\/+$/, '')}/issues/new?body=`;
	let lines = info.logLines.map(shorten);
	for (;;) {
		const url = base + encodeURIComponent(body(info, lines));
		if (url.length <= MAX_ISSUE_URL_LENGTH || lines.length === 0) return url;
		lines = lines.slice(1);
	}
}

/** The last `count` lines of the newest log file in `logDir`, or none if there is no log. */
export async function readLogTail(logDir: string, count = 80): Promise<string[]> {
	if (!logDir) return [];
	try {
		// The live log is the one written most recently. Going by name is not enough: the file
		// is named after the app, and WowUp-CF-Tauri.log stays next to WowUpNight.log after
		// the rename, alongside rotated copies named by date.
		const paths = (await listFiles(logDir, '*.log')).map((f) => join(logDir, f));
		if (paths.length === 0) return [];
		const stats = await statFiles(paths);
		const live = paths.reduce((newest, p) =>
			(stats[p]?.mtimeMs ?? 0) > (stats[newest]?.mtimeMs ?? 0) ? p : newest
		);
		const text = await readFile(live);
		return text
			.split(/\r?\n/)
			.filter((l) => l.trim() !== '')
			.slice(-count);
	} catch (e) {
		console.warn('bug report: could not read the log', e);
		return [];
	}
}

export const bugReportRepoUrl = (): string => AppConfig.wowupRepositoryUrl;
