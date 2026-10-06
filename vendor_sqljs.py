#!/usr/bin/env python3
"""
vendor_sqljs.py - fetch SQLite for the browser (sql.js, MIT) into a folder the hosted site serves itself.

  python3 vendor_sqljs.py site/vendor/sqljs

The npm tarball is checked against the integrity hash pinned below before anything is unpacked, so a changed or tampered
release stops the build instead of reaching the site. To move to a newer release, run
  npm view sql.js version dist.integrity
and update VERSION and INTEGRITY after reading its changelog.
"""
from __future__ import annotations

import base64
import hashlib
import io
import sys
import tarfile
import urllib.request
from pathlib import Path

VERSION = "1.14.2"
INTEGRITY = "sha512-3ZGPovObMFrdw79zrUHbfdE/DLIsy8jdNdssmMSQuRAymedU6q84asPt0kgiqrdMYlPegDItiIMfmIXzZnYFcw=="
WANT = {"package/dist/sql-wasm.js": "sql-wasm.js", "package/dist/sql-wasm.wasm": "sql-wasm.wasm", "package/LICENSE": "LICENSE"}


def fetch(dest: str) -> list[str]:
    url = f"https://registry.npmjs.org/sql.js/-/sql.js-{VERSION}.tgz"
    req = urllib.request.Request(url, headers={"User-Agent": "romgi-explorer"})
    with urllib.request.urlopen(req, timeout=120) as r:
        blob = r.read()
    got = "sha512-" + base64.b64encode(hashlib.sha512(blob).digest()).decode()
    if got != INTEGRITY:
        sys.exit(f"sql.js {VERSION}: integrity mismatch\n  pinned {INTEGRITY}\n  got    {got}")
    out = Path(dest)
    out.mkdir(parents=True, exist_ok=True)
    names = []
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        for member in tar.getmembers():
            if member.name in WANT:
                (out / WANT[member.name]).write_bytes(tar.extractfile(member).read())
                names.append(WANT[member.name])
    if len(names) != len(WANT):
        sys.exit(f"sql.js {VERSION}: expected {sorted(WANT.values())}, found {sorted(names)}")
    return names


if __name__ == "__main__":
    dest = sys.argv[1] if len(sys.argv) > 1 else "site/vendor/sqljs"
    print(f"sql.js {VERSION} verified; wrote {', '.join(fetch(dest))} to {dest}")
