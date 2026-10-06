#!/usr/bin/env node
/*
 * Boots the built site in a real browser and uses it: the overview draws, titles arrive and wake the search, a filter changes the count,
 * a card opens, the other views draw, and the SQL console runs a query on the downloaded copy. Unit tests pass while a script error at
 * boot takes the whole page down; this is the check that sees what a visitor sees.
 *
 *   node tests/smoke.test.js <site dir>
 *
 * Needs playwright-core (npm install --no-save playwright-core) and a Chrome: CHROME_PATH, else /usr/bin/google-chrome (GitHub's runners
 * have it). The site is served from a small local server. Requests to other hosts are refused and counted: the only hosts the page may
 * ask for are the cover and freshness hosts, so a third-party font, script or tracker added by accident fails this test.
 */
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright-core');

const siteDir = path.resolve(process.argv[2] || 'site');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ALLOWED_EXTERNAL = new Set(['thumbnails.libretro.com', 'art.gametdb.com', 'raw.githubusercontent.com']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain', '.bin': 'application/octet-stream' };
const ok = msg => console.log('ok  ', msg);

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(siteDir, url.endsWith('/') ? url + 'index.html' : url);
  if (!file.startsWith(siteDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const problems = [];
  const hosts = new Map();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push('script error: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(m.text())) problems.push('console error: ' + m.text().slice(0, 200)); });
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') return route.continue();
      hosts.set(u.hostname, (hosts.get(u.hostname) || 0) + 1);
      return route.abort();
    });

    // ---- boot
    await page.goto(base + '#overview', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#start-h', { timeout: 90000 });
    const early = await page.evaluate(() => ({ entries: App.D.E.n, sources: App.D.dims.sources.length, built: window.ROMGI.builtAt }));
    assert.ok(early.entries > 1000, 'the catalogue has no entries');
    ok(`the overview draws from the first file (${early.entries.toLocaleString()} entries, ${early.sources} sources)`);

    // ---- the titles arrive and wake the search
    await page.waitForFunction(() => App.D.detailReady && !document.querySelector('#q').disabled, null, { timeout: 90000 });
    const placeholder = await page.evaluate(() => document.querySelector('#q').placeholder);
    assert.ok(!/Loading/.test(placeholder), 'the search box still says it is loading: ' + placeholder);
    ok('titles and sizes arrived; the search box is awake');
    await page.waitForFunction(() => App.artState === 'ready' || App.artState === 'failed' || App.artState === 'none', null, { timeout: 60000 });
    const sizeTile = await page.evaluate(() => document.querySelector('#kpi-size .v')?.textContent || '');
    assert.ok(/[KMGTP]iB/.test(sizeTile), 'the size tile never filled in: ' + sizeTile);
    assert.ok(!(await page.$('[data-act="tm"][data-m="bytes"][disabled]')), 'the Size toggle is still disabled');
    ok(`the overview filled in its size tile (${sizeTile}) and unlocked the Size toggle without a redraw`);

    // ---- search, then a filter changes the count
    await page.click('button.tab[data-v="browse"]');
    await page.waitForSelector('.vt-row, .gal', { timeout: 30000 });
    if (await page.$('[data-act="bmode"][data-m="table"][aria-pressed="false"]')) await page.click('[data-act="bmode"][data-m="table"]');
    await page.waitForSelector('.vt-row');
    const all = await page.evaluate(() => App.S.kpis().entries);
    await page.fill('#q', 'mario');
    await page.waitForFunction(n => App.S.kpis().entries < n, all, { timeout: 15000 });
    const found = await page.evaluate(() => ({ n: App.S.kpis().entries, rows: document.querySelectorAll('.vt-row').length, first: document.querySelector('.vt-row')?.textContent }));
    assert.ok(found.n > 0 && found.rows > 0 && /mario/i.test(found.first), 'search found nothing: ' + JSON.stringify(found));
    ok(`searching "mario" narrows ${all.toLocaleString()} entries to ${found.n.toLocaleString()} and the table shows them`);
    // ---- the address says what the page shows, and opening it elsewhere shows the same
    await page.click('.fg[data-fid="plat"] button.fr >> nth=1');
    await page.waitForFunction(() => /f\.plat=/.test(location.hash) && /q=mario/.test(location.hash), null, { timeout: 5000 });
    const shown = await page.evaluate(() => ({ hash: location.hash, n: App.S.kpis().entries }));
    const twin = await ctx.newPage();
    twin.on('pageerror', e => problems.push('script error (opened link): ' + e.message));
    await twin.route('**/*', route => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : (hosts.set(new URL(route.request().url()).hostname, 1), route.abort())));
    await twin.goto(base + shown.hash, { waitUntil: 'domcontentloaded' });
    await twin.waitForFunction(() => App.D && App.D.detailReady && document.querySelector('#q').value === 'mario', null, { timeout: 90000 });
    await twin.waitForFunction(n => App.S.kpis().entries === n, shown.n, { timeout: 15000 });
    assert.strictEqual(await twin.evaluate(() => App.ui.view), 'browse');
    await twin.close();
    ok(`the address (${shown.hash.length} characters) reproduces the slice in another tab: ${shown.n.toLocaleString()} entries, same query, same view`);
    await page.click('#rail-reset');
    await page.waitForFunction(() => !/f\.plat=|q=/.test(location.hash), null, { timeout: 5000 });
    await page.fill('#q', '');
    await page.waitForFunction(n => App.S.kpis().entries === n, all, { timeout: 15000 });
    const before = await page.evaluate(() => App.S.kpis().entries);
    await page.click('.fg[data-fid="plat"] button.fr >> nth=0');
    await page.waitForFunction(n => App.S.kpis().entries < n, before, { timeout: 15000 });
    ok('clicking a platform in the filter rail changes the count');
    await page.click('#rail-reset');

    // ---- a card opens
    await page.waitForSelector('.vt-row');
    await page.click('.vt-row >> nth=0');
    await page.waitForSelector('.drawer.open', { timeout: 10000 });
    const card = await page.evaluate(() => document.querySelector('.drawer.open .dr-title')?.textContent);
    assert.ok(card && card.trim().length > 0, 'the card has no title');
    ok(`a catalogue card opens ("${card.trim().slice(0, 40)}")`);
    // ---- the card is in the address, the back button closes it, forward brings it back, and a link opens it
    const cardHash = await page.evaluate(() => location.hash);
    assert.ok(/[?&]c=/.test(cardHash), 'the open card is not in the address: ' + cardHash);
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('.drawer.open') && !/[?&]c=/.test(location.hash), null, { timeout: 5000 });
    await page.goForward();
    await page.waitForSelector('.drawer.open', { timeout: 10000 });
    const link2 = await ctx.newPage();
    link2.on('pageerror', e => problems.push('script error (card link): ' + e.message));
    await link2.route('**/*', route => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : (hosts.set(new URL(route.request().url()).hostname, 1), route.abort())));
    await link2.goto(base + cardHash, { waitUntil: 'domcontentloaded' });
    await link2.waitForSelector('.drawer.open .dr-title', { timeout: 90000 });
    assert.strictEqual((await link2.evaluate(() => document.querySelector('.drawer.open .dr-title').textContent)).trim(), card.trim(), 'the link opened another entry');
    await link2.close();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.drawer.open') && !/[?&]c=/.test(location.hash), null, { timeout: 5000 });
    ok('the open card is in the address; back closes it, forward reopens it, and the link opens the same entry in another tab');
    // a link naming something this catalogue has not got still opens the page
    const odd = await ctx.newPage();
    odd.on('pageerror', e => problems.push('script error (odd link): ' + e.message));
    await odd.route('**/*', route => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
    await odd.goto(base + '#browse?f.plat=no-such-platform&c=no-such-entry', { waitUntil: 'domcontentloaded' });
    await odd.waitForFunction(() => App.D && App.D.detailReady, null, { timeout: 90000 });
    assert.ok(!(await odd.evaluate(() => 'plat' in App.S.state.f)), 'an unknown platform left a filter behind');
    await odd.close();
    ok('a link that names a platform and an entry this catalogue does not have still opens the page');

    // ---- the other views draw
    for (const [view, sel] of [['overview', '#start-h'], ['dice', '.heat td'], ['sources', '.src-card'], ['schema', '.er-box'], ['quality', '.q']]) {
      await page.click(`button.tab[data-v="${view}"]`);
      await page.waitForSelector(sel, { timeout: 20000 });
    }
    await page.click('button.tab[data-v="sources"]');
    const nCards = await page.evaluate(() => document.querySelectorAll('.src-card').length);
    assert.strictEqual(nCards, early.sources, 'one card per source');
    ok('Overview, Dice, Sources (one card per source), Schema and Quality all draw');

    // ---- the SQL console: the copy downloads, opens in a worker, and answers
    await page.click('button.tab[data-v="sql"]');
    await page.waitForSelector('#sql-in');
    await page.fill('#sql-in', 'SELECT COUNT(*) AS n FROM entries');
    await page.click('[data-act="sqlrun"]');
    await page.waitForSelector('.sql-t td', { timeout: 180000 });
    const n = await page.evaluate(() => document.querySelector('.sql-t td').textContent.replace(/[^0-9]/g, ''));
    assert.strictEqual(n, String(early.entries), `the SQL console counted ${n} entries, the page has ${early.entries}`);
    ok(`the SQL console ran a query on the downloaded copy (${Number(n).toLocaleString()} entries)`);

    // ---- a phone: the overview draws and the rail is tucked away
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await phone.newPage();
    p2.on('pageerror', e => problems.push('script error (phone): ' + e.message));
    await p2.route('**/*', route => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : (hosts.set(new URL(route.request().url()).hostname, 1), route.abort())));
    await p2.goto(base + '#overview', { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('#start-h', { timeout: 90000 });
    const noScroll = await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert.ok(noScroll, 'the phone layout scrolls sideways');
    ok('on a 390 px phone the overview draws and the page does not scroll sideways');

    // ---- nothing but the expected hosts
    const stray = [...hosts.keys()].filter(h => !ALLOWED_EXTERNAL.has(h));
    assert.deepStrictEqual(stray, [], 'the page asked for hosts it should not: ' + stray.join(', '));
    ok(`only expected hosts were asked for (${[...hosts.keys()].join(', ') || 'none'})`);
    assert.deepStrictEqual(problems, [], problems.join('\n'));
    ok('no script errors and no console errors');
    console.log('ALL PASS');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error('FAIL', e.stack || e.message); process.exit(1); });
