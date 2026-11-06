// "Report a bug" on the Debug page: opens a new issue on this fork's repository with the
// details a maintainer always has to ask for — version, platform, language — and the tail of
// the current log, already filled in. Nothing is sent from the app; GitHub shows the draft and
// the user decides what to submit.

import { AppConfig } from '$config/environment';
import { listFiles, readFile } from '$lib/services/files';
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
	let lines = info.logLines;
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
		// tauri-plugin-log names the live file after the app and rotated ones after their
		// date, so the live file is the one ending in plain `.log`.
		const files = (await listFiles(logDir, '*.log')).sort();
		const live = files.find((f) => !/\d{4}-\d{2}-\d{2}/.test(f)) ?? files.at(-1);
		if (!live) return [];
		const text = await readFile(join(logDir, live));
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
