import { expect, test, type Page } from '@playwright/test';

// End-to-end tests for My Addons, driven with real addon rows so the grid, the Svelte cell
// renderers, filtering, and the right-click context menu are all exercised against data.

const INSTALLATION = {
	id: 'inst-1',
	clientType: 1,
	label: 'Retail',
	displayName: 'Retail',
	location: '/games/wow/_retail_/Wow.exe',
	selected: true,
	defaultAddonChannelType: 0,
	defaultAutoUpdate: false
};

// See get-addons.e2e.ts: provider state is stored lowercased, and an unmatched name leaves
// the provider enabled at its default.
const DISABLED_PROVIDERS = [
	'Zip',
	'RaiderIO',
	'WowUpCompanion',
	'WowUpHub',
	'TukUI',
	'WowInterface',
	'GitHub',
	'Wago',
	'Curse',
	'CurseV2'
].map((name) => ({ providerName: name.toLowerCase(), enabled: false, canEdit: true }));

function addon(name: string, author: string, opts: Partial<Record<string, unknown>> = {}) {
	return {
		id: `id-${name}`,
		name,
		author,
		installationId: INSTALLATION.id,
		clientType: 1,
		providerName: 'WowUpHub',
		externalId: `ext-${name}`,
		externalUrl: `https://example.com/${name}`,
		thumbnailUrl: '',
		installedVersion: '1.0.0',
		latestVersion: '1.0.0',
		installedFolderList: [name],
		installedFolders: name,
		gameVersion: ['10.0.2'],
		channelType: 0,
		externalChannel: 'Stable',
		isIgnored: false,
		autoUpdateEnabled: false,
		autoUpdateNotificationsEnabled: false,
		isLoadOnDemand: false,
		installedAt: new Date('2024-05-01').toISOString(),
		releasedAt: new Date('2024-04-01').toISOString(),
		summary: `${name} summary`,
		dependencies: [],
		externalIds: [],
		...opts
	};
}

const ADDONS = [
	addon('DBM', 'Tandanu'),
	// Needs an update — drives the Update All button and the status cell.
	addon('WeakAuras', 'InfusOnWoW', { latestVersion: '2.0.0' }),
	addon('Details', 'Terciob', { isIgnored: true })
];

async function stubPreload(
	page: Page,
	addons: unknown[] = ADDONS,
	seed: Record<string, unknown> = {}
) {
	await page.addInitScript(
		({ installs, providers, addonRows, seeded }) => {
			// Consent is a first-run gate that blocks bootstrap until answered — seed it as
			// already-answered so suites land on the page under test.
			const store: Record<string, unknown> = {
				telemetry_enabled: false,
				wago_prompt: true,
				update_notes_popup_version: '2.23.0',
				addon_migration_version: '2.23.0',
				// getBool() compares against the literal 'true' — a boolean here reads as false.
				enable_system_notifications: 'true',
				wow_installations: installs,
				addon_providers: providers,
				...seeded
			};

			(window as never as Record<string, unknown>)['platform'] = 'linux';
			(window as never as Record<string, unknown>)['userDataPath'] = '/tmp/wowup';
			(window as never as Record<string, unknown>)['logPath'] = '/tmp/wowup/logs';

			// Read on every fetch rather than captured, so a test can change what the database
			// holds while the page is open — which is what a background sync does.
			let rows = addonRows;
			(window as never as Record<string, unknown>)['__setAddonRows'] = (next: unknown[]) => {
				rows = next;
			};

			(window as never as Record<string, unknown>)['wowup'] = {
				rendererInvoke: (channel: string, ...args: unknown[]) => {
					switch (channel) {
						case 'get-app-version':
							return Promise.resolve('2.23.0');
						case 'get-locale':
							return Promise.resolve('en');
						case 'store-get-object':
							return Promise.resolve(store[args[1] as string]);
						case 'store-set-object':
							store[args[1] as string] = args[2];
							return Promise.resolve();
						case 'addons-get-all':
						case 'addons-get-all-for-installation':
							return Promise.resolve(rows);
						case 'addons-get-available-for-update':
							return Promise.resolve(
								(rows as { installedVersion: string; latestVersion: string }[]).filter(
									(a) => a.installedVersion !== a.latestVersion
								)
							);
						case 'addons-get-auto-update-enabled':
							return Promise.resolve([]);
						default:
							return Promise.resolve(undefined);
					}
				},
				rendererSend: () => {},
				rendererSendSync: () => undefined,
				rendererOn: () => {},
				rendererOff: () => {},
				onRendererEvent: () => {},
				openExternal: () => Promise.resolve(),
				openPath: () => Promise.resolve('')
			};
		},
		{ installs: [INSTALLATION], providers: DISABLED_PROVIDERS, addonRows: addons, seeded: seed }
	);

	await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

async function openMyAddons(page: Page) {
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'My Addons' }).click();
	// Rows render through the Svelte cell-renderer bridge.
	await expect(page.locator('.ag-row').first()).toBeVisible();
}

/**
 * Addon names in the order the grid *displays* them.
 *
 * Not DOM order: ag-grid positions rows absolutely and reuses their elements, so
 * `.ag-row` in document order is whatever the row buffer happens to hold. `row-index`
 * is the rendered position, which is what the user sees.
 */
async function rowOrder(page: Page): Promise<string[]> {
	const rows = page.locator('.ag-center-cols-container .ag-row');
	await expect(rows.first()).toBeVisible();

	const placed = await rows.evaluateAll((els) =>
		els
			.map((el) => ({
				index: Number(el.getAttribute('row-index')),
				name: el.querySelector('.addon-title')?.textContent?.trim() ?? ''
			}))
			.sort((a, b) => a.index - b.index)
	);
	return placed.map((r) => r.name);
}

// Status ordering is the first thing on screen and the reason the page opens on this sort:
// AddonStatusSortOrder is declared Warning, Install, Update, UpToDate, Ignored, Unknown, so
// ascending floats everything that needs the user's attention to the top. Reported as "it
// says 3 updates and shows them on Angular but not on ours" — the badge counts the addon
// rows directly, so it can be right while the grid order is wrong.
test('addons needing updates sort to the top with no saved sort order', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	// WeakAuras needs an update, DBM is current, Details is ignored.
	expect(await rowOrder(page)).toEqual(['WeakAuras', 'DBM', 'Details']);
});

/** The persisted shape: one entry per column, unsorted ones carrying a null sort. */
const savedSort = (sorted: Record<string, 'asc' | 'desc'>) =>
	['name', 'sortOrder', 'installedAt', 'latestVersion', 'releasedAt', 'gameVersion'].map(
		(colId) => ({
			colId,
			sort: sorted[colId] ?? null
		})
	);

test('a saved sort on another column wins over the default', async ({ page }) => {
	await stubPreload(page, ADDONS, { my_addons_sort_order: savedSort({ name: 'desc' }) });
	await openMyAddons(page);

	// Sorted by canonicalName descending, so status is ignored entirely.
	expect(await rowOrder(page)).toEqual(['WeakAuras', 'Details', 'DBM']);
});

test('a saved sort replaces the default rather than stacking with it', async ({ page }) => {
	// If the default were applied and then overlaid, sortOrder would still be sorted first
	// and name would only break its ties — leaving WeakAuras (Update) at the top.
	await stubPreload(page, ADDONS, { my_addons_sort_order: savedSort({ name: 'asc' }) });
	await openMyAddons(page);

	expect(await rowOrder(page)).toEqual(['DBM', 'Details', 'WeakAuras']);
});

test('a legacy saved sort order is discarded in favour of the default', async ({ page }) => {
	// The single-entry shape this renderer used to write. Applying it verbatim is harmless
	// here, but the same value with any other colId would silently lose the status sort.
	await stubPreload(page, ADDONS, { my_addons_sort_order: [{ colId: 'name', sort: 'desc' }] });
	await openMyAddons(page);

	expect(await rowOrder(page)).toEqual(['WeakAuras', 'DBM', 'Details']);
});

test('addons with the same status fall back to name order', async ({ page }) => {
	// Descending, so the fallback is observable: a comparator that returns 0 on a tie leaves
	// ag-grid's stable sort holding insertion order (already alphabetical), which looks
	// correct ascending and wrong descending.
	await stubPreload(page, [addon('Zulu', 'Z'), addon('DBM', 'Tandanu'), addon('Alpha', 'A')], {
		my_addons_sort_order: savedSort({ sortOrder: 'desc' })
	});
	await openMyAddons(page);

	expect(await rowOrder(page)).toEqual(['Zulu', 'DBM', 'Alpha']);
});

// Reported as: "got a new update while app was on but the list did not update again."
//
// The hourly auto-update job syncs every client and then signals completion, which is how an
// update appears with the app sitting open on this page. The client-selector badge above the
// grid tracked it — it recounts on the same job's badge refresh — so the page showed "1 update"
// over a list that did not contain one.
test('an update found while the page is open reaches the grid', async ({ page }) => {
	// Fake timers, so the job's next tick is an assertion rather than an hour's wait. Installed
	// before the app boots: the interval has to be created against the fake clock.
	await page.clock.install();

	const current = [addon('Alpha', 'A'), addon('Zulu', 'Z')];
	await stubPreload(page, current);
	await openMyAddons(page);

	// Under fake timers nothing scheduled runs until the clock is told to, and ag-grid renders
	// cell contents on a frame — the rows exist immediately, their text does not.
	await page.clock.runFor(1000);
	await expect.poll(() => rowOrder(page)).toEqual(['Alpha', 'Zulu']);

	// What a sync writes to the database when it finds a new release.
	await page.evaluate(
		(rows) => (window as never as Record<string, (r: unknown[]) => void>)['__setAddonRows'](rows),
		[current[0], { ...current[1], latestVersion: '2.0.0' }]
	);

	// autoUpdateIntervalMs is one hour. fastForward rather than runFor so the jump fires each
	// due timer once instead of stepping through an hour of them.
	await page.clock.fastForward('01:00:01');
	// The job's own work resolves on microtasks; the grid then repaints on a frame.
	await page.clock.runFor(1000);

	// Zulu now needs an update, so the status sort floats it above Alpha.
	await expect.poll(() => rowOrder(page)).toEqual(['Zulu', 'Alpha']);
});

test('renders installed addons as grid rows', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await expect(page.locator('.ag-row')).toHaveCount(3);
	await expect(page.getByText('DBM')).toBeVisible();
	await expect(page.getByText('WeakAuras')).toBeVisible();
});

test('addon names render through the Svelte cell renderer', async ({ page }) => {
	// ag-grid virtualises columns as well as rows: at the default 1280px viewport the
	// author column — last of nine — is scrolled out and simply absent from the DOM.
	await page.setViewportSize({ width: 1700, height: 900 });
	await stubPreload(page);
	await openMyAddons(page);

	// .addon-column is MyAddonsAddonCell.svelte markup, not ag-grid's.
	await expect(page.locator('.addon-column').filter({ hasText: 'DBM' })).toBeVisible();
	// Author is a plain ag-grid field, no cell renderer — it proves the column config.
	await expect(page.getByText('Tandanu')).toBeVisible();
});

test('the filter narrows the rows', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await page.locator('.filter-container input').fill('Weak');

	// Filtering is debounced by 200ms.
	await expect(page.locator('.ag-row')).toHaveCount(1);
	await expect(page.getByText('WeakAuras')).toBeVisible();
});

test('clearing the filter restores all rows', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await page.locator('.filter-container input').fill('Weak');
	await expect(page.locator('.ag-row')).toHaveCount(1);

	await page.locator('.filter-container').getByRole('button', { name: 'Clear' }).click();
	await expect(page.locator('.ag-row')).toHaveCount(3);
});

test('Update All is enabled only when something needs updating', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	// WeakAuras has 1.0.0 installed vs 2.0.0 latest. Update All is a split button: the
	// label (.menu-button) and the dropdown chip share the accessible name.
	await expect(page.locator('.split-button .menu-button')).toBeEnabled();
});

test('Update All is disabled when everything is current', async ({ page }) => {
	await stubPreload(page, [addon('DBM', 'Tandanu')]);
	await openMyAddons(page);

	await expect(page.locator('.split-button .menu-button')).toBeDisabled();
});

test('right-clicking a row opens the addon context menu', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await page.locator('.ag-row').first().click({ button: 'right' });

	await expect(page.locator('.context-menu')).toBeVisible();
	await expect(page.locator('.context-menu').getByText('Remove')).toBeVisible();
	// Installed folders are listed for a single-row selection.
	await expect(page.locator('.context-menu .menu-item.indent').first()).toBeVisible();
});

test('the auto-update notifications toggle appears only for an auto-updating addon', async ({
	page
}) => {
	// This item was dropped in the port. It is conditional in a way that makes it easy to miss:
	// hidden unless system notifications are on AND the addon auto-updates, so a fixture with
	// the defaults shows nothing and the omission looks correct.
	await stubPreload(page, [
		addon('DBM', 'Tandanu', { autoUpdateEnabled: true }),
		addon('Details', 'Terciob')
	]);
	await openMyAddons(page);

	const label = 'Notifications Enabled';

	await page.locator('.ag-row').first().click({ button: 'right' });
	await expect(page.locator('.context-menu').getByText(label)).toBeVisible();

	await page.keyboard.press('Escape');
	await page.locator('.ag-row').nth(1).click({ button: 'right' });
	await expect(page.locator('.context-menu')).toBeVisible();
	await expect(page.locator('.context-menu').getByText(label)).toHaveCount(0);
});

test('right-clicking a column header opens the column picker', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	await page.locator('.ag-header-cell-text').first().click({ button: 'right' });

	await expect(page.locator('.context-menu')).toBeVisible();
	// 7 of the 9 columns are toggleable.
	await expect(page.locator('.context-menu input[type="checkbox"]')).toHaveCount(7);
});

test('an ignored addon gets the ignored row class', async ({ page }) => {
	await stubPreload(page);
	await openMyAddons(page);

	// Details is stubbed as ignored; rowClassRules applies .ignored.
	await expect(page.locator('.ag-row.ignored')).toHaveCount(1);
});

test('an addon whose thumbnail fails to load falls back to its initial', async ({ page }) => {
	// The WowUp hub serves GitHub social-preview images as presigned S3 URLs carrying
	// `X-Amz-Expires=300`, so by the time a row renders the link is usually dead — which is why
	// some rows showed an icon and their neighbours showed an empty box. `alt=""` means a broken
	// image renders nothing at all, so there was not even a broken-image glyph to explain it.
	// The component already has a placeholder for the no-thumbnail case; this covers the
	// failed-thumbnail case using it too.
	await stubPreload(page, [
		addon('Broken Thumb', 'someone', { thumbnailUrl: '/definitely-missing-thumbnail.png' })
	]);
	await openMyAddons(page);

	const row = page.locator('.ag-row').first();
	await expect(row).toBeVisible();
	await expect(row.locator('.addon-logo-letter')).toHaveText('B');
	await expect(row.locator('img')).toHaveCount(0);
});

test('floating panels are opaque, not see-through', async ({ page }) => {
	// The theme has three surface tokens that carry alpha (--background-secondary-2 at 0.9, -3
	// and -4 at 0.8) and one that does not (--background-secondary-2-fill). The translucent ones
	// are correct for panels that sit *in* the layout and wrong for anything floating above it:
	// the context menu used -4 and the addon grid showed straight through it.
	//
	// Angular never had to decide this — mat-menu and mat-select got their opaque surface from
	// mat.all-component-themes, which the port dropped along with the rest of Material. Checking
	// the computed alpha rather than the token, since the token is what keeps being chosen wrong.
	await stubPreload(page);
	await openMyAddons(page);

	const alphaOf = (css: string) => {
		const parts = css.match(/[\d.]+/g)!.map(Number);
		return parts.length > 3 ? parts[3] : 1;
	};

	// The page-actions menu behind the ⋮ button.
	await page.locator('.page-actions-btn, [aria-label="More"], .wu-btn-icon').last().click();
	const menu = page.locator('.context-menu');
	await expect(menu).toBeVisible();
	expect(alphaOf(await menu.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(1);
	await page.keyboard.press('Escape');

	// The client dropdown panel.
	await page.locator('.select-trigger').click();
	const panel = page.locator('.select-content');
	await expect(panel).toBeVisible();
	expect(alphaOf(await panel.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(1);
});
