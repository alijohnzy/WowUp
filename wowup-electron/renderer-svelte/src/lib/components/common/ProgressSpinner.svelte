<script lang="ts">
	// Port of components/progress-spinner (37 LOC).
	//
	// The Angular version resolved its default message in ngOnInit via a translate
	// subscription, so the label was briefly empty on first paint. t() is synchronous once
	// the locale is loaded, so the default can just be the fallback in the expression.

	import { t } from '$lib/i18n.svelte';

	interface Props {
		message?: string;
	}

	let { message = '' }: Props = $props();
</script>

<div class="busy-container text-1">
	<div class="spinner" role="status" aria-live="polite"></div>
	<pre>{message || t('COMMON.PROGRESS_SPINNER.LOADING')}</pre>
</div>

<style>
	.busy-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		height: 100%;
	}

	.spinner {
		width: 50px;
		height: 50px;
		border: 4px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}

	pre {
		margin: 0;
		font-family: inherit;
		white-space: pre-wrap;
		text-align: center;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2.5s;
		}
	}
</style>
