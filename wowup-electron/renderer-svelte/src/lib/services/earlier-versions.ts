// "Install an earlier version", for when an update goes wrong. Offered in Options →
// Application and on a right-click of the footer's update button; both go through here.
//
// The Rust side (src-tauri/src/updater.rs) lists the releases that carry an updater manifest
// and installs one the way an update is installed — same signature check, same installer —
// then restarts. The newest version is still offered as an update afterwards.

import { IPC_APP_INSTALL_VERSION, IPC_APP_LIST_EARLIER_VERSIONS } from '$common/constants';
import { i18n, t } from '$lib/i18n.svelte';
import { invoke } from '$lib/ipc';
import { openExternalLink } from '$lib/services/links';
import { dialogs } from '$lib/state/dialogs.svelte';
import { versionLabel } from '$lib/utils/app-version';

export const EARLIER_VERSION_KEY = 'PAGES.OPTIONS.APPLICATION.EARLIER_VERSION';

export interface EarlierVersion {
	tag: string;
	/** e.g. 2.25.4+26 */
	version: string;
	publishedAt: string;
	releaseUrl: string;
}

export interface EarlierVersions {
	/** Newest first. */
	versions: EarlierVersion[];
	/** False for the Windows portable zip: its release page is opened instead. */
	canInstall: boolean;
	/** Built from source, so there is no release to go back from. */
	localBuild: boolean;
}

/**
 * Kept for a while: the list comes from GitHub's API, which allows 60 unauthenticated requests
 * an hour, and a right-click should not spend one each time.
 */
const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; result: Promise<EarlierVersions> } | undefined;

export function listEarlierVersions(now = Date.now()): Promise<EarlierVersions> {
	if (!cached || now - cached.at > CACHE_MS) {
		const result = invoke<EarlierVersions>(IPC_APP_LIST_EARLIER_VERSIONS);
		cached = { at: now, result };
		// A failure is not kept: the next request tries again.
		result.catch(() => {
			if (cached?.result === result) cached = undefined;
		});
	}
	return cached.result;
}

/** "v2.25.4 #26 · 11/6/2026" */
export function earlierVersionLabel(v: EarlierVersion): string {
	const date = v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : '';
	return `v${versionLabel(v.version).text}${date ? ` · ${date}` : ''}`;
}

/**
 * Asks, then installs `version`; on success the app restarts before this resolves. Progress
 * and failures arrive as app-update-state events, shown in the footer like an update's.
 */
export async function installEarlierVersion(
	version: EarlierVersion,
	canInstall: boolean
): Promise<void> {
	// The portable zip is replaced by hand: its release page has the download.
	if (!canInstall) return openExternalLink(version.releaseUrl);

	const confirmed = await dialogs.confirm({
		title: i18n.t(`${EARLIER_VERSION_KEY}.CONFIRM_TITLE`, {
			version: `v${versionLabel(version.version).text}`
		}),
		message: t(`${EARLIER_VERSION_KEY}.CONFIRM_MESSAGE`),
		positiveKey: `${EARLIER_VERSION_KEY}.INSTALL_BUTTON`
	});
	if (!confirmed) return;

	await invoke(IPC_APP_INSTALL_VERSION, version.tag);
}

/** Tests only. */
export function _resetEarlierVersionsCache(): void {
	cached = undefined;
}
