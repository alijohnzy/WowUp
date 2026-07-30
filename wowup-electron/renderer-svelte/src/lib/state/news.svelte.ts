// Port of src/app/services/news/news.service.ts (99 LOC).
//
// The feed parser is DOMParser + getElementsByTagName — no Angular in it. What went away
// is the @Injectable, the BehaviorSubject, and the class-per-feed indirection that existed
// so the NetworkService could be injected into it.

import { AppConfig } from '$config/environment';
import { getText as httpGetText } from '$lib/services/network';

export interface NewsItem {
	id: string;
	title: string;
	link: string;
	description: string;
	publishedAt: Date;
	publishedBy: string;
	thumbnail: string;
}

const text = (item: Element, name: string): string =>
	item.getElementsByTagName(name)[0]?.textContent ?? '';

const url = (item: Element, name: string): string =>
	item.getElementsByTagName(name)[0]?.getAttribute('url') ?? '';

function toNewsItem(item: Element): NewsItem {
	return {
		id: text(item, 'dc:identifier'),
		title: text(item, 'title'),
		description: text(item, 'description'),
		link: text(item, 'link'),
		publishedAt: new Date(text(item, 'pubDate')),
		publishedBy: text(item, 'dc:creator'),
		thumbnail: url(item, 'media:content')
	};
}

async function processWowTavernFeed(): Promise<NewsItem[]> {
	const xmlStr = await httpGetText(AppConfig.warcraftTavernNewsFeedUrl);
	const dom = new DOMParser().parseFromString(xmlStr, 'application/xml');

	const newsItems: NewsItem[] = [];
	for (const channel of Array.from(dom.getElementsByTagName('channel'))) {
		for (const item of Array.from(channel.getElementsByTagName('item'))) {
			newsItems.push(toNewsItem(item));
		}
	}
	return newsItems;
}

const FEEDS: Array<() => Promise<NewsItem[]>> = [processWowTavernFeed];

class News {
	items = $state<NewsItem[]>([]);
	lastFetchedAt = $state(0);

	async loadFeeds(): Promise<NewsItem[]> {
		let newsItems: NewsItem[] = [];
		for (const feed of FEEDS) {
			try {
				newsItems = newsItems.concat(await feed());
			} catch (e) {
				console.error(e);
			}
		}

		this.lastFetchedAt = Date.now();
		this.items = newsItems;
		return newsItems;
	}
}

export const news = new News();
