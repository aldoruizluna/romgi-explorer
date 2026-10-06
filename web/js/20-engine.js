/* ============================================================ engine: facets, crossfilter counts, aggregation, SQL */

const RA_NAMES = ['No achievements', '1 to 9', '10 to 24', '25 to 49', '50 to 99', '100 to 249', '250 or more'];
const RA_SQL = ['COALESCE(e.ra_num_achievements, 0) = 0', 'e.ra_num_achievements BETWEEN 1 AND 9', 'e.ra_num_achievements BETWEEN 10 AND 24',
  'e.ra_num_achievements BETWEEN 25 AND 49', 'e.ra_num_achievements BETWEEN 50 AND 99', 'e.ra_num_achievements BETWEEN 100 AND 249', 'e.ra_num_achievements >= 250'];
const NL_NAMES = ['1 link', '2 links', '3 links', '4 links', '5 or more'];
const NL_SQL = ['= 1', '= 2', '= 3', '= 4', '>= 5'];
const ART_NAMES = ['No box art', 'GameTDB', 'libretro'];
const ART_SQL = ["COALESCE(e.boxart_url, '') = ''", "COALESCE(e.boxart_url, '') LIKE 'https://art.gametdb.com/%'", "COALESCE(e.boxart_url, '') LIKE 'https://thumbnails.libretro.com/%'"];
const initialName = v => (v === 0 ? '#' : v === 1 ? '0-9' : String.fromCharCode(63 + v));

function makeFacets(D) {
  const { E, dims } = D;
  const regNames = [...dims.regions.map(r => r.name), 'No region'];
  const srcName = s => dims.sources[s].short;
  const comboName = m => D.comboSources(m).map(s => D.srcAbbr(s)).join(' + ');
  const comboFull = m => D.comboSources(m).map(srcName).join(' + ');
  const F = [];
  F.push({ id: 'brand', label: 'Brand', group: 'catalog', level: 'e', kind: 'single', n: dims.brands.length, col: E.brand, open: true,
    name: v => dims.brands[v], pred: v => `e.platform IN (SELECT id FROM platforms WHERE brand = ${sq(dims.brands[v])})` });
  F.push({ id: 'plat', label: 'Platform', group: 'catalog', level: 'e', kind: 'single', n: dims.platforms.length, col: E.platform, open: true, search: true,
    name: v => dims.platforms[v].name, code: v => dims.platforms[v].code, pred: v => `e.platform = ${sq(dims.platforms[v].id)}`,
    inSql: { expr: 'e.platform', lit: v => sq(dims.platforms[v].id) } });
  F.push({ id: 'reg', label: 'Region', group: 'catalog', level: 'e', kind: 'mask', n: 5, mask: E.regBits, open: true, name: v => regNames[v],
    pred: v => (v < 4 ? `e.slug IN (SELECT entry FROM regions_entries WHERE region = ${sq(dims.regions[v].id)})`
      : 'e.slug NOT IN (SELECT entry FROM regions_entries)') });
  F.push({ id: 'flag', label: 'Release flags', group: 'catalog', level: 'e', kind: 'mask', n: dims.flags.length, mask: E.flags, name: v => dims.flags[v].label,
    modeToggle: true, noneExtra: 'No flags', hint: 'Read from the tags in each title', search: true,
    pred: v => (v >= dims.flags.length ? 'NOT (' + dims.flags.filter(x => x.sql).map(x => x.sql).join(' OR ') + ')' : dims.flags[v].sql) });
  F.push({ id: 'ini', label: 'Starts with', group: 'catalog', level: 'e', kind: 'single', n: 28, col: E.initial, name: initialName, layout: 'alpha',
    pred: v => (v === 0 ? "NOT (upper(substr(trim(e.title), 1, 1)) BETWEEN 'A' AND 'Z' OR substr(trim(e.title), 1, 1) BETWEEN '0' AND '9')"
      : v === 1 ? "substr(trim(e.title), 1, 1) BETWEEN '0' AND '9'" : `upper(substr(trim(e.title), 1, 1)) = ${sq(initialName(v))}`) });
  F.push({ id: 'avail', label: 'Offered by', group: 'coverage', level: 'e', kind: 'single', n: 1 << dims.sources.length, col: E.smask, name: comboName, fullName: comboFull, layout: 'combo', skip0: true,
    hint: 'Which sources carry the entry, over all its links',
    pred: v => {
      const inn = D.comboSources(v), ids = inn.map(x => sq(dims.sources[x].id)).join(', ');
      const has = inn.map(x => `MAX(source_id = ${sq(dims.sources[x].id)}) = 1`);
      const only = inn.length < dims.sources.length ? [`MIN(source_id IN (${ids})) = 1`] : [];
      return `e.slug IN (SELECT entry FROM links GROUP BY entry HAVING ${[...has, ...only].join(' AND ')})`;
    } });
  F.push({ id: 'nl', label: 'Links per entry', group: 'coverage', level: 'e', kind: 'single', n: 5, col: E.nlb, name: v => NL_NAMES[v],
    pred: v => `e.slug IN (SELECT entry FROM links GROUP BY entry HAVING COUNT(*) ${NL_SQL[v]})` });
  F.push({ id: 'ra', label: 'RetroAchievements', group: 'coverage', level: 'e', kind: 'single', n: 7, col: E.rab, name: v => RA_NAMES[v], pred: v => RA_SQL[v] });
  F.push({ id: 'art', label: 'Box art', group: 'coverage', level: 'e', kind: 'single', n: 3, col: E.artk, name: v => ART_NAMES[v], pred: v => ART_SQL[v] });
  F.push({ id: 'ser', label: 'Serial in rom_id', group: 'coverage', level: 'e', kind: 'single', n: 2, col: E.hasSer, name: v => ['No serial', 'Has a serial'][v],
    pred: v => (v ? "COALESCE(e.rom_id, '') <> ''" : "COALESCE(e.rom_id, '') = ''") });
  F.push({ id: 'grp', label: 'Multi-disc set', group: 'coverage', level: 'e', kind: 'single', n: 2, col: E.inGrp, name: v => ['Standalone', 'Part of a set'][v],
    pred: v => `e.slug ${v ? '' : 'NOT '}IN (SELECT entry FROM entry_group_members)` });
  // ---- link level
  const L = D.L;
  F.push({ id: 'src', label: 'Source', group: 'files', level: 'l', kind: 'single', n: dims.sources.length, col: L.src, open: true, name: srcName, color: v => D.srcVar(v),
    pred: v => `l.source_id = ${sq(dims.sources[v].id)}`, inSql: { expr: 'l.source_id', lit: v => sq(dims.sources[v].id) } });
  F.push({ id: 'type', label: 'Link type', group: 'files', level: 'l', kind: 'single', n: dims.types.length, col: L.type, name: v => dims.types[v],
    pred: v => (dims.types[v] === 'Game (multi-part)' ? "l.type LIKE 'Game #%'" : `l.type = ${sq(dims.types[v])}`) });
  F.push({ id: 'fmt', label: 'Format', group: 'files', level: 'l', kind: 'single', n: dims.formats.length, col: L.fmt, search: true, name: v => dims.formats[v] || '(blank)',
    pred: v => `COALESCE(l.format, '') = ${sq(dims.formats[v])}`, inSql: { expr: "COALESCE(l.format, '')", lit: v => sq(dims.formats[v]) } });
  F.push({ id: 'deliv', label: 'Delivery', group: 'files', level: 'l', kind: 'single', n: 2, col: L.deliv, name: v => ['HTTP download', 'BitTorrent'][v],
    pred: v => `l.torrent_infohash IS ${v ? 'NOT ' : ''}NULL` });
  F.push({ id: 'coll', label: 'Torrent collection', group: 'files', level: 'l', kind: 'single', n: dims.collections.length, col: L.coll, name: v => dims.collections[v], noneExtra: 'Not a torrent',
    pred: v => (v >= dims.collections.length ? 'l.torrent_infohash IS NULL'
      : `COALESCE(l.torrent_infohash IN (SELECT infohash FROM torrents WHERE name LIKE ${sq('%Minerva_Myrient - ' + dims.collections[v] + '%')}), 0)`) });
  F.push({ id: 'pack', label: 'Torrent pack', group: 'files', level: 'l', kind: 'single', n: dims.packs.length, col: L.pack8, search: true, noneExtra: 'Not a torrent',
    name: v => dims.packs[v].label,
    pred: v => {
      if (v >= dims.packs.length) return 'l.torrent_infohash IS NULL';
      const p = dims.packs[v];       // the hosted build carries no infohashes, so it names the pack instead
      return p.infohash ? `COALESCE(l.torrent_infohash = ${sq(p.infohash)}, 0)` : `COALESCE(l.torrent_infohash IN (SELECT infohash FROM torrents WHERE name = ${sq(p.name)}), 0)`;
    } });
  F.push({ id: 'sz', label: 'Size class', group: 'files', level: 'l', kind: 'single', n: 7, col: L.sb, layout: 'sizes', name: v => dims.sizes[v].label,
    hint: v => dims.sizes[v].hint, pred: v => dims.sizes[v].sql });
  return F;
}

function parseQuery(q) {
  const out = [], re = /(-?)"([^"]*)"|(-?)(\S+)/g;
  let m;
  while ((m = re.exec(q))) {
    const neg = !!(m[1] || m[3]);
    const s = asciiLower((m[2] ?? m[4]) || '');
    if (s) out.push({ s, neg });
  }
  return out;
}
const likeEsc = s => s.replace(/[\\%_]/g, '\\$&');

class Slicer {
  /** defer: leave the base counts to baseSteps(), which a caller can run in slices; otherwise they are computed here. */
  constructor(D, { defer = false } = {}) {
    this.D = D; this.E = D.E; this.L = D.L;
    this.facets = makeFacets(D);
    this.byId = Object.fromEntries(this.facets.map(f => [f.id, f]));
    this.eF = this.facets.filter(f => f.level === 'e');
    this.lF = this.facets.filter(f => f.level === 'l');
    this.eF.forEach((f, i) => { f.bit = i; });
    this.lF.forEach((f, i) => { f.bit = i; });
    this.qBit = this.eF.length;
    this.state = { grain: 'entries', q: '', f: {} };
    this.version = 0;
    this.cache = {};
    this.base = {};
    if (!defer) { const g = this.baseSteps(); while (!g.next().done); }
  }
  /** Unfiltered counts per grain: the stable ordering for facet lists and the denominator for "of N". Yields between facets. */
  *baseSteps() {
    for (const grain of ['links', 'entries']) {
      this.state.grain = grain; this.recompute();
      const o = {};
      for (const f of this.facets) { o[f.id] = this.counts(f.id); yield; }
      this.base[grain] = o;
    }
    this.baseK = this.kpis();
  }

  /* ---------------------------------------------------------- state */
  fs(id) { return this.state.f[id] || (this.state.f[id] = { inc: new Set(), exc: new Set(), mode: 'any' }); }
  isOn(f) { const s = this.state.f[f.id]; return !!s && (s.inc.size > 0 || s.exc.size > 0); }
  anyActive() { return !!this.state.q.trim() || this.facets.some(f => this.isOn(f)); }
  activeCount() { return this.facets.filter(f => this.isOn(f)).length + (this.state.q.trim() ? 1 : 0); }
  toggle(id, v, exclude = false) {
    const s = this.fs(id), a = exclude ? s.exc : s.inc, b = exclude ? s.inc : s.exc;
    if (a.has(v)) a.delete(v); else { a.add(v); b.delete(v); }
    this.changed();
  }
  only(id, v) { const s = this.fs(id); s.inc = new Set([v]); s.exc = new Set(); this.changed(); }
  setMode(id, mode) { this.fs(id).mode = mode; this.changed(); }
  clear(id) { delete this.state.f[id]; this.changed(); }
  clearAll() { this.state.f = {}; this.state.q = ''; this.changed(); }
  setQuery(q) { this.state.q = q; this.changed(); }
  setGrain(g) { if (g === this.state.grain) return; this.state.grain = g; this.changed(); }
  /** preset: { grain?, q?, <facetId>: [values], exclude?: {<facetId>: [values]} } */
  /** The state a preset stands for. Flags may be named by id; grain defaults to the current one. */
  stateOf(p) {
    const st = { grain: p.grain || this.state.grain, q: p.q || '', f: {} };
    const fs = id => st.f[id] || (st.f[id] = { inc: new Set(), exc: new Set(), mode: 'any' });
    const idx = (k, x) => (k === 'flag' && typeof x === 'string' ? this.D.dims.flags.findIndex(f => f.id === x) : x);
    for (const [k, v] of Object.entries(p)) if (this.byId[k] && Array.isArray(v)) fs(k).inc = new Set(v.map(x => idx(k, x)));
    if (p.exclude) for (const [k, v] of Object.entries(p.exclude)) if (this.byId[k]) fs(k).exc = new Set(v);
    return st;
  }
  applyPreset(p) { Object.assign(this.state, this.stateOf(p)); this.changed(); }
  /** How many entries and links a preset shows, leaving the current slice alone. */
  countPreset(p) {
    const keep = { state: this.state, cache: this.cache };
    this.state = this.stateOf(p); this.cache = {};
    try { this.recompute(); return { entries: this.res.nVisE, links: this.res.nVisL }; }
    finally { this.state = keep.state; this.cache = keep.cache; this.recompute(); }
  }
  changed() { this.version++; this.cache = {}; this.recompute(); this.onChange && this.onChange(); }
  serialize() {
    const f = {};
    for (const x of this.facets) { const s = this.state.f[x.id]; if (s && (s.inc.size || s.exc.size)) f[x.id] = { i: [...s.inc], e: [...s.exc], m: s.mode }; }
    return { g: this.state.grain, q: this.state.q, f };
  }
  restore(o) {
    this.state = { grain: o.g === 'links' ? 'links' : 'entries', q: o.q || '', f: {} };
    for (const [id, s] of Object.entries(o.f || {})) if (this.byId[id]) this.state.f[id] = { inc: new Set(s.i), exc: new Set(s.e), mode: s.m || 'any' };
    this.changed();
  }

  /* ---------------------------------------------------------- compute: fail counters per row, then per-facet counts */
  applyFacet(f, s, fail, mask, n) {
    const bit = 1 << f.bit;
    if (f.kind === 'single') {
      const col = f.col;
      let inc = null, exc = null;
      if (s.inc.size) { inc = new Uint8Array(256); for (const v of s.inc) inc[v] = 1; }
      if (s.exc.size) { exc = new Uint8Array(256); for (const v of s.exc) exc[v] = 1; }
      // "none" is stored as 255 in the column but is facet value n: let the lookup see it as n
      if (f.noneExtra) { if (inc) inc[255] = inc[f.n]; if (exc) exc[255] = exc[f.n]; }
      for (let i = 0; i < n; i++) { const v = col[i]; if ((inc && !inc[v]) || (exc && exc[v])) { fail[i]++; mask[i] |= bit; } }
    } else {
      const m = f.mask;
      let incM = 0, excM = 0;
      for (const v of s.inc) incM |= 1 << v;
      for (const v of s.exc) excM |= 1 << v;
      const all = s.mode === 'all' && s.inc.size > 1;
      const noneBit = f.noneExtra ? 1 << f.n : 0;           // entries with no flag at all
      if (noneBit && (s.inc.has(f.n) || s.exc.has(f.n))) { /* handled below via noneBit */ }
      for (let i = 0; i < n; i++) {
        let x = m[i];
        if (noneBit && x === 0) x = noneBit;
        let ok = true;
        if (incM) ok = all ? (x & incM) === incM : (x & incM) !== 0;
        if (ok && excM && (x & excM) !== 0) ok = false;
        if (!ok) { fail[i]++; mask[i] |= bit; }
      }
    }
  }

  recompute() {
    const t0 = performance.now();
    const { E, L } = this, nE = E.n, nL = L.n;
    const failE = new Uint8Array(nE), maskE = new Uint32Array(nE);
    const failL = new Uint8Array(nL), maskL = new Uint16Array(nL);
    this.words = parseQuery(this.state.q);
    if (this.words.length) {
      const bit = 1 << this.qBit, tl = E.tl, W = this.words;
      for (let i = 0; i < nE; i++) {
        const t = tl[i];
        for (let k = 0; k < W.length; k++) if (t.includes(W[k].s) === W[k].neg) { failE[i]++; maskE[i] |= bit; break; }
      }
    }
    let linkActive = false;
    for (const f of this.eF) if (this.isOn(f)) this.applyFacet(f, this.state.f[f.id], failE, maskE, nE);
    for (const f of this.lF) if (this.isOn(f)) { linkActive = true; this.applyFacet(f, this.state.f[f.id], failL, maskL, nL); }
    let anyPass = null;
    const eo = L.eo;
    if (linkActive) { anyPass = new Uint8Array(nE); for (let l = 0; l < nL; l++) if (!failL[l]) anyPass[eo[l]] = 1; }
    let nVisE = 0, nVisL = 0;
    for (let i = 0; i < nE; i++) if (!failE[i] && (!linkActive || anyPass[i])) nVisE++;
    for (let l = 0; l < nL; l++) if (!failL[l] && !failE[eo[l]]) nVisL++;
    this.res = { failE, maskE, failL, maskL, anyPass, linkActive, nVisE, nVisL, counts: {} };
    this.ms = performance.now() - t0;
  }
  /** Facet counts are computed on first use, so collapsed groups cost nothing. */
  counts(id) { const c = this.res.counts; return c[id] || (c[id] = this.countFacet(this.byId[id])); }

  countFacet(f) {
    const { E, L, res } = this, grain = this.state.grain, n = f.n, extra = f.noneExtra ? 1 : 0;
    const counts = new Uint32Array(n + 1 + extra);
    const { failE, maskE, failL, maskL, anyPass, linkActive } = res;
    const bit = 1 << f.bit, eo = L.eo;
    if (f.level === 'e') {
      const col = f.col, mask = f.mask, single = f.kind === 'single';
      const add = i => {
        if (single) counts[col[i]]++;
        else { const m = mask[i]; if (m === 0 && extra) counts[n]++; else for (let b = 0; b < n; b++) if (m >> b & 1) counts[b]++; }
      };
      if (grain === 'entries') {
        for (let i = 0; i < E.n; i++) {
          const fe = failE[i];
          if (fe > 1 || (fe === 1 && maskE[i] !== bit)) continue;
          if (linkActive && !anyPass[i]) continue;
          add(i);
        }
      } else {
        for (let l = 0; l < L.n; l++) {
          if (failL[l]) continue;
          const i = eo[l], fe = failE[i];
          if (fe > 1 || (fe === 1 && maskE[i] !== bit)) continue;
          add(i);
        }
      }
    } else {
      const col = f.col;
      if (grain === 'links') {
        for (let l = 0; l < L.n; l++) {
          const fl = failL[l];
          if (fl > 1 || (fl === 1 && maskL[l] !== bit)) continue;
          if (failE[eo[l]]) continue;
          const v = col[l]; if (v < n) counts[v]++; else if (extra) counts[n]++;
        }
      } else {
        const last = new Int32Array(n + 1).fill(-1);
        for (let i = 0; i < E.n; i++) {
          if (failE[i]) continue;
          for (let l = E.start[i], end = E.start[i + 1]; l < end; l++) {
            const fl = failL[l];
            if (fl > 1 || (fl === 1 && maskL[l] !== bit)) continue;
            let v = col[l]; if (v >= n) { if (!extra) continue; v = n; }
            if (last[v] !== i) { last[v] = i; counts[v]++; }
          }
        }
      }
    }
    return counts;
  }

  /* ---------------------------------------------------------- visible rows */
  visIdx(grain) {
    const key = 'v' + grain;
    if (this.cache[key]) return this.cache[key];
    const { res, E, L } = this;
    let arr, k = 0;
    if (grain === 'entries') {
      arr = new Uint32Array(res.nVisE);
      for (let i = 0; i < E.n; i++) if (!res.failE[i] && (!res.linkActive || res.anyPass[i])) arr[k++] = i;
    } else {
      arr = new Uint32Array(res.nVisL);
      for (let l = 0; l < L.n; l++) if (!res.failL[l] && !res.failE[L.eo[l]]) arr[k++] = l;
    }
    return (this.cache[key] = arr);
  }
  sortValue(grain, key) {
    const { E, L } = this;
    if (grain === 'entries') {
      switch (key) {
        case 'platform': return i => E.platform[i];
        case 'links': return i => E.nl[i];
        case 'size': return i => E.sumSize[i];
        case 'ra': return i => E.ran[i];
        case 'sources': return i => E.nsrc[i];
        case 'region': return i => E.regBits[i];
        case 'serial': return i => E.rom[i];
        default: return null;
      }
    }
    switch (key) {
      case 'platform': return l => E.platform[L.eo[l]];
      case 'source': return l => L.src[l];
      case 'type': return l => L.type[l];
      case 'format': return l => L.fmt[l];
      case 'size': return l => (L.sb[l] === 6 ? -1 : L.size[l]);
      case 'pack': return l => L.pack[l];
      default: return null;
    }
  }
  sorted(grain, key, dir) {
    const ck = `s${grain}|${key}|${dir}`;
    if (this.cache[ck]) return this.cache[ck];
    const base = this.visIdx(grain);
    const val = this.sortValue(grain, key);
    let out;
    if (!val) out = dir > 0 ? base : Uint32Array.from(base).reverse();
    else {
      out = Uint32Array.from(base);
      out.sort((a, b) => { const x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : a - b; });
    }
    return (this.cache[ck] = out);
  }

  /* ---------------------------------------------------------- dimensions for charts and the pivot */
  dimOf(id) {
    if (!id || id === 'all') return { id: 'all', label: 'Everything', level: 'e', kind: 'single', n: 1, col: new Uint8Array(this.E.n), name: () => 'All' };
    const f = this.byId[id];
    return f;
  }
  dimSize(d) { return d.n + (d.noneExtra ? 1 : 0); }
  dimName(d, v) { return v >= d.n ? (d.noneExtra || '(none)') : d.name(v); }
  /** Per-link value of a single-valued dimension, as a flat array (cached; 255 means "no value"). */
  linkValues(d) {
    const D = this.D, cache = D._lv || (D._lv = {});
    if (cache[d.id]) return cache[d.id];
    const { E, L } = this, n = d.n, a = new Uint8Array(L.n);
    if (d.id === 'all') { /* all zeros */ }
    else if (d.level === 'l') for (let l = 0; l < L.n; l++) { const v = d.col[l]; a[l] = v < n ? v : d.noneExtra ? n : 255; }
    else for (let l = 0; l < L.n; l++) a[l] = d.col[L.eo[l]];
    return (cache[d.id] = a);
  }
  /** Push the dimension's values for one row into `out`. ctx 'e' = row is an entry, 'l' = row is a link. */
  vals(d, ctx, idx, out) {
    const { E, L, res } = this;
    out.length = 0;
    if (d.id === 'all') { out.push(0); return; }
    const n = d.n;
    if (ctx === 'e') {
      if (d.level === 'e') {
        if (d.kind === 'single') out.push(d.col[idx]);
        else { const m = d.mask[idx]; if (m === 0 && d.noneExtra) out.push(n); else for (let b = 0; b < n; b++) if (m >> b & 1) out.push(b); }
      } else {
        for (let l = E.start[idx], end = E.start[idx + 1]; l < end; l++) {
          if (res.failL[l]) continue;
          let v = d.col[l]; if (v >= n) { if (!d.noneExtra) continue; v = n; }
          if (!out.includes(v)) out.push(v);
        }
      }
    } else if (d.level === 'l') {
      let v = d.col[idx]; if (v >= n) { if (!d.noneExtra) return; v = n; } out.push(v);
    } else this.vals(d, 'e', L.eo[idx], out);
  }
  /** measure: entries | links | bytes | avg | ra */
  crosstab(rowId, colId, measure) {
    const ck = `x|${rowId}|${colId}|${measure}`;
    if (this.cache[ck]) return this.cache[ck];
    const { E, L, res } = this;
    const R = this.dimOf(rowId), C = this.dimOf(colId);
    const nr = this.dimSize(R), nc = this.dimSize(C);
    // The exact sizes arrive after the page starts. Until they do there is nothing to add up, and the empty answer is not cached.
    if ((measure === 'bytes' || measure === 'avg') && !L.size) return { R, C, nr, nc, cells: new Float64Array(nr * nc), measure };
    if (!this._noFast && colId == null && rowId && rowId !== 'all' && (measure === 'entries' || measure === 'links') && this.base[measure]?.[rowId] && !this.anyActive()) {
      // unfiltered: the facet's base count in this grain is the same tally, already computed
      return (this.cache[ck] = { R, C, nr, nc, cells: Float64Array.from(this.base[measure][rowId].slice(0, nr)), measure });
    }
    const cells = new Float64Array(nr * nc), cnt = measure === 'avg' ? new Float64Array(nr * nc) : null;
    const rv = [], cv = [];
    const entryMeasure = measure === 'entries' || measure === 'ra';
    const isSingle = d => d.id === 'all' || d.kind === 'single';
    if (entryMeasure && isSingle(R) && isSingle(C) && R.level === 'e' && C.level === 'e') {
      // fast path: entry measure over entry-level single-valued dimensions
      const rc = R.id === 'all' ? null : R.col, cc = C.id === 'all' ? null : C.col;
      for (let i = 0; i < E.n; i++) {
        if (res.failE[i] || (res.linkActive && !res.anyPass[i])) continue;
        cells[(rc ? rc[i] : 0) * nc + (cc ? cc[i] : 0)] += measure === 'ra' ? E.ran[i] : 1;
      }
    } else if (!entryMeasure && isSingle(R) && isSingle(C)) {
      // fast path: link measure over single-valued dimensions, read from flat per-link arrays
      const ra = this.linkValues(R), ca = this.linkValues(C), eo = L.eo, bytes = measure === 'bytes' || measure === 'avg';
      for (let l = 0; l < L.n; l++) {
        if (res.failL[l] || res.failE[eo[l]]) continue;
        const a = ra[l], b = ca[l]; if (a === 255 || b === 255) continue;
        let w = 1;
        if (bytes) { const sb = L.sb[l]; if (sb < 1 || sb > 5) { if (measure === 'avg') continue; w = 0; } else w = L.size[l]; }
        const k = a * nc + b; cells[k] += w; if (cnt) cnt[k]++;
      }
      if (cnt) for (let k = 0; k < cells.length; k++) cells[k] = cnt[k] ? cells[k] / cnt[k] : NaN;
    } else if (!this._noFast && entryMeasure && C.id === 'all' && (R.level === 'l' || R.kind === 'mask')) {
      // fast path: one dimension, each entry counted once per value it has (link-level values come from its links that pass)
      const n = R.n, none = R.noneExtra ? 1 : 0, col = R.col;
      const last = R.level === 'l' ? new Int32Array(nr).fill(-1) : null;
      for (let i = 0; i < E.n; i++) {
        if (res.failE[i] || (res.linkActive && !res.anyPass[i])) continue;
        const w = measure === 'ra' ? E.ran[i] : 1;
        if (last) {
          for (let l = E.start[i], end = E.start[i + 1]; l < end; l++) {
            if (res.failL[l]) continue;
            let v = col[l]; if (v >= n) { if (!none) continue; v = n; }
            if (last[v] !== i) { last[v] = i; cells[v] += w; }
          }
        } else {
          const m = R.mask[i];
          if (m === 0 && none) cells[n] += w; else for (let b = 0; b < n; b++) if (m >> b & 1) cells[b] += w;
        }
      }
    } else if (!this._noFast && !entryMeasure && measure !== 'avg' && C.id === 'all' && R.level === 'e' && R.kind === 'mask') {
      // fast path: links of entries that carry each bit of a multi-valued entry dimension
      const n = R.n, none = R.noneExtra ? 1 : 0, mask = R.mask, eo = L.eo, bytes = measure === 'bytes';
      for (let l = 0; l < L.n; l++) {
        if (res.failL[l] || res.failE[eo[l]]) continue;
        let w = 1;
        if (bytes) { const sb = L.sb[l]; w = sb >= 1 && sb <= 5 ? L.size[l] : 0; }
        const m = mask[eo[l]];
        if (m === 0 && none) cells[n] += w; else for (let b = 0; b < n; b++) if (m >> b & 1) cells[b] += w;
      }
    } else if (entryMeasure) {
      // Two link-level dimensions must pair values from the same link, then count each entry once per cell.
      const perLink = R.level === 'l' && C.level === 'l' && R.id !== 'all' && C.id !== 'all';
      const seen = [];
      for (let i = 0; i < E.n; i++) {
        if (res.failE[i] || (res.linkActive && !res.anyPass[i])) continue;
        const w = measure === 'ra' ? E.ran[i] : 1;
        if (perLink) {
          seen.length = 0;
          for (let l = E.start[i], end = E.start[i + 1]; l < end; l++) {
            if (res.failL[l]) continue;
            this.vals(R, 'l', l, rv); this.vals(C, 'l', l, cv);
            for (let a = 0; a < rv.length; a++) for (let b = 0; b < cv.length; b++) { const k = rv[a] * nc + cv[b]; if (!seen.includes(k)) { seen.push(k); cells[k] += w; } }
          }
        } else {
          this.vals(R, 'e', i, rv); this.vals(C, 'e', i, cv);
          for (let a = 0; a < rv.length; a++) for (let b = 0; b < cv.length; b++) cells[rv[a] * nc + cv[b]] += w;
        }
      }
    } else {
      for (let l = 0; l < L.n; l++) {
        if (res.failL[l] || res.failE[L.eo[l]]) continue;
        let w = 1;
        if (measure === 'bytes' || measure === 'avg') { const b = L.sb[l]; if (b < 1 || b > 5) { if (measure === 'avg') continue; w = 0; } else w = L.size[l]; }
        this.vals(R, 'l', l, rv); this.vals(C, 'l', l, cv);
        for (let a = 0; a < rv.length; a++) for (let b = 0; b < cv.length; b++) { const k = rv[a] * nc + cv[b]; cells[k] += w; if (cnt) cnt[k]++; }
      }
      if (cnt) for (let k = 0; k < cells.length; k++) cells[k] = cnt[k] ? cells[k] / cnt[k] : NaN;
    }
    return (this.cache[ck] = { R, C, nr, nc, cells, measure });
  }
  /** One dimension, one measure -> Float64Array(size). */
  groupBy(id, measure) { return this.crosstab(id, null, measure).cells; }
  pivot(rowId, colId, measure) {
    const x = this.crosstab(rowId, colId, measure);
    x.rowTot = this.crosstab(rowId, null, measure).cells;
    x.colTot = colId ? this.crosstab(null, colId, measure).cells : null;
    x.grand = this.crosstab(null, null, measure).cells[0];
    return x;
  }

  /* ---------------------------------------------------------- headline numbers for the current slice */
  kpis() {
    if (this.cache.k) return this.cache.k;
    const { E, L, res, D } = this;
    const seenT = new Uint8Array(D.nTitles), plats = new Uint8Array(D.dims.platforms.length), srcs = new Uint8Array(D.dims.sources.length);
    let titles = 0, ra = 0, ach = 0, art = 0, ser = 0, bytes = 0, susp = 0, withSize = 0;
    for (let i = 0; i < E.n; i++) {
      if (res.failE[i] || (res.linkActive && !res.anyPass[i])) continue;
      plats[E.platform[i]] = 1;
      if (!seenT[E.tkey[i]]) { seenT[E.tkey[i]] = 1; titles++; }
      if (E.ran[i]) { ra++; ach += E.ran[i]; }
      if (E.artk[i]) art++;
      if (E.hasSer[i]) ser++;
    }
    const size = L.size;           // null until the exact sizes have arrived: the totals are then left at 0 and the cache is dropped when they do
    for (let l = 0; l < L.n; l++) {
      if (res.failL[l] || res.failE[L.eo[l]]) continue;
      srcs[L.src[l]] = 1;
      const b = L.sb[l];
      if (b >= 1 && b <= 5) { if (size) bytes += size[l]; withSize++; } else if (b === 6) susp++;
    }
    const sum = a => a.reduce((x, y) => x + y, 0);
    return (this.cache.k = { entries: res.nVisE, links: res.nVisL, titles, platforms: sum(plats), sources: sum(srcs), ra, ach, art, ser, bytes, susp, withSize,
      perEntry: res.nVisE ? res.nVisL / res.nVisE : 0 });
  }

  /* ---------------------------------------------------------- SQL that reproduces the slice */
  conds(level) {
    const out = []; let exact = true;
    if (level === 'e' && this.words.length) {
      for (const w of this.words) out.push(`${w.neg ? 'NOT ' : ''}LOWER(e.title) LIKE ${sq('%' + likeEsc(w.s) + '%')} ESCAPE '\\'`);
    }
    for (const f of (level === 'e' ? this.eF : this.lF)) {
      const s = this.state.f[f.id];
      if (!s || !(s.inc.size || s.exc.size)) continue;
      const pr = v => { const p = f.pred(v); if (p == null) { exact = false; return `1 = 1 /* ${f.name(v)}: no SQL equivalent */`; } return p; };
      const orJoin = vals => {
        const vs = [...vals].sort((a, b) => a - b);
        if (f.inSql && vs.length > 1) return `${f.inSql.expr} IN (${vs.map(f.inSql.lit).join(', ')})`;
        return vs.length === 1 ? pr(vs[0]) : '(' + vs.map(pr).join(' OR ') + ')';
      };
      if (s.inc.size) {
        const vs = [...s.inc].sort((a, b) => a - b);
        out.push(f.kind === 'mask' && s.mode === 'all' && vs.length > 1 ? '(' + vs.map(pr).join(' AND ') + ')' : orJoin(s.inc));
      }
      if (s.exc.size) out.push('NOT ' + (s.exc.size > 1 || f.inSql ? `(${orJoin(s.exc)})` : `(${pr([...s.exc][0])})`));
    }
    return { out, exact };
  }
  sql(grain = this.state.grain) {
    const ce = this.conds('e'), cl = this.conds('l');
    const exact = ce.exact && cl.exact;
    const order = this.D.meta.sql_title_order || 'trim(e.title) COLLATE NOCASE';   // the order the table is stored in
    if (grain === 'entries') {
      const where = [...ce.out];
      if (cl.out.length) where.push(`e.slug IN (SELECT l.entry FROM links l\n    WHERE ${cl.out.join('\n      AND ')})`);
      const w = where.length ? '\nWHERE ' + where.join('\n  AND ') : '';
      return { exact, select: `SELECT e.slug, e.title, e.platform, e.rom_id\nFROM entries e${w}\nORDER BY ${order};`, count: `SELECT COUNT(*)\nFROM entries e${w};` };
    }
    const where = [...ce.out, ...cl.out];
    const w = where.length ? '\nWHERE ' + where.join('\n  AND ') : '';
    return { exact, select: `SELECT e.title, e.platform, l.source_id, l.type, l.format, l.size\nFROM links l JOIN entries e ON e.slug = l.entry${w}\nORDER BY ${order};`,
      count: `SELECT COUNT(*)\nFROM links l JOIN entries e ON e.slug = l.entry${w};` };
  }
  /** SQL for the pivot currently on screen. */
  pivotSql(rowId, colId, measure) {
    const D = this.D, dims = D.dims;
    const caseOf = (alias, arr) => `CASE\n${arr.map((p, i) => `    WHEN ${p} THEN ${sq(i)}`).join('\n')}\n  END`;
    const exprs = {
      plat: { sel: 'p.name', join: 'platforms' }, brand: { sel: 'p.brand', join: 'platforms' }, src: { sel: 'l.source_id' }, type: { sel: 'l.type' },
      fmt: { sel: "COALESCE(l.format, '')" }, deliv: { sel: "CASE WHEN l.torrent_infohash IS NULL THEN 'HTTP' ELSE 'BitTorrent' END" },
      sz: { sel: caseOf('l', dims.sizes.map(s => s.sql)) }, ra: { sel: caseOf('e', RA_SQL) }, art: { sel: caseOf('e', ART_SQL) },
      ser: { sel: "CASE WHEN COALESCE(e.rom_id, '') <> '' THEN 'Has a serial' ELSE 'No serial' END" },
      grp: { sel: "CASE WHEN e.slug IN (SELECT entry FROM entry_group_members) THEN 'Part of a set' ELSE 'Standalone' END" },
      reg: { sel: "COALESCE(x.region, 'none')", join: 'regions' },
    };
    const dim = id => (id && id !== 'all' ? exprs[id] : { sel: "'All'" });
    const r = dim(rowId), c = dim(colId);
    if (!r || !c) return { exact: false, text: '-- This combination has no single SQL expression (it needs a derived column).\n-- Use the SQL tab to build it by hand.' };
    const entryMeasure = measure === 'entries' || measure === 'ra';
    const needP = r.join === 'platforms' || c.join === 'platforms', needX = r.join === 'regions' || c.join === 'regions';
    const m = { entries: 'COUNT(DISTINCT e.slug)', links: 'COUNT(*)', bytes: 'SUM(l.size)', avg: 'AVG(l.size)', ra: 'SUM(e.ra_num_achievements)' }[measure];
    const sizeOk = (measure === 'bytes' || measure === 'avg') ? `l.size > 0 AND NOT ${dims.sizes[6].sql}` : null;
    const conds = [...this.conds('e').out, ...this.conds('l').out, sizeOk].filter(Boolean);
    const from = `FROM links l JOIN entries e ON e.slug = l.entry${needP ? '\nJOIN platforms p ON p.id = e.platform' : ''}${needX ? '\nLEFT JOIN regions_entries x ON x.entry = e.slug' : ''}`;
    const text = `SELECT ${r.sel} AS row_value,${colId ? `\n       ${c.sel} AS col_value,` : ''}\n       ${m} AS value\n${from}${conds.length ? '\nWHERE ' + conds.join('\n  AND ') : ''}\nGROUP BY 1${colId ? ', 2' : ''}\nORDER BY value DESC;`;
    return { exact: !(entryMeasure && false), text };
  }

  /* ---------------------------------------------------------- chips describing the active slice */
  chips() {
    const out = [];
    if (this.state.q.trim()) out.push({ key: 'q', label: 'Title', text: this.state.q.trim(), neg: false });
    for (const f of this.facets) {
      const s = this.state.f[f.id];
      if (!s) continue;
      const nm = v => (v >= f.n ? (f.noneExtra || '') : f.name(v));
      const short = (arr, j) => (arr.length > 3 ? `${arr.slice(0, 2).join(j)} and ${arr.length - 2} more` : arr.join(j));
      if (s.inc.size) {
        const vs = [...s.inc].sort((a, b) => a - b), arr = vs.map(nm), j = s.mode === 'all' ? ' and ' : ', ';
        const anyRa = f.id === 'ra' && vs.length === f.n - 1 && !s.inc.has(0);            // every class except "none"
        out.push({ key: f.id, label: f.label, text: anyRa ? 'any' : short(arr, j), full: arr.join(j), neg: false });
      }
      if (s.exc.size) { const arr = [...s.exc].sort((a, b) => a - b).map(nm); out.push({ key: f.id + ':x', facet: f.id, label: f.label, text: short(arr, ', '), full: arr.join(', '), neg: true }); }
    }
    return out;
  }
  /** Rows as TSV/CSV text for the current grain, up to `limit`. */
  exportRows(grain, sortKey, dir, limit, sep = ',') {
    const { D, E, L } = this, ids = this.sorted(grain, sortKey, dir), n = Math.min(limit, ids.length);
    const q = v => { v = String(v ?? ''); return sep === ',' ? (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v) : v.replace(/[\t\n]/g, ' '); };
    const lines = [];
    if (grain === 'entries') {
      lines.push(['slug', 'title', 'platform', 'regions', 'flags', 'links', 'sources', 'size_bytes_excl_suspect', 'ra_achievements', 'rom_id'].join(sep));
      for (let k = 0; k < n; k++) {
        const i = ids[k];
        lines.push([D.slugOf(i), E.title[i], D.platformOf(i).id, D.regIds(i).join('+'), D.flagLabels(i).map(f => f.id).join('+'), E.nl[i],
          D.comboSources(E.smask[i]).map(s => D.dims.sources[s].id).join('+'), E.sumSize[i], E.ran[i], E.rom[i]].map(q).join(sep));
      }
    } else {
      lines.push(['title', 'platform', 'source', 'type', 'format', 'size_bytes', 'size_class', 'pack', 'torrent_file_index'].join(sep));
      for (let k = 0; k < n; k++) {
        const l = ids[k], i = L.eo[l], p = L.pack[l];
        lines.push([E.title[i], D.platformOf(i).id, D.dims.sources[L.src[l]].id, D.dims.types[L.type[l]], D.dims.formats[L.fmt[l]], L.size[l], D.dims.sizes[L.sb[l]].label,
          p >= 0 ? D.dims.packs[p].label : '', L.tidx[l] >= 0 ? L.tidx[l] : ''].map(q).join(sep));
      }
    }
    return lines.join('\n') + '\n';
  }
}
