/* ============================================================ sql: a read-only console on the real database (local only) */

const SQL_HIST_KEY = 'sqlhist';
function sqlCell(v) {
  if (v === null) return '<td class="nul">NULL</td>';
  if (typeof v === 'number') return `<td class="r num">${Number.isInteger(v) ? fmtN(v) : esc(String(v))}</td>`;
  const s = String(v), long = s.length > 140;
  return `<td${long ? ` title="${esc(s.slice(0, 600))}"` : ''}>${esc(long ? s.slice(0, 140) + '…' : s)}</td>`;
}
function sqlResultHTML(out) {
  if (!out) return `<div class="vt-empty">Run a query to see rows here.</div>`;
  if (out.error) return `<div class="notice" style="margin:14px">${icon('alert', 16)}<div>${esc(out.error)}</div></div>`;
  if (!out.cols.length) return '<div class="vt-empty">The statement ran and returned no columns.</div>';
  const shown = out.rows.slice(0, 2000);
  return `<div class="sql-meta"><span class="num">${fmtN(out.rows.length)}${out.truncated ? '+' : ''} rows</span><span class="muted">in ${out.ms} ms</span>${out.truncated ? '<span class="pill warn">Stopped at the row limit</span>' : ''}${out.rows.length > 2000 ? '<span class="muted">showing the first 2,000</span>' : ''}<span style="flex:1"></span>
      <button class="btn sm" data-act="sqlcopy">${icon('copy', 13)}Copy</button><button class="btn sm" data-act="sqlcsv">${icon('download', 13)}CSV</button></div>
    <div class="sql-scroll"><table class="sql-t"><thead><tr>${out.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${shown.map(r => `<tr>${r.map(sqlCell).join('')}</tr>`).join('')}</tbody></table></div>`;
}

App.views.sql = {
  render(root) {
    const { D } = App, local = D.caps.sql, ex = D.raw.examples;
    const text = App.ui.sqlText || ex[0].sql;
    const tables = D.raw.schema.filter(t => t.kind !== 'shadow');
    const hist = store.get(SQL_HIST_KEY, []);
    root.innerHTML = `<div class="sql-grid">
      <div class="sql-main">
        <div class="card"><div class="card-h"><div><h3>SQL console</h3><p>${local ? 'Read-only on romdb.db. One SELECT at a time, 20 seconds at most.' : 'Runs only when the explorer is started on your machine, because it needs the database file.'}</p></div>
          <div class="acts">${local ? `<select id="sql-limit" aria-label="Row limit">${[100, 500, 2000, 20000].map(n => `<option value="${n}"${(App.ui.sqlLimit || 500) === n ? ' selected' : ''}>${fmtN(n)} rows</option>`).join('')}</select>
            <button class="btn primary" data-act="sqlrun">${icon('play', 13)}Run <span class="kbd" style="margin-left:4px;color:inherit;border-color:rgba(255,255,255,.35);background:transparent">${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'} ↵</span></button>` : ''}</div></div>
          <textarea id="sql-in" class="sql-in" spellcheck="false" aria-label="SQL query" ${local ? '' : 'readonly'}>${esc(text)}</textarea>
          ${local ? '' : `<div class="notice info" style="margin-top:12px">${icon('info', 16)}<div><b>Run it locally.</b> Start the explorer with <span class="mono">python3 serve.py --db romdb.db</span> and this console runs against the full database, including file names and URLs. The examples on the right work in any SQLite client.</div></div>`}
        </div>
        <div class="card flush" id="sql-out" style="margin-top:14px">${sqlResultHTML(App._sql)}</div>
      </div>
      <aside class="sql-side">
        <div class="card"><div class="card-h"><div><h3>Examples</h3></div></div><div class="ex-list">${ex.map((e, i) => `<button class="ex" data-act="sqlex" data-i="${i}"><b>${esc(e.title)}</b><span>${esc(e.note)}</span></button>`).join('')}</div></div>
        <div class="card"><div class="card-h"><div><h3>Tables</h3><p>Click a name to use it.</p></div></div>${tables.map(t => `<details class="tb"><summary><span class="mono">${esc(t.name)}</span><span class="muted num">${t.rows == null ? '' : fmtN(t.rows)}</span></summary>${t.columns.map(c => `<button class="col" data-act="sqlcol" data-t="${esc(t.name)}" data-c="${esc(c.name)}"><span class="mono">${esc(c.name)}</span><span class="muted">${esc(c.type || '')}${c.pk ? ' pk' : ''}</span></button>`).join('')}<button class="btn sm ghost" style="margin:4px 0 0 8px" data-act="sqltbl" data-t="${esc(t.name)}">SELECT * FROM ${esc(t.name)}</button></details>`).join('')}</div>
        ${hist.length && local ? `<div class="card"><div class="card-h"><div><h3>Recent</h3></div></div><div class="ex-list">${hist.map((h, i) => `<button class="ex" data-act="sqlhist" data-i="${i}"><span class="mono" style="color:var(--ink-2)">${esc(h.replace(/\s+/g, ' ').slice(0, 90))}</span></button>`).join('')}</div></div>` : ''}
      </aside></div>`;
  },
  after(root) {
    const ta = $('#sql-in', root); if (!ta || ta._bound) return;
    ta._bound = true;
    ta.addEventListener('input', debounce(() => { App.ui.sqlText = ta.value; App.saveUI(); }, 300));
    ta.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); App.handlers.sqlrun(); }
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
    });
    $('#sql-limit', root)?.addEventListener('change', e => { App.ui.sqlLimit = +e.target.value; App.saveUI(); });
    if (App._sqlAuto) { App._sqlAuto = false; App.handlers.sqlrun(); }
  },
};
async function sqlFetch(path, sql, limit) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Romgi': '1' }, body: JSON.stringify({ sql, limit }) });
  return r;
}
Object.assign(App.handlers, {
  async sqlrun() {
    if (!App.D.caps.sql) return toast('The SQL console needs the local explorer.');
    const ta = $('#sql-in'), sql = ta.value.trim(); if (!sql) return;
    const out = $('#sql-out'); out.innerHTML = '<div class="vt-empty">Running…</div>';
    try {
      const r = await sqlFetch('/api/sql', sql, App.ui.sqlLimit || 500);
      App._sql = await r.json(); App._sql.sql = sql;
      const hist = [sql, ...store.get(SQL_HIST_KEY, []).filter(x => x !== sql)].slice(0, 12); store.set(SQL_HIST_KEY, hist);
    } catch (e) { App._sql = { error: 'Could not reach the local server: ' + e.message }; }
    out.innerHTML = sqlResultHTML(App._sql);
  },
  sqlex(el) { const e = App.D.raw.examples[+el.dataset.i]; App.ui.sqlText = e.sql; $('#sql-in').value = e.sql; App.saveUI(); $('#sql-in').focus(); },
  sqlhist(el) { const h = store.get(SQL_HIST_KEY, [])[+el.dataset.i]; if (h) { $('#sql-in').value = h; App.ui.sqlText = h; App.saveUI(); } },
  sqltbl(el) { const q = `SELECT * FROM ${el.dataset.t} LIMIT 50;`; $('#sql-in').value = q; App.ui.sqlText = q; App.saveUI(); },
  sqlcol(el) { const ta = $('#sql-in'); if (ta.readOnly) return; ta.setRangeText(el.dataset.c, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); },
  sqlcopy() {
    const o = App._sql; if (!o || o.error) return;
    copyText([o.cols.join('\t'), ...o.rows.slice(0, 5000).map(r => r.map(v => (v === null ? '' : String(v).replace(/[\t\n]/g, ' '))).join('\t'))].join('\n'), 'Copied as tab-separated text');
  },
  async sqlcsv() {
    const o = App._sql; if (!o || !o.sql) return;
    try { const r = await sqlFetch('/api/sqlcsv', o.sql, 0); if (!r.ok) return toast('The export failed.'); downloadText('romgi-query.csv', await r.text()); toast('CSV saved'); } catch { toast('The export failed.'); }
  },
});
