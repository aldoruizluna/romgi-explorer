/* ============================================================ sources: who serves what, how they overlap, how the catalogue changed */

const utc = secs => new Date(secs * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const hostOf = u => { try { return new URL(u).host; } catch { return u; } };

App.views.sources = {
  render(root) {
    const { S, D } = App, dims = D.dims;
    const links = S.groupBy('src', 'links'), ents = S.groupBy('src', 'entries');
    const baseL = S.base.links.src, baseE = S.base.entries.src;
    const cards = dims.sources.map((s, i) => {
      const man = s.manifest || {}, caps = man.capabilities || [], h = s.health;
      const delivery = man.delivery === 'torrent' || caps.includes('torrent_distribution') ? __('BitTorrent, one file at a time') : caps.includes('http_range_resume') ? __('HTTP, resumable') : 'HTTP';
      const plats = (man.platforms || []).map(p => p.toUpperCase());
      const status = h ? `<span class="pill ${h.status === 'ok' ? 'ok' : 'serious'}" data-tip="${esc(__('Checked {when}', { when: utc(h.last_checked) }))}">${icon(h.status === 'ok' ? 'check-c' : 'alert', 13)}${esc(h.status === 'ok' ? __('Online') : __(h.status))}</span>` : `<span class="pill">${__('Unknown')}</span>`;
      return `<section class="card src-card" style="--c:${D.srcVar(i)}">
        <div class="card-h"><div style="display:flex;align-items:center;gap:11px"><i class="sd big"></i><div><h3>${esc(s.name)}</h3><p><a href="${esc(s.homepage)}" target="_blank" rel="noopener">${esc(hostOf(s.homepage))} ${icon('ext', 11)}</a></p></div></div><div class="acts">${status}</div></div>
        <div class="src-stats">
          <div><div class="l">${__('Links in view')}</div><div class="v num">${fmtN(links[i])}</div><div class="s num">${__('of {total}', { total: baseL[i] })}</div></div>
          <div><div class="l">${__('Entries')}</div><div class="v num">${fmtN(ents[i])}</div><div class="s num">${__('of {total}', { total: baseE[i] })}</div></div>
          <div><div class="l">${__('Delivery')}</div><div class="v sm">${esc(delivery)}</div><div class="s">${s.auth_required ? __('login required') : __('no login')}</div></div>
          <div><div class="l">${__('Priority')}</div><div class="v num">${s.priority}</div><div class="s">${esc(s.kind)}</div></div>
        </div>
        ${man.notes ? `<p class="notes">${esc(man.notes.replace(/\s*\n\s*/g, ' ').trim())}</p>` : ''}
        <div class="caps">${caps.map(c => `<span class="cp">${esc(c.replace(/_/g, ' '))}</span>`).join('')}</div>
        <div class="plats"><span class="eyebrow">${esc(__n(plats.length, '{n} platform declared|{n} platforms declared'))}</span><div>${plats.slice(0, 14).map(p => `<span class="tg">${esc(p)}</span>`).join(' ')}${plats.length > 14 ? `<span class="tg muted"> +${plats.length - 14}</span>` : ''}</div></div>
        ${h ? `<div class="muted" style="font-size:12px">${esc(__('Health check {when}: {entries} entries and {links} links seen{reason}.', { when: utc(h.last_checked), entries: h.entries, links: h.links, reason: h.reason ? '. ' + h.reason : '' }))}</div>` : ''}
        <div class="src-act"><button class="btn sm" data-act="facet" data-f="src" data-v="${i}">${icon('filter', 13)}${__('Slice to this source')}</button><button class="btn sm" data-act="srconly" data-i="${i}">${icon('layers', 13)}${__('Entries found only here')}</button></div>
      </section>`;
    }).join('');

    // overlap
    const av = S.groupBy('avail', 'entries'), selA = selectedOf('avail');
    const combos = []; for (let m = 1; m < av.length; m++) if (av[m] > 0) combos.push({ m, n: av[m] });
    combos.sort((a, b) => b.n - a.n);
    const maxN = Math.max(1, ...combos.map(c => c.n)), totalN = combos.reduce((s, c) => s + c.n, 0) || 1;
    const names = m => D.comboSources(m).map(s => D.srcAbbr(s)).join(' + '), fullNames = m => D.comboSources(m).map(s => dims.sources[s].short).join(' + ');
    const up = combos.length ? `<div class="up">${combos.map(c => `<button class="up-row${selA?.has(c.m) ? ' sel' : ''}" data-act="facet" data-f="avail" data-v="${c.m}" data-tk="${Tip.tk(() => tipBox(fullNames(c.m), [[__('Entries'), fmtN(c.n)], [__('Share'), pct(c.n, totalN)]], c.m & (c.m - 1) ? __('Offered by every source listed.') : __('Offered only by this source.')))}">
      <span class="combo-dots">${dims.sources.map((_, s) => `<i class="${c.m >> s & 1 ? 'on' : ''}" style="--c:${D.srcVar(s)}"></i>`).join('')}</span>
      <span class="up-n">${esc(fullNames(c.m))}</span><span class="num up-v">${fmtN(c.n)}</span><span class="up-bar"><i style="width:${((100 * c.n) / maxN).toFixed(2)}%"></i></span></button>`).join('')}</div>` : `<div class="vt-empty">${__('Nothing in this slice.')}</div>`;
    const overlap = chartCard({
      id: 'overlap', cls: 's6', title: __('Who offers each entry'), sub: __('Entries by the exact set of sources that carry them. Click a row to filter.'),
      body: up, twin: twinHTML([{ label: __('Sources') }, { label: __('Entries'), right: true }, { label: __('Share'), right: true }], combos.map(c => [names(c.m), fmtN(c.n), pct(c.n, totalN)])),
    });

    // packs
    const pk = S.groupBy('pack', 'links'), pbase = S.base.links.pack, selP = selectedOf('pack');
    const CS = { 'No-Intro': 'NI', Redump: 'RD', 'FinalBurn Neo': 'FBN' };
    let packs = dims.packs.map((p, i) => ({ v: i, label: p.label.replace(/^(No-Intro|Redump) - /, ''), full: p.label, cs: CS[dims.collections[p.collection]] || '', value: pk[i], total: pbase[i], coll: dims.collections[p.collection] })).filter(p => p.value > 0).sort((a, b) => b.value - a.value);
    const allPacks = App.ui.packsAll, shownPacks = allPacks ? packs : packs.slice(0, 12);
    const packCard = chartCard({
      id: 'packs', cls: 's6', title: __('Torrent packs'), sub: __('{shown} of {total} MiNERVA packs have links in this slice.', { shown: packs.length, total: dims.packs.length }),
      acts: packs.length > 12 ? `<button class="btn sm ghost" data-act="packsall">${allPacks ? __('Show fewer') : __('Show all {n}', { n: packs.length })}</button>` : '',
      body: shownPacks.length ? hbarHTML(shownPacks, { facet: 'pack', selected: selP, twoLine: true, labelDot: p => `<span class="cp" style="min-width:26px;justify-content:center">${esc(p.cs)}</span>`, tipFor: p => tipBox(p.full, [[__('Links in view'), fmtN(p.value)], [__('Links in pack'), fmtN(p.total)], [__('Collection'), p.coll]], __('Click to include. Alt-click to exclude.')) }) : `<div class="vt-empty">${__('No torrent links in this slice.')}</div>`,
      twin: twinHTML([{ label: __('Pack') }, { label: __('Collection') }, { label: __('In view'), right: true }, { label: __('In pack'), right: true }], packs.map(p => [p.full, p.coll, fmtN(p.value), fmtN(p.total)])),
    });

    // history
    const hist = D.raw.history || [];
    const histCard = hist.length ? `<div id="history" class="s12">${chartCard({
      id: 'hist', cls: '', title: __('Catalogue size, snapshot by snapshot'), sub: __('{n} weekly snapshots from {date}. This chart is about the published files, so filters do not change it.', { n: hist.length, date: hist[0].date.slice(0, 10) }),
      body: '<div class="hist-chart"></div>',
      twin: twinHTML([{ label: __('Date') }, { label: __('Version') }, { label: __('Entries'), right: true }, { label: __('Links'), right: true }, { label: __('Platforms'), right: true }, { label: __('Sources'), right: true }, { label: __('RA games'), right: true }, { label: __('Schema'), right: true }, { label: __('Download'), right: true }],
        hist.map(h => [h.date.slice(0, 10), h.version, fmtN(h.entries), fmtN(h.links), h.platforms ?? '', h.sources ?? '', h.ra ?? '', h.schema ?? '', h.size ? fmtBytes(h.size) : ''])),
    })}</div>` : '';
    root.innerHTML = `<div class="grid"><div class="s12 src-grid">${cards}</div>${overlap}${packCard}${histCard}</div>`;
  },
  after(root) {
    const el = $('.hist-chart', root), hist = App.D.raw.history || [];
    if (!el || !el.offsetParent || !hist.length) return;
    let bands = [];
    const dips = App.D.raw.quality.find(c => c.id === 'dips');
    if (dips?.evidence) { try { bands = JSON.parse(dips.evidence).map(r => ({ t0: Date.parse(r.start), t1: Date.parse(r.end), label: __('{pct}% fewer', { pct: fmtD(100 * (1 - r.min / r.base), 0) }) })); } catch { /* optional */ } }
    const pts = k => hist.map(h => ({ t: Date.parse(h.date), y: h[k], tip: { title: __('{date}  ·  version {version}', { date: h.date.slice(0, 10), version: h.version }), foot: __('{platforms} platforms · {sources} sources', { platforms: h.platforms ?? '?', sources: h.sources ?? '?' }) + (h.ra ? ' · ' + __('{n} RA games', { n: h.ra }) : '') } }));
    mountLine(el, { series: [{ id: 'entries', label: __('Entries'), css: 'var(--accent)', points: pts('entries') }, { id: 'links', label: __('Links'), css: 'var(--ink-3)', points: pts('links') }], bands });
  },
};
Object.assign(App.handlers, {
  srconly(el) { App.S.applyPreset({ grain: 'entries', avail: [1 << +el.dataset.i] }); store.set('grain', 'entries'); },
  packsall() { App.ui.packsAll = !App.ui.packsAll; App.saveUI(); App.renderView(); },
});
