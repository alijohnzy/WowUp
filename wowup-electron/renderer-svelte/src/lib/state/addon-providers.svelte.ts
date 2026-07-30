// Port of src/app/services/addons/addon.provider.factory.ts (312 LOC).
//
// Because every provider now constructs itself from module imports rather than injected
// instances, the factory's eleven constructor dependencies and eleven create* methods
// collapse to a list. That is the clearest single illustration of what removing Angular DI
// buys in this codebase.

import { ADDON_PROVIDER_UNKNOWN, WAGO_PROMPT_KEY } from '$common/constants';
import { AppConfig } from '$config/environment';
import {
	AddonProvider,
	TukUiAddonProvider,
	WowInterfaceAddonProvider,
	WowUpAddonProvider,
	type AddonProviderType
} from 'wowup-lib-core';
import { CurseAddonProvider } from '$lib/addon-providers/curse-addon-provider';
import { GitHubAddonProvider } from '$lib/addon-providers/github-addon-provider';
import { RaiderIoAddonProvider } from '$lib/addon-providers/raiderio-provider';
import { WagoAddonProvider } from '$lib/addon-providers/wago-addon-provider';
import { WowUpCompanionAddonProvider } from '$lib/addon-providers/wowup-companion-addon-provider';
import { ZipAddonProvider } from '$lib/addon-providers/zip-provider';
import { getCircuitBreaker } from '$lib/services/network';
import { GenericNetworkInterface } from '$lib/services/network-interface';
import { preferenceStorage } from '$lib/services/storage';
import { wowup, type AddonProviderState } from '$lib/state/wowup.svelte';

const netInterface = (name: string) =>
	new GenericNetworkInterface(
		getCircuitBreaker(name, AppConfig.defaultHttpResetTimeoutMs, AppConfig.wowUpHubHttpTimeoutMs)
	);

class AddonProviders {
	/** Bumped whenever a provider's enabled flag changes, so $derived readers re-run. */
	revision = $state(0);

	#providerMap = new Map<string, AddonProvider>();
	#changeListeners = new Set<(p: AddonProvider) => void>();

	onProviderChange(fn: (p: AddonProvider) => void): () => void {
		this.#changeListeners.add(fn);
		return () => this.#changeListeners.delete(fn);
	}

	/** Was an APP_INITIALIZER; now awaited from the root layout. Idempotent. */
	async loadProviders(): Promise<void> {
		if (this.#providerMap.size !== 0) return;

		const providers: AddonProvider[] = [
			new ZipAddonProvider(),
			new RaiderIoAddonProvider(),
			new WowUpCompanionAddonProvider(),
			new WowUpAddonProvider(
				AppConfig.wowUpHubUrl,
				AppConfig.wowUpWebsiteUrl,
				netInterface('wowup_addon_provider')
			)
		];

		if (AppConfig.wago.enabled) providers.push(new WagoAddonProvider());
		if (AppConfig.curseforge.enabled) providers.push(new CurseAddonProvider());

		providers.push(
			new TukUiAddonProvider(netInterface('tukui_provider')),
			new WowInterfaceAddonProvider(netInterface('wow_interface_provider')),
			new GitHubAddonProvider()
		);

		for (const provider of providers) {
			const state = await wowup.getAddonProviderState(provider.name);
			if (state) provider.enabled = state.enabled;
			this.#providerMap.set(provider.name, provider);
		}

		this.revision++;
	}

	async shouldShowConsentDialog(): Promise<boolean> {
		if (!AppConfig.wago.enabled) return false;
		return (await preferenceStorage.getAsync(WAGO_PROMPT_KEY)) === undefined;
	}

	updateWagoConsent = (): Promise<void> => preferenceStorage.setAsync(WAGO_PROMPT_KEY, true);

	async setProviderEnabled(type: AddonProviderType, enabled: boolean): Promise<void> {
		const provider = this.#providerMap.get(type);
		if (!provider) throw new Error(`cannot set provider state, not found: ${type}`);
		if (!provider.allowEdit) throw new Error(`this provider is not editable: ${type}`);

		await wowup.setAddonProviderState({ providerName: type, enabled, canEdit: true });

		provider.enabled = enabled;
		this.revision++;
		for (const fn of this.#changeListeners) fn(provider);
	}

	getProvider<T = AddonProvider>(providerName: string): T | undefined {
		if (!providerName) return undefined;
		return this.#providerMap.get(providerName) as T | undefined;
	}

	hasProvider = (providerName: string): boolean => this.#providerMap.has(providerName);

	getAddonProviderForUri(addonUri: URL): AddonProvider | undefined {
		for (const ap of this.#providerMap.values()) {
			if (ap.isValidAddonUri(addonUri)) return ap;
		}
		return undefined;
	}

	#where(predicate: (ap: AddonProvider) => boolean): AddonProvider[] {
		void this.revision; // re-run when a provider is toggled
		return [...this.#providerMap.values()].filter(predicate);
	}

	getEnabledAddonProviders = (): AddonProvider[] => this.#where((ap) => ap.enabled);
	getBatchAddonProviders = (): AddonProvider[] =>
		this.#where((ap) => ap.enabled && ap.canBatchFetch);
	getStandardAddonProviders = (): AddonProvider[] =>
		this.#where((ap) => ap.enabled && !ap.canBatchFetch);
	getAdRequiredProviders = (): AddonProvider[] => this.#where((ap) => ap.enabled && ap.adRequired);

	getAddonProviderStates(): AddonProviderState[] {
		void this.revision;
		return [...this.#providerMap.values()].map((ap) => ({
			providerName: ap.name as AddonProviderType,
			enabled: ap.enabled,
			canEdit: ap.allowEdit
		}));
	}

	canShowChangelog = (providerName: string | undefined): boolean =>
		providerName === undefined
			? false
			: (this.getProvider(providerName)?.canShowChangelog ?? false);

	isForceIgnore(providerName: string): boolean {
		const provider = this.getProvider(providerName);
		if (!provider) return false;
		return providerName === ADDON_PROVIDER_UNKNOWN || (provider.forceIgnore ?? false);
	}

	canReinstall(providerName: string): boolean {
		const provider = this.getProvider(providerName);
		if (!provider) return false;
		return providerName !== ADDON_PROVIDER_UNKNOWN && (provider.allowReinstall ?? false);
	}

	canChangeChannel(providerName: string): boolean {
		const provider = this.getProvider(providerName);
		if (!provider) return false;
		return providerName !== ADDON_PROVIDER_UNKNOWN && (provider.allowChannelChange ?? false);
	}
}

export const addonProviders = new AddonProviders();
