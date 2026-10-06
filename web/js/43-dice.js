/* ============================================================ dice: pivot any two dimensions, colour by value, drill through */

const PV_MEASURES = [
  { id: 'entries', label: N_('Entries'), grain: 'entries', fmt: v => fmtN(v) },
  { id: 'links', label: N_('Links'), grain: 'links', fmt: v => fmtN(v) },
  { id: 'bytes', label: N_('Indexed size'), grain: 'links', fmt: v => fmtBytes(v, 1) },
  { id: 'avg', label: N_('Average file size'), grain: 'links', fmt: v => fmtBytes(v, 1), noNorm: true },
  { id: 'ra', label: N_('Achievements'), grain: 'entries', fmt: v => fmtN(v) },
];
const PV_PRESETS = [
  { label: N_('Platform by source'), row: 'plat', col: 'src', measure: 'links' },
  { label: N_('Brand by region'), row: 'brand', col: 'reg', measure: 'entries' },
  { label: N_('Format by source'), row: 'fmt', col: 'src', measure: 'links' },
  { label: N_('Link type by source'), row: 'type', col: 'src', measure: 'links' },
  { label: N_('Size class by brand'), row: 'sz', col: 'brand', measure: 'links' },
  { label: N_('Flags by brand'), row: 'flag', col: 'brand', measure: 'entries' },
  { label: N_('Who offers what'), row: 'avail', col: 'brand', measure: 'entries' },
  { label: N_('Average size by platform'), row: 'plat', col: 'src', measure: 'avg' },
];
const PV_NORMS = [['none', N_('Raw values')], ['row', N_('Share of row')], ['col', N_('Share of column')], ['total', N_('Share of total')], ['lift', N_('Versus expected')]];

function pivotModel() {
  const { S } = App, p = App.ui.pivot;
  let m = PV_MEASURES.find(x => x.id === p.measure) || PV_MEASURES[1];
  const waiting = (m.id === 'bytes' || m.id === 'avg') && !App.D.detailReady;      // exact sizes arrive with the titles; links until then
  if (waiting) m = PV_MEASURES[1];
  const X = S.pivot(p.row, p.col === 'all' ? null : p.col, m.id);
  const hasCol = p.col !== 'all';
  const rowIdx = [];
  for (let r = 0; r < X.nr; r++) if (X.rowTot[r] > 0 || (m.id === 'avg' && !Number.isNaN(X.rowTot[r]))) rowIdx.push(r);
  const sorter = {
    value: (a, b) => (X.rowTot[b] || 0) - (X.rowTot[a] || 0) || a - b,
    label: (a, b) => App.S.dimName(X.R, a).localeCompare(App.S.dimName(X.R, b), Lang.locale),
    natural: (a, b) => a - b,
  }[p.sort] || ((a, b) => a - b);
  rowIdx.sort(sorter);
  const colIdx = [];
  if (hasCol) {
    for (let c = 0; c < X.nc; c++) if (X.colTot[c] > 0) colIdx.push(c);
    colIdx.sort((a, b) => (X.colTot[b] || 0) - (X.colTot[a] || 0) || a - b);
  } else colIdx.push(0);
  const topR = p.top === 0 ? rowIdx.length : p.top, topC = p.top === 0 ? colIdx.length : Math.min(p.top, 24);
  return { X, m, p, waiting, hasCol, rows: rowIdx.slice(0, topR), cols: colIdx.slice(0, topC), hiddenR: Math.max(0, rowIdx.length - topR), hiddenC: Math.max(0, colIdx.length - topC) };
}

function pivotCell(M, r, c) {
  const { X, m, p } = M, raw = X.cells[r * X.nc + c];
  const rt = X.rowTot[r], ct = M.hasCol ? X.colTot[c] : X.grand, g = X.grand;
  const norm = m.noNorm ? 'none' : p.norm;
  if (Number.isNaN(raw)) return { text: '·', empty: true };
  if (raw === 0 && norm !== 'none') return { text: '·', empty: true, raw };
  if (norm === 'none') return { raw, text: raw === 0 ? '·' : m.fmt(raw), t: raw, empty: raw === 0 };
  if (norm === 'lift') { const lift = rt && ct && g ? (raw * g) / (rt * ct) : 0; return { raw, text: lift ? fmtD(lift, lift >= 10 ? 0 : 1) + '×' : '·', t: lift, empty: !lift, lift }; }
  const den = norm === 'row' ? rt : norm === 'col' ? ct : g, v = den ? raw / den : 0;
  return { raw, text: fmtD(v * 100, v >= 0.1 ? 0 : 1) + '%', t: v, empty: !raw };
}

App.views.dice = {
  render(root) {
    const { S } = App, p = App.ui.pivot, M = pivotModel(), { X, m } = M;
    const sizeWait = !App.D.detailReady, needsSize = id => id === 'bytes' || id === 'avg';      // exact sizes arrive with the titles
    const dimOpts = (sel, allowAll) => `${allowAll ? `<option value="all"${sel === 'all' ? ' selected' : ''}>${__('Nothing (one column)')}</option>` : ''}${GROUPS.map(g => `<optgroup label="${esc(__(g.label))}">${S.facets.filter(f => f.group === g.id).map(f => `<option value="${f.id}"${sel === f.id ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</optgroup>`).join('')}`;
    const norm = m.noNorm ? 'none' : p.norm;
    // colour scale
    let maxT = 0;
    const cells = M.rows.map(r => M.cols.map(c => pivotCell(M, r, c)));
    if (norm === 'lift') maxT = 4;
    else for (const row of cells) for (const c of row) if (!c.empty && c.t > maxT) maxT = c.t;
    const paint = c => {
      if (c.empty) return '';
      if (norm === 'lift') { const t = clamp(Math.log2(c.lift) / 2, -1, 1), k = Color.div(t); return `background:${k.bg};color:${k.fg}`; }
      const t = Math.sqrt(clamp(c.t / (maxT || 1), 0, 1)), k = Color.seq(t); return `background:${k.bg};color:${k.fg}`;
    };
    const colName = c => S.dimName(X.C, c), rowName = r => S.dimName(X.R, r);
    const head = `<tr><th class="corner">${esc(X.R.label)}${M.hasCol ? ` / ${esc(X.C.label)}` : ''}</th>${M.cols.map(c => `<th title="${esc(colName(c))}">${esc(colName(c))}</th>`).join('')}${M.hasCol && p.totals ? `<th>${__('Total')}</th>` : ''}</tr>`;
    const body = M.rows.map((r, ri) => `<tr><th title="${esc(rowName(r))}">${esc(rowName(r))}</th>${M.cols.map((c, ci) => {
      const cell = cells[ri][ci], tk = Tip.tk(() => tipBox(`${rowName(r)}${M.hasCol ? ' / ' + colName(c) : ''}`, [[__(m.label), m.fmt(cell.raw ?? 0)], [__('Share of row'), X.rowTot[r] ? pct(cell.raw || 0, X.rowTot[r]) : __('n/a')], ...(M.hasCol ? [[__('Share of column'), X.colTot[c] ? pct(cell.raw || 0, X.colTot[c]) : __('n/a')]] : []), [__('Share of total'), X.grand ? pct(cell.raw || 0, X.grand) : __('n/a')]], __('Click to filter to this cell and open Browse.')));
      return `<td class="${cell.empty ? 'empty' : ''}" style="${paint(cell)}" tabindex="0" data-act="cell" data-r="${r}" data-c="${c}" data-tk="${tk}">${esc(cell.text)}</td>`;
    }).join('')}${M.hasCol && p.totals ? `<td class="tot">${esc(norm === 'none' ? m.fmt(X.rowTot[r]) : norm === 'lift' ? '' : norm === 'row' ? '100%' : pct(X.rowTot[r], X.grand, 0))}</td>` : ''}</tr>`).join('');
    const foot = p.totals && M.hasCol ? `<tr class="tot"><th>${__('Total')}</th>${M.cols.map(c => `<td class="tot">${esc(norm === 'none' ? m.fmt(X.colTot[c]) : norm === 'lift' ? '' : norm === 'col' ? '100%' : pct(X.colTot[c], X.grand, 0))}</td>`).join('')}<td class="tot">${esc(norm === 'none' ? m.fmt(X.grand) : '')}</td></tr>` : '';
    const sqlq = S.pivotSql(p.row, p.col === 'all' ? null : p.col, m.id);
    const multi = ['reg', 'flag'].includes(p.row) || ['reg', 'flag'].includes(p.col);
    const notes = [M.hiddenR || M.hiddenC ? __('Showing {rows} of {totalRows} rows and {cols} of {totalCols} columns.', { rows: M.rows.length, totalRows: M.rows.length + M.hiddenR, cols: M.cols.length, totalCols: M.cols.length + M.hiddenC }) : '',
      multi ? __('Region and flags can hold several values per entry, so an entry counts once in every cell it belongs to and totals can be smaller than the sum of the cells.') : '',
      M.waiting ? __('The exact sizes are still arriving, so this shows links.') : '', m.id === 'bytes' || m.id === 'avg' ? __('Suspect sizes are left out.') : ''].filter(Boolean);
    const scale = norm === 'lift'
      ? `<div class="scale"><span>${__('fewer than expected')}</span><span class="ramp" style="background:linear-gradient(90deg,${Color.div(-1).bg},${Color.div(0).bg},${Color.div(1).bg})"></span><span>${__('more')}</span></div>`
      : `<div class="scale"><span>${norm === 'none' ? m.fmt(0) : '0%'}</span><span class="ramp" style="background:linear-gradient(90deg,${Color.seq(0).bg},${Color.seq(0.5).bg},${Color.seq(1).bg})"></span><span>${norm === 'none' ? m.fmt(maxT) : fmtD(maxT * 100, 0) + '%'}</span></div>`;
    root.innerHTML = `<div class="card">
      <div class="card-h"><div><h3>${__('Dice the catalogue')}</h3><p>${__('Pick any two dimensions. Everything here follows the slice on the left, so slice first, then dice.')}</p></div></div>
      <div class="presets" style="margin-bottom:14px">${PV_PRESETS.map((q, i) => `<button class="preset" data-act="pvpreset" data-i="${i}"${sizeWait && needsSize(q.measure) ? ' disabled' : ''}>${esc(__(q.label))}</button>`).join('')}</div>
      <div class="pv-controls">
        <div class="field"><label for="pv-row">${__('Rows')}</label><select id="pv-row" data-pv="row">${dimOpts(p.row, false)}</select></div>
        <div class="field"><label for="pv-col">${__('Columns')}</label><select id="pv-col" data-pv="col">${dimOpts(p.col, true)}</select></div>
        <div class="field"><label for="pv-m">${__('Measure')}</label><select id="pv-m" data-pv="measure">${PV_MEASURES.map(x => `<option value="${x.id}"${m.id === x.id ? ' selected' : ''}${sizeWait && needsSize(x.id) ? ' disabled' : ''}>${esc(sizeWait && needsSize(x.id) ? __('{measure} (loading)', { measure: __(x.label) }) : __(x.label))}</option>`).join('')}</select></div>
        <div class="field"><label for="pv-n">${__('Show as')}</label><select id="pv-n" data-pv="norm" ${m.noNorm ? 'disabled' : ''}>${PV_NORMS.map(([k, l]) => `<option value="${k}"${norm === k ? ' selected' : ''}>${esc(__(l))}</option>`).join('')}</select></div>
        <div class="field"><label for="pv-s">${__('Sort rows')}</label><select id="pv-s" data-pv="sort">${[['value', __('Largest first')], ['label', __('A to Z')], ['natural', __('Natural order')]].map(([k, l]) => `<option value="${k}"${p.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label for="pv-t">${__('Show')}</label><select id="pv-t" data-pv="top">${[[10, __('Top {n}', { n: 10 })], [20, __('Top {n}', { n: 20 })], [50, __('Top {n}', { n: 50 })], [0, __('Everything')]].map(([k, l]) => `<option value="${k}"${p.top === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="pv-actions"><button class="btn sm" data-act="pvswap">${icon('swap', 14)}${__('Swap axes')}</button>
        <label style="display:inline-flex;align-items:center;gap:6px;color:var(--ink-2)"><input type="checkbox" id="pv-tot" data-pv="totals" ${p.totals ? 'checked' : ''}> ${__('Totals')}</label>
        <span style="flex:1"></span>${scale}
        <button class="btn sm" data-act="pvcopy">${icon('copy', 13)}${__('Copy table')}</button></div>
      ${M.rows.length ? `<div class="heat-wrap"><table class="heat"><thead>${head}</thead><tbody>${body}${foot}</tbody></table></div>` : `<div class="vt-empty">${__('Nothing in this slice to tabulate.')}</div>`}
      <div class="muted" style="margin-top:10px;font-size:12px">${esc(notes.join(' '))}</div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-h"><div><h3>${__('SQL behind this table')}</h3><p>${sqlq.exact === false ? __('This combination has no single query.') : __('Run it in any SQLite client against romdb.db.')}</p></div>
      <div class="acts"><button class="btn sm" data-act="copy" data-text="${esc(sqlq.text)}">${icon('copy', 13)}${__('Copy')}</button>${App.sqlOK() ? `<button class="btn sm primary" data-act="to-sql" data-sql="${esc(sqlq.text)}">${icon('term', 13)}${__('Open in SQL')}</button>` : ''}</div></div>
      <div class="codebox"><pre>${hiSQL(sqlq.text)}</pre></div></div>`;
    this.M = M;
  },
  after(root) {
    if (root._pv) return;
    root._pv = true;
    root.addEventListener('change', e => {
      const k = e.target.dataset.pv; if (!k) return;
      const p = App.ui.pivot;
      p[k] = e.target.type === 'checkbox' ? e.target.checked : (k === 'top' ? +e.target.value : e.target.value);
      if (k === 'measure') { const m = PV_MEASURES.find(x => x.id === p.measure); if (m.noNorm) p.norm = 'none'; }
      App.saveUI(); App.renderView();
    });
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.act === 'cell') App.act(e.target, e); });
  },
};
Object.assign(App.handlers, {
  pvpreset(el) { const q = PV_PRESETS[+el.dataset.i]; Object.assign(App.ui.pivot, { row: q.row, col: q.col, measure: q.measure, norm: 'none' }); App.saveUI(); App.renderView(); },
  pvswap() { const p = App.ui.pivot; if (p.col === 'all') return toast(__('Pick a column dimension first.')); [p.row, p.col] = [p.col, p.row]; App.saveUI(); App.renderView(); },
  pvcopy() {
    const M = App.views.dice.M; if (!M || !M.rows.length) return;
    const { X, m } = M, p = App.ui.pivot;
    const head = [X.R.label, ...M.cols.map(c => App.S.dimName(X.C, c)), ...(M.hasCol ? [__('Total')] : [])].join('\t');
    const lines = M.rows.map(r => [App.S.dimName(X.R, r), ...M.cols.map(c => pivotCell(M, r, c).text), ...(M.hasCol ? [m.fmt(X.rowTot[r])] : [])].join('\t'));
    copyText([head, ...lines].join('\n'), __('Copied the table as tab-separated text'));
  },
  cell(el) {
    const M = App.views.dice.M, { X, m, p } = M, S = App.S, r = +el.dataset.r, c = +el.dataset.c;
    const rf = X.R.id, cf = X.C.id;
    S.state.f = {}; S.state.q = ''; $('#q').value = '';
    S.fs(rf).inc = new Set([r]);
    if (cf !== 'all') S.fs(cf).inc = new Set([c]);
    S.state.grain = m.grain; store.set('grain', m.grain);
    S.changed();
    App.show('browse');
  },
});
