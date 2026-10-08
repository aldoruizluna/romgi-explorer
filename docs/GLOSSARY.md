# Glossary

> **TL;DR.** The terms this project uses, one definition each, alphabetical, with a link to where they are explained. The catalogue is romgi's; the words "entry", "link", "title" and "source"
> mean specific things here.

Related: [INDEX](INDEX.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DEVELOPING](DEVELOPING.md) · [TESTING](TESTING.md) · [README](../README.md)

**Art snapshot.** The box-art paths (not the images), built as their own file and loaded after the titles; covers are fetched by the visitor's browser from `thumbnails.libretro.com` and `art.gametdb.com` as they scroll into view. See [ARCHITECTURE](ARCHITECTURE.md#the-hosted-site-and-its-guards).

**Catalogue.** romgi's published SQLite database, `db/romdb.db.gz`, rebuilt weekly. Third-party data: downloaded by `./run.sh`, never committed. See [README](../README.md).

**Catalogue file / detail file.** The two hosted data files: the catalogue's numbers (about 0.9 MB gzip, enough for counts, charts, filters and pivots) and the titles, serials, slugs and exact sizes (about 4.0 MB, which switches on search, the Browse table and size totals). See [ARCHITECTURE](ARCHITECTURE.md).

**Collection.** A hand-picked slice with a title and a preset of filters (`COLLECTIONS` in `web/js/48-collections.js`); one that matches nothing after a catalogue change is left out. See [DEVELOPING](DEVELOPING.md#add-a-hand-picked-collection).

**Dataset (columnar).** The compact form the browser slices in memory: every filtered or grouped dimension is a flat array with one value per catalogue row. Built by `build_dataset.py`; its format version is `BUILD_VERSION`. See [ARCHITECTURE](ARCHITECTURE.md).

**Dice.** The pivot view: any two dimensions against each other, as raw values, shares, or versus expected. See [README](../README.md#what-is-in-it).

**Drift (guard).** `drift.py`: stops the build when the catalogue's format is not one this explorer reads, and holds back a newest catalogue that is unfinished (romgi has twice published one about 40% short). New sources, tables and columns are reported, not refused. See [ARCHITECTURE](ARCHITECTURE.md#what-each-python-file-does).

**Entry.** One release in the catalogue (a row of `entries`). The default Browse grain groups editions into *titles*. A link is a separate row (`links`) pointing at where a file can be had.

**Facet.** A filterable dimension (platform, brand, source, region, flag, size class, ...). The count beside each value is what adding it would give; alt-click excludes it. See [ARCHITECTURE](ARCHITECTURE.md#the-browser-app-web).

**Grain.** What a row stands for in a view: entries, links, or titles (a game's regions, revisions and discs grouped, shown with a ×N chip).

**Link-free copy.** The database the hosted SQL console runs on: romgi's whole database with every column that says where a file can be downloaded emptied, and torrent infohashes replaced by `pack-001`, `pack-002`, ... Built by `livedb.py`; checked by `tests/test_livedb.py`. See [ARCHITECTURE](ARCHITECTURE.md#what-the-hosted-site-never-contains).

**Pack.** A torrent that contains several entries; shown by name on the hosted site, and numbered in the SQL copy.

**Quality check.** One of 16 queries over the catalogue that finds something wrong, odd or fine; the numbers come from `build_quality()`, the sentences from `web/js/46-quality.js`. See [DEVELOPING](DEVELOPING.md#add-a-quality-check).

**romgi.** The upstream project (`caprado/romgi`) whose catalogue this explorer reads. Its README says forks and derivative tools are not supported; the explorer reads a copy you download yourself. See [README](../README.md#notes).

**Slice.** A combination of filters, a view, a sort and an open card, all written in the address bar so it can be shared and restored. See [README](../README.md#what-is-in-it).

**Source.** A host that serves a catalogue entry's file (for example an archive or a mirror). "Offered by" filters on which combinations of sources offer an entry.

**Service worker.** `sw.js`: saves the page, the fonts and the three data files in the browser so the hosted site installs and opens offline; its id is a hash of the page and the data, so a rebuild installs quietly and the page offers "Reload". See [ARCHITECTURE](ARCHITECTURE.md).

---

Related: [INDEX](INDEX.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DEVELOPING](DEVELOPING.md) · [TESTING](TESTING.md) · [README](../README.md)
