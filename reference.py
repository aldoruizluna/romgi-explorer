#!/usr/bin/env python3
"""
reference.py - say more about the games already in the catalogue, from a dataset made for that.

Genre, release year and month, developer, publisher and the number of players come from libretro-database's metadat folder
(https://github.com/libretro/libretro-database, CC BY-SA 4.0, pinned to one commit below). Each of its files lists a system's games by
the No-Intro name, which is also the name in the box-art path the catalogue already stores for most entries from libretro, so an entry
joins by that name and by nothing less exact: an entry without such a path gets no reference data rather than a guess.

  python3 reference.py fetch --art dist/art.snapshot.json.gz --out data/reference
  python3 reference.py build --dataset dist/dataset.snapshot.json.gz --art dist/art.snapshot.json.gz --ref data/reference --out dist/meta.snapshot.json.gz

The result is its own file, loaded after the catalogue, so it can be dropped without touching anything else. It carries its source and
the commit it was made from. The files are fetched from raw.githubusercontent.com; a file a system does not have (404) is remembered as
empty, and a run that fails to fetch more than a few files stops instead of building from half the data.
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures
import gzip
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LIBRETRO_COMMIT = "fbeefcb46c2e1b20a7e2945f34a694a41b2d6f90"          # 2026-10-05; move it deliberately, after looking at what changed
RAW = "https://raw.githubusercontent.com/libretro/libretro-database/%s/metadat/%s/%s.dat"
SOURCE = {"name": "libretro-database", "url": "https://github.com/libretro/libretro-database", "license": "CC BY-SA 4.0",
          "license_url": "https://creativecommons.org/licenses/by-sa/4.0/", "commit": LIBRETRO_COMMIT}
FIELDS = ("genre", "developer", "publisher", "releaseyear", "releasemonth", "maxusers")      # the metadat folders used
BOXART = "/Named_Boxarts/"


def unq(s: str) -> str:
    return urllib.parse.unquote(s)


def sanitize(name: str) -> str:
    """The name as libretro writes it into a thumbnail's file name: the characters a file system dislikes become underscores."""
    return re.sub(r"[&*/:`<>?\\|]", "_", name)


def systems_of(art: list[str]) -> list[str]:
    """The libretro systems whose box art the catalogue links to, as libretro names them (and as its metadat files are named)."""
    return sorted({unq(p).split("/")[0] for p in art if p and BOXART in unq(p)})


def entry_names(art: list[str]) -> list[tuple[str, str] | None]:
    """For each entry, (system, name) from its libretro box-art path, or None. The name is what the file is called without its extension."""
    out = []
    for p in art:
        u = unq(p) if p else ""
        if BOXART not in u:
            out.append(None)
            continue
        system, rest = u.split(BOXART, 1)
        out.append((system, re.sub(r"\.png$", "", rest)))
    return out


# ------------------------------------------------------------------------------------------------------------------------ fetching
def get(url: str, tries: int = 4) -> bytes | None:
    """The body, or None for a 404 (this system has no such file). Anything else that goes wrong is retried, then raised."""
    req = urllib.request.Request(url, headers={"User-Agent": "romgi-explorer (reference data build)"})
    for k in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err: Exception = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            err = e
        time.sleep(1.5 * (k + 1))
    raise err


def fetch(systems: list[str], out: Path, workers: int = 8, log=print) -> dict:
    """Download every field's file for every system into out/<field>/<system>.dat (an empty file when the system has none). Returns counts."""
    jobs = [(f, s) for f in FIELDS for s in systems if not (out / f / f"{s}.dat").exists()]
    stats = collections.Counter(have=len(FIELDS) * len(systems) - len(jobs))
    failed = []

    def one(job):
        f, s = job
        body = get(RAW % (LIBRETRO_COMMIT, f, urllib.parse.quote(s)))
        path = out / f / f"{s}.dat"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body or b"")
        return f, s, body is not None

    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        for fut in [pool.submit(one, j) for j in jobs]:
            try:
                stats["fetched" if fut.result()[2] else "absent"] += 1
            except Exception as e:                                                                                   # noqa: BLE001
                failed.append(str(e))
    if failed:
        stats["failed"] = len(failed)
        if len(failed) > max(3, len(jobs) // 50):
            sys.exit(f"reference data: {len(failed)} of {len(jobs)} files could not be fetched, for example: {failed[0]}")
        log(f"reference data: {len(failed)} files could not be fetched and are left out ({failed[0]})")
    return dict(stats)


# ------------------------------------------------------------------------------------------------------------------------ parsing
_GAME = re.compile(r"^game \(\n(.*?)^\)", re.S | re.M)
_NAME = re.compile(r'^\s*(?:comment|name) "((?:[^"\\]|\\.)*)"', re.M)
_FIELD = re.compile(r'^\s*(genre|developer|publisher|releaseyear|releasemonth|users|serial)\s+("(?:[^"\\]|\\.)*"|\S+)', re.M)


def parse_dat(text: str) -> list[tuple[str, dict[str, str]]]:
    """[(game name, {field: value})] from a clrmamepro-style DAT, the form libretro's metadata files take. A game is named by its comment
    (the cartridge systems' files, which hold one field each) or its name (the PlayStation files, which hold the serial and every field,
    and a synopsis that is left where it is: it is the compiler's text, not a fact)."""
    out = []
    for block in _GAME.findall(text):
        n = _NAME.search(block)
        if not n:
            continue
        fields = {}
        for k, v in _FIELD.findall(block):
            fields.setdefault(k, v[1:-1].replace('\\"', '"') if v.startswith('"') else v)
        if fields:
            out.append((n.group(1).replace('\\"', '"'), fields))
    return out


FIELD_OF = {"genre": "genre", "developer": "developer", "publisher": "publisher", "releaseyear": "releaseyear", "releasemonth": "releasemonth", "maxusers": "users"}


def norm_serial(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def load_system(ref: Path, system: str) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    """Everything libretro knows about one system: by the name as it appears in a thumbnail's file name, and by serial where the files have one."""
    by_name: dict[str, dict[str, str]] = {}
    by_serial: dict[str, dict[str, str]] = {}
    for f in FIELDS:
        path = ref / f / f"{system}.dat"
        if not path.exists() or not path.stat().st_size:
            continue
        for name, fields in parse_dat(path.read_text(encoding="utf-8", errors="replace")):
            take = {FIELD_OF[f]: fields[FIELD_OF[f]]} if FIELD_OF[f] in fields else {}
            if "serial" in fields:                                                  # a PlayStation-style record carries every field at once
                take = {k: v for k, v in fields.items() if k != "serial"}
                by_serial.setdefault(norm_serial(fields["serial"]), {}).update(take)
            by_name.setdefault(sanitize(name), {}).update(take)
    return by_name, by_serial


# ------------------------------------------------------------------------------------------------------------------------ building
# libretro's genre text ("Fighting / Beat'em Up", "Role-playing (RPG)") folded into a short fixed list; an entry has one bit per genre it names
GENRES = ["Action", "Adventure", "Platform", "Role-playing", "Strategy", "Simulation", "Racing", "Sports", "Fighting", "Beat 'em up", "Shooter",
          "Shoot 'em up", "Puzzle", "Board and card", "Gambling", "Quiz", "Music and rhythm", "Party and mini games", "Educational", "Pinball",
          "Hunting and fishing", "Survival horror", "Interactive fiction", "Compilation", "Other"]
_G = {
    "Action": ["action", "breakout", "arcade"], "Adventure": ["adventure"], "Platform": ["platform"],
    "Role-playing": ["role-playing (rpg)", "role-playing", "rpg"], "Strategy": ["strategy"], "Simulation": ["simulation", "flight simulator"],
    "Racing": ["racing"], "Sports": ["sports", "basketball", "football", "tennis", "boxing", "wrestling", "sports with animals"],
    "Fighting": ["fighting"], "Beat 'em up": ["beat'em up"], "Shooter": ["shooter", "gun", "lightgun shooter"], "Shoot 'em up": ["shoot'em up"],
    "Puzzle": ["puzzle", "tetris"], "Board and card": ["board", "card", "chess", "shogi", "go", "mahjong", "tarot"], "Gambling": ["gambling"],
    "Quiz": ["quiz", "thinking"], "Music and rhythm": ["music", "dancing", "sing", "rhythm"],
    "Party and mini games": ["mini games", "party", "casual game"], "Educational": ["educational"], "Pinball": ["pinball"],
    "Hunting and fishing": ["hunting and fishing"], "Survival horror": ["survival horror"],
    "Interactive fiction": ["interactive comic", "interactive movie", "visual novel", "sound novel", "dating"], "Compilation": ["compilation"],
    "Other": ["miscellaneous", "various", "demo", "n-a", "adult", "data", "pictures", "picture", "videos", "video", "utility", "browser", "email", "pda",
              "constructing", "building", "breeding", "colouring book", "colouring game", "cooking"],
}
GENRE_OF = {raw: name for name, raws in _G.items() for raw in raws}


def genre_bits(text: str, unmapped: collections.Counter | None = None) -> int:
    """One bit per genre a libretro genre text names (bit i for GENRES[i]). Words it does not know are counted in `unmapped`, not guessed."""
    bits = 0
    for token in re.split(r"\s*[/&]\s*", re.sub(r"(?i)\bn/a\b", "n-a", text.strip())):
        t = re.sub(r"\s+", " ", token.strip()).lower()
        if not t:
            continue
        name = GENRE_OF.get(t)
        if name is None:
            if unmapped is not None:
                unmapped[token.strip()] += 1
            continue
        bits |= 1 << GENRES.index(name)
    other = 1 << GENRES.index("Other")
    return bits & ~other if bits & ~other else bits


def year_ok(v: str) -> int:
    return int(v) if v.isdigit() and 1950 <= int(v) <= 2100 else 0


def build(art: list[str], platforms: list[str], roms: list[str], ref: Path) -> dict:
    """The overlay: for each entry (same order as the catalogue), genre, year, month, developer, publisher and players, 0 where unknown.
    The strings live once in dims; the columns hold positions in them (1 and up; 0 is unknown). An entry joins by the name in its libretro
    box-art path and, where the system's files carry serials (the PlayStation ones do), by its serial. Where both find a record, the serial's
    leads (it names the very disc: a budget re-release has the serial and the year of the re-release) and the name's fills in what it lacks.
    Nothing else is tried."""
    n = len(art)
    names = entry_names(art)
    votes: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for key, plat in zip(names, platforms):
        if key:
            votes[plat][key[0]] += 1
    system_of = {p: c.most_common(1)[0][0] for p, c in votes.items()}              # the libretro system that stands for a platform
    data = {s: load_system(ref, s) for s in sorted(set(system_of.values()) | {k[0] for k in names if k})}
    cols = {k: [0] * n for k in ("genre", "year", "month", "dev", "pub", "players")}
    dims: dict[str, list[str]] = {"genre": list(GENRES), "dev": [], "pub": []}
    pos: dict[str, dict[str, int]] = {k: {} for k in ("dev", "pub")}
    unmapped: collections.Counter = collections.Counter()

    def index(kind: str, value: str) -> int:
        value = value.strip()
        if not value:
            return 0
        d = pos[kind]
        if value not in d:
            dims[kind].append(value)
            d[value] = len(dims[kind])
        return d[value]

    seen: collections.Counter = collections.Counter()
    by: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for i in range(n):
        key = names[i]
        system = key[0] if key else system_of.get(platforms[i])
        if not system:
            continue
        seen[system] += 1
        by_name, by_serial = data[system]
        rec: dict[str, str] = {}
        if roms[i]:                                      # the serial names this very disc: where it has a record, that record leads
            other = by_serial.get(norm_serial(roms[i]))
            if other:
                rec.update(other)
                by[system]["serial"] += 1
        if key and key[1] in by_name:                    # the name fills in what the serial's record leaves out
            if not rec:
                by[system]["name"] += 1
            for k, v in by_name[key[1]].items():
                rec.setdefault(k, v)
        if not rec:
            continue
        cols["genre"][i] = genre_bits(rec.get("genre", ""), unmapped)
        cols["year"][i] = year_ok(rec.get("releaseyear", ""))
        m = rec.get("releasemonth", "")
        cols["month"][i] = int(m) if m.isdigit() and 1 <= int(m) <= 12 else 0
        cols["dev"][i] = index("dev", rec.get("developer", ""))
        cols["pub"][i] = index("pub", rec.get("publisher", ""))
        u = rec.get("users", "")
        cols["players"][i] = int(u) if u.isdigit() and 1 <= int(u) <= 16 else 0
    covered = sum(1 for i in range(n) if any(cols[k][i] for k in cols))
    return {"v": 1, "n": n, "source": SOURCE, "dims": dims, "cols": cols,
            "stats": {"entries": n, "considered": sum(seen.values()), "covered": covered, "unmapped_genres": dict(unmapped),
                      "by_system": {s: [seen[s], by[s]["name"], by[s]["serial"]] for s in sorted(seen)}}}


# ------------------------------------------------------------------------------------------------------------------------ the file
CHUNK = 40_000


def ndjson(meta: dict) -> bytes:
    """One JSON document per line, like the catalogue's files: the page parses each in its own short task."""
    dump = lambda v: json.dumps(v, separators=(",", ":"), ensure_ascii=False)
    lines = [dump(["n", None, meta["n"]]), dump(["source", None, meta["source"]]), dump(["dims", None, meta["dims"]]), dump(["stats", None, meta["stats"]])]
    for k, col in meta["cols"].items():
        if len(col) > CHUNK:
            lines += [dump(["cols", k, col[o:o + CHUNK], o]) for o in range(0, len(col), CHUNK)]
        else:
            lines.append(dump(["cols", k, col]))
    return ("\n".join(lines) + "\n").encode("utf-8")


def write(meta: dict, out_dir: Path) -> tuple[str, bytes]:
    """The gzip'd file, named by its content like the catalogue's, written into out_dir. Returns (name, bytes)."""
    gz = gzip.compress(ndjson(meta), 9, mtime=0)
    name = "meta." + hashlib.sha256(gz).hexdigest()[:8] + ".bin"
    for old in out_dir.glob("meta.*.bin"):
        old.unlink()
    (out_dir / name).write_bytes(gz)
    return name, gz


def read_art(path: str) -> list[str]:
    return json.loads(gzip.decompress(Path(path).read_bytes()))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--art", required=True)
    f.add_argument("--out", required=True)
    b = sub.add_parser("build")
    b.add_argument("--dataset", required=True, help="the dataset from build_dataset.py: platforms and serials, in the catalogue's order")
    b.add_argument("--art", required=True)
    b.add_argument("--ref", required=True)
    b.add_argument("--out", required=True, help="the overlay as gzip'd JSON (the form the build and the tests read)")
    a = ap.parse_args()
    art = read_art(a.art)
    if a.cmd == "fetch":
        systems = systems_of(art)
        print(f"{len(systems)} systems x {len(FIELDS)} fields from libretro-database {LIBRETRO_COMMIT[:8]}")
        print(fetch(systems, Path(a.out)))
        return 0
    ds = json.loads(gzip.decompress(Path(a.dataset).read_bytes()))
    plat = [ds["dims"]["platforms"][p]["id"] for p in ds["entries"]["platform"]]
    meta = build(art, plat, ds["entries"]["rom"], Path(a.ref))
    Path(a.out).write_bytes(gzip.compress(json.dumps(meta, separators=(",", ":"), ensure_ascii=False).encode("utf-8"), 9, mtime=0))
    s = meta["stats"]
    print(f"{s['covered']:,} of {s['entries']:,} entries have reference data ({s['considered']:,} are on a platform libretro has files for); "
          f"{len(meta['dims']['dev']):,} developers, {len(meta['dims']['pub']):,} publishers" + (f"; genre words not in the table: {s['unmapped_genres']}" if s["unmapped_genres"] else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
