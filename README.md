# romgi catalogue explorer

A browser UI for the database behind [caprado/romgi](https://github.com/caprado/romgi) (`db/romdb.db.gz`): every entry, every link,
and the metadata around them, sliceable and pivotable.

Two ways to run it:

| | Local explorer | Hosted snapshot |
|---|---|---|
| Data | your `romdb.db`, live | the 2026-10-04 snapshot, embedded in one HTML file |
| SQL console, file names, URLs, torrent paths, box art, CSV download | yes | no |
| Needs | Python 3.9+ (standard library only) | a browser |

## Run it locally

```bash
./run.sh
```

The first run downloads the published catalogue into `data/` (55 MB, 345 MB unpacked), builds a dataset from it (about 30 seconds,
cached in `dist/.cache/`) and opens http://127.0.0.1:8765. Later runs start at once. `./run.sh --refresh` fetches the latest
weekly catalogue; `ROMGI_OPEN=0 ./run.sh` skips opening a browser window.

To point it at a database you already have: `python3 serve.py --db path/to/romdb.db --version-json path/to/version.json --open`.
It listens on `127.0.0.1` only and opens the database read-only.

## What is in it

- **Overview** treemap of platforms, source mix, regions, size classes, release flags, link types, formats, coverage.
- **Dice** pivot any two dimensions (platform by source, brand by region, flags by brand, ...), as raw values, shares, or versus expected.
- **Browse** virtual table over 241k entries or 400k links, a gallery, and a catalogue-card drawer for every entry.
- **Sources** health, which combinations of sources offer each entry, torrent packs, and the catalogue size over 42 weekly snapshots.
- **Schema** ER diagram, DDL, a profile of every column, and where the bytes go.
- **Quality** 16 checks, each backed by a query. Findings in the 2026-10-04 snapshot include 6,638 titles with scrambled
  characters, 4,673 Internet Archive sizes no real copy could have (a Mega Drive game of 20 GiB, a Saturn disc of 28 GiB), two weeks where the published catalogue lost about 40% of its entries,
  and a torrent table with no sizes or files.
- **SQL** (local only) a read-only console with examples and a schema browser.

Everything on the left narrows entries and links together. The count beside each value is what you would get by adding it.
Alt-click excludes a value. The "SQL" button above the tabs prints the query that reproduces the current slice.

Shortcuts: `/` search, `R` roll a random entry, `G` then `O D B S M Q L` to jump between views, `T` theme, `?` help.

## Files

```
run.sh              one-command launcher: download the catalogue, build, serve
serve.py            local server: dataset, per-entry rows, guarded SQL endpoint
build_dataset.py    romdb.db -> compact columnar dataset (+ schema, profiles, quality checks)
bundle.py           builds the self-contained hosted version into dist/
compose.py          assembles the page from web/
web/                index.html, css/, js/ (util, data, engine, charts, views)
data/history.json   weekly snapshot sizes, extracted from the romgi git history
tests/              dataset-vs-SQL parity and a random-slice property test of the engine
```

## Tests

```bash
python3 build_dataset.py --db data/romdb.db --out dist/dataset.snapshot.json.gz
python3 tests/test_dataset.py data/romdb.db dist/dataset.snapshot.json.gz
node tests/engine.test.js data/romdb.db dist/dataset.snapshot.json.gz 40
```

The first checks every flag, size class, region, source, pack and format count against SQL. The second draws random slices,
filters and cross-tabs through the browser engine and compares each result with the SQL the UI prints.

## Notes

The catalogue is distributed by romgi for use in romgi; its README says forks and derivative tools are not supported. This
explorer reads a copy you download yourself and ships none of the catalogue's links in the hosted file.
