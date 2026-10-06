#!/usr/bin/env python3
"""
bundle.py - build the self-contained version of the explorer (the dataset is embedded; no server needed).

  python3 bundle.py --db romdb.db --version-json version.json        # rebuilds the dataset
  python3 bundle.py --dataset dist/dataset.snapshot.json.gz          # reuse a dataset you already built
  python3 bundle.py --dataset dist/dataset.snapshot.json.gz --pages --out-dir site    # GitHub Pages: a small index.html
                                                                                       # plus catalogue.<hash>.bin and version.json

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
from compose import compose

HERE = Path(__file__).resolve().parent


CHUNK = 40_000          # a column longer than this is split into lines of this many values


def ndjson(ds: dict) -> bytes:
    """One JSON document per line: [section, key|null, value] or, for a long column, [section, key, values, offset].
    The browser parses each line in its own short task while the rest is still downloading, instead of one long
    JSON.parse after the last byte."""
    dump = lambda v: json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    lines = []
    for k, v in ds.items():
        if k in ("entries", "links") and isinstance(v, dict):
            for kk, vv in v.items():
                if isinstance(vv, list) and len(vv) > CHUNK:
                    lines += [dump([k, kk, vv[o:o + CHUNK], o]) for o in range(0, len(vv), CHUNK)]
                else:
                    lines.append(dump([k, kk, vv]))
        else:
            lines.append(dump([k, None, v]))
    return ("\n".join(lines) + "\n").encode("utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db")
    ap.add_argument("--version-json")
    ap.add_argument("--dataset", help="gzip'd dataset JSON built by build_dataset.py (without --local)")
    ap.add_argument("--site-url", default="", help="with --pages: the public address of the site (ending in /), for link-preview tags and the social card")
    ap.add_argument("--live-db", help="with --pages: gzip'd link-free copy of the database from livedb.py; the site gets a SQL console that runs in the browser")
    ap.add_argument("--art", help="gzip'd box-art paths from build_dataset.py --art-out; with --pages they become a file the site loads after start")
    ap.add_argument("--out-dir", default=str(HERE / "dist"))
    ap.add_argument("--pages", action="store_true", help="write a site for GitHub Pages into --out-dir (index.html marked noindex, the catalogue as its own file, version.json) instead of the two dist files")
    a = ap.parse_args()
    art_gz = Path(a.art).read_bytes() if a.art else None
    if a.dataset:
        gz = Path(a.dataset).read_bytes()
    elif a.db:
        built = bd.build(a.db, local=False, version_json=a.version_json, keep_art=True)
        art_gz = gzip.compress(bd.to_json_bytes(built.pop("_art")), 9)
        gz = gzip.compress(bd.to_json_bytes(built), 9)
    else:
        sys.exit("give --db or --dataset")
    b64 = base64.b64encode(gz).decode("ascii")
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    mb = lambda n: f"{n / 1e6:.2f} MB"
    if a.pages:
        ds = json.loads(gzip.decompress(gz))
        gz = gzip.compress(ndjson(ds), 9)
        meta, name = ds["meta"], "catalogue." + hashlib.sha256(gz).hexdigest()[:8] + ".bin"
        hero = {"entries": ds["entries"]["n"], "links": ds["links"]["n"], "platforms": len(ds["dims"]["platforms"]),
                "sources": len(ds["dims"]["sources"]), "version": meta["version"]}
        for old in [*out.glob("catalogue.*.bin"), *out.glob("art.*.bin"), *out.glob("db.*.bin")]:
            old.unlink()
        (out / name).write_bytes(gz)
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
        page = compose("snapshot", "", standalone=True, pages=True, data_url=name, hero=hero, art_url=art_name, site_url=a.site_url, sql=sql_cfg, data_bytes=len(gz))
        (out / "index.html").write_text(page, encoding="utf-8")
        # what a visitor's browser compares with romgi's live version.json to say whether this build is current
        (out / "version.json").write_text(json.dumps({
            "built_at": meta.get("built_at"), "data": name, "art": art_name or None, "db": db_name or None,
            "romgi": {"version": meta["version"], "generated_at": meta.get("generated_at"), "entries": hero["entries"], "links": hero["links"]},
        }, indent=1) + "\n", encoding="utf-8")
        print(f"catalogue  {mb(len(gz))}  {out}/{name}")
        if art_name:
            print(f"box art    {mb(len(art_gz))}  {out}/{art_name}   (loaded after the page starts)")
        if db_name:
            print(f"sql copy   {mb(len(blob))}  {out}/{db_name}   (downloaded only when someone runs a query)")
        print(f"pages      {mb(len(page.encode()))}  {out}/index.html   (noindex)")
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
