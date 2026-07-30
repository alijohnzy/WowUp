<script lang="ts">
	// Replaces <mat-icon svgIcon="fas:name"> plus src/app/services/icons/icon.service.ts
	// (111 LOC), which existed only to register FontAwesome definitions into
	// MatIconRegistry via DomSanitizer.
	//
	// Here the icon definition is rendered directly as inline SVG, so there is no registry,
	// no sanitizer, and no service.

	import { ICONS, type IconName } from '$lib/icons';

	interface Props {
		/** Same "prefix:name" key the Angular templates used, e.g. "fas:gear". */
		name: IconName;
		size?: string;
		/** Decorative by default; pass a label when the icon is the only content. */
		label?: string;
		class?: string;
	}

	let { name, size = '1em', label, class: klass = '' }: Props = $props();

	let icon = $derived(ICONS[name]);
	// FontAwesome packs an icon as [width, height, ligatures, unicode, pathData].
	let viewBox = $derived(icon ? `0 0 ${icon.icon[0]} ${icon.icon[1]}` : '0 0 512 512');
	let path = $derived(icon ? icon.icon[4] : '');
</script>

{#if icon}
	<svg
		class="wu-icon {klass}"
		{viewBox}
		width={size}
		height={size}
		role={label ? 'img' : 'presentation'}
		aria-label={label}
		aria-hidden={label ? undefined : 'true'}
		focusable="false"
		fill="currentColor"
	>
		<path d={Array.isArray(path) ? path[0] : path} />
	</svg>
{/if}

<style>
	.wu-icon {
		display: inline-block;
		vertical-align: -0.125em;
		flex: none;
	}
</style>
