/* ============================================================ overview */

/** Values of one dimension under the current slice, as sorted bar items. */
function itemsFor(id, measure, { top = 99, sort = true, hideNone = false, keepZero = false } = {}) {
  const S = App.S, f = S.byId[id], vals = S.groupBy(id, measure);
  let items = [];
  for (let v = 0; v < vals.length; v++) { if (hideNone && v >= f.n) continue; items.push({ v, label: App.facetName(f, v), value: vals[v] }); }
  if (!keepZero) items = items.filter(i => i.value > 0);
  if (sort) items.sort((a, b) => b.value - a.value || a.v - b.v);
  return items.slice(0, top);
}
const selectedOf = id => { const s = App.S.state.f[id]; return s && s.inc.size ? s.inc : null; };
const unitName = () => (App.S.state.grain === 'entries' ? 'entries' : 'links');
const measureOf = () => (App.S.state.grain === 'entries' ? 'entries' : 'links');
const hint = '<br>';
/** The treemap's measure. Size adds up exact sizes, which arrive with the titles; links until then. */
const treemapMeasure = () => (App.ui.treemap === 'bytes' && !App.D.detailReady ? 'links' : App.ui.treemap);

function simpleBars(id, title, sub, opt = {}) {
  const S = App.S, m = opt.measure || measureOf(), items = itemsFor(id, m, opt);
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const sel = selectedOf(id);
  const tipFor = i => tipBox(i.label, [[opt.unit || unitName(), fmtN(i.value)], ['Share of shown', pct(i.value, total)]], 'Click to include. Alt-click to exclude.');
  const body = items.length ? hbarHTML(items, { facet: id, selected: sel, tipFor, labelDot: opt.dot }) : '<div class="vt-empty">Nothing in this slice.</div>';
  const twin = twinHTML([{ label: S.byId[id].label }, { label: opt.unit || unitName(), right: true }, { label: 'Share', right: true }], items.map(i => [i.label, fmtN(i.value), pct(i.value, total)]));
  return chartCard({ id: 'bars-' + id, cls: opt.cls || 's4', title, sub, body, twin });
}

/** The "Indexed size" tile: a loading mark until the exact sizes have arrived. */
const sizeTile = (k, D) => {
  const t = (v, s) => `<div class="card kpi" id="kpi-size"><div class="l">${icon('db', 14)}Indexed size</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  return D.detailReady ? t(k.bytes ? fmtBytes(k.bytes) : '0 B', k.susp ? `${fmtN(k.susp)} suspect sizes left out` : 'every size counted')
    : t('<span class="muted" role="status" aria-label="Loading">…</span>', k.susp ? `${fmtN(k.susp)} suspect sizes left out` : 'arriving with the titles');
};

App.views.overview = {
  /** The exact sizes arrived: fill in the size tile and unlock the Size toggle without redrawing the whole overview. */
  patchDetail() {
    const el = $('#kpi-size');
    if (!el) return App.renderView();
    el.outerHTML = sizeTile(App.S.kpis(), App.D);
    const btn = $('[data-act="tm"][data-m="bytes"]');
    if (btn) { btn.disabled = false; btn.removeAttribute('data-tip'); }
    if (App.ui.treemap === 'bytes') App.renderView();                     // the chart itself changes what it measures
  },
  /** Titles and cover paths are in: the daily shelf appears where its slot is, and only its covers start loading. */
  fillPicks() {
    const slot = $('#picks-slot');
    if (!slot) { if (!App.S.anyActive()) App.renderView(); return; }
    slot.innerHTML = picksHTML();
    Covers.watch(slot);
  },
  render(root) {
    const { S, D } = App, k = S.kpis(), b = S.baseK, g = S.state.grain, dims = D.dims;
    const inView = g === 'entries' ? k.entries : k.links, inBase = g === 'entries' ? b.entries : b.links;
    const hero = `<section class="card hero s4 hero-col">
      <div><div class="eyebrow">In this slice</div><div class="big num-prop">${fmtN(inView)}</div>
        <p class="lead">${g === 'entries' ? 'releases' : 'links'} across ${plural(k.platforms, 'platform')}${g === 'entries' ? `, offered through ${fmtN(k.links)} links` : ` for ${fmtN(k.entries)} entries`} from ${plural(k.sources, 'source')}.</p></div>
      <div><div class="track" role="img" aria-label="${pct(inView, inBase)} of the catalogue"><i style="width:${((100 * inView) / inBase).toFixed(2)}%"></i></div>
        <div class="foot"><span>${pct(inView, inBase)} of the catalogue</span><span class="mono">snapshot ${esc(D.meta.version)}</span></div></div></section>`;
    const tile = (l, v, s, ic) => `<div class="card kpi"><div class="l">${icon(ic, 14)}${esc(l)}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    const kp = `<div class="s8 kpis">
      ${tile('Links', fmtN(k.links), `of ${fmtN(b.links)}`, 'link')}
      ${tile('Platforms', fmtN(k.platforms), `of ${fmtN(dims.platforms.length)}`, 'grid')}
      ${tile('Games', fmtN(k.games), `of ${fmtN(b.games)} · regions and revisions count once, add-ons not at all`, 'tag')}
      ${tile('Links per entry', k.perEntry.toFixed(2), `catalogue ${b.perEntry.toFixed(2)}`, 'layers')}
      ${sizeTile(k, D)}
      ${tile('With achievements', fmtN(k.ra), `${fmtN(k.ach)} in total`, 'trophy')}</div>`;

    // treemap
    const tm = treemapMeasure();
    const tmVals = S.groupBy('plat', tm);
    const tmTotal = tmVals.reduce((a, c) => a + c, 0) || 1;
    const fmtTm = tm === 'bytes' ? v => fmtBytes(v, 0) : fmtN;
    const tmRows = dims.platforms.map((p, i) => ({ i, p, v: tmVals[i] })).filter(r => r.v > 0).sort((a, c) => c.v - a.v);
    const tmCard = chartCard({
      id: 'treemap', cls: 's8', title: 'Where the catalogue sits', sub: 'Area is the share of the slice. Click a tile to filter to that platform.',
      acts: `<div class="seg" role="group" aria-label="Size by">${[['entries', 'Entries'], ['links', 'Links'], ['bytes', 'Size']].map(([m, l]) => `<button data-act="tm" data-m="${m}" aria-pressed="${tm === m}"${m === 'bytes' && !D.detailReady ? ' disabled data-tip="The sizes are still loading"' : ''}>${l}</button>`).join('')}</div>`,
      body: '<div class="tm" id="tm"></div>',
      twin: twinHTML([{ label: 'Platform' }, { label: 'Brand' }, { label: tm, right: true }, { label: 'Share', right: true }], tmRows.map(r => [r.p.name, dims.brands[r.p.brand], fmtTm(r.v), pct(r.v, tmTotal)])),
    });

    // source mix by platform
    const x = S.crosstab('plat', 'src', 'links');
    const mode = App.ui.stack;
    const plRows = dims.platforms.map((p, i) => ({ v: i, label: p.code, name: p.name, parts: Array.from({ length: x.nc }, (_, s) => x.cells[i * x.nc + s]) }))
      .filter(r => r.parts.some(Boolean)).sort((a, c) => c.parts.reduce((s, y) => s + y, 0) - a.parts.reduce((s, y) => s + y, 0)).slice(0, 14);
    const series = dims.sources.map((s, i) => ({ label: s.short, color: D.srcVar(i), facet: 'src', v: i }));
    const mixCard = chartCard({
      id: 'mix', cls: 's4', title: 'Source mix by platform', sub: 'Links per source for the 14 largest platforms.',
      acts: `<div class="seg" role="group" aria-label="Scale"><button data-act="stack" data-m="abs" aria-pressed="${mode === 'abs'}">Count</button><button data-act="stack" data-m="pct" aria-pressed="${mode === 'pct'}">Share</button></div>`,
      body: legendHTML(series) + (plRows.length ? stackedHTML(plRows, series, { facet: 'plat', mode, tipFor: (r, s, p, tot) => tipBox(`${r.name} on ${series[s].label}`, [['Links', fmtN(p)], ['Share of platform', pct(p, tot)]], 'Click to filter to both.') }) : '<div class="vt-empty">Nothing in this slice.</div>'),
      twin: twinHTML([{ label: 'Platform' }, ...series.map(s => ({ label: s.label, right: true }))], plRows.map(r => [r.name, ...r.parts.map(fmtN)])),
    });

    // size classes
    const szV = S.groupBy('sz', measureOf());
    const szColor = v => (v === 0 ? 'var(--ink-4)' : v === 6 ? 'var(--serious)' : `var(--ord-${v})`);
    const szItems = dims.sizes.map((s, v) => ({ v, label: s.label, value: szV[v], color: szColor(v), hint: s.hint }));
    const szCard = chartCard({
      id: 'size', cls: 's4', title: 'Size class', sub: g === 'entries' ? 'Entries with a file in each class.' : 'Links per class. Suspect means a size no real copy could have.',
      body: colsHTML(szItems, { facet: 'sz', selected: selectedOf('sz'), tipFor: i => tipBox(i.label, [['Range', i.hint], [unitName(), fmtN(i.value)]], i.v === 6 ? 'These sizes are impossible for the platform. See the Quality tab.' : 'Click to include. Alt-click to exclude.') }),
      twin: twinHTML([{ label: 'Class' }, { label: 'Range' }, { label: unitName(), right: true }], szItems.map(i => [i.label, i.hint, fmtN(i.value)])),
    });

    // coverage meters
    const avail = S.groupBy('avail', 'entries'), multi = avail.reduce((s, v, m) => s + ((m & (m - 1)) ? v : 0), 0);
    const dl = S.groupBy('deliv', 'links');
    const covCard = chartCard({
      id: 'coverage', cls: 's4', title: 'Coverage', sub: 'How complete the records are in this slice.',
      body: `<div class="meters">${meterHTML('Box art', k.art, k.entries)}${meterHTML('Serial in rom_id', k.ser, k.entries)}${meterHTML('RetroAchievements', k.ra, k.entries)}${meterHTML('Offered by 2 or more sources', multi, k.entries)}${meterHTML('Links delivered by BitTorrent', dl[1], k.links)}</div>`,
      twin: twinHTML([{ label: 'Measure' }, { label: 'Count', right: true }, { label: 'Of', right: true }], [['Box art', fmtN(k.art), fmtN(k.entries)], ['Serial', fmtN(k.ser), fmtN(k.entries)], ['RetroAchievements', fmtN(k.ra), fmtN(k.entries)], ['2+ sources', fmtN(multi), fmtN(k.entries)], ['BitTorrent links', fmtN(dl[1]), fmtN(k.links)]]),
    });

    const shelves = S.anyActive() ? '' : collectionsHTML() + `<div id="picks-slot" class="slot">${picksHTML()}</div>`;
    const held = App.heldHTML();
    root.innerHTML = `<div class="grid">${held ? `<div class="s12">${held}</div>` : ''}${hero}${kp}${shelves}${tmCard}${mixCard}
      ${simpleBars('reg', 'Regions', 'An entry can belong to up to three.', { sort: false })}
      ${szCard}${covCard}
      ${simpleBars('flag', 'Release flags', 'Tags read from titles, such as Beta or Unlicensed.', { top: 11 })}
      ${simpleBars('type', 'Link types', 'Games, DLC and the licence keys that go with them.', { top: 8 })}
      ${simpleBars('fmt', 'Formats', 'The ten most common file formats.', { top: 10 })}</div>`;
    this._tm = { tmRows, fmtTm, tm };
  },
  after(root) {
    Covers.watch(root);
    const el = $('#tm', root);
    if (!el || !el.offsetParent) return;
    const { S, D } = App, tm = treemapMeasure(), vals = S.groupBy('plat', tm), total = vals.reduce((a, c) => a + c, 0) || 1;
    const fmt = tm === 'bytes' ? v => fmtBytes(v, 0) : fmtN;
    const groups = D.dims.brands.map((name, bi) => ({ name, children: D.dims.platforms.map((p, i) => ({ id: i, code: p.code, name: p.name, brand: p.brand, value: vals[i] })).filter(c => c.brand === bi) }));
    el.style.height = Math.round(clamp(el.clientWidth * 0.52, 300, 420)) + 'px';
    el.innerHTML = treemapHTML(groups, el.clientWidth, el.clientHeight, {
      selected: selectedOf('plat'), fmt,
      tipFor: (c, g) => tipBox(c.name, [[tm === 'bytes' ? 'Indexed size' : tm, fmt(c.value)], ['Share of slice', pct(c.value, total)], ['Brand', g.name]], 'Click to filter. Alt-click to exclude.'),
    });
    fitLabels(root);
  },
};
Object.assign(App.handlers, {
  tm(el) { App.ui.treemap = el.dataset.m; App.saveUI(); App.renderView(); },
  stack(el) { App.ui.stack = el.dataset.m; App.saveUI(); App.renderView(); },
});
