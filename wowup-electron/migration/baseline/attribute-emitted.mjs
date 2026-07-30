// Attribute shipped bytes to packages by EMITTED span length, decoded from the
// sourcemap `mappings` VLQ — not by original sourcesContent length.
//
// Why: the skill's attribute.mjs weights each source by its original file size, so a
// package that tree-shakes to near-nothing still claims a large share of the chunk
// (measured here: @fortawesome attributed 547 KB, actually ships 20.2 KB). Shares are
// normalized, so that error is subtracted from every other package.
//
// This walks the mappings and charges each generated span to the source it came from.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CHAR = new Map([...B64].map((c, i) => [c, i]));

function decodeVLQ(str, i) {
  let result = 0, shift = 0, cont, digit;
  do {
    digit = CHAR.get(str[i++]);
    if (digit === undefined) throw new Error('bad VLQ char');
    cont = digit & 32;
    result += (digit & 31) << shift;
    shift += 5;
  } while (cont);
  const negate = result & 1;
  result >>= 1;
  return [negate ? (result === 0 ? -0x80000000 : -result) : result, i];
}

function attributeByEmitted(mapPath, chunkBytes) {
  const sm = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const lines = sm.mappings.split(';');
  const perSource = new Float64Array(sm.sources.length);
  let srcIdx = 0;
  let unmapped = 0;

  for (const line of lines) {
    if (!line) continue;
    const segs = line.split(',');
    // Decode this line's segments into (genCol, sourceIndex)
    const decoded = [];
    let genCol = 0;
    for (const seg of segs) {
      if (!seg) continue;
      let i = 0, v;
      [v, i] = decodeVLQ(seg, i); genCol += v;
      let src = null;
      if (i < seg.length) {
        [v, i] = decodeVLQ(seg, i); srcIdx += v; src = srcIdx;
        // skip origLine, origCol, nameIdx — not needed
      }
      decoded.push([genCol, src]);
    }
    // Charge each span [col_i, col_{i+1}) to its source
    for (let k = 0; k < decoded.length; k++) {
      const [col, src] = decoded[k];
      const next = k + 1 < decoded.length ? decoded[k + 1][0] : col;
      const span = Math.max(0, next - col);
      if (src === null) unmapped += span;
      else perSource[src] += span;
    }
  }

  const mappedTotal = perSource.reduce((a, b) => a + b, 0) + unmapped;
  const scale = mappedTotal > 0 ? chunkBytes / mappedTotal : 0;

  const byPkg = new Map();
  const add = (name, bytes) => byPkg.set(name, (byPkg.get(name) || 0) + bytes);
  sm.sources.forEach((s, i) => {
    if (!perSource[i]) return;
    const m = s.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    add(m ? m[1] : '(app code)', perSource[i] * scale);
  });
  if (unmapped) add('(unmapped/runtime)', unmapped * scale);
  return byPkg;
}

const dist = process.argv[2] || 'dist';

// Recursive: Angular emits flat into dist/, SvelteKit nests under _app/immutable/.
function walkDir(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walkDir(p) : [p];
  });
}
const chunks = walkDir(dist)
  .filter((f) => f.endsWith('.js') && fs.existsSync(f + '.map'))
  .map((f) => path.relative(dist, f));

const total = new Map();
let grandRaw = 0;
for (const c of chunks) {
  const bytes = fs.statSync(path.join(dist, c)).size;
  grandRaw += bytes;
  for (const [k, v] of attributeByEmitted(path.join(dist, c + '.map'), bytes)) {
    total.set(k, (total.get(k) || 0) + v);
  }
}

// gzip ratio of the whole JS payload, used only to give a rough compressed view
const allJs = Buffer.concat(chunks.map((c) => fs.readFileSync(path.join(dist, c))));
const gzRatio = zlib.gzipSync(allJs, { level: 9 }).length / allJs.length;

const rows = [...total.entries()].sort((a, b) => b[1] - a[1]);
console.log(`EMITTED-BYTE ATTRIBUTION  (${chunks.length} chunks, ${(grandRaw / 1024).toFixed(1)} KB raw JS)`);
console.log(`${'package'.padEnd(44)}${'raw KB'.padStart(9)}${'~gzip KB'.padStart(10)}${'% raw'.padStart(8)}`);
for (const [name, raw] of rows) {
  if (raw < 1024) continue;
  console.log(
    name.padEnd(44) +
      (raw / 1024).toFixed(1).padStart(9) +
      ((raw * gzRatio) / 1024).toFixed(1).padStart(10) +
      ((raw / grandRaw) * 100).toFixed(1).padStart(8)
  );
}
console.log(`\nNote: raw figures are exact emitted spans. ~gzip applies the whole-payload gzip ratio`);
console.log(`(${(gzRatio * 100).toFixed(1)}%) uniformly and is therefore approximate per package.`);
