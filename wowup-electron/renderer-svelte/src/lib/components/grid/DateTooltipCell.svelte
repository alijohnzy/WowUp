<script lang="ts">
	// Port of components/addons/date-tooltip-cell (54 LOC).
	//
	// The relative label ("2 days ago") is re-rendered every 30s so it stays accurate while
	// the window is open. Angular expressed that as
	//   combineLatest([windowFocused$, timer(0, 30000)]).pipe(takeUntil(destroy$))
	// with an early-return when the window was unfocused. Here it is a setInterval in an
	// $effect with the same guard — the point of the guard is to avoid re-rendering every
	// visible row while the app is in the background.

	import type { ICellRendererParams } from 'ag-grid-community';
	import { i18n } from '$lib/i18n.svelte';
	import { localeDate } from '$lib/utils/format';
	import { getRelativeDateFormat } from '$lib/utils/string';
	import { electron } from '$lib/state/electron.svelte';

	interface Props {
		params: ICellRendererParams;
	}

	let { params }: Props = $props();

	let relativeTime = $state('');
	let value = $derived(params.value as string);

	function update() {
		const [fmt, args] = getRelativeDateFormat(value);
		relativeTime = fmt ? i18n.t(fmt, args) : 'ERR';
	}

	$effect(() => {
		void value;
		update();

		const timer = setInterval(() => {
			// Skip background refreshes once we already have a label.
			if (!electron.windowFocused && relativeTime.length > 0) return;
			update();
		}, 30_000);

		return () => clearInterval(timer);
	});
</script>

<span title={value ? localeDate(value) : ''}>{relativeTime}</span>
