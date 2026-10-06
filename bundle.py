#!/usr/bin/env python3
"""
bundle.py - build the self-contained version of the explorer (the dataset is embedded; no server needed).

  python3 bundle.py --db romdb.db --version-json version.json        # rebuilds the dataset
  python3 bundle.py --dataset dist/dataset.snapshot.json.gz          # reuse a dataset you already built
  python3 bundle.py --dataset dist/dataset.snapshot.json.gz --pages --out-dir site    # GitHub Pages: a small index.html
                                                                                       # plus catalogue.<hash>.bin, version.json and the files of the installable app

Writes, into dist/:
  romgi-explorer.artifact.html     page fragment, the form the Artifact tool publishes
  romgi-explorer.standalone.html   the same page as a complete HTML file you can open anywhere

The snapshot leaves out everything the hosted version cannot use or should not carry: download URLs, file names,
torrent paths, magnets, box-art URLs and the SQL console. Those stay in the local explorer (serve.py).
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import json
import sys
from pathlib import Path

import build_dataset as bd
import icons
import pwa
from compose import compose

HERE = Path(__file__).resolve().parent


CHUNK = 40_000          # a column longer than this is split into lines of this many values
# What only the Browse table, gallery, entry card, search and the size totals need: titles, serials, slugs, torrent file numbers and the
# exact sizes (62% of the first file when they were in it). Everything else, including each link's size class, is in the first file.
DETAIL_KEYS = {("entries", "title"), ("entries", "rom"), ("entries", "fix"), ("entries", "slug_x"), ("links", "tidx"), ("links", "size")}


def ndjson(ds: dict, detail: bool = False) -> bytes:
    """One JSON document per line: [section, key|null, value] or, for a long column, [section, key, values, offset].
    The browser parses each line in its own short task while the rest is still downloading. detail=False writes everything the
    page needs to start; detail=True writes the titles, serials, slugs, torrent file numbers and exact sizes that follow."""
    dump = lambda v: json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    lines = []
    for k, v in ds.items():
        if k in ("entries", "links") and isinstance(v, dict):
            for kk, vv in v.items():
                if ((k, kk) in DETAIL_KEYS) != detail:
                    continue
                if isinstance(vv, list) and len(vv) > CHUNK:
                    lines += [dump([k, kk, vv[o:o + CHUNK], o]) for o in range(0, len(vv), CHUNK)]
                else:
                    lines.append(dump([k, kk, vv]))
        elif not detail:
            lines.append(dump([k, None, v]))
    return ("\n".join(lines) + "\n").encode("utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db")
    ap.add_argument("--version-json")
    ap.add_argument("--dataset", help="gzip'd dataset JSON built by build_dataset.py (without --local)")
    ap.add_argument("--site-url", default="", help="with --pages: the public address of the site (ending in /), for link-preview tags and the social card")
    ap.add_argument("--live-db", help="with --pages: gzip'd link-free copy of the database from livedb.py; the site gets a SQL console that runs in the browser")
    ap.add_argument("--pick", help="with --pages: data/pick.json from drift.py pick; when romgi's newest catalogue was held back as unfinished, the site says so")
    ap.add_argument("--art", help="gzip'd box-art paths from build_dataset.py --art-out; with --pages they become a file the site loads after start")
    ap.add_argument("--out-dir", default=str(HERE / "dist"))
    ap.add_argument("--pages", action="store_true", help="write a site for GitHub Pages into --out-dir (index.html marked noindex, the catalogue as its own file, version.json) instead of the two dist files")
    a = ap.parse_args()
    art_gz = Path(a.art).read_bytes() if a.art else None
    if a.dataset:
        gz = Path(a.dataset).read_bytes()
    elif a.db:
        built = bd.build(a.db, local=False, version_json=a.version_json, keep_art=True)
        art_gz = gzip.compress(bd.to_json_bytes(built.pop("_art")), 9, mtime=0)
        gz = gzip.compress(bd.to_json_bytes(built), 9, mtime=0)
    else:
        sys.exit("give --db or --dataset")
    b64 = base64.b64encode(gz).decode("ascii")
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    mb = lambda n: f"{n / 1e6:.2f} MB"
    if a.pages:
        ds = json.loads(gzip.decompress(gz))
        built_at = ds["meta"].pop("built_at", None)      # ships in the page instead, so the data file only changes when the data does
        gz = gzip.compress(ndjson(ds), 9, mtime=0)
        detail_gz = gzip.compress(ndjson(ds, detail=True), 9, mtime=0)
        meta = ds["meta"]
        name = "catalogue." + hashlib.sha256(gz).hexdigest()[:8] + ".bin"
        detail_name = "detail." + hashlib.sha256(detail_gz).hexdigest()[:8] + ".bin"
        hero = {"entries": ds["entries"]["n"], "links": ds["links"]["n"], "platforms": len(ds["dims"]["platforms"]),
                "sources": len(ds["dims"]["sources"]), "version": meta["version"]}
        for old in [*out.glob("catalogue.*.bin"), *out.glob("detail.*.bin"), *out.glob("art.*.bin"), *out.glob("db.*.bin")]:
            old.unlink()
        (out / name).write_bytes(gz)
        (out / detail_name).write_bytes(detail_gz)
        art_name = ""
        if art_gz:
            art_name = "art." + hashlib.sha256(art_gz).hexdigest()[:8] + ".bin"
            (out / art_name).write_bytes(art_gz)
        fonts = out / "fonts"
        fonts.mkdir(exist_ok=True)
        for f in sorted((HERE / "web" / "fonts").iterdir()):
            if f.suffix in (".woff2", ".txt"):
                (fonts / f.name).write_bytes(f.read_bytes())
        if a.site_url:
            (out / "og.png").write_bytes((HERE / "web" / "og" / "og.png").read_bytes())
        latest = None
        if a.pick:
            pk = json.loads(Path(a.pick).read_text())
            if pk.get("held"):
                L = pk["latest"]
                latest = {"version": L["version"], "generated_at": L["date"], "entries": L["entries"], "links": L["links"], "reason": pk["reason"],
                          "against": {"entries": pk["use"]["entries"], "links": pk["use"]["links"]}, "drop": pk.get("drop")}      # the numbers too, so the page can say it in either language
        sql_cfg, db_name = None, ""
        if a.live_db:
            from vendor_sqljs import fetch as fetch_sqljs
            blob = Path(a.live_db).read_bytes()
            db_name = "db." + hashlib.sha256(blob).hexdigest()[:8] + ".bin"
            for old in out.glob("db.*.bin"):
                old.unlink()
            (out / db_name).write_bytes(blob)
            (out / "sql-worker.js").write_bytes((HERE / "web" / "worker" / "sql-worker.js").read_bytes())
            fetch_sqljs(str(out / "vendor" / "sqljs"))
            sql_cfg = {"db": db_name, "gz": len(blob), "bytes": int.from_bytes(blob[-4:], "little"), "worker": "sql-worker.js", "sqljs": "vendor/sqljs/"}
        for old in out.glob("lang-*.js"):
            old.unlink()
        es = (HERE / "web" / "lang" / "es.js").read_bytes()
        lang_name = "lang-es." + hashlib.sha256(es).hexdigest()[:8] + ".js"        # Spanish is its own file: only the people who read it download it
        (out / lang_name).write_bytes(es)
        icons.write(out / "icons")
        (out / "manifest.webmanifest").write_text(json.dumps(pwa.manifest("Every release and every link in the romgi ROM catalogue, sliceable and pivotable."), indent=1) + "\n", encoding="utf-8")
        page = compose("snapshot", "", standalone=True, pages=True, data_url=name, hero=hero, art_url=art_name, site_url=a.site_url, sql=sql_cfg, data_bytes=len(gz),
                       detail_url=detail_name, detail_bytes=len(detail_gz), built_at=built_at or "", latest=latest, lang_urls={"es": lang_name})
        (out / "index.html").write_text(page, encoding="utf-8")
        # the service worker keeps the page and the catalogue in the visitor's browser; its id changes with any of them
        worker, saved = pwa.service_worker(out, name, detail_name, art_name, lang_name, {"data": name, "detail": detail_name, "version": meta["version"],
                                                                         "generated_at": meta.get("generated_at"), "built_at": built_at}, stamp=built_at or "")
        (out / "sw.js").write_text(worker, encoding="utf-8")
        # what a visitor's browser compares with romgi's live version.json to say whether this build is current
        (out / "version.json").write_text(json.dumps({
            "built_at": built_at, "data": name, "detail": detail_name, "art": art_name or None, "db": db_name or None,
            "romgi": {"version": meta["version"], "generated_at": meta.get("generated_at"), "entries": hero["entries"], "links": hero["links"]},
            **({"latest": latest} if latest else {}),
        }, indent=1) + "\n", encoding="utf-8")
        print(f"catalogue  {mb(len(gz))}  {out}/{name}   (the page starts when this has arrived)")
        print(f"detail     {mb(len(detail_gz))}  {out}/{detail_name}   (titles, serials, slugs, exact sizes; follows in the background)")
        if art_name:
            print(f"box art    {mb(len(art_gz))}  {out}/{art_name}   (loaded after the page starts)")
        if db_name:
            print(f"sql copy   {mb(len(blob))}  {out}/{db_name}   (downloaded only when someone runs a query)")
        print(f"pages      {mb(len(page.encode()))}  {out}/index.html   (noindex)")
        print(f"offline    {len(saved['required']) + len(saved['optional'])} files saved by {out}/sw.js when the app installs (the database is not one of them)")
        return
    art = compose("snapshot", b64, standalone=False)
    std = compose("snapshot", b64, standalone=True)
    (out / "romgi-explorer.artifact.html").write_text(art, encoding="utf-8")
    (out / "romgi-explorer.standalone.html").write_text(std, encoding="utf-8")
    print(f"dataset {mb(len(gz))} gzip -> {mb(len(b64))} base64")
    print(f"artifact   {mb(len(art.encode()))}  dist/romgi-explorer.artifact.html   (limit 16 MB)")
    print(f"standalone {mb(len(std.encode()))}  dist/romgi-explorer.standalone.html")


if __name__ == "__main__":
    main()
