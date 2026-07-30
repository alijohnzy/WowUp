<script lang="ts">
	// Port of src/app/pages/get-addons/get-addons.component.{ts,html} (890 LOC).
	//
	// Removed: ChangeDetectorRef, 5 Subjects, a takeUntil(destroy$) teardown, MatDrawer
	// (the category panel), MatMenu (the column context menu), and the two pipes that were
	// injected as services so their `transform` could be called from column definitions.
	//
	// The `selectedAddonCategory` setter in the Angular version performed an async load as a
	// side effect of assignment — selecting a category kicked off a five-operator rxjs chain
	// from inside a property setter. Here selection is state and loading is an explicit call.

	import type {
		ColDef,
		GridApi,
		IRowNode,
		RowClickedEvent,
		RowDoubleClickedEvent
	} from 'ag-grid-community';
	import {
		AddonCategory,
		getEnumKeys,
		type AddonChannelType,
		type AddonSearchResult,
		type WowInstallation
	} from 'wowup-lib-core';
	import { DEFAULT_CHANNEL_PREFERENCE_KEY_SUFFIX } from '$common/constants';
	import { GetAddonListItem } from '$lib/business-objects/get-addon-list-item';
	import { GenericProviderError } from '$lib/errors';
	import type { ColumnState } from '$lib/models/column-state';
	import { t, i18n } from '$lib/i18n.svelte';
	import { camelToSnakeCase, getRelativeDateFormat } from '$lib/utils/string';
	import { downloadCount } from '$lib/utils/format';
	import * as _ from '$lib/utils/collection';

	import AgGrid from '$lib/components/grid/AgGrid.svelte';
	import { svelteCellRenderer } from '$lib/components/grid/svelte-cell-renderer.svelte';
	import PotentialAddonCell from '$lib/components/grid/PotentialAddonCell.svelte';
	import GetAddonStatusCell from '$lib/components/grid/GetAddonStatusCell.svelte';
	import TableContextHeaderCell from '$lib/components/grid/TableContextHeaderCell.svelte';
	import ClientSelector from '$lib/components/common/ClientSelector.svelte';
	import Icon from '$lib/components/common/Icon.svelte';
	import ProgressSpinner from '$lib/components/common/ProgressSpinner.svelte';
	import InstallFromUrlDialog from '$lib/components/addons/InstallFromUrlDialog.svelte';

	import { addonService } from '$lib/state/addon.svelte';
	import { addonProviders } from '$lib/state/addon-providers.svelte';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { session } from '$lib/state/session.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { wowup } from '$lib/state/wowup.svelte';

	interface CategoryItem {
		category: AddonCategory;
		localeKey: string;
	}

	let query = $state('');
	let rowData = $state<GetAddonListItem[]>([]);
	let showTable = $state(false);
	let showCategories = $state(false);
	let showInstallFromUrl = $state(false);
	let gridApi = $state<GridApi | undefined>(undefined);
	let lastSelection: IRowNode[] = [];

	let columnStates = $state<ColumnState[]>([
		{
			name: 'name',
			display: 'PAGES.GET_ADDONS.TABLE.ADDON_COLUMN_HEADER',
			visible: true,
			allowToggle: false
		},
		{
			name: 'downloadCount',
			display: 'PAGES.GET_ADDONS.TABLE.DOWNLOAD_COUNT_COLUMN_HEADER',
			visible: true,
			allowToggle: true
		},
		{
			name: 'releasedAt',
			display: 'PAGES.GET_ADDONS.TABLE.RELEASED_AT_COLUMN_HEADER',
			visible: true,
			allowToggle: true
		},
		{
			name: 'author',
			display: 'PAGES.GET_ADDONS.TABLE.AUTHOR_COLUMN_HEADER',
			visible: true,
			allowToggle: true
		},
		{
			name: 'providerName',
			display: 'PAGES.GET_ADDONS.TABLE.PROVIDER_COLUMN_HEADER',
			visible: true,
			allowToggle: false
		},
		{ name: 'status', display: 'PAGES.GET_ADDONS.TABLE.STATUS_COLUMN_HEADER', visible: true }
	]);

	const categories: CategoryItem[] = buildCategories();
	let selectedCategory = $state<CategoryItem>(categories[0]);

	let selectedInstallation = $derived(session.selectedWowInstallation);
	let defaultAddonChannel = $derived(selectedInstallation?.defaultAddonChannelType);

	function buildCategories(): CategoryItem[] {
		const items = getEnumKeys(AddonCategory)
			.filter((key) => key.toLowerCase() !== 'unknown')
			.map((key) => ({
				category: (AddonCategory as unknown as Record<string, AddonCategory>)[key],
				localeKey: `COMMON.ADDON_CATEGORIES.${camelToSnakeCase(key).toUpperCase()}`
			}));

		// "All Addons" is always first.
		const allAddons = _.remove(items, (item) => item.category === AddonCategory.AllAddons);
		items.unshift(allAddons[0]);
		return items;
	}

	// ---- grid ----------------------------------------------------------------------

	/** Ties on the sorted column fall back to the canonical name, so order is stable. */
	function compareElement(nodeA: IRowNode, nodeB: IRowNode, prop: string): number {
		const a = (nodeA.data as Record<string, unknown>)[prop];
		const b = (nodeB.data as Record<string, unknown>)[prop];

		if (a === b) {
			const ca = (nodeA.data as GetAddonListItem).canonicalName;
			const cb = (nodeB.data as GetAddonListItem).canonicalName;
			if (ca === cb) return 0;
			return ca > cb ? 1 : -1;
		}
		return (a as number) > (b as number) ? 1 : -1;
	}

	function onHeaderContext(event: MouseEvent) {
		event.preventDefault();
		showColumnMenuAt = { x: event.clientX, y: event.clientY };
	}

	let showColumnMenuAt = $state<{ x: number; y: number } | undefined>(undefined);

	let columnDefs = $derived<ColDef[]>(
		(() => {
			const base = {
				headerComponent: svelteCellRenderer(TableContextHeaderCell as never),
				headerComponentParams: { onHeaderContext },
				cellStyle: {
					lineHeight: '62px',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center'
				},
				suppressMovable: true
			};

			const hidden = (name: string) => !columnStates.find((c) => c.name === name)?.visible;

			return [
				{
					field: 'name',
					flex: 2,
					sortable: true,
					headerName: t('PAGES.GET_ADDONS.TABLE.ADDON_COLUMN_HEADER'),
					cellRenderer: svelteCellRenderer(PotentialAddonCell as never),
					cellRendererParams: { channel: defaultAddonChannel, onViewDetails: openDetailDialog },
					valueGetter: (params) => (params.data as GetAddonListItem)?.canonicalName,
					...base
				},
				{
					field: 'downloadCount',
					flex: 1,
					sortable: true,
					hide: hidden('downloadCount'),
					headerName: t('PAGES.GET_ADDONS.TABLE.DOWNLOAD_COUNT_COLUMN_HEADER'),
					valueFormatter: (row) => downloadCount((row.data as GetAddonListItem).downloadCount),
					comparator: (_a, _b, na, nb) => compareElement(na, nb, 'downloadCount'),
					...base
				},
				{
					field: 'releasedAt',
					flex: 1,
					sortable: true,
					hide: hidden('releasedAt'),
					headerName: t('PAGES.GET_ADDONS.TABLE.RELEASED_AT_COLUMN_HEADER'),
					valueFormatter: (row) => {
						const [fmt, args] = getRelativeDateFormat(
							new Date((row.data as GetAddonListItem).releasedAt).toISOString()
						);
						return fmt ? i18n.t(fmt, args) : '';
					},
					comparator: (_a, _b, na, nb) => compareElement(na, nb, 'releasedAt'),
					...base
				},
				{
					field: 'author',
					flex: 1,
					sortable: true,
					// Was CellWrapTextComponent — a whole ag-grid renderer component whose entire
					// job was a 3-line clamp. It is CSS, so it is CSS.
					cellClass: 'cell-wrap-text',
					hide: hidden('author'),
					headerName: t('PAGES.GET_ADDONS.TABLE.AUTHOR_COLUMN_HEADER'),
					comparator: (_a, _b, na, nb) => compareElement(na, nb, 'author'),
					...base
				},
				{
					field: 'providerName',
					flex: 1,
					sortable: true,
					headerName: t('PAGES.GET_ADDONS.TABLE.PROVIDER_COLUMN_HEADER'),
					comparator: (_a, _b, na, nb) => compareElement(na, nb, 'providerName'),
					...base
				},
				{
					field: 'status',
					flex: 1,
					headerName: t('PAGES.GET_ADDONS.TABLE.STATUS_COLUMN_HEADER'),
					cellRenderer: svelteCellRenderer(GetAddonStatusCell as never),
					...base
				}
			] satisfies ColDef[];
		})()
	);

	let gridOptions = $derived({
		columnDefs,
		rowSelection: 'single' as const,
		suppressMultiSort: true,
		rowHeight: 63,
		overlayNoRowsTemplate: `<span class="text-1">${t('COMMON.SEARCH.NO_ADDONS')}</span>`,
		onRowClicked,
		onRowDoubleClicked
	});

	function onRowClicked(event: RowClickedEvent) {
		const selectedNodes = event.api.getSelectedNodes();
		const data = event.node.data as GetAddonListItem;
		const previous = lastSelection[0]?.data as GetAddonListItem | undefined;

		// Clicking the already-selected single row deselects it.
		if (
			selectedNodes.length === 1 &&
			lastSelection.length === 1 &&
			data.externalId === previous?.externalId &&
			data.providerName === previous?.providerName
		) {
			event.node.setSelected(false);
			lastSelection = [];
		} else {
			lastSelection = [...selectedNodes];
		}
	}

	function onRowDoubleClicked(evt: RowDoubleClickedEvent) {
		if (defaultAddonChannel === undefined) return;
		const data = evt.data as GetAddonListItem;
		openDetailDialog({ searchResult: data.searchResult, channelType: defaultAddonChannel });
		evt.node.setSelected(true);
	}

	async function openDetailDialog(evt: {
		searchResult: AddonSearchResult;
		channelType: AddonChannelType;
	}) {
		await dialogs.addonDetail({
			searchResult: evt.searchResult,
			channelType: evt.channelType
		});
	}

	// ---- loading -------------------------------------------------------------------

	function formatAddons(addons: AddonSearchResult[]): GetAddonListItem[] {
		return addons
			.map((addon) => {
				try {
					return new GetAddonListItem(addon, defaultAddonChannel);
				} catch (e) {
					console.error('formatAddons', e, addon);
					return undefined;
				}
			})
			.filter((item): item is GetAddonListItem => item !== undefined);
	}

	async function withLoading(load: () => Promise<AddonSearchResult[]>) {
		session.setEnableControls(false);
		showTable = false;

		try {
			rowData = formatAddons(await load());
		} catch (error) {
			console.error(error);
			rowData = [];
			displayError(error as Error);
		} finally {
			showTable = true;
			session.setEnableControls(true);
		}
	}

	// A provider failing is routine — one of several sources being unreachable should not block
	// the page. The original used a snackbar and named the provider; this port used a modal
	// alert with the raw message, which covered the grid until dismissed.
	function displayError(error: Error) {
		if (error instanceof GenericProviderError) {
			snackbar.showError('COMMON.PROVIDER_ERROR', { localeArgs: { providerName: error.message } });
		} else {
			snackbar.showError('PAGES.MY_ADDONS.ERROR_SNACKBAR');
		}
	}

	async function loadPopularAddons(installation: WowInstallation | undefined) {
		if (!installation) return;

		if (addonProviders.getEnabledAddonProviders().length === 0) {
			rowData = [];
			showTable = true;
			session.setEnableControls(true);
			return;
		}

		await withLoading(() => addonService.getFeaturedAddons(installation));
	}

	async function selectCategory(item: CategoryItem) {
		selectedCategory = item;
		showCategories = false;

		if (!selectedInstallation) return;

		if (item.category === AddonCategory.AllAddons) {
			await loadPopularAddons(selectedInstallation);
			return;
		}

		await withLoading(() => addonService.getCategoryPage(item.category, selectedInstallation!));
	}

	async function onSearch() {
		if (!selectedInstallation) return;

		selectedCategory = categories[0];

		if (!query) {
			await loadPopularAddons(selectedInstallation);
			return;
		}

		await withLoading(() => addonService.search(query, selectedInstallation!));
	}

	const onRefresh = () => void (query ? onSearch() : loadPopularAddons(selectedInstallation));

	function onClearSearch() {
		query = '';
		void onSearch();
	}

	async function onColumnVisibleChange(column: ColumnState, visible: boolean) {
		const colState = columnStates.find((col) => col.name === column.name);
		if (!colState) return;

		colState.visible = visible;
		await wowup.setGetAddonsHiddenColumns([...columnStates]);
		gridApi?.setColumnsVisible([column.name], visible);
	}

	// ---- lifecycle ------------------------------------------------------------------

	// Restore persisted column visibility.
	$effect(() => {
		void (async () => {
			try {
				const saved = await wowup.getGetAddonsHiddenColumns();
				for (const col of columnStates) {
					if (!col.allowToggle) continue;
					const state = saved.find((cs) => cs.name === col.name);
					if (state) col.visible = state.visible;
				}
			} catch (e) {
				console.error(e);
			}
		})();
	});

	// Reload when the selected client changes.
	$effect(() => {
		const installation = selectedInstallation;
		if (!installation) return;
		query = '';
		void loadPopularAddons(installation);
	});

	$effect(() => addonService.addonRemoved.subscribe(() => onRefresh()));

	$effect(() =>
		addonService.searchError.subscribe((error) => {
			displayError(error);
		})
	);

	// Changing a client's default channel changes what "latest" means, so re-run the search.
	$effect(() =>
		wowup.onPreferenceChange((change) => {
			if (change.key.indexOf(DEFAULT_CHANNEL_PREFERENCE_KEY_SUFFIX) !== -1) void onSearch();
		})
	);

	// The Angular original reads this key from the MY_ADDONS namespace, and clears the
	// footer entirely when there are no rows.
	$effect(() => {
		session.setContextText(
			rowData.length > 0
				? i18n.t('PAGES.MY_ADDONS.PAGE_CONTEXT_FOOTER.SEARCH_RESULTS', { count: rowData.length })
				: ''
		);
		return () => session.setContextText('');
	});
</script>

<div class="tab-container">
	<div class="control-container bg-secondary-2">
		<div class="select-container"><ClientSelector /></div>

		{#if selectedCategory?.category !== AddonCategory.AllAddons}
			<div class="center-container text-1">
				<h4>
					{i18n.t('PAGES.GET_ADDONS.ADDON_CATEGORIES_SELECTED_TITLE', {
						category: t(selectedCategory?.localeKey ?? '')
					})}
				</h4>
				<button
					class="wu-btn wu-btn-icon"
					aria-label="Clear Category"
					title={t('PAGES.GET_ADDONS.RESET_CATEGORY_TOOLTIP')}
					onclick={() => void selectCategory(categories[0])}
				>
					<Icon name="fas:xmark" />
				</button>
			</div>
		{/if}

		<div class="right-container">
			<label class="search-container">
				<span class="field-label">{t('PAGES.GET_ADDONS.SEARCH_LABEL')}</span>
				<div class="input-row">
					<input
						type="text"
						bind:value={query}
						disabled={!session.enableControls}
						onkeyup={(e) => {
							if (e.key === 'Enter') void onSearch();
						}}
					/>
					{#if query}
						<button class="wu-btn wu-btn-icon" aria-label="Clear" onclick={onClearSearch}>
							<Icon name="fas:xmark" />
						</button>
					{/if}
				</div>
			</label>

			<div class="button-container">
				<button
					class="wu-btn wu-btn-primary"
					title={t('PAGES.GET_ADDONS.REFRESH_TOOLTIP')}
					disabled={!session.enableControls}
					onclick={onRefresh}
				>
					{query ? t('PAGES.GET_ADDONS.SEARCH_LABEL') : t('PAGES.GET_ADDONS.REFRESH_BUTTON')}
				</button>
				<button
					class="wu-btn wu-btn-primary"
					title={t('PAGES.GET_ADDONS.INSTALL_FROM_URL_TOOLTIP')}
					disabled={!session.enableControls}
					onclick={() => (showInstallFromUrl = true)}
				>
					{t('PAGES.GET_ADDONS.INSTALL_FROM_URL_BUTTON')}
				</button>
				<button
					class="wu-btn wu-btn-primary"
					title={t('PAGES.GET_ADDONS.ADDON_CATEGORIES_TOOLTIP')}
					disabled={!session.enableControls}
					onclick={() => (showCategories = !showCategories)}
				>
					{t('PAGES.GET_ADDONS.ADDON_CATEGORIES_BUTTON')}
				</button>
			</div>
		</div>
	</div>

	<div class="grid-area bg-secondary-2">
		{#if !showTable}
			<div class="spinner-container"><ProgressSpinner /></div>
		{:else}
			<AgGrid options={gridOptions} {rowData} onGridReady={(api) => (gridApi = api)} />
		{/if}

		{#if showCategories}
			<!-- Replaces <mat-drawer mode="over" position="end">. -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="drawer-backdrop" onclick={() => (showCategories = false)}></div>
			<aside class="drawer bg-secondary-2">
				<h3>{t('PAGES.GET_ADDONS.ADDON_CATEGORIES_MENU_TITLE')}</h3>
				<div class="divider"></div>
				<ul>
					{#each categories as item (item.category)}
						<li>
							<button
								class="category-item"
								class:selected={selectedCategory === item}
								onclick={() => void selectCategory(item)}
							>
								{t(item.localeKey)}
							</button>
						</li>
					{/each}
				</ul>
			</aside>
		{/if}
	</div>
</div>

{#if showColumnMenuAt}
	<!-- Replaces the MatMenu column picker. -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="menu-backdrop" onclick={() => (showColumnMenuAt = undefined)}></div>
	<div
		class="column-menu bg-secondary-4"
		style:left="{showColumnMenuAt.x}px"
		style:top="{showColumnMenuAt.y}px"
	>
		<div class="column-menu-header">{t('PAGES.MY_ADDONS.COLUMNS_CONTEXT_MENU.TITLE')}</div>
		<div class="divider"></div>
		{#each columnStates.filter((c) => c.allowToggle) as column (column.name)}
			<label class="column-menu-item">
				<input
					type="checkbox"
					checked={column.visible}
					onchange={(e) => void onColumnVisibleChange(column, e.currentTarget.checked)}
				/>
				{t(column.display)}
			</label>
		{/each}
	</div>
{/if}

{#if showInstallFromUrl}
	<InstallFromUrlDialog onclose={() => (showInstallFromUrl = false)} />
{/if}

<style>
	.tab-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.control-container {
		display: flex;
		align-items: flex-end;
		gap: 1rem;
		padding: 0.75rem 1rem;
		flex: none;
	}

	.center-container {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
	}

	.center-container h4 {
		margin: 0;
	}

	.right-container {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		margin-left: auto;
	}

	.field-label {
		display: block;
		font-size: 0.75rem;
		opacity: 0.8;
		margin-bottom: 0.2rem;
	}

	.input-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	input[type='text'] {
		padding: 0.45rem 0.55rem;
		border-radius: 4px;
		border: 1px solid var(--overlay-border);
		background: var(--overlay-subtle);
		color: inherit;
		font: inherit;
	}

	.button-container {
		display: flex;
		gap: 0.5rem;
	}

	.grid-area {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	.spinner-container {
		height: 100%;
	}

	.drawer-backdrop,
	.menu-backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 40%);
		z-index: 10;
	}

	.drawer {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 260px;
		overflow-y: auto;
		padding: 0 0.5rem;
		z-index: 11;
		box-shadow: -4px 0 16px rgb(0 0 0 / 35%);
	}

	.drawer ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.category-item {
		width: 100%;
		text-align: left;
		padding: 0.55rem 0.75rem;
		border: 0;
		border-radius: 4px;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.category-item:hover {
		background: var(--overlay-hover);
	}

	.category-item.selected {
		background: var(--overlay-selected);
		font-weight: 600;
	}

	.column-menu {
		position: fixed;
		z-index: 11;
		min-width: 200px;
		padding: 0.4rem;
		border-radius: 4px;
		box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
	}

	.column-menu-header {
		padding: 0.3rem 0.5rem;
		font-weight: 600;
	}

	.column-menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		cursor: pointer;
	}

	.column-menu-item:hover {
		background: var(--overlay-hover);
	}

	.divider {
		border-top: 1px solid var(--overlay-selected);
		margin: 0.25rem 0;
	}
</style>
