#!/usr/bin/env python3
"""
The reference data (reference.py): parsing, the join, and what the overlay says.

  python3 tests/test_reference.py data/reference dist/dataset.snapshot.json.gz dist/art.snapshot.json.gz

Parsing is checked on small DAT texts in both forms libretro uses. The real files are then read for every genre word they use (a word
the table does not know would be left out of every genre filter, so it must be added to the table by hand when libretro's commit is
moved), the overlay is built and checked for shape and range, and the two ways of joining are held against each other: where an entry's
box-art name and its serial both find a record, developer and genre must agree for at least 99% of them. A sample of entries is then
looked up again in the raw text by a different route.
"""
from __future__ import annotations

import collections
import gzip
import json
import re
import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import reference as R  # noqa: E402

fails = []


def check(name, cond, detail=""):
    print(f"{'ok  ' if cond else 'FAIL'} {name}" + ("" if cond else f"   {detail}"))
    if not cond:
        fails.append(name)


# ---- parsing, on small texts
cart = '''clrmamepro (
\tname "Nintendo - Super Nintendo Entertainment System"
)

game (
\tcomment "3 Ninjas Kick Back (USA)"
\tgenre "Platform"
\trom ( crc F2EE11F9 )
)

game (
\tcomment "Say \\"Hi\\": a Game (Japan)"
\treleaseyear "1996"
\trom ( crc 05FBB855 )
)
'''
psx = '''clrmamepro (
\tname "Sony - PlayStation"
)

game (
\tname "007 - The World Is Not Enough (USA)"
\tserial "SLUS-01272"
\tdescription "Good afternoon, James."
\tdeveloper "Black Ops Entertainment"
\tpublisher "Electronic Arts"
\treleaseyear "2000"
\treleasemonth "11"
\tusers "1"
\tgenre "Action / Adventure"
\trom (
\t\tserial "SLUS-01272"
\t)
)
'''
c = R.parse_dat(cart)
check("a cartridge record is read by its comment", c[0] == ("3 Ninjas Kick Back (USA)", {"genre": "Platform"}), c)
check("an escaped quote in a name is read back", c[1][0] == 'Say "Hi": a Game (Japan)' and c[1][1] == {"releaseyear": "1996"}, c)
p = R.parse_dat(psx)
check("a PlayStation record is read by its name, with its serial and fields", p[0][0] == "007 - The World Is Not Enough (USA)" and p[0][1]["serial"] == "SLUS-01272"
      and p[0][1]["developer"] == "Black Ops Entertainment" and p[0][1]["users"] == "1", p)
check("a synopsis is not copied", "description" not in p[0][1], p)
check("a thumbnail's file name has the characters libretro replaces", R.sanitize("Rock 'n Roll Racing: A/B?") == "Rock 'n Roll Racing_ A_B_", R.sanitize("Rock 'n Roll Racing: A/B?"))
check("a serial is compared without punctuation or case", R.norm_serial("slus-012.72") == R.norm_serial("SLUS_01272") == "SLUS01272")
art = ["", "Nintendo%20-%20Super%20Nintendo%20Entertainment%20System/Named_Boxarts/3%20Ninjas%20Kick%20Back%20(USA).png", "GameTDB/x.jpg"]
check("an entry's system and name come from its libretro path", R.entry_names(art) == [None, ("Nintendo - Super Nintendo Entertainment System", "3 Ninjas Kick Back (USA)"), None], R.entry_names(art))
check("only libretro systems are listed", R.systems_of(art) == ["Nintendo - Super Nintendo Entertainment System"])
um = collections.Counter()
b = R.genre_bits("Fighting / Beat'em Up", um)
check("a genre text with two genres sets two bits", b == (1 << R.GENRES.index("Fighting")) | (1 << R.GENRES.index("Beat 'em up")), b)
check("N/A is Other, not two unknown words", R.genre_bits("N/A", um) == 1 << R.GENRES.index("Other") and not um, um)
check("Other is dropped when a real genre is there", R.genre_bits("Data / Puzzle", um) == 1 << R.GENRES.index("Puzzle") and not um, um)
R.genre_bits("Underwater Basket Weaving", um)
check("a word the table does not know is counted, not guessed", um == {"Underwater Basket Weaving": 1}, um)
check("there are at most 31 genres, so a mask fits a 32-bit column", len(R.GENRES) <= 31 and len(set(R.GENRES)) == len(R.GENRES))
check("every genre in the table is reachable", set(R.GENRE_OF.values()) == set(R.GENRES))

if len(sys.argv) < 4:
    print("\nparsing only (no data given)")
    sys.exit(1 if fails else 0)

# ---- the real files
ref, dataset, art_path = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
art_list = R.read_art(art_path)
ds = json.loads(gzip.decompress(Path(dataset).read_bytes()))
E = ds["entries"]
plat = [ds["dims"]["platforms"][x]["id"] for x in E["platform"]]
systems = R.systems_of(art_list)
words = collections.Counter()
for f in R.FIELDS:
    for s in systems:
        path = ref / f / f"{s}.dat"
        if path.exists() and path.stat().st_size:
            for _, fields in R.parse_dat(path.read_text(encoding="utf-8", errors="replace")):
                if "genre" in fields:
                    R.genre_bits(fields["genre"], um := collections.Counter())
                    words.update(um)
check("every genre word in the files libretro is read from is in the table", not words, dict(words))

meta = R.build(art_list, plat, E["rom"], ref)
n = len(art_list)
cols, dims = meta["cols"], meta["dims"]
check("every column has one value per entry", all(len(v) == n for v in cols.values()) and meta["n"] == n, {k: len(v) for k, v in cols.items()})
check("genre bits stay inside the table", max(cols["genre"]) < (1 << len(R.GENRES)))
check("years are real or unknown", all(y == 0 or 1950 <= y <= 2100 for y in cols["year"]), max(cols["year"]))
check("months are 0 to 12", all(0 <= m <= 12 for m in cols["month"]))
check("developers and publishers point inside their lists", max(cols["dev"]) <= len(dims["dev"]) and max(cols["pub"]) <= len(dims["pub"]))
check("players are 0 to 16", all(0 <= x <= 16 for x in cols["players"]))
check("a month never comes without a year", not any(m and not y for m, y in zip(cols["month"], cols["year"])))
covered = meta["stats"]["covered"]
check(f"coverage has not collapsed ({covered:,} entries)", covered >= 30000, covered)
snes = next((k for k in meta["stats"]["by_system"] if k.startswith("Nintendo - Super Nintendo")), None)
if snes:
    seen, by_name, by_serial = meta["stats"]["by_system"][snes]
    check(f"most SNES entries join by name ({by_name:,} of {seen:,})", by_name / seen > 0.7, (seen, by_name))
ps1 = next((k for k in meta["stats"]["by_system"] if k == "Sony - PlayStation"), None)
if ps1:
    seen, by_name, by_serial = meta["stats"]["by_system"][ps1]
    check(f"most PlayStation entries join, by serial or by name ({by_serial:,} + {by_name:,} of {seen:,})", (by_serial + by_name) / seen > 0.6, (seen, by_name, by_serial))

# ---- the two joins against each other
names = R.entry_names(art_list)
sysname = {p: max(c, key=c.get) for p, c in ((p, collections.Counter(k[0] for k, q in zip(names, plat) if k and q == p)) for p in set(plat)) if c}
loaded = {s: R.load_system(ref, s) for s in set(sysname.values())}
agree, total = collections.Counter(), collections.Counter()
for i in range(n):
    s = sysname.get(plat[i])
    if not s or not names[i] or not E["rom"][i] or names[i][0] != s:
        continue
    by_name, by_serial = loaded[s]
    a, b2 = by_name.get(names[i][1]), by_serial.get(R.norm_serial(E["rom"][i]))
    if not a or not b2:
        continue
    for k in ("developer", "genre"):
        if k in a and k in b2:
            total[k] += 1
            agree[k] += a[k] == b2[k]
for k in ("developer", "genre"):
    check(f"where the box-art name and the serial both find a record they agree on the {k} ({agree[k]:,} of {total[k]:,})", total[k] > 500 and agree[k] / total[k] >= 0.99, (agree[k], total[k]))

# ---- a sample looked up again in the raw text, by a different route
sample = [i for i in range(0, n, 397) if cols["year"][i] and names[i] and not E["rom"][i]]
mismatch, looked = [], 0
for i in sample:
    s, name = names[i]
    path = ref / "releaseyear" / f"{s}.dat"
    if not path.exists() or not path.stat().st_size:
        continue
    text = path.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r'comment "((?:[^"\\]|\\.)*)"\s*releaseyear "(\d+)"', text):
        if R.sanitize(m.group(1)) == name:
            looked += 1
            if int(m.group(2)) != cols["year"][i]:
                mismatch.append((name, m.group(2), cols["year"][i]))
            break
check(f"a sample of {looked} years read straight from the raw text matches the overlay", looked >= 20 and not mismatch, mismatch[:5])

print("\nALL PASS" if not fails else f"\n{len(fails)} FAILED: {fails}")
sys.exit(1 if fails else 0)
