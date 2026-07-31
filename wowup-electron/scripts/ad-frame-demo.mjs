// Standalone harness for the Wago ad frame.
//
// Rebuilding the app to look at a 300x250 box costs about three minutes, which is far too
// slow to iterate on layout. This serves the same document the Tauri scheme handler serves
// (src-tauri/src/ad.rs) and frames it exactly as the nav rail does, so the frame can be
// looked at, measured and adjusted in seconds.
//
//   node scripts/ad-frame-demo.mjs            # serve, print the URL, stay up
//   node scripts/ad-frame-demo.mjs --shot     # also render it and report what the slot did
//   node scripts/ad-frame-demo.mjs --shot --webkit
//
// --shot renders in Chromium by default. WebKit would be the faithful choice, being the
// engine family WebKitGTK belongs to, but its Playwright build wants libflite/libicu which
// this host has not got; --webkit insists on it where those are available.
//
// Keep `rewrite()` below in step with the Rust one. If they drift, the harness stops being
// evidence about the app and becomes evidence about itself.

import { createServer } from "node:http";
import { argv } from "node:process";

const PORT = Number(process.env.AD_DEMO_PORT ?? 8788);
const AD_URL = "https://addons.wago.io/wowup_ad";
const AD_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Safari/537.36";

// The ad unit the page declares (.container in its own stylesheet).
const AD_WIDTH = 300;
const AD_HEIGHT = 250;

/** Mirrors SHIM in src-tauri/src/ad.rs, minus the reload timer the harness does not need. */
const SHIM = `<script>
(function () {
  Object.defineProperty(window, 'wago', {
    value: Object.freeze({
      provideApiKey: function (key) {
        parent.postMessage({ wowup: 'wago-token', token: key }, '*');
      }
    }),
    writable: false,
    configurable: false
  });
})();
</script>`;

/** Mirrors rewrite() in src-tauri/src/ad.rs. */
function rewrite(html, base) {
  const injected = `<base href="${base}">${SHIM}`;
  const at = html.toLowerCase().indexOf("<head>");
  return at === -1
    ? injected + html
    : html.slice(0, at + "<head>".length) + injected + html.slice(at + "<head>".length);
}

async function fetchAd() {
  const res = await fetch(AD_URL, {
    headers: { "User-Agent": AD_USER_AGENT, Referer: "https://wago.io" },
  });
  if (!res.ok) throw new Error(`${AD_URL}: HTTP ${res.status}`);
  return rewrite(await res.text(), AD_URL);
}

// The nav rail's .ad slot, reproduced: same size, same background, same absolutely
// positioned frame. The checkerboard is the harness's own — it makes it obvious where the
// slot ends and whether the frame is filling it or floating inside it.
const DEMO = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>WowUp ad frame</title>
<style>
  body { margin: 0; background: #2f3136; color: #ddd; font: 13px system-ui, sans-serif; }
  .rail { width: 300px; background: #202225; padding: 12px 0; }
  .label { padding: 8px 12px; opacity: .8; }
  .ad {
    position: relative;
    width: ${AD_WIDTH}px;
    height: ${AD_HEIGHT}px;
    flex-shrink: 0;
    background-color: #2b2c2e;
    background-image:
      linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%),
      linear-gradient(45deg, #333 25%, transparent 25%, transparent 75%, #333 75%);
    background-size: 20px 20px;
    background-position: 0 0, 10px 10px;
  }
  .ad iframe { position: absolute; inset: 0; display: block; width: 100%; height: 100%; border: 0; }
  #out { padding: 12px; white-space: pre-wrap; font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <div class="rail">
    <div class="label">This ad supports addon creators &hearts;</div>
    <div class="ad"><iframe src="/ad" scrolling="no" title="ad"></iframe></div>
  </div>
  <div id="out">measuring…</div>
<script>
  window.addEventListener('message', (e) => {
    if (e.data && e.data.wowup === 'wago-token') console.log('token received');
  });
  // Reported back to the runner, which cannot see into a cross-origin frame either.
  setTimeout(() => {
    const f = document.querySelector('iframe');
    const r = f.getBoundingClientRect();
    window.__adReport = { frame: [Math.round(r.width), Math.round(r.height)] };
    document.getElementById('out').textContent = JSON.stringify(window.__adReport);
  }, 9000);
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/ad")) {
      const body = await fetchAd();
      // No CSP, matching the Rust handler: the ad Wago serves here is a video one, so
      // blocking media blocks the ad. The AppImage bundles GStreamer instead
      // (bundleMediaFramework), which is what makes that safe.
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(DEMO);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(String(e));
  }
});

// A leftover run holding the port is the normal way this fails, and an unhandled
// EADDRINUSE stack is a poor way to say so. Walk up a few ports instead.
const port = await new Promise((resolve, reject) => {
  let candidate = PORT;
  const attempt = () => {
    server.once("error", (e) => {
      if (e.code !== "EADDRINUSE" || candidate > PORT + 10) return reject(e);
      console.log(`port ${candidate} busy, trying ${candidate + 1}`);
      candidate += 1;
      attempt();
    });
    server.listen(candidate, () => resolve(candidate));
  };
  attempt();
});

const url = `http://localhost:${port}/`;
console.log(`ad frame demo: ${url}`);

if (!argv.includes("--shot")) {
  console.log("open that in a browser; ctrl-c to stop");
} else {
  // playwright lives in the renderer workspace, not the root. require() it from there
  // rather than relying on hoisting; a dynamic import of the resolved CJS path would put the
  // exports behind .default.
  const { createRequire } = await import("node:module");
  const pw = createRequire(new URL("../renderer-svelte/package.json", import.meta.url))("playwright");

  // WebKit is the faithful choice — it is the engine family WebKitGTK belongs to — but its
  // Playwright build wants libflite/libicu, which this host has not got. Chromium is close
  // enough for the layout questions this harness answers; pass --webkit to insist on WebKit.
  const engine = argv.includes("--webkit") ? pw.webkit : pw.chromium;

  const browser = await engine.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 420 } });

  const frameErrors = [];
  page.on("console", (m) => m.type() === "error" && frameErrors.push(m.text().slice(0, 120)));

  await page.goto(url, { waitUntil: "load" });
  // The auction runs after first paint; measuring earlier reports an empty slot whatever
  // the outcome would have been.
  await page.waitForTimeout(11000);

  // What the slot looks like is the whole question, so crop to exactly the slot.
  const slot = page.locator(".ad");
  await slot.screenshot({ path: "ad-frame-demo.png" });

  // Read the ad document from inside the frame — same-origin here, unlike in the app.
  const inside = await page.frames()[1]?.evaluate(() => {
    const c = document.querySelector(".container");
    const w = document.querySelector(".container-wrapper");
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    };
    return {
      viewport: [window.innerWidth, window.innerHeight],
      wrapper: box(w),
      container: box(c),
      containerDisplay: c ? getComputedStyle(c).display : null,
      // A collapsed GPT div is what a no-fill looks like from in here.
      gpt: [...document.querySelectorAll('[id^="google_ads_iframe"]')].map((el) => ({
        id: el.id.slice(-40),
        box: box(el),
      })),
      creatives: [...document.querySelectorAll("iframe")]
        .map((f) => ({ src: (f.src || "").slice(0, 50), box: box(f) }))
        .filter((f) => f.box && f.box[3] > 0),
    };
  });

  console.log("\nframe   :", JSON.stringify(await page.evaluate(() => window.__adReport)));
  console.log("inside  :", JSON.stringify(inside, null, 1));
  if (frameErrors.length) console.log("errors  :", frameErrors.slice(0, 5));
  console.log("\nwrote ad-frame-demo.png");

  await browser.close();
  server.close();
}
