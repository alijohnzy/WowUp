// Port of src/app/services/links/link.service.ts (87 LOC).
//
// The original was a 5-deep rxjs pipeline (from/first/switchMap/map/catchError) expressing
// "check if trusted, else ask, then maybe trust, then open". As async/await it is the same
// logic in a third of the lines and reads in execution order.

import { USER_ACTION_OPEN_LINK } from '$common/constants';
import { openExternal } from '$lib/ipc';
import { trackAction } from '$lib/services/analytics';
import { dialogs } from '$lib/state/dialogs.svelte';
import { i18n } from '$lib/i18n.svelte';
import { wowup } from '$lib/state/wowup.svelte';

export async function openExternalLink(url: string): Promise<void> {
	trackAction(USER_ACTION_OPEN_LINK, { link: url });
	await openExternal(url);
}

/**
 * Open `href` externally, prompting first unless the domain is already trusted.
 * Never throws — a failure to open a link should not take down the caller.
 */
export async function confirmLinkNavigation(href: string): Promise<void> {
	try {
		const domains = await wowup.getTrustedDomains();

		if (await wowup.isTrustedDomain(href, domains)) {
			await openExternalLink(href);
			return;
		}

		const result = await dialogs.externalUrl({
			title: i18n.t('APP.LINK_NAVIGATION.TITLE'),
			message: i18n.t('APP.LINK_NAVIGATION.MESSAGE', { url: href }),
			url: href,
			domains
		});

		if (!result.success) return;

		if (result.trustDomain !== '') {
			await wowup.trustDomain(result.trustDomain);
		}
		await openExternalLink(href);
	} catch (e) {
		console.error('failed to open external link', e);
	}
}
