<script lang="ts">
	// Port of src/app/components/addons/wtf-backup/wtf-backup.component.{ts,html} (258 LOC).
	//
	// The Angular component kept four BehaviorSubjects for what is one busy flag and one list
	// (busy$, backups$, busyText$, busyTextParams$) plus two more derived from backups$
	// (hasBackups$, backupCt$). Every action then wrapped a promise in from(), piped it
	// through switchMap/catchError and pushed the busy flag on both sides of the pipe — the
	// rxjs was there only to sequence "confirm, then await, then clear the flag", which is
	// what await already does.

	import { modalDialog } from '$lib/attachments/modal-dialog';
	import { t } from '$lib/i18n.svelte';
	import { invoke } from '$lib/ipc';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { session } from '$lib/state/session.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { wtf, type WtfBackup } from '$lib/services/wtf';
	import { formatSize } from '$lib/utils/misc';
	import { getRelativeDateFormat } from '$lib/utils/string';
	import Icon from '$lib/components/common/Icon.svelte';
	import type { WowInstallation } from 'wowup-lib-core';

	const IPC_SHOW_ITEM_IN_FOLDER = 'show-item-in-folder';

	interface Props {
		onclose: () => void;
	}

	let { onclose }: Props = $props();

	interface BackupRow {
		title: string;
		size: string;
		date: number;
		error?: string;
	}

	const installation = session.getSelectedWowInstallation();
	const backupPath = installation ? wtf.getBackupPath(installation) : '';

	let busy = $state(false);
	let busyText = $state('');
	let busyTextParams = $state<Record<string, unknown>>({ count: '' });
	let backups = $state<BackupRow[]>([]);

	function toRow(backup: WtfBackup): BackupRow {
		return {
			title: backup.fileName,
			size: formatSize(backup.size),
			date: backup.metadata?.createdAt ?? backup.birthtimeMs,
			error: backup.error
		};
	}

	function relativeDate(date: number): string {
		const [key, params] = getRelativeDateFormat(date);
		return key ? t(key, params) : '';
	}

	async function loadBackups(target: WowInstallation) {
		busyText = 'WTF_BACKUP.BUSY_TEXT.LOADING_BACKUPS';
		busy = true;
		try {
			backups = (await wtf.getBackupList(target)).map(toRow);
		} catch (e) {
			console.error(e);
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (installation) void loadBackups(installation);
	});

	async function onShowFolder() {
		await invoke(IPC_SHOW_ITEM_IN_FOLDER, backupPath);
	}

	async function onClickApplyBackup(backup: BackupRow) {
		if (!installation) return;

		const confirmed = await dialogs.confirm({
			title: t('WTF_BACKUP.APPLY_CONFIRMATION.TITLE'),
			message: t('WTF_BACKUP.APPLY_CONFIRMATION.MESSAGE', { name: backup.title })
		});
		if (!confirmed) return;

		busyText = 'WTF_BACKUP.BUSY_TEXT.APPLYING_BACKUP';
		busy = true;
		try {
			await wtf.applyBackup(backup.title, installation);
			snackbar.showSuccess('WTF_BACKUP.BACKUP_APPLY_SUCCESS', {
				timeout: 2000,
				localeArgs: { name: backup.title }
			});
		} catch (e) {
			console.error(e);
			snackbar.showError('WTF_BACKUP.ERROR.BACKUP_APPLY_FAILED', {
				timeout: 2000,
				localeArgs: { name: backup.title }
			});
		} finally {
			busy = false;
		}
	}

	async function onClickDeleteBackup(backup: BackupRow) {
		if (!installation) return;

		const confirmed = await dialogs.confirm({
			title: t('WTF_BACKUP.DELETE_CONFIRMATION.TITLE'),
			message: t('WTF_BACKUP.DELETE_CONFIRMATION.MESSAGE', { name: backup.title })
		});
		if (!confirmed) return;

		busyText = 'WTF_BACKUP.BUSY_TEXT.REMOVING_BACKUP';
		busy = true;
		try {
			await wtf.deleteBackup(backup.title, installation);
			await loadBackups(installation);
		} catch (e) {
			console.error('Failed to delete backup', e);
			snackbar.showError('WTF_BACKUP.ERROR.FAILED_TO_DELETE', {
				timeout: 2000,
				localeArgs: { name: backup.title }
			});
		} finally {
			busy = false;
		}
	}

	async function onCreateBackup() {
		if (!installation) return;

		busyText = 'WTF_BACKUP.BUSY_TEXT.CREATING_BACKUP';
		busy = true;
		try {
			await wtf.createBackup(installation, (count) => (busyTextParams = { count }));
			await loadBackups(installation);
		} catch (e) {
			console.error(e);
		} finally {
			busy = false;
			busyTextParams = { count: '' };
		}
	}
</script>

<dialog class="wu-dialog wtf-backup" {@attach modalDialog()} {onclose}>
	<div class="backup-header">
		<h2>
			{t('WTF_BACKUP.DIALOG_TITLE', { clientType: installation?.displayName ?? '' })}
		</h2>
		<button
			class="wu-btn wu-btn-icon wu-btn-flat wu-btn-primary"
			aria-label={t('COMMON.CLOSE')}
			disabled={busy}
			onclick={onclose}
		>
			<Icon name="fas:xmark" />
		</button>
	</div>

	<div class="dialog-content">
		{#if busy}
			<div class="busy">
				<div class="spinner" role="status" aria-live="polite"></div>
				<div>{t(busyText, busyTextParams)}</div>
			</div>
		{:else if backups.length === 0}
			<!-- Untranslated in the Angular template too. -->
			<h4>No backups were found at:</h4>
			<p class="text-2">{backupPath}</p>
		{:else}
			<p class="text-2">{t('WTF_BACKUP.BACKUP_COUNT_TEXT', { count: backups.length })}</p>
			<ul class="backup-list">
				{#each backups as backup (backup.title)}
					<li class="backup-list-item">
						<div class="backup-info">
							<div class="title" class:text-warning={backup.error}>{backup.title}</div>
							<div class="text-2 meta">
								<span>{relativeDate(backup.date)}</span>
								<span>{backup.size}</span>
							</div>
						</div>

						{#if backup.error}
							<div class="backup-error">{t(`WTF_BACKUP.ERROR.${backup.error}`)}</div>
						{:else}
							<div class="backup-actions">
								<button
									class="wu-btn wu-btn-icon wu-btn-flat"
									title={t('WTF_BACKUP.TOOL_TIP.APPLY_BUTTON')}
									aria-label={t('WTF_BACKUP.TOOL_TIP.APPLY_BUTTON')}
									disabled={busy}
									onclick={() => void onClickApplyBackup(backup)}
								>
									<Icon name="fas:clock-rotate-left" />
								</button>
								<button
									class="wu-btn wu-btn-warning wu-btn-flat wu-btn-icon"
									title={t('WTF_BACKUP.TOOL_TIP.DELETE_BUTTON')}
									aria-label={t('WTF_BACKUP.TOOL_TIP.DELETE_BUTTON')}
									disabled={busy}
									onclick={() => void onClickDeleteBackup(backup)}
								>
									<Icon name="fas:trash" />
								</button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="dialog-actions">
		<button class="wu-btn wu-btn-flat" disabled={busy} onclick={() => void onShowFolder()}>
			{t('WTF_BACKUP.SHOW_FOLDER_BUTTON')}
		</button>
		<div class="spacer"></div>
		<button class="wu-btn wu-btn-primary" disabled={busy} onclick={() => void onCreateBackup()}>
			{t('WTF_BACKUP.CREATE_BACKUP_BUTTON')}
		</button>
	</div>
</dialog>

<style>
	.wtf-backup {
		width: min(38rem, 90vw);
		max-width: none;
	}

	.backup-header {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.backup-header h2 {
		flex: 1 1 auto;
		margin: 0;
	}

	.dialog-content {
		min-height: 12rem;
		max-height: 50vh;
		overflow-y: auto;
	}

	.busy {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		min-height: 12rem;
	}

	.spinner {
		width: 55px;
		height: 55px;
		border: 3px solid var(--overlay-border);
		border-top-color: currentcolor;
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.backup-list {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: 4px;
	}

	.backup-list-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.25rem;
		border-bottom: 1px solid var(--overlay-hover);
	}

	.backup-list-item:last-child {
		border-bottom: 0;
	}

	.backup-info {
		flex: 1 1 auto;
		min-width: 0;
	}

	.title {
		word-break: break-all;
	}

	.meta {
		display: flex;
		gap: 1rem;
		font-size: 0.85em;
	}

	.backup-error,
	.backup-actions {
		flex: none;
	}

	.backup-actions {
		display: flex;
		gap: 0.5rem;
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
