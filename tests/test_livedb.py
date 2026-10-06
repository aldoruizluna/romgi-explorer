#!/usr/bin/env python3
"""
The link-free copy the hosted SQL console runs on must be romgi's database, minus only the download locators.

  python3 tests/test_livedb.py <romdb.db> <livedb.sqlite.gz>
"""
import gzip
import random
import sqlite3
import sys
import tempfile

src_path, gz_path = sys.argv[1], sys.argv[2]
tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
with gzip.open(gz_path, "rb") as f:
    while chunk := f.read(1 << 20):
        tmp.write(chunk)
tmp.close()
a = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
b = sqlite3.connect(f"file:{tmp.name}?mode=ro", uri=True)
fails = []


def check(name, got, want):
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {name}" + ("" if ok else f": copy {got!r} / original {want!r}"))
    if not ok:
        fails.append(name)


# columns that are emptied or replaced on purpose
REDACTED = {"links": {"url", "filename", "source_url", "torrent_file_path", "torrent_infohash"},
            "torrents": {"infohash", "magnet", "torrent_blob", "trackers_json"}}
tables = [r[0] for r in a.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'entries_fts_%' AND name != 'entries_fts' ORDER BY name")]
check("same tables", [r[0] for r in b.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'entries_fts_%' AND name != 'entries_fts' ORDER BY name")], tables)
check("integrity", b.execute("PRAGMA integrity_check").fetchone()[0], "ok")

for t in tables:
    check(f"{t}: row count", b.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0], a.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
    cols = [r[1] for r in a.execute(f"PRAGMA table_info({t})")]
    keep = [c for c in cols if c not in REDACTED.get(t, set())]
    for c in keep:
        q = f"SELECT COUNT({c}), TOTAL(LENGTH(CAST({c} AS BLOB))), MIN({c}), MAX({c}) FROM {t}"
        check(f"{t}.{c}: same content summary", b.execute(q).fetchone(), a.execute(q).fetchone())
    rows = a.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    if keep and rows:
        random.seed(t)
        ids = random.sample(range(1, rows + 1), min(2000, rows))
        sel = f"SELECT {', '.join(keep)} FROM {t} WHERE rowid = ?"
        diff = sum(1 for i in ids if a.execute(sel, (i,)).fetchone() != b.execute(sel, (i,)).fetchone())
        check(f"{t}: {len(ids)} sampled rows identical", diff, 0)

# what was emptied is empty, and nothing that locates a download is left
for t, cols in {"links": ["url", "filename", "source_url", "torrent_file_path"], "torrents": ["magnet", "torrent_blob", "trackers_json"]}.items():
    for c in cols:
        check(f"{t}.{c} is empty", b.execute(f"SELECT COUNT(*) FROM {t} WHERE {c} IS NOT NULL").fetchone()[0], 0)
check("no torrent infohash survives", b.execute("SELECT COUNT(*) FROM torrents WHERE infohash NOT LIKE 'pack-%'").fetchone()[0] + b.execute("SELECT COUNT(*) FROM links WHERE torrent_infohash IS NOT NULL AND torrent_infohash NOT LIKE 'pack-%'").fetchone()[0], 0)
check("no magnet or http link in links or torrents", sum(b.execute(f"SELECT COUNT(*) FROM {t} WHERE {c} LIKE '%://%' OR {c} LIKE 'magnet:%'").fetchone()[0]
      for t, c in (("links", "name"), ("links", "host"), ("links", "size_str"), ("torrents", "name"))), 0)

# the pack ids keep every join working
j = "SELECT t.name, COUNT(*) FROM links l JOIN torrents t ON t.infohash = l.torrent_infohash GROUP BY t.rowid ORDER BY t.name, 2"
check("links join torrents the same way", b.execute(j).fetchall(), a.execute(j.replace("t.infohash = l.torrent_infohash", "t.infohash = l.torrent_infohash")).fetchall())
check("links without a pack", b.execute("SELECT COUNT(*) FROM links WHERE torrent_infohash IS NULL").fetchone()[0], a.execute("SELECT COUNT(*) FROM links WHERE torrent_infohash IS NULL").fetchone()[0])

# full-text search still answers
q = "SELECT COUNT(*) FROM entries_fts WHERE entries_fts MATCH 'supermario*'"
check("full-text search", b.execute(q).fetchone()[0], a.execute(q).fetchone()[0])
print("ALL PASS" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
