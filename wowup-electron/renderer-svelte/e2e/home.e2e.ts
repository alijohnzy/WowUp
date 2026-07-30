import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Behavioural tests for the app shell.
//
// The real navigation is the vertical tab rail (ported from app-vertical-tabs), not a tab
// bar — the Angular home component's <mat-tab-group> was header-less and driven by the
// rail. These assert against the rail.
//
// The renderer talks to the Electron preload bridge (window.wowup); it is stubbed here so
// the shell runs in a plain browser. The stub supplies a WoW installation, since the addon
// entries are disabled without one.

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

async function stubPreload(page: Page, opts: { installations?: unknown[]; theme?: string } = {}) {
	const installations = opts.installations ?? [INSTALLATION];
	const themeClass = opts.theme ?? 'default-theme';

	await page.addInitScript(
		([installs, theme]) => {
			const calls: Array<{ channel: string; args: unknown[] }> = [];
			// Consent is a first-run gate that blocks bootstrap until answered — seed it as
			// already-answered so suites land on the page under test.
			const store: Record<string, unknown> = {
				current_theme: theme,
				telemetry_enabled: false,
				wago_prompt: true,
				update_notes_popup_version: '2.23.0',
				addon_migration_version: '2.23.0',
				wow_installations: installs
			};

			(window as never as Record<string, unknown>)['__ipcCalls'] = calls;
			(window as never as Record<string, unknown>)['platform'] = 'linux';
			(window as never as Record<string, unknown>)['userDataPath'] = '/tmp/wowup';
			(window as never as Record<string, unknown>)['logPath'] = '/tmp/wowup/logs';

			(window as never as Record<string, unknown>)['wowup'] = {
				rendererInvoke: (channel: string, ...args: unknown[]) => {
					calls.push({ channel, args });
					switch (channel) {
						case 'get-app-version':
							return Promise.resolve('2.23.0');
						case 'get-locale':
							return Promise.resolve('en');
						case 'store-get-object':
							return Promise.resolve(store[args[1] as string]);
						case 'addons-get-all':
						case 'addons-get-available-for-update':
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
				openExternal: (url: string) => {
					calls.push({ channel: 'openExternal', args: [url] });
					return Promise.resolve();
				},
				openPath: () => Promise.resolve('')
			};
		},
		[installations, themeClass] as const
	);
}

const rail = (page: Page) => page.locator('.tab-strip');

test('renders the navigation rail with translated entries', async ({ page }) => {
	await stubPreload(page);
	await page.goto('/');

	// Only My Addons, Get Addons and Options appear. The Angular component defined News and
	// Account tabs but left them out of tabsTop/tabsBottom, so they never rendered.
	for (const name of ['My Addons', 'Get Addons', 'Options']) {
		await expect(rail(page).getByRole('link', { name })).toBeVisible();
	}
	await expect(rail(page).getByRole('link', { name: 'News' })).toHaveCount(0);
});

test('selecting Options in the rail renders the Options screen', async ({ page }) => {
	await stubPreload(page);
	await page.goto('/');

	await rail(page).getByRole('link', { name: 'Options' }).click();

	// The Options screen has its own vertical rail nested in the content area.
	const optionsRail = page.locator('.nav-item-list');
	await expect(optionsRail.getByRole('tab', { name: 'About' })).toBeVisible();
	await expect(optionsRail.getByRole('tab', { name: 'Debug' })).toBeVisible();
});

test('shell renders titlebar and footer with the app version', async ({ page }) => {
	await stubPreload(page);
	await page.goto('/');

	await expect(page.locator('.titlebar')).toBeVisible();
	await expect(page.locator('footer')).toContainText('v2.23.0');
});

test('addon entries are disabled when no WoW installation exists', async ({ page }) => {
	// The Angular version disabled these the same way — they are meaningless with no client.
	await stubPreload(page, { installations: [] });
	await page.goto('/');

	// A disabled link keeps its href (so it stays focusable and does not resize) and reports
	// the state through aria-disabled; `toBeDisabled` only understands the DOM property.
	await expect(rail(page).getByRole('link', { name: 'My Addons' })).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	await expect(rail(page).getByRole('link', { name: 'Get Addons' })).toHaveAttribute(
		'aria-disabled',
		'true'
	);
});

test('with no installation the app opens on Options', async ({ page }) => {
	// session.onWowInstallationsChange redirects to /options so a first-run user lands
	// somewhere they can actually add a client.
	await stubPreload(page, { installations: [] });
	await page.goto('/');

	await expect(page.locator('.nav-item-list')).toBeVisible();
	await expect(rail(page).getByRole('link', { name: 'Options' })).toHaveClass(/selected/);
	await expect(page).toHaveURL(/#\/options$/);
});

test('the rail collapses and expands', async ({ page }) => {
	await stubPreload(page);
	await page.goto('/');

	await expect(rail(page)).not.toHaveClass(/collapsed/);
	await rail(page).getByRole('button', { name: 'Collapse' }).click();
	await expect(rail(page)).toHaveClass(/collapsed/);
});

test('external links in the rail open in the OS browser', async ({ page }) => {
	await stubPreload(page);
	await page.goto('/');

	await rail(page).getByRole('link', { name: 'Discord' }).click();

	const calls = await page.evaluate(
		() => (window as never as Record<string, { channel: string; args: unknown[] }[]>)['__ipcCalls']
	);
	const external = calls.filter((c) => c.channel === 'openExternal');
	expect(external.map((c) => c.args[0])).toContain('https://discord.gg/rk4F5aD');
	// Still inside the app: the index redirect has landed on My Addons and the external link
	// did not navigate the renderer away from it.
	await expect(page).toHaveURL(/#\/my-addons$/);
});

// Both themes, because the failure was direction-dependent: the panel background came from a
// var(--…) lookup while the text came from inheritance, and only one of those was fixed first.
// A dark-only assertion would not have noticed light mode regressing the same way.
for (const { label, theme, textLighterThanPanel } of [
	{ label: 'dark', theme: 'default-theme', textLighterThanPanel: true },
	{ label: 'light', theme: 'default-theme-light-theme', textLighterThanPanel: false }
]) {
	test(`the client dropdown is readable where it portals outside the app root (${label})`, async ({
		page
	}) => {
		// bits-ui renders Select.Content into <body>, a sibling of .app-root. Two separate things
		// have to survive that, and the first version of this test only checked one:
		//
		//   background — a var(--…) lookup, which needs the theme class on an ancestor of <body>
		//   text       — plain inheritance, which needs `color` set on <body> itself
		//
		// Fixing the first left dark-on-dark text and the test still passed, because it asserted
		// the panel's background and nothing else. Contrast cannot pass unless both are right.
		await stubPreload(page, { theme });
		await page.goto('/');

		await page.locator('.select-trigger').click();
		const item = page.locator('.select-item').first();
		await expect(item).toBeVisible();

		const { text, bg } = await item.evaluate((el) => {
			const panel = el.closest('.select-content')!;
			return {
				text: getComputedStyle(el).color,
				bg: getComputedStyle(panel).backgroundColor
			};
		});

		const luminance = (css: string) => {
			const [r, g, b] = css.match(/[\d.]+/g)!.map(Number);
			return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
		};

		// Unresolved background lands on transparent; unset text inherits the UA's black.
		expect(bg).not.toBe('rgba(0, 0, 0, 0)');
		expect(Math.abs(luminance(text) - luminance(bg))).toBeGreaterThan(0.4);

		expect(luminance(text) > luminance(bg)).toBe(textLighterThanPanel);
	});
}

test('the logo and its glow sit in the window corner, over the titlebar', async ({ page }) => {
	// The shell is a grid: the titlebar is a full-width row above the rail. In the original both
	// the logo and the corner glow are position: fixed, so they float over that titlebar at the
	// window's top-left. This port had them in flow inside the rail — which starts *below* the
	// titlebar — so the whole corner treatment sat about 30px too low. Asserting against the
	// viewport rather than against the rail, since being inside the rail was the bug.
	await stubPreload(page);
	await page.goto('/');

	const titlebar = page.locator('.titlebar');
	const logo = page.locator('.rail-logo');
	await expect(logo).toBeVisible();

	const titlebarBox = (await titlebar.boundingBox())!;
	const logoBox = (await logo.boundingBox())!;

	// Anchored near the window corner, not pushed down by the titlebar row.
	expect(logoBox.y).toBeLessThan(titlebarBox.y + titlebarBox.height);
	expect(logoBox.x).toBeLessThan(20);

	// And it overlaps the titlebar rather than clearing it.
	expect(logoBox.y + logoBox.height).toBeGreaterThan(titlebarBox.y + titlebarBox.height);
});

test('the selected option is marked the way mat-option marked it', async ({ page }) => {
	// mat-select in single-select mode mutes the chosen row and puts an accent check on its
	// trailing edge, and mat-form-field's fill appearance underlines the trigger in the accent
	// colour while the panel is open. None of that came across in the first pass, which styled
	// the control approximately rather than reproducing what Material drew.
	await stubPreload(page, {
		// `label`, not `displayName` — warcraft-installation.svelte.ts recomputes displayName
		// from label on load, so a fixture that sets only displayName is silently overwritten.
		installations: [
			{ ...INSTALLATION, id: 'i1', label: 'Retail', selected: true },
			{ ...INSTALLATION, id: 'i2', label: 'PTR', clientType: 2, selected: false }
		]
	});
	await page.goto('/');

	const trigger = page.locator('.select-trigger');
	await trigger.click();
	await expect(trigger).toHaveAttribute('data-state', 'open');

	const selected = page.locator('.select-item[data-selected]');
	await expect(selected).toHaveCount(1);
	await expect(selected).toHaveAttribute('data-value', 'i1');
	await expect(selected.locator('.item-check')).toBeVisible();

	// The unselected row reserves the same width but hides its check, so labels stay aligned.
	const other = page.locator('.select-item:not([data-selected])').first();
	await expect(other.locator('.item-check')).toBeHidden();
});

test('the key art renders behind the app', async ({ page }) => {
	// src/index.html carries this element in the Angular build and app.html did not, so the
	// artwork was simply absent. It is not incidental: every --background-secondary-* token in
	// the theme is rgba rather than a solid colour specifically so this shows through, which is
	// why the UI read flat without it.
	//
	// Asserting the image actually loads, not just that the element exists — a broken relative
	// path under file:// would leave the div present and empty, which looks identical to the bug.
	await stubPreload(page);
	await page.goto('/');

	const bg = page.locator('#wow-background');
	await expect(bg).toBeAttached();

	const { url, loaded, zIndex } = await bg.evaluate(async (el) => {
		const style = getComputedStyle(el);
		const src = style.backgroundImage.match(/url\("?([^")]+)"?\)/)?.[1] ?? '';
		const ok = await new Promise<boolean>((resolve) => {
			const img = new Image();
			img.onload = () => resolve(true);
			img.onerror = () => resolve(false);
			img.src = src;
		});
		return { url: src, loaded: ok, zIndex: style.zIndex };
	});

	expect(url).toContain('wow-war-within-background');
	expect(loaded).toBe(true);
	expect(Number(zIndex)).toBeLessThan(0);

	// And nothing paints over it. The first version of this test stopped at "the image loads",
	// which passed while .app-root's 90%-opaque background left about 1% of the art visible —
	// loading correctly and being invisible look the same from the element's own properties.
	// app.component.scss's .app has no background at all; this asserts the port keeps that.
	const appBg = await page
		.locator('.app-root')
		.evaluate((el) => getComputedStyle(el).backgroundColor);
	expect(appBg).toBe('rgba(0, 0, 0, 0)');

	// Two opacities, and both matter. 0.1 ships in the markup so the WowUp logo reads over the
	// art on the splash; 0.5 is what the running app wears. Porting only the markup left it at
	// 10% under rgba chrome — present, loading, and effectively invisible.
	//
	// The shipped value is read from the built HTML, not the DOM: the app raises it as soon as
	// it is ready and does so by mutating the inline style, so by the time a test can look, the
	// original value is gone.
	const shipped = readFileSync(new URL('../build/index.html', import.meta.url), 'utf8');
	expect(shipped).toContain('opacity: 0.1');
	expect(shipped).toContain('transition: opacity');

	await expect
		.poll(async () => Number(await bg.evaluate((el) => getComputedStyle(el).opacity)), {
			timeout: 5000
		})
		.toBeCloseTo(0.5, 2);
});
