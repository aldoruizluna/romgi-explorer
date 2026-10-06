/* ============================================================ schema: the tables, how they join, what is in every column, where the bytes go */

const ER_ROW = 19, ER_HEAD = 34;
const STORAGE_KINDS = [N_('table'), N_('index')];       // what the storage list says about each object
const ER = {
  platforms: { x: 24, y: 28, w: 196, show: ['id', 'brand', 'name'] },
  entries: { x: 300, y: 28, w: 240, show: ['slug', 'rom_id', 'search_key', 'title', 'platform', 'boxart_url', 'ra_game_id', 'ra_num_achievements'] },
  links: { x: 620, y: 28, w: 240, show: ['entry', 'name', 'type', 'format', 'url', 'filename', 'host', 'size', 'source_id', 'requires_auth', 'torrent_infohash', 'torrent_file_index'] },
  sources: { x: 936, y: 28, w: 152, show: ['id', 'name', 'kind', 'priority', 'manifest_json'] },
  source_health: { x: 936, y: 214, w: 152, show: ['source_id', 'status', 'last_checked', 'entry_count'] },
  regions: { x: 24, y: 330, w: 150, show: ['id', 'name'] },
  regions_entries: { x: 300, y: 330, w: 182, show: ['entry', 'region'] },
  entry_group_members: { x: 506, y: 330, w: 196, show: ['group_id', 'entry', 'member_index', 'member_label'] },
  entry_groups: { x: 506, y: 500, w: 196, show: ['id', 'kind', 'title', 'platform', 'member_count'] },
  torrents: { x: 730, y: 330, w: 200, show: ['infohash', 'source_id', 'name', 'magnet', 'torrent_blob', 'total_size', 'file_count'] },
  user_sources: { x: 24, y: 500, w: 196, show: ['id', 'name', 'kind', 'config_json'] },
  entries_fts: { x: 300, y: 500, w: 176, show: ['search_key'], note: N_('FTS4 index on entries') },
};
const erH = k => ER_HEAD + ER[k].show.length * ER_ROW + 12;
const erRow = (k, col) => { const i = ER[k].show.indexOf(col); return ER[k].y + ER_HEAD + (i < 0 ? 0 : i) * ER_ROW + ER_ROW / 2 + 2; };
const erR = k => ER[k].x + ER[k].w, erB = k => ER[k].y + erH(k);
const ER_EDGES = [
  { pts: () => [[erR('platforms'), erRow('platforms', 'id')], [262, erRow('platforms', 'id')], [262, erRow('entries', 'platform')], [ER.entries.x, erRow('entries', 'platform')]], a: ['1', 0], b: ['N', 1] },
  { pts: () => [[erR('entries'), erRow('entries', 'slug')], [ER.links.x, erRow('links', 'entry')]], a: ['1', 0], b: ['N', 1] },
  { pts: () => [[erR('links'), erRow('links', 'source_id')], [898, erRow('links', 'source_id')], [898, erRow('sources', 'id')], [ER.sources.x, erRow('sources', 'id')]], a: ['N', 0], b: ['1', 1] },
  { pts: () => [[ER.links.x + 70, erB('links')], [ER.links.x + 70, 316], [ER.torrents.x + 60, 316], [ER.torrents.x + 60, ER.torrents.y]], a: ['N', 0], b: ['1', 1] },
  { pts: () => [[erR('torrents'), erRow('torrents', 'source_id')], [1096, erRow('torrents', 'source_id')], [1096, erRow('sources', 'id')], [erR('sources'), erRow('sources', 'id')]], a: ['N', 0], b: ['1', 1] },
  { pts: () => [[ER.sources.x + 30, erB('sources')], [ER.sources.x + 30, ER.source_health.y]], a: ['1', 0], b: ['1', 1] },
  { pts: () => [[ER.entries.x + 60, erB('entries')], [ER.entries.x + 60, ER.regions_entries.y]], a: ['1', 0], b: ['N', 1] },
  { pts: () => [[erR('regions'), erRow('regions', 'id')], [238, erRow('regions', 'id')], [238, erRow('regions_entries', 'region')], [ER.regions_entries.x, erRow('regions_entries', 'region')]], a: ['1', 0], b: ['N', 1] },
  { pts: () => [[ER.entries.x + 222, erB('entries')], [ER.entries.x + 222, ER.entry_group_members.y]], a: ['1', 0], b: ['N', 1] },
  { pts: () => [[ER.entry_groups.x + 100, ER.entry_groups.y], [ER.entry_groups.x + 100, erB('entry_group_members')]], a: ['1', 1], b: ['N', 0] },
];

function erSVG(sel) {
  const tabs = Object.fromEntries(App.D.raw.schema.map(t => [t.name, t]));
  const W = 1110, H = 640;
  const edges = ER_EDGES.map(e => {
    const p = e.pts();
    const d = p.map((q, i) => (i ? 'L' : 'M') + q[0] + ' ' + q[1]).join('');
    const lab = (card, side) => { const q = side ? p[p.length - 1] : p[0], r = side ? p[p.length - 2] : p[1]; const dx = Math.sign(r[0] - q[0]) * 11, dy = Math.sign(r[1] - q[1]) * 11; return `<text class="er-card" x="${q[0] + dx - (dx ? 3 : -8)}" y="${q[1] + dy + (dy ? 4 : -5)}">${card}</text>`; };
    return `<path class="er-edge" d="${d}"/>${lab(e.a[0], 0)}${lab(e.b[0], 1)}`;
  }).join('');
  const boxes = Object.entries(ER).map(([k, b]) => {
    const t = tabs[k]; if (!t) return '';
    const h = erH(k), cols = Object.fromEntries(t.columns.map(c => [c.name, c])), fkFrom = new Set(t.fks.map(f => f.from));
    const rows = b.show.map((c, i) => {
      const col = cols[c] || {}, y = b.y + ER_HEAD + i * ER_ROW + 14;
      return `<text class="er-c${col.pk ? ' pk' : ''}" x="${b.x + 12}" y="${y}">${esc(c)}</text><text class="er-k" x="${b.x + b.w - 12}" y="${y}" text-anchor="end">${col.pk ? 'PK ' : ''}${fkFrom.has(c) ? 'FK ' : ''}<tspan class="er-ty">${esc((col.type || '').toLowerCase())}</tspan></text>`;
    }).join('');
    const more = t.columns.length - b.show.length;
    return `<g class="er-box${sel === k ? ' sel' : ''}${t.rows === 0 ? ' empty' : ''}" data-act="stbl" data-t="${k}" tabindex="0" role="button" aria-label="${esc(__('{name} table', { name: k }))}">
      <rect class="bg" x="${b.x}" y="${b.y}" width="${b.w}" height="${h}" rx="8"/><path class="hd" d="M${b.x} ${b.y + 26}V${b.y + 8}a8 8 0 0 1 8-8h${b.w - 16}a8 8 0 0 1 8 8v18z"/>
      <text class="er-t" x="${b.x + 12}" y="${b.y + 18}">${esc(k)}</text><text class="er-n" x="${b.x + b.w - 12}" y="${b.y + 18}" text-anchor="end">${t.rows == null ? '' : compact(t.rows)}</text>${rows}
      ${more > 0 ? `<text class="er-more" x="${b.x + 12}" y="${b.y + h - 6}">${esc(__n(more, '+ {n} more column|+ {n} more columns'))}</text>` : b.note ? `<text class="er-more" x="${b.x + 12}" y="${b.y + h - 6}">${esc(__(b.note))}</text>` : ''}</g>`;
  }).join('');
  return `<svg class="er" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(__('Entity relationship diagram of the catalogue database'))}">${edges}${boxes}</svg>`;
}

function profileHTML(c, rows) {
  const p = c.profile; if (!p) return `<span class="muted">${__('not profiled')}</span>`;
  const filled = rows ? (rows - p.nulls - (p.empty || 0)) / rows : 0;
  const bits = [];
  bits.push(`<span class="fill" data-tip="${esc(p.empty ? __('{nulls} null, {empty} empty', { nulls: p.nulls, empty: p.empty }) : __('{nulls} null', { nulls: p.nulls }))}"><i style="width:${(filled * 100).toFixed(1)}%"></i></span><span class="num fv">${fmtD(filled * 100, filled >= 0.1 && filled < 1 ? 0 : 1).replace(/[.,]0$/, '')}%</span>`);
  let detail = '';
  if (p.top) detail = `<div class="tops">${p.top.slice(0, 4).map(([v, n]) => `<span class="tv"><b>${esc(String(v).slice(0, 26))}</b><i class="num">${compact(n)}</i></span>`).join('')}</div>`;
  else if (p.hosts) detail = `<div class="tops">${p.hosts.slice(0, 4).map(([v, n]) => `<span class="tv"><b>${esc(v)}</b><i class="num">${compact(n)}</i></span>`).join('')}</div>`;
  else if (p.hist) { const mx = Math.max(...p.hist.bins, 1); detail = `<div class="spark" data-tip="${esc(__('log scale from {lo} to {hi}', { lo: p.hist.lo, hi: p.hist.hi }))}">${p.hist.bins.map(n => `<i style="height:${Math.max(1, (n / mx) * 22).toFixed(1)}px"></i>`).join('')}</div>`; }
  else if (p.blobs != null) detail = `<span class="muted">${esc(__n(p.blobs, '{n} file stored|{n} files stored'))}</span>`;
  else if (p.min != null && p.max != null) detail = `<span class="mono muted rng">${esc(String(p.min).slice(0, 18))} … ${esc(String(p.max).slice(0, 18))}</span>`;
  return `<div class="pf"><div class="pf-a">${bits.join('')}</div><span class="num dv">${esc(__('{n} distinct', { n: p.distinct }) + (rows && p.distinct === rows ? ' · ' + __('unique') : ''))}</span>${detail}</div>`;
}

App.views.schema = {
  render(root) {
    const { D } = App, sel = App.ui.schemaTable, tabs = D.raw.schema, t = tabs.find(x => x.name === sel) || tabs.find(x => x.name === 'entries');
    const storage = D.raw.storage, totalB = storage.reduce((s, x) => s + x.bytes, 0), max = storage[0]?.bytes || 1;
    const stItems = storage.slice(0, 12).map(x => ({ v: 0, label: x.name, value: x.bytes, color: x.kind === 'index' ? 'var(--ink-4)' : 'var(--accent)' }));
    const stCard = chartCard({
      id: 'storage', cls: 's5', title: __('Where the bytes go'), sub: __('{size} in {pages} pages. Tables in blue, indexes in grey.', { size: fmtBytes(totalB), pages: D.meta.page_count }),
      body: hbarHTML(stItems, { max, static: true, fmt: v => fmtBytes(v, 0), tipFor: i => tipBox(i.label, [[__('Size'), fmtBytes(i.value)], [__('Share'), pct(i.value, totalB)]]) }),
      twin: twinHTML([{ label: __('Object') }, { label: __('Kind') }, { label: __('Size'), right: true }, { label: __('Share'), right: true }], storage.map(x => [x.name, __(x.kind), fmtBytes(x.bytes), pct(x.bytes, totalB)])),
    });
    const fkTxt = t.fks.map(f => __('{from} to {target}', { from: f.from, target: `${f.table}.${f.to}` }));
    const cols = t.columns.map(c => `<tr><td class="mono cn">${esc(c.name)}${c.pk ? ' <span class="pill info" style="height:18px;padding:0 6px">pk</span>' : ''}${t.fks.some(f => f.from === c.name) ? ' <span class="pill" style="height:18px;padding:0 6px">fk</span>' : ''}</td><td class="mono muted">${esc((c.type || '').toLowerCase())}${c.notnull ? ' not null' : ''}</td><td>${profileHTML(c, t.rows)}</td></tr>`).join('');
    root.innerHTML = `<div class="grid">
      <section class="card s12 flush"><div class="card-h"><div><h3>${__('How the tables join')}</h3><p>${__('Click a table to inspect it. Counts are rows. Lines join a primary key (1) to the many rows that point at it (N).')}</p></div><div class="acts"><span class="pill info">${icon('db', 13)}${esc(__n(tabs.filter(x => x.kind !== 'shadow').length, '{n} table|{n} tables'))}</span></div></div>
        <div class="er-wrap">${erSVG(t.name)}</div></section>
      <section class="card s7" id="insp"><div class="card-h"><div><h3 class="mono" style="font-size:16px">${esc(t.name)}</h3><p>${esc(t.kind === 'fts' ? __('Full-text index (FTS4). The app only uses it as a health probe.') : t.kind === 'shadow' ? __('Internal table that SQLite keeps for the full-text index.') : __('{rows} rows · {cols} columns · {size}', { rows: t.rows ?? 0, cols: t.columns.length, size: t.bytes ? fmtBytes(t.bytes) : __('size unknown') }) + (t.idx_bytes ? ' ' + __('plus {size} of indexes', { size: fmtBytes(t.idx_bytes) }) : ''))}</p></div>
          <div class="acts">${App.sqlOK() ? `<button class="btn sm" data-act="sqltable" data-t="${esc(t.name)}">${icon('term', 13)}${__('Query')}</button>` : ''}</div></div>
        <div class="codebox" style="margin-bottom:14px"><pre>${hiSQL(t.ddl || '')}</pre><div class="copy"><button class="btn sm" data-act="copy" data-text="${esc(t.ddl || '')}">${icon('copy', 13)}${__('Copy')}</button></div></div>
        ${t.indexes.length ? `<div class="muted" style="font-size:12.5px;margin-bottom:6px"><b style="color:var(--ink)">${__('Indexes')}</b> ${t.indexes.map(i => `<span class="mono">${esc(i.name)}</span> (${esc(i.cols.join(', '))})`).join(' · ')}</div>` : ''}
        ${fkTxt.length ? `<div class="muted" style="font-size:12.5px"><b style="color:var(--ink)">${__('References')}</b> ${fkTxt.map(x => `<span class="mono">${esc(x)}</span>`).join(' · ')}</div>` : ''}
      </section>${stCard}
      <section class="card s12 flush"><div class="card-h"><div><h3>${__h('Columns of {name}', { name: raw(`<span class="mono">${esc(t.name)}</span>`) })}</h3><p>${esc(__('How full each column is, how many distinct values it holds, and what is in it.') + (D.caps.sql ? '' : ' ' + __('File names, URLs and magnets are summarised without sample values.')))}</p></div></div>
        <div class="cols-wrap"><table class="cols-t"><thead><tr><th>${__('Column')}</th><th>${__('Type')}</th><th>${__('Profile')}</th></tr></thead><tbody>${cols}</tbody></table></div></section></div>`;
  },
};
Object.assign(App.handlers, {
  stbl(el) { App.ui.schemaTable = el.dataset.t; App.saveUI(); App.renderView(); $('#insp')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); },
  sqltable(el) { App.ui.sqlText = `SELECT * FROM ${el.dataset.t} LIMIT 100;`; App._sqlAuto = App.D.caps.sql || Live.state === 'ready'; App.saveUI(); App.show('sql'); },
});
