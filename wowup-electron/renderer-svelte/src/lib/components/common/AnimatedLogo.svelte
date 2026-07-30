<script lang="ts">
	// Port of components/common/animated-logo (34 LOC).
	// [ngClass]="[electronService.platform]" -> a class: directive per platform.

	import { platform } from '$lib/ipc';
</script>

<div class="pre-load-container {platform()}">
	<img class="logo" src="./assets/wowup_logo_purple.png" alt="" />
</div>

<style>
	.pre-load-container {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
	}

	.logo {
		width: 96px;
		height: 96px;
		animation: pulse 1.6s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.65;
			transform: scale(0.94);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.logo {
			animation: none;
		}
	}
</style>
