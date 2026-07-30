<script lang="ts">
	// The index has no screen of its own — it forwards to My Addons, which is where the Angular
	// shell opened (TAB_INDEX_MY_ADDONS is 0, session.selectedHomeTab's initial value).
	//
	// This replaces the {#if} chain over session.selectedHomeTab that stood in for routing:
	// five components imported eagerly into one file, so ag-grid's 958 KB loaded even to reach
	// Options. Each screen is now its own route and its own chunk.
	//
	// `replaceState` so the redirect leaves no history entry — going back from My Addons would
	// otherwise land here and bounce forward again.
	import { goto } from '$app/navigation';
	import { href, ROUTES } from '$lib/routes';

	$effect(() => {
		void goto(href(ROUTES.myAddons), { replaceState: true });
	});
</script>
