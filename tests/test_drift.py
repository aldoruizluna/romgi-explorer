#!/usr/bin/env python3
"""
The format guard and the completeness rule (drift.py).

  python3 tests/test_drift.py dist/fixture/romdb.db [data/history.json]

The first argument is a catalogue from tests/make_fixture.py (a small sample, quick to copy and break). The format guard must pass it, name
what is wrong when a documented column or table goes, a schema version, a region or a link breaks what the builder relies on, and only
mention (not refuse) things that are merely new. The completeness rule runs on romgi's real weekly history: it must call the six
snapshots that were about 40% short unfinished and nothing else, keep showing the last complete catalogue while the newest is unfinished,
and give up holding after six weeks or when told to.
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import build_dataset as bd  # noqa: E402
import drift  # noqa: E402

fails = []


def check(name, cond, detail=""):
    print(f"{'ok  ' if cond else 'FAIL'} {name}" + ("" if cond else f"   {detail}"))
    if not cond:
        fails.append(name)


fixture = Path(sys.argv[1])
history_path = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE.parent / "data" / "history.json"
vj = json.loads(fixture.with_name("version.json").read_text())

# ---- the builder and the guard agree about what is known
check("the guard's known sources are the builder's", drift.KNOWN_SOURCES == set(bd.SOURCE_ORDER))
check("the guard's regions are the builder's", drift.REGION_IDS == set(bd.REGION_ORDER))
check("the builder has a colour slot for every known source", bd.SOURCE_SLOTS >= len(bd.SOURCE_ORDER))
check("the builder's source ceiling is the guard's", bd.MAX_SOURCES == drift.MAX_SOURCES)

tmp = Path(tempfile.mkdtemp(prefix="drift-"))


def mutated(sql=None, version=None):
    """A copy of the fixture with some SQL applied; returns the connection (read-write, closed by the caller) and its version.json."""
    copy = tmp / "copy.db"
    shutil.copy(fixture, copy)
    con = sqlite3.connect(copy)
    if sql:
        con.executescript(sql)
        con.commit()
    return con, {**vj, **(version or {})}


def run(sql=None, version=None, allow=None):
    con, v = mutated(sql, version)
    try:
        return drift.check_catalogue(con, v, allow)
    finally:
        con.close()


# ---- the format guard
r = run()
check("the untouched catalogue passes", not r.fatal, r.fatal)
check("a source it has not seen is mentioned, not refused", any("New source" in n for n in r.notes) == ("testsrc" in {x[0] for x in sqlite3.connect(fixture).execute("SELECT id FROM sources")}), r.notes)
r = run("ALTER TABLE links RENAME COLUMN size TO bytes;")
check("a renamed column is named", any("links lost size" in m for m in r.fatal), r.fatal)
r = run("DROP TABLE torrents;")
check("a missing table is named", any("table torrents is gone" in m for m in r.fatal), r.fatal)
r = run("ALTER TABLE entries ADD COLUMN genre TEXT; CREATE TABLE extras (x);")
check("a new column and a new table are only mentioned", not r.fatal and any("entries has genre" in n for n in r.notes) and any("extras" in n for n in r.notes), (r.fatal, r.notes))
r = run(version={"schema_version": 5})
check("a schema version it does not know stops the build", any("schema version 5" in m for m in r.fatal), r.fatal)
r = run(version={"schema_version": 5}, allow={5})
check("... unless it is allowed by hand", not r.fatal, r.fatal)
r = run("INSERT INTO regions (id, name) VALUES ('xx', 'Xland');")
check("a fifth region stops the build", any("new region xx" in m for m in r.fatal), r.fatal)
con = sqlite3.connect(fixture)
slug = con.execute("SELECT slug FROM entries LIMIT 1").fetchone()[0]
con.close()
r = run(f"DELETE FROM regions_entries WHERE entry = '{slug}'; INSERT INTO regions_entries VALUES ('{slug}', 'us'), ('{slug}', 'eu'), ('{slug}', 'jp'), ('{slug}', 'other');")
check("an entry with four regions stops the build", any("more than three regions" in m for m in r.fatal), r.fatal)
r = run(f"UPDATE entries SET platform = 'nope' WHERE slug = '{slug}';")
check("an entry on an unknown platform stops the build", any("platform that platforms does not list" in m for m in r.fatal), r.fatal)
r = run("UPDATE links SET source_id = 'ghost' WHERE rowid = (SELECT MIN(rowid) FROM links);")
check("a link from an unknown source stops the build", any("source that sources does not list" in m for m in r.fatal), r.fatal)
r = run("UPDATE links SET entry = 'no-such-entry' WHERE rowid = (SELECT MIN(rowid) FROM links);")
check("a link to an unknown entry stops the build", any("entry that entries does not list" in m for m in r.fatal), r.fatal)
many = ";".join(f"INSERT OR IGNORE INTO sources (id, name, homepage, kind, auth_required, priority, manifest_json) VALUES ('extra{i}', 'Extra {i}', '', 'catalog', 0, {i}, '{{}}')" for i in range(drift.MAX_SOURCES))
r = run(many + ";")
check("more sources than the filter holds stops the build", any("sources; the" in m for m in r.fatal), r.fatal)

# the builder itself refuses a catalogue the guard refuses, with the reasons in the message
con, v = mutated("DELETE FROM torrents;")      # fine: no fatal, just proving the path runs
con.close()
bad = tmp / "copy.db"
shutil.copy(fixture, bad)
c = sqlite3.connect(bad); c.execute("ALTER TABLE links RENAME COLUMN size TO bytes"); c.commit(); c.close()
(tmp / "version.json").write_text(json.dumps(vj))
try:
    bd.build(bad, version_json=tmp / "version.json", profiles=False, log=lambda *a: None)
    check("build_dataset refuses a catalogue that lost a column", False, "it built")
except SystemExit as e:
    check("build_dataset refuses a catalogue that lost a column, and says which", "links lost size" in str(e), str(e))

# ---- the completeness rule, on romgi's real history
history = json.loads(history_path.read_text())
rows = sorted(history, key=lambda h: h["date"])
flags = drift.flag_history(rows)
unfinished = [r["date"][:10] for r, f in zip(rows, flags) if not f]
check("exactly the weeks romgi published a catalogue about 40% short are unfinished (up to 2026-10-04)",
      [d for d in unfinished if d <= "2026-10-04"] == ["2026-04-05", "2026-04-12", "2026-04-19", "2026-04-26", "2026-08-16", "2026-08-23"], unfinished)


def latest_of(row):
    return {"version": row["version"], "generated_at": row["date"], "entries": row["entries"], "links": row["links"]}


i = next(k for k, r in enumerate(rows) if r["date"].startswith("2026-08-16"))
p = drift.pick_catalogue(latest_of(rows[i]), rows[:i + 1])
check("on 2026-08-16 the site keeps showing 2026-08-09", p["held"] and p["use"]["version"] == "20260809" and p["ref"] == rows[i - 1]["commit"], p)
check("... and says why", "fewer entries" in p["reason"] and p["latest"]["version"] == "20260816", p["reason"])
j = next(k for k, r in enumerate(rows) if r["date"].startswith("2026-08-28"))
p = drift.pick_catalogue(latest_of(rows[j]), rows[:j + 1])
check("on 2026-08-28, with a complete catalogue, it switches", not p["held"] and p["ref"] == "main" and p["use"]["version"] == rows[j]["version"], p)
p = drift.pick_catalogue(latest_of(rows[-1]), rows)
check("the newest real catalogue is used as it is", not p["held"] and p["ref"] == "main", p)
p = drift.pick_catalogue(latest_of(rows[i]), rows[:i], accept_latest=False)
check("a newest catalogue missing from the history is judged all the same", p["held"] and p["use"]["version"] == "20260809", p)
p = drift.pick_catalogue(latest_of(rows[i]), rows[:i + 1], accept_latest=True)
check("it can be accepted by hand", not p["held"] and p["reason"] == "accepted by hand", p)
k = next(n for n, r in enumerate(rows) if r["date"].startswith("2026-07-19"))
short = {"version": "20260901", "generated_at": "2026-09-01T00:00:00Z", "entries": 140000, "links": 187000}   # 44 days after the last complete one
p = drift.pick_catalogue(short, rows[:k + 1])
check("after six weeks without a complete catalogue the newest is accepted", not p["held"] and "more than 42 days" in p["reason"], p)
short["generated_at"] = "2026-08-25T00:00:00Z"                                                              # 37 days: still held
p = drift.pick_catalogue(short, rows[:k + 1])
check("... but not before", p["held"] and p["use"]["version"] == rows[k]["version"], p)
nocommit = [{k: v for k, v in r.items() if k != "commit"} for r in rows[:i]] + [dict(rows[i])]
p = drift.pick_catalogue(latest_of(rows[i]), nocommit)
check("with no commit to fall back on it uses the newest, and says so", not p["held"] and "no complete earlier catalogue" in p["reason"], p)
only = [dict(rows[0])]
p = drift.pick_catalogue(latest_of(rows[0]), only)
check("the very first snapshot is complete", not p["held"], p)

# ---- the scheduled check
import datetime as dt
now = dt.datetime(2026, 10, 6, tzinfo=dt.timezone.utc)
mine = {"romgi": {"version": "20261004", "generated_at": "2026-10-04T05:30:04Z", "entries": 241137, "links": 400224}}
same = dict(mine["romgi"])
check("a push or a dispatch always rebuilds", drift.should_rebuild("push", mine, same, now)[0] and drift.should_rebuild("workflow_dispatch", mine, same, now)[0])
check("a scheduled check with nothing new does not", drift.should_rebuild("schedule", mine, same, now)[0] is False)
check("a scheduled check with a new catalogue does", drift.should_rebuild("schedule", mine, {**same, "version": "20261011", "generated_at": "2026-10-11T05:30:00Z"}, now)[0])
check("a scheduled check that cannot read romgi leaves the site alone", drift.should_rebuild("schedule", mine, None, now)[0] is False)
check("a scheduled check with no site yet rebuilds", drift.should_rebuild("schedule", None, same, now)[0])
held = {"romgi": {"version": "20260809", "generated_at": "2026-08-09T00:38:44Z", "entries": 241122, "links": 400403},
        "latest": {"version": "20260816", "generated_at": "2026-08-16T01:42:02Z", "entries": 140141, "links": 187838, "reason": "x"}}
newest = {"version": "20260816", "generated_at": "2026-08-16T01:42:02Z", "entries": 140141, "links": 187838}
check("a catalogue the site held back is not rebuilt for again and again", drift.should_rebuild("schedule", held, newest, dt.datetime(2026, 8, 17, tzinfo=dt.timezone.utc))[0] is False)
check("... until it is old enough to be accepted", drift.should_rebuild("schedule", held, newest, dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc))[0])
check("... or romgi publishes something else", drift.should_rebuild("schedule", held, {**newest, "version": "20260828", "entries": 241126}, dt.datetime(2026, 8, 29, tzinfo=dt.timezone.utc))[0])

shutil.rmtree(tmp, ignore_errors=True)
print("\nALL PASS" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
