<script lang="ts">
	// Port of components/common/progress-button (36 LOC).
	//
	// @Output() btnClick: EventEmitter -> an `onclick` callback prop.
	// <ng-content> -> the `children` snippet.

	import type { Snippet } from 'svelte';
	import ProgressBar from './ProgressBar.svelte';

	interface Props {
		value?: number;
		showProgress?: boolean;
		disable?: boolean;
		onclick?: (evt: MouseEvent) => void;
		children?: Snippet;
	}

	let { value = 0, showProgress = false, disable = false, onclick, children }: Props = $props();

	function handleClick(evt: MouseEvent) {
		evt.preventDefault();
		evt.stopPropagation();
		onclick?.(evt);
	}
</script>

<button
	class="wu-btn wu-btn-primary progress-button"
	class:show-progress={showProgress}
	onclick={handleClick}
	disabled={disable}
>
	{#if showProgress}
		<ProgressBar {value} />
	{/if}
	<span class="label">{@render children?.()}</span>
</button>

<style>
	.progress-button {
		position: relative;
		overflow: hidden;
	}

	.label {
		position: relative;
	}
</style>
