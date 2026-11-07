// Get Addons: under a search result's version, the user's other flavors that already have it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ICellRendererParams } from 'ag-grid-community';
import type { AddonSearchResult, WowInstallation } from 'wowup-lib-core';

const installedIn = vi.fn<(addon: unknown, excludeId?: string) => WowInstallation[]>();

vi.mock('$lib/state/addon-flavors.svelte', () => ({
	addonFlavors: { installedIn: (a: unknown, id?: string) => installedIn(a, id) }
}));
vi.mock('$lib/state/session.svelte', () => ({
	session: { selectedWowInstallation: { id: 'retail' } }
}));
vi.mock('$lib/i18n.svelte', () => ({
	t: (key: string) => key,
	i18n: {
		t: (key: string, args?: Record<string, unknown>) =>
			key === 'PAGES.GET_ADDONS.INSTALLED_IN' ? `Installed in: ${args?.clients}` : key
	}
}));

import PotentialAddonCell from './PotentialAddonCell.svelte';
import { GetAddonListItem } from '$lib/business-objects/get-addon-list-item';

const RESULT = {
	externalId: '1',
	providerName: 'Curse',
	name: 'ElvUI',
	author: 'Elv',
	thumbnailUrl: '',
	files: []
} as unknown as AddonSearchResult;

let cell: ReturnType<typeof mount> | undefined;

function render(): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const params = { data: new GetAddonListItem(RESULT) } as ICellRendererParams;
	cell = mount(PotentialAddonCell, { target, props: { params } });
	flushSync();
	return target;
}

afterEach(() => {
	if (cell) unmount(cell);
	cell = undefined;
	document.body.innerHTML = '';
	installedIn.mockReset();
});

describe('PotentialAddonCell', () => {
	it('names the other flavors that have the addon, leaving out the one on screen', () => {
		installedIn.mockReturnValue([
			{ id: 'classic', displayName: 'Classic Era' },
			{ id: 'anniv', displayName: 'Anniversary' }
		] as WowInstallation[]);

		const line = render().querySelector('.installed-in');

		expect(line?.textContent?.trim()).toBe('Installed in: Classic Era, Anniversary');
		expect(installedIn).toHaveBeenCalledWith(RESULT, 'retail');
	});

	it('shows nothing when no other flavor has it', () => {
		installedIn.mockReturnValue([]);
		expect(render().querySelector('.installed-in')).toBeNull();
	});
});
