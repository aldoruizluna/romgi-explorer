#!/usr/bin/env node
/* Real catalogue, real drawer, English/Spanish and missing/stale optional metadata. */
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert'), zlib = require('zlib');
const { chromium } = require('playwright-core');
const site = path.resolve(process.argv[2] || 'site');
const output = path.resolve('dist/reference-browser');
fs.mkdirSync(output, { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(site, 'version.json')));
assert(version.reference, 'the hosted build must have a reference overlay');
const server = http.createServer((req, res) => {
  const file = path.resolve(site, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  if (!file.startsWith(site + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }); fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const base = `http://127.0.0.1:${server.address().port}/`;
    for (const scenario of ['valid', 'missing', 'stale']) {
      const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') return route.abort();
        if (url.pathname.endsWith('/' + version.reference)) {
          if (scenario === 'missing') return route.fulfill({ status: 404 });
          if (scenario === 'stale') {
            const lines = zlib.gunzipSync(fs.readFileSync(path.join(site, version.reference))).toString().trim().split('\n').map(line => JSON.parse(line));
            lines.find(row => row[0] === 'catalogue_key')[2] = '0'.repeat(64);
            return route.fulfill({ contentType: 'application/octet-stream', body: zlib.gzipSync(lines.map(row => JSON.stringify(row)).join('\n') + '\n') });
          }
        }
        return route.continue();
      });
      await page.goto(base + '#browse', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => App.D?.detailReady && ['ready', 'failed'].includes(App.referenceState), null, { timeout: 90000 });
      if (scenario === 'valid') {
        const index = await page.evaluate(() => App.D.reference.cols.year.findIndex((value, i) => value && App.D.reference.cols.dev[i]));
        assert(index >= 0, 'the catalogue has no known date/developer to inspect');
        await page.evaluate(index => Drawer.open(index), index);
        const facts = page.locator('#drawer .reference');
        await facts.waitFor({ state: 'visible' });
        assert((await facts.locator('dt').allTextContents()).includes('Developer'));
        assert((await facts.locator('a').allTextContents()).includes('CC BY-SA 4.0'));
        const source = await facts.locator('a').first().getAttribute('href');
        assert(/^https:\/\/github.com\/libretro\/libretro-database\/tree\/[a-f0-9]{40}$/.test(source));
        await page.screenshot({ path: path.join(output, 'reference-en.png') });
        // The drawer covers the header switch; close it as a visitor does.
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => App.sel == null);
        await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#lang-btn')]);
        await page.waitForFunction(() => App.D?.detailReady && App.referenceState === 'ready' && Lang.code === 'es', null, { timeout: 90000 });
        await page.evaluate(index => Drawer.open(index), index);
        assert((await facts.locator('dt').allTextContents()).includes('Desarrollador'));
        assert((await facts.innerText()).includes('Datos de referencia'));
        await page.screenshot({ path: path.join(output, 'reference-es.png') });
        const unknown = await page.evaluate(() => App.D.reference.cols.year.findIndex((_value, i) => Object.values(App.D.reference.cols).every(column => column[i] === 0)));
        assert(unknown >= 0, 'the real catalogue should retain unknown rows');
        await page.evaluate(index => Drawer.open(index), unknown);
        assert((await facts.innerText()).includes('No hay una coincidencia exacta'));
        assert.equal(await facts.locator('dl').count(), 0);
      } else {
        await page.evaluate(() => Drawer.open(0));
        assert.equal(await page.evaluate(() => App.D.reference), undefined);
        assert((await page.locator('#drawer .reference').innerText()).includes('Reference metadata is unavailable.'));
        assert.equal(await page.locator('#drawer .reference dl').count(), 0);
        assert(await page.locator('#drawer .dr-title').isVisible(), 'optional metadata failure prevented the card opening');
      }
      await context.close();
      console.log('PASS reference drawer:', scenario);
    }
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
