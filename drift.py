#!/usr/bin/env python3
"""
drift.py - notice when romgi's catalogue stops looking like the one this explorer reads, or looks unfinished.

  python3 drift.py check data/romdb.db data/version.json
      Is it the format we read? Stops (exit 1) when the schema version is not one we know, a documented table or column is gone, or
      a value breaks something the builder relies on (a fifth region, an entry on an unknown platform, more sources than the
      "offered by" filter can hold). New tables, columns, sources and platforms are reported, not refused.

  python3 drift.py pick --latest data/version.json --history data/history.json --site <site's version.json url> --out data/pick.json
      Is the newest catalogue complete? romgi has twice published a catalogue about 40% short (2026-04-05 and 2026-08-16, a source
      returning nothing). The site then keeps showing the last complete one, says so on the page, and switches when romgi publishes a
      complete one. Prints ref=<git ref to download the database from>, held=true|false, and writes the decision to --out.

Both write a Markdown summary to $GITHUB_STEP_SUMMARY when it is set (a GitHub Actions run).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sqlite3
import sys
import urllib.request
from pathlib import Path

SUPPORTED_SCHEMA = {4}
MAX_SOURCES = 12
REGION_IDS = {"us", "eu", "jp", "other"}
THRESHOLD = 0.25            # a catalogue is unfinished when entries or links fall by more than this against the recent complete ones
WINDOW = 8                  # compare with the best of this many recent complete snapshots
MAX_HOLD_DAYS = 42          # after this long without a complete catalogue, the newest one is accepted as the new normal

# db/CATALOG.md of caprado/romgi, schema v4: every column of every table the explorer reads or copies. entries.search_key only feeds
# romgi's own full-text index, so its absence would not matter here.
DOCUMENTED = {
    "platforms": ["id", "brand", "name"],
    "entries": ["slug", "rom_id", "search_key", "title", "platform", "boxart_url", "ra_game_id", "ra_num_achievements"],
    "regions": ["id", "name"],
    "regions_entries": ["entry", "region"],
    "sources": ["id", "name", "homepage", "kind", "auth_required", "priority", "manifest_json"],
    "source_health": ["source_id", "status", "last_checked", "reason", "entry_count", "link_count"],
    "torrents": ["infohash", "source_id", "name", "magnet", "torrent_blob", "total_size", "piece_length", "file_count", "trackers_json", "added_at"],
    "links": ["entry", "name", "type", "format", "url", "filename", "host", "size", "size_str", "source_url", "source_id", "requires_auth",
              "torrent_infohash", "torrent_file_index", "torrent_file_path"],
    "entry_groups": ["id", "kind", "title", "platform", "member_count", "metadata_json"],
    "entry_group_members": ["group_id", "entry", "member_index", "member_label"],
}
OPTIONAL = {("entries", "search_key")}
APP_TABLES = {"user_sources"}            # romgi's app keeps its own sources here; it is empty in a published catalogue
KNOWN_SOURCES = {"minerva", "internet_archive", "nopaystation", "mariocube"}


class Report:
    def __init__(self) -> None:
        self.fatal: list[str] = []
        self.notes: list[str] = []

    def markdown(self, title: str) -> str:
        out = [f"### {title}", ""]
        out += [f"- **Stopped:** {m}" for m in self.fatal] or ["- Format and values are what this explorer reads."]
        out += [f"- {m}" for m in self.notes]
        return "\n".join(out) + "\n"


def summary(text: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")


def check_catalogue(con: sqlite3.Connection, vj: dict, allow_schema: set[int] | None = None) -> Report:
    r = Report()
    allowed = SUPPORTED_SCHEMA | (allow_schema or set())
    sv = vj.get("schema_version")
    if sv is None:
        r.notes.append("version.json carries no schema_version; reading the tables as schema 4.")
    elif sv not in allowed:
        r.fatal.append(f"romgi's catalogue is schema version {sv}; this explorer reads {sorted(SUPPORTED_SCHEMA)}. "
                       f"Read what changed in db/CATALOG.md, update build_dataset.py, then add {sv} to SUPPORTED_SCHEMA in drift.py "
                       f"(or set ROMGI_ALLOW_SCHEMA={sv} to try a build anyway).")
    have = {t: [c[1] for c in con.execute(f"PRAGMA table_info({t})")] for (t,) in
            con.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")}
    for table, cols in DOCUMENTED.items():
        if table not in have:
            r.fatal.append(f"table {table} is gone.")
            continue
        missing = [c for c in cols if c not in have[table] and (table, c) not in OPTIONAL]
        if missing:
            r.fatal.append(f"{table} lost {', '.join(missing)}.")
        extra = [c for c in have[table] if c not in cols]
        if extra:
            r.notes.append(f"New in romgi: {table} has {', '.join(extra)}. The explorer does not read it yet.")
    shadow = ("entries_fts",)
    new_tables = sorted(t for t in have if t not in DOCUMENTED and t not in APP_TABLES and not t.startswith(shadow))
    if new_tables:
        r.notes.append(f"New in romgi: table{'s' if len(new_tables) > 1 else ''} {', '.join(new_tables)}. The explorer does not read {'them' if len(new_tables) > 1 else 'it'} yet.")
    if r.fatal and any(m.startswith("table") or "lost" in m for m in r.fatal):
        return r                                    # the checks below read those tables

    q = lambda sql: con.execute(sql).fetchall()
    regions = {x[0] for x in q("SELECT id FROM regions")} | {x[0] for x in q("SELECT DISTINCT region FROM regions_entries")}
    if regions - REGION_IDS:
        r.fatal.append(f"new region{'s' if len(regions - REGION_IDS) > 1 else ''} {', '.join(sorted(regions - REGION_IDS))}: the region encoding holds four.")
    if q("SELECT 1 FROM (SELECT entry FROM regions_entries GROUP BY entry HAVING COUNT(*) > 3) LIMIT 1"):
        r.fatal.append("an entry has more than three regions: the region encoding holds three.")
    n_src = q("SELECT COUNT(*) FROM sources")[0][0]
    if n_src > MAX_SOURCES:
        r.fatal.append(f"{n_src} sources; the \"offered by\" filter holds at most {MAX_SOURCES}.")
    if q("SELECT COUNT(*) FROM platforms")[0][0] > 255:
        r.fatal.append("more than 255 platforms: the platform column is a byte.")
    if q("SELECT COUNT(*) FROM torrents")[0][0] >= 255:
        r.fatal.append("255 or more torrent packs: the pack column is a byte.")
    orphans = q("SELECT COUNT(*) FROM entries WHERE platform NOT IN (SELECT id FROM platforms)")[0][0]
    if orphans:
        r.fatal.append(f"{orphans:,} entries are on a platform that platforms does not list.")
    orphans = q("SELECT COUNT(*) FROM links WHERE source_id NOT IN (SELECT id FROM sources)")[0][0]
    if orphans:
        r.fatal.append(f"{orphans:,} links come from a source that sources does not list.")
    orphans = q("SELECT COUNT(*) FROM links WHERE entry NOT IN (SELECT slug FROM entries)")[0][0]
    if orphans:
        r.fatal.append(f"{orphans:,} links belong to an entry that entries does not list.")
    if not q("SELECT COUNT(*) FROM entries")[0][0] or not q("SELECT COUNT(*) FROM links")[0][0]:
        r.fatal.append("the catalogue has no entries or no links.")

    sources = [x[0] for x in q("SELECT id FROM sources")]
    new_src = sorted(set(sources) - KNOWN_SOURCES)
    if new_src:
        r.notes.append(f"New source{'s' if len(new_src) > 1 else ''} in romgi: {', '.join(new_src)}. Shown with the next free colour.")
    for sid, n in q("SELECT s.id, COUNT(l.rowid) FROM sources s LEFT JOIN links l ON l.source_id = s.id GROUP BY s.id"):
        if n == 0:
            r.notes.append(f"{sid} holds no links in this catalogue.")
    return r


# ----------------------------------------------------------------------------------------------------------------- completeness

def _date(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def flag_history(rows: list[dict], threshold: float = THRESHOLD, window: int = WINDOW) -> list[bool]:
    """For each snapshot, oldest first: is it complete, judged against the best of the recent complete ones?"""
    flags, recent = [], []
    for r in rows:
        if not recent:
            ok = True
        else:
            ref_e, ref_l = max(x["entries"] for x in recent), max(x["links"] for x in recent)
            ok = r["entries"] >= (1 - threshold) * ref_e and r["links"] >= (1 - threshold) * ref_l
        flags.append(ok)
        if ok:
            recent = (recent + [r])[-window:]
    return flags


def pick_catalogue(latest: dict, history: list[dict], *, accept_latest: bool = False, threshold: float = THRESHOLD,
                   max_hold_days: int = MAX_HOLD_DAYS) -> dict:
    """Decide which catalogue the site shows. latest is romgi's newest version.json; history is data/history.json."""
    rows = sorted((h for h in history if h.get("entries") and h.get("links")), key=lambda h: h["date"])
    newest = {"version": latest["version"], "date": latest.get("generated_at") or "", "entries": latest["entries"], "links": latest["links"], "commit": None}
    if not rows or not (rows[-1]["version"] == newest["version"] and rows[-1]["entries"] == newest["entries"] and rows[-1]["links"] == newest["links"]):
        rows = rows + [newest]
    else:
        newest = {**rows[-1]}
    flags = flag_history(rows, threshold)
    shown = lambda r: {k: r.get(k) for k in ("version", "date", "entries", "links", "commit")}
    out = {"held": False, "reason": "", "ref": "main", "use": shown(newest), "latest": shown(newest)}
    if flags[-1]:
        return out
    last_ok = next((r for r, f in zip(reversed(rows), reversed(flags)) if f), None)
    if accept_latest:
        out["reason"] = "accepted by hand"
    elif last_ok is None or not last_ok.get("commit"):
        out["reason"] = "no complete earlier catalogue to fall back on"
    elif (_date(newest["date"]) - _date(last_ok["date"])).days > max_hold_days:
        out["reason"] = f"accepted: no complete catalogue for more than {max_hold_days} days"
    else:
        ref_e = max(r["entries"] for r, f in zip(rows, flags) if f)
        drop = 100 * (1 - newest["entries"] / ref_e)
        out.update(held=True, ref=last_ok["commit"], use=shown(last_ok),
                   reason=f"{newest['entries']:,} entries and {newest['links']:,} links against {last_ok['entries']:,} and {last_ok['links']:,} "
                          f"in the last complete catalogue ({drop:.0f}% fewer entries)")
    return out


# ----------------------------------------------------------------------------------------------------------------- scheduled check

SAME_KEYS = ("version", "generated_at", "entries", "links")


def should_rebuild(event: str, ours: dict | None, theirs: dict | None, now: dt.datetime | None = None) -> tuple[bool, str]:
    """The three-hourly check: rebuild only when romgi has published something this site has not weighed yet.
    ours is the site's own version.json; theirs is romgi's. A catalogue the site held back counts as weighed (otherwise every check
    would rebuild during an outage), except that a held one is looked at again once it is old enough to be accepted."""
    if event != "schedule":
        return True, f"started by {event}"
    if not theirs:
        return False, "cannot read romgi's version.json, so the site stays as it is"
    seen = (ours or {}).get("latest") or (ours or {}).get("romgi") or {}
    if not ours or any(seen.get(k) != theirs.get(k) for k in SAME_KEYS):
        return True, "romgi has published something the site has not weighed yet"
    held = (ours or {}).get("latest")
    if held and ((now or dt.datetime.now(dt.timezone.utc)) - _date(held["generated_at"])).days > MAX_HOLD_DAYS:
        return True, f"the catalogue held back is more than {MAX_HOLD_DAYS} days old, so it is accepted now"
    return False, "the site already shows romgi's latest catalogue" + (" (held back as unfinished)" if held else "")


# ----------------------------------------------------------------------------------------------------------------- command line

def _fetch_json(url: str):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "romgi-explorer", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception as e:                           # offline or not there yet
        print(f"could not read {url}: {e}", file=sys.stderr)
        return None


def cmd_check(a) -> int:
    allow = {int(x) for x in os.environ.get("ROMGI_ALLOW_SCHEMA", "").replace(",", " ").split() if x.isdigit()}
    vj = json.loads(Path(a.version_json).read_text()) if Path(a.version_json).exists() else {}
    con = sqlite3.connect(f"file:{a.db}?mode=ro", uri=True)
    rep = check_catalogue(con, vj, allow)
    con.close()
    for m in rep.notes:
        print("note:", m)
    for m in rep.fatal:
        print("STOPPED:", m, file=sys.stderr)
    summary(rep.markdown("Is it the catalogue format this explorer reads?"))
    if rep.fatal:
        print("The previous site stays up.", file=sys.stderr)
        return 1
    print("ok: the format and the values the builder relies on are as expected")
    return 0


def cmd_rebuild(a) -> int:
    rebuild, why = should_rebuild(a.event, _fetch_json(a.site), _fetch_json(a.romgi))
    print(why)
    summary(f"### Check\n\n{why}\n")
    gh = os.environ.get("GITHUB_OUTPUT")
    line = f"rebuild={'true' if rebuild else 'false'}\n"
    if gh:
        with open(gh, "a") as f:
            f.write(line)
    else:
        print(line, end="")
    return 0


def cmd_summary(a) -> int:
    """A table for the run's summary page: which catalogue the site shows, whether the newest was held back, and what the files weigh."""
    site = Path(a.site)
    vj = json.loads((site / "version.json").read_text())
    pick = json.loads(Path(a.pick).read_text()) if a.pick and Path(a.pick).exists() else {}
    shown = vj.get("romgi", {})
    out = ["### The site", "", f"Shows romgi's catalogue **{shown.get('version')}** (generated {str(shown.get('generated_at'))[:10]}): "
           f"{shown.get('entries', 0):,} entries, {shown.get('links', 0):,} links."]
    if vj.get("latest"):
        out.append(f"romgi's newest catalogue ({vj['latest']['version']}) was **held back** as unfinished: {vj['latest']['reason']}.")
    out += ["", "| File | Size |", "|---|---|"]
    for key, label in (("data", "first data file (numbers)"), ("detail", "second data file (titles, sizes)"), ("art", "box-art paths"), ("db", "SQL copy")):
        f = site / (vj.get(key) or "")
        if vj.get(key) and f.exists():
            out.append(f"| {label} | {f.stat().st_size / 1e6:.2f} MB |")
    out.append(f"| index.html | {(site / 'index.html').stat().st_size / 1e6:.2f} MB |")
    text = "\n".join(out) + "\n"
    print(text)
    summary(text)
    return 0


def cmd_pick(a) -> int:
    latest = json.loads(Path(a.latest).read_text())
    history = json.loads(Path(a.history).read_text())
    accept = os.environ.get("ROMGI_ACCEPT_LATEST", "").lower() in ("1", "true", "yes")
    out = pick_catalogue(latest, history, accept_latest=accept)
    Path(a.out).write_text(json.dumps(out, indent=1) + "\n")
    msg = (f"holding back romgi's newest catalogue ({out['latest']['version']}): {out['reason']}. Showing {out['use']['version']} instead."
           if out["held"] else (f"using romgi's newest catalogue ({out['use']['version']})" + (f" ({out['reason']})" if out["reason"] else "")))
    print(msg)
    summary(f"### Which catalogue to show\n\n{msg}\n")
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a") as f:
            f.write(f"ref={out['ref']}\nheld={'true' if out['held'] else 'false'}\n")
    else:
        print(f"ref={out['ref']}\nheld={'true' if out['held'] else 'false'}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check"); c.add_argument("db"); c.add_argument("version_json"); c.set_defaults(fn=cmd_check)
    r = sub.add_parser("rebuild", help="the scheduled check: has romgi published something this site has not weighed yet?")
    r.add_argument("--event", required=True); r.add_argument("--site", required=True)
    r.add_argument("--romgi", default="https://raw.githubusercontent.com/caprado/romgi/main/db/version.json"); r.set_defaults(fn=cmd_rebuild)
    m = sub.add_parser("summary", help="write the run summary: what the site shows and what its files weigh")
    m.add_argument("site"); m.add_argument("pick", nargs="?"); m.set_defaults(fn=cmd_summary)
    p = sub.add_parser("pick")
    p.add_argument("--latest", required=True); p.add_argument("--history", required=True); p.add_argument("--out", required=True)
    p.add_argument("--site", help="the site's own version.json (unused here; kept so the workflow reads the same in both jobs)")
    p.set_defaults(fn=cmd_pick)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
