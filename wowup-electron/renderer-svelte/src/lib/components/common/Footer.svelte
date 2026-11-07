<script lang="ts">
	// Port of components/common/footer (310 LOC).
	//
	// Removed: NgZone (the app-update events arrive from IPC, so the Angular version wrapped
	// every state change in `_zone.run()`), three Observables built with combineLatest, and
	// the [ngSwitch]/*ngSwitchCase ladder over the update state.

	import { AppUpdateState } from '$common/wowup/models';
	import { AppConfig } from '$config/environment';
	import { t } from '$lib/i18n.svelte';
	import { isTauri } from '$lib/ipc';
	import { openExternalLink } from '$lib/services/links';
	import Icon from './Icon.svelte';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { electron } from '$lib/state/electron.svelte';
	import { session } from '$lib/state/session.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { wowup } from '$lib/state/wowup.svelte';

	let updateState = $derived(electron.appUpdate?.state);
	let updateProgress = $derived(
		(electron.appUpdate?.progress as { percent?: number } | undefined)?.percent ?? 0
	);

	// Tauri asks before downloading (src-tauri/src/updater.rs): UpdateAvailable is a button,
	// where Electron, which downloads straight away, only showed it as a passing state.
	let availableVersion = $derived(electron.appUpdate?.version ?? '');

	async function onUpdateAvailable(): Promise<void> {
		const evt = electron.appUpdate;
		if (evt?.manual) {
			// The portable zip cannot replace itself; send the user to the release instead.
			const ok = await dialogs.confirm({
				title: t('APP.WOWUP_UPDATE.PORTABLE_DOWNLOAD_TITLE'),
				message: t('APP.WOWUP_UPDATE.PORTABLE_DOWNLOAD_MESSAGE')
			});
			if (ok && evt.releaseUrl) await openExternalLink(evt.releaseUrl);
			return;
		}
		wowup.installUpdate();
	}

	// A check the user asked for gets an answer. The hourly ones stay quiet, but a click that
	// finds nothing left the footer exactly as it was, so the button looked dead.
	let manualCheck = false;

	function onCheckForUpdate(): void {
		manualCheck = true;
		wowup.checkForAppUpdate();
	}

	$effect(() => {
		const evt = electron.appUpdate;
		if (!evt || !manualCheck) return;
		if (evt.state === AppUpdateState.CheckingForUpdate) return;
		manualCheck = false;
		if (evt.state === AppUpdateState.UpdateNotAvailable) {
			snackbar.show(
				evt.localBuild
					? 'APP.WOWUP_UPDATE.LOCAL_BUILD_NO_UPDATES'
					: 'APP.WOWUP_UPDATE.NOT_AVAILABLE'
			);
		}
		// UpdateAvailable shows its button; errors already get a snackbar from the layout.
	});

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
		{:else if updateState === AppUpdateState.UpdateAvailable && isTauri()}
			<button
				class="footer-button update-button text-1"
				title={`${t('APP.WOWUP_UPDATE.TOOLTIP')} (v${availableVersion})`}
				onclick={() => void onUpdateAvailable()}
			>
				<Icon name="fas:rotate" />
				{t('APP.WOWUP_UPDATE.SNACKBAR_ACTION')}
			</button>
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
				onclick={onCheckForUpdate}
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
