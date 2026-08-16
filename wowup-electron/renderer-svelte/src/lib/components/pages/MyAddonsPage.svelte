<script lang="ts">
	// Port of src/app/pages/my-addons/my-addons.component.{ts,html} (1,945 LOC) — the app's
	// largest screen.
	//
	// Removed: 9 Subjects, 12 combineLatest-derived observables, ChangeDetectorRef (called
	// explicitly in 8 places), a MutationObserver watching the tab element for visibility,
	// an OverlayRef, four MatMenu trees with hidden trigger elements, and a Subscription
	// array + ngOnDestroy.
	//
	// The visibility MutationObserver deserves a note: the Angular component observed its own
	// DOM node to discover when its tab became visible, because mat-tab-group keeps inactive
	// panels mounted. The Svelte shell only renders the selected panel, so mount *is* the
	// visibility signal and the observer is unnecessary.

	import type {
		ColDef,
		GridApi,
		IRowNode,
		RowClassParams,
		RowClickedEvent,
		RowDoubleClickedEvent,
		SortChangedEvent,
		CellContextMenuEvent,
		GetRowIdParams
	} from 'ag-grid-community';
	import { untrack } from 'svelte';
	import { AddonChannelType, type Addon, type WowInstallation } from 'wowup-lib-core';
	import { ADDON_PROVIDER_UNKNOWN } from '$common/constants';
	import { Debounced } from 'runed';
	import { AddonViewModel } from '$lib/business-objects/addon-view-model';
	import { withInstalledAddon } from '$lib/business-objects/addon-rows';
	import type { ColumnState } from '$lib/models/column-state';
	import type { SortOrder } from '$lib/models/sort-order';
	import { AddonInstallState } from '$lib/models/addon-install-state';
	import type { AddonUpdateEvent } from '$lib/models/addon-update-event';
	import { t, i18n } from '$lib/i18n.svelte';
	import { invoke } from '$lib/ipc';
	import * as addonUtils from '$lib/utils/addon';
	import { updateAllTooltipText } from '$lib/utils/update-tooltip';
	import { withTrayRunState } from '$lib/services/native-menu';
	import { stringIncludes } from '$lib/utils/string';
	import { join } from '$lib/utils/path';

	import AgGrid from '$lib/components/grid/AgGrid.svelte';
	import { svelteCellRenderer } from '$lib/components/grid/svelte-cell-renderer.svelte';
	import MyAddonsAddonCell from '$lib/components/grid/MyAddonsAddonCell.svelte';
	import MyAddonStatusCell from '$lib/components/grid/MyAddonStatusCell.svelte';
	import DateTooltipCell from '$lib/components/grid/DateTooltipCell.svelte';
	import GameVersionCell from '$lib/components/grid/GameVersionCell.svelte';
	import TableContextHeaderCell from '$lib/components/grid/TableContextHeaderCell.svelte';
	import ClientSelector from '$lib/components/common/ClientSelector.svelte';
	import ContextMenu from '$lib/components/common/ContextMenu.svelte';
	import AddonManageDialog from '$lib/components/addons/AddonManageDialog.svelte';
	import WtfBackup from '$lib/components/addons/WtfBackup.svelte';
	import Icon from '$lib/components/common/Icon.svelte';
	import ProgressSpinner from '$lib/components/common/ProgressSpinner.svelte';
	import BusyOverlay from '$lib/components/common/BusyOverlay.svelte';

	import { addonService, onAddonInstalled } from '$lib/state/addon.svelte';
	import { onAddonUpdatePush } from '$lib/state/push.svelte';
	import { addonProviders } from '$lib/state/addon-providers.svelte';
	import { handleRemoveAddon } from '$lib/services/addon-ui';
	import { wowUpAddon } from '$lib/services/wowup-addon';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { session } from '$lib/state/session.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { wowup } from '$lib/state/wowup.svelte';
	import { warcraftInstallations } from '$lib/state/warcraft-installation.svelte';

	// ---- state ----------------------------------------------------------------------

	/** Angular's debounceTime on the push stream, kept at the same 5s. */
	const PUSH_REFRESH_DEBOUNCE_MS = 5000;

	let baseRowData = $state<AddonViewModel[]>([]);
	// What the user has typed, and the value the grid filters on 200 ms later.
	//
	// The first pass bound the input's `value` to the *debounced* string and pushed keystrokes
	// through a hand-rolled debounce, so the DOM value was reassigned 200 ms after every
	// keystroke — the classic setup for a caret that jumps to the end mid-word. Debounced keeps
	// the two apart: the input owns `filterText`, the grid reads `filterInput`.
	let filterText = $state('');
	const debouncedFilter = new Debounced(() => filterText, 200);
	let filterInput = $derived(debouncedFilter.current);
	let isLoading = $state(true);
	let spinnerMessage = $state('');
	let gridApi = $state<GridApi | undefined>(undefined);
	let lastSelection: IRowNode[] = [];

	let rowMenu = $state<{ x: number; y: number; items: AddonViewModel[] } | undefined>(undefined);
	let columnMenu = $state<{ x: number; y: number } | undefined>(undefined);
	let pageActionsMenu = $state<{ x: number; y: number } | undefined>(undefined);
	let showManageDialog = $state(false);
	let showBackupDialog = $state(false);
	let updateAllMenu = $state<{ x: number; y: number } | undefined>(undefined);
	let channelSubmenuFor = $state<AddonViewModel[] | undefined>(undefined);

	let columns = $state<ColumnState[]>([
		{ name: 'name', display: 'PAGES.MY_ADDONS.TABLE.ADDON_COLUMN_HEADER', visible: true },
		{ name: 'sortOrder', display: 'PAGES.MY_ADDONS.TABLE.STATUS_COLUMN_HEADER', visible: true },
		{
			name: 'installedAt',
			display: 'PAGES.MY_ADDONS.TABLE.UPDATED_AT_COLUMN_HEADER',
			visible: true,
			allowToggle: true
		},
		{
			name: 'latestVersion',
			display: 'PAGES.MY_ADDONS.TABLE.LATEST_VERSION_COLUMN_HEADER',
			visible: true,
			allowToggle: true
		},
		{
			name: 'releasedAt',
			display: 'PAGES.MY_ADDONS.TABLE.RELEASED_AT_COLUMN_HEADER',
			visible: true,
			allowToggle: true
		},
		{
			name: 'gameVersion',
			display: 'PAGES.MY_ADDONS.TABLE.GAME_VERSION_COLUMN_HEADER',
			visible: true,
			allowToggle: true
		},
		{
			name: 'externalChannel',
			display: 'PAGES.MY_ADDONS.TABLE.PROVIDER_RELEASE_CHANNEL',
			visible: false,
			allowToggle: true
		},
		{
			name: 'providerName',
			display: 'PAGES.MY_ADDONS.TABLE.PROVIDER_COLUMN_HEADER',
			visible: true,
			allowToggle: true
		},
		{
			name: 'author',
			display: 'PAGES.MY_ADDONS.TABLE.AUTHOR_COLUMN_HEADER',
			visible: true,
			allowToggle: true
		}
	]);

	// ---- derived (was 12 combineLatest chains) ----------------------------------------

	let isBusy = $derived(isLoading || addonService.syncing);

	const filterListItem = (item: AddonViewModel, filter: string): boolean =>
		stringIncludes(item.addon?.name, filter) ||
		stringIncludes(item.addon?.latestVersion, filter) ||
		stringIncludes(item.addon?.author, filter);

	let rowData = $derived(
		filterInput ? baseRowData.filter((item) => filterListItem(item, filterInput)) : baseRowData
	);

	let hasData = $derived(rowData.length > 0);

	// The grid now stays up while the page is busy, so an update run happens in front of the
	// table it is updating rather than behind a blank page. The full-page spinner is kept for
	// the one case where there is genuinely nothing to show through: the first load, before
	// any addon has been read off disk. An overlay over an empty page is just a worse spinner.
	let showBusyOverlay = $derived(isBusy && hasData);
	let showPageSpinner = $derived(isBusy && !hasData);
	let hideGrid = $derived(!hasData);
	let showNoAddons = $derived(!isBusy && !hasData);

	let enableUpdateAll = $derived(
		session.enableControls && rowData.some((row) => addonUtils.needsUpdate(row.addon))
	);
	let enableUpdateExtra = $derived(session.enableControls && addonService.anyUpdatesAvailable);

	// Exactly what pressing the button will act on, filtered the same way
	// updateAllWithSpinner does. Deriving it from a different rule is how a tooltip ends up
	// promising an addon the run then skips.
	let pendingUpdates = $derived(
		baseRowData
			.map((row) => row.addon)
			.filter(
				(addon) =>
					addon !== undefined &&
					!addon.isIgnored &&
					(addonUtils.needsUpdate(addon) || addonUtils.needsInstall(addon))
			)
	);

	let updateAllTooltip = $derived(
		updateAllTooltipText(
			t('PAGES.MY_ADDONS.UPDATE_ALL_BUTTON_TOOLTIP'),
			pendingUpdates.map((addon) => addon?.name ?? ''),
			(count) => i18n.t('PAGES.MY_ADDONS.UPDATE_ALL_TOOLTIP_MORE', { count })
		)
	);

	let hasSelectedInstallation = $derived(session.selectedWowInstallation !== undefined);

	// ---- grid --------------------------------------------------------------------------

	/**
	 * Ties fall back to the addon name.
	 *
	 * Without the fallback ag-grid's sort is merely stable, so same-status rows keep the order
	 * they were loaded in. That reads as correct ascending — the rows arrive alphabetical — and
	 * as unsorted descending, because a stable sort does not reverse the ties.
	 */
	function compareElement(nodeA: IRowNode, nodeB: IRowNode, prop: string): number {
		const a = (nodeA.data as Record<string, unknown>)[prop];
		const b = (nodeB.data as Record<string, unknown>)[prop];

		if (a === b) {
			const ca = (nodeA.data as AddonViewModel).canonicalName;
			const cb = (nodeB.data as AddonViewModel).canonicalName;
			if (ca === cb) return 0;
			return ca > cb ? 1 : -1;
		}
		return (a as number) > (b as number) ? 1 : -1;
	}

	/** Game versions sort numerically by their interface number, not lexically. */
	function compareTocVersion(nodeA: IRowNode, nodeB: IRowNode): number {
		const a = ((nodeA.data as AddonViewModel).gameVersion ?? [])[0] ?? '';
		const b = ((nodeB.data as AddonViewModel).gameVersion ?? [])[0] ?? '';
		const na = parseInt(a.replace(/\./g, ''), 10) || 0;
		const nb = parseInt(b.replace(/\./g, ''), 10) || 0;
		if (na === nb) return 0;
		return na > nb ? 1 : -1;
	}

	const onHeaderContext = (event: MouseEvent) => {
		event.preventDefault();
		columnMenu = { x: event.clientX, y: event.clientY };
	};

	let columnDefs = $derived.by<ColDef[]>(() => {
		const base = {
			headerComponent: svelteCellRenderer(TableContextHeaderCell as never),
			headerComponentParams: { onHeaderContext },
			cellStyle: { display: 'flex', flexDirection: 'column', justifyContent: 'center' },
			suppressMovable: true
		};

		const hidden = (name: string) => !columns.find((c) => c.name === name)?.visible;

		return [
			{
				colId: 'name',
				field: 'canonicalName',
				flex: 2,
				minWidth: 300,
				sortable: true,
				headerName: t('PAGES.MY_ADDONS.TABLE.ADDON_COLUMN_HEADER'),
				cellRenderer: svelteCellRenderer(MyAddonsAddonCell as never),
				cellRendererParams: { onViewDetails: onViewAddonDetails },
				comparator: (_a, _b, na, nb) => compareElement(na, nb, 'canonicalName'),
				...base
			},
			{
				field: 'sortOrder',
				width: 150,
				sortable: true,
				headerName: t('PAGES.MY_ADDONS.TABLE.STATUS_COLUMN_HEADER'),
				cellRenderer: svelteCellRenderer(MyAddonStatusCell as never),
				comparator: (_a, _b, na, nb) => compareElement(na, nb, 'sortOrder'),
				...base
			},
			{
				field: 'installedAt',
				sortable: true,
				hide: hidden('installedAt'),
				headerName: t('PAGES.MY_ADDONS.TABLE.UPDATED_AT_COLUMN_HEADER'),
				cellRenderer: svelteCellRenderer(DateTooltipCell as never),
				comparator: (_a, _b, na, nb) => compareElement(na, nb, 'installedAt'),
				...base
			},
			{
				field: 'latestVersion',
				sortable: true,
				hide: hidden('latestVersion'),
				headerName: t('PAGES.MY_ADDONS.TABLE.LATEST_VERSION_COLUMN_HEADER'),
				comparator: (_a, _b, na, nb) => compareElement(na, nb, 'latestVersion'),
				...base
			},
			{
				field: 'releasedAt',
				sortable: true,
				hide: hidden('releasedAt'),
				headerName: t('PAGES.MY_ADDONS.TABLE.RELEASED_AT_COLUMN_HEADER'),
				cellRenderer: svelteCellRenderer(DateTooltipCell as never),
				comparator: (_a, _b, na, nb) => compareElement(na, nb, 'releasedAt'),
				...base
			},
			{
				field: 'gameVersion',
				sortable: true,
				minWidth: 125,
				// string[], rendered by GameVersionCell. Without this ag-grid tries to infer a
				// cell data type from the value and warns that "object" has no value formatter.
				cellDataType: false,
				hide: hidden('gameVersion'),
				headerName: t('PAGES.MY_ADDONS.TABLE.GAME_VERSION_COLUMN_HEADER'),
				cellRenderer: svelteCellRenderer(GameVersionCell as never),
				comparator: (_a, _b, na, nb) => compareTocVersion(na, nb),
				...base
			},
			{
				field: 'externalChannel',
				sortable: true,
				flex: 1,
				minWidth: 125,
				hide: hidden('externalChannel'),
				headerName: t('PAGES.MY_ADDONS.TABLE.PROVIDER_RELEASE_CHANNEL'),
				comparator: (_a, _b, na, nb) => compareElement(na, nb, 'externalChannel'),
				...base
			},
			{
				field: 'providerName',
				sortable: true,
				hide: hidden('providerName'),
				headerName: t('PAGES.MY_ADDONS.TABLE.PROVIDER_COLUMN_HEADER'),
				valueFormatter: (row) => getProviderName((row.data as AddonViewModel).providerName),
				comparator: (_a, _b, na, nb) => compareElement(na, nb, 'providerName'),
				...base
			},
			{
				field: 'author',
				sortable: true,
				minWidth: 120,
				flex: 1,
				// See GetAddonsPage: replaces CellWrapTextComponent.
				cellClass: 'cell-wrap-text',
				hide: hidden('author'),
				headerName: t('PAGES.MY_ADDONS.TABLE.AUTHOR_COLUMN_HEADER'),
				comparator: (_a, _b, na, nb) => compareElement(na, nb, 'author'),
				...base
			}
		] satisfies ColDef[];
	});

	let gridOptions = $derived({
		columnDefs,
		rowSelection: 'multiple' as const,
		rowHeight: 63,
		suppressMultiSort: true,
		// Stable row identity keeps ag-grid from rebuilding rows on every reload — the
		// Angular version supplied the same thing via [getRowId].
		getRowId: (params: GetRowIdParams) => (params.data as AddonViewModel).addon?.id ?? '',
		rowClassRules: {
			ignored: (params: RowClassParams) => (params.data as AddonViewModel).addon?.isIgnored === true
		},
		overlayNoRowsTemplate: `<span class="text-1">${t('COMMON.SEARCH.NO_ADDONS')}</span>`,
		onRowClicked,
		onRowDoubleClicked,
		onSortChanged,
		onCellContextMenu
	});

	const getProviderName = (providerName: string): string =>
		providerName === ADDON_PROVIDER_UNKNOWN ? t('COMMON.ADDON_STATE.UNKNOWN') : providerName;

	// ---- selection / menus ---------------------------------------------------------------

	function onRowClicked(event: RowClickedEvent) {
		const selectedNodes = event.api.getSelectedNodes();
		const data = event.node.data as AddonViewModel;
		const previous = lastSelection[0]?.data as AddonViewModel | undefined;

		if (
			selectedNodes.length === 1 &&
			lastSelection.length === 1 &&
			data.addon?.id === previous?.addon?.id
		) {
			event.node.setSelected(false);
			lastSelection = [];
		} else {
			lastSelection = [...selectedNodes];
		}
	}

	function onRowDoubleClicked(evt: RowDoubleClickedEvent) {
		onViewAddonDetails(evt.data as AddonViewModel);
		evt.node.setSelected(true);
	}

	function onCellContextMenu(event: CellContextMenuEvent) {
		const mouse = event.event as MouseEvent;
		mouse?.preventDefault();

		const selected = event.api.getSelectedNodes().map((n) => n.data as AddonViewModel);
		// Right-clicking outside the current selection acts on the clicked row only.
		const clicked = event.node.data as AddonViewModel;
		const items =
			selected.some((s) => s.addon?.id === clicked.addon?.id) && selected.length > 1
				? selected
				: [clicked];

		rowMenu = { x: mouse?.clientX ?? 0, y: mouse?.clientY ?? 0, items };
	}

	const closeMenus = () => {
		rowMenu = undefined;
		columnMenu = undefined;
		pageActionsMenu = undefined;
		updateAllMenu = undefined;
		channelSubmenuFor = undefined;
	};

	async function onViewAddonDetails(item: AddonViewModel) {
		await dialogs.addonDetail({ listItem: item });
	}

	// ---- loading -----------------------------------------------------------------------

	function formatAddons(addons: Addon[]): AddonViewModel[] {
		return addons
			.map((addon) => {
				const listItem = new AddonViewModel(addon);
				if (listItem.addon && !listItem.addon.installedVersion)
					listItem.addon.installedVersion = '';
				return listItem;
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	const calculateControlState = (): boolean => !addonService.isInstalling();

	async function loadAddons(reScan = false) {
		const installation = session.getSelectedWowInstallation();
		if (!installation) return;

		isLoading = true;
		session.setEnableControls(false);

		try {
			baseRowData = formatAddons(await addonService.getAddons(installation, reScan));
		} catch (e) {
			console.error(e);
		} finally {
			isLoading = false;
			session.setEnableControls(calculateControlState());
		}
	}

	async function updateAllWithSpinner(...installations: WowInstallation[]) {
		isLoading = true;
		spinnerMessage = t('PAGES.MY_ADDONS.SPINNER.GATHERING_ADDONS');
		session.setEnableControls(false);

		let addons: Addon[] = [];
		let updatedCt = 0;

		try {
			for (const installation of installations) {
				addons = addons.concat(await addonService.getAddons(installation));
			}

			addons = addons.filter(
				(addon) =>
					!addon.isIgnored && (addonUtils.needsUpdate(addon) || addonUtils.needsInstall(addon))
			);

			if (addons.length === 0) {
				await loadAddons();
				return;
			}

			// From here on something is actually being installed, so the tray badge turns amber
			// and then green. Wrapping only this part keeps a run that had nothing to do from
			// flashing a colour at the user.
			await withTrayRunState(async () => {
				// Shown once before the per-addon detail takes over, so the spinner is never blank
				// while the first update is being prepared.
				spinnerMessage = i18n.t('PAGES.MY_ADDONS.SPINNER.UPDATING', {
					updateCount: updatedCt,
					addonCount: addons.length
				});

				for (const addon of addons) {
					if (!addon.id) continue;
					updatedCt += 1;

					const installation = installations.find((inst) => inst.id === addon.installationId);
					if (!installation) {
						console.warn('Installation not found');
						continue;
					}

					spinnerMessage = i18n.t('PAGES.MY_ADDONS.SPINNER.UPDATING_WITH_ADDON_NAME', {
						updateCount: updatedCt,
						addonCount: addons.length,
						clientType: installation.displayName,
						addonName: addon.name
					});

					await addonService.updateAddon(addon);
				}

				await loadAddons();
			});
		} catch (err) {
			// operationError$ in the Angular component fed a snackbar; failures here were
			// otherwise only visible in the console.
			console.error('Failed to update addons', err);
			snackbar.showError('PAGES.MY_ADDONS.ERROR_SNACKBAR');
			isLoading = false;
		} finally {
			spinnerMessage = '';
			session.setEnableControls(calculateControlState());
		}
	}

	const onUpdateAll = () => {
		const installation = session.getSelectedWowInstallation();
		if (installation) void updateAllWithSpinner(installation);
	};

	async function onUpdateAllClients() {
		closeMenus();
		await updateAllWithSpinner(...warcraftInstallations.installations);
	}

	async function onUpdateAllRetailClassic() {
		closeMenus();
		// Retail + Classic only — the Angular version filtered by client group.
		const installations = await warcraftInstallations.getWowInstallationsAsync();
		await updateAllWithSpinner(...installations);
	}

	const onRefresh = async () => {
		const installation = session.getSelectedWowInstallation();
		if (!installation) return;

		isLoading = true;
		session.setEnableControls(false);
		try {
			await addonService.syncClient(installation);
			// Rewrite wowup_data_addon/data.lua, which is what the in-game "Addon Update
			// Notifications" addon reads on /reload. Without this the file is only current
			// after a boot, an install, or the hourly auto-update tick — so checking for
			// updates here and then alt-tabbing into the game showed nothing.
			//
			// Not allowed to fail the refresh: a companion problem must not cost the user
			// their addon list. The Angular original wrapped the whole handler in one catch.
			await wowUpAddon
				.updateForInstallation(installation)
				.catch((e: unknown) => console.error('companion addon sync failed', e));
			await loadAddons();
		} finally {
			isLoading = false;
			session.setEnableControls(calculateControlState());
		}
	};

	async function onReScan() {
		closeMenus();
		const confirmed = await dialogs.confirm({
			title: t('PAGES.MY_ADDONS.RESCAN_FOLDERS_CONFIRMATION_TITLE'),
			message: t('PAGES.MY_ADDONS.RESCAN_FOLDERS_CONFIRMATION_DESCRIPTION')
		});
		if (!confirmed) return;
		await loadAddons(true);
	}

	// ---- per-addon actions ----------------------------------------------------------------

	const isForceIgnore = (addon: Addon | undefined): boolean =>
		addon ? addonProviders.isForceIgnore(addon.providerName ?? '') : false;

	const canReInstall = (item: AddonViewModel): boolean =>
		!item.isInstalling && addonProviders.canReinstall(item.addon?.providerName ?? '');

	const canChangeChannel = (addon: Addon | undefined): boolean =>
		addon ? addonProviders.canChangeChannel(addon.providerName ?? '') : false;

	const canSetAutoUpdate = (item: AddonViewModel): boolean =>
		item.addon?.isIgnored === false && item.addon?.providerName !== ADDON_PROVIDER_UNKNOWN;

	// Per-addon opt-out from the desktop notification an auto-update raises. Pointless unless
	// notifications are on globally and the addon actually auto-updates, which is why the
	// original hid the item rather than disabling it.
	let systemNotificationsEnabled = $state(false);
	$effect(() => {
		void wowup.getEnableSystemNotifications().then((v) => (systemNotificationsEnabled = v));
	});

	const canSetAutoUpdateNotifications = (item: AddonViewModel): boolean =>
		systemNotificationsEnabled &&
		item.addon?.isIgnored === false &&
		item.addon?.warningType === undefined &&
		item.addon?.autoUpdateEnabled === true;

	async function setAddonProp(items: AddonViewModel[], apply: (addon: Addon) => void) {
		for (const item of items) {
			if (!item.addon) continue;
			apply(item.addon);
			await addonService.saveAddon(item.addon);
		}
		closeMenus();
		await loadAddons();
	}

	const onClickIgnoreAddons = (items: AddonViewModel[]) => {
		const next = !items.every((i) => i.addon?.isIgnored);
		void setAddonProp(items, (addon) => {
			addon.isIgnored = next;
			// An ignored addon cannot also auto-update.
			if (next) addon.autoUpdateEnabled = false;
		});
	};

	const onClickAutoUpdateAddons = (items: AddonViewModel[]) => {
		const next = !items.every((i) => i.addon?.autoUpdateEnabled);
		void setAddonProp(items, (addon) => {
			addon.autoUpdateEnabled = next;
			if (next) addon.isIgnored = false;
		});
	};

	const onClickAutoUpdateAddonsNotifications = (items: AddonViewModel[]) => {
		const next = items.every((i) => i.addon?.autoUpdateNotificationsEnabled === false);
		void setAddonProp(items, (addon) => (addon.autoUpdateNotificationsEnabled = next));
	};

	const onSelectedAddonsChannelChange = (items: AddonViewModel[], channel: AddonChannelType) => {
		void setAddonProp(items, (addon) => (addon.channelType = channel));
	};

	async function onReInstallAddons(items: AddonViewModel[]) {
		closeMenus();
		for (const item of items) {
			if (item.addon) await addonService.installAddon(item.addon);
		}
	}

	// The Angular menus split this: a single row goes through onRemoveAddon (which is
	// dependency-aware and prompts a second time), a multi-row selection goes through
	// onRemoveAddons, which asks once and lists what will go. Looping handleRemoveAddon over the
	// selection instead meant one confirmation dialog *per addon* — ten dialogs to remove ten.
	async function onRemoveAddons(items: AddonViewModel[]) {
		closeMenus();

		if (items.length === 1) {
			if (items[0].addon) await handleRemoveAddon(items[0].addon);
			await loadAddons();
			return;
		}

		const explanation = t('PAGES.MY_ADDONS.UNINSTALL_POPUP.CONFIRMATION_ACTION_EXPLANATION');
		// Over three, the list is replaced by a count.
		const body =
			items.length > 3
				? i18n.t('PAGES.MY_ADDONS.UNINSTALL_POPUP.CONFIRMATION_MORE_THAN_THREE', {
						count: items.length
					})
				: i18n.t('PAGES.MY_ADDONS.UNINSTALL_POPUP.CONFIRMATION_LESS_THAN_THREE', {
						count: items.length
					}) + items.map((item) => `\n\t• ${item.addon?.name ?? ''}`).join('');

		const confirmed = await dialogs.confirm({
			title: i18n.t('PAGES.MY_ADDONS.UNINSTALL_POPUP.TITLE', { count: items.length }),
			message: [body, explanation].join('\n\n')
		});
		if (!confirmed) return;

		for (const item of items) {
			if (item.addon) await addonService.removeAddon(item.addon);
		}
		await loadAddons();
	}

	async function onShowFolder(addon: Addon, folder: string) {
		closeMenus();
		try {
			const path = join(addonService.getInstallBasePath(addon), folder);
			await invoke('show-directory', path);
		} catch (e) {
			console.error(e);
		}
	}

	async function onSelectedProviderChange(item: AddonViewModel, providerName: string) {
		closeMenus();
		const installation = session.getSelectedWowInstallation();
		if (!installation || !item.addon) return;

		const externalId = item.addon.externalIds?.find((ext) => ext.providerName === providerName)?.id;
		if (!externalId) return;

		// Switching provider re-points an installed addon at a different source, so the original
		// confirms first and reports failure with a message naming both addon and provider.
		const args = { addonName: item.addon.name, providerName };

		const confirmed = await dialogs.confirm({
			title: t('PAGES.MY_ADDONS.CHANGE_ADDON_PROVIDER_CONFIRMATION.TITLE'),
			message: i18n.t('PAGES.MY_ADDONS.CHANGE_ADDON_PROVIDER_CONFIRMATION.MESSAGE', args)
		});
		if (!confirmed) return;

		try {
			await addonService.setProvider(item.addon, externalId, providerName, installation);
			await loadAddons();
		} catch (e) {
			console.error(e);
			await dialogs.alert({
				title: t('DIALOGS.ALERT.ERROR_TITLE'),
				message: i18n.t('COMMON.ERRORS.CHANGE_PROVIDER_ERROR', args)
			});
		}
	}

	// ---- columns / sort --------------------------------------------------------------------

	async function onColumnVisibleChange(column: ColumnState, visible: boolean) {
		const colState = columns.find((col) => col.name === column.name);
		if (!colState) return;

		colState.visible = visible;
		await wowup.setMyAddonsHiddenColumns([...columns]);
		gridApi?.setColumnsVisible([column.name], visible);
	}

	async function onSortChanged(event: SortChangedEvent) {
		// Every column, unsorted ones included with a null sort — not just the sorted ones.
		// Restoring needs the nulls: they are what clears a column the user has sorted and
		// then unsorted, and their absence is how the restore above tells a real saved order
		// from a legacy one.
		const sortOrder = event.api
			.getColumnState()
			.map((col): SortOrder => ({ colId: col.colId, sort: col.sort ?? null }));

		await wowup.setMyAddonsSortOrder(sortOrder);
	}

	// ---- lifecycle ---------------------------------------------------------------------------

	// Restore persisted column visibility and sort order.
	$effect(() => {
		void (async () => {
			try {
				const saved = await wowup.getMyAddonsHiddenColumns();
				for (const col of columns) {
					if (!col.allowToggle) continue;
					const state = saved.find((cs) => cs.name === col.name);
					if (state) col.visible = state.visible;
				}
			} catch (e) {
				console.error(e);
			}
		})();
	});

	$effect(() => {
		const api = gridApi;
		if (!api) return;

		void (async () => {
			let saved = await wowup.getMyAddonsSortOrder();

			// One entry per column, sort included as null when a column is unsorted — that is
			// the shape the Angular renderer writes, and `--renderer` switches the two over a
			// single profile, so anything shorter predates the format or is corrupt. It gets
			// rewritten rather than applied, matching loadSortOrder().
			if (!Array.isArray(saved) || saved.length < 2) {
				await wowup.setMyAddonsSortOrder([]);
				saved = [];
			}

			// The preference read is async, so the panel can be unmounted — and the grid
			// destroyed — before it resolves.
			if (api.isDestroyed()) return;

			// Status ascending is the view the app opens on, and the reason the page is worth
			// looking at: AddonStatusSortOrder runs Warning, Install, Update, UpToDate, so
			// everything needing attention sits above the fold. It has to be applied here and
			// not left to the saved state, or a profile that has never been sorted shows the
			// grid in load order and the three addons the badge is counting are somewhere down
			// a list of 198.
			//
			// One apply, not a default followed by an overlay: applying twice makes ag-grid
			// emit sortChanged for the first one, and onSortChanged would persist that default
			// over the user's real saved order while this read was still in flight.
			// `defaultState` clears every other column so a saved sort replaces the default
			// rather than stacking into a two-column sort.
			api.applyColumnState({
				state: saved.length > 0 ? saved : [{ colId: 'sortOrder', sort: 'asc' }],
				defaultState: { sort: null }
			});
		})();
	});

	// Mounting the panel is the load trigger — see the note at the top of this file.
	$effect(() => {
		const installation = session.selectedWowInstallation;
		if (!installation) return;
		void loadAddons();
	});

	// An install finishing has to replace the row's view model, not repaint the cell.
	//
	// The view model is a snapshot: `sortOrder`, the version columns and the status text all read
	// through the `addon` it was constructed with, and ag-grid re-sorts on new row data, not on
	// refreshCells(). Repainting alone left a finished update sitting in the Update group showing
	// its old version — the status cell said "Up to date" because it tracks install events
	// itself, and every other column disagreed with it.
	$effect(() =>
		onAddonInstalled((evt: AddonUpdateEvent) => {
			// Only the client currently on screen.
			if (evt.addon.installationId !== session.getSelectedWowInstallation()?.id) return;

			if (
				evt.installState !== AddonInstallState.Complete &&
				evt.installState !== AddonInstallState.Error
			) {
				session.setEnableControls(false);
				return;
			}

			baseRowData = withInstalledAddon(
				baseRowData,
				evt.addon,
				evt.installState === AddonInstallState.Complete
			);

			session.setEnableControls(calculateControlState());
		})
	);

	// The hourly auto-update job is how an update appears while the app sits open on this page:
	// it syncs every client, installs whatever is set to auto-update, and signals when done.
	//
	// The port had the publisher — auto-update.ts calls session.autoUpdateComplete() — and no
	// subscriber anywhere, so the grid kept whatever it loaded when the page opened while the
	// badge above it counted the new update. Skipping the initial 0 leaves the first load to
	// the mount effect above; untrack keeps this from also depending on the installation, which
	// would make an installation change load twice.
	$effect(() => {
		if (session.autoUpdateCompleteAt === 0) return;
		untrack(() => void loadAddons());
	});

	$effect(() => addonService.addonRemoved.subscribe(() => void loadAddons()));

	// Three session signals the Angular page refreshed on. All three had a publisher in the port
	// and no subscriber, so the grid went stale: a WTF-restore, an addon installed from a URL or
	// protocol link, and a rescan from Options all left the previous list on screen.
	$effect(() => session.addonsChanged.subscribe(() => void onRefresh()));
	$effect(() => session.rescanComplete.subscribe(() => void onRefresh()));
	// The tray's Update All. Same routine as the button, so the spinner, the error snackbar
	// and the grid reload all behave identically however it was started.
	$effect(() => session.updateAllRequested.subscribe(() => onUpdateAll()));
	$effect(() => session.targetFileInstallComplete.subscribe(() => void onRefresh()));

	// A WowUp push notification is the hub telling the app that an addon it tracks has a new
	// release — the other way an update arrives with the app sitting open. push.svelte.ts
	// parsed the notification and handed it to a listener registry that nobody had joined, so
	// it went nowhere.
	//
	// Debounced because the hub sends one notification per addon and a batch would otherwise
	// be one refresh each. Angular used debounceTime, which drops all but the last
	// notification; the ids are accumulated here instead, so a batch whose *last* entry is an
	// addon this client does not have still refreshes for the ones it does.
	$effect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let pending: string[] = [];

		const unsubscribe = onAddonUpdatePush((updates) => {
			pending.push(...updates.map((update) => update.addonId));
			clearTimeout(timer);
			timer = setTimeout(() => {
				const ids = pending;
				pending = [];
				void (async () => {
					// The hub pushes for every subscriber, so most notifications are about addons
					// this client has not installed.
					if (await addonService.hasAnyWithExternalAddonIds(ids)) await onRefresh();
				})();
			}, PUSH_REFRESH_DEBOUNCE_MS);
		});

		return () => {
			clearTimeout(timer);
			unsubscribe();
		};
	});

	// The footer's per-screen text. Scoped to this route's lifetime: the cleanup clears it
	// on the way out, which is what the tab-index guard used to approximate.
	$effect(() => {
		session.setContextText(
			rowData.length > 0
				? i18n.t('PAGES.MY_ADDONS.PAGE_CONTEXT_FOOTER.ADDONS_INSTALLED', { count: rowData.length })
				: ''
		);
		return () => session.setContextText('');
	});
</script>

<div class="tab-container">
	<div class="control-container bg-secondary-2">
		<div class="select-container"><ClientSelector updates /></div>

		<div class="right-container">
			{#if hasSelectedInstallation}
				<label class="filter-container">
					<span class="field-label">{t('PAGES.MY_ADDONS.FILTER_LABEL')}</span>
					<div class="input-row">
						<input type="text" bind:value={filterText} />
						{#if filterText}
							<button
								class="wu-btn wu-btn-icon"
								aria-label="Clear"
								onclick={() => {
									filterText = '';
									// Clearing is a deliberate action, not typing — no reason to wait.
									debouncedFilter.setImmediately('');
								}}
							>
								<Icon name="fas:xmark" />
							</button>
						{/if}
					</div>
				</label>
			{/if}

			<div class="button-container">
				<div class="split-button">
					<!-- The title sits on the wrapper, not the button: a disabled control gets no
					     pointer events in WebKit and so shows no tooltip, and "nothing to update"
					     is exactly when the reason is worth reading. -->
					<span class="update-all-host" title={updateAllTooltip}>
						<button
							class="wu-btn wu-btn-primary menu-button"
							disabled={!enableUpdateAll}
							onclick={onUpdateAll}
						>
							{t('PAGES.MY_ADDONS.UPDATE_ALL_BUTTON')}
						</button>
					</span>
					<button
						class="wu-btn wu-btn-primary chip"
						aria-label={t('PAGES.MY_ADDONS.UPDATE_ALL_BUTTON')}
						disabled={!enableUpdateExtra}
						onclick={(e) => (updateAllMenu = { x: e.clientX, y: e.clientY })}
					>
						<Icon name="fas:caret-down" />
					</button>
				</div>

				<button
					class="wu-btn wu-btn-primary"
					title={t('PAGES.MY_ADDONS.CHECK_UPDATES_BUTTON_TOOLTIP')}
					disabled={!session.enableControls}
					onclick={() => void onRefresh()}
				>
					{t('PAGES.MY_ADDONS.CHECK_UPDATES_BUTTON')}
				</button>

				<button
					class="wu-btn wu-btn-flat wu-btn-icon"
					aria-label={t('COMMON.MORE_ACTIONS')}
					disabled={!session.enableControls}
					onclick={(e) => (pageActionsMenu = { x: e.clientX, y: e.clientY })}
				>
					<Icon name="fas:ellipsis-vertical" />
				</button>
			</div>
		</div>
	</div>

	{#if showPageSpinner}
		<div class="spinner-container"><ProgressSpinner message={spinnerMessage} /></div>
	{/if}

	{#if showNoAddons}
		<div class="no-addons-container text-1"><h1>{t('COMMON.SEARCH.NO_ADDONS')}</h1></div>
	{/if}

	<div class="grid-area" class:hidden={hideGrid}>
		<AgGrid options={gridOptions} {rowData} onGridReady={(api) => (gridApi = api)} />
	</div>
</div>

{#if showBusyOverlay}
	<BusyOverlay message={spinnerMessage} />
{/if}

{#if updateAllMenu}
	<ContextMenu x={updateAllMenu.x} y={updateAllMenu.y} onclose={closeMenus}>
		<button class="menu-item" onclick={() => void onUpdateAllRetailClassic()}>
			{t('PAGES.MY_ADDONS.UPDATE_ALL_CONTEXT_MENU.UPDATE_RETAIL_CLASSIC_BUTTON')}
		</button>
		<button class="menu-item" onclick={() => void onUpdateAllClients()}>
			{t('PAGES.MY_ADDONS.UPDATE_ALL_CONTEXT_MENU.UPDATE_ALL_CLIENTS_BUTTON')}
		</button>
	</ContextMenu>
{/if}

{#if pageActionsMenu}
	<ContextMenu x={pageActionsMenu.x} y={pageActionsMenu.y} onclose={closeMenus}>
		<button class="menu-item" onclick={() => void onReScan()}>
			{t('PAGES.MY_ADDONS.RESCAN_FOLDERS_BUTTON')}
		</button>
		<button
			class="menu-item"
			onclick={() => {
				closeMenus();
				showManageDialog = true;
			}}
		>
			{t('PAGES.MY_ADDONS.IMPORT_EXPORT_ADDONS_BUTTON')}
		</button>
		<button
			class="menu-item"
			onclick={() => {
				closeMenus();
				showBackupDialog = true;
			}}
		>
			{t('PAGES.MY_ADDONS.WTF_BACKUP_BUTTON')}
		</button>
	</ContextMenu>
{/if}

<!-- Both render their own <dialog>, and both are reachable only from this page, so they are
     plain local state rather than entries in the shared dialog stack. -->
{#if showManageDialog}
	<AddonManageDialog onclose={() => (showManageDialog = false)} />
{/if}

{#if showBackupDialog}
	<WtfBackup onclose={() => (showBackupDialog = false)} />
{/if}

{#if columnMenu}
	<ContextMenu x={columnMenu.x} y={columnMenu.y} onclose={closeMenus}>
		<div class="menu-header">{t('PAGES.MY_ADDONS.COLUMNS_CONTEXT_MENU.TITLE')}</div>
		<div class="menu-divider"></div>
		{#each columns.filter((c) => c.allowToggle) as column (column.name)}
			<label class="menu-item">
				<input
					type="checkbox"
					checked={column.visible}
					onchange={(e) => void onColumnVisibleChange(column, e.currentTarget.checked)}
				/>
				{t(column.display)}
			</label>
		{/each}
	</ContextMenu>
{/if}

{#if rowMenu}
	{@const items = rowMenu.items}
	{@const single = items.length === 1 ? items[0] : undefined}

	<ContextMenu x={rowMenu.x} y={rowMenu.y} onclose={closeMenus}>
		{#if single}
			<div class="menu-header">
				<div class="addon-name">{single.addon?.name}</div>
				<div class="addon-version text-2">{single.addon?.installedVersion}</div>
			</div>
		{:else}
			<div class="menu-header">
				{i18n.t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.ADDONS_SELECTED', { count: items.length })}
			</div>
		{/if}
		<div class="menu-divider"></div>

		{#if !single || !isForceIgnore(single.addon)}
			<label class="menu-item">
				<input
					type="checkbox"
					checked={items.every((i) => i.addon?.isIgnored)}
					onchange={() => onClickIgnoreAddons(items)}
				/>
				{t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.IGNORE_ADDON_BUTTON')}
			</label>
		{/if}

		{#if !single || canSetAutoUpdate(single)}
			<label class="menu-item">
				<input
					type="checkbox"
					checked={items.every((i) => i.addon?.autoUpdateEnabled)}
					onchange={() => onClickAutoUpdateAddons(items)}
				/>
				{t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.AUTO_UPDATE_ADDON_BUTTON')}
			</label>
		{/if}

		{#if !single || canSetAutoUpdateNotifications(single)}
			<label class="menu-item">
				<input
					type="checkbox"
					checked={items.every((i) => i.addon?.autoUpdateNotificationsEnabled)}
					onchange={() => onClickAutoUpdateAddonsNotifications(items)}
				/>
				{t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.AUTO_UPDATE_ADDON_NOTIFICATIONS_ENABLED_BUTTON')}
			</label>
		{/if}

		{#if !single || canChangeChannel(single.addon)}
			<button class="menu-item" onclick={() => (channelSubmenuFor = items)}>
				{t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.CHANNEL_SUBMENU_TITLE')}
			</button>
		{/if}

		{#if channelSubmenuFor}
			<div class="submenu">
				{#each [[AddonChannelType.Stable, 'STABLE_ADDON_CHANNEL'], [AddonChannelType.Beta, 'BETA_ADDON_CHANNEL'], [AddonChannelType.Alpha, 'ALPHA_ADDON_CHANNEL']] as [channel, key] (channel)}
					<button
						class="menu-item"
						onclick={() =>
							onSelectedAddonsChannelChange(channelSubmenuFor!, channel as AddonChannelType)}
					>
						{t(`PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.${key}`)}
					</button>
				{/each}
			</div>
		{/if}

		{#if single && addonUtils.hasMultipleProviders(single.addon!)}
			<div class="submenu-label">
				{t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.PROVIDER_SUBMENU_TITLE')}
			</div>
			{#each addonUtils.getAllProviders(single.addon!) as provider (provider.providerName)}
				<button
					class="menu-item indent"
					onclick={() => void onSelectedProviderChange(single, provider.providerName)}
				>
					{provider.providerName}
				</button>
			{/each}
		{/if}

		{#if single}
			<div class="submenu-label">{t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.SHOW_FOLDER')}</div>
			{#each single.addon?.installedFolderList ?? [] as folder (folder)}
				<button class="menu-item indent" onclick={() => void onShowFolder(single.addon!, folder)}>
					{folder}
				</button>
			{/each}
		{/if}

		{#if single && canReInstall(single)}
			<button class="menu-item" onclick={() => void onReInstallAddons([single])}>
				{t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.REINSTALL_ADDON_BUTTON')}
			</button>
		{/if}

		<div class="menu-divider"></div>
		<button class="menu-item" onclick={() => void onRemoveAddons(items)}>
			{t('PAGES.MY_ADDONS.ADDON_CONTEXT_MENU.REMOVE_ADDON_BUTTON')}
		</button>
	</ContextMenu>
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
		/* Same gutter as the grid's cells, so the selector lines up with the column it heads
		   and the buttons with the last column. The height matches the rail's top inset so the
		   list starts level with the first nav tab. */
		padding: 0 var(--list-gutter) 0.55rem;
		height: var(--rail-top-inset);
		box-sizing: border-box;
		flex: none;
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
		align-items: center;
		gap: 0.5rem;
	}

	.split-button {
		display: flex;
		align-items: stretch;
		gap: 1px;
	}

	/* Transparent to layout — it stands where the button did inside the split button. */
	.update-all-host {
		display: flex;
	}

	/* Lets the hover reach the wrapper, which is what carries the tooltip. */
	.update-all-host > button:disabled {
		pointer-events: none;
	}

	.split-button .chip {
		padding: 0 0.5rem;
	}

	.grid-area {
		flex: 1;
		min-height: 0;
	}

	.grid-area.hidden {
		display: none;
	}

	.spinner-container,
	.no-addons-container {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	:global(.context-menu .submenu) {
		padding-left: 0.75rem;
	}

	:global(.context-menu .submenu-label) {
		padding: 0.4rem 0.6rem 0.2rem;
		opacity: 0.65;
		font-size: 0.75rem;
	}

	:global(.context-menu .menu-item.indent) {
		padding-left: 1.4rem;
	}
</style>
