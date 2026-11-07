// A saved language that cannot be loaded must not be replaced by English.
//
// An older copy of the app without the Turkish file loaded English instead — and saved it,
// so every copy, including the ones that have Turkish, came up in English from then on.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, unknown>();
const load = vi.fn();

vi.mock('$lib/services/storage', () => ({
	preferenceStorage: {
		getAsync: (key: string) => Promise.resolve(stored.get(key)),
		setAsync: (key: string, value: unknown) => {
			stored.set(key, value);
			return Promise.resolve();
		}
	}
}));
vi.mock('$lib/ipc', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/ipc')>()),
	invoke: vi.fn((channel: string) =>
		Promise.resolve(channel === 'get-locale' ? 'en-CA' : undefined)
	)
}));
vi.mock('$lib/i18n.svelte', () => ({
	i18n: { load: (locale: string) => load(locale) },
	resolveLocale: (tag: string) => tag.split('-')[0],
	t: (key: string) => key
}));

import { SELECTED_LANGUAGE_PREFERENCE_KEY } from '$common/constants';
import { wowup } from './wowup.svelte';

beforeEach(() => {
	stored.clear();
	load.mockReset();
});

describe('initializeLanguage', () => {
	it('keeps a saved language this copy cannot load, and shows English for now', async () => {
		stored.set(SELECTED_LANGUAGE_PREFERENCE_KEY, 'tr');
		load.mockImplementation((locale: string) =>
			locale === 'tr' ? Promise.reject(new Error('Unknown locale: tr')) : Promise.resolve()
		);

		await wowup.initializeLanguage();

		expect(load).toHaveBeenLastCalledWith('en');
		expect(stored.get(SELECTED_LANGUAGE_PREFERENCE_KEY)).toBe('tr');
	});

	it('uses and saves the saved language when it loads', async () => {
		stored.set(SELECTED_LANGUAGE_PREFERENCE_KEY, 'tr');
		load.mockResolvedValue(undefined);

		await wowup.initializeLanguage();

		expect(load).toHaveBeenCalledWith('tr');
		expect(stored.get(SELECTED_LANGUAGE_PREFERENCE_KEY)).toBe('tr');
	});

	it('on a first run, saves English when the system language is not shipped', async () => {
		load.mockImplementation((locale: string) =>
			locale === 'en' ? Promise.resolve() : Promise.reject(new Error('Unknown locale'))
		);
		const ipc = await import('$lib/ipc');
		vi.mocked(ipc.invoke).mockImplementationOnce(() => Promise.resolve('xx-YY'));

		await wowup.initializeLanguage();

		expect(stored.get(SELECTED_LANGUAGE_PREFERENCE_KEY)).toBe('en');
	});
});
