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

	import { IPC_AD_VIEW_LINK, IPC_AD_VIEW_RELOAD, IPC_AD_VIEW_SET_BOUNDS } from '$common/constants';
	import { AppConfig } from '$config/environment';
	import { invoke, on, isTauri } from '$lib/ipc';
	import { dialogs } from '$lib/state/dialogs.svelte';
	import { openModals } from '$lib/state/open-modals.svelte';
	import { session } from '$lib/state/session.svelte';
	import { zoom } from '$lib/state/zoom.svelte';
	import { confirmLinkNavigation } from '$lib/services/links';
	import { getAssetFilePath } from '$lib/services/files';
	import { onUiMessage } from '$lib/services/ui-message';
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

	// ---- Tauri: a native webview over this slot ------------------------------------------
	//
	// Wago's page only fills an ad at its real URL, which an <iframe> cannot show (it sends
	// X-Frame-Options: SAMEORIGIN), so under Tauri the ad is a webview of its own laid over
	// this element (src-tauri/src/ad_view.rs). This element only holds the space and reports
	// where it is. The view draws above the page, so it is hidden while a dialog is open —
	// hidden, not unloaded: the page renews the Wago key on its own timer.
	let slot: HTMLElement | undefined;
	let coveredByDialog = $derived(dialogs.stack.length > 0 || openModals.count > 0);

	function reportSlot(visible = !coveredByDialog): void {
		const r = slot?.getBoundingClientRect();
		// Rust wants logical pixels; the page's CSS pixels are scaled by the webview zoom.
		const z = zoom.factor;
		const bounds = r
			? { x: r.left * z, y: r.top * z, width: r.width * z, height: r.height * z, visible }
			: { x: 0, y: 0, width: 0, height: 0, visible: false };
		invoke(IPC_AD_VIEW_SET_BOUNDS, bounds).catch((e: unknown) =>
			console.error('[ad] set bounds failed', e)
		);
	}

	function nativeAdSlot(el: HTMLElement) {
		slot = el;
		let frame = 0;
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => reportSlot());
		};
		// The slot's own size, and anything that moves it: the window, or the layout around it.
		const observer = new ResizeObserver(schedule);
		observer.observe(el);
		observer.observe(document.documentElement);
		window.addEventListener('resize', schedule);
		schedule();

		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener('resize', schedule);
			slot = undefined;
			reportSlot(false);
		};
	}

	$effect(() => {
		// Re-place when a dialog opens or closes, or the zoom changes.
		void coveredByDialog;
		void zoom.factor;
		if (isTauri() && slot) reportSlot();
	});

	$effect(() =>
		isTauri()
			? on(IPC_AD_VIEW_LINK, (_evt, url: never) => void confirmLinkNavigation(url as string))
			: undefined
	);

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
		// Under Tauri the ad is the native view above, not something built here. The
		// CurseForge branch needs <owadview>, which only @overwolf/ow-electron supplies, so the
		// tauri flavour enables Wago to have an ad at all (environment.prod.tauri.ts).
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
			if (msg.action !== 'ad-frame-reload') return;
			if (isTauri()) {
				invoke(IPC_AD_VIEW_RELOAD).catch((e: unknown) => console.error('[ad] reload failed', e));
			} else if (ready) {
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
	{#if isTauri()}
		<div class="native-ad-slot" {@attach nativeAdSlot}></div>
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

	.native-ad-slot {
		/* The native view is laid over exactly this box, so it must have the slot's size. */
		width: 100%;
		height: 100%;
	}
</style>
