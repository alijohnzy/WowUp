// Run with `npm run test:scripts`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changelogHtmlToMarkdown, entryFor, whatsNew, type ChangelogEntry } from "./release-notes.mts";

// As the app's changelog writes them, indentation and all.
const html = (body: string) => `\n    ${body}\n    `;

const LOG: ChangelogEntry[] = [
  {
    Version: "2.25.4 #next",
    Night: true,
    html: html("<h4>Features</h4>\n    <ul>\n    <li>Coming next</li>\n    </ul>"),
  },
  {
    Version: "2.25.4 #43",
    Night: true,
    html: html(
      "<h4>Fixes</h4>\n    <ul>\n    <li>Windows: no longer freezes</li>\n    <li>Settings &gt; Privacy &amp; Security</li>\n    </ul>",
    ),
  },
  { Version: "2.25.4 #42", Night: true, html: html("<h4>Changes</h4>\n    <ul>\n    </ul>") },
  // Upstream WowUp's own entries share the file.
  { Version: "2.25.4", html: html("<h4>Upstream</h4><ul><li>not ours</li></ul>") },
];

describe("entryFor", () => {
  it("finds a build by its number", () => {
    assert.equal(entryFor(LOG, 43)?.Version, "2.25.4 #43");
  });

  it("takes #next as the build only when told it is the one being released", () => {
    assert.equal(entryFor(LOG, 44), undefined);
    assert.equal(entryFor(LOG, 44, true)?.Version, "2.25.4 #next");
    // A numbered entry always wins.
    assert.equal(entryFor(LOG, 43, true)?.Version, "2.25.4 #43");
  });

  it("ignores upstream entries", () => {
    assert.equal(entryFor([LOG[3]], 0, true), undefined);
  });
});

describe("changelogHtmlToMarkdown", () => {
  it("turns headings and items into Markdown, decoding entities", () => {
    assert.equal(
      changelogHtmlToMarkdown(LOG[1].html),
      "### Fixes\n- Windows: no longer freezes\n- Settings > Privacy & Security",
    );
  });

  it("separates sections with a blank line and flattens line breaks inside an item", () => {
    const out = changelogHtmlToMarkdown(
      "<h4>Features</h4><ul><li>One\n  line</li></ul><h4>Fixes</h4><ul><li>Two</li></ul>",
    );
    assert.equal(out, "### Features\n- One line\n\n### Fixes\n- Two");
  });
});

describe("whatsNew", () => {
  it("heads the section with the build number", () => {
    assert.equal(whatsNew(LOG, 44, true), "## What's new in build 44\n\n### Features\n- Coming next\n");
  });

  it("is empty for a build with no entry, so the release just leaves the section out", () => {
    assert.equal(whatsNew(LOG, 41), "");
  });
});
