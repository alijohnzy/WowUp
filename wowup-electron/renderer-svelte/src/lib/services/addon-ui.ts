// Port of src/app/services/addons/addon-ui.service.ts (106 LOC).
//
// The original was one method built from first/switchMap/map/from/of nested two levels
// deep. Expressed with await it is the same logic, linear, and the two branches are
// visibly the same shape — which is what makes it obvious they can share the snackbar call.

import { i18n } from '$lib/i18n.svelte';
import { dialogs } from '$lib/state/dialogs.svelte';
import { snackbar } from '$lib/state/snackbar.svelte';
import { addonService } from '$lib/state/addon.svelte';
import type { Addon } from 'wowup-lib-core';

export interface RemoveAddonResult {
	dependenciesRemoved: boolean;
	removed: boolean;
}

const EXPLANATION = 'PAGES.MY_ADDONS.UNINSTALL_POPUP.CONFIRMATION_ACTION_EXPLANATION';

export async function handleRemoveAddon(addon: Addon): Promise<RemoveAddonResult> {
	const confirmed = await dialogs.confirm({
		title: i18n.t('PAGES.MY_ADDONS.UNINSTALL_POPUP.TITLE', { count: 1 }),
		message: [
			i18n.t('PAGES.MY_ADDONS.UNINSTALL_POPUP.CONFIRMATION_ONE', { addonName: addon.name }),
			i18n.t(EXPLANATION)
		].join('\n\n')
	});

	if (!confirmed) return { dependenciesRemoved: false, removed: false };

	const hasDependencies = addonService.getRequiredDependencies(addon).length > 0;

	let removeDependencies = false;
	if (hasDependencies) {
		removeDependencies = await dialogs.confirm({
			title: i18n.t('PAGES.MY_ADDONS.UNINSTALL_POPUP.DEPENDENCY_TITLE'),
			message: [
				i18n.t('PAGES.MY_ADDONS.UNINSTALL_POPUP.DEPENDENCY_MESSAGE', {
					addonName: addon.name,
					dependencyCount: (addon.dependencies ?? []).length
				}),
				i18n.t(EXPLANATION)
			].join('\n\n')
		});
	}

	await addonService.removeAddon(addon, removeDependencies);

	snackbar.showSuccess('PAGES.MY_ADDONS.ADDON_REMOVED_SNACKBAR', {
		localeArgs: { addonName: addon.name }
	});

	return { dependenciesRemoved: hasDependencies, removed: true };
}
