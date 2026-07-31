// The five screens, as routes.
//
// In Angular these were tabs of a single <mat-tab-group> whose headers were hidden with CSS
// (`class="header-less-tabs"`), driven by `sessionService.selectedHomeTab$`. The first pass of
// this port carried that shape over literally — one `{#if}` chain over a number — which meant
// every screen's code shipped in the initial bundle and nothing had a URL.
//
// TAB_INDEX_* does not disappear, because two things outside the router still speak in indices:
// `session.setContextText(tabIndex, …)` guards on the visible tab, and the persisted
// selected-tab preference is written by both renderers during the migration. This module is the
// one place that translates between the two.

import {
	TAB_INDEX_ABOUT,
	TAB_INDEX_GET_ADDONS,
	TAB_INDEX_MY_ADDONS,
	TAB_INDEX_NEWS,
	TAB_INDEX_SETTINGS
} from '$common/constants';

export const ROUTES = {
	myAddons: '/my-addons',
	getAddons: '/get-addons',
	account: '/account',
	news: '/news',
	options: '/options'
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

const TAB_INDEX_BY_PATH: Record<RoutePath, number> = {
	[ROUTES.myAddons]: TAB_INDEX_MY_ADDONS,
	[ROUTES.getAddons]: TAB_INDEX_GET_ADDONS,
	[ROUTES.account]: TAB_INDEX_ABOUT,
	[ROUTES.news]: TAB_INDEX_NEWS,
	[ROUTES.options]: TAB_INDEX_SETTINGS
};

/**
 * The address of a route — for `<a href>` and for `goto()` alike.
 *
 * This is `'#' + path` and NOT SvelteKit's `resolve()`, which is what
 * `svelte/no-navigation-without-resolve` asks for. `resolve()` returns
 * `base + (hash_routing ? '#' : '') + route`, and under this app's combination —
 * `router.type: 'hash'`, `paths.relative: true`, loaded from `file://` — `base` resolves to the
 * absolute build directory. Measured in Electron:
 *
 *   resolve('/my-addons') === '/home/…/renderer-svelte/build#/my-addons'
 *
 * `goto()` treats that as a path navigation, Electron reports
 * `ERR_FILE_NOT_FOUND` for `file:///home/…/build#/my-addons`, the window reloads `index.html`,
 * bootstrap redirects again — an infinite reload loop. The nav-rail links break the same way.
 *
 * The rule is disabled in eslint.config.js with this reference. It is right in general; it is
 * wrong for a hash-routed app served off the filesystem.
 *
 * Under Tauri none of that applies: the app is served from tauri://localhost, history routing
 * is on, and the address is the plain path. `__HASH_ROUTING__` is inlined at build time from
 * BUILD_SHELL (see vite.config.ts), so only one branch survives into the bundle.
 */
export const href = (path: RoutePath): string => (__HASH_ROUTING__ ? `#${path}` : path);

/**
 * Which route is showing.
 *
 * Deliberately `page.route.id` and not `page.url.pathname`: under `router.type: 'hash'` the
 * pathname is always `/` — the route lives in the hash — so a pathname comparison silently
 * matches nothing. `route.id` is SvelteKit's resolved route and needs no parsing.
 */
export const currentPath = (routeId: string | null | undefined): RoutePath | undefined =>
	routeId !== null && routeId !== undefined && routeId in TAB_INDEX_BY_PATH
		? (routeId as RoutePath)
		: undefined;

export const tabIndexForRoute = (routeId: string | null | undefined): number =>
	TAB_INDEX_BY_PATH[currentPath(routeId) ?? ROUTES.myAddons];
