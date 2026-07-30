<script lang="ts">
	// Port of src/app/components/addons/addon-manage-dialog/addon-manage-dialog.component.{ts,html}
	// (400 LOC) — the Import/Export Addons dialog.
	//
	// The Angular component held one BehaviorSubject for the import summary and then derived
	// seven more Observables from it (hasImportSummary$, importSummaryAddedCt$,
	// importSummaryConflictCt$, importSummaryNoChangeCt$, importSummaryComparisons$,
	// importSummaryComparisonCt$, canInstall$), each a `.pipe(map(...))` that the template
	// unwrapped with `| async`. They are all one-line reads of the same object, so here they
	// are $derived off a single $state and the seven Observables collapse.
	//
	// It also kept an ImportComparisonViewModel type purely to bolt isInstalling/isCompleted/
	// didError onto the broker's ImportComparison, cloned the summary on every install event
	// and pushed the clone through the subject to force change detection. Here the per-row
	// install status lives in its own map, keyed by comparison id, so the broker's data is
	// never copied or mutated.

	import { modalDialog } from '$lib/attachments/modal-dialog';
	import { AppConfig } from '$config/environment';
	import { AddonInstallState } from '$lib/models/addon-install-state';
	import {
		addonBroker,
		type ExportPayload,
		type ImportSummary
	} from '$lib/state/addon-broker.svelte';
	import { session } from '$lib/state/session.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
	import { resource } from 'runed';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { t } from '$lib/i18n.svelte';
	import { invoke } from '$lib/ipc';
	import { openExternalLink } from '$lib/services/links';
	import * as clipboard from '$lib/services/clipboard';
	import Icon from '$lib/components/common/Icon.svelte';
	import ProgressSpinner from '$lib/components/common/ProgressSpinner.svelte';

	const IPC_BASE64_ENCODE = 'base64-encode';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	type Tab = 'export' | 'import';

	let activeTab = $state<Tab>('export');
	let installing = $state(false);

	// The export side is one async chain — resolve the installation's display name, summarise
	// what would be exported, then base64 the payload. It was an $effect with a `cancelled`
	// flag and three separate `if (cancelled) return` checkpoints; as a resource the staleness
	// handling is the utility's and the three values arrive together or not at all.
	const exportResource = resource(
		() => session.selectedWowInstallation,
		async (installation) => {
			if (!installation) return undefined;

			const copy = { ...installation };
			copy.label = await warcraftInstallations.getInstallationDisplayName(copy);

			const summary = await addonBroker.getExportSummary(copy);
			const payload = await addonBroker.getExportPayload(copy);

			return {
				installation: copy,
				summary,
				payload: await invoke<string>(IPC_BASE64_ENCODE, JSON.stringify(payload))
			};
		}
	);

	let selectedInstallation = $derived(exportResource.current?.installation);
	let exportSummary = $derived(exportResource.current?.summary);
	let exportPayload = $derived(exportResource.current?.payload);

	let importData = $state('');
	let importSummary = $state<ImportSummary | undefined>(undefined);

	// Per-comparison install progress. Was three extra fields spliced onto the broker's
	// ImportComparison objects and re-cloned on every event.
	let installStatus = $state<
		Record<string, { installing: boolean; completed: boolean; errored: boolean }>
	>({});

	// ---- derived ---------------------------------------------------------------------------

	// Was a `hasError` flag the init effect's catch set. The resource already tracks this;
	// the import path never set it — import failures surface as snackbars.
	let hasError = $derived(exportResource.error !== undefined);
	let comparisons = $derived(importSummary?.comparisons ?? []);
	let canInstall = $derived(comparisons.some((comp) => comp.state === 'added'));

	$effect(() =>
		addonBroker.onAddonInstall((evt) => {
			installStatus[evt.comparisonId] = {
				installing: true,
				completed: evt.installState === AddonInstallState.Complete,
				errored: evt.installState === AddonInstallState.Error
			};
		})
	);

	// ---- actions ---------------------------------------------------------------------------

	async function onClickCopy() {
		if (exportPayload === undefined) return;
		await clipboard.writeText(exportPayload);
		snackbar.showSuccess('ADDON_IMPORT.EXPORT_STRING_COPIED', { timeout: 2000 });
	}

	async function onClickPaste() {
		try {
			importData = await clipboard.readText();
			snackbar.showSuccess('ADDON_IMPORT.EXPORT_STRING_PASTED', { timeout: 2000 });
		} catch (e) {
			console.error(e);
		}
	}

	function onClickReset() {
		importSummary = undefined;
		installStatus = {};
	}

	async function onClickImport() {
		let importJson: ExportPayload;
		try {
			importJson = await addonBroker.parseImportString(importData);
		} catch (e) {
			console.error(e);
			snackbar.showError('ADDON_IMPORT.IMPORT_STRING_INVALID', { timeout: 2000 });
			return;
		}

		if (!selectedInstallation) return;

		try {
			const summary = await addonBroker.getImportSummary(importJson, selectedInstallation);

			if (summary.errorCode !== undefined) {
				// A missing provider is actionable — the user has to install a different WowUp
				// build — so it gets a dialog with a download link rather than a toast.
				if (
					summary.errorCode === 'MISSING_WAGO_PROVIDER' ||
					summary.errorCode === 'MISSING_CURSEFORGE_PROVIDER'
				) {
					const download = await dialogs.confirm({
						title: t('ADDON_IMPORT.MISSING_PROVIDER_MODAL_TITLE'),
						message: t(`ADDON_IMPORT.${summary.errorCode}`),
						positiveKey: 'ADDON_IMPORT.MISSING_PROVIDER_MODAL_DOWNLOAD_BTN',
						negativeKey: 'DIALOGS.ALERT.POSITIVE_BUTTON'
					});
					if (download) await openExternalLink(AppConfig.wowUpWebsiteUrl);
				} else {
					snackbar.showError(`ADDON_IMPORT.${summary.errorCode}`, {
						localeArgs: summary.errorParams,
						timeout: 2000
					});
				}
				return;
			}

			installStatus = {};
			importSummary = summary;
		} catch (e) {
			console.error(e);
			snackbar.showError('ADDON_IMPORT.GENERIC_IMPORT_ERROR', { timeout: 2000 });
		}
	}

	async function onClickInstall() {
		if (!importSummary || !selectedInstallation) return;
		try {
			installing = true;
			await addonBroker.installImportSummary(importSummary, selectedInstallation);
		} catch (e) {
			console.error(e);
		} finally {
			installing = false;
		}
	}
</script>

<dialog class="wu-dialog addon-manage" {@attach modalDialog()} {onclose}>
	<div class="manage-header">
		<h2>
			{t('ADDON_IMPORT.DIALOG_TITLE', {
				clientType: selectedInstallation?.displayName ?? ''
			})}
		</h2>
		<button
			class="wu-btn wu-btn-icon wu-btn-flat wu-btn-primary"
			aria-label={t('COMMON.CLOSE')}
			disabled={installing}
			onclick={onclose}
		>
			<Icon name="fas:xmark" />
		</button>
	</div>

	<div class="dialog-content">
		{#if hasError}
			<div class="text-warning">{t('ADDON_IMPORT.GENERIC_IMPORT_ERROR')}</div>
		{:else}
			<div class="tab-list" role="tablist">
				<button
					type="button"
					role="tab"
					class="tab-trigger"
					class:active={activeTab === 'export'}
					aria-selected={activeTab === 'export'}
					disabled={installing}
					onclick={() => (activeTab = 'export')}
				>
					{t('ADDON_IMPORT.EXPORT_TAB_LABEL')}
				</button>
				<button
					type="button"
					role="tab"
					class="tab-trigger"
					class:active={activeTab === 'import'}
					aria-selected={activeTab === 'import'}
					disabled={installing}
					onclick={() => (activeTab = 'import')}
				>
					{t('ADDON_IMPORT.IMPORT_TAB_LABEL')}
				</button>
			</div>

			<div class="tab-panel" role="tabpanel">
				{#if activeTab === 'export'}
					{#if exportSummary !== undefined}
						<p>
							<span>
								{t('ADDON_IMPORT.ACTIVE_ADDON_COUNT', { count: exportSummary.activeCount })}
							</span>
							{#if exportSummary.ignoreCount > 0}
								<span class="text-warning">
									{t('ADDON_IMPORT.IGNORED_ADDON_COUNT', { count: exportSummary.ignoreCount })}
								</span>
							{/if}
						</p>
					{/if}

					{#if exportPayload !== undefined}
						<label class="field">
							<span class="field-label">{t('ADDON_IMPORT.EXPORT_TEXT_LABEL')}</span>
							<textarea class="export-content" spellcheck="false" readonly value={exportPayload}
							></textarea>
						</label>
					{:else}
						<ProgressSpinner />
					{/if}
				{:else if importSummary === undefined}
					<p>{t('ADDON_IMPORT.IMPORT_TEXT_INSTRUCTIONS')}</p>
					<label class="field">
						<span class="field-label">{t('ADDON_IMPORT.IMPORT_TEXT_LABEL')}</span>
						<textarea class="import-content" spellcheck="false" bind:value={importData}></textarea>
					</label>
				{:else}
					<p class="total">{t('ADDON_IMPORT.IMPORT_TOTAL_COUNT', { count: comparisons.length })}</p>
					<p class="text-2">
						{#if importSummary.conflictCt > 0}
							<span>
								{t('ADDON_IMPORT.IMPORT_CONFLICT_COUNT', { count: importSummary.conflictCt })}
							</span>
						{/if}
						{#if importSummary.addedCt > 0}
							<span>{t('ADDON_IMPORT.IMPORT_ADDED_COUNT', { count: importSummary.addedCt })}</span>
						{/if}
						{#if importSummary.noChangeCt > 0}
							<span>
								{t('ADDON_IMPORT.IMPORT_NO_CHANGE_COUNT', { count: importSummary.noChangeCt })}
							</span>
						{/if}
					</p>

					<div class="comparison-list bg-secondary-2">
						{#each comparisons as comp (comp.id)}
							{@const status = installStatus[comp.id]}
							<div class="comparison-row {comp.state}" class:text-3={comp.state === 'no-change'}>
								{#if status?.installing}
									<div class="comp-badge">
										{#if status.completed}
											<Icon name="far:circle-check" class="success-icon" />
										{:else if status.errored}
											<!-- The Angular component computed didError but never rendered it, so a
											     failed row was indistinguishable from one still installing. -->
											<Icon name="fas:triangle-exclamation" class="error-icon" />
										{:else}
											<span class="mini-spinner" role="status"></span>
										{/if}
									</div>
								{:else if comp.state === 'no-change'}
									<div
										class="comp-badge no-change-badge"
										title={t('ADDON_IMPORT.NO_CHANGE_BADGE_TOOLTIP')}
									>
										{t('ADDON_IMPORT.IMPORT_BADGE_NO_CHANGE')}
									</div>
								{:else if comp.state === 'added'}
									<div class="comp-badge added-badge" title={t('ADDON_IMPORT.ADDED_BADGE_TOOLTIP')}>
										{t('ADDON_IMPORT.IMPORT_BADGE_ADDED')}
									</div>
								{:else}
									<div
										class="comp-badge conflict-badge"
										title={t('ADDON_IMPORT.CONFLICT_BADGE_TOOLTIP')}
									>
										{t('ADDON_IMPORT.IMPORT_BADGE_CONFLICT')}
									</div>
								{/if}

								<div>
									<div class="comp-text">{comp.imported.name}</div>
									{#if comp.state === 'conflict' && comp.conflictReason}
										<small class="text-2">{t(`ADDON_IMPORT.${comp.conflictReason}`)}</small>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div class="dialog-actions">
		{#if activeTab === 'export'}
			<div class="spacer"></div>
			{#if exportPayload !== undefined}
				<button class="wu-btn wu-btn-primary" disabled={installing} onclick={onClickCopy}>
					{t('ADDON_IMPORT.COPY_BUTTON')}
				</button>
			{/if}
		{:else if importSummary !== undefined}
			<button
				class="wu-btn wu-btn-flat wu-btn-warning"
				disabled={installing}
				onclick={onClickReset}
			>
				{t('ADDON_IMPORT.RESET_BUTTON')}
			</button>
			<div class="spacer"></div>
			<button
				class="wu-btn wu-btn-primary"
				disabled={!canInstall || installing}
				onclick={onClickInstall}
			>
				{t('ADDON_IMPORT.INSTALL_BUTTON')}
			</button>
		{:else}
			<div class="spacer"></div>
			<button class="wu-btn wu-btn-flat" disabled={installing} onclick={onClickPaste}>
				{t('ADDON_IMPORT.PASTE_BUTTON')}
			</button>
			<button class="wu-btn wu-btn-primary" disabled={installing} onclick={onClickImport}>
				{t('ADDON_IMPORT.IMPORT_BUTTON')}
			</button>
		{/if}
	</div>
</dialog>

<style>
	.addon-manage {
		width: min(42rem, 90vw);
		max-width: none;
	}

	.manage-header {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.manage-header h2 {
		flex: 1 1 auto;
		margin: 0;
	}

	.tab-list {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--overlay-selected);
	}

	.tab-trigger {
		padding: 0.6rem 1rem;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		color: inherit;
		font: inherit;
		text-transform: uppercase;
		opacity: 0.7;
		cursor: pointer;
	}

	.tab-trigger.active {
		border-bottom-color: currentcolor;
		opacity: 1;
	}

	.tab-trigger:disabled {
		cursor: default;
		opacity: 0.4;
	}

	.tab-panel {
		min-height: 16rem;
		max-height: 50vh;
		overflow-y: auto;
		padding-top: 0.5rem;
	}

	.field {
		display: block;
	}

	.field-label {
		display: block;
		margin-bottom: 0.25rem;
		font-size: 0.85em;
		opacity: 0.75;
	}

	textarea {
		width: 100%;
		min-height: 9rem;
		padding: 0.5rem;
		border: 1px solid var(--overlay-border);
		border-radius: 4px;
		background: rgb(0 0 0 / 20%);
		color: inherit;
		font-family: monospace;
		font-size: 0.85em;
		resize: vertical;
	}

	.total {
		margin: 0.75rem 0 0;
	}

	.comparison-list {
		padding: 0.75rem;
		border-radius: 4px;
	}

	.comparison-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.25rem 0;
	}

	.comp-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 5.5rem;
		padding: 0.15rem 0.35rem;
		border-radius: 4px;
		font-size: 0.75em;
		text-transform: uppercase;
	}

	.no-change-badge {
		background: var(--overlay-selected);
	}

	.added-badge {
		background: rgb(76 175 80 / 30%);
	}

	.conflict-badge {
		background: rgb(255 152 0 / 30%);
	}

	.comp-text {
		word-break: break-word;
	}

	.mini-spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--overlay-border);
		border-top-color: currentcolor;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.dialog-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0.75rem;
	}

	.spacer {
		flex: 1 1 auto;
	}
</style>
