#!/usr/bin/env python3
"""
refresh_history.py - append the weekly snapshots romgi has published since data/history.json was last written.

  python3 refresh_history.py                    # reads caprado/romgi's commit history over the GitHub API
  GITHUB_TOKEN=... python3 refresh_history.py   # a token lifts the anonymous rate limit (the Pages workflow passes its own)

Every row is the db/version.json of one "Update database" commit, in the shape build_dataset.py reads for the Sources
history and the quality checks. If GitHub cannot be reached the file is left as it was.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def fetch(url: str, token: str | None):
    req = urllib.request.Request(url, headers={"User-Agent": "romgi-explorer", "Accept": "application/vnd.github+json"})
    if token and url.startswith("https://api.github.com/"):
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def row(commit: str, when: str, v: dict) -> dict:
    return {"commit": commit, "date": v.get("generated_at") or when, "version": v["version"],
            "entries": v.get("entries"), "links": v.get("links"), "platforms": v.get("platforms"),
            "sources": v.get("sources"), "ra": v.get("retroachievements"),
            "size": v.get("size"), "uncompressed": v.get("uncompressed_size"), "schema": v.get("schema_version")}


def fresh_rows(history: list, repo: str, token: str | None) -> list:
    since = max((h["date"] for h in history), default="2000-01-01T00:00:00Z")
    query = urllib.parse.urlencode({"path": "db/version.json", "since": since, "per_page": 100})
    commits = fetch(f"https://api.github.com/repos/{repo}/commits?{query}", token)
    if len(commits) == 100:
        print("history: 100 commits since the last snapshot; older ones may be missing", file=sys.stderr)
    seen = {(h["version"], h["entries"], h["links"]) for h in history}
    rows = []
    for c in reversed(commits):                      # the API lists newest first
        subject = c["commit"]["message"].splitlines()[0]
        if not re.search(r"Update database \d{8}", subject):
            continue                                 # housekeeping commits do not carry a snapshot
        try:
            v = fetch(f"https://raw.githubusercontent.com/{repo}/{c['sha']}/db/version.json", token)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            raise
        key = (v["version"], v.get("entries"), v.get("links"))
        if key in seen:
            continue
        seen.add(key)
        rows.append(row(c["sha"][:8], c["commit"]["author"]["date"], v))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--history", default=str(HERE / "data" / "history.json"))
    ap.add_argument("--repo", default="caprado/romgi")
    a = ap.parse_args()
    path = Path(a.history)
    history = json.loads(path.read_text())
    try:
        new = fresh_rows(history, a.repo, os.environ.get("GITHUB_TOKEN"))
    except (OSError, ValueError, KeyError) as e:     # offline, rate limited, or GitHub changed shape: keep what we have
        print(f"history: not refreshed ({e}); keeping {len(history)} snapshots", file=sys.stderr)
        return 0
    if new:
        path.write_text(json.dumps(history + new, indent=1))
    span = f" ({new[0]['version']} to {new[-1]['version']})" if new else ""
    print(f"history: {len(history)} snapshots + {len(new)} new{span}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
