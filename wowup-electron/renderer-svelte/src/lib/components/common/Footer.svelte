<script lang="ts">
	// Port of components/common/footer (310 LOC).
	//
	// Removed: NgZone (the app-update events arrive from IPC, so the Angular version wrapped
	// every state change in `_zone.run()`), three Observables built with combineLatest, and
	// the [ngSwitch]/*ngSwitchCase ladder over the update state.

	import { AppUpdateState } from '$common/wowup/models';
	import { AppConfig } from '$config/environment';
	import { t } from '$lib/i18n.svelte';
	import Icon from './Icon.svelte';
	import { electron } from '$lib/state/electron.svelte';
	import { session } from '$lib/state/session.svelte';
	import { wowup } from '$lib/state/wowup.svelte';

	let updateState = $derived(electron.appUpdate?.state);
	let updateProgress = $derived(
		(electron.appUpdate?.progress as { percent?: number } | undefined)?.percent ?? 0
	);

	$effect(() => {
		if (session.appVersion === undefined) {
			session.loadAppVersion().catch((e: unknown) => console.error('app version failed', e));
		}
	});
</script>

<footer class="bg-secondary-3 text-2">
	<p class="text-1 status">{session.statusText}</p>
	<div class="spacer"></div>
	<p class="context">{session.pageContextText}</p>
	<p>v{session.appVersion ?? ''} {AppConfig.curseforge.enabled ? 'CF' : ''}</p>

	<div class="update-slot">
		{#if updateState === AppUpdateState.CheckingForUpdate}
			<p>{t('APP.WOWUP_UPDATE.CHECKING_FOR_UPDATE')}</p>
		{:else if updateState === AppUpdateState.UpdateAvailable}
			<p>{t('APP.WOWUP_UPDATE.UPDATE_AVAILABLE')}</p>
		{:else if updateState === AppUpdateState.Downloading}
			<div class="downloading">
				<progress max="100" value={updateProgress}></progress>
				<span>{t('APP.WOWUP_UPDATE.DOWNLOADING_UPDATE')}</span>
			</div>
		{:else if updateState === AppUpdateState.Downloaded}
			<button
				class="footer-button update-button text-1"
				title={t('APP.WOWUP_UPDATE.TOOLTIP')}
				onclick={() => wowup.installUpdate()}
			>
				<Icon name="fas:rotate" />
				{t('APP.WOWUP_UPDATE.SNACKBAR_ACTION')}
			</button>
		{:else}
			<button
				class="footer-button text-1"
				title={t('APP.SYSTEM_TRAY.CHECK_UPDATE')}
				aria-label={t('APP.SYSTEM_TRAY.CHECK_UPDATE')}
				onclick={() => wowup.checkForAppUpdate()}
			>
				<Icon name="fas:rotate" />
			</button>
		{/if}
	</div>
</footer>

<style>
	footer {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: none;
		height: 28px;
		padding: 0 0.75rem;
		font-size: 0.75rem;
	}

	footer p {
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.status,
	.context {
		max-width: 40%;
	}

	.spacer {
		flex: 1;
	}

	.update-slot {
		display: flex;
		align-items: center;
		height: 100%;
	}

	.downloading {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	progress {
		width: 60px;
		height: 6px;
	}

	.footer-button {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		cursor: pointer;
		padding: 0 0.25rem;
	}

	.footer-button:hover {
		opacity: 0.8;
	}
</style>
