#!/usr/bin/env node
/*
 * Property test: random slices through the browser engine vs SQL on the real database.
 *
 *   node tests/engine.test.js <romdb.db> <dataset.json.gz> [rounds]
 *
 * For each random state it checks (1) the visible entry and link counts against the SQL the UI prints,
 * (2) the crossfilter count of random facet values, and (3) random cross-tab cells.
 */
const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), path = require('path');
const { DatabaseSync } = require('node:sqlite');

const [, , dbPath, dsPath, roundsArg] = process.argv;
const rounds = +roundsArg || 120;
const jsDir = path.join(__dirname, '..', 'web', 'js');
const code = ['00-util.js', '01-i18n.js', '10-data.js', '20-engine.js', '48-collections.js'].map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
const ctx = vm.createContext({ window: { ROMGI: { mode: 'test' } }, App: { handlers: {} }, console, performance, TextDecoder, setTimeout, Intl, Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float64Array });
const api = vm.runInContext(code + '\n({ prepare, Slicer, COLLECTIONS, resolvePreset })', ctx);

const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(dsPath)).toString('utf8'));
const D = api.prepare(raw);
const S = new api.Slicer(D);
const db = new DatabaseSync(dbPath, { readOnly: true });
const SLOW_MS = +process.env.SLOW_MS || 3000;
const one = sql => {
  const t = Date.now(), v = Object.values(db.prepare(sql).get())[0], ms = Date.now() - t;
  if (ms > SLOW_MS) console.log(`  [slow ${(ms / 1000).toFixed(1)}s] ${sql.replace(/\s+/g, ' ').slice(0, 260)}`);
  return v;
};

let seed = 20261005;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

let checks = 0, fails = 0, skipped = 0;
function expect(name, got, want, state) {
  checks++;
  if (got !== want) {
    fails++;
    if (fails <= 12) console.log(`FAIL ${name}: engine ${got} vs sql ${want}\n     state ${JSON.stringify(S.serialize())}`);
  }
}

function randomState() {
  S.state = { grain: rnd() < 0.5 ? 'entries' : 'links', q: '', f: {} };
  const picks = shuffle(S.facets).slice(0, 1 + Math.floor(rnd() * 4));
  for (const f of picks) {
    const s = S.fs(f.id), size = f.n + (f.noneExtra ? 1 : 0);
    for (let k = 0, nv = 1 + Math.floor(rnd() * 3); k < nv; k++) {
      let v = Math.floor(rnd() * size);
      if (f.skip0 && v === 0) v = 1;
      if (f.id === 'flag' && v === f.n) v = 0;            // "No flags" has an approximate SQL form; covered separately
      if (rnd() < 0.2 && !s.inc.has(v)) s.exc.add(v); else if (!s.exc.has(v)) s.inc.add(v);
    }
    if (f.modeToggle && rnd() < 0.4) s.mode = 'all';
  }
  if (rnd() < 0.35) S.state.q = pick(['mario', '-beta zelda', '"the last"', 'pokemon -demo', 'sonic', 'a_b', 'super mario world', "dragon's"]);
  S.changed();
}

function expectedFacetCount(f, v) {
  const keep = S.state.f[f.id];
  delete S.state.f[f.id];
  const ce = S.conds('e').out, cl = S.conds('l').out;
  if (keep) S.state.f[f.id] = keep;
  const p = f.pred(v);
  const A = a => (a.length ? a.join('\n AND ') : '1 = 1');
  if (S.state.grain === 'links') {
    return one(`SELECT COUNT(*) FROM links l JOIN entries e ON e.slug = l.entry WHERE ${A([...ce, ...cl, p])}`);
  }
  if (f.level === 'e') {
    const ex = cl.length ? ` AND e.slug IN (SELECT l.entry FROM links l WHERE ${A(cl)})` : '';
    return one(`SELECT COUNT(*) FROM entries e WHERE ${A([...ce, p])}${ex}`);
  }
  return one(`SELECT COUNT(*) FROM entries e WHERE ${A(ce)} AND e.slug IN (SELECT l.entry FROM links l WHERE ${A([...cl, p])})`);
}

const PIVOT_DIMS = ['plat', 'src', 'type', 'fmt', 'sz', 'deliv', 'art', 'ra', 'nl', 'ser', 'grp', 'brand'];
function expectedCell(rf, a, cf, b, measure) {
  const ce = S.conds('e').out, cl = S.conds('l').out;
  const A = x => (x.length ? x.join('\n AND ') : '1 = 1');
  const pa = rf.pred(a), pb = cf.pred(b);
  const preds = [pa, pb];
  if (measure === 'links' || measure === 'bytes') {
    const size = measure === 'bytes' ? [`l.size > 0 AND NOT ${D.dims.sizes[6].sql}`] : [];
    const agg = measure === 'bytes' ? 'COALESCE(SUM(l.size), 0)' : 'COUNT(*)';
    return one(`SELECT ${agg} FROM links l JOIN entries e ON e.slug = l.entry WHERE ${A([...ce, ...cl, ...preds, ...size])}`);
  }
  const eP = preds.filter((_, i) => [rf, cf][i].level === 'e'), lP = preds.filter((_, i) => [rf, cf][i].level === 'l');
  const needLinks = cl.length || lP.length;
  const ex = needLinks ? ` AND e.slug IN (SELECT l.entry FROM links l WHERE ${A([...cl, ...lP])})` : '';
  return one(`SELECT COUNT(*) FROM entries e WHERE ${A([...ce, ...eP])}${ex}`);
}

const t0 = Date.now();
for (let round = 0; round < rounds; round++) {
  randomState();
  const sE = S.sql('entries'), sL = S.sql('links');
  if (sE.exact && sL.exact) {
    const t1 = Date.now(), before = checks;
    expect(`round ${round} visible entries`, S.res.nVisE, one(sE.count));
    expect(`round ${round} visible links`, S.res.nVisL, one(sL.count));
    for (const f of shuffle(S.facets).slice(0, 2)) {
      const size = f.n + (f.noneExtra ? 1 : 0);
      for (let k = 0; k < 2; k++) {
        let v = Math.floor(rnd() * size);
        if (f.skip0 && v === 0) v = 1;
        if (f.id === 'flag' && v === f.n) continue;
        expect(`round ${round} count ${f.id}[${v}] (${S.state.grain})`, S.counts(f.id)[v], expectedFacetCount(f, v));
      }
    }
    for (let k = 0; k < 2; k++) {
      const rf = S.byId[pick(PIVOT_DIMS)], cf = S.byId[pick(PIVOT_DIMS)];
      if (rf === cf) continue;
      const measure = pick(['entries', 'links', 'bytes']);
      const x = S.crosstab(rf.id, cf.id, measure);
      for (let c = 0; c < 2; c++) {
        const a = Math.floor(rnd() * rf.n), b = Math.floor(rnd() * cf.n);
        expect(`round ${round} cell ${rf.id}[${a}] x ${cf.id}[${b}] ${measure}`, x.cells[a * x.nc + b], expectedCell(rf, a, cf, b, measure));
      }
    }
    // the one-dimension fast paths must give exactly what the general path gives
    for (const f of shuffle(S.facets).slice(0, 5)) {
      for (const m of ['entries', 'links', 'bytes']) {
        S.cache = {}; const quick = Array.from(S.groupBy(f.id, m));
        S.cache = {}; S._noFast = true; const slow = Array.from(S.groupBy(f.id, m)); S._noFast = false;
        expect(`round ${round} groupBy ${f.id} ${m}: fast path vs general path`, JSON.stringify(quick), JSON.stringify(slow));
      }
    }
    console.log(`round ${String(round).padStart(2)}: ${checks - before} checks in ${((Date.now() - t1) / 1000).toFixed(1)}s, fails so far ${fails}  [${S.state.grain}] ${S.chips().map(c => c.label + (c.neg ? '!' : '')).join(' | ') || 'no filters'}`);
  } else skipped++;
}
// the empty slice must equal the catalogue
S.state = { grain: 'entries', q: '', f: {} }; S.changed();
expect('empty slice entries', S.res.nVisE, one('SELECT COUNT(*) FROM entries'));
expect('empty slice links', S.res.nVisL, one('SELECT COUNT(*) FROM links'));
// release families: games and add-ons partition the entries, and a game is counted once however many editions it has
{
  S.state = { grain: 'entries', q: '', f: {} }; S.changed();
  const k = S.kpis(), E = D.E, seen = new Set(); let add = 0;
  for (let i = 0; i < E.n; i++) { if (E.flags[i] & D.addonMask) add++; else seen.add(E.fam[i]); }
  expect('games count', k.games, seen.size); expect('add-on count', k.addons, add);
  expect('games and add-ons cover every entry or fewer (editions merge)', k.games + k.addons <= k.entries, true);
  S.state = { grain: 'entries', q: '', f: {} }; S.fs('plat').inc.add(0); S.changed();
  const k2 = S.kpis(); expect('a filtered slice has no more games than the whole', k2.games <= k.games, true);
}
// with nothing filtered the tallies made at start stand in for a count; they must equal one
for (const grain of ['entries', 'links']) {
  S.state = { grain, q: '', f: {} }; S.changed();
  for (const f of S.facets) expect(`unfiltered ${grain} counts of ${f.id}`, JSON.stringify(Array.from(S.counts(f.id))), JSON.stringify(Array.from(S.countFacet(f))));
}
S.state = { grain: 'entries', q: '', f: {} }; S.changed();
const fastK = JSON.stringify(S.kpis()); S.baseK = null; S.cache = {};
expect('unfiltered headline numbers', fastK, JSON.stringify(S.kpis()));
// counting a collection leaves the slice alone, and counting several in a row (as the page does at start) agrees with counting each alone
S.state = { grain: 'entries', q: '', f: {} }; S.changed();
const alone = api.COLLECTIONS.map(c => { const p = api.resolvePreset(c.preset, D); return p ? JSON.stringify(S.countPreset(p)) : null; });
const keep = { state: S.state, cache: S.cache }; const together = [];
for (const c of api.COLLECTIONS) { const p = api.resolvePreset(c.preset, D); together.push(p ? JSON.stringify(S.countPresetHere(p)) : null); }
S.state = keep.state; S.cache = keep.cache; S.recompute();
expect('collections counted in a row equal collections counted alone', JSON.stringify(together), JSON.stringify(alone));
expect('... and the slice is back to empty', S.res.nVisE, one('SELECT COUNT(*) FROM entries'));
// every hand-picked collection: its counts equal the SQL for the slice it sets, and counting it leaves the current slice alone
for (const c of api.COLLECTIONS) {
  const preset = api.resolvePreset(c.preset, D);
  if (!preset) { console.log(`skip collection ${c.id}: it names an id this catalogue no longer has`); continue; }
  S.state = { grain: 'entries', q: '', f: {} }; S.changed();
  const before = JSON.stringify(S.serialize()), cnt = S.countPreset(preset);
  expect(`collection ${c.id} leaves the slice alone`, JSON.stringify(S.serialize()), before);
  S.applyPreset(preset);
  const sE = S.sql('entries'), sL = S.sql('links');
  if (!sE.exact) { console.log(`skip collection ${c.id}: inexact SQL`); continue; }
  expect(`collection ${c.id} entries`, cnt.entries, one(sE.count));
  expect(`collection ${c.id} links`, cnt.links, one(sL.count));
  expect(`collection ${c.id} applied`, S.res.nVisE, cnt.entries);
  console.log(`collection ${c.id}: ${cnt.entries.toLocaleString()} entries, ${cnt.links.toLocaleString()} links`);
}
console.log(`${checks.toLocaleString()} checks over ${rounds} random slices in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${skipped} slices skipped for inexact SQL`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
