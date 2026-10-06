/*
 * SQL console engine for the hosted site: SQLite (sql.js, WebAssembly) running in a worker, on the link-free copy of romgi's catalogue.
 * The page talks to it with messages; it never touches the network except to fetch that one database file once (then it is kept in
 * the browser's cache). The same functions run under Node in tests/sqlconsole.test.js.
 */
'use strict';

const SAFE_PRAGMAS = new Set(['table_info', 'table_xinfo', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list', 'page_count',
  'page_size', 'quick_check', 'database_list', 'table_list', 'user_version', 'schema_version', 'encoding']);
const READ_ONLY = 'Only read-only SELECT statements are allowed here.';

/** Only reads: a SELECT-like statement, or one of a few harmless PRAGMAs. (query_only is on as well, so a write could not succeed anyway.) */
function checkSql(sql) {
  const m = /^\s*(?:(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)\s*)*([A-Za-z]+)(?:\s+(?:[A-Za-z_]+\.)?([A-Za-z_]+))?/.exec(sql);
  const word = m && m[1].toUpperCase();
  if (word === 'PRAGMA') return SAFE_PRAGMAS.has((m[2] || '').toLowerCase()) ? null : READ_ONLY;
  return ['SELECT', 'WITH', 'EXPLAIN', 'VALUES'].includes(word) ? null : READ_ONLY;
}

const cell = v => (v instanceof Uint8Array ? `<blob ${v.length} bytes>` : v);

/** Run the first statement of `sql`, return up to `limit` rows in the shape the console draws: {cols, rows, truncated, ms} or {error}. */
function runQuery(db, sql, limit) {
  const bad = checkSql(sql);
  if (bad) return { error: bad };
  const t0 = performance.now();
  let stmt;
  try {
    stmt = db.prepare(sql);
    const cols = stmt.getColumnNames(), rows = [];
    let truncated = false;
    while (stmt.step()) {
      if (rows.length >= limit) { truncated = true; break; }
      rows.push(stmt.get().map(cell));
    }
    return { cols, rows, truncated, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { error: /readonly database|not authorized/i.test(msg) ? READ_ONLY : msg };
  } finally { if (stmt) stmt.free(); }
}

function toCsv(cols, rows) {
  const q = v => (v === null ? '' : typeof v === 'number' ? String(v) : /[",\r\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  return [cols.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------ the worker itself */
if (typeof importScripts === 'function') {
  let db = null;
  const post = m => self.postMessage(m);

  /** The saved copy if there is one, else the network (keeping a copy for next time and dropping older ones). */
  async function fetchDb(url) {
    let cache = null;
    try { cache = await caches.open('romgi-sql'); } catch { /* private windows may refuse */ }
    if (cache) {
      const hit = await cache.match(url);
      if (hit) { post({ type: 'phase', text: 'Opening the copy saved in your browser' }); return hit; }
    }
    const r = await fetch(url);
    if (!r.ok) throw new Error('The database file answered ' + r.status);
    if (cache) cache.put(url, r.clone()).then(async () => { for (const k of await cache.keys()) if (k.url !== url) await cache.delete(k); }).catch(() => {});
    return r;
  }

  async function open(m) {
    post({ type: 'phase', text: 'Starting SQLite' });
    importScripts(m.sqljs + 'sql-wasm.js');
    const SQL = await initSqlJs({ locateFile: f => m.sqljs + f });
    const r = await fetchDb(m.db);
    const total = +r.headers.get('content-length') || m.gz;
    let got = 0, used = 0, buf = new Uint8Array(m.bytes + (1 << 20));
    const meter = new TransformStream({ transform(chunk, ctl) { got += chunk.length; post({ type: 'progress', got, total }); ctl.enqueue(chunk); } });
    const reader = r.body.pipeThrough(meter).pipeThrough(new DecompressionStream('gzip')).getReader();
    post({ type: 'phase', text: 'Downloading the database' });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (used + value.length > buf.length) { const bigger = new Uint8Array(Math.max(buf.length * 2, used + value.length)); bigger.set(buf.subarray(0, used)); buf = bigger; }
      buf.set(value, used); used += value.length;
    }
    post({ type: 'phase', text: 'Opening the database' });
    db = new SQL.Database(buf.subarray(0, used));
    buf = null;
    db.run('PRAGMA query_only = 1');
    post({ type: 'ready', entries: db.exec('SELECT COUNT(*) FROM entries')[0].values[0][0] });
  }

  self.onmessage = async ({ data: m }) => {
    try {
      if (m.type === 'open') await open(m);
      else if (m.type === 'run') post({ type: 'result', id: m.id, ...runQuery(db, m.sql, m.limit) });
      else if (m.type === 'csv') {
        const out = runQuery(db, m.sql, 500000);
        post(out.error ? { type: 'csv', id: m.id, error: out.error } : { type: 'csv', id: m.id, csv: toCsv(out.cols, out.rows), rows: out.rows.length, truncated: out.truncated });
      }
    } catch (e) { post({ type: 'failed', id: m.id, error: String((e && e.message) || e) }); }
  };
}

if (typeof module !== 'undefined') module.exports = { checkSql, runQuery, toCsv };
