/* ============================================================ browse: virtual table, gallery */

const REG_CODE = { us: 'US', eu: 'EU', jp: 'JP', other: 'OTH' };
const regChips = ids => `<span class="rg">${ids.length ? ids.map(r => `<i>${REG_CODE[r] || esc(r)}</i>`).join('') : `<i class="none">${__('none')}</i>`}</span>`;
const flagTags = (labels, max = 3) => {
  const shown = labels.slice(0, max).map(f => `<span class="tg${f.id === 'moji' ? ' warn' : ''}">(${esc(f.label)})</span>`).join('');
  return shown + (labels.length > max ? `<span class="tg muted">+${labels.length - max}</span>` : '');
};
const sizeText = (v, suspect) => (suspect ? `<span class="tg warn" data-tip="${esc(__('Not a believable size for this platform'))}">${__('suspect')}</span>` : v ? fmtBytes(v) : `<span class="muted">${__('n/a')}</span>`);

const ENTRY_COLS = [
  { k: 'title', label: N_('Title'), w: 'minmax(230px, 2.4fr)', pri: 99, sort: 'title' },
  { k: 'platform', label: N_('Platform'), w: '86px', pri: 90, sort: 'platform' },
  { k: 'region', label: N_('Region'), w: '118px', pri: 70, sort: 'region' },
  { k: 'flags', label: N_('Flags'), w: 'minmax(130px, 1.3fr)', pri: 60 },
  { k: 'sources', label: N_('Sources'), w: '76px', pri: 50, sort: 'sources' },
  { k: 'links', label: N_('Links'), w: '54px', pri: 40, sort: 'links', r: 1 },
  { k: 'size', label: N_('Size'), w: '88px', pri: 55, sort: 'size', r: 1 },
  { k: 'ra', label: N_('Achv'), w: '66px', pri: 30, sort: 'ra', r: 1 },
  { k: 'serial', label: N_('Serial'), w: '118px', pri: 20, sort: 'serial' },
];
const LINK_COLS = [
  { k: 'title', label: N_('Title'), w: 'minmax(230px, 2.4fr)', pri: 99, sort: 'title' },
  { k: 'platform', label: N_('Platform'), w: '86px', pri: 90, sort: 'platform' },
  { k: 'source', label: N_('Source'), w: '140px', pri: 80, sort: 'source' },
  { k: 'type', label: N_('Type'), w: '110px', pri: 45, sort: 'type' },
  { k: 'format', label: N_('Format'), w: '86px', pri: 65, sort: 'format' },
  { k: 'size', label: N_('Size'), w: '96px', pri: 55, sort: 'size', r: 1 },
  { k: 'pack', label: N_('Torrent pack'), w: 'minmax(180px, 1.6fr)', pri: 35, sort: 'pack' },
  { k: 'idx', label: N_('File #'), w: '70px', pri: 10, r: 1 },
];

function entryCells(i) {
  const D = App.D, E = D.E, fixed = D.fixTitle(i);
  const flags = D.flagLabels(i);
  const src = D.comboSources(E.smask[i]).map(s => `<i class="sd" style="--c:${D.srcVar(s)}" data-tip="${esc(D.dims.sources[s].short)}"></i>`).join('');
  return {
    title: `<span class="title" data-tip="${esc(fixed ? __('Stored as: {title}', { title: E.title[i] }) : JSON.stringify(E.title[i]))}">${esc(D.titleShown(i))}</span>${fixed ? `<span class="tg warn" data-tip="${esc(__('The stored title is scrambled. Showing the repaired text.'))}">${__('repaired')}</span>` : ''}${editionsChip(i)}`,
    platform: `<span class="cp">${esc(D.platformOf(i).code)}</span>`,
    region: regChips(D.regIds(i)),
    flags: flagTags(flags.filter(f => f.id !== 'moji')),
    sources: `<span style="display:inline-flex;gap:5px">${src}</span>`,
    links: `<span class="num">${E.nl[i]}</span>`,
    size: `<span class="num">${E.sumSize[i] ? fmtBytes(E.sumSize[i]) : `<span class="muted">${__('n/a')}</span>`}</span>`,
    ra: E.ran[i] ? `<span class="ra">${icon('trophy', 12)}${E.ran[i]}</span>` : '<span class="muted">·</span>',
    serial: `<span class="mono muted">${esc(E.rom[i])}</span>`,
  };
}
function linkCells(l) {
  const D = App.D, E = D.E, L = D.L, i = L.eo[l], fixed = D.fixTitle(i), p = L.pack[l], s = L.src[l];
  return {
    title: `<span class="title">${esc(D.titleShown(i))}</span>`,
    platform: `<span class="cp">${esc(D.platformOf(i).code)}</span>`,
    source: `${D.srcDot(s)}<span>${esc(D.dims.sources[s].short)}</span>`,
    type: `<span>${esc(D.dims.typeNames[L.type[l]])}</span>`,
    format: `<span class="mono">${esc(D.dims.formats[L.fmt[l]] || __('(blank)'))}</span>`,
    size: `<span class="num">${sizeText(L.size[l], L.sb[l] === 6)}</span>`,
    pack: p >= 0 ? `<span class="muted" data-tip="${esc(D.dims.packs[p].label)}">${esc(D.dims.packs[p].label)}</span>` : `<span class="muted">${__('direct download')}</span>`,
    idx: `<span class="num muted">${L.tidx[l] >= 0 ? L.tidx[l] : ''}</span>`,
  };
}

/** One cover card, used by the gallery and the daily shelf. The placeholder stays underneath until the image has loaded. */
function galCardHTML(i) {
  const D = App.D, p = D.platformOf(i), url = D.caps.art ? D.artUrl(i) : null;
  return `<button class="gcard" data-act="open" data-i="${i}"><span class="art">${url ? `<img data-src="${esc(url)}" decoding="async" fetchpriority="low" referrerpolicy="no-referrer" alt="">` : ''}<span class="ph">${esc(p.code)}<small>${esc(D.regIds(i).map(r => REG_CODE[r]).join(' '))}</small></span></span>
    <span class="meta"><span class="t">${esc(D.titleShown(i))}</span><span class="s">${esc(p.code)} · ${esc(D.regIds(i).map(r => REG_CODE[r]).join(' ') || __('no region'))}${editionsChip(i)}</span><span class="row">${D.comboSources(D.E.smask[i]).map(s => `<i class="sd" style="--c:${D.srcVar(s)}"></i>`).join('')}${D.E.ran[i] ? `<span class="ra">${icon('trophy', 12)}${D.E.ran[i]}</span>` : ''}</span></span></button>`;
}
/** A cover starts downloading only when its card is within reach of the screen, a little sooner than the browser's own lazy loading,
 *  so a phone does not fetch a shelf it has not scrolled to. */
const Covers = {
  io: null,
  watch(root) {
    const imgs = $$('img[data-src]', root);
    if (!imgs.length) return;
    const start = img => { img.src = img.dataset.src; img.removeAttribute('data-src'); };
    if (!('IntersectionObserver' in window)) return imgs.forEach(start);
    this.io = this.io || new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { this.io.unobserve(e.target); start(e.target); } }, { rootMargin: '200px 0px' });
    imgs.forEach(img => this.io.observe(img));
  },
};
// covers fade in when they have loaded; one that fails leaves the placeholder showing (load and error do not bubble, so listen while capturing)
document.addEventListener('load', e => { if (e.target.tagName === 'IMG' && e.target.closest('.gcard .art')) e.target.classList.add('in'); }, true);
document.addEventListener('error', e => { if (e.target.tagName === 'IMG' && e.target.closest('.gcard .art')) e.target.remove(); }, true);
/** More pictures for an entry whose cover comes from libretro's thumbnails: the same path in the folder of title screens and of in-game
 *  screenshots. Not every game has them (a missing one just leaves its place empty), and one that failed once is not asked for again. */
const DEAD_PICS = new Set();
const picsOf = i => {
  const D = App.D, url = D.caps.art && D.E.artk[i] === 2 ? D.artUrl(i) : null;
  return url ? [['Named_Titles', N_('Title screen')], ['Named_Snaps', N_('In game')]].map(([dir, label]) => ({ url: url.replace('/Named_Boxarts/', '/' + dir + '/'), label })) : [];
};
const GAL_SORTS = { ra: ['ra', -1, N_('Most achievements')], title: ['title', 1, N_('A to Z')], sources: ['sources', -1, N_('Most sources')], size: ['size', -1, N_('Largest')] };
/** The entries the gallery shows: the slice, in the chosen order, optionally only those that have box art. */
function galleryIds() {
  const { S, D } = App, b = App.ui.browse, [key, dir] = GAL_SORTS[b.galSort] || GAL_SORTS.ra;
  const ids = S.sorted('entries', key, dir);
  return groupEditions(b.artOnly === false ? ids : ids.filter(i => D.E.artk[i] !== 0));
}
/** One entry per release family, in the order given: the best edition among those the slice shows. Off, or counting links, it is the list as it is. */
function groupEditions(ids) {
  const { D, S } = App, b = App.ui.browse;
  if (b.group === false || S.state.grain !== 'entries') return ids;
  const E = D.E, best = new Int32Array(D.nFam).fill(-1), score = new Float32Array(D.nFam);
  for (let k = 0; k < ids.length; k++) {
    const i = ids[k], f = E.fam[i], s = D.editionScore(i);
    if (best[f] < 0 || s > score[f]) { best[f] = i; score[f] = s; }
  }
  const out = new Uint32Array(ids.length);
  let n = 0;
  for (let k = 0; k < ids.length; k++) if (best[E.fam[ids[k]]] === ids[k]) out[n++] = ids[k];
  return out.subarray(0, n);
}
/** The "x3" beside a title that has other editions in the catalogue. */
const editionsChip = i => {
  const D = App.D, n = D.famSize(i);
  return n > 1 && App.ui.browse.group !== false ? `<span class="eds-chip" data-tip="${esc(__('{n} editions in the catalogue: regions, revisions, discs. Open it to see them.', { n }))}">×${n}</span>` : '';
};

const VT = { ids: null, rh: 40, cols: null, grain: 'entries', raf: 0 };
function vtPaint() {
  const sc = $('#vt-scroll'); if (!sc || !VT.ids) return;
  const body = $('.vt-body', sc), n = VT.ids.length, rh = VT.rh, top = Math.max(0, sc.scrollTop - 34);
  const first = Math.max(0, Math.floor(top / rh) - 8), last = Math.min(n, Math.ceil((top + sc.clientHeight) / rh) + 8);
  let out = '';
  for (let k = first; k < last; k++) {
    const id = VT.ids[k], ent = VT.grain === 'entries' ? id : App.D.L.eo[id];
    const c = VT.grain === 'entries' ? entryCells(id) : linkCells(id);
    out += `<div class="vt-row${App.sel === ent ? ' sel' : ''}" role="row" tabindex="0" style="top:${k * rh}px" data-act="open" data-i="${ent}">${VT.cols.map(col => `<div class="${col.r ? 'r' : ''}">${c[col.k]}</div>`).join('')}</div>`;
  }
  body.innerHTML = out;
}

/** What Browse shows while the titles are still on their way (or could not be fetched). */
const detailLoadingHTML = () => {
  const s = App.detailState || {}, p = s.total ? Math.min(1, s.got / s.total) : 0;
  if (s.error) return `<div class="vt-wrap"><div class="notice" style="margin:18px">${icon('alert', 16)}<div><b>${__('The titles and sizes could not be loaded.')}</b> ${esc(s.error)} <button class="btn sm" data-act="detailretry" style="margin-left:6px">${__('Try again')}</button></div></div></div>`;
  return `<div class="vt-wrap"><div class="meter" id="detail-load" style="margin:22px" role="status"><div class="mh"><span>${__('Loading titles and sizes')}</span><span class="num">${s.total ? __('{got} of {total} MB', { got: fmtD(s.got / 1e6), total: fmtD(s.total / 1e6) }) : ''}</span></div>
    <div class="mt" role="progressbar" aria-label="${esc(__('Title download'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"><i style="width:${(p * 100).toFixed(1)}%"></i></div></div>
    <p class="muted" style="margin:0 22px 22px">${__('The counts, charts and filters are ready; the titles and sizes follow in a moment.')}</p></div>`;
};

App.views.browse = {
  render(root) {
    if (!App.D.detailReady) { root.innerHTML = detailLoadingHTML(); return; }
    const { S, D } = App, g = S.state.grain, b = App.ui.browse;
    const minOf = c => parseInt((c.w.match(/\d+/) || [100])[0], 10) || 100;
    let cols = [...(g === 'entries' ? ENTRY_COLS : LINK_COLS)];
    const sortKey = cols.some(c => c.sort === b.sortKey) ? b.sortKey : 'title';
    const pri = c => (c.sort === sortKey ? 100 : c.pri);          // the column you sort by always stays visible
    const room = Math.max(320, root.clientWidth - 32);
    while (cols.length > 3 && cols.reduce((a, c) => a + minOf(c), 0) + cols.length * 10 + 28 > room) { const drop = cols.reduce((m, c) => (pri(c) < pri(m) ? c : m)); cols = cols.filter(c => c !== drop); }
    const ids = b.mode === 'gallery' && g === 'entries' ? galleryIds() : groupEditions(S.sorted(g, sortKey, b.dir));
    VT.ids = ids; VT.grain = g; VT.cols = cols; VT.rh = b.density === 'compact' ? 32 : 40;
    const minw = cols.reduce((a, c) => a + minOf(c), 0) + cols.length * 10 + 28;
    const head = cols.map(c => c.sort
      ? `<button class="${c.r ? 'r' : ''}" data-act="sort" data-k="${c.sort}" aria-label="${esc(__('Sort by {column}', { column: __(c.label) }))}">${esc(__(c.label))}${sortKey === c.sort ? icon(b.dir > 0 ? 'up' : 'down', 11) : ''}</button>`
      : `<span>${esc(__(c.label))}</span>`).join('');
    const canDl = D.caps.download;
    const unit = g === 'entries' && b.group !== false ? __('titles') : grainName(g), unitWord = ids.length ? unit : __('{unit} match', { unit });
    root.innerHTML = `<div class="vt-wrap">
      <div class="vt-bar">
        <div class="seg" role="group" aria-label="${esc(__('Layout'))}"><button data-act="bmode" data-m="table" aria-pressed="${b.mode === 'table'}">${icon('table', 14)}${__('Table')}</button><button data-act="bmode" data-m="gallery" aria-pressed="${b.mode === 'gallery'}" ${g === 'links' ? 'disabled' : ''}>${icon('grid', 14)}${__('Gallery')}</button></div>
        ${g === 'entries' ? `<label class="chk"><input type="checkbox" id="b-group"${b.group !== false ? ' checked' : ''}><span>${__('Group editions')}</span></label>` : ''}
        ${b.mode === 'gallery' ? `<label class="chk"><input type="checkbox" id="gal-art"${b.artOnly !== false ? ' checked' : ''}><span>${__('Box art only')}</span></label>
          <select id="gal-sort" aria-label="${esc(__('Sort the gallery'))}">${Object.entries(GAL_SORTS).map(([v, [, , l]]) => `<option value="${v}"${(b.galSort || 'ra') === v ? ' selected' : ''}>${esc(__(l))}</option>`).join('')}</select>` : ''}
        ${b.mode === 'table' ? `<div class="seg" role="group" aria-label="${esc(__('Density'))}"><button data-act="bdens" data-m="cozy" aria-pressed="${b.density !== 'compact'}">${__('Cozy')}</button><button data-act="bdens" data-m="compact" aria-pressed="${b.density === 'compact'}">${__('Compact')}</button></div>` : ''}
        <span class="muted"><span class="num">${fmtN(ids.length)}</span> ${unitWord}</span>
        <span class="sp"></span>
        <button class="btn sm" data-act="export" data-m="copy" data-tip="${esc(__('Copy up to 3,000 rows as tab-separated text'))}">${icon('copy', 13)}${__('Copy')}</button>
        ${canDl ? `<button class="btn sm" data-act="export" data-m="csv" data-tip="${esc(__('Save every row in this slice'))}">${icon('download', 13)}CSV</button>` : ''}
      </div>
      ${b.mode === 'table'
    ? (ids.length ? `<div class="vt-scroll" id="vt-scroll" style="--cols:${cols.map(c => c.w).join(' ')};--minw:${minw}px;--rh:${VT.rh}px"><div class="vt-head">${head}</div><div class="vt-body" style="height:${ids.length * VT.rh}px"></div></div>`
      : `<div class="vt-empty">${__('No rows match this slice.')}<br><button class="btn sm" style="margin-top:12px" data-act="reset">${__('Clear all filters')}</button></div>`)
    : `<div id="gal"></div>`}
    </div>`;
  },
  after(root) {
    if (!App.D.detailReady) return;
    const b = App.ui.browse;
    $('#b-group', root)?.addEventListener('change', e => { b.group = e.target.checked; App._galN = 0; App.saveUI(); App.renderView(); });
    if (b.mode === 'gallery') {
      $('#gal-art', root)?.addEventListener('change', e => { b.artOnly = e.target.checked; App._galN = 0; App.saveUI(); App.renderView(); });
      $('#gal-sort', root)?.addEventListener('change', e => { b.galSort = e.target.value; App._galN = 0; App.saveUI(); App.renderView(); });
      return this.gallery(root);
    }
    const sc = $('#vt-scroll', root); if (!sc) return;
    const bar = $('.vt-bar', root), head = $('.stage-head');
    sc.style.height = Math.max(340, innerHeight - 52 - head.offsetHeight - 32 - bar.offsetHeight - 4) + 'px';
    sc.addEventListener('scroll', () => { cancelAnimationFrame(VT.raf); VT.raf = raf(vtPaint); });
    sc.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.act === 'open') Drawer.open(+e.target.dataset.i); });
    vtPaint();
  },
  gallery(root, n = App._galN || 48) {
    const { D } = App, ids = galleryIds(), box = $('#gal', root);
    App._galN = n;
    const show = ids.length ? Array.from(ids.subarray(0, n)) : [];
    const note = D.caps.art ? '' : App.artState === 'loading' ? __('Loading box art…')
      : App.artState === 'failed' ? __('Box art could not be loaded, so covers are shown as placeholders.')
        : __('Box art is only shown when the explorer runs on your machine; this copy carries no image links.');
    box.innerHTML = `${note ? `<div class="notice info" style="margin:14px 14px 0">${icon('info', 16)}<div>${esc(note)}</div></div>` : ''}
      <div class="gal">${show.map(galCardHTML).join('') || `<div class="vt-empty" style="grid-column:1/-1">${__('Nothing in this slice has box art.')}</div>`}</div>${ids.length > n ? `<div style="padding:0 14px 16px"><button class="btn" data-act="galmore">${__('Show {n} more of {total}', { n: Math.min(48, ids.length - n), total: ids.length })}</button></div>` : ''}`;
    Covers.watch(box);
  },
};
Object.assign(App.handlers, {
  sort(el) { const b = App.ui.browse; if (b.sortKey === el.dataset.k) b.dir = -b.dir; else { b.sortKey = el.dataset.k; b.dir = 1; } App.saveUI(); App.renderView(); },
  bmode(el) { App.ui.browse.mode = el.dataset.m; App.saveUI(); App.renderView(); },
  bdens(el) { App.ui.browse.density = el.dataset.m; App.saveUI(); App.renderView(); },
  galmore() { App.views.browse.gallery($('#view'), (App._galN || 48) + 48); },
  dstep(el) { Drawer.step(+el.dataset.d); },
  detailretry() { loadDetail(); App.renderView(); },
  export(el) {
    const { S } = App, b = App.ui.browse, g = S.state.grain, key = (g === 'entries' ? ENTRY_COLS : LINK_COLS).some(c => c.sort === b.sortKey) ? b.sortKey : 'title';
    if (el.dataset.m === 'csv') { downloadText(`romgi-${g}-${App.D.meta.version}.csv`, S.exportRows(g, key, b.dir, 1e6, ',')); toast(__('CSV saved')); }
    else copyText(S.exportRows(g, key, b.dir, 3000, '\t'), __('Copied the first 3,000 rows as tab-separated text'));
  },
});

/* ============================================================ drawer: one entry, like a catalogue card */
const Drawer = {
  cache: new Map(),
  open(i, opts = {}) {
    if (!App.D.detailReady) return toast(__('The titles are still loading.'));
    const wasOpen = App.sel != null;
    App.sel = i;
    const el = $('#drawer'); el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
    if (innerWidth <= 1000) $('#scrim').classList.add('on');
    this.render();
    vtPaint();
    if (!opts.quiet && Url.enabled) { Url.sync(!wasOpen); if (!wasOpen) Url.pushedCard = true; }       // opening adds a history entry; stepping rewrites it
  },
  close(opts = {}) {
    App.sel = null;
    const el = $('#drawer'); el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
    if (!$('#app').classList.contains('rail-open')) $('#scrim').classList.remove('on');
    vtPaint();
    if (opts.quiet || !Url.enabled) return;
    if (Url.pushedCard) { Url.pushedCard = false; try { history.back(); return; } catch { /* fall through */ } }     // undo the entry opening the card made
    Url.sync(false);
  },
  refresh() { /* the card does not depend on the slice */ },
  /** Ask for the pictures when the card opens, never before; each appears where it arrives and the section only once there is one. */
  loadPics(i) {
    for (const fig of $$('#drawer figure[data-pic]')) {
      const url = fig.dataset.pic, img = $('img', fig);
      img.onload = () => { img.style.imageRendering = img.naturalWidth <= 320 ? 'pixelated' : 'auto'; fig.hidden = false; fig.closest('.pics').hidden = false; };
      img.onerror = () => { DEAD_PICS.add(url); };
      img.src = url;
    }
  },
  step(dir) {
    const ids = App.S.visIdx('entries'); if (!ids.length) return;
    let lo = 0, hi = ids.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ids[m] < App.sel) lo = m + 1; else hi = m; }
    let k = dir > 0 ? (ids[lo] === App.sel ? lo + 1 : lo) : lo - 1;
    k = clamp(k, 0, ids.length - 1);
    this.open(ids[k]);
  },
  async detail(i) {
    if (!App.D.caps.sql) return null;
    const slug = App.D.slugOf(i);
    if (this.cache.has(slug)) return this.cache.get(slug);
    try {
      const r = await fetch('/api/entry?slug=' + encodeURIComponent(slug));
      const j = r.ok ? await r.json() : null; this.cache.set(slug, j); return j;
    } catch { return null; }
  },
  render() {
    const i = App.sel, { D } = App, E = D.E, L = D.L, p = D.platformOf(i), slug = D.slugOf(i), fixed = D.fixTitle(i);
    const flags = D.flagLabels(i), regs = D.regIds(i), g = D.groupOf(i), [a, z] = D.entryLinks(i);
    const url = D.caps.art ? D.artUrl(i) : null;
    const eds = D.famMembers(i).filter(j => j !== i), pics = picsOf(i).filter(p => !DEAD_PICS.has(p.url));
    const edLabel = j => { const tags = (D.titleShown(j).match(/[\(\[][^\)\]]*[\)\]]/g) || []).join(' '); return tags || __('standard'); };
    const srcs = D.comboSources(E.smask[i]);
    const links = [];
    for (let l = a; l < z; l++) links.push(l);
    const lk = links.map(l => {
      const pk = L.pack[l], s = L.src[l];
      return `<div class="lk-row" data-l="${l}"><span>${D.srcDot(s)}</span><div class="main"><div class="l1"><b>${esc(D.dims.sources[s].short)}</b><span class="cp">${esc(D.dims.typeNames[L.type[l]])}</span><span class="cp">${esc(D.dims.formats[L.fmt[l]] || __('blank'))}</span></div>
        <div class="l2">${pk >= 0 ? esc(L.tidx[l] >= 0 ? __('torrent pack: {pack}, file #{n}', { pack: D.dims.packs[pk].label, n: String(L.tidx[l]) }) : __('torrent pack: {pack}', { pack: D.dims.packs[pk].label })) : __('direct download')}</div><div class="l2 more"></div></div>
        <div class="sz">${sizeText(L.size[l], L.sb[l] === 6)}</div></div>`;
    }).join('');
    const sqlEntry = `SELECT * FROM entries WHERE slug = ${sq(slug)};\n\nSELECT source_id, type, format, filename, size, torrent_infohash\nFROM links WHERE entry = ${sq(slug)};`;
    const art = `<div class="dr-art">${url ? `<img src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : ''}<div class="ph" ${url ? 'hidden' : ''}>${esc(p.code)}<small>${esc(regs.map(r => REG_CODE[r]).join(' '))}</small></div></div>`;
    $('#drawer').innerHTML = `<div class="dr-top">
        <span class="cp">${esc(p.code)}</span><span class="mono muted" style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(slug)}</span>
        <button class="btn sm ghost icon" data-act="copy" data-text="${esc(slug)}" aria-label="${esc(__('Copy slug'))}" data-tip="${esc(__('Copy slug'))}">${icon('copy', 14)}</button>
        ${Url.enabled ? `<button class="btn sm ghost icon" data-act="copylink" aria-label="${esc(__('Copy a link to this entry'))}" data-tip="${esc(__('Copy link'))}">${icon('link', 14)}</button>` : ''}
        <span class="sp"></span>
        <button class="btn sm ghost icon" data-act="dstep" data-d="-1" aria-label="${esc(__('Previous entry'))}" data-tip="${esc(__('Previous (K)'))}">${icon('chev-u', 14)}</button>
        <button class="btn sm ghost icon" data-act="dstep" data-d="1" aria-label="${esc(__('Next entry'))}" data-tip="${esc(__('Next (J)'))}">${icon('chev-d', 14)}</button>
        <button class="btn sm ghost icon" data-act="close" aria-label="${esc(__('Close'))}" data-tip="${esc(__('Close (Esc)'))}">${icon('x', 15)}</button></div>
      <div class="dr-body">
        <div class="dr-hero">${art}<div><h2 class="dr-title">${esc(D.titleShown(i))}</h2>
          <div class="dr-badges">${regChips(regs)}${E.ran[i] ? `<span class="ra">${icon('trophy', 13)}${esc(__n(E.ran[i], '{n} achievement|{n} achievements'))}</span>` : ''}${g ? `<span class="pill info">${icon('disc', 12)}${esc(__('{disc} of {total}', { disc: g.members.find(m => m[0] === i)?.[1] || __('Disc'), total: g.members.length }))}</span>` : ''}</div>
          ${flags.length ? `<div style="margin-top:10px">${flagTags(flags.filter(f => f.id !== 'moji'), 8)}</div>` : ''}</div></div>
        ${!fixed && E.title[i] !== E.title[i].replace(/^ +| +$/g, '') ? `<div class="notice info">${icon('info', 16)}<div>${__h('<b>Stray spaces.</b> The stored title is {title}. The explorer trims it for display and sorting.', { title: raw(`<span class="mono">${esc(JSON.stringify(E.title[i]))}</span>`) })}</div></div>` : ''}
        ${fixed ? `<div class="notice">${icon('alert', 16)}<div>${__h('<b>Scrambled title.</b> It is stored as {title}. UTF-8 text was read as Latin-1; the text above is the repaired version.', { title: raw(`<span class="mono">${esc(E.title[i])}</span>`) })}</div></div>` : ''}
        <dl class="facts">
          <div><dt>${__('Platform')}</dt><dd>${esc(p.name)}<br><span class="muted">${esc(D.dims.brands[p.brand])}</span></dd></div>
          <div><dt>${__('Serial (rom_id)')}</dt><dd class="mono">${esc(E.rom[i]) || `<span class="muted">${__('none')}</span>`}</dd></div>
          <div><dt>${__('Offered by')}</dt><dd>${srcs.map(s => `<div style="display:flex;gap:7px;align-items:center">${D.srcDot(s)}${esc(D.dims.sources[s].short)}</div>`).join('')}</dd></div>
          <div><dt>${__('Indexed size')}</dt><dd class="num">${E.sumSize[i] ? fmtBytes(E.sumSize[i]) : `<span class="muted">${__('n/a')}</span>`}<br><span class="muted">${esc(__n(E.nl[i], '{n} link, suspect sizes left out|{n} links, suspect sizes left out'))}</span></dd></div>
          ${E.ra[i] ? `<div><dt>RetroAchievements</dt><dd><a href="https://retroachievements.org/game/${E.ra[i]}" target="_blank" rel="noopener">${esc(__('Game {id}', { id: String(E.ra[i]) }))} ${icon('ext', 12)}</a><br><span class="muted">${esc(__n(E.ran[i], '{n} achievement|{n} achievements'))}</span></dd></div>` : ''}
          <div><dt>${__('Box art')}</dt><dd>${[__('None matched'), 'GameTDB', 'libretro'][E.artk[i]]}</dd></div>
        </dl>
        ${pics.length ? `<section class="pics" hidden><h3 class="sec-h">${icon('image', 14)}${__('Pictures')}</h3><div class="pic-row">${pics.map(p => `<figure hidden data-pic="${esc(p.url)}"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><img alt="${esc(__('{label}: {title}', { label: __(p.label), title: D.titleShown(i) }))}" referrerpolicy="no-referrer" decoding="async"></a><figcaption>${esc(__(p.label))}</figcaption></figure>`).join('')}</div></section>` : ''}
        <section><h3 class="sec-h">${icon('link', 14)}${__('Links')}<span class="eyebrow">${esc(__('{n} in the catalogue', { n: links.length }))}</span></h3><div class="lk">${lk}</div>
          ${D.caps.sql ? '' : `<div class="notice info" style="margin-top:10px">${icon('info', 16)}<div>${__('File names, URLs and raw rows appear when the explorer runs locally against the database.')}</div></div>`}</section>
        ${g ? `<section><h3 class="sec-h">${icon('disc', 14)}${__('Disc set')}<span class="eyebrow">${esc(g.title)}</span></h3><div class="sib">${g.members.map(([j, lab]) => `<button class="${j === i ? 'cur' : ''}" data-act="open" data-i="${j}">${esc(lab)}</button>`).join('')}</div></section>` : ''}
        ${eds.length ? `<section><h3 class="sec-h">${icon('layers', 14)}${__('Other editions')}<span class="eyebrow">${eds.length}</span></h3><div class="eds">${eds.map(j => `<button class="ed" data-act="open" data-i="${j}">${regChips(D.regIds(j))}<span class="ed-t">${esc(edLabel(j))}</span><span class="ed-s">${D.comboSources(E.smask[j]).map(s => `<i class="sd" style="--c:${D.srcVar(s)}"></i>`).join('')}</span><span class="num ed-z">${E.sumSize[j] ? fmtBytes(E.sumSize[j]) : '·'}</span></button>`).join('')}</div></section>` : ''}
        <section><h3 class="sec-h">${icon('code', 14)}${__('This entry in SQL')}</h3><div class="codebox"><pre>${hiSQL(sqlEntry)}</pre><div class="copy"><button class="btn sm" data-act="copy" data-text="${esc(sqlEntry)}">${icon('copy', 13)}${__('Copy')}</button></div></div></section>
        <section class="raw" hidden><h3 class="sec-h">${icon('db', 14)}${__('Raw rows')}</h3><div class="codebox"><pre></pre></div></section>
      </div>`;
    this.loadPics(i);
    const img = $('.dr-art img'); if (img) { img.addEventListener('error', () => { img.remove(); $('.dr-art .ph').hidden = false; }); }
    this.detail(i).then(d => {
      if (!d || App.sel !== i) return;
      const rows = $$('#drawer .lk-row');
      d.links.forEach((r, k) => { const row = rows[k]; if (row) $('.more', row).innerHTML = `${esc(r.filename || '')}<br><span class="muted">${esc(r.host || '')}${r.requires_auth ? __(' · login required') : ''}</span>`; });
      const raw = $('#drawer .raw'); raw.hidden = false; $('pre', raw).textContent = JSON.stringify({ entry: d.entry, regions: d.regions, links: d.links }, null, 2);
    });
  },
};
