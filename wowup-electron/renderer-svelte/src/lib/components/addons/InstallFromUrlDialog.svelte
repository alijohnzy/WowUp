<script lang="ts">
	// Port of components/addons/install-from-url-dialog (378 LOC).
	//
	// Removed: the install Subscription + ngOnDestroy, MatFormField/MatSpinner, and the
	// injected DownloadCountPipe (a pipe injected as a service so its transform could be
	// called from TypeScript — now just a function).

	import { AssetMissingError, GitHubLimitError, NoReleaseFoundError } from '$lib/errors';
	import { HttpError } from '$lib/services/network';
	import { NO_SEARCH_RESULTS_ERROR } from '$common/constants';
	import { t, i18n } from '$lib/i18n.svelte';
	import { downloadCount } from '$lib/utils/format';
	import { roundDownloadCount, shortenDownloadCount } from '$lib/utils/misc';
	import Icon from '$lib/components/common/Icon.svelte';
	import Modal from '$lib/components/common/Modal.svelte';
	import ProgressSpinner from '$lib/components/common/ProgressSpinner.svelte';
	import { addonService } from '$lib/state/addon.svelte';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { session } from '$lib/state/session.svelte';
	import { WowClientGroup, type AddonSearchResult, type SearchByUrlResult } from 'wowup-lib-core';

	interface Props {
		onclose?: () => void;
	}

	let { onclose }: Props = $props();

	const ASSET_MISSING_DEFAULT_KEY = 'DIALOGS.INSTALL_FROM_URL.ERROR.ASSET_NOT_FOUND';
	// Retail and anything unrecognised fall back to ASSET_MISSING_DEFAULT_KEY.
	const ASSET_MISSING_KEYS: Partial<Record<WowClientGroup, string>> = {
		[WowClientGroup.BurningCrusade]:
			'DIALOGS.INSTALL_FROM_URL.ERROR.BURNING_CRUSADE_ASSET_NOT_FOUND',
		[WowClientGroup.Classic]: 'DIALOGS.INSTALL_FROM_URL.ERROR.CLASSIC_ASSET_NOT_FOUND',
		[WowClientGroup.WOTLK]: 'DIALOGS.INSTALL_FROM_URL.ERROR.WRATH_ASSET_NOT_FOUND',
		[WowClientGroup.Cata]: 'DIALOGS.INSTALL_FROM_URL.ERROR.CATACLYSM_ASSET_NOT_FOUND',
		[WowClientGroup.Mists]: 'DIALOGS.INSTALL_FROM_URL.ERROR.MISTS_ASSET_NOT_FOUND'
	};

	let query = $state('');
	let isBusy = $state(false);
	let addon = $state<AddonSearchResult | undefined>(undefined);
	let showInstallButton = $state(false);
	let showInstallSpinner = $state(false);
	let showInstallSuccess = $state(false);

	let hasThumbnail = $derived(!!addon?.thumbnailUrl);
	let thumbnailLetter = $derived(addon?.name?.charAt(0).toUpperCase() ?? '');

	let downloadCountLabel = $derived.by(() => {
		const count = addon?.downloadCount ?? 0;
		return i18n.t('DIALOGS.INSTALL_FROM_URL.DOWNLOAD_COUNT', {
			count,
			shortCount: roundDownloadCount(count),
			simpleCount: shortenDownloadCount(count, 1),
			myriadCount: shortenDownloadCount(count, 4),
			textCount: downloadCount(count),
			provider: addon?.providerName ?? ''
		});
	});

	async function showError(message: string, title?: string) {
		await dialogs.alert({
			title: title || t('DIALOGS.INSTALL_FROM_URL.ERROR.TITLE'),
			message,
			positiveButtonStyle: 'raised'
		});
	}

	/**
	 * The original mapped each failure mode to its own message; this port showed the raw
	 * `err.message`, so a rate-limited GitHub read or a missing Classic asset both surfaced as
	 * developer text. `HttpError` stands in for Angular's `HttpErrorResponse`.
	 */
	function errorMessage(err: unknown): string {
		if (err instanceof HttpError) {
			return t('DIALOGS.INSTALL_FROM_URL.ERROR.NO_ADDON_FOUND');
		}

		// Provider circuit breaker is open.
		if ((err as { code?: string })?.code === 'EOPENBREAKER') {
			return t('DIALOGS.INSTALL_FROM_URL.ERROR.FAILED_TO_CONNECT');
		}

		const message = err instanceof Error ? err.message : String(err);
		if (message === NO_SEARCH_RESULTS_ERROR) {
			return t('DIALOGS.INSTALL_FROM_URL.ERROR.NO_SEARCH_RESULTS');
		}

		if (err instanceof AssetMissingError) {
			const key = err.clientGroup ? ASSET_MISSING_KEYS[err.clientGroup] : undefined;
			return i18n.t(key ?? ASSET_MISSING_DEFAULT_KEY, { message });
		}

		if (err instanceof NoReleaseFoundError) {
			return i18n.t('DIALOGS.INSTALL_FROM_URL.ERROR.NO_RELEASE_FOUND', { message });
		}

		if (err instanceof GitHubLimitError) {
			return i18n.t('COMMON.ERRORS.GITHUB_LIMIT_ERROR', {
				max: err.rateLimitMax,
				reset: new Date(err.rateLimitReset * 1000).toLocaleString()
			});
		}

		return message;
	}

	function getUrlFromQuery(): URL | undefined {
		try {
			return new URL(query);
		} catch {
			console.error(`Invalid url: ${query}`);
			void showError(t('DIALOGS.INSTALL_FROM_URL.ERROR.INVALID_URL'));
			return undefined;
		}
	}

	async function handleImportErrors(result: SearchByUrlResult) {
		for (const error of result.errors ?? []) {
			if (error instanceof AssetMissingError) {
				await showError(
					i18n.t('DIALOGS.INSTALL_FROM_URL.IMPORT_ASSET_WARNING', {
						zipName: result.searchResult?.files?.[0]?.version ?? ''
					}),
					t('DIALOGS.INSTALL_FROM_URL.IMPORT_WARNING_TITLE')
				);
			}
		}
	}

	async function onImportUrl() {
		addon = undefined;
		showInstallSuccess = false;
		showInstallSpinner = false;
		showInstallButton = false;

		if (!query) return;

		const url = getUrlFromQuery();
		if (!url) return;

		isBusy = true;
		try {
			const installation = session.getSelectedWowInstallation();
			if (!installation) throw new Error('Selected installation not found');

			const result = await addonService.getAddonByUrl(url, installation);
			const searchResult = result?.searchResult;
			if (!searchResult) throw new Error('Addon not found');

			addon = searchResult;

			// The original checked this before offering the button, so an addon you already have
			// shows the success state rather than inviting a duplicate install.
			const alreadyInstalled = await addonService.isInstalled(
				searchResult.externalId,
				searchResult.providerName,
				installation
			);

			await handleImportErrors(result);

			showInstallSuccess = alreadyInstalled;
			showInstallButton = !alreadyInstalled;
		} catch (e) {
			console.error(e);
			await showError(errorMessage(e));
		} finally {
			isBusy = false;
		}
	}

	function onClearSearch() {
		query = '';
		void onImportUrl();
	}

	async function onInstall() {
		const installation = session.getSelectedWowInstallation();
		if (!installation || !addon) return;

		const addonFile = Array.isArray(addon.files) ? addon.files[0] : undefined;
		if (addonFile === undefined) {
			console.error('addon file was undefined, nothing to install');
			await showError(t('DIALOGS.INSTALL_FROM_URL.ERROR.INSTALL_FAILED'));
			return;
		}

		showInstallButton = false;
		showInstallSpinner = true;

		try {
			await addonService.installPotentialAddon(addon, installation, undefined, addonFile);
			showInstallSuccess = true;
		} catch (err) {
			console.error(err);
			showInstallButton = true;
			await showError(t('DIALOGS.INSTALL_FROM_URL.ERROR.INSTALL_FAILED'));
		} finally {
			showInstallSpinner = false;
		}
	}
</script>

<Modal title={t('DIALOGS.INSTALL_FROM_URL.TITLE')} {onclose}>
	<p class="m-0">{t('DIALOGS.INSTALL_FROM_URL.DESCRIPTION')}</p>
	<p>{t('DIALOGS.INSTALL_FROM_URL.SUPPORTED_SOURCES')}</p>

	<label class="url-input-container">
		<span class="field-label">{t('DIALOGS.INSTALL_FROM_URL.ADDON_URL_INPUT_LABEL')}</span>
		<div class="input-row">
			<input
				bind:value={query}
				placeholder={t('DIALOGS.INSTALL_FROM_URL.ADDON_URL_INPUT_PLACEHOLDER')}
				disabled={isBusy}
				onkeyup={(e) => {
					if (e.key === 'Enter') void onImportUrl();
				}}
			/>
			{#if query}
				<button
					class="wu-btn wu-btn-icon"
					aria-label="Clear"
					disabled={isBusy}
					onclick={onClearSearch}
				>
					<Icon name="fas:xmark" />
				</button>
			{/if}
		</div>
	</label>

	{#if isBusy}
		<div class="busy-container"><ProgressSpinner /></div>
	{:else if addon !== undefined}
		<div class="addon-container">
			<div
				class="addon-thumb"
				style:background-image={hasThumbnail ? `url(${addon.thumbnailUrl})` : undefined}
			>
				{#if !hasThumbnail}
					<div class="addon-logo-letter text-3">{thumbnailLetter}</div>
				{/if}
			</div>

			<div class="addon-info">
				<h4>{addon.name}</h4>
				<p>{addon.author}</p>
				<p>{addon.files?.[0]?.version ?? ''}</p>
				<p class="addon-download-count">{downloadCountLabel}</p>
			</div>

			<div class="install-container">
				{#if showInstallSpinner}
					<ProgressSpinner />
				{:else if showInstallButton}
					<button class="wu-btn wu-btn-primary" onclick={() => void onInstall()}>
						{t('DIALOGS.INSTALL_FROM_URL.INSTALL_BUTTON')}
					</button>
				{:else if showInstallSuccess}
					<div class="success">
						<Icon name="fas:circle-check" size="1.5em" />
						<div>{t('DIALOGS.INSTALL_FROM_URL.INSTALL_SUCCESS_LABEL')}</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#snippet actions()}
		<button class="wu-btn wu-btn-flat" onclick={() => onclose?.()}>
			{t('DIALOGS.INSTALL_FROM_URL.CLOSE_BUTTON')}
		</button>
		<!-- replaces cdkFocusInitial -->
		<!-- svelte-ignore a11y_autofocus -->
		<button class="wu-btn wu-btn-primary" autofocus onclick={() => void onImportUrl()}>
			{t('DIALOGS.INSTALL_FROM_URL.IMPORT_BUTTON')}
		</button>
	{/snippet}
</Modal>

<style>
	.field-label {
		display: block;
		font-size: 0.75rem;
		opacity: 0.8;
		margin-bottom: 0.2rem;
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	input {
		flex: 1;
		padding: 0.45rem 0.55rem;
		border-radius: 4px;
		border: 1px solid var(--overlay-border);
		background: var(--overlay-subtle);
		color: inherit;
		font: inherit;
	}

	.busy-container {
		height: 120px;
	}

	.addon-container {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 1rem;
	}

	.addon-thumb {
		width: 64px;
		height: 64px;
		flex: none;
		border-radius: 4px;
		background: var(--overlay-hover);
		background-size: cover;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.addon-info {
		flex: 1;
		min-width: 0;
	}

	.addon-info h4,
	.addon-info p {
		margin: 0;
	}

	.install-container {
		flex: none;
		min-width: 120px;
		display: flex;
		justify-content: flex-end;
	}

	.success {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		color: #4caf50;
	}
</style>
