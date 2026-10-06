#!/usr/bin/env python3
"""
bundle.py - build the self-contained version of the explorer (the dataset is embedded; no server needed).

  python3 bundle.py --db romdb.db --version-json version.json        # rebuilds the dataset
  python3 bundle.py --dataset dist/dataset.snapshot.json.gz          # reuse a dataset you already built
  python3 bundle.py --dataset dist/dataset.snapshot.json.gz --pages --out-dir site    # GitHub Pages: site/index.html

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
import sys
from pathlib import Path

import build_dataset as bd
from compose import compose

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db")
    ap.add_argument("--version-json")
    ap.add_argument("--dataset", help="gzip'd dataset JSON built by build_dataset.py (without --local)")
    ap.add_argument("--out-dir", default=str(HERE / "dist"))
    ap.add_argument("--pages", action="store_true", help="write one index.html (marked noindex) into --out-dir, for GitHub Pages, instead of the two dist files")
    a = ap.parse_args()
    if a.dataset:
        gz = Path(a.dataset).read_bytes()
    elif a.db:
        gz = gzip.compress(bd.to_json_bytes(bd.build(a.db, local=False, version_json=a.version_json)), 9)
    else:
        sys.exit("give --db or --dataset")
    b64 = base64.b64encode(gz).decode("ascii")
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    mb = lambda n: f"{n / 1e6:.2f} MB"
    if a.pages:
        page = compose("snapshot", b64, standalone=True, pages=True)
        (out / "index.html").write_text(page, encoding="utf-8")
        print(f"dataset {mb(len(gz))} gzip -> {mb(len(b64))} base64")
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
