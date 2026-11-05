// The renderer console is forwarded into the app's log file. Download auth carries a GitHub
// personal access token, a Wago bearer token or a CurseForge key, and was logged whole: the
// token sat in plain text in WowUp-CF-Tauri.log.

import { describe, expect, it } from 'vitest';
import { describeDownloadAuth } from './redact';

const PAT = 'github_pat_11AAAAAAAAAAAAAAAAAAAAAA_secretsecretsecretsecretsecret';

describe('describeDownloadAuth', () => {
	it('names the headers and query parameters without their values', () => {
		const text = describeDownloadAuth({
			headers: { Authorization: `Bearer ${PAT}`, Accept: 'application/octet-stream' },
			queryParams: { key: 'cf-api-key-value' }
		});

		expect(text).not.toContain(PAT);
		expect(text).not.toContain('cf-api-key-value');
		expect(text).not.toContain('octet-stream');
		expect(text).toBe('headers: Authorization, Accept; query: key');
	});

	it('says when there is no auth at all', () => {
		expect(describeDownloadAuth(undefined)).toBe('none');
		expect(describeDownloadAuth({})).toBe('none');
	});
});
