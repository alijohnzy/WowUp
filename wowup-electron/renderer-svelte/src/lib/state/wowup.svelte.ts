// Port of src/app/services/wowup/wowup.service.ts (457 LOC).
//
// Removed: @Injectable + 4-service DI, Subject, Node `path`, lodash (_.find/_.findIndex/_.uniq).
// The constructor did three fire-and-forget async chains at DI time; those become an
// explicit `init()` the layout awaits, so startup ordering is visible.

import {
	ADDON_MIGRATION_VERSION_KEY,
	ADDON_PROVIDERS_KEY,
	COLLAPSE_TO_TRAY_PREFERENCE_KEY,
	CURRENT_THEME_KEY,
	DEFAULT_AUTO_UPDATE_PREFERENCE_KEY_SUFFIX,
	DEFAULT_CHANNEL_PREFERENCE_KEY_SUFFIX,
	DEFAULT_THEME,
	DEFAULT_TRUSTED_DOMAINS,
	ENABLE_APP_BADGE_KEY,
	ENABLE_SYSTEM_NOTIFICATIONS_PREFERENCE_KEY,
	GET_ADDONS_HIDDEN_COLUMNS_KEY,
	GET_ADDONS_SORT_ORDER,
	IPC_APP_CHECK_UPDATE,
	IPC_APP_INSTALL_UPDATE,
	IPC_GET_APP_VERSION,
	IPC_UPDATE_APP_BADGE,
	KEEP_ADDON_DETAIL_TAB_PREFERENCE_KEY,
	MY_ADDONS_HIDDEN_COLUMNS_KEY,
	MY_ADDONS_SORT_ORDER,
	SELECTED_LANGUAGE_PREFERENCE_KEY,
	START_MINIMIZED_PREFERENCE_KEY,
	START_WITH_SYSTEM_PREFERENCE_KEY,
	TRUSTED_DOMAINS_KEY,
	UPDATE_NOTES_POPUP_VERSION_KEY,
	USE_HARDWARE_ACCELERATION_PREFERENCE_KEY,
	USE_SYMLINK_MODE_PREFERENCE_KEY,
	WOWUP_RELEASE_CHANNEL_PREFERENCE_KEY
} from '$common/constants';
import { WowUpReleaseChannelType } from '$common/wowup/wowup-release-channel-type';
import {
	AddonChannelType,
	getEnumList,
	getEnumName,
	WowClientType,
	type AddonProviderType
} from 'wowup-lib-core';
import { invoke, isElectron, isLinux, isMac, isWin, send } from '$lib/ipc';
import { preferenceStorage } from '$lib/services/storage';
import { createDirectory, listEntries, remove, showDirectory } from '$lib/services/files';
import { electron } from '$lib/state/electron.svelte';
import { i18n } from '$lib/i18n.svelte';
import { join } from '$lib/utils/path';

// Imported for use below and re-exported so call sites keep importing them from here, as
// they did from the Angular service.
import type { AddonProviderState } from '$lib/models/addon-provider-state';
import type { ColumnState } from '$lib/models/column-state';
import type { SortOrder } from '$lib/models/sort-order';
import type { PreferenceChange } from '$lib/models/preference-change';

export type { AddonProviderState, ColumnState, SortOrder, PreferenceChange };

const UPDATER_NAME = 'WowUpUpdater.exe';

// Registered in app/app-updater.ts with an inline literal rather than a shared constant.
const IPC_SET_RELEASE_CHANNEL = 'set-release-channel';

class WowUp {
	readonly updaterName = UPDATER_NAME;
	readonly applicationFolderPath: string =
		(typeof window !== 'undefined' && window.userDataPath) || '';
	readonly applicationLogsFolderPath: string =
		(typeof window !== 'undefined' && window.logPath) || '';
	readonly applicationDownloadsFolderPath: string = join(this.applicationFolderPath, 'downloads');
	readonly applicationUpdaterPath: string = join(this.applicationFolderPath, UPDATER_NAME);
	readonly wtfBackupFolder: string = join(this.applicationFolderPath, 'wtf_backups');

	availableVersion = $state('');

	#preferenceListeners = new Set<(c: PreferenceChange) => void>();

	onPreferenceChange(fn: (c: PreferenceChange) => void): () => void {
		this.#preferenceListeners.add(fn);
		return () => this.#preferenceListeners.delete(fn);
	}

	#emitPreferenceChange(key: string, value: string): void {
		for (const fn of this.#preferenceListeners) fn({ key, value });
	}

	/** Replaces three fire-and-forget chains in the Angular constructor. */
	async init(): Promise<void> {
		if (!isElectron()) return;
		await this.setDefaultClientPreferences().catch(console.error);
		await this.createDownloadDirectory()
			.then(() => this.cleanupDownloads())
			.catch((e: unknown) => console.error('Failed to create download directory', e));
		await this.setAutoStartup().catch((e: unknown) => console.error(e));
	}

	async getApplicationVersion(): Promise<string> {
		const appVersion = await invoke<string>(IPC_GET_APP_VERSION);
		const isPortable =
			typeof window !== 'undefined' &&
			!!(window as { process?: { env?: Record<string, string> } }).process?.env
				?.PORTABLE_EXECUTABLE_DIR;
		return `${appVersion}${isPortable ? ' (portable)' : ''}`;
	}

	async isBetaBuild(): Promise<boolean> {
		return (await this.getApplicationVersion()).toLowerCase().includes('beta');
	}

	/** Runs before the app renders, so an unsupported saved locale cannot break startup. */
	async initializeLanguage(): Promise<void> {
		console.log('Language setup start');
		const currentLang = await this.getCurrentLanguage();
		const langCode = currentLang || (await invoke<string>('get-locale'));

		try {
			await i18n.load(langCode);
			console.log(`using locale ${langCode}`);
			await this.setCurrentLanguage(langCode);
		} catch {
			console.warn(`Language ${langCode} not found defaulting to english`);
			await i18n.load('en');
			await this.setCurrentLanguage('en');
		}
		console.log('Language setup complete');
	}

	// ---- simple preference pairs -------------------------------------------------

	async #getBoolPref(key: string, fallback = false): Promise<boolean> {
		const pref = await preferenceStorage.getAsync(key);
		return pref === undefined || pref === null ? fallback : pref === 'true';
	}

	async #setPref(key: string, value: unknown): Promise<void> {
		await preferenceStorage.setAsync(key, value);
		this.#emitPreferenceChange(key, String(value));
	}

	getCollapseToTray = (): Promise<boolean> => this.#getBoolPref(COLLAPSE_TO_TRAY_PREFERENCE_KEY);
	setCollapseToTray = (v: boolean): Promise<void> =>
		this.#setPref(COLLAPSE_TO_TRAY_PREFERENCE_KEY, v);

	async getCurrentTheme(): Promise<string> {
		return (await preferenceStorage.getAsync(CURRENT_THEME_KEY)) || DEFAULT_THEME;
	}
	setCurrentTheme = (v: string): Promise<void> => this.#setPref(CURRENT_THEME_KEY, v);

	getUseHardwareAcceleration = (): Promise<boolean> =>
		this.#getBoolPref(USE_HARDWARE_ACCELERATION_PREFERENCE_KEY, true);
	setUseHardwareAcceleration = (v: boolean): Promise<void> =>
		this.#setPref(USE_HARDWARE_ACCELERATION_PREFERENCE_KEY, v);

	getUseSymlinkMode = (): Promise<boolean> => this.#getBoolPref(USE_SYMLINK_MODE_PREFERENCE_KEY);
	setUseSymlinkMode = (v: boolean): Promise<void> =>
		this.#setPref(USE_SYMLINK_MODE_PREFERENCE_KEY, v);

	async getCurrentLanguage(): Promise<string> {
		return (await preferenceStorage.getAsync(SELECTED_LANGUAGE_PREFERENCE_KEY)) || '';
	}
	setCurrentLanguage = (v: string): Promise<void> =>
		this.#setPref(SELECTED_LANGUAGE_PREFERENCE_KEY, v);

	getStartWithSystem = (): Promise<boolean> => this.#getBoolPref(START_WITH_SYSTEM_PREFERENCE_KEY);
	async setStartWithSystem(v: boolean): Promise<void> {
		await this.#setPref(START_WITH_SYSTEM_PREFERENCE_KEY, v);
		await this.setAutoStartup();
	}

	getStartMinimized = (): Promise<boolean> => this.#getBoolPref(START_MINIMIZED_PREFERENCE_KEY);
	async setStartMinimized(v: boolean): Promise<void> {
		await this.#setPref(START_MINIMIZED_PREFERENCE_KEY, v);
		await this.setAutoStartup();
	}

	getKeepLastAddonDetailTab = (): Promise<boolean> =>
		this.#getBoolPref(KEEP_ADDON_DETAIL_TAB_PREFERENCE_KEY);
	setKeepLastAddonDetailTab = (v: boolean): Promise<void> =>
		this.#setPref(KEEP_ADDON_DETAIL_TAB_PREFERENCE_KEY, v);

	getEnableSystemNotifications = (): Promise<boolean> =>
		preferenceStorage.getBool(ENABLE_SYSTEM_NOTIFICATIONS_PREFERENCE_KEY);
	setEnableSystemNotifications = (v: boolean): Promise<void> =>
		preferenceStorage.setAsync(ENABLE_SYSTEM_NOTIFICATIONS_PREFERENCE_KEY, v);

	getEnableAppBadge = (): Promise<boolean> => preferenceStorage.getBool(ENABLE_APP_BADGE_KEY);
	setEnableAppBadge = (v: boolean): Promise<void> =>
		preferenceStorage.setAsync(ENABLE_APP_BADGE_KEY, v);

	async getWowUpReleaseChannel(): Promise<WowUpReleaseChannelType> {
		const preference = await preferenceStorage.getAsync(WOWUP_RELEASE_CHANNEL_PREFERENCE_KEY);
		return preference
			? (parseInt(preference, 10) as WowUpReleaseChannelType)
			: await this.getDefaultReleaseChannel();
	}
	/**
	 * The preference alone does nothing — electron-updater decides whether to offer a
	 * pre-release from its own `allowPrerelease` flag, which lives in the main process. This
	 * port only wrote the preference, so switching to the beta channel had no effect on what
	 * the updater actually fetched.
	 */
	async setWowUpReleaseChannel(releaseChannel: WowUpReleaseChannelType): Promise<void> {
		try {
			await invoke(IPC_SET_RELEASE_CHANNEL, releaseChannel);
		} catch (e) {
			console.error('Failed to set the updater release channel', e);
		}
		await preferenceStorage.setAsync(WOWUP_RELEASE_CHANNEL_PREFERENCE_KEY, releaseChannel);
	}

	// ---- addon provider state ----------------------------------------------------

	async getAddonProviderStates(): Promise<AddonProviderState[]> {
		return (
			(await preferenceStorage.getObjectAsync<AddonProviderState[]>(ADDON_PROVIDERS_KEY)) ?? []
		);
	}

	async getAddonProviderState(providerName: string): Promise<AddonProviderState | undefined> {
		const prefs = await this.getAddonProviderStates();
		return prefs.find((pref) => pref.providerName === providerName.toLowerCase());
	}

	async setAddonProviderState(state: AddonProviderState): Promise<void> {
		const stateCpy = {
			...state,
			providerName: state.providerName.toLowerCase() as AddonProviderType
		};
		const prefs = await this.getAddonProviderStates();
		const idx = prefs.findIndex((pref) => pref.providerName === stateCpy.providerName);

		if (idx === -1) prefs.push(stateCpy);
		else prefs[idx] = stateCpy;

		await preferenceStorage.setAsync(ADDON_PROVIDERS_KEY, prefs);
		this.#emitPreferenceChange(ADDON_PROVIDERS_KEY, prefs.toString());
	}

	// ---- grid column / sort state ------------------------------------------------

	async getMyAddonsHiddenColumns(): Promise<ColumnState[]> {
		return (
			(await preferenceStorage.getObjectAsync<ColumnState[]>(MY_ADDONS_HIDDEN_COLUMNS_KEY)) ?? []
		);
	}
	setMyAddonsHiddenColumns = (c: ColumnState[]): Promise<void> =>
		preferenceStorage.setAsync(MY_ADDONS_HIDDEN_COLUMNS_KEY, c);

	async getMyAddonsSortOrder(): Promise<SortOrder[]> {
		return (await preferenceStorage.getObjectAsync<SortOrder[]>(MY_ADDONS_SORT_ORDER)) ?? [];
	}
	setMyAddonsSortOrder = (s: SortOrder[]): Promise<void> =>
		preferenceStorage.setAsync(MY_ADDONS_SORT_ORDER, s);

	async getGetAddonsHiddenColumns(): Promise<ColumnState[]> {
		return (
			(await preferenceStorage.getObjectAsync<ColumnState[]>(GET_ADDONS_HIDDEN_COLUMNS_KEY)) ?? []
		);
	}
	setGetAddonsHiddenColumns = (c: ColumnState[]): Promise<void> =>
		preferenceStorage.setAsync(GET_ADDONS_HIDDEN_COLUMNS_KEY, c);

	getAddonsSortOrder = (): Promise<SortOrder | undefined> =>
		preferenceStorage.getObjectAsync<SortOrder>(GET_ADDONS_SORT_ORDER);

	getClientDefaultAddonChannelKey(clientType: WowClientType): string {
		return `${getEnumName(WowClientType, clientType)}${DEFAULT_CHANNEL_PREFERENCE_KEY_SUFFIX}`.toLowerCase();
	}

	// ---- app update / badge ------------------------------------------------------

	async updateAppBadgeCount(count: number): Promise<void> {
		if (count > 0 && !(await this.getEnableAppBadge())) {
			console.debug('app badge disabled');
			return;
		}
		console.debug('Update app badge', count);
		await invoke(IPC_UPDATE_APP_BADGE, count);
	}

	async shouldShowNewVersionNotes(): Promise<boolean> {
		const popupVersion = await preferenceStorage.getAsync(UPDATE_NOTES_POPUP_VERSION_KEY);
		return popupVersion !== (await invoke<string>(IPC_GET_APP_VERSION));
	}

	async setNewVersionNotes(): Promise<void> {
		await preferenceStorage.setAsync(
			UPDATE_NOTES_POPUP_VERSION_KEY,
			await invoke<string>(IPC_GET_APP_VERSION)
		);
	}

	async shouldMigrateAddons(): Promise<boolean> {
		const migrateVersion = await preferenceStorage.getAsync(ADDON_MIGRATION_VERSION_KEY);
		return migrateVersion !== (await invoke<string>(IPC_GET_APP_VERSION));
	}

	async setMigrationVersion(): Promise<void> {
		await preferenceStorage.setAsync(
			ADDON_MIGRATION_VERSION_KEY,
			await invoke<string>(IPC_GET_APP_VERSION)
		);
	}

	showLogsFolder = (): Promise<string> => showDirectory(this.applicationLogsFolderPath);
	showConfigFolder = (): Promise<string> => showDirectory(this.applicationFolderPath);

	checkForAppUpdate = (): void => send(IPC_APP_CHECK_UPDATE);
	installUpdate = (): void => send(IPC_APP_INSTALL_UPDATE);

	async isSameVersion(updateCheckResult: { updateInfo?: { version?: string } }): Promise<boolean> {
		const appVersion = await invoke<string>(IPC_GET_APP_VERSION);
		return !!updateCheckResult && updateCheckResult.updateInfo?.version === appVersion;
	}

	// ---- trusted domains ---------------------------------------------------------

	async getTrustedDomains(): Promise<string[]> {
		return (await preferenceStorage.getObjectAsync<string[]>(TRUSTED_DOMAINS_KEY)) ?? [];
	}

	async isTrustedDomain(href: string | URL, domains?: string[]): Promise<boolean> {
		const url = href instanceof URL ? href : new URL(href);
		if (DEFAULT_TRUSTED_DOMAINS.includes(url.hostname)) return true;
		return (domains ?? (await this.getTrustedDomains())).includes(url.hostname);
	}

	async trustDomain(domain: string): Promise<void> {
		const trusted = await this.getTrustedDomains();
		// lodash uniq -> Set
		await preferenceStorage.setAsync(TRUSTED_DOMAINS_KEY, [...new Set([...trusted, domain])]);
	}

	// ---- startup housekeeping ----------------------------------------------------

	private async setDefaultPreference(key: string, defaultValue: unknown): Promise<void> {
		const pref = await preferenceStorage.getAsync(key);
		if (pref === null || pref === undefined) {
			await preferenceStorage.setAsync(
				key,
				Array.isArray(defaultValue) ? defaultValue : String(defaultValue)
			);
		}
	}

	private getClientDefaultAutoUpdateKey(clientType: WowClientType): string {
		return `${getEnumName(WowClientType, clientType)}${DEFAULT_AUTO_UPDATE_PREFERENCE_KEY_SUFFIX}`.toLowerCase();
	}

	private async setDefaultClientPreferences(): Promise<void> {
		const keys = getEnumList<WowClientType>(WowClientType).filter((k) => k !== WowClientType.None);
		for (const key of keys) {
			await this.setDefaultPreference(
				this.getClientDefaultAddonChannelKey(key),
				AddonChannelType.Stable
			);
			await this.setDefaultPreference(this.getClientDefaultAutoUpdateKey(key), false);
		}
	}

	private async getDefaultReleaseChannel(): Promise<WowUpReleaseChannelType> {
		return (await this.isBetaBuild())
			? WowUpReleaseChannelType.Beta
			: WowUpReleaseChannelType.Stable;
	}

	/** Remove abandoned partial downloads. */
	private async cleanupDownloads(): Promise<void> {
		const downloadFiles = await listEntries(this.applicationDownloadsFolderPath, '*');
		for (const entry of downloadFiles) {
			const p = join(this.applicationDownloadsFolderPath, entry.name);
			try {
				await remove(p);
			} catch (e) {
				console.error('Failed to delete download entry', p);
				console.error(e);
			}
		}
	}

	private async createDownloadDirectory(): Promise<void> {
		await createDirectory(this.applicationDownloadsFolderPath);
	}

	private async setAutoStartup(): Promise<void> {
		const startMinimized = await this.getStartMinimized();
		const startWithSystem = await this.getStartWithSystem();

		if (isLinux()) {
			// auto-launch comes through the preload bridge (window.libs), same as before.
			const libs = (window as { libs?: { autoLaunch?: new (o: unknown) => unknown } }).libs;
			if (!libs?.autoLaunch) return;
			const autoLauncher = new libs.autoLaunch({ name: 'WowUp', isHidden: startMinimized }) as {
				enable: () => void;
				disable: () => void;
			};
			if (startWithSystem) autoLauncher.enable();
			else autoLauncher.disable();
		} else {
			await electron.setLoginItemSettings({
				openAtLogin: startWithSystem,
				openAsHidden: isMac() ? startMinimized : false,
				args: isWin() ? (startMinimized ? ['--hidden'] : []) : []
			});
		}
	}
}

export const wowup = new WowUp();
