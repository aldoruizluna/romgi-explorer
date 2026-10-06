#!/usr/bin/env node
/*
 * The page in Spanish, in a real browser.
 *
 *   node tests/lang.test.js <site dir> [<standalone.html>]
 *
 * A browser that asks for Spanish gets Spanish with no click: the <html> language, the headline painted before the page's own script
 * runs, the tabs, the filters, the cards. Numbers follow the browser's own locale (Mexico writes 241,137; Spain writes 241.137). Every view
 * is then read for English that the dictionary did not catch: any visible words from a short list of English function words, outside the
 * places that carry other people's text (titles, the sources' own notes, SQL, file names). The switch in the top bar changes the language
 * and comes back to the same slice. With a second argument, the single-file build (which carries the dictionary inside it) is checked too.
 */
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright-core');

const siteDir = path.resolve(process.argv[2] || 'site'), standalone = process.argv[3] && path.resolve(process.argv[3]);
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.css': 'text/css', '.png': 'image/png',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain', '.bin': 'application/octet-stream' };
const ok = msg => console.log('ok  ', msg);
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]), file = path.join(siteDir, url.endsWith('/') ? url + 'index.html' : url);
  if (!file.startsWith(siteDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
});

/** In the page: the visible words that look English, outside the places that carry other people's text. */
const AUDIT = () => {
  const ENGLISH = /(?<![\p{L}'])(the|and|with|from|that|this|your|are|is|not|you|can|will|when|which|have|has|been|only|each|any|all|of|for|to|in|on|or|by|was|were|than|then|into|about|more|click|nothing|show|open|copy|clear)(?![\p{L}'])/iu;
  const SKIP = 'pre, code, .codebox, textarea, svg, script, style, .vt-body, .gcard .t, .notes, .tg, .mono, .cp, .title, .ed-t, .sib, .caps, .plats, .run .mono, .ex b, .tops, .rng, .cn, #q, .src-card h3, .src-card p, .lk-row .l2.more, .dr-title, [data-act="sqltbl"], #drawer[aria-hidden="true"]';
  const out = new Set(), root = document.querySelector('#app');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement, text = n.textContent.replace(/\s+/g, ' ').replace(/ORDER BY title/g, '').trim();      // SQL inside a sentence is not English prose
    if (!text || !el || el.closest(SKIP) || el.closest('[hidden]') || getComputedStyle(el).display === 'none') continue;
    if (ENGLISH.test(text)) out.add(text.slice(0, 140));
  }
  // attributes people read: tooltips and labels
  for (const el of root.querySelectorAll('[aria-label],[data-tip],[placeholder],[title]')) {
    if (el.closest(SKIP)) continue;
    for (const a of ['aria-label', 'data-tip', 'placeholder', 'title']) { const v = el.getAttribute(a); if (v && ENGLISH.test(v)) out.add(`${a}: ${v.slice(0, 120)}`); }
  }
  return [...out];
};

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const problems = [];
  const open = async (locale, url, extra = {}) => {
    const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 900 }, ...extra }), page = await ctx.newPage();
    page.on('pageerror', e => problems.push('script error: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/net::ERR_|Failed to load resource/.test(m.text())) problems.push('console error: ' + m.text().slice(0, 200)); });
    await page.route('**/*', route => (/^(127\.0\.0\.1|)$/.test(new URL(route.request().url()).hostname) ? route.continue() : route.abort()));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return { ctx, page };
  };
  const ready = async page => {
    await page.waitForFunction(() => typeof App !== 'undefined' && App.D && App.S && !document.querySelector('#loader') && document.querySelector('#view').children.length > 0, null, { timeout: 120000 });
    await page.waitForFunction(() => App.D.detailReady && App.artState !== 'loading', null, { timeout: 120000 });
  };
  try {
    // ---- Spanish with no click, the headline before the script runs
    let { ctx, page } = await open('es-MX', base + '#overview');
    assert.strictEqual(await page.evaluate(() => document.documentElement.lang), 'es');
    const hero = await page.evaluate(() => document.querySelector('.lhero .lh-cap')?.textContent || '');
    assert.ok(/^lanzamientos en \d+ plataformas, ofrecidos mediante [\d,]+ enlaces de \d+ fuentes$/.test(hero), 'the loader headline is not Spanish: ' + hero);
    await ready(page);
    assert.strictEqual(await page.evaluate(() => document.querySelector('#start-h')?.textContent), 'Empieza aquí');
    assert.deepStrictEqual(await page.evaluate(() => [...document.querySelectorAll('#tabs .tab span')].map(s => s.textContent.trim()).filter(t => !/^\d+$/.test(t))), ['Resumen', 'Pivote', 'Explorar', 'Fuentes', 'Esquema', 'Calidad', 'SQL']);
    assert.strictEqual(await page.evaluate(() => document.querySelector('#q').placeholder), 'Buscar títulos. Prueba: mario -beta');
    const big = await page.evaluate(() => ({ text: document.querySelector('.hero .big')?.textContent, n: App.D.E.n }));
    assert.strictEqual(big.text, new Intl.NumberFormat('es-MX').format(big.n), 'the headline number is not written the Mexican way');
    ok(`Spanish with no click: <html lang="es">, the loader headline, the tabs, the search box, the first number (${big.text})`);

    // ---- the notice about a catalogue held back as unfinished, worded from numbers
    const held = await page.evaluate(() => { window.ROMGI.latest = { version: '20260816', generated_at: '2026-08-16T01:42:02Z', entries: 140141, links: 187838, reason: 'English reason', against: { entries: 241122, links: 400403 }, drop: 42 }; return App.heldHTML(); });
    assert.ok(/parece incompleto/.test(held) && /140,141 entradas y 187,838 enlaces frente a 241,122 y 400,403/.test(held) && /42% menos entradas/.test(held) && !/English reason/.test(held), 'the held-back notice is not worded in Spanish from its numbers: ' + held);
    await page.evaluate(() => { window.ROMGI.latest = null; });
    ok('the notice about a catalogue held back is worded in Spanish from its numbers');

    // ---- every view, and what the people see in it, read for English
    const leftovers = {};
    const audit = async (label) => { const l = await page.evaluate(AUDIT); if (l.length) leftovers[label] = l; };
    await audit('overview');
    await page.click('[data-act="help"]'); await page.waitForSelector('#modal.on .box'); await audit('help'); await page.keyboard.press('Escape');
    for (const v of ['dice', 'sources', 'schema', 'quality', 'sql']) { await page.click(`button.tab[data-v="${v}"]`); await page.waitForTimeout(500); await audit(v); }
    await page.click('button.tab[data-v="browse"]'); await page.waitForSelector('.vt-row');
    await audit('browse');
    await page.click('.vt-row >> nth=2'); await page.waitForSelector('#drawer.open .dr-title'); await page.waitForTimeout(300); await audit('card'); await page.keyboard.press('Escape');
    await page.click('[data-act="bmode"][data-m="gallery"]'); await page.waitForSelector('.gcard'); await audit('gallery');
    await page.click('button.tab[data-v="overview"]'); await page.click('[data-act="tm"][data-m="links"]'); await page.click('.fg[data-fid="plat"] button.fr >> nth=1'); await page.waitForTimeout(400); await audit('a filtered overview');
    assert.deepStrictEqual(leftovers, {}, 'English left in the Spanish page:\n' + JSON.stringify(leftovers, null, 1));
    ok('no English left in the overview, help, dice, sources, schema, quality, SQL, browse, a card, the gallery and a filtered overview');

    // ---- the switch, and coming back to the same place
    await page.click('button.tab[data-v="browse"]');
    await page.click('.fg[data-fid="reg"] button.fr >> nth=0');
    await page.waitForFunction(() => /f\.reg=/.test(location.hash), null, { timeout: 5000 });
    const before = await page.evaluate(() => ({ hash: location.hash, n: App.S.kpis().entries }));
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#lang-btn')]);
    await ready(page);
    assert.strictEqual(await page.evaluate(() => document.documentElement.lang), 'en');
    const after = await page.evaluate(() => ({ hash: location.hash, n: App.S.kpis().entries, tab: document.querySelector('#tabs .tab[aria-selected="true"] span').textContent.trim(), store: localStorage.getItem('romgi.lang') }));
    assert.deepStrictEqual([after.hash, after.n, after.tab, after.store], [before.hash, before.n, 'Browse', '"en"'], 'the switch did not come back to the same place: ' + JSON.stringify([before, after]));
    ok(`the switch changes the language and comes back to the same slice and view (${before.n.toLocaleString()} entries, ${before.hash})`);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('#lang-btn')]);
    await ready(page);
    assert.strictEqual(await page.evaluate(() => document.documentElement.lang), 'es');
    await ctx.close();

    // ---- the choice sticks, and the browser's own number format is used
    ({ ctx, page } = await open('en-US', base + '#overview'));
    await page.evaluate(() => localStorage.setItem('romgi.lang', '"es"'));
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(page);
    assert.strictEqual(await page.evaluate(() => document.documentElement.lang), 'es', 'a saved choice of Spanish was not used by an English browser');
    await ctx.close();
    ({ ctx, page } = await open('es-ES', base + '#overview'));
    await ready(page);
    const spain = await page.evaluate(() => ({ text: document.querySelector('.hero .big')?.textContent, n: App.D.E.n, hero: document.querySelector('.lhero')?.dataset.entries }));
    assert.strictEqual(spain.text, new Intl.NumberFormat('es-ES').format(spain.n));
    assert.ok(/\./.test(spain.text), 'Spain should write thousands with a point: ' + spain.text);
    ok(`a browser set to Spain writes ${spain.text}, one set to Mexico writes ${big.text}`);
    await ctx.close();

    // ---- English is still English, and an unknown language falls back to it
    ({ ctx, page } = await open('fr-FR', base + '#overview'));
    await ready(page);
    assert.strictEqual(await page.evaluate(() => [document.documentElement.lang, document.querySelector('#start-h')?.textContent]).then(a => a.join('|')), 'en|Start here');
    await ctx.close();
    ok('a browser set to French gets English');

    // ---- the single-file build carries the dictionary inside it
    if (standalone) {
      ({ ctx, page } = await open('es-MX', 'file://' + standalone + '#overview'));
      await page.waitForFunction(() => typeof App !== 'undefined' && App.D && !document.querySelector('#loader') && document.querySelector('#view').children.length > 0, null, { timeout: 180000 });
      assert.strictEqual(await page.evaluate(() => document.querySelector('#start-h')?.textContent), 'Empieza aquí');
      await ctx.close();
      ok('the single-file build is in Spanish too, with the dictionary inside it');
    }
    assert.deepStrictEqual(problems, [], 'problems on the pages:\n' + problems.join('\n'));
    ok('no script errors and no console errors');
  } finally { await browser.close(); server.close(); }
  console.log('ALL PASS');
})().catch(e => { console.error(e); process.exit(1); });
