#!/usr/bin/env node
/*
 * The hosted catalogue comes as two gzip files, one JSON document per line: the numbers the page starts on, and the detail (titles,
 * serials, slugs, torrent file numbers and exact sizes) that follows. This runs the page's own loaders against both and checks that
 *   - nothing is lost or invented: the two files together are exactly the dataset they were made from, and the first holds no detail;
 *   - a page started from the first file alone, then given the second, ends up identical to one built from the whole dataset;
 *   - the columns the builder derives (first letter, title groups, has-a-serial, size class) are what the page would compute
 *     from the titles and sizes;
 *   - a missing or mismatched detail file leaves the page usable and says so.
 *
 *   node tests/transport.test.js <catalogue.bin> <detail.bin> <dataset.json.gz>
 */
const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), path = require('path'), assert = require('assert');

const [, , binPath, detailPath, jsonPath] = process.argv;
if (!jsonPath) { console.error('usage: node tests/transport.test.js <catalogue.bin> <detail.bin> <dataset.json.gz>'); process.exit(2); }
const jsDir = path.join(__dirname, '..', 'web', 'js');
const code = ['00-util.js', '10-data.js'].map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
const files = { 'catalogue.bin': fs.readFileSync(binPath), 'detail.bin': fs.readFileSync(detailPath) };
const asked = [], coreProgress = [];
const App = { D: null, detailState: null, detailTicks: 0, detailDone: 0, detailProgress() { this.detailTicks++; }, detailReady() { this.detailDone++; } };
const ctx = vm.createContext({
  window: { ROMGI: { mode: 'snapshot', data: 'catalogue.bin', dataBytes: files['catalogue.bin'].length, detail: 'detail.bin', detailBytes: files['detail.bin'].length } },
  console: { log: console.log, error: console.error, warn() {} },      // loadDetail() reports a failed file with console.warn on purpose
  performance, setTimeout, MessageChannel, TextDecoder, Intl,
  Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float64Array, Response, TransformStream, DecompressionStream, TextDecoderStream,
  fetch: async url => {
    asked.push(url);
    const b = files[url];
    return b ? new Response(b, { headers: { 'content-length': String(b.length) } }) : new Response('', { status: 404 });
  },
  Loader: { progress: (got, total) => coreProgress.push([got, total]) },
  App,
});
const api = vm.runInContext(code + '\n({ fetchDataset, readNdjson, prepare, prepareSteps, attachDetailSteps, loadDetail })', ctx);
const ok = msg => console.log('ok  ', msg);
const sameArray = (a, b, what) => {
  assert.strictEqual(a.length, b.length, `${what}: length ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(`${what}: differs at ${i} (${a[i]} vs ${b[i]})`);
};

(async () => {
  const want = JSON.parse(zlib.gunzipSync(fs.readFileSync(jsonPath)).toString('utf8'));
  delete want.meta.built_at;      // the page ships this in index.html, so neither data file carries it

  // ---- the two files together are the dataset
  const t0 = performance.now();
  const core = await api.fetchDataset('catalogue.bin', () => {});
  const msCore = Math.round(performance.now() - t0);
  const detail = await api.readNdjson('detail.bin', files['detail.bin'].length, () => {});
  const merged = {};
  for (const src of [core, detail]) for (const [k, v] of Object.entries(src)) {
    if (k === 'entries' || k === 'links') { merged[k] = merged[k] || {}; for (const kk of Object.keys(v)) { assert.ok(!(kk in merged[k]), `${k}.${kk} is in both files`); merged[k][kk] = v[kk]; } }
    else { assert.ok(!(k in merged), `${k} is in both files`); merged[k] = v; }
  }
  assert.deepStrictEqual(Object.keys(merged).sort(), Object.keys(want).sort(), 'top-level sections differ');
  // objects built inside the page's vm context have another Object.prototype, so compare their JSON text instead of the objects
  for (const k of Object.keys(want)) {
    if (k === 'entries' || k === 'links') {
      assert.deepStrictEqual(Object.keys(merged[k]).sort(), Object.keys(want[k]).sort(), `${k}: columns differ`);
      for (const kk of Object.keys(want[k])) assert.ok(JSON.stringify(merged[k][kk]) === JSON.stringify(want[k][kk]), `${k}.${kk} differs`);
    } else assert.ok(JSON.stringify(merged[k]) === JSON.stringify(want[k]), `section ${k} differs`);
  }
  ok(`catalogue + detail = the dataset: ${Object.keys(want).length} sections, ${Object.keys(want.entries).length + Object.keys(want.links).length} columns identical (core read in ${msCore} ms)`);
  for (const c of ['title', 'rom', 'fix', 'slug_x']) assert.ok(!(c in core.entries), `entries.${c} is in the first file`);
  for (const c of ['tidx', 'size']) assert.ok(!(c in core.links), `links.${c} is in the first file`);
  assert.ok('sb' in core.links, 'the size classes are not in the first file');
  for (const k of Object.keys(detail)) assert.ok(k === 'entries' || k === 'links', `the detail file carries section ${k}`);
  assert.deepStrictEqual(Object.keys(detail.entries).sort(), ['fix', 'rom', 'slug_x', 'title'], 'the detail file carries other entry columns');
  assert.deepStrictEqual(Object.keys(detail.links).sort(), ['size', 'tidx'], 'the detail file carries other link columns');
  ok('the first file holds neither titles nor exact sizes (only each link\'s size class); the second holds only those');
  const last = coreProgress[coreProgress.length - 1];
  assert.ok(coreProgress.length > 1 && last[0] === last[1] && last[1] === files['catalogue.bin'].length, 'progress did not reach the first file\'s size');
  ok(`progress: ${coreProgress.length} ticks, ending at the file size`);

  // ---- start from the first file alone, then add the detail
  const D = api.prepare(core);
  assert.strictEqual(D.detailReady, false);
  assert.strictEqual(D.E.title, null); assert.strictEqual(D.E.tl, null); assert.strictEqual(D.L.tidx, null);
  assert.strictEqual(D.L.size, null); assert.strictEqual(D.E.sumSize, null);
  assert.strictEqual(D.titleShown(0), '', 'titleShown must not throw before the detail has arrived');
  assert.strictEqual(D.E.n, want.entries.n);
  ok(`prepare() starts from the first file alone (${D.E.n.toLocaleString()} entries, no titles or exact sizes yet)`);

  App.D = D;
  await api.loadDetail();
  assert.strictEqual(App.detailDone, 1, 'detailReady() was not called once');
  assert.ok(D.detailReady && App.detailState.error === '', 'loadDetail did not finish cleanly');
  assert.ok(App.detailState.got === App.detailState.total && App.detailState.total === files['detail.bin'].length, 'detail progress did not reach the file size');
  assert.deepStrictEqual(asked, ['catalogue.bin', 'detail.bin', 'detail.bin'], 'unexpected requests: ' + asked);       // catalogue, detail (merge check above), detail (loadDetail)

  const F = api.prepare(want);        // the way the local server and the single file start: everything at once
  assert.ok(F.detailReady);
  let cols = 0;
  for (const part of ['E', 'L']) for (const k of Object.keys(F[part])) {
    const f = F[part][k], d = D[part][k];
    if (ArrayBuffer.isView(f)) { assert.ok(ArrayBuffer.isView(d), `${part}.${k} is missing after the detail arrived`); sameArray(d, f, `${part}.${k}`); cols++; }
  }
  sameArray(D.E.tl, F.E.tl, 'E.tl'); sameArray(D.E.title, F.E.title, 'E.title'); sameArray(D.E.rom, F.E.rom, 'E.rom');
  assert.strictEqual(D.nTitles, F.nTitles);
  assert.deepStrictEqual([...D.slugX], [...F.slugX]); assert.deepStrictEqual([...D.fixes], [...F.fixes]);
  for (let i = 0; i < D.E.n; i++) { if (D.slugOf(i) !== F.slugOf(i) || D.titleShown(i) !== F.titleShown(i)) assert.fail(`slug or title differs at ${i}`); }
  for (let i = 0; i < D.E.n; i += 997) assert.deepStrictEqual(D.sameTitle(i), F.sameTitle(i), `sameTitle(${i})`);
  ok(`started from the first file and given the detail, it equals the whole dataset: ${cols} typed columns (exact sizes and entry totals included), titles, search text, slugs`);

  // ---- what the builder derives, recomputed here from the titles and sizes
  const E = want.entries, Lk = want.links;
  const initialOf = t => { const s = t.replace(/^ +/, ''); if (!s) return 0; const c = s.charCodeAt(0); return c >= 65 && c <= 90 ? c - 63 : c >= 97 && c <= 122 ? c - 95 : c >= 48 && c <= 57 ? 1 : 0; };
  const seen = new Map();
  const bad = { initial: 0, tkey: 0, hasser: 0, sb: 0 };
  for (let i = 0; i < E.n; i++) {
    if (initialOf(E.title[i]) !== D.E.initial[i]) bad.initial++;
    const key = E.platform[i] + '\u0000' + E.title[i];
    let g = seen.get(key); if (g === undefined) { g = seen.size; seen.set(key, g); }
    if (g !== D.E.tkey[i]) bad.tkey++;
    if ((E.rom[i] !== '' ? 1 : 0) !== D.E.hasSer[i]) bad.hasser++;
  }
  // the size class: unknown, five classes by size, and "suspect" (a size no real copy could have)
  const KiB = 1024, MiB = 1048576, GiB = 1073741824, EDGES = [512 * KiB, 16 * MiB, 700 * MiB, Math.floor(4.7 * GiB)];
  const sus = want.dims.suspect, susSrc = want.dims.sources.findIndex(s => s.id === sus.source), limit = want.dims.platforms.map(p => p.limit ?? Infinity);
  for (let l = 0; l < Lk.n; l++) {
    const s = Lk.size[l], plat = E.platform[D.L.eo[l]];
    const b = !s ? 0 : (s >= sus.tib || (Lk.src[l] === susSrc && s >= limit[plat])) ? 6 : 1 + EDGES.filter(e => s >= e).length;
    if (b !== D.L.sb[l]) bad.sb++;
  }
  assert.deepStrictEqual(bad, { initial: 0, tkey: 0, hasser: 0, sb: 0 }, 'a derived column disagrees with the titles or sizes');
  assert.strictEqual(seen.size, E.ntitles);
  ok(`first letter, title groups (${seen.size.toLocaleString()}), has-a-serial and size class: the builder's columns equal what the page computes from the titles and sizes`);

  // ---- a detail file that does not come: the page stays usable and says why
  const D2 = api.prepare(core);
  App.D = D2; App.detailDone = 0; App.detailTicks = 0;
  files['detail.bin'] = null;
  await api.loadDetail();
  assert.ok(!D2.detailReady && App.detailDone === 0 && /just updated/.test(App.detailState.error), 'a 404 for the detail file was not reported: ' + App.detailState.error);
  assert.strictEqual(D2.titleShown(5), '');
  ok(`a missing detail file leaves the page without titles and says: "${App.detailState.error}"`);

  // ---- a detail file from another catalogue: refused
  const lines = zlib.gunzipSync(fs.readFileSync(detailPath)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const lastTitle = lines.filter(l => l[0] === 'entries' && l[1] === 'title').pop();
  lastTitle[2].pop();
  files['detail.bin'] = zlib.gzipSync(lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const D3 = api.prepare(core);
  App.D = D3; App.detailDone = 0;
  ctx.window.ROMGI.detailBytes = files['detail.bin'].length;
  await api.loadDetail();
  assert.ok(!D3.detailReady && App.detailDone === 0 && /do not belong/.test(App.detailState.error), 'a detail file of the wrong length was accepted: ' + App.detailState.error);
  assert.strictEqual(D3.E.title, null, 'the mismatched titles were attached');
  assert.strictEqual(D3.L.size, null, 'the mismatched sizes were attached');
  ok(`a detail file that does not fit the catalogue is refused: "${App.detailState.error}"`);
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e.stack || e.message); process.exit(1); });
