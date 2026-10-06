#!/usr/bin/env node
/*
 * The explorer must cope with a source it has never seen. Run against a catalogue that has one more source than romgi's four
 * (tests/make_fixture.py --extra-source), this checks that
 *   - the new source gets its own colour slot, and the four known ones keep theirs;
 *   - each entry's source count and source set are what its links say;
 *   - the "Offered by" filter has a value for every combination, and its counts and SQL agree with the database;
 *   - the "three or more sources" collection covers every such combination;
 *   - names fall back to the source's own when there is no abbreviation.
 *
 *   node tests/sources.test.js <romdb.db> <dataset.json.gz>
 */
const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), path = require('path'), assert = require('assert');
const { DatabaseSync } = require('node:sqlite');

const [, , dbPath, dsPath] = process.argv;
if (!dsPath) { console.error('usage: node tests/sources.test.js <romdb.db> <dataset.json.gz>'); process.exit(2); }
const jsDir = path.join(__dirname, '..', 'web', 'js');
const code = ['00-util.js', '10-data.js', '20-engine.js', '48-collections.js'].map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
const ctx = vm.createContext({ window: { ROMGI: { mode: 'test' } }, App: { handlers: {} }, console, performance, TextDecoder, setTimeout, Intl,
  Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float64Array });
const api = vm.runInContext(code + '\n({ prepare, Slicer, COLLECTIONS, resolvePreset, popcount })', ctx);
const ok = msg => console.log('ok  ', msg);

const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(dsPath)).toString('utf8'));
const D = api.prepare(raw), S = new api.Slicer(D);
const db = new DatabaseSync(dbPath, { readOnly: true });
const srcs = D.dims.sources, N = srcs.length;
assert.ok(N >= 5, `this test wants a catalogue with an extra source; this one has ${N}`);

// ---- colour slots
const KNOWN = ['minerva', 'internet_archive', 'nopaystation', 'mariocube'];
KNOWN.forEach((id, slot) => { const s = srcs.find(x => x.id === id); if (s) assert.strictEqual(s.slot, slot, `${id} lost its colour slot`); });
const slots = srcs.map(s => s.slot);
assert.strictEqual(new Set(slots).size, N, 'two sources share a colour slot: ' + slots);
const extra = srcs.filter(s => !KNOWN.includes(s.id));
assert.ok(extra.length && extra.every(s => s.slot >= KNOWN.length), 'a new source took a known source\'s slot');
srcs.forEach((_, i) => assert.strictEqual(D.srcVar(i), `var(--src-${srcs[i].slot})`));
ok(`${N} sources; the four known ones keep slots 0-3, ${extra.map(s => `${s.id} has slot ${s.slot}`).join(', ')}`);

// ---- per-entry source sets and counts, recomputed from the links
const idx = new Map(srcs.map((s, i) => [s.id, i]));
const want = new Uint16Array(D.E.n);
for (let i = 0; i < D.E.n; i++) for (let k = D.E.start[i]; k < D.E.start[i + 1]; k++) want[i] |= 1 << D.L.src[k];
let bad = 0, badN = 0;
for (let i = 0; i < D.E.n; i++) { if (D.E.smask[i] !== want[i]) bad++; if (D.E.nsrc[i] !== api.popcount(want[i])) badN++; }
assert.strictEqual(bad, 0, 'entries whose source mask differs from their links');
assert.strictEqual(badN, 0, 'entries whose source count differs from their links');
const dbMasks = new Map();
for (const r of db.prepare('SELECT entry, source_id FROM links').all()) dbMasks.set(r.entry, (dbMasks.get(r.entry) || 0) | (1 << idx.get(r.source_id)));
const sqlHist = new Map(); for (const m of dbMasks.values()) sqlHist.set(m, (sqlHist.get(m) || 0) + 1);
ok(`source masks and counts of ${D.E.n.toLocaleString()} entries equal their links' (${sqlHist.size} different combinations)`);

// ---- the "Offered by" filter
const avail = S.facets.find(f => f.id === 'avail');
assert.strictEqual(avail.n, 1 << N, 'the filter has no value for some combination');
S.state = { grain: 'entries', q: '', f: {} }; S.changed();
const counts = S.counts('avail');
let total = 0, seenExtra = 0;
for (const [m, n] of sqlHist) {
  assert.strictEqual(counts[m], n, `combination ${m}: filter ${counts[m]}, database ${n}`);
  total += n; if (m >> idx.get(extra[0].id) & 1) seenExtra += n;
}
assert.strictEqual(total, dbMasks.size);
assert.ok(seenExtra > 0, 'no entry is offered by the new source');
// the SQL the UI prints for each combination returns the same count
for (const [m, n] of sqlHist) {
  const sql = `SELECT COUNT(*) AS c FROM entries e WHERE ${avail.pred(m)}`;
  assert.strictEqual(db.prepare(sql).get().c, n, `printed SQL for combination ${m} disagrees`);
}
ok(`"Offered by" has ${avail.n} values; counts and printed SQL agree with the database for all ${sqlHist.size} combinations (${seenExtra.toLocaleString()} entries involve the new source)`);

// ---- the collection that needs three or more sources
const preset = api.resolvePreset({ grain: 'entries', avail: 'min3' }, D);
const need = [...Array(1 << N).keys()].filter(m => api.popcount(m) >= 3);
assert.deepStrictEqual([...preset.avail].sort((a, b) => a - b), need);
const c = S.countPreset(preset);
let sqlC = 0; for (const [m, n] of sqlHist) if (api.popcount(m) >= 3) sqlC += n;
assert.strictEqual(c.entries, sqlC, 'the three-or-more-sources collection count');
ok(`"three or more sources" covers ${need.length} combinations and counts ${c.entries.toLocaleString()} entries, as the database does`);

// ---- names
for (let i = 0; i < N; i++) assert.ok(D.srcAbbr(i) && D.srcAbbr(i) !== 'undefined');
assert.strictEqual(D.srcAbbr(idx.get(extra[0].id)), extra[0].short);
ok(`an unknown source is named by its own short name ("${extra[0].short}")`);
console.log('ALL PASS');
