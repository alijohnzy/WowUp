<script lang="ts">
	// Port of src/app/components/common/webview/webview.component.{ts,html} (160 LOC) — the
	// ad frame in the nav rail.
	//
	// The <webview> tag stays imperative, as it was in Angular: its booleans (nodeintegration,
	// plugins, allowpopups) are presence-based as HTML attributes, so `nodeintegration="false"`
	// would *enable* it. Setting them as properties on the element is the only correct way, and
	// that means creating the element in code rather than in the template.
	//
	// Removed: nanoid (crypto.randomUUID is native), NgZone.run() around the new-window handler
	// (no zones to re-enter), and a destroy$ Subject feeding three takeUntil pipes. Also fixed
	// `this.webviewContainer.nativeElement.innerHTML = 0` in ngOnDestroy — assigning the number
	// 0 to innerHTML, which stringifies to "0" and left a stray text node behind.

	import { AppConfig } from '$config/environment';
	import { on, isTauri } from '$lib/ipc';
	import { adFrameSrc, onAdFrameToken } from '$lib/services/ad-frame-proxy';
	import { session } from '$lib/state/session.svelte';
	import { confirmLinkNavigation } from '$lib/services/links';
	import { getAssetFilePath } from '$lib/services/files';
	import { onUiMessage } from '$lib/services/ui-message';
	import { t } from '$lib/i18n.svelte';
	import type { AdPageOptions } from 'wowup-lib-core';

	const IPC_WEBVIEW_NEW_WINDOW = 'webview-new-window';

	interface Props {
		options: AdPageOptions;
	}

	let { options }: Props = $props();

	// Electron's WebviewTag typings are not in scope for the renderer build. Only the members
	// below are used, and the settable ones must be assigned as properties, not attributes.
	interface WebviewTag extends HTMLElement {
		reloadIgnoringCache(): void;
		isDevToolsOpened(): boolean;
		openDevTools(): void;
		closeDevTools(): void;
	}

	interface ConfigurableWebviewTag extends WebviewTag {
		src: string;
		preload: string;
		partition: string;
		nodeintegration: boolean;
		nodeintegrationinsubframes: boolean;
		plugins: boolean;
		allowpopups: boolean;
	}

	let tag: WebviewTag | undefined;
	let ready = $state(false);
	let reloadNonce = $state(0);

	// Only meaningful under Tauri; `#key` on it forces a fresh document on reload.
	let frameSrc = $derived(adFrameSrc(options, reloadNonce));

	// The frame is cross-origin by design, so postMessage is the only way the token can come
	// back — the same key `assets/preload/wago.js` sends over IPC in the Electron build.
	$effect(() => (isTauri() ? onAdFrameToken(() => (ready = true)) : undefined));

	function onWebviewReady() {
		ready = true;
	}

	async function buildWago(container: HTMLElement): Promise<HTMLElement> {
		const preloadPath = options.preloadFilePath
			? `file://${await getAssetFilePath(options.preloadFilePath)}`
			: '';

		const webview = document.createElement('webview') as ConfigurableWebviewTag;
		webview.id = crypto.randomUUID();
		webview.src = options.pageUrl;
		webview.setAttribute('style', 'width: 100%; height: 100%;');
		webview.nodeintegration = false;
		webview.nodeintegrationinsubframes = false;
		webview.plugins = false;
		webview.allowpopups = true;
		webview.partition = options.partition ?? 'memcache';
		webview.preload = preloadPath;

		return attach(container, webview, '100%', '100%');
	}

	function buildCurseForge(container: HTMLElement): HTMLElement {
		// Overwolf supplies <owadview>, which is fixed-size and takes no configuration.
		const webview = document.createElement('owadview') as WebviewTag;
		return attach(container, webview, '400px', '300px');
	}

	function attach(
		container: HTMLElement,
		webview: WebviewTag,
		width: string,
		height: string
	): HTMLElement {
		tag = webview;
		webview.addEventListener('error', (evt) => console.error('ERROR', evt));
		webview.addEventListener('did-fail-load', (evt) => console.error('did-fail-load', evt));
		webview.addEventListener('dom-ready', onWebviewReady, { once: true });

		const placeholder = document.createElement('div');
		placeholder.style.width = width;
		placeholder.style.height = height;
		placeholder.appendChild(webview);
		container.appendChild(placeholder);
		return placeholder;
	}

	function adWebview(container: HTMLElement) {
		// Under Tauri the frame is an <iframe> in the template below, not something built
		// here — see $lib/services/ad-frame-proxy and src-tauri/src/ad.rs. The CurseForge
		// branch needs <owadview>, which only @overwolf/ow-electron supplies, so the tauri
		// flavour enables Wago to have an ad at all (environment.prod.tauri.ts).
		if (isTauri()) return;

		let placeholder: HTMLElement | undefined;

		if (AppConfig.wago.enabled) {
			void buildWago(container)
				.then((el) => (placeholder = el))
				.catch((e: unknown) => console.error(e));
		} else if (AppConfig.curseforge.enabled) {
			placeholder = buildCurseForge(container);
		}

		return () => {
			if (tag?.isDevToolsOpened()) tag.closeDevTools();
			placeholder?.remove();
			tag = undefined;
			ready = false;
		};
	}

	// A provider can ask for a fresh ad after re-authenticating.
	$effect(() =>
		onUiMessage((msg) => {
			if (msg.action !== 'ad-frame-reload' || !ready) return;
			if (isTauri()) {
				// Re-assigning src is the iframe's reloadIgnoringCache: the proxy refetches.
				reloadNonce += 1;
			} else {
				tag?.reloadIgnoringCache();
			}
		})
	);

	$effect(() =>
		session.debugAdFrame.subscribe(() => {
			if (ready && tag && !tag.isDevToolsOpened()) tag.openDevTools();
		})
	);

	$effect(() =>
		on(IPC_WEBVIEW_NEW_WINDOW, (_evt, details: never) => {
			const url = (details as { url?: string }).url;
			if (url) void confirmLinkNavigation(url);
		})
	);
</script>

<div class="webview-container" {@attach adWebview}>
	{#if isTauri() && frameSrc}
		{#key frameSrc}
			<!-- A document node, unlike a child webview or a borderless window: it clips and
			     z-orders with the app, so dialogs draw over it instead of under it. -->
			<!-- scrolling="no" because the page is a 300x250 creative followed by Wago's own
			     description, and the slot is only as tall as the creative. Without it the
			     leftover text gives the frame a scrollbar inside the nav rail. -->
			<iframe
				src={frameSrc}
				title={t('ADS.AD_EXPLAINER_BUTTON')}
				referrerpolicy="no-referrer"
				scrolling="no"
			></iframe>
		{/key}
	{/if}
</div>

<style>
	.webview-container {
		/* Absolute against .ad (VerticalTabs), which is the element with the ad unit's real
		   size. A height: 100% chain collapsed here: the iframe ended up 0x0, and every
		   element inside the ad document measured 0x0 with it, so the frame loaded and ran
		   but laid out nothing. */
		position: absolute;
		inset: 0;
	}

	iframe {
		/* display: block stops the inline baseline gap under the frame. */
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
	}
</style>
