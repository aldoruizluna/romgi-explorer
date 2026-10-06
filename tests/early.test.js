#!/usr/bin/env node
/*
 * The page starts from the first data file alone, so the engine runs for a while without titles and exact sizes. This checks that
 * stretch and the moment the detail file arrives:
 *   - counts, facets, size classes, collections and cross-tabs by links or entries work, and equal those of a page built from the whole
 *     dataset, under a filter too;
 *   - the measures that need exact sizes (indexed size, average file size) answer with nothing rather than throw, and that empty
 *     answer is not kept;
 *   - once the detail has been attached and the slicer's cache dropped (what App.detailReady() does), those measures, the headline
 *     size total and the sort by size equal the whole-dataset page's.
 *
 *   node tests/early.test.js <catalogue.bin> <detail.bin> <dataset.json.gz>
 */
const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), path = require('path'), assert = require('assert');

const [, , binPath, detailPath, jsonPath] = process.argv;
if (!jsonPath) { console.error('usage: node tests/early.test.js <catalogue.bin> <detail.bin> <dataset.json.gz>'); process.exit(2); }
const jsDir = path.join(__dirname, '..', 'web', 'js');
const code = ['00-util.js', '01-i18n.js', '10-data.js', '20-engine.js', '48-collections.js'].map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
const files = { 'catalogue.bin': fs.readFileSync(binPath), 'detail.bin': fs.readFileSync(detailPath) };
let S = null;
const App = { handlers: {}, D: null, detailState: null, detailProgress() {}, detailReady() { S.cache = {}; } };       // detailReady: what the shell does first
const ctx = vm.createContext({
  window: { ROMGI: { mode: 'snapshot', data: 'catalogue.bin', dataBytes: files['catalogue.bin'].length, detail: 'detail.bin', detailBytes: files['detail.bin'].length } },
  console: { log: console.log, error: console.error, warn() {} },
  performance, setTimeout, MessageChannel, TextDecoder, Intl,
  Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float64Array, Response, TransformStream, DecompressionStream, TextDecoderStream,
  fetch: async url => new Response(files[url], { headers: { 'content-length': String(files[url].length) } }),
  Loader: { progress() {} },
  App,
});
const api = vm.runInContext(code + '\n({ fetchDataset, prepare, Slicer, loadDetail, collectionSteps, COLLECTIONS })', ctx);
const ok = msg => console.log('ok  ', msg);
const same = (a, b, what) => { assert.strictEqual(a.length, b.length, `${what}: length`); for (let i = 0; i < a.length; i++) if (!(a[i] === b[i] || (Number.isNaN(a[i]) && Number.isNaN(b[i])))) assert.fail(`${what}: differs at ${i} (${a[i]} vs ${b[i]})`); };

(async () => {
  const want = JSON.parse(zlib.gunzipSync(fs.readFileSync(jsonPath)).toString('utf8'));
  const full = api.prepare(want), Sf = new api.Slicer(full);
  const early = api.prepare(await api.fetchDataset('catalogue.bin', () => {}));
  S = new api.Slicer(early); App.D = early;
  assert.ok(!early.detailReady && early.L.size === null && early.E.sumSize === null);

  // a few slices, applied identically to both engines
  const slices = [
    { grain: 'entries', set: [] },
    { grain: 'links', set: [['plat', 3]] },
    { grain: 'entries', set: [['src', 1], ['sz', 4]] },
    { grain: 'links', set: [['brand', 0], ['fmt', 2]] },
  ];
  const apply = (sl, x) => { x.state = { grain: sl.grain, q: '', f: {} }; for (const [id, v] of sl.set) x.fs(id).inc.add(v); x.changed(); };
  const dimsOf = ['plat', 'src', 'sz', 'brand', 'fmt', 'reg', 'avail'];

  // ---- before the detail: everything that needs no exact size
  for (const sl of slices) {
    apply(sl, S); apply(sl, Sf);
    const k = S.kpis(), kf = Sf.kpis();
    for (const f of ['entries', 'links', 'titles', 'games', 'addons', 'platforms', 'sources', 'ra', 'ach', 'art', 'ser', 'susp', 'withSize']) assert.strictEqual(k[f], kf[f], `kpis.${f} under ${JSON.stringify(sl)}`);
    assert.strictEqual(k.bytes, 0, 'the size total must stay 0 until the sizes arrive');
    for (const d of dimsOf) for (const m of ['entries', 'links']) same(S.groupBy(d, m), Sf.groupBy(d, m), `groupBy(${d}, ${m}) under ${JSON.stringify(sl)}`);
    same(S.crosstab('plat', 'src', 'links').cells, Sf.crosstab('plat', 'src', 'links').cells, 'crosstab plat x src');
    same(S.crosstab('brand', 'reg', 'entries').cells, Sf.crosstab('brand', 'reg', 'entries').cells, 'crosstab brand x reg');
    for (const m of ['bytes', 'avg']) {
      const x = S.crosstab('plat', 'src', m);
      assert.ok(x.cells.every(v => v === 0), `${m} must be empty before the sizes arrive`);
      assert.ok(!(`x|plat|src|${m}` in S.cache), `the empty ${m} answer was cached`);
    }
  }
  ok(`before the detail: counts, facets, size classes and cross-tabs equal the whole dataset's under ${slices.length} slices; size measures answer with nothing and are not cached`);

  // ---- collections (counted at boot, from the first file alone)
  const countsOf = (x, d) => { App.S = x; App.D = d; const g = api.collectionSteps(); while (!g.next().done); return JSON.stringify(App._colls.map(c => [c.id, c.count.entries, c.count.links])); };
  const cEarly = countsOf(S, early), cFull = countsOf(Sf, full);
  App.S = S; App.D = early;
  assert.strictEqual(cEarly, cFull, 'collection counts differ');
  ok(`collectionSteps() on the first file alone gives the whole dataset's counts (${JSON.parse(cEarly).length} collections)`);

  // ---- the detail arrives
  S.state = { grain: 'links', q: '', f: {} }; S.changed(); Sf.state = { grain: 'links', q: '', f: {} }; Sf.changed();
  const before = S.kpis();               // cached with bytes = 0, like the page would have it
  assert.strictEqual(before.bytes, 0);
  await api.loadDetail();
  assert.ok(early.detailReady && early.L.size && early.E.sumSize);
  assert.notStrictEqual(S.kpis(), before, 'the cache was not dropped when the detail arrived');
  for (const sl of slices) {
    apply(sl, S); apply(sl, Sf);
    const k = S.kpis(), kf = Sf.kpis();
    assert.strictEqual(k.bytes, kf.bytes, `indexed size under ${JSON.stringify(sl)}`);
    assert.ok(sl.set.length || k.bytes > 0, 'the unfiltered size total is 0 after the detail arrived');
    for (const m of ['bytes', 'avg']) {
      same(S.crosstab('plat', 'src', m).cells, Sf.crosstab('plat', 'src', m).cells, `crosstab plat x src (${m}) under ${JSON.stringify(sl)}`);
      same(S.groupBy('brand', m), Sf.groupBy('brand', m), `groupBy brand (${m}) under ${JSON.stringify(sl)}`);
    }
  }
  apply(slices[0], S); apply(slices[0], Sf);
  for (const [grain, key] of [['entries', 'size'], ['links', 'size'], ['entries', 'title']]) {
    same(S.sorted(grain, key, -1).slice(0, 500), Sf.sorted(grain, key, -1).slice(0, 500), `sorted ${grain} by ${key}`);
  }
  ok('after the detail: indexed size, average size, size cross-tabs and the sort by size equal the whole-dataset page\'s under every slice');
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e.stack || e.message); process.exit(1); });
