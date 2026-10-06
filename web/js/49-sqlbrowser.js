/* ============================================================ the SQL console in the browser: a worker running SQLite on a link-free copy of the catalogue */

const Live = {
  cfg: window.ROMGI.sql || null,
  state: 'idle',               // idle | loading | ready | failed
  worker: null, ready: null, pending: new Map(), seq: 0, phase: '', progress: null, error: '',

  get available() { return !!this.cfg && window.ROMGI.mode !== 'local' && typeof Worker !== 'undefined' && typeof DecompressionStream !== 'undefined'; },
  abs(u) { return new URL(u, location.href).href; },

  /** Start the worker and load the database (once). The promise resolves when queries can run. */
  start() {
    if (this.ready) return this.ready;
    this.state = 'loading'; this.error = ''; this.phase = 'Starting'; this.progress = null;
    const gate = this.ready = new Promise((resolve, reject) => {
      let w;
      try { w = this.worker = new Worker(this.abs(this.cfg.worker)); } catch (e) { return reject(e); }
      w.onmessage = ({ data: m }) => {
        if (m.type === 'phase') { this.phase = m.text; this.paint(); }
        else if (m.type === 'progress') { this.progress = [m.got, m.total]; this.paint(); }
        else if (m.type === 'ready') { this.state = 'ready'; resolve(); App.sqlReady(); }
        else if (m.type === 'failed' && m.id === undefined) reject(new Error(m.error));
        else if (m.id !== undefined) { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); clearTimeout(p.timer); p.resolve(m); } }
      };
      w.onerror = e => reject(new Error(e.message || 'The SQL engine could not start.'));
      w.postMessage({ type: 'open', db: this.abs(this.cfg.db), sqljs: this.abs(this.cfg.sqljs), bytes: this.cfg.bytes, gz: this.cfg.gz });
    });
    gate.catch(e => this.fail(e));
    return gate;
  },
  fail(e) { this.stop(); this.state = 'failed'; this.error = e.message || String(e); this.paint(); },
  stop() {
    if (this.worker) this.worker.terminate();
    this.worker = null; this.ready = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve({ error: 'The SQL engine was stopped.' }); }
    this.pending.clear();
  },
  /** One request at a time reaches the worker; a query that outlives its time is stopped by stopping the worker. */
  ask(msg, ms) {
    return new Promise(resolve => {
      if (!this.worker) return resolve({ error: 'The database is not loaded.' });
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id); this.stop(); this.state = 'idle';
        resolve({ error: `The query ran for more than ${ms / 1000} seconds and was stopped. The database reopens from the copy saved in your browser on the next run.` });
        App.sqlReady();
      }, ms);
      this.pending.set(id, { resolve, timer });
      this.worker.postMessage({ ...msg, id });
    });
  },
  async run(sql, limit) {
    const m = await this.ask({ type: 'run', sql, limit }, 20000);
    return m.error ? { error: m.error } : { cols: m.cols, rows: m.rows, truncated: m.truncated, ms: m.ms };
  },
  csv(sql) { return this.ask({ type: 'csv', sql }, 60000); },
  paint() { App.views.sql.paintLoad(); },
};

Object.assign(App, {
  /** Can this page run SQL at all: against the local server, or in the browser? */
  sqlOK() { return !!this.D.caps.sql || Live.available; },
  /** The engine finished loading, or was stopped: redraw the console if it is showing. */
  sqlReady() { if (this.ui.view === 'sql') this.renderView(); },
});

/** Progress while the database loads, or why it could not. Drawn into the results area. */
App.views.sql.paintLoad = function () {
  const out = $('#sql-out');
  if (!out || App.ui.view !== 'sql') return;
  if (Live.state === 'loading') {
    const [got, total] = Live.progress || [0, 0], p = total ? Math.min(1, got / total) : 0, mb = x => (x / 1e6).toFixed(1);
    out.innerHTML = `<div class="meter" style="margin:18px" role="status"><div class="mh"><span>${esc(Live.phase)}</span><span class="num">${total ? `${mb(got)} of ${mb(total)} MB` : ''}</span></div>
      <div class="mt" role="progressbar" aria-label="Database download" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"><i style="width:${(p * 100).toFixed(1)}%"></i></div></div>`;
  } else if (Live.state === 'failed') out.innerHTML = sqlLoadFailedHTML();
};
const sqlLoadFailedHTML = () => `<div class="notice" style="margin:14px">${icon('alert', 16)}<div><b>The database could not be loaded.</b> ${esc(Live.error)} <button class="btn sm" data-act="sqlload" style="margin-left:6px">Try again</button></div></div>`;
const sqlLoadNoticeHTML = () => `<div class="notice info" style="margin-top:12px">${icon('info', 16)}<div><b>Run SQL right here.</b> The first run downloads a copy of the catalogue (${fmtBytes(Live.cfg.gz)}) and opens it with SQLite in your browser. It is kept in your browser afterwards and nothing leaves your device. Download links are emptied in this copy; the local explorer has them. It needs about 400 MB of memory, so a desktop browser is best. <button class="btn sm primary" data-act="sqlload" style="margin-left:6px">Load the database</button></div></div>`;
Object.assign(App.handlers, { sqlload() { Live.start().catch(() => {}); App.renderView(); } });   // the redraw swaps the notice for the progress bar
