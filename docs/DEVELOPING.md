# Developing romgi-explorer

> **TL;DR.** Edit `web/` and reload (the local server composes the page on every request). Changing the dataset format means bumping `BUILD_VERSION` in `build_dataset.py`.
> Every message shown to a person is English *and* Spanish; every number the UI shows must agree with SQL on the real database; nothing that says where a file can be downloaded may reach
> the hosted site. Recipes for the common additions are below.

Related: [INDEX](INDEX.md) · [ARCHITECTURE](ARCHITECTURE.md) · [TESTING](TESTING.md) · [GLOSSARY](GLOSSARY.md) · [ROADMAP](ROADMAP.md) · [AGENTS](../AGENTS.md)

## Set up

```bash
git clone https://github.com/aldoruizluna/romgi-explorer && cd romgi-explorer
./run.sh          # downloads romgi's published catalogue (55 MB, a third-party file) the first time, builds, serves http://127.0.0.1:8765
```

Python 3.9 or newer, standard library only. Node is needed only for the tests; the browser tests also need `npm install --no-save playwright-core` and Chrome.
`ROMGI_OPEN=0 ./run.sh` skips opening a browser; `./run.sh --refresh` fetches the latest weekly catalogue; to use a database you already have:
`python3 serve.py --db path/to/romdb.db --version-json path/to/version.json --open`.

## The loop

| You changed | Do |
|---|---|
| anything in `web/` (html, css, js, lang) | reload the page (it is composed per request) |
| `build_dataset.py` or anything that changes the dataset's shape | bump `BUILD_VERSION`, restart `serve.py` (the cache is keyed on it) |
| `livedb.py`, `bundle.py`, `pwa.py`, `icons.py` | rebuild the site (`bundle.py --pages ...`, see [TESTING](TESTING.md#order-that-works-from-a-clean-checkout)) |
| any document | `python3 scripts/build-llms`, then `python3 tests/test_docs.py` |

## Conventions

1. **Bilingual.** Every message is written in English where it is used and passed through `__()`, `__h()` (markup), `__n()` (plural) or `N_()` (marks a message in a table). The Spanish
   dictionary is `web/lang/es.js`. A missing translation shows English, but `tests/i18n.test.js` fails the build for a gap, a lost `{name}` or tag, an untranslated-looking entry, or an unused one.
2. **The UI never disagrees with SQL.** Anything the UI counts has a test comparing it with the database; the "SQL" button prints the query that reproduces the current slice.
3. **Link-free on the hosted site.** Download URLs, file names, per-file torrent paths, magnets and infohashes never leave the local server. Do not add a field to the hosted files without
   checking `livedb.py` and the dataset builder.
4. **Links keep their meaning.** Filter values in the address are ids and names, not positions, so a link survives a catalogue rebuild.
5. **Guards stay on.** A catalogue in a format the builder does not read stops the build; one that looks unfinished is held back. New sources, tables and columns are reported, not refused.
6. **Never commit the catalogue** (`data/romdb.db*`) or build output (`dist/`, `site/`).
7. **This is a lens, not a store.** No feature fetches, links to, or helps obtain files; the explorer helps you understand what a catalogue contains.
8. **Chain commands with `&&`; do not push without the owner's word.**

## Recipes

### Add a view
1. A new file `web/js/4N-name.js` (the number places it in load order, after `40-shell.js` and before `50-url.js`) that sets `App.views.<id> = { render(root), after?(root), patchDetail?() }` (`renderView()` in `40-shell.js` calls `render` then `after`).
2. Add `{ id, label: N_('Label'), icon, key }` to `TABS` in `web/js/40-shell.js` (the key becomes the `G` then `<key>` shortcut).
3. Wrap every message in `__()` / `N_()` and add the Spanish to `web/lang/es.js`.
4. Make its state addressable if it has any (`50-url.js`), and add a case to `tests/smoke.test.js` and `tests/lang.test.js`.

### Add a hand-picked collection
Add an object to `COLLECTIONS` in `web/js/48-collections.js`: `{ id, icon, title: N_('...'), blurb: N_('...'), preset: { grain, plat?, reg?, flag?, ... } }`. Presets name platforms, regions and sources
by *id*, so they survive growth; one that matches nothing is left out. `tests/engine.test.js` runs every collection against SQL.

### Add a quality check
Its numbers come from `build_quality()` in `build_dataset.py` (they land in `dataset.quality`, keyed by the check's id); its sentence lives in `web/js/46-quality.js` under the same id (the
builder supplies only the numbers). Add both, translate the sentence, and expect `i18n.test.js` and the dataset-versus-SQL test to cover it.

### Add a language
Add its code to `LOCALES` in `web/js/01-i18n.js` and `web/lang/boot.js`, write `web/lang/<code>.js`, and extend `tests/i18n.test.js` to read it.

### Add a document
Put it in `docs/`, start it with a **TL;DR** and a **Related** line, end with a **Related** footer, list it in [INDEX](INDEX.md) and `llms.txt`, run `python3 scripts/build-llms`, then
`python3 tests/test_docs.py`.

---

Related: [INDEX](INDEX.md) · [ARCHITECTURE](ARCHITECTURE.md) · [TESTING](TESTING.md) · [GLOSSARY](GLOSSARY.md) · [ROADMAP](ROADMAP.md) · [AGENTS](../AGENTS.md)
