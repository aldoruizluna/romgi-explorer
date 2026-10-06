#!/usr/bin/env node
/*
 * The installable app: what the site ships for it, and what a browser does with it.
 *
 *   node tests/offline.test.js <site dir> <dataset.json.gz> [<art.json.gz>]
 *
 * The files: the manifest and the icons are what a browser needs to offer installing, and the service worker lists exactly the files that
 * exist, never the database. The behaviour, in a real Chrome (CHROME_PATH, else /usr/bin/google-chrome; needs playwright-core):
 *   - a first visit saves the page and the catalogue, and the app then opens with the network gone (not one request reaches the server);
 *   - a newer build installs in the background (found when the app starts) and waits: the open page keeps running on its own files and offers a reload;
 *   - a newer build that cannot be saved completely (a missing data file) is not installed, and the app in charge keeps working;
 *   - accepting the reload brings the new build, drops the old copy, and the new build opens offline too;
 *   - a second tab learns the page was updated in the first.
 * The newer builds are made here from the same dataset (a later catalogue date, so the first data file gets a new name). The server answers like
 * GitHub Pages does, with a ten-minute cache lifetime on everything, so a worker that trusted the HTTP cache would be caught.
 */
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), vm = require('vm'), assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const siteA = path.resolve(process.argv[2] || 'site');
const datasetPath = process.argv[3], artPath = process.argv[4];
if (!datasetPath) { console.error('usage: node tests/offline.test.js <site dir> <dataset.json.gz> [<art.json.gz>]'); process.exit(2); }
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const root = path.join(__dirname, '..');
const ok = msg => console.log('ok  ', msg);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.css': 'text/css',
  '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain', '.bin': 'application/octet-stream' };
const read = (dir, f) => fs.readFileSync(path.join(dir, f));
const text = (dir, f) => read(dir, f).toString('utf8');
const versionOf = dir => JSON.parse(text(dir, 'version.json'));

/** The worker's three values, read the way a browser would see them: by running the file with a stand-in for the worker's globals. */
function workerOf(dir) {
  const ctx = vm.createContext({ self: { registration: { scope: 'https://example.test/app/' }, addEventListener() {}, clients: {} }, location: { origin: 'https://example.test' }, URL, Response, caches: {}, fetch() {} });
  vm.runInContext(text(dir, 'sw.js'), ctx);
  return JSON.parse(vm.runInContext('JSON.stringify({ BUILD, FILES, INFO, CACHE })', ctx));
}
const pngSize = buf => { assert.strictEqual(buf.subarray(1, 4).toString(), 'PNG'); return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; };

// ---------------------------------------------------------------- the files
function checkFiles(dir, label) {
  const v = versionOf(dir), w = workerOf(dir), m = JSON.parse(text(dir, 'manifest.webmanifest')), page = text(dir, 'index.html');
  assert.deepStrictEqual(w.FILES.required, ['./', v.data, v.detail], `${label}: the worker must save the page and both data files before it counts as installed`);
  for (const f of [...w.FILES.required.slice(1), ...w.FILES.optional]) assert.ok(fs.existsSync(path.join(dir, f)), `${label}: the worker lists ${f}, which is not in the site`);
  assert.ok(w.FILES.optional.includes(v.art), `${label}: the box-art file is not saved`);
  assert.ok(w.FILES.optional.some(f => /^lang-es\.[0-9a-f]{8}\.js$/.test(f)), `${label}: the Spanish dictionary is not saved`);
  assert.ok(w.FILES.optional.some(f => f.startsWith('fonts/')), `${label}: the fonts are not saved`);
  for (const f of [...w.FILES.required, ...w.FILES.optional]) assert.ok(!/^db\.|og\.png|vendor\/|sql-worker/.test(f), `${label}: ${f} should not be saved ahead of use`);
  assert.strictEqual(w.CACHE, 'romgi-app-' + w.BUILD);
  assert.ok(/^\d{14}-[0-9a-f]{10}$/.test(w.BUILD), `${label}: odd build id ${w.BUILD}`);
  assert.strictEqual(w.INFO.build, w.BUILD); assert.strictEqual(w.INFO.data, v.data); assert.strictEqual(w.INFO.generated_at, v.romgi.generated_at);
  assert.ok(!/https?:\/\//.test(text(dir, 'sw.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/https:\/\/example\.test/g, '')), `${label}: the worker names another host`);
  assert.deepStrictEqual([m.start_url, m.scope, m.id, m.display], ['./', './', './', 'standalone'], `${label}: the manifest must use relative addresses`);
  const sizes = new Set();
  for (const ic of m.icons) {
    const [w1, h1] = pngSize(read(dir, ic.src)), [dw, dh] = ic.sizes.split('x').map(Number);
    assert.deepStrictEqual([w1, h1], [dw, dh], `${label}: ${ic.src} is ${w1}x${h1}, the manifest says ${ic.sizes}`);
    sizes.add(`${ic.sizes}/${ic.purpose}`);
  }
  for (const want of ['192x192/any', '512x512/any', '512x512/maskable']) assert.ok(sizes.has(want), `${label}: the manifest has no ${want} icon`);
  assert.deepStrictEqual(pngSize(read(dir, 'icons/apple-touch-icon.png')), [180, 180]);
  for (const tag of ['<link rel="manifest" href="manifest.webmanifest">', 'name="theme-color"', 'rel="apple-touch-icon"']) assert.ok(page.includes(tag), `${label}: the page lacks ${tag}`);
  return { v, w };
}
const A = checkFiles(siteA, 'the site');
ok(`manifest, icons and worker agree with the site (${A.w.FILES.required.length + A.w.FILES.optional.length} files saved at install, build ${A.w.BUILD}); the database is saved only when used`);

// ---------------------------------------------------------------- newer builds
const keep = !!process.env.OFFLINE_TMP;                                       // reuse the newer builds between runs while working on this test
const tmp = keep ? (fs.mkdirSync(process.env.OFFLINE_TMP, { recursive: true }), process.env.OFFLINE_TMP) : fs.mkdtempSync(path.join(os.tmpdir(), 'romgi-offline-'));
function build(name, tweak) {
  if (fs.existsSync(path.join(tmp, name, 'sw.js'))) return path.join(tmp, name);
  const ds = JSON.parse(zlib.gunzipSync(fs.readFileSync(datasetPath)).toString('utf8'));
  tweak(ds.meta);
  const gz = path.join(tmp, name + '.json.gz'), dir = path.join(tmp, name);
  fs.writeFileSync(gz, zlib.gzipSync(Buffer.from(JSON.stringify(ds))));
  execFileSync('python3', [path.join(root, 'bundle.py'), '--dataset', gz, ...(artPath ? ['--art', artPath] : []), '--pages', '--out-dir', dir, '--site-url', 'https://example.test/'], { stdio: 'pipe' });
  return dir;
}
const newer = d => { const t = new Date(Date.parse(d) + 7 * 864e5); return t.toISOString().replace('.000', ''); };
const siteC = build('newer', m => { m.generated_at = newer(m.generated_at); m.version = String(+m.version + 7); m.built_at = '2099-01-01T00:00:00+00:00'; });
const C = checkFiles(siteC, 'the newer build');
assert.notStrictEqual(C.w.BUILD, A.w.BUILD); assert.notStrictEqual(C.v.data, A.v.data);        // the detail file keeps its name: the titles did not change
const siteBroken = path.join(tmp, 'broken');                                 // the same newer build, with a data file that never arrives (one with a new name: an old name may come from the browser's own cache)
fs.rmSync(siteBroken, { recursive: true, force: true }); fs.cpSync(siteC, siteBroken, { recursive: true }); fs.unlinkSync(path.join(siteBroken, C.v.data));
ok(`a newer build (${C.w.INFO.generated_at.slice(0, 10)}, build ${C.w.BUILD}) has its own data files and its own worker`);

// ---------------------------------------------------------------- the server: like GitHub Pages, and switchable
let live = siteA, down = false;
const hits = [], missing = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  hits.push({ url, down });
  if (down) return req.socket.destroy();
  const file = path.join(live, url.endsWith('/') ? url + 'index.html' : url);
  if (!file.startsWith(live) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { missing.push(url); res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-length': fs.statSync(file).size, 'cache-control': 'max-age=600' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const problems = [];
  const watch = (page, tag) => {
    page.on('pageerror', e => problems.push(`${tag}: script error: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/net::ERR_|Failed to load resource|ERR_FAILED/.test(m.text())) problems.push(`${tag}: console error: ${m.text().slice(0, 200)}`); });
    return page.route('**/*', route => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));   // covers and the freshness check: no real network
  };
  const booted = async (page, data) => {
    await page.waitForFunction(() => typeof App !== 'undefined' && App.D && App.S && !document.querySelector('#loader') && document.querySelector('#view').children.length > 0, null, { timeout: 90000 });
    await page.waitForFunction(() => App.D.detailReady && App.artState !== 'loading', null, { timeout: 90000 });
    if (data) assert.strictEqual(await page.evaluate(() => window.ROMGI.data), data, 'the page is running other files than expected');
  };
  const cacheNames = page => page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('romgi-app-')));
  const until = async (cond, ms, what) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await new Promise(r => setTimeout(r, 100)); } };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await watch(page, 'tab 1');

    // ---- first visit: the app is saved
    await page.goto(base + '#overview', { waitUntil: 'domcontentloaded' });
    await booted(page, A.v.data);
    await page.waitForFunction(() => Pwa.state === 'ready', null, { timeout: 60000 });
    const entries = await page.evaluate(() => App.D.E.n);
    assert.deepStrictEqual(await cacheNames(page), [A.w.CACHE]);
    const saved = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname.replace(/^\//, '') || './'), A.w.CACHE);
    assert.deepStrictEqual(saved.sort(), [...A.w.FILES.required, ...A.w.FILES.optional].sort(), 'what is saved is not what the worker lists');
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the first worker did not take charge of the open page');
    ok(`a first visit saves the page, both data files, the covers' list and the fonts (${saved.length} files) and the worker takes charge without a reload`);
    assert.ok(await page.$eval('#net', e => e.hidden), 'the offline pill shows while online');

    // ---- the network goes away; the app opens anyway
    down = true; await ctx.setOffline(true); hits.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await booted(page, A.v.data);
    assert.strictEqual(await page.evaluate(() => App.D.E.n), entries);
    assert.ok(!(await page.$eval('#net', e => e.hidden)), 'the offline pill is hidden while offline');
    await page.goto(base + '?utm=x#browse?q=mario', { waitUntil: 'domcontentloaded' });         // another address of the same page
    await booted(page, A.v.data);
    assert.strictEqual(await page.evaluate(() => App.ui.view), 'browse');
    const reached = hits.filter(h => !/\/sw\.js$/.test(h.url));
    assert.strictEqual(reached.length, 0, 'requests reached the server while offline: ' + reached.map(h => h.url).join(', '));
    assert.ok(await page.evaluate(() => /Offline/.test(document.querySelector('#net').textContent)));
    await assert.rejects(page.goto(base + 'og.png'), 'a file the worker does not hold should fail offline, not be answered with the page');
    ok(`with the network gone the app opens from the saved copy (${entries.toLocaleString()} entries, a link with a query and a view); no request reached the server`);
    down = false; await ctx.setOffline(false);
    await page.goto(base + '#overview', { waitUntil: 'domcontentloaded' });
    await booted(page, A.v.data);
    await page.waitForFunction(() => Pwa.reg, null, { timeout: 30000 });

    // ---- a newer build that cannot be saved completely is not installed
    live = siteBroken; missing.length = 0;
    await page.evaluate(() => Pwa.reg.update().catch(() => {}));
    await until(() => missing.some(u => u.endsWith(C.v.data)), 120000, "the worker's request for the newer catalogue file");   // the install has begun and has failed
    await page.waitForFunction(() => !Pwa.reg.installing, null, { timeout: 60000 });
    assert.deepStrictEqual(await cacheNames(page), [A.w.CACHE], 'a build that failed to install left its half-saved files behind');
    assert.ok(!(await page.$eval('#pwa-bar', e => e.classList.contains('on'))), 'the page offered a reload for a build that was not saved');
    assert.ok(await page.evaluate(() => !Pwa.reg.waiting), 'a half-saved build is waiting to take over');
    assert.strictEqual(await page.evaluate(() => window.ROMGI.data), A.v.data);
    ok('a newer build missing a data file is not installed: nothing half-saved is left, no offer is made, the app in charge keeps working');
    live = siteA;                                                   // the broken build is withdrawn; opening a tab checks for a newer worker, and finds none

    // ---- a newer build installs quietly and waits
    const tab2 = await ctx.newPage(); await watch(tab2, 'tab 2');
    await tab2.goto(base + '#overview', { waitUntil: 'domcontentloaded' });
    await booted(tab2, A.v.data);
    await tab2.waitForFunction(() => Pwa.reg, null, { timeout: 30000 });
    live = siteC;
    await page.reload({ waitUntil: 'domcontentloaded' });            // starting the app asks the network for a newer worker; the page itself never has to
    await booted(page, A.v.data);                                    // and what it shows is still the build it was
    await page.waitForFunction(() => document.querySelector('#pwa-bar').classList.contains('on'), null, { timeout: 120000 });
    const said = await page.$eval('#pwa-bar', e => e.textContent);
    assert.ok(new RegExp(`newer catalogue \\(${C.w.INFO.generated_at.slice(0, 10)}\\)`).test(said), 'the bar does not name the newer catalogue: ' + said);
    assert.strictEqual(await page.evaluate(() => window.ROMGI.data), A.v.data, 'the open page changed under the reader');
    assert.deepStrictEqual((await cacheNames(page)).sort(), [A.w.CACHE, C.w.CACHE].sort());
    assert.ok(await page.evaluate(() => !!Pwa.reg.waiting), 'the newer worker is not waiting');
    ok(`a newer build (${C.w.INFO.generated_at.slice(0, 10)}) installs in the background; the page keeps its own files and says "${said.replace(/Reload.*$/, '').trim()}"`);

    // ---- accepting it
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }), page.click('[data-act="pwa-reload"]')]);
    await booted(page, C.v.data);
    assert.deepStrictEqual(await cacheNames(page), [C.w.CACHE], 'the old copy was not dropped');
    assert.strictEqual(await page.evaluate(() => App.D.meta.generated_at.slice(0, 10)), C.w.INFO.generated_at.slice(0, 10));
    assert.ok(await page.evaluate(() => !document.querySelector('#pwa-bar').classList.contains('on')), 'the bar stayed after the reload');
    ok('the reload brings the new build, the old saved copy is dropped');
    await tab2.waitForFunction(() => /another tab/.test(document.querySelector('#pwa-bar').textContent), null, { timeout: 20000 });
    ok('the other tab, still on the old page, is told it was updated in another tab');

    // ---- and the new build opens offline too
    down = true; await ctx.setOffline(true); hits.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await booted(page, C.v.data);
    assert.strictEqual(hits.filter(h => !/\/sw\.js$/.test(h.url)).length, 0);
    ok('the new build opens with the network gone');
    down = false; await ctx.setOffline(false);
    assert.deepStrictEqual(problems, [], 'problems on the pages:\n' + problems.join('\n'));
    ok('no script errors on any page');
  } finally {
    await browser.close(); server.close(); if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('ALL PASS');
})().catch(e => { console.error(e); try { if (!keep) fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } process.exit(1); });
