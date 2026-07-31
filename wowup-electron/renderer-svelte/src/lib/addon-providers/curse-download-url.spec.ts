// CurseForge nulls downloadUrl for files whose author opted out of third-party
// distribution, and its /download-url endpoint answers 403 with our key. The file is still
// on the CDN at a path derived from its id — which is where the released WowUp's stored
// URLs come from.
//
// Without the fallback such an addon is stored with an empty downloadUrl and
// installOrUpdateAddon rejects it as "Addon not found or invalid": the Update button is
// there, clicking it does nothing, and the only trace is one line in the log. Existing
// installs mask it, because sync never overwrites a stored URL with an empty one — so only
// a fresh scan is affected, which is why it showed up under Tauri first.

import { describe, expect, it } from 'vitest';
import { cfDownloadUrl } from './curse-addon-provider';

describe('cfDownloadUrl', () => {
	it('prefers the URL the API gives us', () => {
		expect(cfDownloadUrl(8543831, 'Coolinator-114.zip', 'https://example.test/a.zip')).toBe(
			'https://example.test/a.zip'
		);
	});

	it('builds the CDN path from the file id when the API gives none', () => {
		// Verified against the live CDN: this exact URL returns 200 and 346 KB, and matches
		// what the released app stored for the same file.
		expect(cfDownloadUrl(8543831, 'Coolinator-114.zip', undefined)).toBe(
			'https://edge.forgecdn.net/files/8543/831/Coolinator-114.zip'
		);
	});

	it('does not zero-pad the trailing group', () => {
		// 8543007 is files/8543/7, not files/8543/007 — padding 404s.
		expect(cfDownloadUrl(8543007, 'A.zip', undefined)).toBe(
			'https://edge.forgecdn.net/files/8543/7/A.zip'
		);
	});

	it('encodes file names', () => {
		// Addon file names carry spaces and parentheses often enough to matter.
		expect(cfDownloadUrl(1234567, 'My Addon (beta).zip', undefined)).toBe(
			'https://edge.forgecdn.net/files/1234/567/My%20Addon%20(beta).zip'
		);
	});

	it('returns empty rather than a bogus URL when it cannot build one', () => {
		// Better to fail the "invalid addon" check than to download from files/0/0.
		expect(cfDownloadUrl(0, 'A.zip', undefined)).toBe('');
		expect(cfDownloadUrl(123, '', undefined)).toBe('');
		expect(cfDownloadUrl(Number.NaN, 'A.zip', undefined)).toBe('');
	});
});
