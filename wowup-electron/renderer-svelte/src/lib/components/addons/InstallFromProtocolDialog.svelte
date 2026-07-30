<script lang="ts">
	// Port of src/app/components/addons/install-from-protocol-dialog/install-from-protocol-dialog.component.{ts,html}
	// (256 LOC) — opened when the app is launched via a wowup:// protocol link.
	//
	// The Angular component exposed five getters (getName/getAuthor/getVersion/
	// getThumbnailUrl/getProviderName) that the template called on every change-detection
	// pass, purely because a template cannot read `_.first(addon.files)?.version` inline.
	// They are $derived here.
	//
	// Two behaviours are deliberately not carried over:
	//   - ngAfterViewInit wrapped the load in `of(true).pipe(first(), delay(1000), ...)`, so
	//     every protocol launch sat on a spinner for a second before the lookup even started.
	//     Nothing depended on the delay; the spinner already covers the load.
	//   - `getAuthor()` returned "'" (a stray apostrophe) rather than "" when the addon had no
	//     author. That is a typo, not a fallback.

	import { t } from '$lib/i18n.svelte';
	import { addonService } from '$lib/state/addon.svelte';
	import { session } from '$lib/state/session.svelte';
	import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
	import type { ProtocolSearchResult, WowInstallation } from 'wowup-lib-core';
	import Modal from '$lib/components/common/Modal.svelte';
	import Icon from '$lib/components/common/Icon.svelte';
	import ProgressBar from '$lib/components/common/ProgressBar.svelte';
	import ProgressSpinner from '$lib/components/common/ProgressSpinner.svelte';
	import AddonThumbnail from './AddonThumbnail.svelte';

	const ERROR_ADDON_NOT_FOUND = 'DIALOGS.INSTALL_FROM_PROTOCOL.ERRORS.ADDON_NOT_FOUND';
	const ERROR_GENERIC = 'DIALOGS.INSTALL_FROM_PROTOCOL.ERRORS.GENERIC';
	const ERROR_NO_VALID_WOW_INSTALLATIONS =
		'DIALOGS.INSTALL_FROM_PROTOCOL.ERRORS.NO_VALID_WOW_INSTALLATIONS';

	interface Props {
		protocol: string;
		onclose: () => void;
	}

	let { protocol, onclose }: Props = $props();

	interface InstallationRow {
		installation: WowInstallation;
		isInstalled: boolean;
	}

	let ready = $state(false);
	let error = $state('');
	let addon = $state<ProtocolSearchResult | undefined>(undefined);
	let rows = $state<InstallationRow[]>([]);
	let selectedIds = $state<string[]>([]);
	let isInstalling = $state(false);
	let isComplete = $state(false);
	let installProgress = $state(0);

	// Was five template-called getters.
	let name = $derived(addon?.name ?? '');
	let author = $derived(addon?.author ?? '');
	let providerName = $derived(addon?.providerName ?? '');
	let thumbnailUrl = $derived(addon?.thumbnailUrl ?? '');
	let version = $derived(addon?.files?.[0]?.version ?? '');

	let canInstall = $derived(
		error.length === 0 && selectedIds.length > 0 && !isInstalling && !isComplete
	);

	async function loadAddon() {
		try {
			const searchResult = await addonService.getAddonForProtocol(protocol);
			if (!searchResult) {
				error = ERROR_ADDON_NOT_FOUND;
				return;
			}

			addon = searchResult;

			let installations: WowInstallation[];
			if (Array.isArray(searchResult.validClientGroups)) {
				installations = await warcraftInstallations.getWowInstallationsByClientGroups(
					searchResult.validClientGroups
				);
			} else if (Array.isArray(searchResult.validClientTypes)) {
				installations = await warcraftInstallations.getWowInstallationsByClientTypes(
					searchResult.validClientTypes
				);
			} else {
				throw new Error('No valid clients found');
			}

			if (installations.length === 0) {
				error = ERROR_NO_VALID_WOW_INSTALLATIONS;
				return;
			}

			rows = await Promise.all(
				installations.map(async (installation) => {
					const copy = { ...installation };
					copy.label = await warcraftInstallations.getInstallationDisplayName(copy);
					return {
						installation: copy,
						isInstalled: await addonService.isInstalled(
							searchResult.externalId,
							searchResult.providerName,
							copy
						)
					};
				})
			);

			// Already everywhere it can go — show the success state instead of an install button.
			if (rows.every((row) => row.isInstalled)) {
				isComplete = true;
				selectedIds = rows.map((row) => row.installation.id);
				return;
			}

			const first = rows.find((row) => !row.isInstalled);
			if (first) selectedIds = [first.installation.id];
		} catch (e) {
			console.error('Failed to load protocol addon', e);
			error = ERROR_GENERIC;
		} finally {
			ready = true;
		}
	}

	$effect(() => {
		void loadAddon();
	});

	function toggle(id: string, checked: boolean) {
		selectedIds = checked ? [...selectedIds, id] : selectedIds.filter((v) => v !== id);
	}

	async function onInstall() {
		if (!addon) return;

		const targets = rows
			.filter((row) => selectedIds.includes(row.installation.id))
			.map((row) => row.installation);
		const targetFile = addon.files?.[0];

		try {
			isInstalling = true;

			for (const [index, installation] of targets.entries()) {
				await addonService.installPotentialAddon(
					addon,
					installation,
					(_state, progress) => {
						installProgress = (index * 100 + progress) / targets.length;
					},
					targetFile
				);
				session.notifyTargetFileInstallComplete();
			}

			isComplete = true;
		} catch (e) {
			console.error(`Failed to install addon for protocol: ${protocol}`, e);
			error = ERROR_GENERIC;
		} finally {
			isInstalling = false;
		}
	}
</script>

<Modal title={ready ? t('DIALOGS.INSTALL_FROM_PROTOCOL.TITLE', { providerName }) : ''} {onclose}>
	<div class="content">
		{#if !ready}
			<ProgressSpinner />
		{:else if error.length > 0}
			<div class="error">
				<h4>Error</h4>
				<p>{t(error, { protocol })}</p>
			</div>
		{:else}
			<div class="addon-row">
				<AddonThumbnail url={thumbnailUrl} {name} size={60} />
				<div>
					<h3>{name}</h3>
					<p>{author}</p>
					<p class="text-2">{version}</p>
				</div>
			</div>

			<fieldset class="installations" disabled={isInstalling || isComplete}>
				<legend>{t('COMMON.WOW_EXE_SELECTION_NAME')}</legend>
				{#each rows as row (row.installation.id)}
					<label class="installation-option">
						<input
							type="checkbox"
							value={row.installation.id}
							checked={selectedIds.includes(row.installation.id)}
							disabled={row.isInstalled}
							onchange={(e) => toggle(row.installation.id, e.currentTarget.checked)}
						/>
						<span>{row.installation.displayName}</span>
						{#if row.isInstalled}
							<Icon name="fas:circle-check" class="success-icon" />
						{/if}
					</label>
				{/each}
			</fieldset>
		{/if}

		{#if isInstalling}
			<p>{t('DIALOGS.INSTALL_FROM_PROTOCOL.ADDON_INSTALLING')}</p>
			<div class="progress-track">
				<ProgressBar value={installProgress} />
			</div>
		{/if}

		{#if isComplete}
			<div class="installed">
				<Icon name="fas:circle-check" size="3rem" class="success-icon" />
				<p>{t('DIALOGS.INSTALL_FROM_PROTOCOL.ADDON_INSTALLED')}</p>
			</div>
		{/if}
	</div>

	{#snippet actions()}
		{#if ready}
			<button class="wu-btn wu-btn-flat" disabled={isInstalling} onclick={onclose}>
				{t('DIALOGS.INSTALL_FROM_PROTOCOL.CANCEL_BUTTON')}
			</button>
			<!-- replaces cdkFocusInitial -->
			<!-- svelte-ignore a11y_autofocus -->
			<button
				class="wu-btn wu-btn-primary"
				autofocus
				disabled={!canInstall}
				onclick={() => void onInstall()}
			>
				{t('DIALOGS.INSTALL_FROM_PROTOCOL.INSTALL_BUTTON')}
			</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.content {
		min-width: 20rem;
	}

	.addon-row {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.addon-row h3,
	.addon-row p {
		margin: 0;
	}

	.installations {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0.5rem 0.75rem 0.75rem;
		border: 1px solid var(--overlay-border);
		border-radius: 4px;
	}

	.installations:disabled {
		opacity: 0.6;
	}

	legend {
		padding: 0 0.35rem;
		font-size: 0.85em;
		opacity: 0.75;
	}

	.installation-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.progress-track {
		position: relative;
		height: 4px;
		border-radius: 2px;
		background: var(--overlay-selected);
	}

	.installed {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding-top: 1rem;
		text-align: center;
	}

	.error h4 {
		margin: 0 0 0.25rem;
	}
</style>
