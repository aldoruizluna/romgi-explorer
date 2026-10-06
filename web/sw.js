/*
 * The hosted explorer's service worker: it keeps the page and the catalogue in the browser, so the app opens without a connection.
 * bundle.py fills in the three values below and writes this file next to index.html. Any change to the page or the data changes them,
 * so the browser installs a new copy of this file and the page offers a reload (web/js/51-pwa.js).
 *
 *   - Saved when the worker installs: the page, the fonts and the catalogue's data files. Those files are named by their content
 *     (catalogue.1a2b3c4d.bin), so a saved copy is never out of date; the page itself changes only by installing a newer worker.
 *   - Saved when first used: the SQL console's engine. Its database is kept by the console's own worker (the cache romgi-sql).
 *   - Never touched: other hosts (covers, the freshness check), version.json, and anything that is not a GET.
 * Every start also checks for a newer worker, so a build that fails to start is replaced at the next visit, not a day later.
 */
'use strict';
const BUILD = '/*@BUILD@*/';
const FILES = /*@FILES@*/{ required: [], optional: [] };      // paths relative to this file; the first list must arrive or the install fails
const INFO = /*@INFO@*/{};                                    // what the page may ask a waiting worker: which catalogue it brings

const PREFIX = 'romgi-app-', CACHE = PREFIX + BUILD;
const SCOPE = self.registration.scope;                        // the folder this file is in, ending in /
const ROOT = new URL(SCOPE).pathname;
const abs = path => new URL(path, SCOPE).href;
const named = url => /\/[a-z]+\.[0-9a-f]{8}\.bin$/.test(url);
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>romgi</title>'
  + '<body style="font:16px system-ui;margin:12vh 8vw;max-width:34em"><h1>romgi explorer</h1>'
  + '<p>There is no connection and no saved copy of the explorer in this browser. Reconnect and reload.</p>'
  + '<p>No hay conexión ni una copia guardada del explorador en este navegador. Vuelve a conectarte y recarga.</p>';

/** A response a navigation may be answered with: one that followed a redirect cannot be. */
async function plain(res) {
  return res.redirected ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const save = async path => {
      const url = abs(path), res = await fetch(url, { cache: named(url) ? 'default' : 'reload' });     // a content-named file may come from the HTTP cache; the rest is fetched fresh
      if (!res.ok) throw new Error(`${path} answered ${res.status}`);
      await cache.put(url, await plain(res));
    };
    try { await Promise.all(FILES.required.map(save)); }      // without these the app cannot start: a failure stops the install, and the worker in charge stays
    catch (e) { await caches.delete(CACHE); throw e; }
    await Promise.allSettled(FILES.optional.map(save));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(ROOT) || url.pathname.endsWith('/version.json')) return;
  event.respondWith(answer(event, url));
});

async function answer(event, url) {
  const req = event.request, cache = await caches.open(CACHE);
  if (req.mode === 'navigate') {
    if (url.pathname !== ROOT && url.pathname !== ROOT + 'index.html') return fetch(req);             // some other file typed into the address bar
    const page = await cache.match(SCOPE, { ignoreVary: true });
    if (page) {
      event.waitUntil(self.registration.update().catch(() => {}));      // every start asks whether a newer build exists, even if this page never gets to ask
      return page;
    }
    try { return await fetch(req); } catch { return new Response(OFFLINE, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }); }
  }
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.status === 200 && res.type === 'basic') event.waitUntil(cache.put(req, res.clone()));       // the console's engine, kept for next time
  return res;
}

self.addEventListener('message', event => {
  const m = event.data || {};
  if (m.type === 'skip-waiting') self.skipWaiting();
  else if (m.type === 'info' && event.ports[0]) event.ports[0].postMessage(INFO);
});
