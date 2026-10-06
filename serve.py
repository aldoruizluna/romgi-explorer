#!/usr/bin/env python3
"""
serve.py - run the romgi catalogue explorer against a local romdb.db.

  python3 serve.py --db path/to/romdb.db [--version-json path/to/version.json] [--port 8765] [--open]

Binds to 127.0.0.1 only. The database is opened read-only; the SQL console runs one SELECT at a time
under an authoriser, a row cap and a time limit. The first start builds the dataset (about half a minute)
and caches it next to this file; later starts load the cache.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import re
import sqlite3
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import build_dataset as bd
from compose import compose

HERE = Path(__file__).resolve().parent
SAFE_PRAGMAS = {"table_info", "table_xinfo", "index_list", "index_info", "foreign_key_list", "page_count", "page_size",
                "quick_check", "database_list", "table_list", "user_version", "schema_version", "encoding"}
MAX_ROWS = 20000


class State:
    db: str = ""
    dataset_gz: bytes = b""
    dims: dict = {}
    slugs: list = []


def ro():
    con = sqlite3.connect(f"file:{State.db}?mode=ro", uri=True, check_same_thread=False)
    con.execute("PRAGMA query_only = ON")
    return con


def load_dataset(db, version_json, log=print):
    st = Path(db).stat()
    cache = HERE / "dist" / ".cache" / f"dataset.local.v{bd.BUILD_VERSION}.{st.st_size}-{int(st.st_mtime)}.json.gz"
    slugs_cache = cache.with_suffix(".slugs.json")
    if cache.exists() and slugs_cache.exists():
        log(f"using cached dataset {cache.name}")
        State.dataset_gz = cache.read_bytes()
        State.slugs = json.loads(slugs_cache.read_text())
    else:
        log("building the dataset from your database (first run only)...")
        ds = bd.build(db, local=True, version_json=version_json, keep_slugs=True, log=log)
        State.slugs = ds.pop("_slugs")
        State.dataset_gz = gzip.compress(bd.to_json_bytes(ds), 6)
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(State.dataset_gz)
        slugs_cache.write_text(json.dumps(State.slugs))
        for old in cache.parent.glob("dataset.local.*"):       # keep only the cache for this database
            if not old.name.startswith(cache.stem.removesuffix(".json")):
                old.unlink()
    State.dims = json.loads(gzip.decompress(State.dataset_gz))["dims"]


def entry_detail(slug):
    con = ro()
    cur = con.execute("SELECT * FROM entries WHERE slug = ?", (slug,))
    row = cur.fetchone()
    if not row:
        return None
    entry = dict(zip([c[0] for c in cur.description], row))
    regions = [r[0] for r in con.execute("SELECT region FROM regions_entries WHERE entry = ? ORDER BY rowid", (slug,))]
    cur = con.execute("SELECT name, type, format, url, filename, host, size, size_str, source_url, source_id, requires_auth, "
                      "torrent_infohash, torrent_file_index, torrent_file_path FROM links WHERE entry = ?", (slug,))
    cols = [c[0] for c in cur.description]
    links = [dict(zip(cols, r)) for r in cur.fetchall()]
    types = {t: i for i, t in enumerate(State.dims["types"])}
    fmts = {f: i for i, f in enumerate(State.dims["formats"])}
    srcs = {s["id"]: i for i, s in enumerate(State.dims["sources"])}
    links.sort(key=lambda r: (srcs[r["source_id"]], types[bd.norm_type(r["type"])], fmts[r["format"] or ""], r["size"] or 0,
                              r["torrent_file_index"] if r["torrent_file_index"] is not None else -1, r["filename"] or ""))
    con.close()
    return {"entry": entry, "regions": regions, "links": links}


def run_sql(sql, limit):
    con = ro()
    allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}

    def authorizer(action, a1, a2, db, trigger):
        if action in allowed:
            return sqlite3.SQLITE_OK
        if action == sqlite3.SQLITE_PRAGMA and (a1 or "").lower() in SAFE_PRAGMAS:
            return sqlite3.SQLITE_OK
        return sqlite3.SQLITE_DENY

    con.set_authorizer(authorizer)
    deadline = time.time() + 20
    con.set_progress_handler(lambda: 1 if time.time() > deadline else 0, 20000)
    t0 = time.time()
    try:
        cur = con.execute(sql)
        cols = [c[0] for c in cur.description] if cur.description else []
        rows = cur.fetchmany(limit + 1)
    except sqlite3.Error as e:
        msg = str(e)
        if "interrupted" in msg:
            msg = "The query ran for more than 20 seconds and was stopped."
        elif "not authorized" in msg:
            msg = "Only read-only SELECT statements are allowed here."
        return {"error": msg}
    finally:
        con.close()
    truncated = len(rows) > limit
    rows = rows[:limit]

    def cell(v):
        return f"<blob {len(v)} bytes>" if isinstance(v, (bytes, bytearray)) else v
    return {"cols": cols, "rows": [[cell(v) for v in r] for r in rows], "truncated": truncated, "ms": round((time.time() - t0) * 1000)}


def sql_csv(sql):
    out = run_sql(sql, 500000)
    if "error" in out:
        return None, out["error"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(out["cols"])
    w.writerows(out["rows"])
    return buf.getvalue(), None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "romgi-explorer"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    def _host_ok(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def _send(self, code, body, ctype, extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, "Forbidden host", "text/plain")
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            return self._send(200, compose("local", standalone=True), "text/html; charset=utf-8")
        if u.path == "/api/dataset":
            return self._send(200, State.dataset_gz, "application/json; charset=utf-8", {"Content-Encoding": "gzip"})
        if u.path == "/api/entry":
            slug = parse_qs(u.query).get("slug", [""])[0]
            d = entry_detail(slug)
            return self._json(d) if d else self._json({"error": "unknown slug"}, 404)
        if u.path == "/api/slugs":
            return self._json(State.slugs)
        if u.path == "/api/health":
            return self._json({"ok": True, "db": State.db})
        if u.path == "/favicon.ico":
            return self._send(204, b"", "image/x-icon")
        return self._send(404, "Not found", "text/plain")

    def do_POST(self):
        if not self._host_ok() or self.headers.get("X-Romgi") != "1":
            return self._send(403, "Forbidden", "text/plain")
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._json({"error": "bad json"}, 400)
        sql = (body.get("sql") or "").strip().rstrip(";")
        if not sql:
            return self._json({"error": "Type a query first."})
        if self.path == "/api/sql":
            return self._json(run_sql(sql, max(1, min(int(body.get("limit") or 1000), MAX_ROWS))))
        if self.path == "/api/sqlcsv":
            text, err = sql_csv(sql)
            return self._json({"error": err}, 400) if err else self._send(200, text, "text/csv; charset=utf-8")
        return self._send(404, "Not found", "text/plain")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True)
    ap.add_argument("--version-json")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--open", action="store_true", help="open your default browser")
    a = ap.parse_args()
    if not Path(a.db).exists():
        sys.exit(f"database not found: {a.db}")
    State.db = str(Path(a.db).resolve())
    load_dataset(State.db, a.version_json)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    srv.daemon_threads = True
    url = f"http://127.0.0.1:{a.port}/"
    print(f"romgi explorer ready: {url}  (database {State.db})", flush=True)
    if a.open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
