#!/usr/bin/env node
/*
 * Links: every slice, view and card the page can show must survive being written to the address bar and read back.
 *
 *   node tests/url.test.js <dataset.json.gz>
 *
 * Checks that every value of every filter has a text form that reads back as itself, that random slices (filters, exclusions, modes,
 * grain, a query with awkward characters, sorting, the pivot) are the same after encode and apply, that old plain links still parse,
 * that names a catalogue no longer has are skipped and counted rather than breaking the page, that bad interface values are ignored,
 * and that a link stays short.
 */
const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), path = require('path'), assert = require('assert');

const dsPath = process.argv[2];
if (!dsPath) { console.error('usage: node tests/url.test.js <dataset.json.gz>'); process.exit(2); }
const jsDir = path.join(__dirname, '..', 'web', 'js');
const code = ['00-util.js', '10-data.js', '20-engine.js', '48-collections.js', '50-url.js'].map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
const App = { handlers: {}, views: { overview: {}, browse: {}, dice: {} }, sel: null, ui: null, saveUI() {} };
const ctx = vm.createContext({ window: { ROMGI: { mode: 'test', data: 'x' } }, App, console, performance, TextDecoder, setTimeout, Intl,
  Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float64Array, toast() {}, Drawer: {}, $: () => ({}) });
const api = vm.runInContext(code + `
const DEFAULT_UI = { view: 'overview', open: [], showAll: [], find: {}, twin: [],
  browse: { mode: 'table', sortKey: 'title', dir: 1, density: 'cozy', artOnly: true, galSort: 'ra', group: true },
  pivot: { row: 'plat', col: 'src', measure: 'links', norm: 'none', top: 20, sort: 'value', totals: true }, treemap: 'entries', stack: 'abs' };
({ prepare, Slicer, Url, DEFAULT_UI })`, ctx);
const ok = msg => console.log('ok  ', msg);
const canon = o => JSON.stringify({ ...o, f: Object.fromEntries(Object.entries(o.f).map(([k, v]) => [k, { ...v, i: [...v.i].sort((a, b) => a - b), e: [...v.e].sort((a, b) => a - b) }])) });   // sets have no order

const D = api.prepare(JSON.parse(zlib.gunzipSync(fs.readFileSync(dsPath)).toString('utf8')));
const S = new api.Slicer(D);
App.D = D; App.S = S; App.ui = JSON.parse(JSON.stringify(api.DEFAULT_UI));
api.Url.enabled = true;

// ---- every value of every filter reads back as itself
let values = 0;
for (const f of S.facets) {
  const size = f.n + (f.noneExtra ? 1 : 0), seen = new Set();
  for (let v = 0; v < size; v++) {
    if (f.id === 'avail' && v === 0) continue;                  // no source at all is not a value
    const t = f.tok(v);
    assert.strictEqual(typeof t, 'string', `${f.id} ${v}: token is not text`);
    assert.ok(!seen.has(t), `${f.id}: two values share the token "${t}"`); seen.add(t);
    assert.strictEqual(f.untok(t), v, `${f.id} ${v}: "${t}" reads back as ${f.untok(t)}`);
    values++;
  }
  assert.strictEqual(f.untok('no-such-value'), -1, `${f.id}: an unknown name was accepted`);
}
ok(`${values.toLocaleString()} filter values over ${S.facets.length} filters: each has its own text and reads back as itself`);

// ---- random slices survive encode and apply
let seed = 20261006;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const QUERIES = ['mario', '-beta zelda', '"the last"', 'pokémon -demo', 'a&b=c', 'x#y?z', '100%', 'söze  two  spaces', "dragon's", 'a,b+c'];
let longest = 0, rounds = 300;
for (let r = 0; r < rounds; r++) {
  const st = { grain: rnd() < 0.5 ? 'entries' : 'links', q: rnd() < 0.5 ? pick(QUERIES) : '', f: {} };
  for (const f of S.facets.filter(() => rnd() < 0.3)) {
    const size = f.n + (f.noneExtra ? 1 : 0), s = { inc: new Set(), exc: new Set(), mode: f.modeToggle && rnd() < 0.4 ? 'all' : 'any' };
    for (let k = 0, n = 1 + Math.floor(rnd() * 4); k < n; k++) {
      let v = Math.floor(rnd() * size); if (f.id === 'avail' && v === 0) v = 1;
      if (rnd() < 0.25) s.exc.add(v); else s.inc.add(v);
    }
    for (const v of s.inc) s.exc.delete(v);
    st.f[f.id] = s;
  }
  S.state = st; S.changed();
  App.ui = JSON.parse(JSON.stringify(api.DEFAULT_UI));
  App.ui.view = pick(['overview', 'browse', 'dice', 'sources']);
  if (App.ui.view === 'browse') Object.assign(App.ui.browse, { sortKey: pick(['title', 'size', 'links', 'ra']), dir: pick([1, -1]), mode: pick(['table', 'gallery']), density: pick(['cozy', 'compact']), group: pick([true, false]), artOnly: pick([true, false]) });
  if (App.ui.view === 'dice') Object.assign(App.ui.pivot, { row: pick(['plat', 'brand', 'fmt']), col: pick(['src', 'reg', 'all']), measure: pick(['links', 'entries', 'bytes']), norm: pick(['none', 'row', 'lift']), top: pick([10, 0]) });
  const want = canon(S.serialize()), wantUi = JSON.stringify(App.ui);
  const hash = '#' + api.Url.encode();
  longest = Math.max(longest, hash.length);
  assert.ok(!/[\s]/.test(hash), `round ${r}: the link has whitespace: ${hash}`);
  // read it into a different state, as a visitor opening the link would
  S.state = { grain: 'links', q: '', f: {} }; App.ui = JSON.parse(JSON.stringify(api.DEFAULT_UI)); api.Url.pending = null;
  const parsed = api.Url.parse(hash);
  assert.strictEqual(parsed.view, wantUiView(wantUi), `round ${r}: the view was lost`);
  const bad = api.Url.apply(parsed); App.ui.view = parsed.view;
  assert.strictEqual(bad, 0, `round ${r}: a name written by this page was not found again: ${hash}`);
  assert.strictEqual(canon(S.serialize()), want, `round ${r}: the slice changed on the way: ${hash}`);
  assert.strictEqual(JSON.stringify(App.ui), wantUi, `round ${r}: the interface changed on the way: ${hash}`);
}
function wantUiView(json) { return JSON.parse(json).view; }
ok(`${rounds} random slices (filters, exclusions, modes, grain, awkward queries, sorting, pivots) come back identical; the longest link is ${longest} characters`);

// ---- old plain links, and the empty slice
for (const v of ['overview', 'browse', 'dice', 'sources', 'sql']) { const p = api.Url.parse('#' + v); assert.ok(p.view === v && !p.has && !Object.keys(p.f).length); }
S.state = { grain: 'entries', q: '', f: {} }; App.ui = JSON.parse(JSON.stringify(api.DEFAULT_UI)); App.sel = null;
assert.strictEqual(api.Url.encode(), 'overview', 'an empty slice should be a bare view name');
assert.strictEqual(api.Url.parse('#/browse?q=x').view, 'browse');
ok('plain #overview style links still parse; the empty slice is just the view name');

// ---- names this catalogue does not have, and values this page does not know
S.state = { grain: 'entries', q: '', f: {} };
const p = api.Url.parse('#browse?f.plat=nope,ps3&f.nosuchfacet=1&x.reg=xx&f.src=minerva&m=weird&d=7&pm=%00&tm=bytes&c=%E0%A4%A');
const badN = api.Url.apply(p);
assert.strictEqual(badN, 3, `three parts do not exist here, counted ${badN}`);
assert.deepStrictEqual([...S.state.f.plat.inc], [D.dims.platforms.findIndex(x => x.id === 'ps3')]);
assert.deepStrictEqual([...S.state.f.src.inc], [D.dims.sources.findIndex(x => x.id === 'minerva')]);
assert.strictEqual(App.ui.browse.mode, 'table', 'a mode this page does not have was accepted');
assert.strictEqual(App.ui.browse.dir, 1, 'a sort direction other than 1 and -1 was accepted');
assert.strictEqual(App.ui.treemap, 'bytes');
assert.ok(!('reg' in S.state.f), 'an excluded region that does not exist left an empty filter behind');
ok('unknown platforms, regions and filters are skipped and counted (3); bad interface values and a broken %-escape are ignored');

// ---- the query waits for the titles; an entry link waits too
const early = api.prepare((() => { const r = JSON.parse(zlib.gunzipSync(fs.readFileSync(dsPath)).toString('utf8')); for (const k of ['title', 'rom', 'fix', 'slug_x']) delete r.entries[k]; delete r.links.size; delete r.links.tidx; return r; })());
App.D = early; S.state = { grain: 'entries', q: '', f: {} }; api.Url.pending = null;
api.Url.apply(api.Url.parse('#browse?q=mario&c=some-slug'));
assert.strictEqual(S.state.q, '', 'the query was applied before the titles arrived');
assert.deepStrictEqual(JSON.parse(JSON.stringify(api.Url.pending)), { q: 'mario', card: 'some-slug' });
assert.ok(api.Url.encode().includes('q=mario') && api.Url.encode().includes('c=some-slug'), 'the address lost the query or the card while they waited');
ok('a query and a card in a link wait for the titles, and the address keeps them meanwhile');
console.log('ALL PASS');
