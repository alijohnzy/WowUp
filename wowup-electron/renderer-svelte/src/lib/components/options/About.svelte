<script lang="ts">
	// Port of src/app/components/options/about/about.component.{ts,html}
	//
	// Angular: 73 LOC .ts + 51 .html + 92 .scss = 216
	// Removed on the way over:
	//   - rxjs `from()` + Subscription + ngOnDestroy   -> await in $effect / plain state
	//   - DomSanitizer + trustHtml pipe                -> {@html}
	//   - ChangeDetectionStrategy.OnPush               -> n/a, no change detection
	//   - AfterViewChecked + @ViewChild                -> n/a (the hook body was empty)
	//   - *ngFor / *ngIf                               -> {#each} / {#if}
	//   - | translate / | async                        -> t() / plain reads

	import { t } from '$lib/i18n.svelte';
	import { session } from '$lib/state/session.svelte';
	import { externalLink } from '$lib/attachments/external-link';
	import { changeLogs } from '$lib/data/changelogs';

	$effect(() => {
		if (session.appVersion === undefined) {
			session.loadAppVersion().catch((e: unknown) => console.error('app version failed', e));
		}
	});
</script>

<div class="about-container">
	<div class="about">
		<div class="header text-1">
			<img class="logo" loading="lazy" src="./assets/wowup_logo_purple.png" alt="" />
			<h2>{t('PAGES.ABOUT.TITLE')}</h2>
			<div class="version text-2">v{session.appVersion ?? ''}</div>
			<div class="link-container">
				<a class="wu-btn wu-btn-flat" href="https://wowup.io" {@attach externalLink()}>
					{t('PAGES.ABOUT.WEBSITE_LINK_LABEL')}
				</a>
				<a
					class="wu-btn wu-btn-flat"
					href="https://github.com/WowUp/WowUp"
					{@attach externalLink()}
				>
					{t('PAGES.MY_ADDONS.PAGE_CONTEXT_FOOTER.VIEW_GITHUB')}
				</a>
			</div>
		</div>

		<div class="changelog-container header-2 text-1">
			<h2>{t('PAGES.ABOUT.ATTRIBUTIONS_TITLE')}</h2>
			<ul class="change-log-list">
				<li class="changelog bg-secondary-4 border-primary">
					<p>
						<a href="https://vectorified.com/wow-alliance-icon" {@attach externalLink()}>
							Wow Alliance Icon
						</a>
					</p>
					<p>
						<a href="https://vectorified.com/horde-logo-vector" {@attach externalLink()}>
							Horde Logo Vector
						</a>
					</p>
					<p>
						<a href="https://blizzard.gamespress.com/world-of-warcraft" {@attach externalLink()}>
							Other WoW Art
						</a>
					</p>
				</li>
			</ul>
		</div>

		<div class="changelog-container text-1">
			<h2>{t('PAGES.ABOUT.CHANGE_LOG_SECTION_LABEL')}</h2>
			<ul class="change-log-list">
				{#each changeLogs as cl (cl.Version)}
					<li class="changelog bg-secondary-4 border-primary">
						<div class="version selectable">{cl.Version}</div>
						{#if cl.Description}
							<pre class="description selectable">{cl.Description}</pre>
						{/if}
						{#if cl.changes}
							<pre class="description selectable">{cl.changes.join('\n')}</pre>
						{/if}
						{#if cl.html}
							<!-- Was `[innerHTML]="cl.html | trustHtml"` with DomSanitizer.bypassSecurityTrustHtml.
							     Same trust boundary: this content is compiled into the app, not user input. -->
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							<div class="selectable">{@html cl.html}</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	</div>
</div>

<style>
	.about-container {
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		height: 100%;
		padding: 1rem;
	}

	.header {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.logo {
		width: 96px;
		height: 96px;
		margin-top: 1rem;
	}

	.version {
		margin-bottom: 0.5rem;
	}

	.link-container {
		display: flex;
		gap: 0.5rem;
	}

	.change-log-list {
		list-style: none;
		padding: 0;
	}

	.changelog {
		padding: 0.75rem 1rem;
		margin-bottom: 0.75rem;
		border-radius: 4px;
		border-left: 3px solid var(--control-color);
	}

	.changelog .version {
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.description {
		white-space: pre-wrap;
		font-family: inherit;
		margin: 0;
	}

	.selectable {
		user-select: text;
	}
</style>
