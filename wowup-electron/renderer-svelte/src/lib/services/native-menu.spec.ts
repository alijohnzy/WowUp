// The tray's Update All: which clients it covers, and what the tray says about them.
//
// The count, the names under the menu item and the click all come from trayInstallations(), so
// these assert on what reaches the tray — count, label and names — rather than on the helper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
	t: (key: string) =>
		({
			'PAGES.MY_ADDONS.UPDATE_ALL_BUTTON': 'Update All',
			'PAGES.MY_ADDONS.CHECK_UPDATES_BUTTON': 'Check Updates',
			'APP.SYSTEM_TRAY.CHECKING_UPDATES': 'Checking for updates…'
		})[key] ?? key,
	i18n: { t: (_key: string, args: { count: number }) => `…and ${args.count} more` }
}));

const { syncTrayUpdateCount, trayInstallations, withTrayCheck, withTrayRunState } =
	await import('./native-menu');

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

/** The badge state of every tray update so far, in order. */
const states = () =>
	invoke.mock.calls.filter((c) => c[0] === 'set-tray-update-count').map((c) => c[3]);

describe('the tray badge during Update All', () => {
	beforeEach(() => {
		invoke.mockClear();
		vi.useFakeTimers();
	});
	afterEach(() => vi.useRealTimers());

	it('stays amber while addons finish one by one, counting down', async () => {
		await withTrayRunState(async () => {
			// What each finished install does: redo the count, with no state of its own.
			pending.retail = ['Details'];
			await syncTrayUpdateCount();
			pending.retail = [];
			await syncTrayUpdateCount();
		});

		expect(states()).toEqual(['running', 'running', 'running', 'done']);
		const counts = invoke.mock.calls.map((c) => c[1]);
		expect(counts).toEqual([2, 1, 0, 0]);
	});

	it('goes back to the pending colour a moment after the run', async () => {
		await withTrayRunState(async () => {});
		await vi.runAllTimersAsync();

		expect(states()).toEqual(['running', 'done', 'pending']);
		invoke.mockClear();
		await syncTrayUpdateCount();
		expect(states()).toEqual(['pending']);
	});

	it('goes back to pending at once when the run fails', async () => {
		await expect(
			withTrayRunState(async () => {
				throw new Error('download failed');
			})
		).rejects.toThrow('download failed');

		expect(states()).toEqual(['running', 'pending']);
		invoke.mockClear();
		await syncTrayUpdateCount();
		expect(states()).toEqual(['pending']);
	});

	it('keeps a new run amber when the last run’s green is still timing out', async () => {
		await withTrayRunState(async () => {});
		await withTrayRunState(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
			await syncTrayUpdateCount();
		});

		expect(states()).toEqual(['running', 'done', 'running', 'running', 'done']);
	});
});

/** Every tray update so far, as [label, state]. */
const shownLabels = () =>
	invoke.mock.calls.filter((c) => c[0] === 'set-tray-update-count').map((c) => [c[2], c[3]]);

describe('the tray’s Check Updates', () => {
	beforeEach(() => invoke.mockClear());

	it('is what Update All becomes when nothing is pending', async () => {
		pending.retail = [];
		expect(await tray()).toEqual({ count: 0, label: 'Check Updates', names: [] });
	});

	it('says it is checking while it runs, then offers what it found', async () => {
		pending.retail = [];

		await withTrayCheck(async () => {
			await syncTrayUpdateCount();
			pending.retail = ['DBM'];
		});

		expect(shownLabels()).toEqual([
			['Checking for updates…', 'running'],
			['Checking for updates…', 'running'],
			['Update All (1)', 'pending']
		]);
	});

	it('goes back to Check Updates when it found nothing, or failed', async () => {
		pending.retail = [];

		await withTrayCheck(async () => {});
		await expect(
			withTrayCheck(async () => {
				throw new Error('offline');
			})
		).rejects.toThrow('offline');

		expect(shownLabels().filter((_, i) => i % 2 === 1)).toEqual([
			['Check Updates', 'pending'],
			['Check Updates', 'pending']
		]);
	});
});
