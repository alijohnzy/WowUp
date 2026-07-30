<script lang="ts">
	// Port of components/options/options-wow-section (134 LOC).
	// The rxjs from()/catchError() wrapper around addNewClient becomes a try/catch.

	import { t, i18n } from '$lib/i18n.svelte';
	import WowClientOptions from './WowClientOptions.svelte';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { warcraft } from '$lib/state/warcraft.svelte';
	import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';

	function onReScan() {
		warcraftInstallations
			.importWowInstallations(warcraftInstallations.blizzardAgentPath)
			.catch((e: unknown) => console.error(e));
	}

	async function onAddNew() {
		try {
			const selectedPath = await warcraftInstallations.selectWowClientPath();
			if (!selectedPath) return;

			if (!(await warcraft.isWowApplication(selectedPath))) {
				await dialogs.alert({
					title: t('DIALOGS.ALERT.ERROR_TITLE'),
					message: i18n.t('DIALOGS.SELECT_INSTALLATION.INVALID_INSTALLATION_PATH', {
						selectedPath
					})
				});
				return;
			}

			const wowInstallation =
				await warcraftInstallations.createWowInstallationForPath(selectedPath);
			await warcraftInstallations.addInstallation(wowInstallation);
		} catch (error) {
			console.error(error);
		}
	}
</script>

<div class="container">
	<h2>{t('PAGES.OPTIONS.WOW.TITLE')}</h2>

	<div class="row">
		<div class="grow">{t('PAGES.OPTIONS.WOW.RESCAN_CLIENTS_LABEL')}</div>
		<button class="wu-btn wu-btn-flat" onclick={onReScan}>
			{t('PAGES.OPTIONS.WOW.RESCAN_CLIENTS_BUTTON')}
		</button>
		<button class="wu-btn wu-btn-primary" onclick={onAddNew}>
			{t('PAGES.OPTIONS.WOW.ADD_CLIENT_BUTTON')}
		</button>
	</div>

	{#if warcraftInstallations.installations.length === 0}
		<h2 class="empty">{t('PAGES.OPTIONS.WOW.NO_CLIENTS_FOUND_TEXT')}</h2>
	{/if}

	{#each warcraftInstallations.installations as installation, i (installation.id)}
		<WowClientOptions installationId={installation.id} index={i} />
	{/each}
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

	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.grow {
		flex: 1;
	}

	.empty {
		padding-top: 1rem;
	}
</style>
