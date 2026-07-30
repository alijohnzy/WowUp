import { expect, test, type Page } from '@playwright/test';

// Not a test — a visual harness. Renders My Addons with representative data and writes a
// screenshot so the theme port can be compared against the Angular app side by side.
// Run: npx playwright test e2e/screenshot.spec.ts

const INSTALLATION = {
	id: 'inst-1',
	clientType: 1,
	label: 'Retail',
	displayName: 'World of Warcraft',
	location: '/games/wow/_retail_/Wow.exe',
	selected: true,
	defaultAddonChannelType: 0,
	defaultAutoUpdate: false
};

const PROVIDERS = [
	'Zip',
	'RaiderIO',
	'WowUpCompanion',
	'TukUI',
	'WowInterface',
	'GitHub',
	'Wago',
	'Curse',
	'CurseV2'
].map((name) => ({ providerName: name.toLowerCase(), enabled: false, canEdit: true }));

function addon(name: string, author: string, opts: Record<string, unknown> = {}) {
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
		installedVersion: '12.0.5',
		latestVersion: '12.0.5',
		installedFolderList: [name],
		installedFolders: name,
		gameVersion: ['10.2.7'],
		channelType: 0,
		externalChannel: 'Stable',
		isIgnored: false,
		autoUpdateEnabled: false,
		autoUpdateNotificationsEnabled: false,
		isLoadOnDemand: false,
		installedAt: new Date('2025-06-01').toISOString(),
		releasedAt: new Date('2023-07-01').toISOString(),
		summary: `${name} summary`,
		dependencies: [],
		externalIds: [],
		...opts
	};
}

const ADDONS = [
	addon('Masque', 'StormFX', { latestVersion: '10.2.7' }),
	addon('Masque: Caith', 'StormFX', { latestVersion: '10.2.7' }),
	addon('Masque: Entropy', 'StormFX', { latestVersion: '10.2.7' }),
	addon('Ability Team Tracker', 'Tandanu'),
	addon('ActionBarsEnhanced', 'InfusOnWoW'),
	addon('Addon Profiler', 'Terciob'),
	addon('AddonUsage', 'Ro'),
	addon('Advanced Death Logs', 'Details'),
	addon('AdvancedInterfaceOptions', 'Sortokk'),
	addon('Angry Keystones', 'Ermad'),
	addon('Auctionator', 'Aunder', { isIgnored: true })
];

async function stub(page: Page, theme = 'default-theme', rows: unknown[] = ADDONS) {
	await page.addInitScript(
		({ installs, providers, addonRows, currentTheme }) => {
			// Consent is a first-run gate that blocks bootstrap until answered — seed it as
			// already-answered so suites land on the page under test.
			const store: Record<string, unknown> = {
				telemetry_enabled: false,
				wago_prompt: true,
				update_notes_popup_version: '2.23.0',
				addon_migration_version: '2.23.0',
				wow_installations: installs,
				addon_providers: providers,
				current_theme: currentTheme
			};
			(window as never as Record<string, unknown>)['platform'] = 'linux';
			(window as never as Record<string, unknown>)['userDataPath'] = '/tmp/wowup';
			(window as never as Record<string, unknown>)['logPath'] = '/tmp/wowup/logs';
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
							return Promise.resolve(addonRows);
						case 'addons-get-available-for-update':
							return Promise.resolve(
								(addonRows as { name: string }[]).filter((a) => a.name.startsWith('Masque'))
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
		{ installs: [INSTALLATION], providers: PROVIDERS, addonRows: rows, currentTheme: theme }
	);
	await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

test('capture My Addons', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await stub(page);
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'My Addons' }).click();
	await page.locator('.ag-row').first().waitFor({ state: 'visible', timeout: 15000 });
	await page.waitForTimeout(500);
	await page.screenshot({ path: 'screenshots/my-addons.png', fullPage: false });
});

test('capture Options', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await stub(page);
	await page.goto('/#/options');
	await page.waitForTimeout(800);
	await page.screenshot({ path: 'screenshots/options.png', fullPage: false });
});

test('capture addon detail dialog', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await stub(page);
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'My Addons' }).click();
	await page.locator('.ag-row').first().waitFor({ state: 'visible', timeout: 15000 });
	await page.locator('.ag-row').first().dblclick();
	await page.locator('dialog.addon-detail').waitFor({ state: 'visible', timeout: 10000 });
	await page.waitForTimeout(400);
	await page.screenshot({ path: 'screenshots/addon-detail.png' });
});

// Light themes are where hardcoded white tints and white-on-white text show up, so they get
// their own capture. The theme is a preference read at boot, hence the store seed.
test('capture light theme', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await stub(page, 'default-theme-light-theme');
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'My Addons' }).click();
	await page.locator('.ag-row').first().waitFor({ state: 'visible', timeout: 15000 });
	await page.waitForTimeout(500);
	await page.screenshot({ path: 'screenshots/light-my-addons.png' });
});

test('capture light theme options', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await stub(page, 'default-theme-light-theme');
	await page.goto('/#/options');
	await page.waitForTimeout(800);
	await page.screenshot({ path: 'screenshots/light-options.png' });
});

// A description-heavy dialog: the markdown body is where github-markdown-css's own colours
// fight the theme, so it needs a capture of its own.
const MARKDOWN = `
<h1>[EN]: ActionBarsEnhanced</h1>
<blockquote>Lightweight customization of World of Warcraft's default action bars.</blockquote>
<h2>Options refactoring</h2>
<ul>
  <li>Added ability to quickly apply preinstalled or custom profiles</li>
  <li>All settings moved to the Advanced tab</li>
  <li>Added copy-paste functionality for settings within the same category</li>
</ul>
<p>See <a href="https://example.com">the docs</a> for details, or run <code>/abe</code>.</p>
<h3>Notes</h3>
<ol><li>First</li><li>Second</li></ol>
`;

test('capture addon detail markdown', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await stub(page, 'default-theme', [
		addon('ActionBarsEnhanced', 'Hndrxuprt', {
			latestChangelog: MARKDOWN,
			latestChangelogVersion: '12.0.5'
		})
	]);
	await page.goto('/');
	await page.locator('.tab-strip').getByRole('link', { name: 'My Addons' }).click();
	await page.locator('.ag-row').first().waitFor({ state: 'visible', timeout: 15000 });
	await page.locator('.ag-row').first().dblclick();
	await page.locator('dialog.addon-detail').waitFor({ state: 'visible', timeout: 10000 });
	await page.locator('dialog.addon-detail').getByRole('tab', { name: 'Changelog' }).click();
	await page.waitForTimeout(400);
	await page.screenshot({ path: 'screenshots/addon-detail-markdown.png' });
});

test("the rail widens to fit each flavour's ad panel", async ({ page }) => {
	await stub(page);
	await page.goto('/');
	await page.locator('.tab-strip').waitFor({ state: 'visible', timeout: 10000 });

	// The ad only renders when a provider requires ads, which the fixtures disable. Toggling the
	// classes the component would set exercises the width rules directly. `.tab-strip` animates
	// width over 120ms, so each measurement has to wait for the transition to settle.
	const width = async () =>
		Math.round(await page.locator('.tab-strip').evaluate((el) => el.getBoundingClientRect().width));
	const apply = async (flavour: string) =>
		page.locator('.tab-strip').evaluate((el, f) => {
			el.classList.remove('wago', 'curseforge');
			el.classList.add(f, 'has-ad');
		}, flavour);

	const base = await width();
	await apply('wago');
	await page.waitForTimeout(250);
	const wago = await width();
	await apply('curseforge');
	await page.waitForTimeout(250);
	const cf = await width();

	// The ad is fixed-size and lives inside the rail, so a rail narrower than the ad clips it —
	// which is what a hardcoded 200px did to the 400px CurseForge ad.
	expect(base).toBe(200);
	expect(wago).toBe(300);
	expect(cf).toBe(400);
});
