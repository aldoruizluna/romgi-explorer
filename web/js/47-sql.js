/* ============================================================ sql: a read-only console, on the real database (local explorer) or a link-free copy of it (the hosted site, in the browser) */

const SQL_HIST_KEY = 'sqlhist';
function sqlCell(v) {
  if (v === null) return '<td class="nul">NULL</td>';
  if (typeof v === 'number') return `<td class="r num">${Number.isInteger(v) ? fmtN(v) : esc(String(v))}</td>`;
  const s = String(v), long = s.length > 140;
  return `<td${long ? ` title="${esc(s.slice(0, 600))}"` : ''}>${esc(long ? s.slice(0, 140) + '…' : s)}</td>`;
}
function sqlResultHTML(out) {
  if (!out) return `<div class="vt-empty">${__('Run a query to see rows here.')}</div>`;
  if (out.error) return `<div class="notice" style="margin:14px">${icon('alert', 16)}<div>${esc(out.error)}</div></div>`;
  if (!out.cols.length) return `<div class="vt-empty">${__('The statement ran and returned no columns.')}</div>`;
  const shown = out.rows.slice(0, 2000);
  return `<div class="sql-meta"><span class="num">${esc(out.truncated ? __('{n}+ rows', { n: out.rows.length }) : __n(out.rows.length, '{n} row|{n} rows'))}</span><span class="muted">${esc(__('in {ms} ms', { ms: out.ms }))}</span>${out.truncated ? `<span class="pill warn">${__('Stopped at the row limit')}</span>` : ''}${out.rows.length > 2000 ? `<span class="muted">${esc(__('showing the first {n}', { n: 2000 }))}</span>` : ''}<span style="flex:1"></span>
      <button class="btn sm" data-act="sqlcopy">${icon('copy', 13)}${__('Copy')}</button><button class="btn sm" data-act="sqlcsv">${icon('download', 13)}CSV</button></div>
    <div class="sql-scroll"><table class="sql-t"><thead><tr>${out.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${shown.map(r => `<tr>${r.map(sqlCell).join('')}</tr>`).join('')}</tbody></table></div>`;
}

App.views.sql = {
  render(root) {
    const { D } = App, local = D.caps.sql, live = !local && Live.available, can = local || live, ready = local || Live.state === 'ready', ex = D.raw.examples;
    const text = App.ui.sqlText || ex[0].sql;
    const tables = D.raw.schema.filter(t => t.kind !== 'shadow');
    const hist = store.get(SQL_HIST_KEY, []);
    root.innerHTML = `<div class="sql-grid">
      <div class="sql-main">
        <div class="card"><div class="card-h"><div><h3>${__('SQL console')}</h3><p>${esc(local ? __('Read-only on romdb.db. One SELECT at a time, 20 seconds at most.') : live ? (ready ? __('Read-only, in your browser, on a copy of the catalogue with the download links emptied. One SELECT at a time, 20 seconds at most.') : __('Runs SQLite in your browser on a copy of the catalogue with the download links emptied. The first run downloads it ({size}) and keeps it in your browser.', { size: fmtBytes(Live.cfg.gz) })) : __('Runs only when the explorer is started on your machine, because it needs the database file.'))}</p></div>
          <div class="acts">${can ? `<select id="sql-limit" aria-label="${esc(__('Row limit'))}">${[100, 500, 2000, 20000].map(n => `<option value="${n}"${(App.ui.sqlLimit || 500) === n ? ' selected' : ''}>${esc(__n(n, '{n} row|{n} rows'))}</option>`).join('')}</select>
            <button class="btn primary" data-act="sqlrun">${icon('play', 13)}${__('Run')} <span class="kbd" style="margin-left:4px;color:inherit;border-color:rgba(255,255,255,.35);background:transparent">${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'} ↵</span></button>` : ''}</div></div>
          <textarea id="sql-in" class="sql-in" spellcheck="false" aria-label="${esc(__('SQL query'))}" ${can ? '' : 'readonly'}>${esc(text)}</textarea>
          ${can ? (ready ? '' : Live.state === 'failed' ? '' : Live.state === 'loading' ? '' : sqlLoadNoticeHTML()) : `<div class="notice info" style="margin-top:12px">${icon('info', 16)}<div>${__h('<b>Run it locally.</b> Get the explorer from {link} and start it with {command}; this console then runs against the full database, including file names and URLs. The examples on the right work in any SQLite client.', { link: raw('<a href="https://github.com/aldoruizluna/romgi-explorer" target="_blank" rel="noopener">github.com/aldoruizluna/romgi-explorer</a>'), command: raw('<span class="mono">./run.sh</span>') })}</div></div>`}
        </div>
        <div class="card flush" id="sql-out" style="margin-top:14px">${live && Live.state === 'failed' ? sqlLoadFailedHTML() : sqlResultHTML(App._sql)}</div>
      </div>
      <aside class="sql-side">
        <div class="card"><div class="card-h"><div><h3>${__('Examples')}</h3></div></div><div class="ex-list">${ex.map((e, i) => `<button class="ex" data-act="sqlex" data-i="${i}"><b>${esc(__(e.title))}</b><span>${esc(__(e.note))}</span></button>`).join('')}</div></div>
        <div class="card"><div class="card-h"><div><h3>${__('Tables')}</h3><p>${__('Click a name to use it.')}</p></div></div>${tables.map(t => `<details class="tb"><summary><span class="mono">${esc(t.name)}</span><span class="muted num">${t.rows == null ? '' : fmtN(t.rows)}</span></summary>${t.columns.map(c => `<button class="col" data-act="sqlcol" data-t="${esc(t.name)}" data-c="${esc(c.name)}"><span class="mono">${esc(c.name)}</span><span class="muted">${esc(c.type || '')}${c.pk ? ' pk' : ''}</span></button>`).join('')}<button class="btn sm ghost" style="margin:4px 0 0 8px" data-act="sqltbl" data-t="${esc(t.name)}">SELECT * FROM ${esc(t.name)}</button></details>`).join('')}</div>
        ${hist.length && can ? `<div class="card"><div class="card-h"><div><h3>${__('Recent')}</h3></div></div><div class="ex-list">${hist.map((h, i) => `<button class="ex" data-act="sqlhist" data-i="${i}"><span class="mono" style="color:var(--ink-2)">${esc(h.replace(/\s+/g, ' ').slice(0, 90))}</span></button>`).join('')}</div></div>` : ''}
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
    if (Live.state === 'loading') App.views.sql.paintLoad();
    if (App._sqlAuto) { App._sqlAuto = false; App.handlers.sqlrun(); }
  },
};
async function sqlFetch(path, sql, limit) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Romgi': '1' }, body: JSON.stringify({ sql, limit }) });
  return r;
}
Object.assign(App.handlers, {
  async sqlrun() {
    const local = App.D.caps.sql;
    if (!App.sqlOK()) return toast(__('The SQL console needs the local explorer or a browser that can run workers.'));
    const ta = $('#sql-in'), sql = ta.value.trim(); if (!sql) return;
    if (!local && Live.state !== 'ready') {
      App.ui.sqlText = ta.value;
      const loading = Live.start(); App.renderView();         // the redraw swaps the notice for the progress bar
      try { await loading; } catch { return; }                // the reason is already drawn in the results area
      if (!$('#sql-out')) return;
    }
    $('#sql-out').innerHTML = `<div class="vt-empty">${__('Running…')}</div>`;
    try {
      App._sql = local ? await (await sqlFetch('/api/sql', sql, App.ui.sqlLimit || 500)).json() : await Live.run(sql, App.ui.sqlLimit || 500);
      App._sql.sql = sql;
      const hist = [sql, ...store.get(SQL_HIST_KEY, []).filter(x => x !== sql)].slice(0, 12); store.set(SQL_HIST_KEY, hist);
    } catch (e) { App._sql = { error: __('Could not reach the local server: {reason}', { reason: e.message }) }; }
    const out = $('#sql-out'); if (out) out.innerHTML = sqlResultHTML(App._sql);
  },
  sqlex(el) { const e = App.D.raw.examples[+el.dataset.i]; App.ui.sqlText = e.sql; $('#sql-in').value = e.sql; App.saveUI(); $('#sql-in').focus(); },
  sqlhist(el) { const h = store.get(SQL_HIST_KEY, [])[+el.dataset.i]; if (h) { $('#sql-in').value = h; App.ui.sqlText = h; App.saveUI(); } },
  sqltbl(el) { const q = `SELECT * FROM ${el.dataset.t} LIMIT 50;`; $('#sql-in').value = q; App.ui.sqlText = q; App.saveUI(); },
  sqlcol(el) { const ta = $('#sql-in'); if (ta.readOnly) return; ta.setRangeText(el.dataset.c, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); },
  sqlcopy() {
    const o = App._sql; if (!o || o.error) return;
    copyText([o.cols.join('\t'), ...o.rows.slice(0, 5000).map(r => r.map(v => (v === null ? '' : String(v).replace(/[\t\n]/g, ' '))).join('\t'))].join('\n'), __('Copied as tab-separated text'));
  },
  async sqlcsv() {
    const o = App._sql; if (!o || !o.sql) return;
    try {
      if (App.D.caps.sql) { const r = await sqlFetch('/api/sqlcsv', o.sql, 0); if (!r.ok) return toast(__('The export failed.')); downloadText('romgi-query.csv', await r.text()); }
      else { const m = await Live.csv(o.sql); if (m.error) return toast(__('The export failed.')); downloadText('romgi-query.csv', m.csv); }
      toast(__('CSV saved'));
    } catch { toast(__('The export failed.')); }
  },
});
