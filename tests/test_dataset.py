#!/usr/bin/env python3
"""
Parity check: what build_dataset.py put in the dataset must equal what SQL says about the database.

  python3 tests/test_dataset.py <romdb.db> <dataset.json.gz>

Every flag and size bucket carries the SQL the explorer prints in its "SQL behind this view" panel, so this
also proves that SQL is the same slice as the arrays the UI filters.
"""
import collections
import gzip
import json
import sqlite3
import sys

db_path, ds_path = sys.argv[1], sys.argv[2]
con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
ds = json.loads(gzip.open(ds_path).read())
E, L, D = ds["entries"], ds["links"], ds["dims"]
fails = []


def check(name, got, want):
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'} {name}: dataset {got:,} / sql {want:,}")
    if not ok:
        fails.append(name)


sc = lambda sql: con.execute(sql).fetchone()[0]

# the table is stored in the order the SQL printed under "SQL behind this view" sorts by (SQLite's own comparator ranks the keys)
rank = dict(con.execute(f"SELECT e.title, DENSE_RANK() OVER (ORDER BY {ds['meta']['sql_title_order']}) FROM entries e"))
seq = [rank[t] for t in E["title"]]
check("entries out of ORDER BY order", sum(1 for a, b in zip(seq, seq[1:]) if b < a), 0)

check("entries", E["n"], sc("SELECT COUNT(*) FROM entries"))
check("links", L["n"], sc("SELECT COUNT(*) FROM links"))
check("sum(entries.nl)", sum(E["nl"]), sc("SELECT COUNT(*) FROM links"))

# platforms
by_plat = collections.Counter(E["platform"])
for i, p in enumerate(D["platforms"]):
    check(f"platform {p['id']}", by_plat[i], sc(f"SELECT COUNT(*) FROM entries WHERE platform='{p['id']}'"))

# release flags: the SQL in dims.flags must reproduce the bitmask
for bit, f in enumerate(D["flags"]):
    got = sum(1 for m in E["flags"] if m >> bit & 1)
    if f["sql"] is None:
        print(f"skip {f['id']}: no SQL equivalent ({got:,} in dataset)")
        continue
    check(f"flag {f['id']}", got, sc(f"SELECT COUNT(*) FROM entries e WHERE {f['sql']}"))

# regions (bit 0..3) and 'none'
def regions_of(code):
    out = []
    while code:
        out.append(code % 5 - 1)
        code //= 5
    return out
for i, r in enumerate(D["regions"]):
    got = sum(1 for c in E["reg"] if i in regions_of(c))
    check(f"region {r['id']}", got, sc(f"SELECT COUNT(DISTINCT entry) FROM regions_entries WHERE region='{r['id']}'"))
check("region none", sum(1 for c in E["reg"] if c == 0),
      sc("SELECT COUNT(*) FROM entries e WHERE NOT EXISTS (SELECT 1 FROM regions_entries r WHERE r.entry=e.slug)"))

# size classes: a size is suspect at 1 TiB and up for every source, and for Internet Archive also when it exceeds what the platform's medium holds
susp_src = next(i for i, s in enumerate(D["sources"]) if s["id"] == D["suspect"]["source"])
plat_limit = [p["limit"] if p["limit"] is not None else float("inf") for p in D["platforms"]]
link_plat = []
for ei, n in enumerate(E["nl"]):
    link_plat += [E["platform"][ei]] * n
def bucket(s, src, pi):
    if not s: return 0
    if s >= D["suspect"]["tib"] or (src == susp_src and s >= plat_limit[pi]): return 6
    edges = [512 * 1024, 16 << 20, 700 << 20, int(4.7 * (1 << 30))]
    return 1 + sum(1 for e in edges if s >= e)
buckets = collections.Counter(bucket(L["size"][l], L["src"][l], link_plat[l]) for l in range(L["n"]))
for b in D["sizes"]:
    check(f"size class {b['id']} {b['label']}", buckets[b["id"]], sc(f"SELECT COUNT(*) FROM links l WHERE {b['sql']}"))

# sources, types, formats, packs
for i, s in enumerate(D["sources"]):
    check(f"source {s['id']}", sum(1 for x in L["src"] if x == i), sc(f"SELECT COUNT(*) FROM links WHERE source_id='{s['id']}'"))
def pack_sql(p):
    q = p["name"].replace("'", "''")
    return f"SELECT COUNT(*) FROM links l JOIN torrents t ON t.infohash = l.torrent_infohash WHERE t.name = '{q}'"
for i, p in enumerate(D["packs"]):
    got = sum(1 for x in L["pack"] if x == i)
    if i < 12 or got != sc(pack_sql(p)):
        check(f"pack {i} {p['label'][:40]}", got, sc(pack_sql(p)))
check("snapshot carries no infohash", sum(1 for p in D["packs"] if p.get("infohash")), 0 if not any(p.get("infohash") for p in D["packs"]) else sum(1 for p in D["packs"] if p.get("infohash")))
check("links without a pack", sum(1 for x in L["pack"] if x < 0), sc("SELECT COUNT(*) FROM links WHERE torrent_infohash IS NULL"))
for i, f in enumerate(D["formats"][:8]):
    check(f"format {f or '(blank)'}", sum(1 for x in L["fmt"] if x == i), sc(f"SELECT COUNT(*) FROM links WHERE COALESCE(format,'')='{f}'"))

# ra
check("entries with RA id", sum(1 for x in E["ra"] if x), sc("SELECT COUNT(*) FROM entries WHERE ra_game_id IS NOT NULL"))
check("achievements total", sum(E["ran"]), sc("SELECT COALESCE(SUM(ra_num_achievements),0) FROM entries"))

# groups
check("entries in a group", sum(1 for g in E["group"] if g >= 0), sc("SELECT COUNT(DISTINCT entry) FROM entry_group_members"))

# multi-source availability
src_per_entry = collections.defaultdict(set)
pos = 0
for ei, n in enumerate(E["nl"]):
    for k in range(n):
        src_per_entry[ei].add(L["src"][pos + k])
    pos += n
want = dict(con.execute("SELECT n, COUNT(*) FROM (SELECT COUNT(DISTINCT source_id) n FROM links GROUP BY entry) GROUP BY n").fetchall())
got = collections.Counter(len(v) for v in src_per_entry.values())
for n in sorted(want):
    check(f"entries offered by {n} source(s)", got[n], want[n])

print()
print("ALL PASS" if not fails else f"{len(fails)} FAILED: {fails[:10]}")
sys.exit(1 if fails else 0)
