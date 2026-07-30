<script lang="ts">
	// Port of src/app/components/news-panel/news-panel.component.{ts,html} (175 LOC).
	//
	// The Angular component tracked its own visibility by subscribing to selectedHomeTab$ and
	// comparing against an @Input tabIndex, so it could lazy-load on first reveal — it stayed
	// mounted the whole time the app was running. Here the panel is only rendered while its
	// tab is selected, so "first reveal" is just mount, and _isSelectedTab, _isLazyLoaded and
	// the tabIndex input all disappear.
	//
	// onClickRefresh also piped through `delay(500)` before fetching. Nothing depended on it.

	import { AppConfig } from '$config/environment';
	import { t } from '$lib/i18n.svelte';
	import { isLinux, isMac, isWin } from '$lib/ipc';
	import { news, type NewsItem } from '$lib/state/news.svelte';
	import { session } from '$lib/state/session.svelte';
	import { snackbar } from '$lib/state/snackbar.svelte';
	import { confirmLinkNavigation } from '$lib/services/links';
	import * as clipboard from '$lib/services/clipboard';
	import { localeDate } from '$lib/utils/format';
	import Icon from '$lib/components/common/Icon.svelte';
	import ProgressSpinner from '$lib/components/common/ProgressSpinner.svelte';

	let isBusy = $state(false);

	// Was a newsItems$ subscription that mapped item count onto the footer text.
	// The footer's per-screen text. Scoped to this route's lifetime: the cleanup clears it
	// on the way out, which is what the tab-index guard used to approximate.
	$effect(() => {
		session.setContextText(
			news.items.length > 0 ? t('PAGES.NEWS.PAGE_CONTEXT_FOOTER', { count: news.items.length }) : ''
		);
		return () => session.setContextText('');
	});

	async function refresh() {
		isBusy = true;
		session.setContextText(t('COMMON.PROGRESS_SPINNER.LOADING'));
		try {
			await news.loadFeeds();
		} catch (e) {
			console.error(e);
		} finally {
			isBusy = false;
		}
	}

	// Skip the fetch if a previous mount already loaded recently.
	function isStale(): boolean {
		return (
			news.lastFetchedAt === 0 || Date.now() - news.lastFetchedAt >= AppConfig.newsRefreshIntervalMs
		);
	}

	$effect(() => {
		if (isStale()) void refresh();
	});

	async function onClickItem(item: NewsItem) {
		await confirmLinkNavigation(item.link);
	}

	async function onClickLink(item: NewsItem, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		await clipboard.writeText(item.link);
		snackbar.showSuccess('PAGES.NEWS.NEWS_LINK_COPY_TOAST', { timeout: 2000 });
	}
</script>

<div
	class="tab-container news-container"
	class:mac={isMac()}
	class:windows={isWin()}
	class:linux={isLinux()}
>
	<div class="theme-logo">
		<div class="logo-img"></div>
	</div>

	{#if isBusy}
		<div class="busy-container">
			<ProgressSpinner />
		</div>
	{:else}
		<div class="news-list text-1">
			{#each news.items as item (item.link)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="news-item" onclick={() => void onClickItem(item)}>
					<div class="thumbnail" style:background-image="url({item.thumbnail})"></div>
					<div class="news-body">
						<!-- Feed content. Was [innerHtml] in the Angular template; same trust boundary. -->
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<h2>{@html item.title}</h2>
						<div class="news-meta">
							<p>{localeDate(item.publishedAt)} - {item.publishedBy}</p>
							<button
								class="wu-btn wu-btn-icon"
								aria-label={t('PAGES.NEWS.NEWS_LINK_COPY_TOOLTIP')}
								title={t('PAGES.NEWS.NEWS_LINK_COPY_TOOLTIP')}
								onclick={(e) => void onClickLink(item, e)}
							>
								<Icon name="fas:link" />
							</button>
						</div>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<p class="description">{@html item.description}</p>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<div class="fab-container">
		<button
			class="wu-btn wu-btn-primary fab"
			disabled={isBusy}
			aria-label={t('PAGES.NEWS.REFRESH_TOOLTIP')}
			title={t('PAGES.NEWS.REFRESH_TOOLTIP')}
			onclick={() => void refresh()}
		>
			<Icon name="fas:rotate" />
		</button>
	</div>
</div>

<style>
	.tab-container {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.theme-logo {
		display: flex;
		justify-content: center;
		padding: 1.5rem 0;
	}

	.busy-container {
		flex: 1;
	}

	.news-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0 1rem 5rem;
	}

	.news-item {
		display: flex;
		gap: 1rem;
		padding: 0.75rem;
		border-radius: 4px;
		background: var(--background-secondary-4);
		box-shadow: 0 8px 10px 1px rgb(0 0 0 / 14%);
		cursor: pointer;
	}

	.thumbnail {
		flex: none;
		width: 120px;
		height: 80px;
		border-radius: 3px;
		background-position: center;
		background-size: cover;
	}

	.news-body {
		min-width: 0;
	}

	.news-body h2 {
		margin: 0 0 0.35rem;
		font-size: 1.1em;
	}

	.news-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.news-meta p {
		margin: 0;
	}

	.description {
		margin: 0.35rem 0 0;
		overflow-wrap: anywhere;
	}

	.fab-container {
		position: sticky;
		bottom: 1rem;
		display: flex;
		justify-content: flex-end;
		padding: 0 1rem;
	}

	.fab {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		box-shadow: 0 8px 10px 1px rgb(0 0 0 / 14%);
	}
</style>
