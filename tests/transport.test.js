#!/usr/bin/env node
/*
 * The hosted catalogue file (one JSON document per line, gzip) must unpack in the browser to exactly the dataset it was made from.
 * This runs the page's own fetchDataset() against the file, with the progress hook and the slicing yields in place.
 *
 *   node tests/transport.test.js <catalogue.bin> <dataset.json.gz>
 */
const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), path = require('path'), assert = require('assert');

const [, , binPath, jsonPath] = process.argv;
const jsDir = path.join(__dirname, '..', 'web', 'js');
const code = ['00-util.js', '10-data.js'].map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
const bytes = fs.readFileSync(binPath);
const progress = [];
const ctx = vm.createContext({
  window: { ROMGI: { mode: 'snapshot', data: 'catalogue.bin' } }, console, performance, setTimeout, MessageChannel, TextDecoder, Intl,
  Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float64Array, Response, TransformStream, DecompressionStream, TextDecoderStream,
  fetch: async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } }),
  Loader: { progress: (got, total) => progress.push([got, total]) },
});
const api = vm.runInContext(code + '\n({ fetchDataset, prepare })', ctx);

(async () => {
  const t0 = performance.now();
  const got = await api.fetchDataset('catalogue.bin', () => {});
  const ms = Math.round(performance.now() - t0);
  const want = JSON.parse(zlib.gunzipSync(fs.readFileSync(jsonPath)).toString('utf8'));
  assert.deepStrictEqual(Object.keys(got).sort(), Object.keys(want).sort(), 'top-level sections differ');
  // objects built inside the page's vm context have another Object.prototype, so compare their JSON text instead of the objects
  for (const k of Object.keys(want)) assert.ok(JSON.stringify(got[k]) === JSON.stringify(want[k]), `section ${k} differs`);
  assert.ok(progress.length > 0 && progress[progress.length - 1][0] === progress[progress.length - 1][1], 'progress did not reach the file size');
  const D = api.prepare(got);
  assert.strictEqual(D.E.n, want.entries.n);
  console.log(`ok   ${Object.keys(want).length} sections identical, ${progress.length} progress ticks, unpacked in ${ms} ms; prepare() accepts it (${D.E.n.toLocaleString()} entries)`);
  console.log('ALL PASS');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
