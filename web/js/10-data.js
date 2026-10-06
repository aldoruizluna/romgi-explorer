/* ============================================================ data: load the catalogue and derive the arrays the engine scans */

async function loadDataset(onPhase) {
  if (window.ROMGI.mode === 'local') {
    onPhase('Reading the catalogue from your database');
    const r = await fetch('/api/dataset');
    if (!r.ok) throw new Error('The local server answered ' + r.status);
    return r.json();
  }
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack the catalogue. Use a current Chrome, Edge, Firefox or Safari.');
  if (window.ROMGI.data) return fetchDataset(window.ROMGI.data, onPhase);
  onPhase('Unpacking catalogue');
  await sleep(40);
  const b64 = document.getElementById('romgi-data').textContent.trim();
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const text = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  onPhase('Reading records');
  await sleep(20);
  return JSON.parse(text);
}

/** The hosted site ships the catalogue as gzip files, one JSON document per line ([section, key|null, value], or
 *  [section, key, values, offset] for a long column). They unpack as they arrive and are parsed line by line in short tasks. */
async function readNdjson(url, total, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 404 ? 'That file is gone: the site was probably just updated. Reload the page.' : `${url} answered ${r.status}`);
  total = total || +r.headers.get('content-length') || 0;     // the file's own size; a CDN may re-compress in transit
  let got = 0;
  onProgress(0, total);
  const meter = new TransformStream({ transform(chunk, ctl) { got += chunk.length; onProgress(got, total); ctl.enqueue(chunk); } });
  const raw = {}, put = ([k, kk, v, off]) => {
    if (kk === null) { raw[k] = v; return; }
    const sec = raw[k] || (raw[k] = {});
    if (off === undefined) { sec[kk] = v; return; }
    const col = sec[kk] || (sec[kk] = []);
    if (col.length !== off) throw new Error('The catalogue file is damaged (column ' + k + '.' + kk + ' is out of order).');
    for (let i = 0; i < v.length; i++) col.push(v[i]);
  };
  const reader = r.body.pipeThrough(meter).pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream()).getReader();
  let parts = [], last = performance.now();
  const take = async line => { if (!line.trim()) return; put(JSON.parse(line)); if (performance.now() - last > 12) { await yieldToMain(); last = performance.now(); } };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let s = value, nl;
    while ((nl = s.indexOf('\n')) !== -1) {
      parts.push(s.slice(0, nl));
      const line = parts.length === 1 ? parts[0] : parts.join('');
      parts = [];
      await take(line);
      s = s.slice(nl + 1);
    }
    if (s) parts.push(s);
  }
  if (parts.length) await take(parts.join(''));
  return raw;
}

/** The numbers every view needs: the page starts as soon as this has arrived. */
const fetchDataset = (url, onPhase) => readNdjson(url, window.ROMGI.dataBytes, (got, total) => Loader.progress(got, total));

/** Titles, serials, slugs, torrent file numbers and exact sizes arrive as a second file while the page is already usable.
 *  The views that need them wait; the search box says so. */
async function loadDetail() {
  const D = App.D, url = window.ROMGI.detail;
  if (!D || D.detailReady || !url) return;
  App.detailState = { got: 0, total: window.ROMGI.detailBytes || 0, error: '' };
  try {
    const part = await readNdjson(url, window.ROMGI.detailBytes, (got, total) => { App.detailState.got = got; App.detailState.total = total || App.detailState.total; App.detailProgress(); });
    await runSliced(attachDetailSteps(D, part));
    App.detailReady();
  } catch (e) { App.detailState.error = e.message; console.warn('Titles and sizes unavailable:', e.message); App.detailProgress(); }
}

/** The hosted site ships box-art paths as their own file, fetched once the page is usable; local mode already has them. */
async function loadArt() {
  const url = window.ROMGI.art, D = App.D;
  if (!url || !D || D.caps.art) { App.artState = D && D.caps.art ? 'ready' : 'none'; return; }
  App.artState = 'loading';
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('answered ' + r.status);
    const text = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
    await yieldToMain();
    const list = JSON.parse(text);
    if (!Array.isArray(list) || list.length !== D.E.n) throw new Error('not the same catalogue');
    D.E.art = list; D.caps.art = true; App.artState = 'ready';
    App.artReady();
  } catch (e) { App.artState = 'failed'; console.warn('Box art unavailable:', e.message); App.artReady(); }
}

/** Say whether this build matches romgi's published catalogue. The hosted site rebuilds itself when romgi publishes. */
async function checkFreshness() {
  const D = App.D;
  if (!D || window.ROMGI.mode === 'local' || !window.ROMGI.data) return;
  const repo = (D.meta.source_repo || '').replace('https://github.com/', '');
  if (!repo) return;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/main/db/version.json`);
    if (!r.ok) return;
    const j = await r.json(), m = D.meta;
    const same = j.version === m.version && j.generated_at === m.generated_at && j.entries === D.E.n && j.links === D.L.n;
    const held = window.ROMGI.latest;           // romgi's newest catalogue, when this build held it back as unfinished
    const isHeld = held && j.version === held.version && j.entries === held.entries && j.links === held.links;
    App.fresh = { state: isHeld ? 'held' : !same && Date.parse(j.generated_at) > Date.parse(m.generated_at) ? 'behind' : 'current', latest: j };
  } catch { return; }          // offline, or a host that blocks the request: say nothing
  App.paintFresh();
}

const slugifyAscii = t => t.toLowerCase().replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const ASCII_ONLY = /^[\x00-\x7f]*$/;

/** Builds the arrays the engine scans. A generator so the page can stay responsive: it yields between slices of about 10 ms. */
function* prepareSteps(raw) {
  const dims = raw.dims, re = raw.entries, rl = raw.links, nE = re.n, nL = rl.n;
  // new TypedArray(array) is several times faster than TypedArray.from(array); the columns are copied a few at a time
  const E = { n: nE, title: null, rom: null, tl: null, sumSize: null, art: re.art || null };       // the detail is attached by attachDetailSteps
  E.platform = new Uint8Array(re.platform); E.reg = new Uint8Array(re.reg); E.ra = new Uint32Array(re.ra); yield;
  E.ran = new Uint16Array(re.ran); E.flags = new Uint32Array(re.flags); E.nl = new Uint16Array(re.nl); yield;
  E.artk = new Uint8Array(re.artk); E.group = new Int16Array(re.group); yield;
  const L = { n: nL };
  L.src = new Uint8Array(rl.src); L.type = new Uint8Array(rl.type); L.fmt = new Uint8Array(rl.fmt); yield;
  L.size = null; L.sb = new Uint8Array(rl.sb); yield;       // each link's size class comes with the numbers; the exact sizes follow with the titles
  L.pack = new Int16Array(rl.pack); L.tidx = null; yield;

  // entry -> link offsets, link -> entry
  E.start = new Uint32Array(nE + 1);
  for (let i = 0; i < nE; i++) E.start[i + 1] = E.start[i] + E.nl[i];
  if (E.start[nE] !== nL) throw new Error('Link offsets do not add up: the dataset is damaged.');
  L.eo = new Uint32Array(nL);
  for (let i = 0; i < nE; i++) { for (let k = E.start[i]; k < E.start[i + 1]; k++) L.eo[k] = i; if ((i & 0x7FFF) === 0x7FFF) yield; }
  yield;

  // link-side derived columns
  L.deliv = new Uint8Array(nL);
  L.pack8 = new Uint8Array(nL);
  L.coll = new Uint8Array(nL);
  const packColl = dims.packs.map(p => p.collection);
  for (let l = 0; l < nL; l++) {
    const p = L.pack[l];
    L.deliv[l] = p >= 0 ? 1 : 0;
    L.pack8[l] = p >= 0 ? p : 255;
    L.coll[l] = p >= 0 ? packColl[p] : 255;
    if ((l & 0x7FFF) === 0x7FFF) yield;
  }

  // entry-side derived columns
  const platBrand = dims.platforms.map(p => p.brand);
  const REGLUT = new Uint8Array(125);
  for (let c = 0; c < 125; c++) { let x = c, m = 0; while (x) { const r = x % 5 - 1; if (r >= 0) m |= 1 << r; x = Math.floor(x / 5); } REGLUT[c] = m || 16; }
  E.brand = new Uint8Array(nE);
  E.regBits = new Uint8Array(nE);
  E.smask = new Uint16Array(nE);         // a bit per source (up to 12)
  E.nsrc = new Uint8Array(nE);
  E.rab = new Uint8Array(nE);
  E.nlb = new Uint8Array(nE);
  E.hasSer = new Uint8Array(re.hasser);         // these three come from the builder, so they need no text
  E.initial = new Uint8Array(re.initial);
  E.tkey = new Uint32Array(nE);                  // title group ids, counted up as titles first appear; tback is the way back (0 = new)
  E.inGrp = new Uint8Array(nE);
  let nextTitle = 0;
  for (let i = 0; i < nE; i++) {
    const back = re.tback[i];
    E.tkey[i] = back === 0 ? nextTitle++ : nextTitle - back;
    E.brand[i] = platBrand[E.platform[i]];
    E.regBits[i] = REGLUT[E.reg[i]];
    let m = 0;
    for (let k = E.start[i]; k < E.start[i + 1]; k++) m |= 1 << L.src[k];
    E.smask[i] = m;
    E.nsrc[i] = popcount(m);
    const n = E.ran[i];
    E.rab[i] = n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : n < 100 ? 4 : n < 250 ? 5 : 6;
    const nl = E.nl[i];
    E.nlb[i] = nl <= 1 ? 0 : nl >= 5 ? 4 : nl - 1;
    E.inGrp[i] = E.group[i] >= 0 ? 1 : 0;
    if ((i & 0x3FFF) === 0x3FFF) yield;
  }

  if (nextTitle !== re.ntitles) throw new Error('The title groups do not add up: the dataset is damaged.');
  const D = { raw, dims, E, L, nTitles: re.ntitles, meta: raw.meta, caps: raw.meta.caps, slugX: new Map(), fixes: new Map(), detailReady: false };
  D.platformOf = i => dims.platforms[E.platform[i]];
  D.slugOf = i => D.slugX.get(i) ?? (slugifyAscii(E.title[i]) + '-' + dims.platforms[E.platform[i]].id + D.regIds(i).map(r => '-' + r).join(''));
  D.regIds = i => { const out = []; let c = E.reg[i]; while (c) { out.push(dims.regions[c % 5 - 1].id); c = Math.floor(c / 5); } return out; };
  D.flagLabels = i => { const out = []; const m = E.flags[i]; for (let b = 0; b < dims.flags.length; b++) if (m >> b & 1) out.push(dims.flags[b]); return out; };
  D.artUrl = i => {
    if (!E.art || !E.artk[i]) return null;
    return (E.artk[i] === 1 ? 'https://art.gametdb.com/' : 'https://thumbnails.libretro.com/') + E.art[i];
  };
  D.fixTitle = i => D.fixes.get(i) || null;
  D.titleShown = i => { if (!E.title) return ''; const t = (D.fixes.get(i) || E.title[i]).replace(/^ +| +$/g, ''); return t || '(empty title)'; };
  D.srcVar = s => `var(--src-${dims.sources[s].slot})`;                       // a source keeps its colour whatever its position
  const ABBR = { minerva: 'MiNERVA', internet_archive: 'IA', nopaystation: 'NoPS', mariocube: 'MarioCube' };
  D.srcAbbr = s => ABBR[dims.sources[s].id] || dims.sources[s].short;
  D.srcDot = s => `<i class="sd" style="--c:${D.srcVar(s)}"></i>`;
  D.comboSources = mask => dims.sources.map((_, s) => s).filter(s => mask >> s & 1);
  D.entryLinks = i => [E.start[i], E.start[i + 1]];
  D.groupOf = i => (E.group[i] >= 0 ? dims.groups[E.group[i]] : null);
  D.sameTitle = i => { const out = []; const k = E.tkey[i]; for (let j = Math.max(0, i - 40); j < Math.min(nE, i + 41); j++) if (E.tkey[j] === k) out.push(j); return out; };
  if (re.title && rl.size) yield* attachDetailSteps(D, raw);        // a whole dataset (local server, single file, tests) carries its detail
  return D;
}

/** Titles, serials, slugs, torrent file numbers and exact sizes; then each entry's total size and the lower-cased titles the search scans. */
function* attachDetailSteps(D, part) {
  const E = D.E, L = D.L, pe = part.entries, pl = part.links;
  if (pe.title.length !== E.n || pl.size.length !== L.n) throw new Error('The titles and sizes do not belong to this catalogue. Reload the page.');
  E.title = pe.title; E.rom = pe.rom; yield;
  L.tidx = new Int32Array(pl.tidx); yield;
  L.size = new Float64Array(pl.size); yield;                 // two steps: each copy is a few dozen milliseconds
  const sum = new Float64Array(E.n);                 // an entry's size: its links with a plausible size, added up
  for (let i = 0; i < E.n; i++) {
    let t = 0;
    for (let k = E.start[i]; k < E.start[i + 1]; k++) { const b = L.sb[k]; if (b >= 1 && b <= 5) t += L.size[k]; }
    sum[i] = t;
    if ((i & 0x3FFF) === 0x3FFF) yield;
  }
  E.sumSize = sum;
  D.slugX = new Map(Object.entries(pe.slug_x).map(([k, v]) => [+k, v]));
  D.fixes = new Map(Object.entries(pe.fix).map(([k, v]) => [+k, v]));
  const tl = new Array(E.n);
  for (let i = 0; i < E.n; i++) {
    const t = E.title[i];
    tl[i] = ASCII_ONLY.test(t) ? t.toLowerCase() : asciiLower(t);
    if ((i & 0x3FFF) === 0x3FFF) yield;
  }
  E.tl = tl;
  D.detailReady = true;
}

function prepare(raw) {
  const g = prepareSteps(raw);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** Title-case helpers for presenting dimension values. */
const sizeLabel = (D, b) => D.dims.sizes[b].label;
