// Installing the app update the last check found. Used by the footer's update button and by
// the tray's "Update WowUpNight" item, which are the same action from two places.

import { t } from '$lib/i18n.svelte';
import { openExternalLink } from '$lib/services/links';
import { dialogs } from '$lib/state/dialogs.svelte';
import { electron } from '$lib/state/electron.svelte';
import { wowup } from '$lib/state/wowup.svelte';

export async function installAvailableUpdate(): Promise<void> {
	const evt = electron.appUpdate;
	if (evt?.manual) {
		// The portable zip cannot replace itself; send the user to the release instead.
		const ok = await dialogs.confirm({
			title: t('APP.WOWUP_UPDATE.PORTABLE_DOWNLOAD_TITLE'),
			message: t('APP.WOWUP_UPDATE.PORTABLE_DOWNLOAD_MESSAGE')
		});
		if (ok && evt.releaseUrl) await openExternalLink(evt.releaseUrl);
		return;
	}
	wowup.installUpdate();
}
