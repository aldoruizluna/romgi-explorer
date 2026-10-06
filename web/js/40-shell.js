/* ============================================================ shell: facet rail, scope bar, tabs, routing, shortcuts */

const GROUPS = [{ id: 'catalog', label: 'Catalogue' }, { id: 'coverage', label: 'Coverage' }, { id: 'files', label: 'Files and links' }];
const TABS = [
  { id: 'overview', label: 'Overview', icon: 'overview', key: 'o' },
  { id: 'dice', label: 'Dice', icon: 'dice', key: 'd' },
  { id: 'browse', label: 'Browse', icon: 'table', key: 'b' },
  { id: 'sources', label: 'Sources', icon: 'layers', key: 's' },
  { id: 'schema', label: 'Schema', icon: 'db', key: 'm' },
  { id: 'quality', label: 'Quality', icon: 'shield', key: 'q' },
  { id: 'sql', label: 'SQL', icon: 'term', key: 'l' },
];
const DEFAULT_UI = {
  view: 'overview', open: ['brand', 'plat', 'src', 'reg'], showAll: [], find: {}, twin: [],
  browse: { mode: 'table', sortKey: 'title', dir: 1, density: 'cozy', artOnly: true, galSort: 'ra' },
  pivot: { row: 'plat', col: 'src', measure: 'links', norm: 'none', top: 20, sort: 'value', totals: true },
  treemap: 'entries', stack: 'abs', sqlpeek: false, schemaTable: 'entries', sqlText: '',
};

const App = {
  D: null, S: null, views: {}, sel: null, ui: structuredClone(DEFAULT_UI), _raf: 0,

  /* -------------------------------------------------------- boot */
  loadUI() {
    const saved = store.get('ui', {});
    for (const k of Object.keys(DEFAULT_UI)) if (saved[k] !== undefined) this.ui[k] = (DEFAULT_UI[k] && typeof DEFAULT_UI[k] === 'object' && !Array.isArray(DEFAULT_UI[k])) ? { ...DEFAULT_UI[k], ...saved[k] } : saved[k];
    const h = location.hash.replace('#', '');
    if (TABS.some(t => t.id === h)) this.ui.view = h;
    if (!TABS.some(t => t.id === this.ui.view)) this.ui.view = 'overview';
    this.ui.twin = []; this.ui.find = {};
  },
  saveUI: debounce(() => store.set('ui', App.ui), 250),
  mount() {
    const { D, S } = this;
    $('#roll-ic').innerHTML = icon('dice', 16);
    $('#help-ic').innerHTML = icon('help', 16);
    this.paintTheme();
    const q = $('#q');
    q.dataset.ph = q.placeholder;
    if (!D.detailReady) { q.disabled = true; q.placeholder = 'Loading titles…'; }
    $('#ver').innerHTML = `<i class="fd" id="fd" aria-hidden="true"></i>${esc(`${D.meta.version} · schema v${D.meta.schema_version ?? '?'}`)}`;
    S.onChange = () => this.schedule();
    S.state.grain = store.get('grain', 'entries') === 'links' ? 'links' : 'entries';
    S.changed();
    this.buildRail(); this.renderTabs(); this.bind();
    this.refresh();
  },
  /** The titles and sizes have arrived: wake the search box, drop the totals that were worked out without sizes, redraw, and only now fetch the covers. */
  detailReady() {
    const q = $('#q');
    q.disabled = false; q.placeholder = q.dataset.ph || q.placeholder;
    this.S.cache = {};
    this.renderView();
    loadArt();
  },
  /** Progress of the title download: the search placeholder and, in Browse, the bar. */
  detailProgress() {
    const s = this.detailState || {}, p = s.total ? Math.min(1, s.got / s.total) : 0, q = $('#q');
    if (q && q.disabled) q.placeholder = s.error ? 'Titles could not be loaded' : `Loading titles… ${Math.round(p * 100)}%`;
    const box = $('#detail-load');
    if (box) { $('.num', box).textContent = s.total ? `${(s.got / 1e6).toFixed(1)} of ${(s.total / 1e6).toFixed(1)} MB` : ''; $('.mt i', box).style.width = (p * 100).toFixed(1) + '%'; }
    if (s.error && !box && this.ui.view === 'browse') this.renderView();
  },
  /** The cover paths have arrived (or failed): redraw what shows covers. */
  artReady() {
    if (!this.D) return;
    if (this.ui.view === 'overview' || (this.ui.view === 'browse' && this.ui.browse.mode === 'gallery')) this.renderView();
    if (this.sel != null) Drawer.render();
  },
  aboutText() {
    const m = this.D.meta, day = s => (s || '').slice(0, 10), f = this.fresh, hosted = !!window.ROMGI.data, built = window.ROMGI.builtAt || m.built_at;
    const status = !f ? '' : f.state === 'current' ? ' It matches the latest catalogue romgi has published.'
      : f.state === 'held' ? ` romgi's newest catalogue (${esc(day(f.latest.generated_at))}) looks incomplete, so this site still shows this one and will switch when romgi publishes a complete one.`
      : ` romgi has since published the catalogue of ${esc(day(f.latest.generated_at))}.`;
    return `Catalogue of ${esc(day(m.generated_at))} (version ${esc(m.version)}) from <a href="${esc(m.source_repo)}" target="_blank" rel="noopener">romgi</a>, built ${esc(day(built))}.${status}${hosted ? ' This site checks romgi every three hours and rebuilds when there is something new.' : ''} <a href="https://github.com/aldoruizluna/romgi-explorer" target="_blank" rel="noopener">Source code</a> (MIT).`;
  },
  /** The dot beside the version: green when romgi has nothing newer, amber when it has. */
  paintFresh() {
    const f = this.fresh, fd = $('#fd'), v = $('#ver');
    if (!f || !fd) return;
    fd.dataset.s = f.state;
    const day = s => (s || '').slice(0, 10);
    v.dataset.tip = f.state === 'current' ? `Up to date with romgi's catalogue of ${day(this.D.meta.generated_at)}.`
      : f.state === 'held' ? `romgi's newest catalogue (${day(f.latest.generated_at)}) looks incomplete, so this site still shows the one of ${day(this.D.meta.generated_at)}.`
      : `romgi has published a newer catalogue (${day(f.latest.generated_at)}). This site rebuilds itself within a few hours.`;
    if ($('#modal').classList.contains('on')) this.help();
  },
  /** When romgi's newest catalogue was held back as unfinished (it had lost a source, say), the Overview says so. */
  heldHTML() {
    const L = window.ROMGI.latest;
    if (!L) return '';
    const day = s => (s || '').slice(0, 10);
    return `<div class="notice info" role="status">${icon('alert', 16)}<div><b>romgi's newest catalogue looks incomplete.</b> The one dated ${esc(day(L.generated_at))} has ${esc(L.reason)}. This explorer still shows the catalogue of ${esc(day(this.D.meta.generated_at))} and will switch when romgi publishes a complete one.</div></div>`;
  },
  paintTheme() { $('#theme-ic').innerHTML = icon(Theme.effective() === 'dark' ? 'sun' : 'moon', 16); },
  schedule() { if (this._raf) return; this._raf = requestAnimationFrame(() => { this._raf = 0; this.refresh(); }); },
  refresh() {
    this.updateRail(); this.renderScope(); this.renderTabs(); this.renderView();
    if (this.sel != null) Drawer.refresh();
  },

  /* -------------------------------------------------------- facet rail */
  buildRail() {
    let html = `<div class="rail-head"><h2>Slice</h2><span class="unit" id="unit"></span><button class="btn sm ghost" data-act="reset" id="rail-reset">${icon('reset', 13)}Reset</button></div>
      <div class="rail-note">Click to include. Alt-click to exclude. Every count follows the other filters.</div>`;
    for (const g of GROUPS) {
      html += `<div class="rail-group eyebrow">${esc(g.label)}</div>`;
      for (const f of this.S.facets.filter(x => x.group === g.id)) html += this.facetShell(f);
    }
    $('#rail').innerHTML = html;
  },
  facetShell(f) {
    const open = this.ui.open.includes(f.id);
    return `<div class="fg${open ? ' open' : ''}" data-fid="${f.id}">
      <button class="fg-h" data-act="fg" data-f="${f.id}" aria-expanded="${open}">${icon('chev-r', 14)}<span>${esc(f.label)}</span><span class="tail"></span></button>
      <div class="fg-b">
        ${f.modeToggle ? `<div class="fg-tools"><div class="seg" role="group" aria-label="Match mode"><button data-act="fmode" data-f="${f.id}" data-m="any">Any of</button><button data-act="fmode" data-f="${f.id}" data-m="all">All of</button></div></div>` : ''}
        ${f.search ? `<input class="input fg-find" data-find="${f.id}" placeholder="Find ${esc(f.label.toLowerCase())}" aria-label="Find in ${esc(f.label)}" autocomplete="off">` : ''}
        <div class="fg-list"></div>
      </div></div>`;
  },
  facetName(f, v) { return v >= f.n ? (f.noneExtra || '') : f.name(v); },
  updateRail() {
    const S = this.S;
    $('#unit').textContent = `counting ${S.state.grain}`;
    $('#rail-reset').hidden = !S.anyActive();
    for (const f of S.facets) {
      const fg = $(`.fg[data-fid="${f.id}"]`), st = S.state.f[f.id], n = st ? st.inc.size + st.exc.size : 0;
      $('.tail', fg).innerHTML = n ? `<span class="badge">${n}</span>` : (f.layout === 'alpha' || f.layout === 'sizes' ? '' : `<span class="hint">${f.skip0 ? Array.from(S.base[S.state.grain][f.id]).filter((c, v) => v !== 0 && c > 0).length : f.n + (f.noneExtra ? 1 : 0)}</span>`);
      if (f.modeToggle) $$('.fg-tools button', fg).forEach(b => b.setAttribute('aria-pressed', String((st?.mode || 'any') === b.dataset.m)));
      if (fg.classList.contains('open')) $('.fg-list', fg).innerHTML = this.facetList(f);
    }
  },
  facetList(f) {
    const S = this.S, D = this.D, st = S.state.f[f.id] || { inc: new Set(), exc: new Set() };
    const grain = S.state.grain, counts = S.counts(f.id), base = S.base[grain][f.id];
    const size = f.n + (f.noneExtra ? 1 : 0);
    const cls = v => `${st.inc.has(v) ? ' on' : ''}${st.exc.has(v) ? ' off' : ''}${counts[v] === 0 ? ' zero' : ''}`;
    if (f.layout === 'alpha') {
      const maxC = Math.max(1, ...Array.from(counts));
      const order = [...Array.from({ length: 26 }, (_, i) => i + 2), 1, 0];
      return `<div class="ini-grid">${order.map(v => `<button class="${cls(v).trim()}" style="--h:${((counts[v] / maxC) * 100).toFixed(0)}%" data-act="facet" data-f="ini" data-v="${v}" data-tk="${Tip.tk(() => tipBox(v === 0 ? 'Other first character' : v === 1 ? 'Starts with a digit' : 'Starts with ' + initialName(v), [[grain, fmtN(counts[v])]]))}">${esc(initialName(v))}</button>`).join('')}</div>`;
    }
    if (f.layout === 'sizes') {
      const maxC = Math.max(1, ...Array.from(counts));
      const short = ['Unk.', 'Cart', 'Small', 'CD', 'DVD', 'DVD+', 'Sus.'];
      const colour = v => (v === 0 ? 'var(--ink-4)' : v === 6 ? 'var(--serious)' : `var(--ord-${v})`);
      return `<div class="sizebars">${Array.from({ length: 7 }, (_, v) => `<button class="${cls(v).trim()}" data-act="facet" data-f="sz" data-v="${v}" data-tk="${Tip.tk(() => tipBox(D.dims.sizes[v].label, [['Range', D.dims.sizes[v].hint], [grain, fmtN(counts[v])]]))}">
        <span class="col" style="height:${Math.max(2, Math.round((counts[v] / maxC) * 44))}px;--c:${colour(v)}"></span><span>${short[v]}</span></button>`).join('')}</div>`;
    }
    let order = Array.from({ length: size }, (_, i) => i);
    if (f.skip0) order = order.filter(v => v !== 0 && base[v] > 0);
    if (!['reg', 'sz', 'nl', 'ra', 'art', 'ser', 'grp', 'deliv', 'coll'].includes(f.id)) order.sort((a, b) => base[b] - base[a] || a - b);
    const find = (this.ui.find[f.id] || '').toLowerCase();
    let list = order;
    if (find) list = order.filter(v => this.facetName(f, v).toLowerCase().includes(find) || (f.code && f.code(v).toLowerCase().includes(find)));
    const limit = 9, showAll = this.ui.showAll.includes(f.id), long = !find && list.length > limit + 2;
    let hidden = 0;
    if (long && !showAll) { const keep = new Set([...st.inc, ...st.exc]); const before = list.length; list = list.filter((v, i) => i < limit || keep.has(v)); hidden = before - list.length; }
    const maxC = Math.max(1, ...list.map(v => counts[v]));
    const rows = list.map(v => {
      const nm = this.facetName(f, v);
      let lead = '';
      if (f.id === 'plat') lead = `<span class="cp">${esc(f.code(v))}</span>`;
      else if (f.id === 'src') lead = D.srcDot(v);
      else if (f.layout === 'combo') lead = `<span class="combo-dots">${D.dims.sources.map((_, s) => `<i class="${v >> s & 1 ? 'on' : ''}" style="--c:${D.srcVar(s)}"></i>`).join('')}</span>`;
      const bar = f.id === 'src' ? `color-mix(in srgb, ${D.srcVar(v)} 24%, transparent)` : '';
      const tipTxt = f.fullName ? f.fullName(v) : f.hint && typeof f.hint === 'function' ? `${nm} (${f.hint(v)})` : nm;
      return `<button class="fr${cls(v)}" style="--w:${((counts[v] / maxC) * 100).toFixed(1)}%;${bar ? `--bar:${bar}` : ''}" data-act="facet" data-f="${f.id}" data-v="${v}" data-tip="${esc(tipTxt)}">
        <span class="tick">${st.exc.has(v) ? icon('minus', 11) : icon('check', 11)}</span><span class="lbl">${lead}<span>${esc(nm)}</span></span><span class="n">${fmtN(counts[v])}</span></button>`;
    }).join('');
    const more = long ? `<button class="facet-more" data-act="fmore" data-f="${f.id}">${showAll ? 'Show fewer' : `Show ${hidden} more`}</button>` : '';
    return rows + more + (list.length === 0 ? '<div class="muted" style="padding:8px">Nothing matches.</div>' : '');
  },

  /* -------------------------------------------------------- scope bar and tabs */
  renderScope() {
    const S = this.S, k = S.kpis(), b = S.baseK, g = S.state.grain;
    const chips = S.chips().map(c => `<span class="fchip${c.neg ? ' neg' : ''}"${c.full && c.full !== c.text ? ` title="${esc(c.full)}"` : ''}><span><b>${c.neg ? 'Not ' : ''}${esc(c.label)}</b> ${esc(c.text)}</span><button data-act="chip-x" data-k="${esc(c.key)}" aria-label="Remove filter">${icon('x', 12)}</button></span>`).join('');
    const peek = this.ui.sqlpeek ? this.sqlPeekHTML() : '';
    $('#scope').innerHTML = `
      <div class="seg" role="group" aria-label="Count by"><button data-act="grain" data-g="entries" aria-pressed="${g === 'entries'}">Entries</button><button data-act="grain" data-g="links" aria-pressed="${g === 'links'}">Links</button></div>
      <div class="count"><b class="num">${fmtN(g === 'entries' ? k.entries : k.links)}</b><span class="of num">of ${fmtN(g === 'entries' ? b.entries : b.links)}</span>
        <span class="muted">·</span><span class="of num">${fmtN(g === 'entries' ? k.links : k.entries)} ${g === 'entries' ? 'links' : 'entries'}</span></div>
      <span style="flex:1"></span>
      ${S.anyActive() ? `<button class="btn sm ghost" data-act="reset" data-tip="Remove every filter">${icon('reset', 13)}<span>Clear</span></button>` : ''}
      <button class="btn sm ghost" data-act="sqlpeek" aria-pressed="${this.ui.sqlpeek}" data-tip="Show the SQL behind this slice">${icon('code', 14)}<span>SQL</span></button>
      <div class="chips">${chips}</div>${peek}`;
  },
  sqlPeekHTML() {
    const q = this.S.sql();
    return `<div class="sqlpeek"><div class="codebox"><pre>${hiSQL(q.select)}</pre>
      <div class="copy" style="display:flex;gap:6px"><button class="btn sm" data-act="copy" data-text="${esc(q.select)}">${icon('copy', 13)}Copy</button>${this.sqlOK() ? `<button class="btn sm primary" data-act="to-sql" data-sql="${esc(q.select)}">${icon('term', 13)}Open in SQL</button>` : ''}</div></div>
      ${q.exact ? '' : `<div class="muted" style="margin-top:6px;font-size:12px">One filter has no exact SQL form, so this query is an approximation.</div>`}</div>`;
  },
  renderTabs() {
    const q = this.D.raw.quality.filter(c => ['serious', 'critical', 'warn'].includes(c.sev)).length;
    $('#tabs').innerHTML = TABS.map(t => `<button class="tab" role="tab" data-act="view" data-v="${t.id}" aria-selected="${this.ui.view === t.id}" data-tip="${esc(t.label)} (g then ${t.key})">${icon(t.icon, 15)}<span>${esc(t.label)}</span>${t.id === 'quality' ? `<span class="badge-n">${q}</span>` : ''}</button>`).join('');
  },
  show(view) {
    if (!this.views[view]) return;
    this.ui.view = view; this.saveUI();
    try { history.replaceState(null, '', '#' + view); } catch { /* sandboxed frames may refuse */ }
    this.renderTabs(); this.renderView();
    $('#stage').scrollTo({ top: 0 });
    $('#app').classList.remove('rail-open'); $('#scrim').classList.remove('on');
  },
  renderView() {
    Tip.reset(); Tip.hide();
    const v = this.views[this.ui.view], root = $('#view');
    try { v.render(root); if (v.after) v.after(root); }
    catch (e) { console.error(e); root.innerHTML = `<div class="card"><h3>This view failed to draw</h3><p class="muted">${esc(e.message)}</p></div>`; }
  },

  /* -------------------------------------------------------- actions */
  act(el, ev) {
    const S = this.S, d = el.dataset;
    switch (el.dataset.act) {
      case 'facet': S.toggle(d.f, +d.v, ev.altKey || ev.shiftKey || ev.metaKey); break;
      case 'facet2': { S.fs(d.f).inc = new Set([+d.v]); S.fs(d.f2).inc = new Set([+d.v2]); S.changed(); break; }
      case 'fg': {
        const fg = el.closest('.fg'), open = !fg.classList.contains('open');
        fg.classList.toggle('open', open); el.setAttribute('aria-expanded', String(open));
        this.ui.open = open ? [...new Set([...this.ui.open, d.f])] : this.ui.open.filter(x => x !== d.f);
        if (open) $('.fg-list', fg).innerHTML = this.facetList(S.byId[d.f]);
        this.saveUI(); break;
      }
      case 'fmode': S.setMode(d.f, d.m); break;
      case 'fmore': this.ui.showAll = this.ui.showAll.includes(d.f) ? this.ui.showAll.filter(x => x !== d.f) : [...this.ui.showAll, d.f]; this.updateRail(); break;
      case 'view': this.show(d.v); break;
      case 'grain': store.set('grain', d.g); S.setGrain(d.g); break;
      case 'twin': {
        const card = el.closest('.card'), on = !this.ui.twin.includes(d.id);
        this.ui.twin = on ? [...this.ui.twin, d.id] : this.ui.twin.filter(x => x !== d.id);
        $('.viz', card).hidden = on; $('.twin', card).hidden = !on; el.setAttribute('aria-pressed', String(on));
        if (!on && this.views[this.ui.view].after) this.views[this.ui.view].after($('#view'));
        break;
      }
      case 'chip-x': {
        if (d.k === 'q') { $('#q').value = ''; S.setQuery(''); }
        else if (d.k.endsWith(':x')) { S.fs(d.k.slice(0, -2)).exc = new Set(); S.changed(); }
        else { S.fs(d.k).inc = new Set(); S.changed(); }
        break;
      }
      case 'reset': $('#q').value = ''; S.clearAll(); break;
      case 'open': Drawer.open(+d.i); break;
      case 'close': Drawer.close(); break;
      case 'copy': copyText(d.text); break;
      case 'roll': this.roll(); break;
      case 'theme': Theme.toggle(); this.paintTheme(); this.refresh(); break;
      case 'help': this.help(); break;
      case 'rail': $('#app').classList.toggle('rail-open'); $('#scrim').classList.toggle('on', $('#app').classList.contains('rail-open')); break;
      case 'scrim': $('#app').classList.remove('rail-open'); $('#scrim').classList.remove('on'); Drawer.close(); break;
      case 'modal-bg': if (ev.target === el) el.classList.remove('on'); break;
      case 'sqlpeek': this.ui.sqlpeek = !this.ui.sqlpeek; this.saveUI(); this.renderScope(); break;
      case 'to-sql': this.ui.sqlText = d.sql; this._sqlAuto = this.D.caps.sql || Live.state === 'ready'; this.saveUI(); this.show('sql'); break;
      case 'preset': S.applyPreset(JSON.parse(d.preset)); if (d.go) this.show(d.go); break;
      default: { const h = this.handlers[el.dataset.act]; if (h) h(el, ev); }
    }
  },
  handlers: {},
  roll() {
    if (!this.D.detailReady) return toast('The titles are still loading.');
    const ids = this.S.visIdx('entries');
    if (!ids.length) return toast('Nothing in this slice to roll.');
    const el = $('#roll-ic'); el.firstElementChild.style.transition = 'rotate .5s cubic-bezier(.3,1.5,.5,1)'; el.firstElementChild.style.rotate = (Math.floor(Math.random() * 3) + 1) * 90 + 'deg';
    Drawer.open(ids[Math.floor(Math.random() * ids.length)]);
  },
  help() {
    const k = (...a) => a.map(x => `<span class="kbd">${esc(x)}</span>`).join(' ');
    $('#modal').innerHTML = `<div class="box" role="dialog" aria-label="Help"><h2>How slicing works</h2>
      <p class="muted" style="margin:6px 0 0">Every filter narrows entries and links together. Counts next to each value show what you would get if you added that value, given the other filters.</p>
      <dl class="keys">
        <dt>${k('Click')}</dt><dd>Include a value. Several values in one filter mean any of them.</dd>
        <dt>${k('Alt', 'Click')}</dt><dd>Exclude a value instead.</dd>
        <dt>${k('/')}</dt><dd>Search titles. Use -word to exclude and "quotes" for a phrase.</dd>
        <dt>${k('R')}</dt><dd>Roll the dice: open a random entry from the current slice.</dd>
        <dt>${k('g', 'o')} ${k('d')} ${k('b')} ${k('s')} ${k('m')} ${k('q')} ${k('l')}</dt><dd>Go to Overview, Dice, Browse, Sources, Schema, Quality, SQL.</dd>
        <dt>${k('T')}</dt><dd>Switch between dark and light.</dd>
        <dt>${k('Esc')}</dt><dd>Close the entry drawer or this panel.</dd>
      </dl>
      <p class="muted" style="margin:18px 0 0">Entries are releases (title, platform and region). Links are the files offered for them, so one entry can have several. Switch the count with the Entries and Links toggle above the tabs.</p>
      <h3 style="margin:18px 0 0;font-size:14px">About this data</h3>
      <p class="muted" style="margin:6px 0 0">${this.aboutText()}</p>
      <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn primary" data-act="close-modal">Close</button></div></div>`;
    $('#modal').classList.add('on');
  },

  /* -------------------------------------------------------- global events */
  bind() {
    const S = this.S;
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      if (el.dataset.act === 'close-modal') return $('#modal').classList.remove('on');
      this.act(el, e);
    });
    $('#q').addEventListener('input', debounce(e => { if (this.D.detailReady) S.setQuery(e.target.value); }, 140));
    $('#rail').addEventListener('input', e => {
      const id = e.target.dataset.find; if (!id) return;
      this.ui.find[id] = e.target.value;
      $('.fg-list', e.target.closest('.fg')).innerHTML = this.facetList(S.byId[id]);
    });
    let gPending = 0;
    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if (e.key === 'Escape') { if ($('#modal').classList.contains('on')) $('#modal').classList.remove('on'); else if (this.sel != null) Drawer.close(); else if (typing) e.target.blur(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
      if (e.key === '?') return this.help();
      if (e.key === 'r') return this.roll();
      if (e.key === 't') { Theme.toggle(); this.paintTheme(); return this.refresh(); }
      if (e.key === 'g') { gPending = Date.now(); return; }
      if (Date.now() - gPending < 1200) { const t = TABS.find(x => x.key === e.key); gPending = 0; if (t) this.show(t.id); }
      if (this.sel != null && (e.key === 'j' || e.key === 'ArrowDown')) { e.preventDefault(); Drawer.step(1); }
      if (this.sel != null && (e.key === 'k' || e.key === 'ArrowUp')) { e.preventDefault(); Drawer.step(-1); }
    });
    window.addEventListener('resize', debounce(() => this.renderView(), 180));
    new MutationObserver(() => { Color.reset(); this.paintTheme(); this.refresh(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { Color.reset(); this.paintTheme(); this.refresh(); });
    window.addEventListener('hashchange', () => { const h = location.hash.replace('#', ''); if (TABS.some(t => t.id === h) && h !== this.ui.view) this.show(h); });
  },
};

/* ------------------------------------------------------------ loader and boot */
const Loader = {
  n: 0, dl: false,
  phase(t) { const l = $('#loader'); if (!l) return; $('.phase', l).textContent = t; if (!this.dl) { $$('.px i', l).forEach((i, k) => i.classList.toggle('on', k <= this.n)); this.n = Math.min(7, this.n + 1); } },
  /** While the catalogue file downloads the eight squares are the progress bar. */
  progress(got, total) {
    const l = $('#loader'); if (!l) return;
    this.dl = true;
    const f = total ? Math.min(1, got / total) : 0, mb = x => (x / 1e6).toFixed(1);
    $$('.px i', l).forEach((i, k) => i.classList.toggle('on', k < Math.ceil(f * 8)));
    $('.phase', l).textContent = total ? `Downloading catalogue · ${mb(got)} of ${mb(total)} MB` : `Downloading catalogue · ${mb(got)} MB`;
  },
  done() { const l = $('#loader'); if (!l) return; $$('.px i', l).forEach(i => i.classList.add('on')); l.classList.add('done'); setTimeout(() => l.remove(), 450); },
  fail(e) { const l = $('#loader'); $('.inner', l).innerHTML = `<div class="word">romgi</div><div class="err"><b>The catalogue could not be loaded.</b><br>${esc(e.message || e)}</div>`; },
};
/** Resolves once the first frame has been presented (the paint entry exists), so nothing is requested before the loader's headline is on
 *  screen. Lighthouse counts a request that finishes before the largest paint as part of it, and a small file on a fast link can finish in
 *  the few milliseconds between its start and the paint. A background tab, where frames are paused, falls back to a timer. */
const afterFirstPaint = () => new Promise(done => {
  try {
    new PerformanceObserver((list, obs) => { if (list.getEntries().some(e => e.name === 'first-contentful-paint')) { obs.disconnect(); setTimeout(done, 0); } }).observe({ type: 'paint', buffered: true });
  } catch { requestAnimationFrame(() => setTimeout(done, 0)); }
  setTimeout(done, 600);
});
async function boot() {
  Theme.apply(); Tip.init(); App.loadUI();
  try {
    await afterFirstPaint();
    const raw = await loadDataset(t => Loader.phase(t));
    Loader.phase('Indexing titles and links'); await sleep(20);
    App.D = await runSliced(prepareSteps(raw));
    Loader.phase('Counting every facet'); await sleep(20);
    App.S = new Slicer(App.D, { defer: true });
    await runSliced(App.S.baseSteps());
    await runSliced(collectionSteps());
    App.mount();
    Loader.done();
    if (App.D.detailReady) loadArt(); else loadDetail();      // not awaited: the page already works; titles, then covers, follow
    checkFreshness();                // likewise: a dot beside the version
  } catch (e) { console.error(e); Loader.fail(e); }
}
window.__app = App;
