#!/usr/bin/env node
/*
 * The hosted SQL console: the worker's own functions (statement check, query runner, CSV) on the link-free copy, with sql.js.
 * Every example the console offers must run, within the 20 seconds the page allows.
 *
 *   node tests/sqlconsole.test.js <livedb.sqlite.gz> <folder with sql-wasm.js> <dataset.json.gz>
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const [, , dbGz, sqljsDir, dsGz] = process.argv;
const { checkSql, runQuery, toCsv } = require('../web/worker/sql-worker.js');
const initSqlJs = require(path.resolve(sqljsDir, 'sql-wasm.js'));

let checks = 0, fails = 0;
const ok = (name, cond, detail = '') => { checks++; if (!cond) { fails++; console.log(`FAIL ${name} ${detail}`); } };

(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.resolve(sqljsDir, f) });
  const bytes = zlib.gunzipSync(fs.readFileSync(dbGz));
  const db = new SQL.Database(bytes);
  db.run('PRAGMA query_only = 1');
  const ds = JSON.parse(zlib.gunzipSync(fs.readFileSync(dsGz)).toString('utf8'));

  // what may run
  for (const s of ['SELECT 1', ' select 1', 'WITH x AS (SELECT 1) SELECT * FROM x', 'EXPLAIN QUERY PLAN SELECT 1', 'VALUES (1)', '-- note\nSELECT 1', '/* a */ SELECT 1',
    'PRAGMA table_info(entries)', 'pragma main.table_info(links)']) ok(`allowed: ${s.replace(/\n/g, ' ')}`, checkSql(s) === null);
  for (const s of ['UPDATE links SET size = 0', 'DELETE FROM links', 'INSERT INTO entries VALUES (1)', 'DROP TABLE links', 'ATTACH DATABASE \'x\' AS y', 'VACUUM',
    'PRAGMA query_only = 0', 'PRAGMA writable_schema = 1', 'CREATE TABLE t (a)', '']) ok(`refused: ${s}`, checkSql(s) !== null);
  ok('a write that slips past the check still fails', /read-only/i.test(runQuery(db, 'WITH x AS (SELECT 1) UPDATE links SET size = 0', 10).error || ''));
  const before = db.exec('SELECT SUM(size) FROM links')[0].values[0][0];
  runQuery(db, 'WITH x AS (SELECT 1) UPDATE links SET size = 0', 10);
  ok('and changes nothing', db.exec('SELECT SUM(size) FROM links')[0].values[0][0] === before);

  // results
  const n = runQuery(db, 'SELECT COUNT(*) AS n FROM entries', 10);
  ok('entries equal the dataset', n.rows[0][0] === ds.entries.n && n.cols[0] === 'n' && !n.truncated);
  const l = runQuery(db, 'SELECT COUNT(*) FROM links', 10);
  ok('links equal the dataset', l.rows[0][0] === ds.links.n);
  const t = runQuery(db, 'SELECT slug FROM entries ORDER BY slug LIMIT 100000', 7);
  ok('the row limit truncates', t.rows.length === 7 && t.truncated === true);
  ok('a second statement is ignored, not run', runQuery(db, 'SELECT 1 AS a; SELECT 2 AS b', 10).cols.join() === 'a');
  ok('a blob is described, not dumped', runQuery(db, "SELECT x'00ff'", 1).rows[0][0] === '<blob 2 bytes>');
  ok('errors are reported', /no such table/i.test(runQuery(db, 'SELECT * FROM nope', 5).error));
  ok('no download locator is left', runQuery(db, "SELECT COUNT(*) FROM links WHERE url IS NOT NULL OR filename IS NOT NULL OR source_url IS NOT NULL OR torrent_file_path IS NOT NULL", 1).rows[0][0] === 0);
  ok('pack ids join', runQuery(db, 'SELECT COUNT(*) FROM links l JOIN torrents t ON t.infohash = l.torrent_infohash', 1).rows[0][0] > 0);

  // csv
  const csv = toCsv(['a', 'b'], [[1, 'x,y'], [null, 'say "hi"'], ['line\nbreak', 2.5]]);
  ok('csv quoting', csv === 'a,b\r\n1,"x,y"\r\n,"say ""hi"""\r\n"line\nbreak",2.5\r\n', JSON.stringify(csv));

  // every example the console offers
  for (const ex of ds.examples) {
    const t0 = Date.now(), r = runQuery(db, ex.sql, 200), ms = Date.now() - t0;
    ok(`example "${ex.title}" runs (${ms} ms)`, !r.error && ms < 20000, r.error || `${ms} ms`);
    console.log(`  ${r.error ? 'FAIL' : 'ok  '} ${String(ms).padStart(5)} ms  ${r.rows ? r.rows.length : 0} rows  ${ex.title}`);
  }
  console.log(`${checks} checks`);
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
