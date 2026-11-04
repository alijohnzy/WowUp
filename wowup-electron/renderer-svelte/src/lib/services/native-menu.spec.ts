// The tray's Update All: which clients it covers, and what the tray says about them.
//
// The count, the names under the menu item and the click all come from trayInstallations(), so
// these assert on what reaches the tray — count, label and names — rather than on the helper.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Addon, WowInstallation } from 'wowup-lib-core';

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock('$lib/ipc', () => ({
	invoke: (...args: unknown[]) => invoke(...args),
	isTauri: () => true,
	isElectron: () => false,
	isDesktop: () => true
}));

let installations: WowInstallation[] = [];
let selectedId: string | undefined;
let pending: Record<string, string[]> = {};

vi.mock('$lib/state/warcraft-installation.svelte', () => ({
	warcraftInstallations: {
		get installations() {
			return installations;
		}
	}
}));
vi.mock('$lib/state/session.svelte', () => ({
	session: {
		getSelectedWowInstallation: () => installations.find((i) => i.id === selectedId)
	}
}));
vi.mock('$lib/state/addon.svelte', () => ({
	addonService: {
		getAllAddonsAvailableForUpdate: (installation: WowInstallation) =>
			Promise.resolve(
				(pending[installation.id] ?? []).map((name) => ({ name }) as unknown as Addon)
			)
	}
}));
vi.mock('$lib/i18n.svelte', () => ({
	t: (key: string) => (key === 'PAGES.MY_ADDONS.UPDATE_ALL_BUTTON' ? 'Update All' : key),
	i18n: { t: (_key: string, args: { count: number }) => `…and ${args.count} more` }
}));

const { syncTrayUpdateCount, trayInstallations } = await import('./native-menu');

const client = (id: string, displayName: string, over: Partial<WowInstallation> = {}) =>
	({ id, displayName, ...over }) as WowInstallation;

/** What the last tray update showed: [count, label, state, names]. */
async function tray() {
	invoke.mockClear();
	await syncTrayUpdateCount();
	const call = invoke.mock.calls.find((c) => c[0] === 'set-tray-update-count');
	const [, count, label, , names] = call ?? [];
	return { count, label, names };
}

beforeEach(() => {
	installations = [
		client('retail', 'World of Warcraft'),
		client('forever', 'World of Warcraft: Forever'),
		client('era', 'Classic Era')
	];
	selectedId = 'retail';
	pending = { retail: ['DBM', 'Details'], forever: ['DBM', 'Questie'], era: ['Questie'] };
});

describe('the tray’s Update All', () => {
	it('covers only the selected client by default, as before', async () => {
		expect(trayInstallations().map((i) => i.id)).toEqual(['retail']);
		expect(await tray()).toEqual({ count: 2, label: 'Update All (2)', names: ['DBM', 'Details'] });
	});

	it('also covers every client set to update from the tray', async () => {
		installations[1].updateFromTray = true;

		expect(trayInstallations().map((i) => i.id)).toEqual(['retail', 'forever']);
		const shown = await tray();
		expect(shown.count).toBe(4);
		expect(shown.label).toBe('Update All (4)');
		// The same addon is often in several clients, so each name says which one it is.
		expect(shown.names).toEqual([
			'DBM (World of Warcraft)',
			'Details (World of Warcraft)',
			'DBM (World of Warcraft: Forever)',
			'Questie (World of Warcraft: Forever)'
		]);
	});

	it('covers a tray client even when it is not the selected one', async () => {
		installations[1].updateFromTray = true;
		selectedId = 'era';

		expect(trayInstallations().map((i) => i.id)).toEqual(['forever', 'era']);
		expect((await tray()).count).toBe(3);
	});

	it('counts the selected client once when it is also set to update from the tray', async () => {
		installations[0].updateFromTray = true;

		expect(trayInstallations().map((i) => i.id)).toEqual(['retail']);
		expect((await tray()).count).toBe(2);
	});

	it('leaves names untagged when only one of the clients has anything to update', async () => {
		installations[1].updateFromTray = true;
		pending.retail = [];

		expect((await tray()).names).toEqual(['DBM', 'Questie']);
	});

	it('still caps the list, counting the rest', async () => {
		installations[1].updateFromTray = true;
		pending.retail = Array.from({ length: 8 }, (_, i) => `R${i}`);
		pending.forever = Array.from({ length: 8 }, (_, i) => `F${i}`);

		const shown = await tray();
		expect(shown.count).toBe(16);
		expect(shown.names).toHaveLength(11);
		expect((shown.names as string[]).at(-1)).toBe('…and 6 more');
	});
});
