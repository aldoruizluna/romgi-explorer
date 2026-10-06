#!/usr/bin/env python3
"""
livedb.py - the copy of the catalogue the hosted site runs SQL on.

  python3 livedb.py data/romdb.db dist/livedb.sqlite            # writes the copy
  python3 livedb.py data/romdb.db dist/livedb.sqlite.gz --gzip  # and compresses it

It is romgi's whole database with the columns that say where a file can be downloaded emptied: links.url, links.filename,
links.source_url, links.torrent_file_path, torrents.magnet and the torrent blob. Torrent infohashes are replaced by pack-001,
pack-002, ... in torrents and links alike, so every join still works. Statistics are added (ANALYZE) so the query planner
does not need the hand-written IN (SELECT ...) forms the original database calls for.
"""
from __future__ import annotations

import argparse
import gzip
import shutil
import sqlite3
import sys
import time
from pathlib import Path

REDACTED = """
UPDATE links SET url = NULL, filename = NULL, source_url = NULL, torrent_file_path = NULL;
CREATE TEMP TABLE pack_ids AS SELECT infohash AS old, 'pack-' || printf('%03d', rowid) AS new FROM torrents;
CREATE INDEX temp.pack_ids_old ON pack_ids (old);
UPDATE links SET torrent_infohash = (SELECT new FROM pack_ids WHERE old = links.torrent_infohash) WHERE torrent_infohash IS NOT NULL;
UPDATE torrents SET infohash = 'pack-' || printf('%03d', rowid), magnet = NULL, torrent_blob = NULL, trackers_json = NULL;
"""


def build(src: str, dst: str, log=print) -> None:
    t0 = time.time()
    dst_path = Path(dst)
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    dst_path.unlink(missing_ok=True)
    con = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    con.execute("VACUUM INTO ?", (str(dst_path),))
    con.close()
    log(f"copied     {dst_path.stat().st_size / 1e6:7.1f} MB  {time.time() - t0:5.1f} s")
    w = sqlite3.connect(dst)
    w.executescript("PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA foreign_keys = OFF;")
    w.executescript(REDACTED)
    w.commit()
    left = w.execute("SELECT COUNT(*) FROM links WHERE url IS NOT NULL OR filename IS NOT NULL OR source_url IS NOT NULL OR torrent_file_path IS NOT NULL").fetchone()[0]
    left += w.execute("SELECT COUNT(*) FROM torrents WHERE magnet IS NOT NULL OR torrent_blob IS NOT NULL OR infohash NOT LIKE 'pack-%'").fetchone()[0]
    left += w.execute("SELECT COUNT(*) FROM links WHERE torrent_infohash IS NOT NULL AND torrent_infohash NOT LIKE 'pack-%'").fetchone()[0]
    if left:
        sys.exit(f"{left} locator values survived the redaction; refusing to write the copy")
    log(f"redacted   {time.time() - t0:5.1f} s")
    w.execute("VACUUM")
    w.execute("ANALYZE")
    w.execute("PRAGMA optimize")
    w.commit()
    w.close()
    log(f"compacted  {dst_path.stat().st_size / 1e6:7.1f} MB  {time.time() - t0:5.1f} s")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="romgi's romdb.db")
    ap.add_argument("dst", help="where to write the copy")
    ap.add_argument("--gzip", action="store_true", help="write dst gzip-compressed (the file is built next to it, then removed)")
    a = ap.parse_args()
    raw = Path(a.dst[:-3] if a.gzip and a.dst.endswith(".gz") else a.dst + (".tmp" if a.gzip else ""))
    build(a.src, str(raw))
    if a.gzip:
        t0 = time.time()
        with open(raw, "rb") as f, open(a.dst, "wb") as out, gzip.GzipFile(filename="", fileobj=out, mode="wb", compresslevel=9, mtime=0) as g:
            shutil.copyfileobj(f, g, 1 << 20)       # mtime=0: the same database always gives the same bytes, so browsers keep their saved copy
        raw.unlink()
        print(f"compressed {Path(a.dst).stat().st_size / 1e6:7.1f} MB  {time.time() - t0:5.1f} s")


if __name__ == "__main__":
    main()
