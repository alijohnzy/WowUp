<script lang="ts">
	// Port of components/common/client-selector (97 LOC).
	//
	// The Angular version derived its option list from
	//   combineLatest([wowInstallations$, anyUpdatesAvailable$]).pipe(switchMap(...))
	// where the switchMap did async work (counting updates per installation) *and* pushed
	// into a second subject as a side effect.
	//
	// The first pass of this port expressed that as an $effect with a `let cancelled = false`
	// flag and a teardown that flipped it — the hand-rolled version of what switchMap does.
	// `resource` is that pattern: sources in, async fetcher, stale results discarded.

	import { Select } from 'bits-ui';
	import Icon from './Icon.svelte';
	import { resource } from 'runed';
	import { t } from '$lib/i18n.svelte';
	import { addonService } from '$lib/state/addon.svelte';
	import { session } from '$lib/state/session.svelte';
	import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';

	interface Props {
		/** Show per-client and total update badges. */
		updates?: boolean;
	}

	let { updates = false }: Props = $props();

	// Recount whenever the installation list changes or the updatable set is re-counted. The
	// second source is read for its dependency only — the count comes from the installations.
	//
	// It tracks `updatesRevision` rather than `anyUpdatesAvailable` because the latter is a
	// boolean: installing one of three pending updates leaves it `true`, so the badge kept
	// showing the pre-install count until the last update was installed.
	const counts = resource(
		[() => warcraftInstallations.installations, () => addonService.updatesRevision],
		async ([installations]) => {
			const result: Record<string, number> = {};
			for (const installation of installations) {
				result[installation.id] = (
					await addonService.getAllAddonsAvailableForUpdate(installation)
				).length;
			}
			return result;
		},
		{ initialValue: {} }
	);

	let updateCounts = $derived(counts.current);

	let totalAvailableUpdateCt = $derived(Object.values(updateCounts).reduce((sum, n) => sum + n, 0));

	let selectedId = $derived(session.selectedWowInstallation?.id ?? '');
	let selectedLabel = $derived(session.selectedWowInstallation?.displayName ?? '');

	async function onValueChange(value: string) {
		await session.setSelectedWowInstallation(value);
	}
</script>

<div class="client-selector">
	<div class="selector-label">
		<span>{t('PAGES.MY_ADDONS.CLIENT_TYPE_SELECT_LABEL')}</span>
		{#if updates && totalAvailableUpdateCt > 0}
			<span class="update-badge badge-lg">
				{t('PAGES.MY_ADDONS.CLIENT_TYPE_SELECT_BADGE', { count: totalAvailableUpdateCt })}
			</span>
		{/if}
	</div>

	<Select.Root type="single" value={selectedId} {onValueChange} disabled={!session.enableControls}>
		<Select.Trigger class="select-trigger">
			<span class="trigger-label">{selectedLabel}</span>
			<Icon name="fas:caret-down" />
		</Select.Trigger>
		<Select.Portal>
			<Select.Content class="select-content">
				<Select.Viewport>
					{#each warcraftInstallations.installations as installation (installation.id)}
						<Select.Item
							value={installation.id}
							label={installation.displayName}
							class="select-item"
						>
							<span class="item-label">{installation.displayName}</span>
							{#if updates && (updateCounts[installation.id] ?? 0) > 0}
								<span class="update-badge">{updateCounts[installation.id]}</span>
							{/if}
							<span class="item-check"><Icon name="fas:check" /></span>
						</Select.Item>
					{/each}
				</Select.Viewport>
			</Select.Content>
		</Select.Portal>
	</Select.Root>
</div>

<style>
	.client-selector {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 200px;
	}

	.selector-label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.75rem;
		opacity: 0.8;
	}

	.update-badge {
		background: var(--control-color);
		color: #fff;
		border-radius: 999px;
		padding: 0 0.45rem;
		font-size: 0.7rem;
		line-height: 1.4;
	}

	/* mat-form-field's "fill" appearance: a tinted box with a bottom rule that thickens and
	   takes the accent colour while the panel is open. The port had drawn a plain bordered box,
	   which reads as a text input rather than a Material select. */
	:global(.select-trigger) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 0;
		border-bottom: 1px solid var(--overlay-border);
		border-radius: 4px 4px 0 0;
		background: var(--overlay-subtle);
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	:global(.select-trigger[data-state='open']) {
		border-bottom: 2px solid var(--control-color);
		padding-bottom: calc(0.45rem - 1px);
	}

	:global(.select-trigger[data-state='open']) :global(svg) {
		color: var(--control-color);
	}

	:global(.trigger-label) {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.select-trigger[data-disabled]) {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.select-content) {
		/* mat-select sized its panel to the trigger; bits-ui exposes the trigger width here. */
		min-width: var(--bits-floating-anchor-width);
		border-radius: 4px;
		padding: 0.25rem;
		/* The theme's opaque surface token. --background-secondary-2 is rgba(…, 0.9) and
		   --background-secondary-4 rgba(…, 0.8); either lets the grid behind show through. */
		background: var(--background-secondary-2-fill);
		border: 1px solid var(--overlay-border);
		box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
		z-index: 100;
	}

	:global(.select-item) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.45rem 0.6rem;
		border-radius: 3px;
		cursor: pointer;
	}

	/* mat-option in single-select: the chosen row is muted and carries an accent check on the
	   trailing edge. Reserving the check's width on every row keeps the labels aligned. */
	:global(.item-check) {
		flex: none;
		visibility: hidden;
		color: var(--control-color);
	}

	:global(.select-item[data-selected]) {
		color: var(--text-2);
	}

	:global(.select-item[data-selected]) :global(.item-check) {
		visibility: visible;
	}

	:global(.select-item[data-highlighted]) {
		background: var(--overlay-selected);
	}

	.item-label {
		flex: 1;
	}
</style>
