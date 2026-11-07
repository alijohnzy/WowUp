// The earlier-versions list comes from GitHub's rate-limited API, so it is kept for a while —
// but a failed request must not be kept, or the list could not recover until the cache expired.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('$lib/ipc', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('$lib/i18n.svelte', () => ({ t: (k: string) => k, i18n: { t: (k: string) => k } }));
vi.mock('$lib/state/dialogs.svelte', () => ({ dialogs: { confirm: vi.fn() } }));
vi.mock('$lib/services/links', () => ({ openExternalLink: vi.fn() }));

import { _resetEarlierVersionsCache, listEarlierVersions } from './earlier-versions';

const LIST = { versions: [], canInstall: true, localBuild: false };

beforeEach(() => {
	_resetEarlierVersionsCache();
	invoke.mockReset();
});

describe('listEarlierVersions', () => {
	it('asks once for ten minutes, then again', async () => {
		invoke.mockResolvedValue(LIST);

		await listEarlierVersions(0);
		await listEarlierVersions(9 * 60 * 1000);
		expect(invoke).toHaveBeenCalledTimes(1);

		await listEarlierVersions(11 * 60 * 1000);
		expect(invoke).toHaveBeenCalledTimes(2);
	});

	it('does not keep a failure', async () => {
		invoke.mockRejectedValueOnce(new Error('rate limited')).mockResolvedValue(LIST);

		await expect(listEarlierVersions(0)).rejects.toThrow('rate limited');
		await expect(listEarlierVersions(1000)).resolves.toEqual(LIST);
		expect(invoke).toHaveBeenCalledTimes(2);
	});
});
