<script lang="ts">
	// Port of components/common/titlebar (282 LOC).
	//
	// Removed: NgZone (electronService.windowMaximized$ came from an IPC callback outside
	// Angular's zone, so every update needed `_ngZone.run()`. Svelte has no zone, so the
	// assignment is just an assignment), a Subscription array + ngOnDestroy, and MatSnackBar.

	import {
		IPC_CLOSE_WINDOW,
		IPC_MAXIMIZE_WINDOW,
		IPC_MINIMIZE_WINDOW,
		IPC_SYSTEM_PREFERENCES_GET_USER_DEFAULT,
		IPC_WINDOW_ENTER_FULLSCREEN,
		IPC_WINDOW_IS_FULLSCREEN,
		IPC_WINDOW_IS_MAXIMIZED,
		IPC_WINDOW_LEAVE_FULLSCREEN
	} from '$common/constants';
	import { AppConfig } from '$config/environment';
	import { invoke, isElectron, isLinux, isMac, isWin, on } from '$lib/ipc';
	import { t } from '$lib/i18n.svelte';
	import { electron } from '$lib/state/electron.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';

	let isFullscreen = $state(false);

	let titleKey = $derived(
		isFullscreen
			? 'APP.WINDOW_TITLE_FULLSCREEN'
			: AppConfig.curseforge.enabled
				? 'APP.WINDOW_TITLE_CF'
				: 'APP.WINDOW_TITLE'
	);

	$effect(() => {
		if (!isElectron()) return;

		invoke<boolean>(IPC_WINDOW_IS_FULLSCREEN)
			.then((v) => (isFullscreen = v))
			.catch((e: unknown) => console.error(e));
		invoke<boolean>(IPC_WINDOW_IS_MAXIMIZED)
			.then((v) => (electron.windowMaximized = v))
			.catch((e: unknown) => console.error(e));

		const offEnter = on(IPC_WINDOW_ENTER_FULLSCREEN, () => {
			isFullscreen = true;
			snackbar.show(isMac() ? 'APP.FULLSCREEN_SNACKBAR.MAC' : 'APP.FULLSCREEN_SNACKBAR.WINDOWS');
		});
		const offLeave = on(IPC_WINDOW_LEAVE_FULLSCREEN, () => (isFullscreen = false));

		return () => {
			offEnter();
			offLeave();
		};
	});

	async function onDblClick() {
		// macOS honours a system preference for what a titlebar double-click does.
		if (!isMac()) return;

		// The channel takes (key, type) positionally — see ElectronService.getUserDefaultSystemPreference.
		const action = await invoke<string>(
			IPC_SYSTEM_PREFERENCES_GET_USER_DEFAULT,
			'AppleActionOnDoubleClick',
			'string'
		).catch(() => '');

		if (action === 'Maximize') await invoke(IPC_MAXIMIZE_WINDOW);
		else if (action === 'Minimize') await invoke(IPC_MINIMIZE_WINDOW);
	}

	const run = (p: Promise<unknown>) => void p.catch((e: unknown) => console.error(e));
</script>

<div
	class="titlebar bg-secondary-2 text-1"
	class:mac={isMac()}
	class:windows={isWin()}
	class:linux={isLinux()}
>
	<!-- drag region, not a control -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="titlebar-drag-region" ondblclick={onDblClick}></div>

	<div class="title-container">
		<div>{t(titleKey)}</div>
	</div>

	{#if isWin() || isLinux()}
		<div class="window-control-container">
			{#if isFullscreen}
				<button
					class="window-control"
					title={t('APP.CLOSE_FULLSCREEN_BUTTON_TOOLTIP')}
					onclick={() => run(invoke(IPC_WINDOW_LEAVE_FULLSCREEN))}
					aria-label={t('APP.CLOSE_FULLSCREEN_BUTTON_TOOLTIP')}
				>
					<span class="glyph">&#x2715;</span>
				</button>
			{:else}
				<button
					class="window-control"
					onclick={() => run(electron.minimizeWindow())}
					aria-label="Minimize"
				>
					<img src="./assets/chrome-minimize.svg" alt="" />
				</button>

				{#if electron.windowMaximized}
					<button
						class="window-control"
						onclick={() => run(electron.maximizeWindow())}
						aria-label="Restore"
					>
						<img src="./assets/chrome-restore.svg" alt="" />
					</button>
				{:else}
					<button
						class="window-control"
						onclick={() => run(electron.maximizeWindow())}
						aria-label="Maximize"
					>
						<img src="./assets/chrome-maximize.svg" alt="" />
					</button>
				{/if}

				<button
					class="window-control close"
					onclick={() => run(invoke(IPC_CLOSE_WINDOW))}
					aria-label="Close"
				>
					<img src="./assets/chrome-close.svg" alt="" />
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.titlebar {
		position: relative;
		display: flex;
		align-items: center;
		height: 32px;
		flex: none;
		user-select: none;
	}

	.titlebar-drag-region {
		position: absolute;
		inset: 0;
		-webkit-app-region: drag;
	}

	.title-container {
		flex: 1;
		text-align: center;
		font-size: 0.8rem;
		pointer-events: none;
	}

	/* macOS draws its own traffic lights on the left. */
	.titlebar.mac .title-container {
		padding-left: 70px;
	}

	.window-control-container {
		display: flex;
		align-items: center;
		height: 100%;
		-webkit-app-region: no-drag;
		z-index: 1;
	}

	.window-control {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 46px;
		height: 100%;
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
	}

	.window-control:hover {
		background: var(--overlay-selected);
	}

	.window-control.close:hover {
		background: #e81123;
	}

	.window-control img {
		width: 10px;
		height: 10px;
	}

	.glyph {
		font-size: 0.8rem;
	}
</style>
