<script lang="ts">
	// Port of src/app/components/options/options-debug-section/options-debug-section.component.{ts,html}
	//
	// Angular: 44 LOC .ts + 60 .html + 14 .scss = 118
	// Removed on the way over:
	//   - ChangeDetectorRef + this._cdRef.detectChanges()  -> nothing; $state updates the DOM
	//   - <mat-spinner>                                    -> 12 lines of CSS
	//   - *ngIf on the two button states                   -> {#if}
	//
	// These three actions were briefly invoking invented channels ('show-logs-folder',
	// 'show-config-folder', 'log-debug-data'), none of which the main process registers — the
	// real work already lived in the state modules, exactly as it did in the Angular services.

	import { t } from '$lib/i18n.svelte';
	import { addonService } from '$lib/state/addon.svelte';
	import { session } from '$lib/state/session.svelte';
	import { wowup } from '$lib/state/wowup.svelte';

	let dumpingDebugData = $state(false);

	async function onShowLogs() {
		await wowup.showLogsFolder();
	}

	async function onShowConfig() {
		await wowup.showConfigFolder();
	}

	async function onLogDebugData() {
		try {
			dumpingDebugData = true;
			await addonService.logDebugData();
		} catch (e) {
			console.error(e);
		} finally {
			dumpingDebugData = false;
		}
	}
</script>

<div class="container">
	<h2>{t('PAGES.OPTIONS.DEBUG.TITLE')}</h2>

	<div class="actions">
		<div>
			<div>{t('PAGES.OPTIONS.DEBUG.LOG_FILES_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.DEBUG.LOG_FILES_DESCRIPTION')}</small>
		</div>
		<div>
			<button id="show-log-btn" class="wu-btn wu-btn-primary w-full" onclick={onShowLogs}>
				{t('PAGES.OPTIONS.DEBUG.LOG_FILES_BUTTON')}
			</button>
		</div>

		<div>
			<div>{t('PAGES.OPTIONS.DEBUG.CONFIG_FILES_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.DEBUG.CONFIG_FILES_DESCRIPTION')}</small>
		</div>
		<div>
			<button id="show-config-btn" class="wu-btn wu-btn-primary w-full" onclick={onShowConfig}>
				{t('PAGES.OPTIONS.DEBUG.CONFIG_FILES_BUTTON')}
			</button>
		</div>

		<div>
			<div>{t('PAGES.OPTIONS.DEBUG.DEBUG_DATA_LABEL')}</div>
			<small class="text-2">{t('PAGES.OPTIONS.DEBUG.DEBUG_DATA_DESCRIPTION')}</small>
		</div>
		<div>
			<button
				id="dump-debug-btn"
				class="wu-btn wu-btn-primary w-full"
				onclick={onLogDebugData}
				disabled={dumpingDebugData}
			>
				{#if dumpingDebugData}
					<span class="spinner" aria-label="loading"></span>
				{:else}
					{t('PAGES.OPTIONS.DEBUG.DEBUG_DATA_BUTTON')}
				{/if}
			</button>
		</div>

		<!--
		  AdWebView already listens on session.debugAdFrame, but nothing emitted — this button was
		  dropped, so the listener was unreachable. The two labels are untranslated in the original
		  too: they are passed through `| translate` with no matching key, which returns the string
		  itself. Kept verbatim rather than inventing locale entries for a developer affordance.
		-->
		<div>
			<div>Debug ad frame</div>
			<small class="text-2">Show the dev tools for the ad frame</small>
		</div>
		<div>
			<button
				id="debug-ad-frame-btn"
				class="wu-btn wu-btn-primary w-full"
				onclick={() => session.debugAdFrame.emit(true)}
			>
				Open Dev Tools
			</button>
		</div>
	</div>
</div>

<style>
	.container {
		padding: 1rem;
		overflow-y: auto;
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.75rem 1rem;
		align-items: center;
	}

	.spinner {
		display: inline-block;
		width: 20px;
		height: 20px;
		border: 3px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.75s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2s;
		}
	}
</style>
