#!/usr/bin/env python3
"""
make_fixture.py - a small catalogue for tests that must run in seconds: a sample of romgi's real database, optionally with a source
the explorer has never seen.

  python3 tests/make_fixture.py data/romdb.db dist/fixture/romdb.db                    # every 25th entry (about 9,600)
  python3 tests/make_fixture.py data/romdb.db dist/fixture/romdb.db --extra-source     # plus a fifth source, 'testsrc'

Keeps every Nth entry in slug order with its links and regions, drops the multi-disc groups, and rebuilds the full-text index. With
--extra-source a source called testsrc is added and takes every sixth link (so some entries are offered only by it and some by it
and others), which is what a new source from romgi would look like. A version.json with the new counts is written next to the copy.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="romgi's romdb.db")
    ap.add_argument("dst", help="where to write the sample")
    ap.add_argument("--every", type=int, default=25, help="keep one entry in N (default 25)")
    ap.add_argument("--extra-source", action="store_true", help="add a fifth source, testsrc, that takes every sixth link")
    a = ap.parse_args()
    src, dst = Path(a.src), Path(a.dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.unlink(missing_ok=True)

    ro = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    ro.execute("VACUUM INTO ?", (str(dst),))
    ro.close()

    w = sqlite3.connect(dst)
    w.executescript("PRAGMA foreign_keys = OFF; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;")
    w.executescript(f"""
        DELETE FROM entries WHERE slug NOT IN (SELECT slug FROM (SELECT slug, ROW_NUMBER() OVER (ORDER BY slug) AS n FROM entries) WHERE n % {a.every} = 0);
        DELETE FROM links WHERE entry NOT IN (SELECT slug FROM entries);
        DELETE FROM regions_entries WHERE entry NOT IN (SELECT slug FROM entries);
        DELETE FROM entry_group_members;
        DELETE FROM entry_groups;
    """)
    if a.extra_source:
        w.execute("INSERT INTO sources (id, name, homepage, kind, auth_required, priority, manifest_json) VALUES "
                  "('testsrc', 'Test Source', 'https://example.test', 'catalog', 0, 300, ?)",
                  (json.dumps({"id": "testsrc", "capabilities": ["http_range_resume"], "notes": "An invented source for tests."}),))
        w.execute("INSERT INTO source_health (source_id, status, last_checked, reason, entry_count, link_count) VALUES ('testsrc', 'ok', ?, NULL, 0, 0)",
                  (int(time.time()),))
        w.execute("UPDATE links SET source_id = 'testsrc', torrent_infohash = NULL, torrent_file_index = NULL, torrent_file_path = NULL WHERE rowid % 6 = 0")
    # health rows say what each source holds; make them true of the sample
    for sid, in w.execute("SELECT id FROM sources").fetchall():
        ne, nl = w.execute("SELECT COUNT(DISTINCT entry), COUNT(*) FROM links WHERE source_id = ?", (sid,)).fetchone()
        w.execute("UPDATE source_health SET entry_count = ?, link_count = ? WHERE source_id = ?", (ne, nl, sid))
    w.execute("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')")
    w.commit()
    w.execute("VACUUM")
    ne, nl, ns = (w.execute(q).fetchone()[0] for q in ("SELECT COUNT(*) FROM entries", "SELECT COUNT(*) FROM links", "SELECT COUNT(*) FROM sources"))
    ra = w.execute("SELECT COUNT(*) FROM entries WHERE COALESCE(ra_game_id, 0) > 0").fetchone()[0]
    npl = w.execute("SELECT COUNT(*) FROM platforms").fetchone()[0]
    w.close()

    vj_src = src.with_name("version.json")
    vj = json.loads(vj_src.read_text()) if vj_src.exists() else {}
    vj.update({"entries": ne, "links": nl, "sources": ns, "platforms": npl, "retroachievements": ra, "size": dst.stat().st_size, "uncompressed_size": dst.stat().st_size})
    dst.with_name("version.json").write_text(json.dumps(vj, indent=2) + "\n")
    print(f"fixture {dst}: {ne:,} entries, {nl:,} links, {ns} sources, {dst.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    sys.exit(main())
