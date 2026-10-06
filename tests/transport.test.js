#!/usr/bin/env node
/*
 * The hosted catalogue comes as two gzip files, one JSON document per line: the numbers the page starts on, and the text (titles,
 * serials, slugs, torrent file numbers) that follows. This runs the page's own loaders against both and checks that
 *   - nothing is lost or invented: the two files together are exactly the dataset they were made from, and the first holds no text;
 *   - a page started from the first file alone, then given the second, ends up identical to one built from the whole dataset;
 *   - the columns the builder derives (first letter, title groups, has-a-serial) are what the page would compute from the titles;
 *   - a missing or mismatched text file leaves the page usable and says so.
 *
 *   node tests/transport.test.js <catalogue.bin> <text.bin> <dataset.json.gz>
 */
const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), path = require('path'), assert = require('assert');

const [, , binPath, textPath, jsonPath] = process.argv;
if (!jsonPath) { console.error('usage: node tests/transport.test.js <catalogue.bin> <text.bin> <dataset.json.gz>'); process.exit(2); }
const jsDir = path.join(__dirname, '..', 'web', 'js');
const code = ['00-util.js', '10-data.js'].map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
const files = { 'catalogue.bin': fs.readFileSync(binPath), 'text.bin': fs.readFileSync(textPath) };
const asked = [], coreProgress = [];
const App = { D: null, textState: null, textTicks: 0, textDone: 0, textProgress() { this.textTicks++; }, textReady() { this.textDone++; } };
const ctx = vm.createContext({
  window: { ROMGI: { mode: 'snapshot', data: 'catalogue.bin', dataBytes: files['catalogue.bin'].length, text: 'text.bin', textBytes: files['text.bin'].length } },
  console: { log: console.log, error: console.error, warn() {} },      // loadText() reports a failed text file with console.warn on purpose
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
const api = vm.runInContext(code + '\n({ fetchDataset, readNdjson, prepare, prepareSteps, attachTextSteps, loadText })', ctx);
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
  const text = await api.readNdjson('text.bin', files['text.bin'].length, () => {});
  const merged = {};
  for (const src of [core, text]) for (const [k, v] of Object.entries(src)) {
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
  ok(`catalogue + text = the dataset: ${Object.keys(want).length} sections, ${Object.keys(want.entries).length + Object.keys(want.links).length} columns identical (core read in ${msCore} ms)`);
  for (const c of ['title', 'rom', 'fix', 'slug_x']) assert.ok(!(c in core.entries), `entries.${c} is in the first file`);
  assert.ok(!('tidx' in core.links), 'links.tidx is in the first file');
  for (const k of Object.keys(text)) assert.ok(k === 'entries' || k === 'links', `the text file carries section ${k}`);
  assert.deepStrictEqual(Object.keys(text.entries).sort(), ['fix', 'rom', 'slug_x', 'title'], 'the text file carries other entry columns');
  assert.deepStrictEqual(Object.keys(text.links), ['tidx'], 'the text file carries other link columns');
  ok('the first file holds no text; the second holds only text');
  const last = coreProgress[coreProgress.length - 1];
  assert.ok(coreProgress.length > 1 && last[0] === last[1] && last[1] === files['catalogue.bin'].length, 'progress did not reach the first file\'s size');
  ok(`progress: ${coreProgress.length} ticks, ending at the file size`);

  // ---- start from the first file alone, then add the text
  const D = api.prepare(core);
  assert.strictEqual(D.textReady, false);
  assert.strictEqual(D.E.title, null); assert.strictEqual(D.E.tl, null); assert.strictEqual(D.L.tidx, null);
  assert.strictEqual(D.titleShown(0), '', 'titleShown must not throw before the text has arrived');
  assert.strictEqual(D.E.n, want.entries.n);
  ok(`prepare() starts from the first file alone (${D.E.n.toLocaleString()} entries, no titles yet)`);

  App.D = D;
  await api.loadText();
  assert.strictEqual(App.textDone, 1, 'textReady() was not called once');
  assert.ok(D.textReady && App.textState.error === '', 'loadText did not finish cleanly');
  assert.ok(App.textState.got === App.textState.total && App.textState.total === files['text.bin'].length, 'text progress did not reach the file size');
  assert.deepStrictEqual(asked, ['catalogue.bin', 'text.bin', 'text.bin'], 'unexpected requests: ' + asked);       // catalogue, text (merge check above), text (loadText)

  const F = api.prepare(want);        // the way the local server and the single file start: everything at once
  assert.ok(F.textReady);
  let cols = 0;
  for (const part of ['E', 'L']) for (const k of Object.keys(F[part])) {
    const f = F[part][k], d = D[part][k];
    if (ArrayBuffer.isView(f)) { assert.ok(ArrayBuffer.isView(d), `${part}.${k} is missing after the text arrived`); sameArray(d, f, `${part}.${k}`); cols++; }
  }
  sameArray(D.E.tl, F.E.tl, 'E.tl'); sameArray(D.E.title, F.E.title, 'E.title'); sameArray(D.E.rom, F.E.rom, 'E.rom');
  assert.strictEqual(D.nTitles, F.nTitles);
  assert.deepStrictEqual([...D.slugX], [...F.slugX]); assert.deepStrictEqual([...D.fixes], [...F.fixes]);
  for (let i = 0; i < D.E.n; i++) { if (D.slugOf(i) !== F.slugOf(i) || D.titleShown(i) !== F.titleShown(i)) assert.fail(`slug or title differs at ${i}`); }
  for (let i = 0; i < D.E.n; i += 997) assert.deepStrictEqual(D.sameTitle(i), F.sameTitle(i), `sameTitle(${i})`);
  ok(`started from the first file and given the text, it equals the whole dataset: ${cols} typed columns, titles, search text, slugs`);

  // ---- what the builder derives, recomputed here from the titles
  const E = want.entries;
  const initialOf = t => { const s = t.replace(/^ +/, ''); if (!s) return 0; const c = s.charCodeAt(0); return c >= 65 && c <= 90 ? c - 63 : c >= 97 && c <= 122 ? c - 95 : c >= 48 && c <= 57 ? 1 : 0; };
  const seen = new Map();
  let bad = { initial: 0, tkey: 0, hasser: 0 };
  for (let i = 0; i < E.n; i++) {
    if (initialOf(E.title[i]) !== D.E.initial[i]) bad.initial++;
    const key = E.platform[i] + '\u0000' + E.title[i];
    let g = seen.get(key); if (g === undefined) { g = seen.size; seen.set(key, g); }
    if (g !== D.E.tkey[i]) bad.tkey++;
    if ((E.rom[i] !== '' ? 1 : 0) !== D.E.hasSer[i]) bad.hasser++;
  }
  assert.deepStrictEqual(bad, { initial: 0, tkey: 0, hasser: 0 }, 'a derived column disagrees with the titles');
  assert.strictEqual(seen.size, E.ntitles);
  ok(`first letter, title groups (${seen.size.toLocaleString()}) and has-a-serial: the builder's columns equal what the page computes from the titles`);

  // ---- a text file that does not come: the page stays usable and says why
  const D2 = api.prepare(core);
  App.D = D2; App.textDone = 0; App.textTicks = 0;
  files['text.bin'] = null;
  await api.loadText();
  assert.ok(!D2.textReady && App.textDone === 0 && /just updated/.test(App.textState.error), 'a 404 for the text file was not reported: ' + App.textState.error);
  assert.strictEqual(D2.titleShown(5), '');
  ok(`a missing text file leaves the page without titles and says: "${App.textState.error}"`);

  // ---- a text file from another catalogue: refused
  const lines = zlib.gunzipSync(fs.readFileSync(textPath)).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const lastTitle = lines.map((l, i) => [l, i]).filter(([l]) => l[0] === 'entries' && l[1] === 'title').pop()[0];
  lastTitle[2].pop();
  files['text.bin'] = zlib.gzipSync(lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const D3 = api.prepare(core);
  App.D = D3; App.textDone = 0;
  ctx.window.ROMGI.textBytes = files['text.bin'].length;
  await api.loadText();
  assert.ok(!D3.textReady && App.textDone === 0 && /do not belong/.test(App.textState.error), 'a text file of the wrong length was accepted: ' + App.textState.error);
  assert.strictEqual(D3.E.title, null, 'the mismatched titles were attached');
  ok(`a text file that does not fit the catalogue is refused: "${App.textState.error}"`);
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e.stack || e.message); process.exit(1); });
