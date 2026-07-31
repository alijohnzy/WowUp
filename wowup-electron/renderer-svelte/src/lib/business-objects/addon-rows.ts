// The row-list half of my-addons.component.ts's onAddonInstalledEvent.
//
// Extracted from MyAddonsPage because it is the part worth testing and the only part that does
// not need a running grid: reaching it through the UI means stubbing a download, an unzip and a
// filesystem, so the component keeps the parts that need a session (which client is on screen,
// whether the controls are enabled) and this holds the transformation.

import { AddonViewModel } from '$lib/business-objects/addon-view-model';
import type { Addon } from 'wowup-lib-core';

/**
 * The row list after an addon finished installing.
 *
 * A new view model, never a mutation of the existing one: `sortOrder`, the version columns and
 * the status text all read through the `addon` the model was constructed with, and ag-grid
 * re-sorts on new row data rather than on a cell repaint. Replacing the model is what moves a
 * finished update out of the Update group.
 */
export function withInstalledAddon(
	rows: AddonViewModel[],
	addon: Addon,
	isComplete: boolean
): AddonViewModel[] {
	const idx = rows.findIndex((row) => row.addon?.id === addon.id);

	if (idx !== -1) {
		const next = [...rows];
		next[idx] = new AddonViewModel(addon);
		return next;
	}

	// No row for it yet — installed from Get Addons or a protocol link while this page was
	// open. One that is still installing has nothing worth showing, so it waits for Complete.
	if (!isComplete) return rows;

	// The grid re-sorts on its own comparator; this order is only the tie-break within a status.
	return [...rows, new AddonViewModel(addon)].sort((a, b) =>
		a.canonicalName.localeCompare(b.canonicalName)
	);
}
