/* ============================================================ data: load the catalogue and derive the arrays the engine scans */
const KiB = 1024, MiB = 1048576, GiB = 1073741824, TiB = 1099511627776;
const SIZE_EDGES = [512 * KiB, 16 * MiB, 700 * MiB, Math.floor(4.7 * GiB)];

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

/** The hosted site ships the catalogue as its own gzip file: it downloads while the page is already usable, and unpacks as it arrives. */
async function fetchDataset(url, onPhase) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('The catalogue file answered ' + r.status);
  const total = +r.headers.get('content-length') || 0;
  let got = 0;
  Loader.progress(0, total);
  const meter = new TransformStream({ transform(chunk, ctl) { got += chunk.length; Loader.progress(got, total); ctl.enqueue(chunk); } });
  // one JSON document per line ([section, key|null, value] or [section, key, values, offset] for a long column),
  // parsed as each line completes, in short tasks
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
    App.fresh = { state: !same && Date.parse(j.generated_at) > Date.parse(m.generated_at) ? 'behind' : 'current', latest: j };
  } catch { return; }          // offline, or a host that blocks the request: say nothing
  App.paintFresh();
}

const slugifyAscii = t => t.toLowerCase().replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const ASCII_ONLY = /^[\x00-\x7f]*$/;

/** Builds the arrays the engine scans. A generator so the page can stay responsive: it yields between slices of about 10 ms. */
function* prepareSteps(raw) {
  const dims = raw.dims, re = raw.entries, rl = raw.links, nE = re.n, nL = rl.n;
  const E = {
    n: nE, title: re.title, rom: re.rom, art: re.art || null,
    platform: Uint8Array.from(re.platform), reg: Uint8Array.from(re.reg), ra: Uint32Array.from(re.ra), ran: Uint16Array.from(re.ran),
    flags: Uint32Array.from(re.flags), nl: Uint16Array.from(re.nl), artk: Uint8Array.from(re.artk), group: Int16Array.from(re.group),
  };
  const L = {
    n: nL, src: Uint8Array.from(rl.src), type: Uint8Array.from(rl.type), fmt: Uint8Array.from(rl.fmt),
    size: Float64Array.from(rl.size), pack: Int16Array.from(rl.pack), tidx: Int32Array.from(rl.tidx),
  };
  const slugX = new Map(Object.entries(re.slug_x).map(([k, v]) => [+k, v]));
  const fixes = new Map(Object.entries(re.fix).map(([k, v]) => [+k, v]));

  // entry -> link offsets, link -> entry
  E.start = new Uint32Array(nE + 1);
  for (let i = 0; i < nE; i++) E.start[i + 1] = E.start[i] + E.nl[i];
  if (E.start[nE] !== nL) throw new Error('Link offsets do not add up: the dataset is damaged.');
  L.eo = new Uint32Array(nL);
  for (let i = 0; i < nE; i++) { for (let k = E.start[i]; k < E.start[i + 1]; k++) L.eo[k] = i; if ((i & 0xFFFF) === 0xFFFF) yield; }
  yield;

  // link-side derived columns
  L.sb = new Uint8Array(nL);
  L.deliv = new Uint8Array(nL);
  L.pack8 = new Uint8Array(nL);
  L.coll = new Uint8Array(nL);
  const packColl = dims.packs.map(p => p.collection);
  const sus = dims.suspect, susSrc = dims.sources.findIndex(s => s.id === sus.source), platLimit = dims.platforms.map(p => p.limit ?? Infinity);
  for (let l = 0; l < nL; l++) {
    const s = L.size[l];
    let b;
    if (!s) b = 0;
    else if (s >= sus.tib || (L.src[l] === susSrc && s >= platLimit[E.platform[L.eo[l]]])) b = 6;   // a size no real copy could have
    else { b = 1; for (const e of SIZE_EDGES) if (s >= e) b++; }
    L.sb[l] = b;
    const p = L.pack[l];
    L.deliv[l] = p >= 0 ? 1 : 0;
    L.pack8[l] = p >= 0 ? p : 255;
    L.coll[l] = p >= 0 ? packColl[p] : 255;
    if ((l & 0x1FFFF) === 0x1FFFF) yield;
  }

  // entry-side derived columns
  const platBrand = dims.platforms.map(p => p.brand);
  const REGLUT = new Uint8Array(125);
  for (let c = 0; c < 125; c++) { let x = c, m = 0; while (x) { const r = x % 5 - 1; if (r >= 0) m |= 1 << r; x = Math.floor(x / 5); } REGLUT[c] = m || 16; }
  E.brand = new Uint8Array(nE);
  E.regBits = new Uint8Array(nE);
  E.smask = new Uint8Array(nE);
  E.nsrc = new Uint8Array(nE);
  E.rab = new Uint8Array(nE);
  E.nlb = new Uint8Array(nE);
  E.hasSer = new Uint8Array(nE);
  E.inGrp = new Uint8Array(nE);
  E.initial = new Uint8Array(nE);
  E.tkey = new Uint32Array(nE);
  E.sumSize = new Float64Array(nE);
  E.tl = new Array(nE);
  const tmap = new Map();
  for (let i = 0; i < nE; i++) {
    const t = E.title[i];
    E.brand[i] = platBrand[E.platform[i]];
    E.regBits[i] = REGLUT[E.reg[i]];
    let m = 0, sum = 0;
    for (let k = E.start[i]; k < E.start[i + 1]; k++) { m |= 1 << L.src[k]; const b = L.sb[k]; if (b >= 1 && b <= 5) sum += L.size[k]; }
    E.smask[i] = m;
    E.nsrc[i] = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
    E.sumSize[i] = sum;
    const n = E.ran[i];
    E.rab[i] = n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : n < 100 ? 4 : n < 250 ? 5 : 6;
    const nl = E.nl[i];
    E.nlb[i] = nl <= 1 ? 0 : nl >= 5 ? 4 : nl - 1;
    E.hasSer[i] = E.rom[i] !== '' ? 1 : 0;
    E.inGrp[i] = E.group[i] >= 0 ? 1 : 0;
    let k0 = 0; while (t.charCodeAt(k0) === 32) k0++;      // SQL trim() removes spaces only
    const c = t.charCodeAt(k0);
    E.initial[i] = c >= 65 && c <= 90 ? c - 63 : c >= 97 && c <= 122 ? c - 95 : c >= 48 && c <= 57 ? 1 : 0;
    const key = E.platform[i] + '|' + t;
    let v = tmap.get(key);
    if (v === undefined) { v = tmap.size; tmap.set(key, v); }
    E.tkey[i] = v;
    E.tl[i] = ASCII_ONLY.test(t) ? t.toLowerCase() : asciiLower(t);
    if ((i & 0x3FFF) === 0x3FFF) yield;
  }

  const D = { raw, dims, E, L, nTitles: tmap.size, meta: raw.meta, caps: raw.meta.caps, slugX, fixes };
  D.platformOf = i => dims.platforms[E.platform[i]];
  D.slugOf = i => slugX.get(i) ?? (slugifyAscii(E.title[i]) + '-' + dims.platforms[E.platform[i]].id + D.regIds(i).map(r => '-' + r).join(''));
  D.regIds = i => { const out = []; let c = E.reg[i]; while (c) { out.push(dims.regions[c % 5 - 1].id); c = Math.floor(c / 5); } return out; };
  D.flagLabels = i => { const out = []; const m = E.flags[i]; for (let b = 0; b < dims.flags.length; b++) if (m >> b & 1) out.push(dims.flags[b]); return out; };
  D.artUrl = i => {
    if (!E.art || !E.artk[i]) return null;
    return (E.artk[i] === 1 ? 'https://art.gametdb.com/' : 'https://thumbnails.libretro.com/') + E.art[i];
  };
  D.fixTitle = i => fixes.get(i) || null;
  D.titleShown = i => { const t = (fixes.get(i) || E.title[i]).replace(/^ +| +$/g, ''); return t || '(empty title)'; };
  D.srcDot = s => `<i class="sd" style="--c:var(--src-${s})"></i>`;
  D.comboSources = mask => dims.sources.map((_, s) => s).filter(s => mask >> s & 1);
  D.entryLinks = i => [E.start[i], E.start[i + 1]];
  D.groupOf = i => (E.group[i] >= 0 ? dims.groups[E.group[i]] : null);
  D.sameTitle = i => { const out = []; const k = E.tkey[i]; for (let j = Math.max(0, i - 40); j < Math.min(nE, i + 41); j++) if (E.tkey[j] === k) out.push(j); return out; };
  return D;
}

function prepare(raw) {
  const g = prepareSteps(raw);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** Title-case helpers for presenting dimension values. */
const sizeLabel = (D, b) => D.dims.sizes[b].label;
