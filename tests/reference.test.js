/* Optional facts must remain correctly bound, escaped and dispensable. */
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert'), cp = require('child_process');
const root = path.resolve(__dirname, '..');
const source = JSON.parse(cp.execFileSync('python3', ['-c', 'import reference,json; print(json.dumps({"source":reference.SOURCE,"genres":reference.GENRES}))'], { cwd: root, encoding: 'utf8' }));
const App = { D: { E: { n: 2 } }, sel: null };
const context = vm.createContext({ window: { ROMGI: { reference: 'meta.test.bin', referenceKey: 'a'.repeat(64) } }, App, console, Intl, setTimeout, AbortSignal,
  Drawer: { render() {} }, readNdjson: async () => { throw new Error('synthetic missing optional file'); } });
for (const file of ['00-util.js', '01-i18n.js', '11-reference.js']) vm.runInContext(fs.readFileSync(path.join(root, 'web/js', file), 'utf8'), context);
const meta = { v: 1, n: 2, catalogue_key: 'a'.repeat(64), source: source.source, dims: { genre: source.genres, dev: ['<script>private-looking text</script>'], pub: ['Example Publisher'] },
  cols: { genre: [1, 0], year: [1998, 0], month: [3, 0], dev: [1, 0], pub: [1, 0], players: [2, 0] } };
context.meta = meta;
vm.runInContext('attachReference(App.D, meta, window.ROMGI.referenceKey)', context);
const html = vm.runInContext('referenceFacts(0)', context);
assert(html.includes('1998-03'));
assert(html.includes('&lt;script&gt;'));
assert(!html.includes('<script>'));
assert(html.includes('creativecommons.org/licenses/by-sa/4.0/'));
assert(html.includes(source.source.commit));
assert(vm.runInContext('referenceFacts(1)', context).includes('No exact reference match.'));
for (const bad of [{ ...meta, catalogue_key: 'b'.repeat(64) }, { ...meta, n: 3 }, { ...meta, cols: { ...meta.cols, dev: [99, 0] } }, { ...meta, source: { ...meta.source, license_url: 'javascript:alert(1)' } }]) {
  context.bad = bad;
  assert.throws(() => vm.runInContext('attachReference({E:{n:2}}, bad, window.ROMGI.referenceKey)', context));
}
(async () => {
  delete App.D.reference;
  await vm.runInContext('loadReference()', context);
  assert.equal(App.referenceState, 'failed');
  assert.equal(App.D.reference, undefined);
  assert(vm.runInContext('referenceFacts(0)', context).includes('Reference metadata is unavailable.'));
  context.window.ROMGI.reference = '';
  assert.equal(vm.runInContext('referenceFacts(0)', context), '');
  console.log('Reference facts: exact binding, unknown rows, escaping, provenance and optional-file failure PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
