// My Addons: an icon next to the version marks addons the user also has in another WoW
// installation, with a tooltip naming them — so "Copy settings from" is discoverable without
// right-clicking every row.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { ICellRendererParams } from 'ag-grid-community';
import type { Addon, WowInstallation } from 'wowup-lib-core';

const installedIn = vi.fn<(addon: unknown, excludeId?: string) => WowInstallation[]>();

vi.mock('$lib/state/addon-flavors.svelte', () => ({
	addonFlavors: { installedIn: (a: unknown, id?: string) => installedIn(a, id) }
}));
vi.mock('$lib/i18n.svelte', () => ({
	t: (key: string) => key,
	i18n: {
		t: (key: string, args?: Record<string, unknown>) =>
			key === 'PAGES.MY_ADDONS.ALSO_INSTALLED_TOOLTIP' ? `Also installed in: ${args?.clients}` : key
	}
}));

import MyAddonsAddonCell from './MyAddonsAddonCell.svelte';
import { AddonViewModel } from '$lib/business-objects/addon-view-model';

const ADDON = {
	id: 'retail-elvui',
	name: 'ElvUI',
	installationId: 'retail',
	installedVersion: '13.80',
	installedFolderList: ['ElvUI'],
	providerName: 'TukUI',
	externalId: '1'
} as Addon;

let cell: ReturnType<typeof mount> | undefined;

function render(): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const params = { data: new AddonViewModel(ADDON) } as ICellRendererParams;
	cell = mount(MyAddonsAddonCell, { target, props: { params } });
	flushSync();
	return target;
}

afterEach(() => {
	if (cell) unmount(cell);
	cell = undefined;
	document.body.innerHTML = '';
	installedIn.mockReset();
});

describe('MyAddonsAddonCell', () => {
	it('marks an addon installed elsewhere and names those installations', () => {
		installedIn.mockReturnValue([
			{ id: 'classic', displayName: 'Classic Era' },
			{ id: 'anniv', displayName: 'Anniversary' }
		] as WowInstallation[]);

		const icon = render().querySelector('.also-installed');

		expect(icon?.getAttribute('title')).toBe('Also installed in: Classic Era, Anniversary');
		// the installation the row belongs to is left out
		expect(installedIn).toHaveBeenCalledWith(ADDON, 'retail');
	});

	it('shows no icon for an addon installed only here', () => {
		installedIn.mockReturnValue([]);
		expect(render().querySelector('.also-installed')).toBeNull();
	});
});
