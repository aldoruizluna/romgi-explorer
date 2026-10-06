# romgi catalogue explorer

**Live: https://aldoruizluna.github.io/romgi-explorer/**

A browser UI for the database behind [caprado/romgi](https://github.com/caprado/romgi) (`db/romdb.db.gz`): every entry, every link,
and the metadata around them, sliceable and pivotable.

Two ways to use it:

| | Local explorer | Hosted snapshot (the live site) |
|---|---|---|
| Data | your `romdb.db`, live | the latest weekly catalogue, rebuilt every Monday |
| Box art | yes | yes, loaded from libretro and GameTDB while you look |
| SQL console, file names, URLs, torrent paths, CSV of a whole slice | yes | no |
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

- **Overview** starts with eight hand-picked collections (mirrored everywhere, achievement hunters, cartridge classics, prototypes and
  betas, and more; each sets the filters for you) and a daily shelf of six covers, then the treemap of platforms, source mix, regions,
  size classes, release flags, link types, formats and coverage.
- **Dice** pivot any two dimensions (platform by source, brand by region, flags by brand, ...), as raw values, shares, or versus expected.
- **Browse** virtual table over 241k entries or 400k links, a box-art gallery (most achievements first, or A to Z, most sources, largest),
  and a catalogue-card drawer for every entry.
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
bundle.py           builds the self-contained hosted version into dist/ (or one index.html with --pages)
compose.py          assembles the page from web/
refresh_history.py  adds the weekly snapshots published since data/history.json was written
web/                index.html, css/, js/ (util, data, engine, charts, views, collections), fonts/ (self-hosted, OFL)
data/history.json   weekly snapshot sizes, extracted from the romgi git history
tests/              dataset-vs-SQL parity, a random-slice property test of the engine, and the hosted file's transport
.github/workflows/  pages.yml: the build that publishes the live site
```

## The live site

[`pages.yml`](.github/workflows/pages.yml) publishes it to GitHub Pages on every push to `main` and every Monday morning (UTC), shortly
after romgi's Sunday catalogue. Each run downloads the published catalogue, adds any new snapshots to the history chart, builds the
dataset, checks it against SQL (`tests/test_dataset.py`, and a short run of `tests/engine.test.js`), and deploys a small `index.html`
(the loader paints at once with the headline numbers), the catalogue as its own gzip file that streams in with a progress bar, and the
box-art paths as a second file loaded after the page is usable. A run that fails any step leaves the previous site up. The catalogue
itself is never committed; it is fetched fresh each time. Fonts are served from the site, so the only third-party requests are the
cover images, and only for covers that are on screen.

The page carries `noindex`, so search engines are asked to skip it, but anyone with the link can open it. GitHub disables scheduled
workflows in a public repository after 60 days without repository activity; re-enable it from the Actions tab. A run can also be
started by hand from the Actions tab. To build the same page yourself:

```bash
python3 build_dataset.py --db data/romdb.db --version-json data/version.json --out dist/dataset.snapshot.json.gz --art-out dist/art.snapshot.json.gz
python3 bundle.py --dataset dist/dataset.snapshot.json.gz --art dist/art.snapshot.json.gz --pages --out-dir site
python3 -m http.server --directory site 8790                                          # then open http://localhost:8790
```

## Tests

```bash
python3 build_dataset.py --db data/romdb.db --out dist/dataset.snapshot.json.gz
python3 tests/test_dataset.py data/romdb.db dist/dataset.snapshot.json.gz
node tests/engine.test.js data/romdb.db dist/dataset.snapshot.json.gz 40
node tests/transport.test.js site/catalogue.*.bin dist/dataset.snapshot.json.gz       # after bundle.py --pages
```

The first checks every flag, size class, region, source, pack and format count against SQL, and that the table is stored in the order
the printed SQL sorts by. The second draws random slices, filters and cross-tabs through the browser engine and compares each result with
the SQL the UI prints, then does the same for every hand-picked collection. The third unpacks the hosted catalogue file the way the page
does and checks it equals the dataset it was made from.

## License

The explorer's code is [MIT](LICENSE). The catalogue it reads belongs to romgi and the sources it indexes; the license covers this
repository's code only.

## Notes

The catalogue is distributed by romgi for use in romgi; its README says forks and derivative tools are not supported. The local
explorer reads a copy you download yourself. The live site carries the catalogue's titles, platforms, sizes, source names and the
paths of box-art images, and leaves out download URLs, file names, per-file torrent paths, magnets and infohashes; torrent packs appear
by name only. Box art is fetched by your browser from thumbnails.libretro.com and art.gametdb.com; GameTDB is sometimes slow or
unreachable, in which case the card keeps its platform placeholder.
