<script lang="ts">
	// Renders the dialog stack from $lib/state/dialogs.svelte.
	//
	// Ports three Angular dialog components at once — confirm (66 LOC), alert (52 LOC) and
	// external-url-confirmation (85 LOC) — because in Angular they differed only by their
	// body and button row. Native <dialog showModal()> replaces the CDK overlay: focus trap,
	// inert background, Escape and ::backdrop all come for free.

	import {
		dialogs,
		type AlertDialogData,
		type ConfirmDialogData,
		type ConsentDialogData,
		type ExternalUrlDialogData,
		type PatchNotesDialogData,
		type AddonDetailData
	} from '$lib/state/dialogs.svelte';
	import AddonDetail from '$lib/components/addons/AddonDetail.svelte';
	import { modalDialog } from '$lib/attachments/modal-dialog';
	import { t } from '$lib/i18n.svelte';
	import { AppConfig } from '$config/environment';
	import { invoke } from '$lib/ipc';
	import { IPC_OW_OPEN_CMP } from '$common/constants';
	import Toggle from './Toggle.svelte';

	// Checkbox state for the external-url dialog, keyed by dialog id.
	let trustDomain = $state<Record<string, boolean>>({});

	// Consent form state — defaults match the Angular UntypedFormGroup (both true).
	let consentTelemetry = $state(true);
	let consentWago = $state(true);

	function openCmp(section?: string) {
		invoke(IPC_OW_OPEN_CMP, section).catch((e: unknown) => console.error('open CMP failed', e));
	}

	const hostname = (url: string): string => {
		try {
			return new URL(url).hostname;
		} catch {
			return url;
		}
	};
</script>

{#each dialogs.stack as dialog (dialog.id)}
	{#if dialog.kind === 'addonDetail'}
		<!-- Addon detail has its own header, tab strip and action row rather than the shared
		     title/content/actions shell, so it renders its own <dialog>. -->
		<AddonDetail
			model={dialog.data as AddonDetailData}
			onclose={() => dialogs.dismiss(dialog.id)}
		/>
	{:else}
		{@const confirmData = dialog.data as ConfirmDialogData}
		{@const alertData = dialog.data as AlertDialogData}
		{@const urlData = dialog.data as ExternalUrlDialogData}
		{@const consentData = dialog.data as ConsentDialogData}
		{@const notesData = dialog.data as PatchNotesDialogData}

		<dialog
			class="wu-dialog"
			{@attach modalDialog(dialog.disableClose)}
			onclose={() => dialogs.dismiss(dialog.id)}
		>
			<h1 class="dialog-title">{confirmData.title}</h1>

			<div class="dialog-content">
				{#if dialog.kind === 'consent'}
					<p>{t('DIALOGS.PERMISSIONS.MESSAGE')}</p>

					<div class="consent-option">
						<Toggle bind:checked={consentTelemetry}>
							{t('DIALOGS.PERMISSIONS.TELEMETRY.TOGGLE_LABEL')}
						</Toggle>
						<small class="hint">{t('DIALOGS.PERMISSIONS.TELEMETRY.DESCRIPTION')}</small>
					</div>

					{#if AppConfig.wago.enabled}
						<div class="consent-option">
							<Toggle bind:checked={consentWago}>
								{t('DIALOGS.PERMISSIONS.WAGO.TOGGLE_LABEL')}
							</Toggle>
							<small class="hint">
								<!-- Translation contains anchor markup for the terms/data-consent links. -->
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html t('DIALOGS.PERMISSIONS.WAGO.DESCRIPTION', {
									termsUrl: AppConfig.wago.termsUrl,
									dataUrl: AppConfig.wago.dataConsentUrl
								})}
							</small>
						</div>
					{/if}

					{#if AppConfig.curseforge.enabled && consentData.requiresCmp}
						<div class="consent-option">
							<h3>{t('DIALOGS.PERMISSIONS.CURSEFORGE.TITLE')}</h3>
							<small class="hint">
								{t('DIALOGS.PERMISSIONS.CURSEFORGE.DESCRIPTION_TOP')}
								<button class="link-btn" onclick={() => openCmp('vendors')}>
									{t('DIALOGS.PERMISSIONS.CURSEFORGE.DESCRIPTION_AD_LINK')}
								</button>
								{t('DIALOGS.PERMISSIONS.CURSEFORGE.DESCRIPTION_BOTTOM')}
							</small>
						</div>
					{/if}
				{:else if dialog.kind === 'patchNotes'}
					<!-- Changelog HTML is compiled into the app, not user input. -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<div class="changelog">{@html notesData.html}</div>
				{:else}
					<!-- Was `[innerHtml]="data.message"` in the Angular dialogs. Messages are built
				     from translation strings in app code, not user input — same trust boundary. -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					<pre class="message">{@html (dialog.data as ConfirmDialogData).message}</pre>
				{/if}

				{#if dialog.kind === 'externalUrl'}
					<label class="trust-domain">
						<input
							type="checkbox"
							checked={trustDomain[dialog.id] ?? urlData.domains?.includes(hostname(urlData.url))}
							onchange={(e) => (trustDomain[dialog.id] = e.currentTarget.checked)}
						/>
						{t('DIALOGS.TRUST_DOMAIN_CHECKBOX')}
					</label>
				{/if}
			</div>

			<div class="dialog-buttons">
				{#if dialog.kind === 'confirm'}
					<button class="wu-btn wu-btn-flat" onclick={() => dialogs.close(dialog.id, false)}>
						{t(confirmData.negativeKey ?? 'DIALOGS.CONFIRM.NEGATIVE_BUTTON')}
					</button>
					<!-- replaces cdkFocusInitial -->
					<!-- svelte-ignore a11y_autofocus -->
					<button
						class="wu-btn wu-btn-primary"
						autofocus
						onclick={() => dialogs.close(dialog.id, true)}
					>
						{t(confirmData.positiveKey ?? 'DIALOGS.CONFIRM.POSITIVE_BUTTON')}
					</button>
				{:else if dialog.kind === 'externalUrl'}
					<button
						class="wu-btn wu-btn-flat"
						onclick={() => dialogs.close(dialog.id, { success: false, trustDomain: '' })}
					>
						{t('DIALOGS.CONFIRM.NEGATIVE_BUTTON')}
					</button>
					<!-- svelte-ignore a11y_autofocus -->
					<button
						class="wu-btn wu-btn-primary"
						autofocus
						onclick={() =>
							dialogs.close(dialog.id, {
								success: true,
								trustDomain:
									(trustDomain[dialog.id] ?? urlData.domains?.includes(hostname(urlData.url)))
										? hostname(urlData.url)
										: ''
							})}
					>
						{t('DIALOGS.CONFIRM.POSITIVE_BUTTON')}
					</button>
				{:else if dialog.kind === 'consent'}
					{#if consentData.requiresCmp}
						<button class="wu-btn wu-btn-flat" onclick={() => openCmp()}>Manage</button>
					{/if}
					<!-- svelte-ignore a11y_autofocus -->
					<button
						class="wu-btn wu-btn-primary"
						autofocus
						onclick={() =>
							dialogs.close(dialog.id, {
								telemetry: consentTelemetry,
								wagoProvider: consentWago
							})}
					>
						{t('DIALOGS.PERMISSIONS.POSITIVE_BUTTON')}
					</button>
				{:else}
					<!-- svelte-ignore a11y_autofocus -->
					<button
						class="wu-btn {alertData.positiveButtonStyle === 'raised'
							? 'wu-btn-flat'
							: 'wu-btn-primary'}"
						autofocus
						onclick={() => dialogs.close(dialog.id, true)}
					>
						{t(alertData.positiveButton ?? 'DIALOGS.ALERT.POSITIVE_BUTTON')}
					</button>
				{/if}
			</div>
		</dialog>
	{/if}
{/each}

<style>
	/* .wu-dialog and .dialog-title/-content are global — see styles/theme.css. Duplicating them
	   here is what left AddonDetail, AddonManageDialog and WtfBackup unstyled. */
	.message {
		white-space: pre-wrap;
		font-family: inherit;
		margin: 0;
		user-select: text;
	}

	.trust-domain {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.consent-option {
		margin-bottom: 1rem;
	}

	.consent-option h3 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}

	.hint {
		display: block;
		margin-top: 0.25rem;
		opacity: 0.75;
		max-width: 600px;
	}

	.link-btn {
		background: none;
		border: 0;
		padding: 0;
		font: inherit;
		color: var(--control-color);
		cursor: pointer;
		text-decoration: underline;
	}

	.changelog {
		user-select: text;
	}

	.dialog-buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}
</style>
