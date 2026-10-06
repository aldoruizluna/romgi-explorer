#!/usr/bin/env python3
"""
build_dataset.py - turn romgi's romdb.db into the columnar dataset the explorer runs on.

  python3 build_dataset.py --db romdb.db --version-json version.json --out dist/dataset.json.gz
  python3 build_dataset.py --db romdb.db --local          # adds box-art URLs and the local-server capabilities

Importable: build(db_path, local=False, ...) -> dict

The explorer slices this dataset in memory, so everything it filters or groups by is a flat array
(one entry per catalog row). Anything it only needs for a single record (filenames, URLs, torrent
paths) stays in the database and is fetched on demand by serve.py.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import gzip
import json
import math
import re
import sqlite3
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
BUILD_VERSION = 8   # bump when the dataset format changes; serve.py keys its cache on it

# Fixed entity order. Colour slots are assigned by this order and never by rank, so a source keeps its colour.
SOURCE_ORDER = ["minerva", "internet_archive", "nopaystation", "mariocube"]
SOURCE_SHORT = {"minerva": "MiNERVA", "internet_archive": "Internet Archive",
                "nopaystation": "NoPayStation", "mariocube": "MarioCube"}
REGION_ORDER = ["us", "eu", "jp", "other"]
REGION_NAMES = {"us": "USA", "eu": "Europe", "jp": "Japan", "other": "Other"}

KiB, MiB, GiB, TiB = 1 << 10, 1 << 20, 1 << 30, 1 << 40
SIZE_EDGES = [512 * KiB, 16 * MiB, 700 * MiB, int(4.7 * GiB)]   # buckets 1..5; 0 = unknown, 6 = suspect

# A size is "suspect" when no real copy could have it. Every source: a terabyte or more. Internet Archive only (its sizes are
# scraped from page text with a loose pattern, which yields round junk such as 20G and 28T): more than the platform's medium holds.
# MiNERVA, NoPayStation and MarioCube read sizes from torrent metadata or structured listings, and their large files are real
# (for example 18 to 34 GiB Dragon Quest X DLC dumps for Wii), so the medium rule does not apply to them.
SUSPECT_SOURCE = "internet_archive"
MEDIA = {
    "cartridge": (700 * MiB, ["nes", "fds", "snes", "n64", "ndd", "gb", "gbc", "gba", "vb", "min", "nds", "dsi", "sms", "gg", "smd",
                              "32x", "a26", "a52", "a78", "lynx", "jag", "cv", "intv", "tg16"]),
    "CD": (2 * GiB, ["ps1", "sat", "scd", "tgcd", "ngcd", "cdi", "3do", "pcfx", "jcd", "dc", "fmt", "pc98", "pip"]),
    "DVD": (12 * GiB, ["ps2", "xbox", "x360", "gc", "wii", "psp", "3ds"]),
}
PLATFORM_LIMIT = {pid: lim for lim, ids in MEDIA.values() for pid in ids}


def _ids(ids):
    return ", ".join(f"'{p}'" for p in ids)


SUSPECT_SQL = (f"(l.size >= {TiB} OR (l.source_id = '{SUSPECT_SOURCE}' AND (" + " OR ".join(
    f"(l.size >= {lim} AND l.entry IN (SELECT slug FROM entries WHERE platform IN ({_ids(ids)})))" for lim, ids in MEDIA.values()) + ")))")

SIZE_BUCKETS = [
    {"id": 0, "label": "Unknown", "hint": "0 bytes or missing", "sql": "(l.size IS NULL OR l.size = 0)"},
    {"id": 1, "label": "Cart-size", "hint": "under 512 KiB", "sql": f"(l.size > 0 AND l.size < {SIZE_EDGES[0]})"},
    {"id": 2, "label": "Small", "hint": "512 KiB to 16 MiB", "sql": f"(l.size >= {SIZE_EDGES[0]} AND l.size < {SIZE_EDGES[1]})"},
    {"id": 3, "label": "CD-class", "hint": "16 to 700 MiB", "sql": f"(l.size >= {SIZE_EDGES[1]} AND l.size < {SIZE_EDGES[2]})"},
    {"id": 4, "label": "DVD-class", "hint": "700 MiB to 4.7 GiB", "sql": f"(l.size >= {SIZE_EDGES[2]} AND l.size < {SIZE_EDGES[3]} AND NOT {SUSPECT_SQL})"},
    {"id": 5, "label": "Beyond DVD", "hint": "4.7 GiB and up", "sql": f"(l.size >= {SIZE_EDGES[3]} AND NOT {SUSPECT_SQL})"},
    {"id": 6, "label": "Suspect", "hint": "impossible for the platform, or 1 TiB and up", "sql": SUSPECT_SQL},
]

# Release flags are read from the No-Intro style tags inside titles. Each one is defined by a substring
# (or a GLOB) so the explorer can print the exact SQL that reproduces the slice.
FLAGS = [
    {"id": "dlc", "label": "DLC", "needles": ["(dlc"]},
    {"id": "addon", "label": "Add-on", "needles": ["(addon"]},
    {"id": "update", "label": "Update", "needles": ["(update"]},
    {"id": "demo", "label": "Demo", "needles": ["(demo"]},
    {"id": "trial", "label": "Trial", "needles": ["(trial"]},
    {"id": "beta", "label": "Beta", "needles": ["(beta"]},
    {"id": "proto", "label": "Prototype", "needles": ["(proto"]},
    {"id": "sample", "label": "Sample", "needles": ["(sample"]},
    {"id": "unl", "label": "Unlicensed", "needles": ["(unl"]},
    {"id": "aftermarket", "label": "Aftermarket", "needles": ["(aftermarket"]},
    {"id": "pirate", "label": "Pirate", "needles": ["(pirate"]},
    {"id": "alt", "label": "Alternate", "needles": ["(alt"]},
    {"id": "rev", "label": "Revision", "needles": ["(rev "]},
    {"id": "ver", "label": "Versioned", "glob": "*(v[0-9]*"},
    {"id": "vc", "label": "Virtual Console", "needles": ["(virtual console"]},
    {"id": "disc", "label": "Disc tag", "needles": ["(disc"]},
    {"id": "psn", "label": "PSN release", "needles": ["(psn"]},
    {"id": "xbl", "label": "Xbox Live", "needles": ["(xbla", "(xblig"]},
    {"id": "ndig", "label": "Nintendo digital", "needles": ["(eshop", "(wiiware", "(dsiware"]},
    {"id": "theme", "label": "Theme or avatar", "needles": ["(theme", "(dynamic theme", "(avatar"]},
    {"id": "bios", "label": "BIOS", "needles": ["[bios]"]},
    {"id": "baddump", "label": "Bad dump", "needles": ["[b]"]},
    {"id": "moji", "label": "Mojibake title", "special": "mojibake"},
    {"id": "padded", "label": "Stray spaces", "special": "padded"},
    {"id": "empty", "label": "Empty title", "special": "empty"},
]
for _f in FLAGS:
    if "needles" in _f:
        parts = [f"instr(lower(e.title), '{n}') > 0" for n in _f["needles"]]
        _f["sql"] = parts[0] if len(parts) == 1 else "(" + " OR ".join(parts) + ")"
    elif "glob" in _f:
        _f["sql"] = f"e.title GLOB '{_f['glob']}'"
        _f["re"] = r"\(v[0-9]"
    elif _f.get("special") == "padded":
        _f["sql"] = "e.title <> trim(e.title)"
    elif _f.get("special") == "empty":
        _f["sql"] = "e.title = ''"
    else:
        _f["sql"] = None

SENSITIVE = {("links", "url"), ("links", "source_url"), ("links", "filename"), ("links", "torrent_file_path"),
             ("links", "name"), ("links", "torrent_infohash"), ("torrents", "infohash"), ("torrents", "magnet"),
             ("torrents", "torrent_blob"), ("entries", "boxart_url")}
URL_COLS = {("links", "url"), ("links", "source_url"), ("entries", "boxart_url")}

_ASCII_LOWER = {i: i + 32 for i in range(65, 91)}


TITLE_PUNCT = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"     # leading ASCII punctuation never decides where a title sorts


def title_order_sql(col: str) -> str:
    """The ORDER BY the explorer's default title order is equal to: empty titles last, leading punctuation ignored."""
    lit = TITLE_PUNCT.replace("'", "''")
    return f"(trim({col}) = ''), ltrim(trim({col}), '{lit}') COLLATE NOCASE"


def initial_class(title: str) -> int:
    """What the "Starts with" facet files a title under: 0 other, 1 digit, 2..27 A..Z. The first non-space character decides
    (SQL's trim() removes spaces only), and only ASCII letters and digits count, exactly as the browser used to work it out."""
    s = title.lstrip(" ")
    if not s:
        return 0
    c = ord(s[0])
    return c - 63 if 65 <= c <= 90 else c - 95 if 97 <= c <= 122 else 1 if 48 <= c <= 57 else 0


def ascii_lower(s: str) -> str:
    """SQLite's lower() only folds ASCII; mirror it exactly so the SQL the UI prints matches the UI."""
    return s.translate(_ASCII_LOWER)


def fix_mojibake(t: str):
    """Return the repaired title when it is UTF-8 that was decoded as Latin-1, else None."""
    if t.isascii():
        return None
    try:
        raw = t.encode("latin-1")
        fixed = raw.decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    return fixed if fixed != t else None


def slugify(t: str) -> str:
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower().replace("&", " and ").replace("+", " plus ")
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def size_bucket(s, source=None, platform=None) -> int:
    """Reference implementation of the size classes; the page and the SQL in SIZE_BUCKETS must agree with it."""
    if not s:
        return 0
    if s >= TiB or (source == SUSPECT_SOURCE and s >= PLATFORM_LIMIT.get(platform, TiB)):
        return 6
    b = 1
    for e in SIZE_EDGES:
        if s >= e:
            b += 1
    return b


def norm_type(t):
    return "Game (multi-part)" if re.match(r"^Game #\d+$", t or "") else (t or "")


def pack_label(name: str) -> str:
    m = re.match(r"Minerva_Myrient_v[\d.]+/Minerva_Myrient - (.*)\.torrent$", name or "")
    return m.group(1) if m else (name or "")


def q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def build(db_path, *, local=False, version_json=None, history_json=None, profiles=True, keep_slugs=False, keep_art=False, log=print) -> dict:
    t0 = time.time()
    db_path = str(db_path)
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = con.cursor()

    def scalar(sql, *args):
        return cur.execute(sql, args).fetchone()[0]

    # ------------------------------------------------------------------ dimensions
    plat_rows = cur.execute("SELECT id, brand, name FROM platforms").fetchall()
    plat_count = dict(cur.execute("SELECT platform, COUNT(*) FROM entries GROUP BY platform").fetchall())
    brand_total = collections.Counter()
    for pid, brand, _ in plat_rows:
        brand_total[brand] += plat_count.get(pid, 0)
    brands = [b for b, _ in brand_total.most_common()]
    plat_rows.sort(key=lambda r: (brands.index(r[1]), -plat_count.get(r[0], 0), r[2]))
    plat_idx = {r[0]: i for i, r in enumerate(plat_rows)}
    platforms = [{"id": r[0], "code": r[0].upper(), "brand": brands.index(r[1]), "name": r[2], "limit": PLATFORM_LIMIT.get(r[0])}
                 for r in plat_rows]

    region_rows = {r[0]: r[1] for r in cur.execute("SELECT id, name FROM regions")}
    regions = [{"id": r, "name": REGION_NAMES.get(r, region_rows.get(r, r))} for r in REGION_ORDER]
    assert set(region_rows) <= set(REGION_ORDER), f"unexpected regions {set(region_rows) - set(REGION_ORDER)}"

    src_rows = {r[0]: r for r in cur.execute(
        "SELECT id, name, homepage, kind, auth_required, priority, manifest_json FROM sources")}
    health = {r[0]: r for r in cur.execute(
        "SELECT source_id, status, last_checked, reason, entry_count, link_count FROM source_health")}
    assert set(src_rows) == set(SOURCE_ORDER), f"sources changed: {sorted(src_rows)}"
    src_idx = {s: i for i, s in enumerate(SOURCE_ORDER)}
    sources = []
    for sid in SOURCE_ORDER:
        r = src_rows[sid]
        h = health.get(sid)
        sources.append({
            "id": sid, "name": r[1], "short": SOURCE_SHORT[sid], "homepage": r[2], "kind": r[3],
            "auth_required": r[4], "priority": r[5], "manifest": json.loads(r[6] or "{}"),
            "health": None if not h else {
                "status": h[1], "last_checked": h[2], "reason": h[3], "entries": h[4], "links": h[5]},
        })

    # torrent packs, biggest first
    pack_use = dict(cur.execute(
        "SELECT torrent_infohash, COUNT(*) FROM links WHERE torrent_infohash IS NOT NULL GROUP BY 1").fetchall())
    trows = cur.execute("SELECT infohash, name, magnet, torrent_blob IS NOT NULL, total_size, piece_length, "
                        "file_count, trackers_json, added_at FROM torrents").fetchall()
    trows.sort(key=lambda r: (-pack_use.get(r[0], 0), r[1] or ""))
    pack_idx = {r[0]: i for i, r in enumerate(trows)}
    collections_ = []
    packs = []
    for r in trows:
        label = pack_label(r[1])
        coll = label.split(" - ")[0]
        if coll not in collections_:
            collections_.append(coll)
        packs.append({"infohash": r[0] if local else None, "name": r[1], "label": label, "collection": collections_.index(coll),
                      "magnet": r[2] if local else None, "has_blob": bool(r[3]), "total_size": r[4],
                      "piece_length": r[5], "file_count": r[6], "added_at": r[8]})
    assert len(packs) < 255

    # ------------------------------------------------------------------ entries
    erows = cur.execute("SELECT slug, rom_id, title, platform, boxart_url, ra_game_id, ra_num_achievements "
                        "FROM entries").fetchall()
    erows.sort(key=lambda r: (r[2].strip(" ") == "", ascii_lower(r[2].strip(" ").lstrip(TITLE_PUNCT)), plat_idx[r[3]], r[0]))   # SQL: ORDER BY title_order_sql('title')
    eidx = {r[0]: i for i, r in enumerate(erows)}
    nE = len(erows)

    regs = collections.defaultdict(list)
    for entry, region in cur.execute("SELECT entry, region FROM regions_entries ORDER BY rowid"):
        regs[entry].append(region)

    e_title, e_plat, e_reg, e_rom, e_ra, e_ran, e_flags, e_artk = [], [], [], [], [], [], [], []
    e_initial, e_tback, e_hasser = [], [], []    # derived from the text here, so the page can start without the text
    e_art = []
    slug_x = {}
    fixes = {}
    flag_counts = collections.Counter()
    tkey_seen = {}
    for i, (slug, rom, title, plat, art, ra, ran) in enumerate(erows):
        e_title.append(title)
        e_initial.append(initial_class(title))
        # One id per platform and title, counted up as titles first appear. Only the way back is written: 0 for a new title,
        # else how many ids ago it was first seen. Those are almost all 0 (68 are not), so the column compresses to 22 KB, not 455.
        tk = tkey_seen.get((plat_idx[plat], title))
        if tk is None:
            tkey_seen[(plat_idx[plat], title)] = len(tkey_seen)
            e_tback.append(0)
        else:
            e_tback.append(len(tkey_seen) - tk)
        e_hasser.append(1 if rom else 0)
        e_plat.append(plat_idx[plat])
        rs = regs.get(slug, [])
        assert len(rs) <= 3
        e_reg.append(sum((REGION_ORDER.index(r) + 1) * 5 ** k for k, r in enumerate(rs)))
        e_rom.append(rom or "")
        e_ra.append(ra or 0)
        e_ran.append(ran or 0)
        tl = ascii_lower(title)
        mask = 0
        fx = fix_mojibake(title)
        for bit, f in enumerate(FLAGS):
            hit = False
            if f.get("special") == "mojibake":
                hit = fx is not None
            elif f.get("special") == "padded":
                hit = title != title.strip(" ")
            elif f.get("special") == "empty":
                hit = title == ""
            elif "re" in f:
                hit = re.search(f["re"], title) is not None
            else:
                hit = any(n in tl for n in f["needles"])
            if hit:
                mask |= 1 << bit
                flag_counts[f["id"]] += 1
        e_flags.append(mask)
        if fx is not None:
            fixes[i] = fx
        if art and art.startswith("https://art.gametdb.com/"):
            e_artk.append(1)
            e_art.append(art[len("https://art.gametdb.com/"):])
        elif art and art.startswith("https://thumbnails.libretro.com/"):
            e_artk.append(2)
            e_art.append(art[len("https://thumbnails.libretro.com/"):])
        else:
            e_artk.append(0)
            e_art.append("")
            assert not art, f"unrecognised art host: {art}"
        derived = slugify(title) + "-" + plat + ("-" + "-".join(rs) if rs else "")
        # The browser can only rebuild slugs from ASCII titles, so every other title keeps its slug verbatim.
        if derived != slug or not title.isascii():
            slug_x[i] = slug

    # ------------------------------------------------------------------ links
    type_counts = collections.Counter()
    fmt_counts = collections.Counter()
    lrows = []
    for entry, typ, fmt, size, sid, auth, ih, tidx, fname in cur.execute(
            "SELECT entry, type, format, size, source_id, requires_auth, torrent_infohash, torrent_file_index, filename FROM links"):
        typ = norm_type(typ)
        fmt = fmt or ""
        type_counts[typ] += 1
        fmt_counts[fmt] += 1
        lrows.append((eidx[entry], src_idx[sid], typ, fmt, size or 0, auth or 0,
                      pack_idx[ih] if ih in pack_idx else -1, tidx if tidx is not None else -1, fname or ""))
    types = [t for t, _ in type_counts.most_common()]
    formats = [f for f, _ in fmt_counts.most_common()]
    t_idx = {t: i for i, t in enumerate(types)}
    f_idx = {f: i for i, f in enumerate(formats)}
    lrows.sort(key=lambda r: (r[0], r[1], t_idx[r[2]], f_idx[r[3]], r[4], r[7], r[8]))
    nL = len(lrows)
    l_src = [r[1] for r in lrows]
    l_type = [t_idx[r[2]] for r in lrows]
    l_fmt = [f_idx[r[3]] for r in lrows]
    l_size = [r[4] for r in lrows]
    l_pack = [r[6] for r in lrows]
    l_tidx = [r[7] for r in lrows]
    l_auth = [i for i, r in enumerate(lrows) if r[5]]
    e_nl = [0] * nE
    for r in lrows:
        e_nl[r[0]] += 1

    # ------------------------------------------------------------------ groups
    grows = cur.execute("SELECT id, kind, title, platform, member_count FROM entry_groups ORDER BY id").fetchall()
    gmem = collections.defaultdict(list)
    for gid, entry, mi, label in cur.execute(
            "SELECT group_id, entry, member_index, member_label FROM entry_group_members ORDER BY group_id, member_index"):
        gmem[gid].append([eidx[entry], label or ""])
    groups = [{"id": g[0], "kind": g[1], "title": g[2], "platform": plat_idx.get(g[3], -1), "members": gmem[g[0]]}
              for g in grows]
    e_group = [-1] * nE
    for gi, g in enumerate(groups):
        for ei, _ in g["members"]:
            e_group[ei] = gi

    # ------------------------------------------------------------------ meta
    vj = {}
    vp = Path(version_json) if version_json else Path(db_path).with_name("version.json")
    if vp.exists():
        vj = json.loads(vp.read_text())
    page_size = scalar("PRAGMA page_size")
    page_count = scalar("PRAGMA page_count")
    counts = {t: scalar(f"SELECT COUNT(*) FROM {q(t)}") for (t,) in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()}
    meta = {
        "version": vj.get("version") or time.strftime("%Y%m%d"),
        "generated_at": vj.get("generated_at"), "schema_version": vj.get("schema_version"),
        "min_app_version": vj.get("min_app_version"), "gz_size": vj.get("size"),
        "db_bytes": page_size * page_count, "page_size": page_size, "page_count": page_count,
        "counts": counts, "built_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "caps": {"sql": local, "urls": local, "art": local, "download": local},
        "sql_title_order": title_order_sql("e.title"),
        "source_repo": "https://github.com/caprado/romgi",
    }

    # ------------------------------------------------------------------ schema, storage, profiles
    schema, storage = build_schema(con, cur, counts, profiles=profiles, snapshot=not local, log=log)

    # ------------------------------------------------------------------ history + quality
    history = []
    hp = Path(history_json) if history_json else HERE / "data" / "history.json"
    if hp.exists():
        history = json.loads(hp.read_text())
    quality = build_quality(cur, scalar, meta, vj, history, flag_counts, len(fixes), nE, nL, slug_x)

    dataset = {
        "v": 1,
        "meta": meta,
        "dims": {
            "brands": brands, "platforms": platforms, "regions": regions, "sources": sources,
            "types": types, "formats": formats, "packs": packs, "collections": collections_,
            "flags": [{"id": f["id"], "label": f["label"], "sql": f["sql"]} for f in FLAGS],
            "sizes": SIZE_BUCKETS, "groups": groups, "suspect": {"tib": TiB, "source": SUSPECT_SOURCE},
        },
        "entries": {
            "n": nE, "title": e_title, "platform": e_plat, "reg": e_reg, "rom": e_rom, "ra": e_ra, "ran": e_ran,
            "flags": e_flags, "nl": e_nl, "artk": e_artk, "group": e_group, "slug_x": slug_x, "fix": fixes,
            "initial": e_initial, "tback": e_tback, "hasser": e_hasser, "ntitles": len(tkey_seen),
            **({"art": e_art} if local else {}),
        },
        "links": {"n": nL, "src": l_src, "type": l_type, "fmt": l_fmt, "size": l_size, "pack": l_pack,
                  "tidx": l_tidx, "auth": l_auth},
        "schema": schema, "storage": storage, "quality": quality, "history": history,
        "examples": EXAMPLES,
    }
    if keep_slugs:
        dataset["_slugs"] = [r[0] for r in erows]
    if keep_art:          # the hosted site loads these paths as a separate file, after the page is usable
        dataset["_art"] = e_art
    con.close()
    log(f"built dataset in {time.time() - t0:.1f}s: {nE:,} entries, {nL:,} links, "
        f"{len(slug_x):,} slug exceptions, {len(fixes):,} mojibake titles")
    return dataset


# ---------------------------------------------------------------------- schema
def build_schema(con, cur, counts, *, profiles, snapshot, log):
    tables = []
    master = cur.execute("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").fetchall()
    ddl = {name: sql for _, name, _, sql in master}
    try:
        dbstat = {r[0]: (r[1], r[2]) for r in cur.execute(
            "SELECT name, SUM(pgsize), COUNT(*) FROM dbstat GROUP BY name")}
    except sqlite3.Error:
        dbstat = {}
    storage = [{"name": n, "bytes": b, "pages": p, "kind": "index" if n.startswith(("idx_", "sqlite_autoindex")) else "table"}
               for n, (b, p) in sorted(dbstat.items(), key=lambda kv: -kv[1][0])]
    for typ, name, tbl, sql in master:
        if typ != "table":
            continue
        kind = "fts" if (sql or "").upper().startswith("CREATE VIRTUAL TABLE") else \
               "shadow" if re.match(r"entries_fts_", name) else "table"
        cols = cur.execute(f"PRAGMA table_info({q(name)})").fetchall()
        fks = [{"from": r[3], "table": r[2], "to": r[4]} for r in cur.execute(f"PRAGMA foreign_key_list({q(name)})")]
        idxs = []
        for r in cur.execute(f"PRAGMA index_list({q(name)})").fetchall():
            icols = [c[2] for c in cur.execute(f"PRAGMA index_info({q(r[1])})")]
            idxs.append({"name": r[1], "unique": bool(r[2]), "origin": r[3], "cols": icols})
        entry = {
            "name": name, "kind": kind, "rows": counts.get(name), "ddl": sql,
            "bytes": dbstat.get(name, (None, None))[0],
            "idx_bytes": sum(dbstat.get(i["name"], (0, 0))[0] for i in idxs),
            "columns": [{"name": c[1], "type": c[2], "notnull": bool(c[3]), "default": c[4], "pk": bool(c[5])} for c in cols],
            "fks": fks, "indexes": idxs,
        }
        tables.append(entry)
    if profiles:
        t0 = time.time()
        for t in tables:
            if t["kind"] in ("shadow", "fts"):
                continue
            for c in t["columns"]:
                c["profile"] = profile_column(con, t["name"], c["name"], c["type"], t["rows"],
                                              sensitive=snapshot and (t["name"], c["name"]) in SENSITIVE)
        log(f"profiled columns in {time.time() - t0:.1f}s")
    return tables, storage


def profile_column(con, table, col, ctype, rows, sensitive):
    cq, tq = q(col), q(table)
    is_blob = ctype.upper() == "BLOB"
    n, nulls, distinct = con.execute(f"SELECT COUNT(*), SUM({cq} IS NULL), COUNT(DISTINCT {cq}) FROM {tq}").fetchone()
    p = {"nulls": nulls or 0, "distinct": distinct}
    if is_blob:
        p["blobs"] = con.execute(f"SELECT COUNT({cq}) FROM {tq}").fetchone()[0]
        return p
    is_text = ctype.upper() in ("TEXT", "") or "CHAR" in ctype.upper()
    if is_text:
        p["empty"] = con.execute(f"SELECT SUM({cq} = '') FROM {tq}").fetchone()[0] or 0
    if not sensitive:
        mn, mx = con.execute(f"SELECT MIN({cq}), MAX({cq}) FROM {tq}").fetchone()
        p["min"], p["max"] = mn, mx
    if (table, col) in URL_COLS:
        hosts = collections.Counter()
        for (u,) in con.execute(f"SELECT {cq} FROM {tq} WHERE {cq} IS NOT NULL AND {cq} <> ''"):
            hosts[urlparse(u).netloc] += 1
        p["hosts"] = hosts.most_common(8)
    elif not sensitive and 0 < distinct <= 3000:
        p["top"] = [[v, c] for v, c in con.execute(
            f"SELECT {cq}, COUNT(*) c FROM {tq} GROUP BY 1 ORDER BY c DESC, 1 LIMIT 8")]
    if ctype.upper() == "INTEGER" and distinct > 40 and not sensitive:
        vals = [r[0] for r in con.execute(f"SELECT {cq} FROM {tq} WHERE {cq} IS NOT NULL AND {cq} > 0")]
        if vals:
            lo, hi = min(vals), max(vals)
            nb = 14
            span = math.log10(hi) - math.log10(lo) or 1
            bins = [0] * nb
            for v in vals:
                bins[min(nb - 1, int((math.log10(v) - math.log10(lo)) / span * nb))] += 1
            p["hist"] = {"lo": lo, "hi": hi, "log": True, "bins": bins}
    return p


# ---------------------------------------------------------------------- quality
def build_quality(cur, scalar, meta, vj, history, flag_counts, n_moji, nE, nL, slug_x):
    out = []

    def add(id, sev, title, summary, count=None, total=None, preset=None, sql=None, action=None, evidence=None):
        out.append({"id": id, "sev": sev, "title": title, "summary": summary, "count": count, "total": total,
                    "preset": preset, "sql": sql, "action": action, "evidence": evidence})

    # 1. mojibake
    ex = cur.execute("SELECT title FROM entries WHERE title GLOB '*â*' AND platform='ps3' LIMIT 1").fetchone()
    add("moji", "serious", "Titles with scrambled characters",
        "UTF-8 text was decoded as Latin-1 before it was stored, so “Us™” became “Usâ\u0084¢” and Japanese titles "
        "turned into noise. Every affected entry is a PlayStation 3 or Vita title from NoPayStation. Re-encoding the "
        "title as Latin-1 and decoding it as UTF-8 restores it; the drawer shows that repair.",
        n_moji, nE, {"grain": "entries", "flag": ["moji"]},
        sql="-- No exact SQL: the test is a Latin-1 round trip done at build time.\nSELECT COUNT(*) FROM entries WHERE platform IN ('ps3','psv') AND title GLOB '*[ÃÂãâ]*';",
        evidence=ex[0] if ex else None)

    # 2. sizes no real copy could have
    n_susp = scalar(f"SELECT COUNT(*) FROM links l WHERE {SUSPECT_SQL}")
    n_tib = scalar(f"SELECT COUNT(*) FROM links WHERE size >= {TiB}")
    by_src = dict(cur.execute(f"SELECT l.source_id, COUNT(*) FROM links l WHERE {SUSPECT_SQL} GROUP BY 1").fetchall())
    sigs = [s for s, _ in cur.execute(f"SELECT l.size_str, COUNT(*) c FROM links l WHERE {SUSPECT_SQL} GROUP BY 1 ORDER BY c DESC LIMIT 4")]
    add("sizes", "serious", "File sizes that no real copy could have",
        f"{n_susp:,} links claim a size the platform could not hold: {n_tib:,} are a terabyte or more, and {n_susp - n_tib:,} are bigger than the medium "
        "allows (a cartridge game over 700 MiB, a CD over 2 GiB, a DVD-era disc over 12 GiB). Their size_str values are round numbers such as "
        f"{', '.join(sigs)}, which look like a pattern match on the page row rather than a file size: the archived scraper took the first number "
        "followed by K, M, G or T. The explorer tags them Suspect and keeps them out of every size total. The capacity rule is applied to Internet Archive "
        "only; the other sources read sizes from torrent metadata or structured listings, and their largest files are real (Wii and 3DS digital dumps of 13 to 34 GiB).",
        n_susp, nL, {"grain": "links", "sz": [6]},
        sql=f"SELECT l.source_id, l.size_str, COUNT(*) AS links\nFROM links l WHERE {SUSPECT_SQL}\nGROUP BY 1, 2 ORDER BY links DESC LIMIT 25;",
        evidence=json.dumps(by_src))

    # 3. zero-size links
    n_zero = scalar("SELECT COUNT(*) FROM links WHERE size IS NULL OR size = 0")
    add("zero", "warn", "Links with no size", "These are mostly NoPayStation licence keys and a few archive items. The sizes are 0 or missing.",
        n_zero, nL, {"grain": "links", "sz": [0]}, sql="SELECT source_id, type, COUNT(*) FROM links WHERE size IS NULL OR size = 0 GROUP BY 1, 2;")

    # 4. torrent table
    nt = scalar("SELECT COUNT(*) FROM torrents")
    blobs = scalar("SELECT COUNT(torrent_blob) FROM torrents")
    sized = scalar("SELECT COUNT(total_size) FROM torrents")
    emptytr = scalar("SELECT COUNT(*) FROM torrents WHERE trackers_json = '[]' OR trackers_json IS NULL")
    add("torrents", "warn", "Torrent table carries almost nothing",
        f"{nt} packs, but {blobs} .torrent files, {sized} sizes and {nt - emptytr} tracker lists. Each row is only an infohash, a name and a "
        "magnet. The app has to resolve everything else from the swarm.",
        nt, nt, None, sql="SELECT COUNT(torrent_blob), COUNT(total_size), COUNT(piece_length), COUNT(file_count) FROM torrents;",
        action={"view": "schema", "table": "torrents"})

    # 5. requires_auth
    n_auth = scalar("SELECT COUNT(*) FROM links WHERE requires_auth = 1")
    add("auth", "warn", "No link is marked as login-only",
        f"{n_auth:,} of {nL:,} links have requires_auth = 1, although the Internet Archive manifest says some of its items need "
        "an account. The app's Login Required badge can only fire from this flag.",
        n_auth, nL, None, sql="SELECT source_id, SUM(requires_auth) FROM links GROUP BY 1;")

    # 6. history dips
    runs = []
    for i, h in enumerate(history):
        prev = [x["entries"] for x in history[max(0, i - 3):i] if x.get("entries")]
        base = sorted(prev)[len(prev) // 2] if prev else None
        if base and h.get("entries") and h["entries"] < 0.75 * base:
            if runs and runs[-1]["end_i"] == i - 1:
                runs[-1].update(end=h["date"][:10], end_i=i, min=min(runs[-1]["min"], h["entries"]), n=runs[-1]["n"] + 1)
            else:
                runs.append({"start": h["date"][:10], "end": h["date"][:10], "start_i": i, "end_i": i,
                             "min": h["entries"], "base": base, "n": 1})
    if runs:
        parts = "; ".join(f"{r['start']} to {r['end']} ({r['n']} snapshot{'s' if r['n'] > 1 else ''}, {r['min']:,} entries against {r['base']:,} before)"
                          for r in runs)
        add("dips", "serious", "Weekly snapshots that shipped far fewer entries",
            "The app downloads whatever is published on main, so these weeks users received a catalogue missing roughly "
            f"a third to two fifths of its entries: {parts}.",
            len(runs), len(history), None, action={"view": "sources", "anchor": "history"},
            evidence=json.dumps(runs))

    # title hygiene
    n_pad = scalar("SELECT COUNT(*) FROM entries WHERE title <> trim(title)")
    n_empty = scalar("SELECT COUNT(*) FROM entries WHERE title = ''")
    add("titles", "warn", "Titles with stray spaces, or none at all",
        f"{n_pad:,} titles start or end with a space (almost all PlayStation 3 and Vita content from NoPayStation) and {n_empty} has no title text. "
        "They sort to the top of any plain ORDER BY title, so the explorer trims them for display and sorting.",
        n_pad + n_empty, nE, {"grain": "entries", "flag": ["padded", "empty"]},
        sql="SELECT slug, platform, '[' || title || ']' AS title FROM entries WHERE title <> trim(title) OR title = '' LIMIT 50;")

    # 7-9. coverage gaps
    n_noreg = scalar("SELECT COUNT(*) FROM entries e WHERE NOT EXISTS (SELECT 1 FROM regions_entries r WHERE r.entry = e.slug)")
    add("noreg", "info", "Entries without a region", "No row in regions_entries, so region filters never match them.",
        n_noreg, nE, {"grain": "entries", "reg": [4]},
        sql="SELECT COUNT(*) FROM entries e WHERE NOT EXISTS (SELECT 1 FROM regions_entries r WHERE r.entry = e.slug);")
    n_noser = scalar("SELECT COUNT(*) FROM entries WHERE COALESCE(rom_id, '') = ''")
    add("noser", "info", "Entries without a serial", "rom_id is empty. Arcade sets and most Super Nintendo titles have none.",
        n_noser, nE, {"grain": "entries", "ser": [0]}, sql="SELECT COUNT(*) FROM entries WHERE COALESCE(rom_id, '') = '';")
    n_noart = scalar("SELECT COUNT(*) FROM entries WHERE COALESCE(boxart_url, '') = ''")
    add("noart", "info", "Entries without box art", "No GameTDB or libretro thumbnail was matched.",
        n_noart, nE, {"grain": "entries", "art": [0]}, sql="SELECT COUNT(*) FROM entries WHERE COALESCE(boxart_url, '') = '';")

    # 10. duplicate titles
    dup = scalar("SELECT COUNT(*) FROM (SELECT 1 FROM entries GROUP BY platform, title HAVING COUNT(*) > 1) ")
    dup_rows = scalar("SELECT SUM(c) FROM (SELECT COUNT(*) c FROM entries GROUP BY platform, title HAVING COUNT(*) > 1)")
    add("dups", "info", "Same title, several entries",
        f"{dup:,} platform and title pairs appear more than once ({dup_rows:,} rows). They are regional or revision variants with "
        "different slugs, so counting entries is not counting games.",
        dup_rows, nE, None, sql="SELECT platform, title, COUNT(*) FROM entries GROUP BY 1, 2 HAVING COUNT(*) > 1 ORDER BY 3 DESC LIMIT 50;")

    # 11. integrity
    checks = {
        "links with no entry": "SELECT COUNT(*) FROM links l WHERE NOT EXISTS (SELECT 1 FROM entries e WHERE e.slug = l.entry)",
        "entries with no links": "SELECT COUNT(*) FROM entries e WHERE NOT EXISTS (SELECT 1 FROM links l WHERE l.entry = e.slug)",
        "entries with an unknown platform": "SELECT COUNT(*) FROM entries e WHERE NOT EXISTS (SELECT 1 FROM platforms p WHERE p.id = e.platform)",
        "regions_entries with an unknown region": "SELECT COUNT(*) FROM regions_entries r WHERE NOT EXISTS (SELECT 1 FROM regions x WHERE x.id = r.region)",
        "links with an unknown source": "SELECT COUNT(*) FROM links l WHERE NOT EXISTS (SELECT 1 FROM sources s WHERE s.id = l.source_id)",
        "links pointing at a missing torrent": "SELECT COUNT(*) FROM links l WHERE torrent_infohash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM torrents t WHERE t.infohash = l.torrent_infohash)",
        "groups whose member_count is wrong": "SELECT COUNT(*) FROM entry_groups g WHERE member_count != (SELECT COUNT(*) FROM entry_group_members m WHERE m.group_id = g.id)",
    }
    res = {k: scalar(v) for k, v in checks.items()}
    bad = {k: v for k, v in res.items() if v}
    add("fk", "serious" if bad else "ok", "Foreign keys and counts line up" if not bad else "Broken references",
        "Checked: " + ", ".join(f"{k} ({v})" for k, v in res.items()) + ".", sum(res.values()), None, None,
        sql="\n".join(v + ";" for v in checks.values()))

    # 12. quick_check and FTS parity
    qc = scalar("PRAGMA quick_check")
    add("quick", "ok" if qc == "ok" else "critical", "SQLite quick_check", f"PRAGMA quick_check returned “{qc}”.", None, None, None,
        sql="PRAGMA quick_check;")
    fts_docs = scalar("SELECT COUNT(*) FROM entries_fts_docsize")
    add("fts", "ok" if fts_docs == nE else "warn", "Full-text index matches the entries table",
        f"entries_fts holds {fts_docs:,} documents for {nE:,} entries. It indexes search_key, the title squashed with no spaces, "
        "so only one-word prefix queries such as MATCH 'supermario*' work, and the app searches with LIKE instead.",
        fts_docs, nE, None, sql="SELECT COUNT(*) FROM entries_fts WHERE entries_fts MATCH 'supermario*';")

    # 13. version.json vs the database
    if vj:
        ra_n = scalar("SELECT COUNT(*) FROM entries WHERE ra_game_id IS NOT NULL")
        pairs = [("entries", vj.get("entries"), nE), ("links", vj.get("links"), nL),
                 ("platforms", vj.get("platforms"), scalar("SELECT COUNT(*) FROM platforms")),
                 ("sources", vj.get("sources"), scalar("SELECT COUNT(*) FROM sources")),
                 ("retroachievements", vj.get("retroachievements"), ra_n),
                 ("uncompressed_size", vj.get("uncompressed_size"), meta["db_bytes"])]
        diffs = [f"{k}: manifest {a:,} vs database {b:,}" for k, a, b in pairs if a is not None and a != b]
        add("version", "warn" if diffs else "ok", "version.json agrees with the database",
            "; ".join(diffs) if diffs else "Entries, links, platforms, sources, RetroAchievements games and byte size all match the manifest.",
            len(diffs), len(pairs), None)

    # 14. slugs
    add("slugs", "info", "Slugs that are not title + platform + region",
        f"{len(slug_x):,} slugs cannot be rebuilt from the title, mostly the scrambled ones above. The explorer stores those verbatim.",
        len(slug_x), nE, None)
    return out


EXAMPLES = [
    {"title": "Search like the app does",
     "note": "The app matches every word as a case-insensitive substring of the title.",
     "sql": "SELECT e.platform, e.title, GROUP_CONCAT(DISTINCT r.name) AS regions\nFROM entries e\nLEFT JOIN regions_entries re ON re.entry = e.slug\nLEFT JOIN regions r ON r.id = re.region\nWHERE LOWER(e.title) LIKE '%zelda%' AND e.platform = 'n64'\nGROUP BY e.slug ORDER BY e.title LIMIT 50;"},
    {"title": "Every download option for one entry",
     "note": "Swap the slug for any entry; the drawer shows it under the title.",
     "sql": "SELECT source_id, type, format, filename, size, torrent_infohash IS NOT NULL AS via_torrent\nFROM links WHERE entry = 'super-mario-world-snes-eu';"},
    {"title": "Entries per platform and brand",
     "note": "Joins platforms to entries.",
     "sql": "SELECT p.brand, p.name, COUNT(*) AS entries\nFROM entries e JOIN platforms p ON p.id = e.platform\nGROUP BY p.id ORDER BY entries DESC;"},
    {"title": "Which sources offer each entry",
     "note": "The same overlap the Sources view draws as dots.",
     "sql": "SELECT offered_by, COUNT(*) AS entries FROM (\n  SELECT entry, GROUP_CONCAT(source_id, ' + ') AS offered_by\n  FROM (SELECT DISTINCT entry, source_id FROM links ORDER BY entry, source_id)\n  GROUP BY entry\n) GROUP BY offered_by ORDER BY entries DESC;"},
    {"title": "RetroAchievements coverage by platform",
     "note": "Only entries with a RetroAchievements game id.",
     "sql": "SELECT platform, COUNT(*) AS entries, SUM(ra_game_id IS NOT NULL) AS with_ra\nFROM entries GROUP BY platform HAVING with_ra > 0 ORDER BY with_ra DESC;"},
    {"title": "Biggest torrent packs",
     "note": "Packs are MiNERVA's multi-ROM torrents; each link holds one file index inside a pack.",
     "sql": "SELECT t.name, COUNT(*) AS links\nFROM links l JOIN torrents t ON t.infohash = l.torrent_infohash\nGROUP BY t.infohash ORDER BY links DESC LIMIT 20;"},
    {"title": "Sizes that cannot be real",
     "note": "More than a terabyte for a single file.",
     "sql": f"SELECT source_id, size_str, filename FROM links WHERE size > {TiB} ORDER BY size DESC LIMIT 50;"},
    {"title": "Multi-disc sets and their discs",
     "note": "entry_groups with kind = 'disc'.",
     "sql": "SELECT g.title, g.platform, m.member_label, m.entry\nFROM entry_groups g JOIN entry_group_members m ON m.group_id = g.id\nORDER BY g.title, m.member_index LIMIT 100;"},
    {"title": "Full-text prefix search",
     "note": "search_key has no spaces, so match one squashed prefix.",
     "sql": "SELECT e.slug, e.title FROM entries e\nJOIN entries_fts f ON f.docid = e.rowid\nWHERE entries_fts MATCH 'supermario*' LIMIT 20;"},
]


def to_json_bytes(dataset) -> bytes:
    return json.dumps(dataset, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True)
    ap.add_argument("--version-json")
    ap.add_argument("--history-json")
    ap.add_argument("--out", help="write gzip'd JSON here")
    ap.add_argument("--local", action="store_true", help="include box-art URLs and enable server-only features")
    ap.add_argument("--art-out", help="also write the box-art paths of every entry here (gzip'd JSON list), for the hosted site")
    ap.add_argument("--no-profiles", action="store_true")
    ap.add_argument("--stats", action="store_true", help="print the gzip size of every section")
    a = ap.parse_args()
    ds = build(a.db, local=a.local, version_json=a.version_json, history_json=a.history_json, profiles=not a.no_profiles, keep_art=bool(a.art_out))
    art = ds.pop("_art", None)
    raw = to_json_bytes(ds)
    gz = gzip.compress(raw, 9, mtime=0)
    print(f"json {len(raw) / 1e6:.2f} MB -> gzip {len(gz) / 1e6:.2f} MB")
    if a.stats:
        for k, v in ds.items():
            if isinstance(v, dict) and k in ("entries", "links", "dims"):
                for kk, vv in v.items():
                    b = json.dumps(vv, separators=(",", ":"), ensure_ascii=False).encode()
                    print(f"  {k}.{kk:<10} raw {len(b) / 1e3:>9.0f} KB  gz {len(gzip.compress(b, 9)) / 1e3:>8.0f} KB")
            else:
                b = json.dumps(v, separators=(",", ":"), ensure_ascii=False).encode()
                print(f"  {k:<16} raw {len(b) / 1e3:>9.0f} KB  gz {len(gzip.compress(b, 9)) / 1e3:>8.0f} KB")
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_bytes(gz)
        print("wrote", a.out)
    if a.art_out:
        Path(a.art_out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.art_out).write_bytes(gzip.compress(to_json_bytes(art), 9, mtime=0))
        print(f"wrote {a.art_out}  ({sum(1 for x in art if x):,} of {len(art):,} entries have a path)")


if __name__ == "__main__":
    sys.exit(main())
