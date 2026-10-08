# Testing

> **TL;DR.** Most tests compare the explorer with the SQL database it was built from, so they need `data/romdb.db` (the third-party catalogue; `./run.sh` downloads it once, 55 MB) and a
> built dataset. A few need a built site, a small fixture catalogue, or a real browser (Playwright). The documentation check (`python3 tests/test_docs.py`) needs none of that and
> runs in under a second.

Related: [INDEX](INDEX.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DEVELOPING](DEVELOPING.md) · [GLOSSARY](GLOSSARY.md) · [README](../README.md)

## Which test needs what

| Stage | Command | Needs | Checks |
|---|---|---|---|
| docs | `python3 tests/test_docs.py` | nothing | links and anchors resolve, every document is in the map and in `llms.txt`, `llms-full.txt` is current, counts and names are true |
| dataset | `python3 build_dataset.py --db data/romdb.db --out dist/dataset.snapshot.json.gz` then `python3 tests/test_dataset.py data/romdb.db dist/dataset.snapshot.json.gz` | `data/romdb.db` | every flag, size class, region, source, pack and format count against SQL; the table is stored in the order the printed SQL sorts by |
| engine | `node tests/engine.test.js data/romdb.db dist/dataset.snapshot.json.gz 40` | dataset | random slices, filters and cross-tabs through the browser engine against the SQL the UI prints; the one-dimension fast paths against the general path; then every hand-picked collection |
| link-free copy | `python3 livedb.py data/romdb.db dist/livedb.sqlite.gz --gzip && python3 tests/test_livedb.py data/romdb.db dist/livedb.sqlite.gz` | `data/romdb.db` | the copy is the original minus only the download locators |
| transport | `node tests/transport.test.js site/catalogue.*.bin site/detail.*.bin dist/dataset.snapshot.json.gz` | a built site (`bundle.py --pages --live-db`) | the two hosted data files, unpacked as the page does, equal the dataset; a page started from the first and given the second ends up identical; a missing or mismatched second file is refused |
| early | `node tests/early.test.js site/catalogue.*.bin site/detail.*.bin dist/dataset.snapshot.json.gz` | a built site | the engine running from the first file alone agrees with the whole dataset; size measures answer with nothing, not an error; after the detail arrives, size totals and sorts agree too |
| SQL console | `node tests/sqlconsole.test.js dist/livedb.sqlite.gz site/vendor/sqljs dist/dataset.snapshot.json.gz` | a built site | what may run, that writes fail, CSV quoting, and every example the console offers |
| drift guards | `python3 tests/make_fixture.py data/romdb.db dist/fixture/romdb.db --extra-source`, then `build_dataset.py --db dist/fixture/romdb.db ...`, then `python3 tests/test_drift.py dist/fixture/romdb.db` | `data/romdb.db` (about 10 s) | broken copies of a small catalogue (renamed column, dropped table, a fifth region, an unknown source, schema version 5) are refused with the reason; a new source, table or column is only mentioned; the completeness rule calls exactly the six short weeks of romgi's real history unfinished |
| new source | `node tests/sources.test.js dist/fixture/romdb.db dist/fixture/dataset.json.gz` | the fixture | the explorer on a catalogue with a source it has never seen: colour slots, counts, the "Offered by" filter and its printed SQL |
| browser smoke | `node tests/smoke.test.js site` | a built site, `npm install --no-save playwright-core`, `CHROME_PATH` or `/usr/bin/google-chrome` | opens the built site and uses it: overview, search, filter, a card, every view, the SQL console, a phone-width page, and that only expected hosts were asked for |
| address | `node tests/url.test.js dist/dataset.snapshot.json.gz` | dataset | every filter value has a text form that reads back as itself; 300 random slices survive a round trip through the address; names a catalogue no longer has are skipped and counted |
| offline | `node tests/offline.test.js site dist/dataset.snapshot.json.gz dist/art.snapshot.json.gz` | a built site, a browser (a few minutes) | the manifest, icons and the worker's file lists; a first visit saves the app and it opens with the network gone; a newer build installs quietly; a build missing a file is not installed |
| language | `node tests/i18n.test.js dist/dataset.snapshot.json.gz` | dataset | the Spanish dictionary is complete and faithful: every message has a translation, none loses a `{name}`, plural form or tag, none still reads as English, none is unused |
| language in a browser | `node tests/lang.test.js site dist/romgi-explorer.standalone.html` | a built site, a browser | the page in Spanish: the headline before the script runs, tabs, the number formats of Mexico and Spain, no English words left in any view, the switch returns to the same slice, a browser set to French gets English |

## Order that works from a clean checkout

```bash
./run.sh                                  # once: downloads data/romdb.db (55 MB, a third-party file) and starts the local server; stop it with Ctrl+C
python3 build_dataset.py --db data/romdb.db --version-json data/version.json --out dist/dataset.snapshot.json.gz --art-out dist/art.snapshot.json.gz
python3 livedb.py data/romdb.db dist/livedb.sqlite.gz --gzip
python3 bundle.py --dataset dist/dataset.snapshot.json.gz --art dist/art.snapshot.json.gz --live-db dist/livedb.sqlite.gz --pages --out-dir site
# then any row of the table above
```

## Conventions

- Tests read the database and the dataset; they never write to `data/`. `dist/` and `site/` are scratch and git-ignored.
- A new feature needs the engine-versus-SQL comparison to cover it, and every new UI message needs its Spanish entry (the language test fails the build otherwise).
- Never commit the catalogue. With `ROMGI_PRIVATE_NAMES=name1,name2` in the environment the documentation check also fails if a document names a private project.

---

Related: [INDEX](INDEX.md) · [ARCHITECTURE](ARCHITECTURE.md) · [DEVELOPING](DEVELOPING.md) · [GLOSSARY](GLOSSARY.md) · [README](../README.md)
