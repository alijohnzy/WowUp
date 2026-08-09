// Port of src/app/services/session/session.service.ts (220 LOC, 17 Subjects).
//
// This was the densest reactivity in the app: 17 BehaviorSubjects/Subjects exposed as
// `.asObservable()` and consumed through `| async` across most screens. Most were plain
// state, so they become fields. Three were genuine event streams and keep a listener API.
//
// `enableControls$` was `combineLatest([enableControlsSrc, addonService.syncing$])` —
// exactly what $derived is for.
//
// Safe as a module singleton because this renderer is a pure SPA (ssr = false).

import { goto } from '$app/navigation';
import { page } from '$app/state';
import { SELECTED_DETAILS_TAB_KEY } from '$common/constants';
import { invoke } from '$lib/ipc';
import { href, ROUTES, tabIndexForRoute } from '$lib/routes';
import type { ColumnState } from '$lib/models/column-state';
import { preferenceStorage } from '$lib/services/storage';
import { addonService } from '$lib/state/addon.svelte';
import { addonProviders } from '$lib/state/addon-providers.svelte';
import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
import { wowUpAccount } from '$lib/state/wowup-account.svelte';
import type { WowInstallation } from 'wowup-lib-core';

const IPC_GET_APP_VERSION = 'get-app-version';

// Mirrors src/typings.d.ts. The value is persisted under SELECTED_DETAILS_TAB_KEY, which
// both renderers read during the migration, so the spelling has to match exactly.
export type DetailsTabType = 'description' | 'changelog' | 'previews';

type Listener<T> = (value: T) => void;

class Emitter<T> {
	#listeners = new Set<Listener<T>>();
	subscribe(fn: Listener<T>): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}
	emit(value: T): void {
		for (const fn of this.#listeners) fn(value);
	}
}

class Session {
	selectedWowInstallation = $state<WowInstallation | undefined>(undefined);
	statusText = $state('');
	pageContextText = $state('');
	autoUpdateCompleteAt = $state(0);
	myAddonsHiddenColumns = $state<ColumnState[]>([]);
	myAddonsCompactVersion = $state(false);
	editingWowInstallationId = $state('');
	appVersion = $state<string | undefined>(undefined);

	// The Angular default was `false`; My Addons flipped it true once its first load
	// finished, and both addon pages toggle it off around long operations. Until those pages
	// are ported nothing would ever enable it, leaving the whole nav rail dead — so the
	// default is the steady state instead. Revisit when my-addons lands.
	#enableControls = $state(true);

	/**
	 * Whether any enabled provider requires an ad panel — which widens the nav rail.
	 *
	 * Was a `$state` maintained by an `onProviderChange` subscription calling a private
	 * `#updateAdSpace()`. It is a pure function of the provider list, and `addonProviders`
	 * already exposes a revision counter for exactly this, so it is a $derived and the
	 * subscription is gone.
	 */
	adSpace = $derived.by(() => {
		void addonProviders.revision;
		return addonProviders.getEnabledAddonProviders().some((p) => p.adRequired);
	});

	/** Was combineLatest([enableControlsSrc, addonService.syncing$]). */
	enableControls = $derived(this.#enableControls && !addonService.syncing);

	/**
	 * The URL is the source of truth for which screen is showing; this is the same value
	 * expressed as the tab index that preferences and `setContextText` still speak in.
	 *
	 * Was a `$state` the nav rail assigned to. Two writers for one fact — the rail and the
	 * router — is exactly the drift this phase removes.
	 */
	selectedHomeTab = $derived(tabIndexForRoute(page.route?.id));

	// Occurrences, not state.
	readonly addonsChanged = new Emitter<boolean>();
	readonly targetFileInstallComplete = new Emitter<boolean>();
	readonly rescanComplete = new Emitter<boolean>();
	// getAddonsHiddenColumns$ is not here: it is declared in session.service.ts and never
	// subscribed or emitted on either side. Get Addons owns its own column state.
	readonly debugAdFrame = new Emitter<boolean>();
	/**
	 * The tray's Update All was chosen. My Addons owns the routine — it drives the page
	 * spinner and reloads the grid — so the tray asks rather than reimplementing it.
	 */
	readonly updateAllRequested = new Emitter<boolean>();

	#selectedDetailTabType: DetailsTabType = 'description';
	#initialized = false;

	async init(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;

		this.#selectedDetailTabType =
			(await preferenceStorage.getObjectAsync<DetailsTabType>(SELECTED_DETAILS_TAB_KEY)) ??
			'description';

		await this.onWowInstallationsChange(warcraftInstallations.installations);
	}

	async loadAppVersion(): Promise<void> {
		this.appVersion = await invoke<string>(IPC_GET_APP_VERSION);
	}

	// ---- account passthrough ---------------------------------------------------------

	get wowUpAuthToken(): string {
		return wowUpAccount.authToken;
	}

	login = (): void => wowUpAccount.login();
	logout = (): void => wowUpAccount.logout();
	toggleAccountPush = (enabled: boolean): Promise<void> => wowUpAccount.toggleAccountPush(enabled);
	isAuthenticated = (): boolean => wowUpAccount.authenticated;

	// ---- controls / notifications ------------------------------------------------------

	setEnableControls(enabled: boolean): void {
		this.#enableControls = enabled;
	}

	notifyTargetFileInstallComplete = (): void => this.targetFileInstallComplete.emit(true);
	notifyAddonsChanged = (): void => this.addonsChanged.emit(true);
	rescanCompleted = (): void => this.rescanComplete.emit(true);
	requestUpdateAll = (): void => this.updateAllRequested.emit(true);
	autoUpdateComplete = (): void => void (this.autoUpdateCompleteAt = Date.now());

	// ---- details tab --------------------------------------------------------------------

	getSelectedDetailsTab = (): DetailsTabType => this.#selectedDetailTabType;

	async setSelectedDetailsTab(tabType: DetailsTabType): Promise<void> {
		this.#selectedDetailTabType = tabType;
		await preferenceStorage.setAsync(SELECTED_DETAILS_TAB_KEY, tabType);
	}

	// ---- home tab / context text ---------------------------------------------------------

	/**
	 * The footer's per-screen text. The Angular version took a tab index and dropped the write
	 * if it did not match the visible tab, because a hidden tab could still be running an
	 * async callback that finished late. A route component is unmounted when you leave it and
	 * its effects are cleaned up, so the guard has nothing left to guard: callers now own the
	 * value for as long as they are on screen and clear it on the way out.
	 */
	setContextText(text: string): void {
		this.pageContextText = text;
	}

	// ---- installations -----------------------------------------------------------------

	async onWowInstallationsChange(wowInstallations: WowInstallation[]): Promise<void> {
		if (wowInstallations.length === 0) {
			// No WoW found — send the user to Options so they can add one. `replaceState` keeps
			// the redirect out of history, matching the index redirect.
			await goto(href(ROUTES.options), { replaceState: true });
			return;
		}

		let selectedInstall = wowInstallations.find((installation) => installation.selected);
		if (!selectedInstall) {
			selectedInstall = wowInstallations[0];
			if (selectedInstall) await this.setSelectedWowInstallation(selectedInstall.id);
		}

		if (selectedInstall) this.selectedWowInstallation = selectedInstall;
	}

	async setSelectedWowInstallation(installationId: string): Promise<void> {
		if (!installationId) return;

		const installation = warcraftInstallations.getWowInstallation(installationId);
		if (!installation) return;

		await warcraftInstallations.setSelectedWowInstallation(installation);
		this.selectedWowInstallation = installation;
	}

	getSelectedWowInstallation = (): WowInstallation | undefined => this.selectedWowInstallation;
}

export const session = new Session();
