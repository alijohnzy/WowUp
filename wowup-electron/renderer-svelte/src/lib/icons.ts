// Replaces src/app/services/icons/icon.service.ts (111 LOC).
//
// The Angular service injected MatIconRegistry + DomSanitizer and registered every icon by
// name at startup so templates could say svgIcon="fas:gear". This is the same mapping as a
// plain object; <Icon> renders the definition directly.
//
// Named imports keep the packs tree-shakeable — the measured Angular bundle shipped only
// the ~40 icons actually referenced, and so does this.

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
	faAngleDown,
	faAngleUp,
	faArrowDown,
	faArrowUp,
	faCaretDown,
	faCheck,
	faChevronLeft,
	faChevronRight,
	faCircleCheck,
	faCircleUser,
	faClockRotateLeft,
	faCodeBranch,
	faCoins,
	faDiceD6,
	faEllipsisVertical,
	faGear,
	faLink,
	faMagnifyingGlass,
	faMinimize,
	faNewspaper,
	faPlay,
	faRotate,
	faTrash,
	faTriangleExclamation,
	faUpRightFromSquare,
	faXmark
} from '@fortawesome/free-solid-svg-icons';
import {
	faCircleCheck as farCircleCheck,
	faCircleQuestion,
	faClock,
	faSquareCaretLeft,
	faSquareCaretRight
} from '@fortawesome/free-regular-svg-icons';
import { faDiscord, faGithub, faPatreon } from '@fortawesome/free-brands-svg-icons';

/** Keyed by the same "prefix:name" strings the Angular templates used. */
export const ICONS = {
	'fas:angle-down': faAngleDown,
	'fas:angle-up': faAngleUp,
	'fas:arrow-down': faArrowDown,
	'fas:arrow-up': faArrowUp,
	'fas:caret-down': faCaretDown,
	// chevron-left is new: ng-gallery drew its own lightbox arrows, so no Angular template
	// ever named one. See ImageGallery.svelte.
	'fas:chevron-left': faChevronLeft,
	'fas:chevron-right': faChevronRight,
	'fas:check': faCheck,
	'fas:circle-check': faCircleCheck,
	'fas:circle-user': faCircleUser,
	// The Angular templates used both spellings for the same icon.
	'fas:user-circle': faCircleUser,
	'fas:clock-rotate-left': faClockRotateLeft,
	'fas:code-branch': faCodeBranch,
	'fas:coins': faCoins,
	'fas:ellipsis-vertical': faEllipsisVertical,
	'fas:link': faLink,
	'fas:minimize': faMinimize,
	'fas:play': faPlay,
	'fas:rotate': faRotate,
	'fas:trash': faTrash,
	'fas:triangle-exclamation': faTriangleExclamation,
	'fas:up-right-from-square': faUpRightFromSquare,
	'fas:xmark': faXmark,
	'fas:gear': faGear,
	'fas:dice-d6': faDiceD6,
	'fas:magnifying-glass': faMagnifyingGlass,
	'fas:newspaper': faNewspaper,

	'far:circle-check': farCircleCheck,
	'far:circle-question': faCircleQuestion,
	'far:clock': faClock,
	'far:square-caret-left': faSquareCaretLeft,
	'far:square-caret-right': faSquareCaretRight,

	'fab:discord': faDiscord,
	'fab:github': faGithub,
	'fab:patreon': faPatreon
} satisfies Record<string, IconDefinition>;

export type IconName = keyof typeof ICONS;
