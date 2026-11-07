<script lang="ts">
	// My Addons → right-click → "Copy settings from" → a flavor.
	//
	// Searches both WTF folders for the addon's saved settings, then lets the user match them
	// up: for each account and each character in the target flavor, which account or
	// character of the source flavor its settings should come from. The same realm and name,
	// or the only account on each side, is preselected; everything else keeps its own
	// settings until the user picks a source. Copying backs up the target's WTF folder first.

	import { onMount } from 'svelte';
	import type { Addon, WowInstallation } from 'wowup-lib-core';
	import { i18n, t } from '$lib/i18n.svelte';
	import { modalDialog } from '$lib/attachments/modal-dialog';
	import Icon from '$lib/components/common/Icon.svelte';
	import ProgressSpinner from '$lib/components/common/ProgressSpinner.svelte';
	import {
		planCopy,
		suggestChoices,
		withSettings,
		type SettingsChoices,
		type SettingsInventory,
		type SettingsScope
	} from '$lib/services/addon-settings-copy';
	import { backupAndCopy, CopySettingsError, scanBoth } from '$lib/services/copy-addon-settings';
	import { snackbar } from '$lib/state/snackbar.svelte';

	interface Props {
		addon: Addon;
		/** The flavor to copy from. */
		source: WowInstallation;
		/** The flavor the addon is listed under, which receives the settings. */
		target: WowInstallation;
		onclose: (copied: boolean) => void;
	}

	let { addon, source, target, onclose }: Props = $props();

	const KEY = 'PAGES.MY_ADDONS.COPY_SETTINGS';
	/** Select value for "keep this one's own settings". */
	const KEEP = '';
	/** Select value of the "Set all listed to…" prompt, which is not a choice itself. */
	const SET_ALL_PROMPT = '__set-all__';

	let dialog = $state<HTMLDialogElement>();
	let scan = $state<{ source: SettingsInventory; target: SettingsInventory }>();
	let readError = $state('');
	let choices = $state<SettingsChoices>({});
	let filter = $state('');
	let busy = $state(false);
	let copyError = $state('');
	let copied = false;

	let names = $derived({
		addonName: addon.name,
		source: source.displayName,
		target: target.displayName,
		backupLabel: t('PAGES.MY_ADDONS.WTF_BACKUP_BUTTON')
	});

	onMount(() => {
		let cancelled = false;
		scanBoth(addon, source, target).then(
			(result) => {
				if (cancelled) return;
				scan = result;
				choices = suggestChoices(result.source, result.target);
			},
			(e: unknown) => {
				if (!cancelled) readError = i18n.t(`${KEY}.READ_FAILED`, { error: String(e) });
			}
		);
		return () => (cancelled = true);
	});

	let sourceAccounts = $derived(scan ? withSettings(scan.source.accounts) : []);
	let sourceCharacters = $derived(scan ? withSettings(scan.source.characters) : []);
	let nothingFound = $derived(
		!!scan && sourceAccounts.length === 0 && sourceCharacters.length === 0
	);
	let plan = $derived(scan ? planCopy(scan.source, scan.target, choices) : { files: [] });

	// Accounts are only named next to characters when there is more than one to tell apart.
	const accountCount = (scopes: SettingsScope[]) => new Set(scopes.map((s) => s.account)).size;
	let nameSourceAccounts = $derived(accountCount(sourceCharacters) > 1);
	let nameTargetAccounts = $derived(scan ? accountCount(scan.target.characters) > 1 : false);

	const characterLabel = (s: SettingsScope, withAccount: boolean) =>
		`${s.character} – ${s.realm}${withAccount ? ` (${s.account})` : ''}`;

	let shownCharacters = $derived.by(() => {
		const all = scan?.target.characters ?? [];
		const q = filter.trim().toLowerCase();
		if (!q) return all;
		return all.filter((c) =>
			[c.character, c.realm, c.account].some((v) => v?.toLowerCase().includes(q))
		);
	});

	function choose(targetKey: string, sourceKey: string) {
		if (sourceKey === KEEP) delete choices[targetKey];
		else choices[targetKey] = sourceKey;
	}

	function setAllShown(select: HTMLSelectElement) {
		for (const c of shownCharacters) choose(c.key, select.value);
		select.value = SET_ALL_PROMPT;
	}

	async function copy() {
		if (plan.files.length === 0 || busy) return;
		busy = true;
		copyError = '';
		try {
			await backupAndCopy(target, plan);
		} catch (e) {
			busy = false;
			const failure = e instanceof CopySettingsError ? e : new CopySettingsError('copy', e);
			console.error('[copy-settings]', failure.stage, failure.cause);
			copyError = i18n.t(
				failure.stage === 'backup' ? `${KEY}.BACKUP_FAILED` : `${KEY}.COPY_FAILED`,
				{ ...names, error: String(failure.cause) }
			);
			return;
		}
		copied = true;
		snackbar.showSuccess(`${KEY}.SUCCESS`, { localeArgs: names });
		dialog?.close();
	}
</script>

<dialog
	bind:this={dialog}
	class="wu-dialog copy-settings"
	{@attach modalDialog()}
	oncancel={(e) => busy && e.preventDefault()}
	onclose={() => onclose(copied)}
>
	<h1 class="dialog-title">{i18n.t(`${KEY}.TITLE`, names)}</h1>

	<div class="dialog-content">
		<p class="route text-2">{i18n.t(`${KEY}.FROM_TO`, names)}</p>

		{#if readError}
			<p class="message error">{readError}</p>
		{:else if !scan}
			<ProgressSpinner message={t(`${KEY}.SEARCHING`)} />
		{:else if nothingFound}
			<p class="message">{i18n.t(`${KEY}.NOTHING_FOUND`, names)}</p>
		{:else if scan.target.accounts.length === 0}
			<p class="message">{i18n.t(`${KEY}.NO_TARGET_ACCOUNTS`, names)}</p>
		{:else}
			<div class="warning">
				<Icon name="fas:triangle-exclamation" />
				<p class="message">{t(`${KEY}.WARNING`)}</p>
			</div>

			<section>
				<h2>{t(`${KEY}.ACCOUNT_SECTION`)}</h2>
				{#if sourceAccounts.length === 0}
					<p class="text-3">{i18n.t(`${KEY}.NO_ACCOUNT_SETTINGS`, names)}</p>
				{:else}
					<div class="match-grid">
						<span class="column-header text-3">
							{i18n.t(`${KEY}.TARGET_ACCOUNT_HEADER`, names)}
						</span>
						<span class="column-header text-3">{i18n.t(`${KEY}.COPY_FROM_HEADER`, names)}</span>
						{#each scan.target.accounts as row (row.key)}
							<span class="scope-name">
								{row.account}
								{#if row.files.length === 0}
									<span class="no-settings text-3">{t(`${KEY}.NO_SETTINGS_YET`)}</span>
								{/if}
							</span>
							<select
								value={choices[row.key] ?? KEEP}
								disabled={busy}
								onchange={(e) => choose(row.key, e.currentTarget.value)}
							>
								<option value={KEEP}>{t(`${KEY}.KEEP_CURRENT`)}</option>
								{#each sourceAccounts as s (s.key)}
									<option value={s.key}>{s.account}</option>
								{/each}
							</select>
						{/each}
					</div>
				{/if}
			</section>

			<section>
				<h2>{t(`${KEY}.CHARACTER_SECTION`)}</h2>
				{#if sourceCharacters.length === 0}
					<p class="text-3">{i18n.t(`${KEY}.NO_CHARACTER_SETTINGS`, names)}</p>
				{:else if scan.target.characters.length === 0}
					<p class="text-3">{i18n.t(`${KEY}.NO_TARGET_CHARACTERS`, names)}</p>
				{:else}
					<div class="tools">
						<input
							type="search"
							placeholder={t(`${KEY}.FILTER_PLACEHOLDER`)}
							bind:value={filter}
							disabled={busy}
						/>
						<select
							value={SET_ALL_PROMPT}
							disabled={busy || shownCharacters.length === 0}
							onchange={(e) => setAllShown(e.currentTarget)}
						>
							<option value={SET_ALL_PROMPT} disabled>{t(`${KEY}.SET_ALL`)}</option>
							<option value={KEEP}>{t(`${KEY}.KEEP_CURRENT`)}</option>
							{#each sourceCharacters as s (s.key)}
								<option value={s.key}>{characterLabel(s, nameSourceAccounts)}</option>
							{/each}
						</select>
					</div>

					<div class="match-grid characters">
						<span class="column-header text-3">
							{i18n.t(`${KEY}.TARGET_CHARACTER_HEADER`, names)}
						</span>
						<span class="column-header text-3">{i18n.t(`${KEY}.COPY_FROM_HEADER`, names)}</span>
						{#each shownCharacters as row (row.key)}
							<span class="scope-name">
								{characterLabel(row, nameTargetAccounts)}
								{#if row.files.length === 0}
									<span class="no-settings text-3">{t(`${KEY}.NO_SETTINGS_YET`)}</span>
								{/if}
							</span>
							<select
								value={choices[row.key] ?? KEEP}
								disabled={busy}
								onchange={(e) => choose(row.key, e.currentTarget.value)}
							>
								<option value={KEEP}>{t(`${KEY}.KEEP_CURRENT`)}</option>
								{#each sourceCharacters as s (s.key)}
									<option value={s.key}>{characterLabel(s, nameSourceAccounts)}</option>
								{/each}
							</select>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</div>

	{#if scan && !nothingFound && scan.target.accounts.length > 0}
		<div class="summary">
			<strong>{i18n.t(`${KEY}.SUMMARY`, { count: plan.files.length })}</strong>
			<span class="text-2">{i18n.t(`${KEY}.BACKUP_NOTE`, names)}</span>
			{#if copyError}
				<p class="message error">{copyError}</p>
			{/if}
		</div>
	{/if}

	<div class="dialog-buttons">
		<button class="wu-btn wu-btn-flat" disabled={busy} onclick={() => dialog?.close()}>
			{t(`${KEY}.CANCEL_BUTTON`)}
		</button>
		<button
			class="wu-btn wu-btn-primary"
			disabled={busy || plan.files.length === 0}
			onclick={() => void copy()}
		>
			{busy ? t(`${KEY}.IN_PROGRESS`) : t(`${KEY}.CONFIRM_BUTTON`)}
		</button>
	</div>
</dialog>

<style>
	.copy-settings {
		width: min(680px, 92vw);
		max-height: 92vh;
	}

	/* One scroll area — the matching lists — between a fixed header and a fixed summary and
	   button row, using the height the window has rather than the shared 60vh cap. Only while
	   open: display on a closed <dialog> would show it. */
	.copy-settings[open] {
		display: flex;
		flex-direction: column;
	}

	.copy-settings .dialog-content {
		flex: 1 1 auto;
		min-height: 0;
		max-height: none;
	}

	.route {
		margin: 0 0 0.75rem;
	}

	.message {
		margin: 0;
		white-space: pre-wrap;
	}

	.error {
		color: var(--warn-color);
	}

	.warning {
		font-size: 0.85rem;
		display: flex;
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.6rem 0.75rem;
		border-radius: 4px;
		background: color-mix(in srgb, var(--warn-color) 12%, transparent);
	}

	.warning :global(svg) {
		flex: none;
		margin-top: 0.15rem;
		color: var(--warn-color);
	}

	section {
		margin-top: 1rem;
	}

	h2 {
		margin: 0 0 0.4rem;
		font-size: 1rem;
	}

	.tools {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.tools input {
		flex: 1 1 auto;
		min-width: 8rem;
	}

	.tools select {
		flex: 0 1 45%;
		min-width: 0;
	}

	.match-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.35rem 0.75rem;
		align-items: center;
	}

	.column-header {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.scope-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.no-settings {
		margin-left: 0.35rem;
		font-size: 0.75rem;
	}

	.match-grid select {
		min-width: 0;
		width: 100%;
	}

	.summary {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--divider-color);
		font-size: 0.85rem;
	}
</style>
