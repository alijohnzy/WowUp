<script lang="ts">
	// Port of components/common/progress-bar (25 LOC).
	// @Input() value -> $props(); [style.width] -> a style attribute.

	interface Props {
		value?: number;
	}

	let { value = 0 }: Props = $props();

	// Guard the bound value so a bad progress report cannot overflow the track.
	let clamped = $derived(Math.min(100, Math.max(0, value)));
</script>

<div
	class="progress-background"
	role="progressbar"
	aria-valuenow={clamped}
	aria-valuemin={0}
	aria-valuemax={100}
>
	<div class="progress-value" style:width="{clamped}%"></div>
</div>

<style>
	.progress-background {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		overflow: hidden;
	}

	.progress-value {
		height: 100%;
		background: var(--overlay-strong);
		transition: width 120ms linear;
	}

	@media (prefers-reduced-motion: reduce) {
		.progress-value {
			transition: none;
		}
	}
</style>
