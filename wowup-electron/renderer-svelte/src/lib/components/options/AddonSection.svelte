<script lang="ts">
	// Port of components/options/options-addon-section (267 LOC).
	//
	// The Angular version built a FormGroup of three UntypedFormControls and piped
	// `valueChanges` through takeUntil/debounceTime/switchMap/zip/catchError to persist them.
	// Here the three fields are $state and one debounced $effect writes them — the
	// `zip([...tasks])` that assembled a variable-length observable array disappears.

	import {
		ADDON_PROVIDER_WAGO,
		PREF_GITHUB_PERSONAL_ACCESS_TOKEN,
		PREF_WAGO_ACCESS_KEY
	} from '$common/constants';
	import { AppConfig } from '$config/environment';
	import { t, i18n } from '$lib/i18n.svelte';
	import type { AddonProviderState } from '$lib/models/addon-provider-state';
	import { sensitiveStorage } from '$lib/services/storage';
	import { useDebounce } from 'runed';
	import Toggle from '$lib/components/common/Toggle.svelte';
	import { addonProviders } from '$lib/state/addon-providers.svelte';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import type { AddonProviderType } from 'wowup-lib-core';

	interface ProviderStateModel extends AddonProviderState {
		adRequired: boolean;
		providerNote?: string;
	}

	let ghPersonalAccessToken = $state('');
	let wagoAccessToken = $state('');

	let providerStates = $derived<ProviderStateModel[]>(
		addonProviders
			.getAddonProviderStates()
			.filter((state) => state.canEdit)
			.map((state) => {
				const provider = addonProviders.getProvider(state.providerName);
				if (provider === undefined) throw new Error('loadProviderStates got undefined provider');
				return { ...state, adRequired: provider.adRequired, providerNote: provider.providerNote };
			})
	);

	$effect(() => {
		void (async () => {
			try {
				ghPersonalAccessToken =
					(await sensitiveStorage.getAsync(PREF_GITHUB_PERSONAL_ACCESS_TOKEN)) ?? '';
				wagoAccessToken = (await sensitiveStorage.getAsync(PREF_WAGO_ACCESS_KEY)) ?? '';
			} catch (e) {
				console.error(e);
			}
		})();
	});

	async function persistTokens(gh: string, wago: string) {
		try {
			await sensitiveStorage.setAsync(PREF_GITHUB_PERSONAL_ACCESS_TOKEN, gh);
			await onWagoAccessTokenChange(wago);
		} catch (e) {
			console.error(e);
		}
	}

	/**
	 * Called from the inputs, not from an $effect.
	 *
	 * This used to be an effect reading both tokens and calling the debounced writer. That was
	 * safe with a hand-rolled setTimeout debounce and became an infinite loop the moment it was
	 * swapped for runed's `useDebounce`, which keeps its timer in `$state`: calling it wrote that
	 * state and the teardown's `cancel()` wrote it again, so the effect invalidated itself.
	 * Svelte caught it as effect_update_depth_exceeded and the renderer stopped responding —
	 * every button in the app, since one runaway effect starves the whole scheduler.
	 *
	 * Persisting a token is a response to typing, not a projection of state, so the event handler
	 * is where it belongs. It also drops the `loaded` guard that existed only to suppress the
	 * write the initial load would otherwise trigger.
	 */
	const persistDebounced = useDebounce(
		(gh: string, wago: string) => void persistTokens(gh, wago),
		300
	);

	const onTokenInput = () => void persistDebounced(ghPersonalAccessToken, wagoAccessToken);

	async function onWagoAccessTokenChange(accessToken: string) {
		await sensitiveStorage.setAsync(PREF_WAGO_ACCESS_KEY, accessToken);

		const wago = addonProviders.getProvider(ADDON_PROVIDER_WAGO);
		if (wago === undefined) {
			console.warn('onWagoAccessTokenChange failed to find wago provider');
			return;
		}

		// A short or missing key means the ad-supported path is still required.
		wago.adRequired = accessToken === undefined || accessToken.length <= 20;
		await addonProviders.setProviderEnabled(ADDON_PROVIDER_WAGO as AddonProviderType, wago.enabled);
	}

	async function onProviderToggle(state: ProviderStateModel, enabled: boolean) {
		// Enabling Wago requires accepting its terms first; declining reverts the toggle.
		if (AppConfig.wago.enabled && enabled && state.providerName === ADDON_PROVIDER_WAGO) {
			const confirmed = await dialogs.confirm({
				title: t('DIALOGS.PERMISSIONS.WAGO.TOGGLE_LABEL'),
				message: i18n.t('DIALOGS.PERMISSIONS.WAGO.DESCRIPTION', {
					termsUrl: AppConfig.wago.termsUrl,
					dataUrl: AppConfig.wago.dataConsentUrl
				})
			});
			if (!confirmed) return;
		}

		await addonProviders.setProviderEnabled(state.providerName, enabled);
	}
</script>

<div class="container">
	<h2>{t('PAGES.OPTIONS.ADDON.TITLE')}</h2>

	<div class="section">
		<div>{t('PAGES.OPTIONS.ADDON.ENABLED_PROVIDERS.FIELD_LABEL')}</div>
		<small class="text-2">{t('PAGES.OPTIONS.ADDON.ENABLED_PROVIDERS.DESCRIPTION')}</small>

		<ul class="provider-list bg-secondary-3">
			{#each providerStates as state (state.providerName)}
				<li>
					<Toggle
						checked={state.enabled}
						onCheckedChange={(checked) => void onProviderToggle(state, checked)}
					>
						{state.providerName}
						{#if state.adRequired}
							<span class="text-3">- {t('PAGES.OPTIONS.ADDON.AD_REQUIRED_HINT')}</span>
						{/if}
						{#if state.providerNote}
							<span class="text-3">- {t(state.providerNote)}</span>
						{/if}
					</Toggle>
				</li>
			{/each}
		</ul>
	</div>

	<div class="divider"></div>

	<div class="setting">
		<div class="grow">
			<div>{t('PAGES.OPTIONS.ADDON.GITHUB_PERSONAL_ACCESS_TOKEN.TITLE')}</div>
			<small class="text-2">
				<!-- Translation contains a link to GitHub's token docs. -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html t('PAGES.OPTIONS.ADDON.GITHUB_PERSONAL_ACCESS_TOKEN.MESSAGE')}
			</small>
		</div>
		<label class="field">
			<span class="field-label">
				{t('PAGES.OPTIONS.ADDON.GITHUB_PERSONAL_ACCESS_TOKEN.PLACEHOLDER')}
			</span>
			<input type="password" bind:value={ghPersonalAccessToken} oninput={onTokenInput} />
		</label>
	</div>

	{#if AppConfig.wago.enabled}
		<div class="setting">
			<div class="grow">
				<div>{t('PAGES.OPTIONS.ADDON.WAGO_ACCESS_KEY.TITLE')}</div>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<small class="text-2">{@html t('PAGES.OPTIONS.ADDON.WAGO_ACCESS_KEY.MESSAGE')}</small>
			</div>
			<label class="field">
				<span class="field-label">{t('PAGES.OPTIONS.ADDON.WAGO_ACCESS_KEY.PLACEHOLDER')}</span>
				<input type="password" bind:value={wagoAccessToken} oninput={onTokenInput} />
			</label>
		</div>
	{/if}
</div>

<style>
	.container {
		padding: 1rem;
		overflow-y: auto;
		height: 100%;
	}

	h2 {
		margin-top: 0;
	}

	.section {
		margin-bottom: 1rem;
	}

	.provider-list {
		list-style: none;
		margin: 0.75rem 0 0;
		padding: 0.5rem;
		border-radius: 4px;
	}

	.provider-list li {
		padding: 0.4rem 0;
	}

	.divider {
		margin: 1rem 0;
		border-top: 1px solid var(--overlay-selected);
	}

	.setting {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.grow {
		flex: 1;
	}

	.field {
		display: block;
		min-width: 220px;
	}

	.field-label {
		display: block;
		font-size: 0.75rem;
		opacity: 0.8;
		margin-bottom: 0.2rem;
	}

	input {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--overlay-border);
		background: var(--overlay-subtle);
		color: inherit;
		font: inherit;
	}

	.text-3 {
		opacity: 0.6;
	}
</style>
