<script lang="ts">
	// Port of components/addons/addon-thumbnail (58 LOC).
	//
	// Falls back to the addon's initial when it has no thumbnail — and, unlike the original, also
	// when the thumbnail fails to load. That second case is common rather than exotic: the WowUp
	// hub serves GitHub repository social-preview images as presigned S3 URLs carrying
	// `X-Amz-Expires=300`, so a five-minute-old response yields URLs that answer 618 with a page
	// of HTML. Addons whose `image_url` is null fall back to the owner's avatar, a permanent URL,
	// which is why some rows on Get Addons had icons and their neighbours did not.
	//
	// The Angular version renders `<img [src]="url" loading="lazy" />` with no `alt`, so a dead
	// URL leaves the browser's broken-image glyph. This one had `alt=""`, which renders nothing
	// at all — an empty box. Neither shows the addon, and the component already owns a designed
	// placeholder for exactly this, so it uses it.

	interface Props {
		url?: string;
		name?: string;
		size?: number;
	}

	let { url = '', name = '', size = 40 }: Props = $props();

	let letter = $derived(name?.charAt(0).toUpperCase() ?? '');

	// Tracks the URL that failed rather than a boolean, so a new url is retried without needing
	// an effect to reset the flag.
	let failedUrl = $state<string | undefined>(undefined);
	let showImage = $derived(!!url && failedUrl !== url);
</script>

<div
	class="addon-logo-container bg-secondary-3 rounded"
	style:width="{size}px"
	style:height="{size}px"
>
	{#if showImage}
		<img src={url} loading="lazy" alt="" onerror={() => (failedUrl = url)} />
	{:else}
		<div class="addon-logo-letter text-3">{letter}</div>
	{/if}
</div>

<style>
	.addon-logo-container {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		border-radius: 4px;
		overflow: hidden;
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.addon-logo-letter {
		font-weight: 600;
		opacity: 0.6;
	}
</style>
