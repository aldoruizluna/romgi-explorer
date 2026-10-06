/* ============================================================ the address bar: a slice, a view and an open card can all be linked */

/*
 * #browse?q=mario&f.plat=snes,gba&x.reg=jp&g=l&s=size&d=-1&m=gallery&c=super-mario-world-snes-us
 *
 * Filter values are ids and names, never positions, so a link keeps its meaning when the catalogue is rebuilt; a name that is gone is
 * skipped and the page says so. Plain links such as #overview keep working. Filters, the query and sorting rewrite the address in place;
 * changing view and opening a card add a history entry, so the back button closes a card and returns to the previous view.
 * Only the hosted site and the local server use this: the Artifact viewer passes plain #anchors through and nothing else.
 */
const Url = {
  enabled: false,
  boot: null,              // what the address asked for when the page loaded
  pending: null,           // the part that has to wait for the titles: { q, card }
  pushedCard: false,       // this page added the history entry the open card is in
  applying: false, lastApplied: null, timer: 0,

  init() { this.enabled = !!window.ROMGI.data || window.ROMGI.mode === 'local'; },

  /* ---------------------------------------------------------------- reading an address */
  parse(hash) {
    const body = String(hash || '').replace(/^#\/?/, ''), qi = body.indexOf('?');
    const out = { view: (qi < 0 ? body : body.slice(0, qi)).trim(), has: qi >= 0, g: null, q: null, card: null, f: {}, ui: {} };
    if (qi < 0) return out;
    const dec = t => { try { return decodeURIComponent(t); } catch { return null; } };
    const fac = id => out.f[id] || (out.f[id] = { inc: [], exc: [], mode: 'any' });
    for (const pair of body.slice(qi + 1).split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('='), key = eq < 0 ? pair : pair.slice(0, eq), val = eq < 0 ? '' : pair.slice(eq + 1);
      if (key === 'g') out.g = val === 'l' ? 'links' : 'entries';
      else if (key === 'q') out.q = dec(val) ?? '';
      else if (key === 'c') out.card = dec(val);
      else if (/^[fx]\.[a-z]+$/.test(key)) fac(key.slice(2))[key[0] === 'f' ? 'inc' : 'exc'].push(...val.split(',').map(dec));
      else if (/^fm\.[a-z]+$/.test(key)) fac(key.slice(3)).mode = val === 'all' ? 'all' : 'any';
      else if (/^[a-z]{1,3}$/.test(key)) out.ui[key] = dec(val);
    }
    return out;
  },

  /** Put a parsed address into the slicer and the interface. Returns how many parts of it this catalogue does not have. */
  apply(p) {
    const { S, D } = App, ui = App.ui;
    let bad = 0;
    const state = { grain: p.has ? (p.g || 'entries') : S.state.grain, q: '', f: {} };
    for (const [id, s] of Object.entries(p.f)) {
      const f = S.byId[id];
      if (!f) { bad++; continue; }
      const size = f.n + (f.noneExtra ? 1 : 0), conv = list => new Set(list.map(t => (t == null ? -1 : f.untok(t))).filter(v => { if (v >= 0 && v < size) return true; bad++; return false; }));
      const inc = conv(s.inc), exc = conv(s.exc);
      if (inc.size || exc.size) state.f[id] = { inc, exc, mode: s.mode };
    }
    if (p.q) { if (D.detailReady) state.q = p.q; else this.pending = { ...(this.pending || {}), q: p.q }; }
    S.state = state;
    // the interface: each key only takes a value this page knows how to show
    const u = p.ui, one = (v, list) => (list.includes(v) ? v : undefined), word = v => (/^[a-z]{1,14}$/.test(v || '') ? v : undefined);
    const num = (v, list) => (list.includes(+v) ? +v : undefined), set = (obj, k, v) => { if (v !== undefined) obj[k] = v; };
    set(ui.browse, 'sortKey', word(u.s)); set(ui.browse, 'dir', num(u.d, [1, -1])); set(ui.browse, 'mode', one(u.m, ['table', 'gallery']));
    set(ui.browse, 'galSort', word(u.gs)); set(ui.browse, 'density', one(u.dn, ['cozy', 'compact']));
    if (u.ao !== undefined) ui.browse.artOnly = u.ao !== '0';
    if (u.gr !== undefined) ui.browse.group = u.gr !== '0';
    const facetId = v => (v === 'all' || S.byId[v] ? v : undefined);
    set(ui.pivot, 'row', S.byId[u.pr] ? u.pr : undefined); set(ui.pivot, 'col', facetId(u.pc));
    set(ui.pivot, 'measure', one(u.pm, ['entries', 'links', 'bytes', 'avg', 'ra'])); set(ui.pivot, 'norm', one(u.pn, ['none', 'row', 'col', 'total', 'lift']));
    set(ui.pivot, 'top', num(u.pt, [0, 10, 20, 50])); set(ui.pivot, 'sort', one(u.ps, ['value', 'label', 'natural']));
    if (u.pz !== undefined) ui.pivot.totals = u.pz !== '0';
    set(ui, 'treemap', one(u.tm, ['entries', 'links', 'bytes'])); set(ui, 'stack', one(u.st, ['abs', 'pct']));
    if (p.card) this.pending = { ...(this.pending || {}), card: p.card };
    App.saveUI();
    return bad;
  },

  /* ---------------------------------------------------------------- writing one */
  encode() {
    const { S, D } = App, ui = App.ui, d = DEFAULT_UI, parts = [];
    const add = (k, v) => parts.push(`${k}=${encodeURIComponent(v)}`);
    if (S.state.grain === 'links') add('g', 'l');
    const q = S.state.q.trim() ? S.state.q : (this.pending && this.pending.q) || '';
    if (q) add('q', q);
    for (const f of S.facets) {
      const s = S.state.f[f.id];
      if (!s || !(s.inc.size || s.exc.size)) continue;
      const list = set => [...set].sort((a, b) => a - b).map(v => encodeURIComponent(f.tok(v))).join(',');
      if (s.inc.size) parts.push(`f.${f.id}=${list(s.inc)}`);
      if (s.exc.size) parts.push(`x.${f.id}=${list(s.exc)}`);
      if (s.mode && s.mode !== 'any') add(`fm.${f.id}`, s.mode);
    }
    const diff = (obj, base, key, name, fmt = v => v) => { if (obj[key] !== base[key]) add(name, fmt(obj[key])); };
    if (ui.view === 'browse') {
      diff(ui.browse, d.browse, 'sortKey', 's'); diff(ui.browse, d.browse, 'dir', 'd'); diff(ui.browse, d.browse, 'mode', 'm'); diff(ui.browse, d.browse, 'galSort', 'gs');
      diff(ui.browse, d.browse, 'density', 'dn'); diff(ui.browse, d.browse, 'artOnly', 'ao', v => (v ? '1' : '0')); diff(ui.browse, d.browse, 'group', 'gr', v => (v ? '1' : '0'));
    } else if (ui.view === 'dice') {
      for (const [k, name] of [['row', 'pr'], ['col', 'pc'], ['measure', 'pm'], ['norm', 'pn'], ['top', 'pt'], ['sort', 'ps']]) diff(ui.pivot, d.pivot, k, name);
      diff(ui.pivot, d.pivot, 'totals', 'pz', v => (v ? '1' : '0'));
    } else if (ui.view === 'overview') { diff(ui, d, 'treemap', 'tm'); diff(ui, d, 'stack', 'st'); }
    const card = App.sel != null && D.detailReady ? D.slugOf(App.sel) : (this.pending && this.pending.card) || '';
    if (card) add('c', card);
    return ui.view + (parts.length ? '?' + parts.join('&') : '');
  },

  /** Make the address say what the page shows. push adds a history entry (a new view, a card opening); otherwise the entry is rewritten. */
  sync(push = false) {
    if (!this.enabled || this.applying || !App.S) return;
    const h = '#' + this.encode();
    if (h === location.hash) return;
    this.lastApplied = h;
    try { (push ? history.pushState : history.replaceState).call(history, null, '', h); } catch { /* a sandboxed frame may refuse */ }
  },
  syncSoon() { clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(false), 200); },

  /* ---------------------------------------------------------------- following one */
  /** The address changed under us (back, forward, an edited hash, a link): show what it says. */
  fromLocation() {
    if (location.hash === this.lastApplied) return;
    this.lastApplied = location.hash;
    const p = this.parse(location.hash);
    if (!App.views[p.view]) return;
    this.applying = true;
    try {
      const bad = this.enabled ? this.apply(p) : 0;
      if (!p.card && App.sel != null) { Drawer.close({ quiet: true }); this.pushedCard = false; }
      App.ui.view = p.view; App.saveUI();
      if (bad) toast(__n(bad, 'One part of that link is not in this catalogue.|{n} parts of that link are not in this catalogue.'));
      $('#q').value = App.S.state.q || (this.pending && this.pending.q) || '';
      App.S.changed();                                   // counts again and schedules the redraw
      if (p.card && App.D.detailReady) this.openPendingCard();
    } finally { this.applying = false; }
  },

  /** The titles arrived: apply the query and open the card the address asked for. */
  afterDetail() {
    const pend = this.pending;
    if (!pend) return;
    this.pending = null;
    if (pend.q && !App.S.state.q) { App.S.state.q = pend.q; $('#q').value = pend.q; App.S.changed(); }
    if (pend.card) { this.pending = { card: pend.card }; this.openPendingCard(); }
  },

  async openPendingCard() {
    const slug = this.pending && this.pending.card, D = App.D;
    if (!slug) return;
    this.pending = null;
    let hit = -1;
    for (let i = 0; i < D.E.n && hit < 0; i++) {              // slugs are derived from titles, so there is no table to look in
      if (D.slugOf(i) === slug) hit = i;
      if ((i & 0x3FFF) === 0x3FFF) await yieldToMain();
    }
    if (hit < 0) { toast(__('That entry is not in this catalogue any more.')); this.sync(false); return; }
    Drawer.open(hit, { quiet: true });
  },
};
