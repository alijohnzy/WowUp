<script lang="ts">
	// Replaces ng-gallery (+ its Lightbox directive), which the addon-detail dialog used for
	// the screenshots tab and nothing else.
	//
	// The Angular version needed a Gallery service injected into the component, an ImageItem
	// wrapper class per URL, a gallery.ref().load() call to push the items into that service,
	// a <mat-grid-list>/<mat-grid-tile> pair for the thumbnails, and a [lightbox]="i"
	// directive to bind each thumb back to the gallery ref by index.
	//
	// All of that was a thumbnail grid plus an overlay. CSS grid does the first and the
	// element already sits in the top layer (the detail dialog is a native <dialog>), so the
	// overlay is just a fixed-position div — no portal, no service, no item wrapper.

	import { t } from '$lib/i18n.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		images: string[];
	}

	let { images }: Props = $props();

	// null when the lightbox is closed.
	let openIndex = $state<number | null>(null);

	let current = $derived(openIndex === null ? '' : (images[openIndex] ?? ''));

	function step(delta: number) {
		if (openIndex === null || images.length === 0) return;
		// Wrap, matching ng-gallery's default loop behaviour.
		openIndex = (openIndex + delta + images.length) % images.length;
	}

	function onKeydown(event: KeyboardEvent) {
		if (openIndex === null) return;

		switch (event.key) {
			case 'Escape':
				// Stop the native <dialog> ancestor from closing along with the lightbox.
				event.stopPropagation();
				event.preventDefault();
				openIndex = null;
				break;
			case 'ArrowRight':
				step(1);
				break;
			case 'ArrowLeft':
				step(-1);
				break;
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="image-grid">
	{#each images as image, i (image)}
		<button
			type="button"
			class="image-thumb-container"
			aria-label={t('DIALOGS.ADDON_DETAILS.IMAGES_TAB')}
			onclick={() => (openIndex = i)}
		>
			<img class="image-thumb" src={image} alt="" loading="lazy" />
		</button>
	{/each}
</div>

{#if openIndex !== null}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="lightbox"
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label={t('DIALOGS.ADDON_DETAILS.IMAGES_TAB')}
		onclick={() => (openIndex = null)}
	>
		<button
			type="button"
			class="lightbox-close"
			aria-label={t('COMMON.CLOSE')}
			onclick={() => (openIndex = null)}
		>
			<Icon name="fas:xmark" size="1.5em" />
		</button>

		{#if images.length > 1}
			<button
				type="button"
				class="lightbox-nav prev"
				aria-label={t('COMMON.PREVIOUS')}
				onclick={(e) => {
					e.stopPropagation();
					step(-1);
				}}
			>
				<Icon name="fas:chevron-left" size="1.5em" />
			</button>
			<button
				type="button"
				class="lightbox-nav next"
				aria-label={t('COMMON.NEXT')}
				onclick={(e) => {
					e.stopPropagation();
					step(1);
				}}
			>
				<Icon name="fas:chevron-right" size="1.5em" />
			</button>
		{/if}

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<img class="lightbox-image" src={current} alt="" onclick={(e) => e.stopPropagation()} />

		{#if images.length > 1}
			<div class="lightbox-counter">{openIndex + 1} / {images.length}</div>
		{/if}
	</div>
{/if}

<style>
	.image-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 3px;
		padding-top: 1rem;
	}

	.image-thumb-container {
		display: block;
		aspect-ratio: 1;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
		overflow: hidden;
	}

	.image-thumb {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 2px;
		box-shadow:
			0 5px 5px -3px rgb(0 0 0 / 20%),
			0 8px 10px 1px rgb(0 0 0 / 14%);
	}

	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgb(0 0 0 / 85%);
	}

	.lightbox-image {
		max-width: 90vw;
		max-height: 90vh;
		object-fit: contain;
	}

	.lightbox-close,
	.lightbox-nav {
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border: 0;
		border-radius: 50%;
		background: rgb(0 0 0 / 45%);
		color: #fff;
		cursor: pointer;
	}

	.lightbox-close {
		top: 1rem;
		right: 1rem;
	}

	.lightbox-nav.prev {
		left: 1rem;
	}

	.lightbox-nav.next {
		right: 1rem;
	}

	.lightbox-counter {
		position: absolute;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		color: #fff;
		font-size: 0.9em;
	}
</style>
