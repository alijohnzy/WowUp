<script lang="ts">
	// Port of components/options/wow-client-options (440 LOC).
	//
	// Removed: two BehaviorSubjects (editMode/isBusy) + a Subscription array, a getter/setter
	// pair backing `installationLabel`, Node `dirname`, and MatCard/MatFormField/MatSelect.
	//
	// The "only one card may be in edit mode" rule was an rxjs subscription on
	// `editingWowInstallationId$` filtered to *other* ids, which cancelled this card. It is
	// now a $effect watching the same shared state — same behaviour, visible in one place.

	import {
		AddonChannelType,
		getEnumList,
		getEnumName,
		WowClientType,
		type WowInstallation
	} from 'wowup-lib-core';
	import { t, i18n } from '$lib/i18n.svelte';
	import { invoke, isTauri } from '$lib/ipc';
	import { dirname } from '$lib/utils/path';
	import Icon from '$lib/components/common/Icon.svelte';
	import Toggle from '$lib/components/common/Toggle.svelte';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { session } from '$lib/state/session.svelte';
	import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';
	import { warcraft } from '$lib/state/warcraft.svelte';
	import { clientColor, colorSwatches, defaultClientColor } from '$lib/utils/client-color';

	interface Props {
		installationId: string;
		index: number;
	}

	let { installationId, index }: Props = $props();

	const ADDON_CHANNELS = getEnumList(AddonChannelType).map((type) => ({
		type: type as AddonChannelType,
		name: `COMMON.ENUM.ADDON_CHANNEL_TYPE.${getEnumName(AddonChannelType, type as number).toUpperCase()}`
	}));

	let installation = $derived(warcraftInstallations.getWowInstallation(installationId));
	let installationCount = $derived(warcraftInstallations.installations.length);

	let editMode = $state(false);
	let isBusy = $state(false);
	let executableName = $state('');

	/** Working copy — discarded on cancel, written through on save. */
	let model = $state<WowInstallation | undefined>(undefined);

	const clientTypeKey = (type: WowClientType) =>
		`COMMON.CLIENT_TYPES.${getEnumName(WowClientType, type).toUpperCase()}`;

	let clientTypeName = $derived(installation ? clientTypeKey(installation.clientType) : '');

	// The color that frames this client's addon tables (utils/client-color.ts). Shown from the
	// working copy, so the card previews a pick before it is saved.
	let color = $derived(model ? clientColor(model) : undefined);
	let swatches = $derived(colorSwatches(installation?.clientType));
	let customColor = $derived(!!color && !swatches.some((s) => s.color === color));

	function setColor(value: string) {
		if (!model) return;
		const picked = value.toLowerCase();
		// The default is stored as no color, so the client keeps following its type's default.
		model.color = picked === defaultClientColor(model.clientType) ? undefined : picked;
	}

	function wowLogoImage(clientType: WowClientType | undefined): string {
		switch (clientType) {
			case WowClientType.ClassicEra:
			case WowClientType.ClassicEraPtr:
				return './assets/images/wow-classic-logo.png';
			case WowClientType.Retail:
			case WowClientType.RetailPtr:
			case WowClientType.Beta:
			case WowClientType.RetailXPtr:
				return './assets/images/wow-midnight-logo.png';
			case WowClientType.Classic:
			case WowClientType.ClassicPtr:
				return './assets/images/wow-classic-mists-logo.png';
			case WowClientType.Forever:
			case WowClientType.ClassicBeta:
				return './assets/images/wow-forever-logo.png';
			case WowClientType.Anniversary:
				return './assets/images/wow-classic-tbc-logo.png';
			default:
				return '';
		}
	}

	async function resetModel() {
		if (!installation) return;
		// updateFromTray is absent on every client saved before it existed, and Svelte refuses
		// bind:checked={undefined} on a Toggle (its prop has a fallback) — the card would not render.
		const copy = { ...installation, updateFromTray: installation.updateFromTray ?? false };
		model = copy;
		try {
			copy.label = await warcraftInstallations.getInstallationDisplayName(installation);
		} catch (e) {
			console.error(e);
		}
	}

	$effect(() => {
		void installationId;
		void resetModel();
	});

	$effect(() => {
		if (!installation) return;
		warcraft
			.getExecutableName(installation.clientType)
			.then((name) => (executableName = name))
			.catch(console.error);
	});

	// Editing another card cancels this one — was a filtered subscription in the constructor.
	$effect(() => {
		if (session.editingWowInstallationId !== installationId && editMode) {
			void resetModel();
			editMode = false;
		}
	});

	function onClickEdit() {
		editMode = true;
		session.editingWowInstallationId = installationId;
	}

	function onClickCancel() {
		void resetModel();
		editMode = false;
	}

	async function onClickSave() {
		if (!model) return;
		isBusy = true;
		try {
			await warcraftInstallations.updateWowInstallation({ ...model });
		} catch (e) {
			console.error(e);
		} finally {
			isBusy = false;
			editMode = false;
		}
	}

	async function onClickRemove() {
		if (!installation) return;

		const confirmed = await dialogs.confirm({
			title: t('PAGES.OPTIONS.WOW.CLEAR_INSTALL_LOCATION_DIALOG.TITLE'),
			message: i18n.t('PAGES.OPTIONS.WOW.CLEAR_INSTALL_LOCATION_DIALOG.MESSAGE', {
				location: installation.location
			})
		});

		if (!confirmed) return;
		await warcraftInstallations.removeWowInstallation(installation);
	}

	async function onClickOpenFolder() {
		if (!installation) return;
		try {
			await invoke('show-item-in-folder', dirname(installation.location));
		} catch (e) {
			console.error(e);
		}
	}

	const move = (direction: number) =>
		warcraftInstallations.reOrderInstallation(installationId, direction).catch(console.error);
</script>

{#if model}
	<section class="installation-card" style:--client-color={color}>
		<div class="wow-install-logo-container">
			{#if wowLogoImage(installation?.clientType)}
				<img src={wowLogoImage(installation?.clientType)} alt="" />
			{/if}
		</div>

		<header class="card-header">
			{#if editMode}
				<input class="label-input" bind:value={model.label} aria-label="Installation name" />
			{:else}
				<h3>{model.displayName}</h3>
			{/if}
		</header>

		<div class="card-content">
			<label class="field">
				<span class="field-label">
					{i18n.t('PAGES.OPTIONS.WOW.CLIENT_TYPE_PATH_LABEL', {
						clientTypeName: t(clientTypeName)
					})}
				</span>
				<input class="path-input" value={model.location} disabled />
				<small class="text-2">
					{i18n.t('PAGES.OPTIONS.WOW.CLIENT_TYPE_INPUT_HINT', {
						clientTypeName: t(clientTypeName).toLowerCase(),
						clientFolderName: executableName
					})}
				</small>
			</label>

			<div class="row color-row">
				<div class="grow">
					<p>{t('PAGES.OPTIONS.WOW.COLOR_LABEL')}</p>
					<small class="text-2">{t('PAGES.OPTIONS.WOW.COLOR_DESCRIPTION')}</small>
				</div>
				<div class="swatches" class:editing={editMode}>
					{#each swatches as swatch, i (swatch.clientType)}
						{@const label =
							i === 0 ? t('PAGES.OPTIONS.WOW.COLOR_DEFAULT') : t(clientTypeKey(swatch.clientType))}
						<button
							type="button"
							class="swatch"
							class:own-default={i === 0}
							style:background-color={swatch.color}
							aria-pressed={color === swatch.color}
							aria-label={label}
							title={label}
							disabled={!editMode}
							onclick={() => setColor(swatch.color)}
						></button>
					{/each}
					<label
						class="swatch custom"
						class:chosen={customColor}
						style:background-color={customColor ? color : undefined}
						title={t('PAGES.OPTIONS.WOW.COLOR_CUSTOM')}
					>
						<input
							type="color"
							value={color ?? '#ffffff'}
							disabled={!editMode}
							aria-label={t('PAGES.OPTIONS.WOW.COLOR_CUSTOM')}
							oninput={(e) => setColor(e.currentTarget.value)}
						/>
						{#if !customColor}<Icon name="fas:palette" />{/if}
					</label>
				</div>
			</div>

			<div class="row">
				<p class="grow">{t('PAGES.OPTIONS.WOW.DEFAULT_ADDON_CHANNEL_LABEL')}</p>
				<label class="field compact">
					<span class="field-label">
						{t('PAGES.OPTIONS.WOW.DEFAULT_ADDON_CHANNEL_SELECT_LABEL')}
					</span>
					<select bind:value={model.defaultAddonChannelType} disabled={!editMode}>
						{#each ADDON_CHANNELS as channel (channel.type)}
							<option value={channel.type}>{t(channel.name)}</option>
						{/each}
					</select>
				</label>
			</div>

			<div class="row">
				<div class="grow">
					<p>{t('PAGES.OPTIONS.WOW.AUTO_UPDATE_LABEL')}</p>
					<small class="text-2">{t('PAGES.OPTIONS.WOW.AUTO_UPDATE_DESCRIPTION')}</small>
				</div>
				<Toggle bind:checked={model.defaultAutoUpdate} disabled={!editMode} />
			</div>

			<!-- Only the Tauri tray has an Update All item; Electron's has nothing to act on. -->
			{#if isTauri()}
				<div class="row">
					<div class="grow">
						<p>{t('PAGES.OPTIONS.WOW.UPDATE_FROM_TRAY_LABEL')}</p>
						<small class="text-2">{t('PAGES.OPTIONS.WOW.UPDATE_FROM_TRAY_DESCRIPTION')}</small>
					</div>
					<Toggle bind:checked={model.updateFromTray} disabled={!editMode} />
				</div>
			{/if}
		</div>

		<footer class="card-actions">
			{#if editMode}
				<button class="wu-btn wu-btn-flat wu-btn-warning" disabled={isBusy} onclick={onClickRemove}>
					{t('PAGES.OPTIONS.WOW.REMOVE_WOW_DIRECTORY_SELECT_BUTTON')}
				</button>
				<div class="grow"></div>
				<button class="wu-btn wu-btn-flat" disabled={isBusy} onclick={onClickCancel}>
					{t('PAGES.OPTIONS.WOW.CANCEL_WOW_DIRECTORY_SELECT_BUTTON')}
				</button>
				<button class="wu-btn wu-btn-primary" disabled={isBusy} onclick={onClickSave}>
					{t('PAGES.OPTIONS.WOW.SAVE_WOW_DIRECTORY_SELECT_BUTTON')}
				</button>
			{:else}
				<button class="wu-btn wu-btn-flat" onclick={onClickOpenFolder}>
					{t('PAGES.OPTIONS.WOW.OPEN_FOLDER_BUTTON')}
				</button>
				<div class="grow"></div>
				{#if index > 0}
					<button
						class="wu-btn wu-btn-flat wu-btn-icon"
						disabled={isBusy}
						title={t('PAGES.OPTIONS.WOW.MOVE_UP_BUTTON')}
						aria-label={t('PAGES.OPTIONS.WOW.MOVE_UP_BUTTON')}
						onclick={() => move(-1)}
					>
						<Icon name="fas:angle-up" />
					</button>
				{/if}
				{#if index < installationCount - 1}
					<button
						class="wu-btn wu-btn-flat wu-btn-icon"
						disabled={isBusy}
						title={t('PAGES.OPTIONS.WOW.MOVE_DOWN_BUTTON')}
						aria-label={t('PAGES.OPTIONS.WOW.MOVE_DOWN_BUTTON')}
						onclick={() => move(1)}
					>
						<Icon name="fas:angle-down" />
					</button>
				{/if}
				<button class="wu-btn wu-btn-primary" onclick={onClickEdit}>
					{t('PAGES.OPTIONS.WOW.EDIT_WOW_DIRECTORY_SELECT_BUTTON')}
				</button>
			{/if}
		</footer>
	</section>
{/if}

<style>
	.installation-card {
		position: relative;
		border-radius: 6px;
		/* The client's color down the leading edge, as on its addon tables. */
		border-left: 4px solid var(--client-color, transparent);
		padding: 1rem;
		margin-bottom: 1rem;
		background: var(--background-secondary-4);
		overflow: hidden;
	}

	/* Values taken from wow-client-options.component.scss: a 145px-tall watermark at 8% opacity,
	   inset a quarter-em from the corner. The port had it at 72px and 25% — half the size and
	   three times as opaque, which reads as a small solid badge rather than a watermark. */
	.wow-install-logo-container {
		position: absolute;
		top: 0.25em;
		right: 0.25em;
		height: 145px;
		pointer-events: none;
	}

	.wow-install-logo-container img {
		height: 100%;
		opacity: 0.08;
	}

	.card-header h3 {
		margin: 0 0 0.75rem;
	}

	.label-input,
	.path-input {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--overlay-border);
		background: var(--overlay-subtle);
		color: inherit;
		font: inherit;
	}

	.path-input:disabled {
		opacity: 0.7;
	}

	.field {
		display: block;
		margin-bottom: 1rem;
	}

	.field.compact {
		margin-bottom: 0;
		min-width: 180px;
	}

	.field-label {
		display: block;
		font-size: 0.75rem;
		opacity: 0.8;
		margin-bottom: 0.2rem;
	}

	select {
		width: 100%;
		padding: 0.4rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--overlay-border);
		background: var(--overlay-subtle);
		color: inherit;
		font: inherit;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.row p {
		margin: 0;
	}

	.grow {
		flex: 1;
	}

	.color-row {
		flex-wrap: wrap;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		color: var(--text-1);
		cursor: pointer;
	}

	/* This client's own default, set apart from the other clients' colors. */
	.swatch.own-default {
		margin-right: 6px;
	}

	.swatch[aria-pressed='true'],
	.swatch.chosen {
		outline: 2px solid var(--text-1);
		outline-offset: 2px;
	}

	/* Out of edit mode the choice is shown, the rest stay back. */
	.swatches:not(.editing) .swatch {
		cursor: default;
	}

	.swatches:not(.editing) .swatch:not([aria-pressed='true'], .chosen) {
		opacity: 0.35;
	}

	.swatch.custom {
		background: var(--overlay-subtle);
		border: 1px dashed var(--overlay-border);
		font-size: 0.7rem;
	}

	.swatch.custom.chosen {
		border-style: solid;
	}

	/* The native picker covers the swatch, so a click anywhere on it opens the dialog. */
	.swatch.custom input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: inherit;
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
