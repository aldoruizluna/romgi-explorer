# AGENTS.md: working on romgi-explorer

romgi-explorer is a browser UI for the catalogue behind [caprado/romgi](https://github.com/caprado/romgi): every entry, every link and the metadata around them, sliceable and pivotable, with box
art and a SQL console. It runs locally against your own `romdb.db`, and as a static GitHub Pages site built from a link-free copy. Python standard library only; plain JavaScript without a bundler.
It is a **public** repository. Documentation map: [docs/INDEX.md](docs/INDEX.md); machine-readable index: [llms.txt](llms.txt) (`llms-full.txt` is everything in one file).

## Map

| Path | What |
|---|---|
| `run.sh`, `serve.py` | the local launcher and server (`127.0.0.1:8765`) |
| `build_dataset.py`, `drift.py`, `refresh_history.py` | the columnar dataset, the guards, the weekly history |
| `livedb.py`, `bundle.py`, `compose.py`, `pwa.py`, `icons.py`, `vendor_sqljs.py` | the link-free copy and the hosted site |
| `web/` | the page: `index.html`, `css/`, `js/NN-name.js` (filename order is load order), `lang/` (Spanish), `sw.js`, `worker/`, `fonts/`, `og/` |
| `tests/` | the tests; see [docs/TESTING.md](docs/TESTING.md) |
| `docs/` | documentation; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how it fits together |
| `.github/workflows/pages.yml` | builds and publishes the live site (on push and every three hours) |

## Hard rules

1. **Do not run `./run.sh`, `serve.py` against a downloaded catalogue, or anything that fetches romgi's catalogue without the owner's word.** The first run downloads a 55 MB third-party file.
   Tests that need `data/romdb.db` are listed in [docs/TESTING.md](docs/TESTING.md); the documentation test needs nothing.
2. **This is a lens, not a store.** Never add a feature that fetches, links to, or helps obtain files. Never put download URLs, file names, torrent paths, magnets or infohashes on the hosted site;
   `livedb.py` and `tests/test_livedb.py` exist to guarantee that.
3. **Never commit the catalogue** (`data/romdb.db*`) or build output (`dist/`, `site/`).
4. **Bilingual.** Every message is English and Spanish (`__()`, `__h()`, `__n()`, `N_()` and `web/lang/es.js`); `tests/i18n.test.js` fails the build otherwise.
5. **The UI must agree with SQL.** Anything counted in the UI has a test against the database. Bump `BUILD_VERSION` in `build_dataset.py` when the dataset format changes.
6. **Public repository hygiene.** No usernames, home paths, hostnames, addresses or private project names in code, docs, tests or images. Scan before every push.
7. **Do not push, merge or publish without the owner's explicit word.** Commit locally in small steps chained with `&&`.
8. **Verify for real**: run the tests that apply, and look at changed pages in a browser (desktop and phone width).

## Commands

```bash
python3 tests/test_docs.py             # the documentation check (no data needed)
python3 scripts/build-llms             # regenerate llms-full.txt after any documentation change
```

Everything else (build, serve, test with data): [docs/DEVELOPING.md](docs/DEVELOPING.md) and [docs/TESTING.md](docs/TESTING.md). Terms: [docs/GLOSSARY.md](docs/GLOSSARY.md).
