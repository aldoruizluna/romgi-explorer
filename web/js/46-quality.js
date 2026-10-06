/* ============================================================ quality: what is wrong, odd or fine in the data, each check inspectable */

const SEV = {
  critical: { label: N_('Critical'), icon: 'x-c', cls: 'critical', rank: 0 },
  serious: { label: N_('Serious'), icon: 'alert', cls: 'serious', rank: 1 },
  warn: { label: N_('Worth a look'), icon: 'alert', cls: 'warn', rank: 2 },
  info: { label: N_('For context'), icon: 'info', cls: 'info', rank: 3 },
  ok: { label: N_('Fine'), icon: 'check-c', cls: 'ok', rank: 4 },
};
const sevPill = s => `<span class="pill ${SEV[s].cls}">${icon(SEV[s].icon, 13)}${__(SEV[s].label)}</span>`;

/** What each check says. The build supplies the numbers (count, total and vars, in dataset.quality); the sentences are here, so they can be
 *  translated. Each function runs when the card is drawn. */
const FK_NAMES = [N_('links with no entry'), N_('entries with no links'), N_('entries with an unknown platform'), N_('regions_entries with an unknown region'),
  N_('links with an unknown source'), N_('links pointing at a missing torrent'), N_('groups whose member_count is wrong')];
const QUALITY_TEXT = {
  moji: { title: () => __('Titles with scrambled characters'),
    summary: () => __('UTF-8 text was decoded as Latin-1 before it was stored, so “Us™” became “Usâ\u0084¢” and Japanese titles turned into noise. Every affected entry is a PlayStation 3 or Vita title from NoPayStation. Re-encoding the title as Latin-1 and decoding it as UTF-8 restores it; the drawer shows that repair.') },
  sizes: { title: () => __('File sizes that no real copy could have'),
    summary: (c, v) => __('{susp} links claim a size the platform could not hold: {tib} are a terabyte or more, and {over} are bigger than the medium allows (a cartridge game over 700 MiB, a CD over 2 GiB, a DVD-era disc over 12 GiB). Their size_str values are round numbers such as {sigs}, which look like a pattern match on the page row rather than a file size: the archived scraper took the first number followed by K, M, G or T. The explorer tags them Suspect and keeps them out of every size total. The capacity rule is applied to Internet Archive only; the other sources read sizes from torrent metadata or structured listings, and their largest files are real (Wii and 3DS digital dumps of 13 to 34 GiB).',
      { susp: c.count, tib: v.tib, over: v.over, sigs: (v.sigs || []).join(', ') }) },
  zero: { title: () => __('Links with no size'), summary: () => __('These are mostly NoPayStation licence keys and a few archive items. The sizes are 0 or missing.') },
  torrents: { title: () => __('Torrent table carries almost nothing'),
    summary: (c, v) => __('{packs} packs, but {blobs} .torrent files, {sized} sizes and {lists} tracker lists. Each row is only an infohash, a name and a magnet. The app has to resolve everything else from the swarm.',
      { packs: c.count, blobs: v.blobs, sized: v.sized, lists: v.lists }) },
  auth: { title: () => __('No link is marked as login-only'),
    summary: c => __("{n} of {total} links have requires_auth = 1, although the Internet Archive manifest says some of its items need an account. The app's Login Required badge can only fire from this flag.", { n: c.count, total: c.total }) },
  dips: { title: () => __('Weekly snapshots that shipped far fewer entries'),
    summary: c => {
      let runs = [];
      try { runs = JSON.parse(c.evidence); } catch { /* the evidence is optional */ }
      const parts = runs.map(r => __('{when} ({snapshots}, {min} entries against {base} before)', {
        when: r.start === r.end ? r.start : __('{start} to {end}', { start: r.start, end: r.end }), snapshots: __n(r.n, '{n} snapshot|{n} snapshots'), min: r.min, base: r.base }));
      return __('The app downloads whatever is published on main, so these weeks users received a catalogue missing roughly a third to two fifths of its entries: {parts}.', { parts: parts.join('; ') });
    } },
  titles: { title: () => __('Titles with stray spaces, or none at all'),
    summary: (c, v) => __('{padded} titles start or end with a space (almost all PlayStation 3 and Vita content from NoPayStation) and {empty}. They sort to the top of any plain ORDER BY title, so the explorer trims them for display and sorting.',
      { padded: v.padded, empty: __n(v.empty, '{n} has no title text|{n} have no title text') }) },
  noreg: { title: () => __('Entries without a region'), summary: () => __('No row in regions_entries, so region filters never match them.') },
  noser: { title: () => __('Entries without a serial'), summary: () => __('rom_id is empty. Arcade sets and most Super Nintendo titles have none.') },
  noart: { title: () => __('Entries without box art'), summary: () => __('No GameTDB or libretro thumbnail was matched.') },
  dups: { title: () => __('Same title, several entries'),
    summary: (c, v) => __('{pairs} platform and title pairs appear more than once ({rows} rows). They are regional or revision variants with different slugs, so counting entries is not counting games.', { pairs: v.pairs, rows: c.count }) },
  fk: { title: c => (c.sev === 'ok' ? __('Foreign keys and counts line up') : __('Broken references')),
    summary: (c, v) => __('Checked: {list}.', { list: (v.checked || []).map(([k, n]) => `${__(k)} (${fmtN(n)})`).join(', ') }) },
  quick: { title: () => 'SQLite quick_check', summary: (c, v) => __('PRAGMA quick_check returned “{result}”.', { result: v.result }) },
  fts: { title: () => __('Full-text index matches the entries table'),
    summary: c => __("entries_fts holds {docs} documents for {entries} entries. It indexes search_key, the title squashed with no spaces, so only one-word prefix queries such as MATCH 'supermario*' work, and the app searches with LIKE instead.", { docs: c.count, entries: c.total }) },
  version: { title: () => __('version.json agrees with the database'),
    summary: (c, v) => ((v.diffs || []).length ? v.diffs.map(([k, a, b]) => __('{field}: manifest {a} vs database {b}', { field: k, a, b })).join('; ')
      : __('Entries, links, platforms, sources, RetroAchievements games and byte size all match the manifest.')) },
  slugs: { title: () => __('Slugs that are not title + platform + region'),
    summary: c => __('{n} slugs cannot be rebuilt from the title, mostly the scrambled ones above. The explorer stores those verbatim.', { n: c.count }) },
};
const qualityTitle = c => (QUALITY_TEXT[c.id] ? QUALITY_TEXT[c.id].title(c) : c.id);
const qualitySummary = c => (QUALITY_TEXT[c.id] ? QUALITY_TEXT[c.id].summary(c, c.vars || {}) : '');

App.views.quality = {
  render(root) {
    const { D } = App, checks = [...D.raw.quality].sort((a, b) => SEV[a.sev].rank - SEV[b.sev].rank);
    const tally = {}; checks.forEach(c => { tally[c.sev] = (tally[c.sev] || 0) + 1; });
    const open = App.ui.qopen || [];
    const head = `<div class="card" style="margin-bottom:14px"><div class="card-h" style="margin-bottom:0"><div><h3>${__('Data quality')}</h3>
      <p>${esc(__('{n} checks run against the {version} snapshot. Each one is a SQL query you can run yourself, and most open the affected rows.', { n: checks.length, version: D.meta.version }))}</p></div></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">${['critical', 'serious', 'warn', 'info', 'ok'].filter(s => tally[s]).map(s => `<span class="pill ${SEV[s].cls}">${icon(SEV[s].icon, 13)}${tally[s]} ${esc(__(SEV[s].label).toLowerCase())}</span>`).join('')}</div></div>`;
    const cards = checks.map(c => {
      const isOpen = open.includes(c.id);
      const meter = c.count != null && c.total ? `<div class="meter" style="min-width:140px"><div class="mt"><i style="width:${Math.max(1, (100 * c.count) / c.total).toFixed(1)}%;background:var(--${c.sev === 'ok' ? 'good' : c.sev === 'info' ? 'accent' : c.sev === 'warn' ? 'warn' : c.sev})"></i></div></div>` : '';
      let extra = '';
      if (c.id === 'dips' && c.evidence) {
        try { extra = `<div class="runs">${JSON.parse(c.evidence).map(r => `<div class="run"><b>${esc(r.end !== r.start ? __('{start} to {end}', { start: r.start, end: r.end }) : r.start)}</b><span class="muted">${esc(__('{min} entries against {base} before, {pct}% fewer', { min: r.min, base: r.base, pct: fmtD(100 * (1 - r.min / r.base), 0) }))}</span></div>`).join('')}</div>`; } catch { /* evidence is optional */ }
      }
      if (c.id === 'moji' && c.evidence) extra = `<div class="runs"><div class="run"><span class="muted">${__('Example, as stored')}</span><span class="mono">${esc(c.evidence)}</span></div></div>`;
      const showRows = c.preset ? `<button class="btn sm primary" data-act="qshow" data-id="${esc(c.id)}">${icon('table', 13)}${__('Show the rows')}</button>` : '';
      const go = c.action ? `<button class="btn sm" data-act="qgo" data-id="${esc(c.id)}">${icon('chev-r', 13)}${c.action.view === 'sources' ? __('See the history') : __('Open in Schema')}</button>` : '';
      return `<section class="card q ${c.sev}" data-q="${esc(c.id)}">
        <div class="q-top">${sevPill(c.sev)}<h3>${esc(qualityTitle(c))}</h3>
          <span class="q-n num">${c.count != null && c.sev !== 'ok' ? `${fmtN(c.count)}${c.total ? `<span class="muted"> ${esc(__('of {total}', { total: c.total }))}</span>` : ''}` : ''}</span></div>
        <p class="q-s">${esc(qualitySummary(c))}</p>${extra}${meter}
        <div class="q-act">${showRows}${go}${c.sql ? `<button class="btn sm ghost" data-act="qsql" data-id="${esc(c.id)}" aria-expanded="${isOpen}">${icon('code', 13)}SQL</button>` : ''}</div>
        ${c.sql ? `<div class="codebox q-sql"${isOpen ? '' : ' hidden'}><pre>${hiSQL(c.sql)}</pre><div class="copy" style="display:flex;gap:6px"><button class="btn sm" data-act="copy" data-text="${esc(c.sql)}">${icon('copy', 13)}${__('Copy')}</button>${App.sqlOK() ? `<button class="btn sm primary" data-act="to-sql" data-sql="${esc(c.sql)}">${icon('term', 13)}${__('Run')}</button>` : ''}</div></div>` : ''}
      </section>`;
    }).join('');
    root.innerHTML = head + `<div class="q-list">${cards}</div>`;
  },
};
Object.assign(App.handlers, {
  qshow(el) {
    const c = App.D.raw.quality.find(x => x.id === el.dataset.id);
    App.S.applyPreset(c.preset); $('#q').value = '';
    store.set('grain', App.S.state.grain);
    App.show('browse');
  },
  qgo(el) {
    const c = App.D.raw.quality.find(x => x.id === el.dataset.id);
    if (c.action.table) App.ui.schemaTable = c.action.table;
    App.saveUI(); App.show(c.action.view);
    if (c.action.anchor) setTimeout(() => $('#' + c.action.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  },
  qsql(el) {
    const id = el.dataset.id, sec = el.closest('.q'), box = $('.q-sql', sec), open = box.hidden;
    box.hidden = !open; el.setAttribute('aria-expanded', String(open));
    App.ui.qopen = open ? [...(App.ui.qopen || []), id] : (App.ui.qopen || []).filter(x => x !== id);
  },
});
