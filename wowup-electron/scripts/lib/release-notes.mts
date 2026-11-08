// "What's new" for a WowUpNight GitHub release: the build's entry in the in-app changelog
// (renderer-svelte/src/lib/data/changelogs.json), turned from the app's HTML into Markdown, so
// the release page says what the build changed instead of only listing its files.

export interface ChangelogEntry {
  Version: string;
  Night?: boolean;
  html: string;
}

/**
 * The changelog entry for `build`. An entry is written as "#next" until a release is
 * published (CI stamps the number into its own copy while building), so with `nextIsBuild`
 * — true when `build` is the one being released now — a "#next" entry counts as this build's.
 */
export function entryFor(log: ChangelogEntry[], build: number, nextIsBuild = false): ChangelogEntry | undefined {
  const night = log.filter((e) => e.Night);
  return (
    night.find((e) => e.Version.endsWith(` #${build}`)) ??
    (nextIsBuild ? night.find((e) => e.Version.endsWith(" #next")) : undefined)
  );
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e]);

/** The changelog's HTML — `<h4>` headings over `<ul>` lists — as Markdown. */
export function changelogHtmlToMarkdown(html: string): string {
  const lines: string[] = [];
  const blocks = html.match(/<h4>[\s\S]*?<\/h4>|<li>[\s\S]*?<\/li>/g) ?? [];
  for (const block of blocks) {
    const text = decode(
      block
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (!text) continue;
    if (block.startsWith("<h4>")) {
      if (lines.length > 0) lines.push("");
      lines.push(`### ${text}`);
    } else {
      lines.push(`- ${text}`);
    }
  }
  return lines.join("\n");
}

/** The release's "What's new" section, or "" when the build has no changelog entry. */
export function whatsNew(log: ChangelogEntry[], build: number, nextIsBuild = false): string {
  const entry = entryFor(log, build, nextIsBuild);
  const body = entry ? changelogHtmlToMarkdown(entry.html) : "";
  return body ? `## What's new in build ${build}\n\n${body}\n` : "";
}
