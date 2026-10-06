# Roadmap

Where romgi-explorer goes next, written 2026-10-06 from measurements of the live site, a read of the original romgi's code and issues,
and two research passes (UI patterns in comparable tools, reference datasets). Claims from those passes that were not re-checked here are
marked *unverified*. Sizes are scope, not time: **S** is one area with tests, **M** touches the builder, the page and the tests (a new
column or view), **L** is a new data pipeline or a new surface that needs design, data and tests together.

## The short version

romgi is how you get a file. romgi-explorer should be where you work out what exists and what to get, without an account, on any
device. It stays read-only and link-free on the hosted site. It gets richer in four ways:

1. **Games, not files.** 241,137 entries are about 165,000 games once revisions and variants are grouped. Show them that way, with an
   editions grid and a chooser that picks one edition per game for you.
2. **A card that tells you about the game.** Cover, screenshot, title screen, genre, year, developer, achievements, editions, which
   sources have it, and what is wrong with the data, on one sheet that works one-handed on a phone.
3. **A living catalogue.** What changed since last week, what disappeared in an outage, a feed you can subscribe to.
4. **Your shelf.** Wants, haves, notes, saved views and a "my folder against the catalogue" check, all stored in your browser and
   exported as a file you own. Installable, works offline.

Before any of that, make it hard to break: the build assumes exactly four sources and schema v4, and romgi's maintainer has said a
"db split" is coming. A fifth source or a schema change would stop our deploys today.

On sources: the useful enrichment is *reference data about the games already in the catalogue* (names, hashes, genres, years,
screenshots), plus catalogues of content that is licensed for distribution. Adding more hosts of copyrighted ROMs is romgi's call, and
not something the public site will do (see G).

## Where we stand (2026-10-06)

| | |
|---|---|
| Catalogue | 241,137 entries, 400,224 links, 50 platforms in 14 brands, 4 sources |
| Sources (entries) | MiNERVA 212,565, Internet Archive 125,142, NoPayStation 30,144 (57,737 links), MarioCube 4,780 |
| Coverage | box art 38.6% (93,197), serial 37.9% (91,296), RetroAchievements 4.0% (9,765 entries, 546,392 achievements) |
| Biggest holes | PS Vita 33,398 entries with no art, Xbox 360 18,345 with none, MAME 14,485 with 1%, FinalBurn Neo 8,209 with 3% |
| Shape | 211,504 distinct (platform, title); 54,777 entries share a title with another entry; source overlap: 101,177 MiNERVA-only, 81,313 MiNERVA + Internet Archive, 25,076 NoPayStation-only, 24,432 Internet Archive-only |
| Product | 7 views, 18 linked filters, 8 collections, 16 quality checks, a SQL console in the browser |
| Quality gates | 6 test suites, CI that tests, builds and deploys on every push and within 3 hours of romgi publishing; accessibility 100, best practices 100 |
| Load | first data file 4.8 MB, then 2.2 MB, now 0.92 MB (exact sizes moved to the second file); titles and sizes follow in 4.0 MB. Live, Lighthouse 13.5 with covers blocked, clean runs: desktop 100 (blocking time 20 ms), mobile median 74 of 5 (range 66 to 92), with covers mobile median 87 of 3; first paint 1.3 s and largest paint 1.5 s on the simulated mobile link; accessibility 100, best practices 100. Mobile blocking time swings between runs (329 to 4,133 ms) because of a few single tasks at boot (B1) |

What is weak, from reading the code and the live site:

- **Four sources are assumed in six places:** `SOURCE_ORDER`/`SOURCE_SHORT` and an assert on the source set in `build_dataset.py`, a
  four-term popcount for entries' source counts in `10-data.js`, the "Offered by" filter sized 16 in `20-engine.js`, `Array(16)` in the
  collections presets, and four colour tokens in `app.css`. A fifth source fails the build.
- **No permalinks.** The URL hash holds only the view; filters live in local storage and the entry card opens by row index, which changes
  with every build. A slice or an entry cannot be linked.
- **No grouping.** "Same title" in the card matches identical titles only; revisions, betas and variants are separate rows.
- **A thin card.** Catalogue fields only: no screenshot, genre, year, developer or editions.
- **Search is substring and `-word`.** No ranking, no operators, and an empty result offers only "Clear all filters".
- **Desktop-first extras.** The SQL console needs a 41 MB download, shortcuts are keyboard-only, English only, no offline mode.
- **Long tasks at boot** (up to about 200 ms in a quiet run) that count against total blocking time.

## What the original romgi's users ask for

From its issues and code (read 2026-10-06; none of this was run): handhelds are the main device (AYN Thor, RG 406V, Retroid), so
landscape, D-pad and weak hardware matter (#2, #3, #16, #22, #45). They wanted descriptions and screenshots on the detail screen
(#21, shipped only with the user's own ScreenScraper or SteamGridDB login), grouping of discs (#17), filters for achievements (#1) and
FinalBurn Neo (#15), and they report source outages (#28 MiNERVA at 0 entries, #33 MarioCube blocked from CI). Its own gaps: search
runs on submit as `LIKE '%word%'` although a full-text table ships, filter sheets have no counts, "Clear filters" ignores the
achievements filter, and the personal layer is a flat wishlist and the last 20 viewed. None of 25 issues asks for lists, notes, feeds
or sharing, so those items rest on patterns in comparable tools, not on demand here.

## Principles the plan keeps

1. The hosted site is read-only and carries no download URLs, file names, magnets or infohashes. The local explorer may show what is in
   the user's own copy of the database.
2. Static, no accounts, no tracking. Anything personal lives in the user's browser and leaves only as a file they save.
3. Every number can be reproduced by SQL, and the tests are the specification.
4. Accessibility 100 and best practices 100 are gates, not polish.
5. No framework or build chain without a measured need.
6. Honest data: every enriched field says where it came from, and unknown is shown as unknown, never as zero.
7. A failed build leaves the previous site up.

## A. Keep it alive

| ID | What | Why | Size |
|---|---|---|---|
| A1 | **Generalise to N sources.** Read the source list from the data; popcount instead of four terms; "Offered by" sized from the source count (cap at 8, then group); colour tokens generated; a synthetic five-source dataset in the tests | A fifth source fails the build today (six places listed above) | M |
| A2 | **Schema and source drift guard.** Check `schema_version`, table and column names; a new *source* builds, a new *schema* stops with a message that names what changed; the CI summary says which | romgi's maintainer mentioned a coming "db split" (issue #33); our pipeline reads schema v4 | S |
| A3 | **Boot smoke test in CI.** Load the built site in a real browser: overview renders, search wakes up when the detail lands, no console errors, a filter changes a count, the SQL console opens | Unit tests pass while a boot-time JS error takes the site down; nothing in CI runs the page | S–M |
| A4 | **Run summary and heartbeat.** Job summary with file sizes, row counts, timings and the diff against the previous build; alert on failure; keep the schedule from going dormant after 60 days without activity | Silent failure is the main risk of a self-updating site | S |

## B. Fast on a phone

| ID | What | Why | Size |
|---|---|---|---|
| B0 | *Done:* first file 4.8 MB to 0.92 MB; titles and exact sizes load second; covers load only near the screen | Measured: the exact sizes were 1.36 of 2.2 MB | — |
| B1 | **Slice the long tasks.** Profiled on 2026-10-06 with the CPU slowed 4× (a mid-range phone): `App.mount` is one 370 ms task (the first overview render inside it is 240 ms); re-rendering the overview when the detail lands is 194 ms; one step of the detail attach (building the size and torrent-file arrays) is 133 ms; the slices in the boot loops stay under 60 ms. Render the overview's heavy cards in later tasks, patch only the size tile and treemap when the detail lands instead of redrawing everything, split the array step. Target total blocking time under 200 ms on the mobile profile | The profile above; on this machine at full speed only one task, the mount, exceeds 50 ms (89 ms) | S–M |
| B2 | **Installable and offline.** Manifest, a service worker caching the hashed data files, a "new catalogue ready" prompt when the freshness check says so | Pages sends `max-age=600`; handheld users are often offline; home-screen web apps get their own storage clock on Safari | M |
| B3 | **Measure search on a slow phone** before building an index; the linear scan is fast on a laptop | Do not add an index without a number | S |
| B4 | **Cover policy.** Fetch art when a card opens or scrolls near, back off after failures, never retry a dead host in a loop | GameTDB is sometimes slow; 93k covers come from two third-party hosts | S |
| B5 | *Optional:* SQL console without the 41 MB (HTTP range reads of an uncompressed database) or a cheaper host with immutable caching and Brotli | Only if the console matters on phones | L |

## C. Find it and decide

| ID | What | Why | Size |
|---|---|---|---|
| C1 | **Permalinks and URL state.** Hash carries view, query, filters, sort and the open card by slug; the back gesture closes the card | Today nothing can be linked. Foundation for C6, D2, E0 and sharing | M |
| C2 | **Release families.** A build-time `family` per platform and base title (text in `(...)` and `[...]` removed): re-measured on the 2026-10-04 catalogue: 165,381 families for 241,137 entries, 46.5% of entries in a multi-member family, 26,508 families across two or more regions. Browse by family, an "N editions" chip, a group toggle; cap families so a demo pack of 1,519 entries (Doko Demo Honya-san on 3DS) or a game with 228 entries (LittleBigPlanet 2) does not swallow the list | "Games, not files"; foundation for C3, C4, D3 | M |
| C3 | **Editions grid and compare.** Region × (Rev, Beta, Proto, Demo) with size and source count; tick two to see the difference | The card's "Same title" shows identical titles only | M |
| C4 | **One-sheet chooser.** Pick a region order and exclusions (Beta, Proto, Demo, Unlicensed); get one edition per family, the total size, and whether it fits a 128, 256 or 512 GB card; export the list as plain titles | The classic "one game, one ROM" need, and the question every handheld owner has | M |
| C5 | **The context card.** Cover, screenshot, title screen and logo from libretro's thumbnail paths (swap `Named_Boxarts` for `Named_Snaps`, `Named_Titles`, `Named_Logos`; a probe found 34 of 36 platforms with snaps, 29 titles, 13 logos, *unverified*), genre, year and developer (F3), achievements with a link to the game's page on retroachievements.org, editions (C3), sources by name without links, data-quality notes. On phones a bottom sheet with peek, half and full positions and step buttons | Answers romgi issue #21 without any account | M–L |
| C6 | **Search that recovers.** Exact, prefix, then rest; operators (`plat:snes reg:jp ra:50..`) echoed as chips; "Drop Japan: 1,204" suggestions when a slice is empty; a command palette (Ctrl/Cmd+K, a button on phones) | Empty results are a dead end today | M |
| C7 | **A-Z scrubber and place keeping.** Letter rail, "row 12,034 of 241,137", back returns to the same spot | 241k rows on a phone | S |
| C8 | **A Discover start page.** Search first, platform tiles with cover collages, the collections, the daily shelf, "new this week"; today's Overview becomes "Analyze" | Newcomers meet a dashboard of charts | M |
| C9 | **Platform and collection pages** with prerendered stubs and preview cards (about 58) | Link previews on chat apps need server-rendered tags | M |
| C10 | **My systems and handheld mode.** Pick the systems you own and scope every count; gamepad focus (D-pad, L1/R1 to switch platform) | Matches the original's audience | M |
| C11 | **Spanish and English** with locale-aware numbers and dates | The UI is English only and formats numbers as en-US | M |
| C12 | **Accessibility pass.** `role=grid` with row counts for the virtual table, a switch for single-key shortcuts, 44 px targets on touch, chart and table toggles, an automated check in CI | Lighthouse covers the first view only | S–M |
| C13 | **Export, print and share.** Titles-only CSV, JSON and Markdown; a print stylesheet; a share card | CSV is local-only today; the live site copies 3,000 rows as TSV | S–M |

## D. Your shelf (local first)

| ID | What | Why | Size |
|---|---|---|---|
| D1 | **Marks, lists and notes.** Want, Have, Seen, named lists, a one-line note; stored by slug with title and platform as a fallback; "no longer in the catalogue" when an entry disappears; ask the browser for persistent storage; JSON export and import (merge or replace) | Local-only storage can be evicted (Safari clears script-written storage after 7 days without a visit, *unverified* for current versions); the export is the safety net | M |
| D2 | **Saved views.** Name a slice (filters, query, sort), pin it as a chip, export it with the shelf. Keep views and lists apart | Collections already resolve ids by name; this is the user's version | S |
| D3 | **My folder against the catalogue.** Paste or drop a list of file names, or pick a folder where the browser allows it; normalise No-Intro style names, match with a confidence, show owned and missing per platform, export the missing list. Runs entirely in the browser, never uploads | Bridges the catalogue and the files you actually hold; works for anyone, not only romgi users | M–L |
| D4 | **Share a list as a link** (slugs compressed into the URL) and import one | Needs C1 | S–M |

## E. A living catalogue

| ID | What | Why | Size |
|---|---|---|---|
| E1 | **What changed.** Per build: new, removed and changed entries, newly achievement-enabled, new art. A `changes.json`, an Atom and a JSON feed with autodiscovery, a "since your last visit" banner. Outage-aware: a swing of tens of thousands of entries is summarised, never listed | Outages: 2026-04-05 −73,693, 05-01 +100,223, 08-16 −100,981, 08-28 +101,180 entries (measured from the weekly history). The build needs the previous slug set, which it can read from the live site before deploying | M–L |
| E2 | **Per-source history.** Record each source's entry and link counts every build (the weekly history has only totals) and draw a timeline | MarioCube has been blocked from romgi's CI since August; MiNERVA once read 0 entries (#28) | S |
| E3 | **Explain the outages** on the Sources view with links to the romgi issues that describe them | Turns a scary dip into an answer | S |

## F. Reference data: enrich what is already in the catalogue

The best way to enrich the catalogue is to say more about the games it already lists, from datasets that are made for that. A survey
(2026-10-06, primary sources read, nothing over 20 MB downloaded) found these usable. *Verdict* is about republishing derived fields on
the public site. Match rates below are the survey's own measurements or estimates and have not been re-run against romgi's database;
each item re-measures them first.

| ID | Source | Adds | Verdict and terms | Joins by | Size |
|---|---|---|---|---|---|
| F1 | **No-Intro DATs** and the DAT copies in **libretro-database** (No-Intro, Redump, TOSEC; version 2026.08.01) | Canonical name, size, CRC, MD5, SHA-1, region, some serials | No-Intro: any lawful reuse, no attribution (data usage licence updated 2026-09-11). libretro-database: CC BY-SA 4.0, attribution and share-alike on derived data. The No-Intro daily pack is a click-through form, so scripts use libretro's copy | Exact name and platform; the survey estimates 85–95% for MiNERVA rows | M |
| F2 | **Redump** (redump.info, GET `/datfile/<system>`) | Disc names, serials (10,654 of 10,981 on PS1), per-track size and hashes | Metadata only, "considered public domain". The old redump.org is obsolete (moved 2026-06-20). Serials contain a space and need normalising | Serial, then name | S |
| F3 | **libretro-database metadata** (genre, developer, publisher, release year and month, players, franchise, ESRB) | Facets (decade, genre, developer, franchise), card fields, virtual collections, "similar" shelves | CC BY-SA 4.0. Each record holds a CRC or serial and also the game's No-Intro name, which is the name in our stored art paths, so entries with libretro art join with no DAT at all. **Checked on SNES (2026-10-06):** 3,439 of 4,571 entries have art (75%), and 3,398 of those matched a developer and 3,389 a genre (99%), so 74% of all SNES entries are covered; for the 1,132 without art a naive title-plus-region guess matched 4%, so they need F1's names or a better normaliser. Platforms with little or no libretro art (PS Vita, Xbox 360, MAME, FinalBurn Neo) get nothing from the name route. Coverage differs a lot by platform (developer rows against DAT entries: SNES 3,850 of 4,268, GBA 3,059 of 3,692, PS1 9,947 of 13,592, PS2 4,726 of 13,891, NES 3,274 of 14,132, DS 132 of 7,701, Saturn none), so measure each platform and show coverage | Name (art path) first; CRC via F1 or serial for the rest | M |
| F4 | **libretro thumbnails**: screenshots, title screens, logos | Images for the card (C5) | Derived from the box-art path we already store; hot-linked like box art. Licence not stated. A one-entry-per-platform probe found screenshots on 34 of 36 platforms, title screens on 29, logos on 13 | None needed | S |
| F5 | **Wikidata** (CC0) | An id hub (IGDB, MobyGames, GameFAQs, GameTDB, Redump) plus dates, developers, series | OK. 178,098 game items; only 24–50% of DAT base titles exist there (SNES 40%, PS1 25%, Saturn 24%), and the RetroAchievements id reaches at most 23% of our 9,765 entries. Use for outbound links and series, not as the main source | Title and platform, ids | M |
| F6 | **GameTDB** XML (Wii, GameCube, DS, 3DS, Wii U, PS3) | Developer, publisher, date, genre, players, synopsis | Its own FAQ and file header ask that the data is not used on a website without permission. Ask first; this also covers the box art we already hot-link from it | Game id, which our art paths embed | S after permission |
| F7 | **Internet Archive item metadata** | Per-file size and hashes, public date, collection, downloads | Facts, no key, descriptive User-Agent and 429 handling required. Too many requests for all 125k items; use it to check the 4,673 suspect sizes | Item id | S |
| F8 | **IGDB** | Summary, genres, themes, regional dates, screenshots | OK with attribution, free for non-commercial use, Twitch credentials, 4 requests per second. Run in a build step keyed by the ids from F5; later and optional | IGDB id | L |
| F9 | **Provenance, credits and coverage.** Each enriched field names its source and version; an "About this data" credits list; a per-platform coverage table; a 200-entry hand-checked join audit with a 99% precision bar | Trust, and it is the licence housekeeping | — | S |

Not now, with reasons: **ScreenScraper** (needs written consent beyond free apps), **MobyGames, Giant Bomb, SteamGridDB, EmuMovies**
(paid, non-commercial or gated; pages were blocked to the survey), **OpenVGDB** (no licence, text refers to GameFAQs), **DuckStation's
game database** (CC BY-NC-ND), **LaunchBox, TheGamesDB, Hasheous** (no data licence found; Hasheous ids only, after asking),
**RetroAchievements' API** (terms not readable by the survey; we already carry its ids and counts). NoPayStation's published lists hold
package URLs and keys: never read into anything public.

### What reference data makes possible

1. **Completeness.** Per platform, how much of the No-Intro or Redump set the catalogue has, split into games, demos, prototypes,
   betas and aftermarket, with the missing parents ranked by popularity. Denominators from libretro's copy: SNES 4,268, GBA 3,692,
   N64 1,435, PS1 13,592, PS2 13,891, Saturn 2,677.
2. **Size audit.** Compare each raw link's size with the DAT's (cartridges exactly, discs as the sum of tracks); check archives against a
   compression band. This gives ground truth for the 4,673 impossible Internet Archive sizes.
3. **Region audit.** Titles with "(USA)", "(Europe)", "(Japan)" against `regions_entries`; the region letter in GameTDB ids.
4. **Duplicates.** Entries and links that resolve to one DAT game or hash across sources; names renamed in newer DATs.
5. **Source fragility.** Games held by one link on a source whose health is down; catalogue entries absent from every DAT go to a
   quarantine list (hacks, translations, stale names).

These are also the findings worth sending upstream (H1).

## G. More catalogue sources

"Sources" can mean three different things; they get different answers.

| ID | What | Answer |
|---|---|---|
| G1 | **Sources romgi adds.** Once A1 is done, a new source in romgi's catalogue appears on its own. A page per source says what it uniquely holds; E2 and E3 show how it behaves over time | Do |
| G2 | **Content that is licensed for distribution**, in a clearly labelled "open" source family that can link to the files because the distribution is permitted: **Homebrew Hub** (1,629 entries: Game Boy 913, Game Boy Color 448, GBA 245, NES 23; each entry carries its own licence, shown by the API for only 87), **libretro's open-content assets** (homebrew, demos, Cave Story, DOOM; no per-file licence data, so link, do not mirror), the **28 free arcade titles on mamedev.org**, **ZXDB** (ZX Spectrum, with a per-owner permissions table), plus Demozoo and itch.io as link-out only. About 2,000 entries, so cheap to carry | Do, after F1 to F3. Link always, host never without an explicit licence. The Internet Archive's `licenseurl` is whatever the uploader typed (a complete NES collection is tagged CC0): never use it as proof of permission |
| G3 | **Bring your own source, local only.** The local explorer merges a file of the user's own links (romgi's own `user_sources` idea) so the user can see their sources next to the catalogue. The hosted site never ships third-party link data | Your call, later |
| G4 | **More hosts of copyrighted ROMs** | Not on the hosted site, and not something this project crawls. If romgi indexes one, A1 shows it |

## H. Project health

| ID | What | Why | Size |
|---|---|---|---|
| H1 | **Talk to romgi's maintainer.** A short courtesy note, the data-quality findings (6,638 titles with scrambled characters, 4,673 impossible Internet Archive sizes, the outage swings), and two questions: what is planned for the catalogue format, and whether a read-only explorer that carries no download locators is acceptable. Drafted here, sent by you | The README says forks and derivative tools are not supported; better to ask than to guess | S |
| H2 | **Say what this is.** A "not affiliated" line, a "Get it in romgi" link to its releases, a name that describes the thing ("an explorer for romgi's catalogue") rather than reusing the app's name | Avoids being taken for the app | S |
| H3 | **Write down how it works.** Data flow diagram, how a build runs, how to add a facet, a view, an overlay; a CONTRIBUTING file | The next session, or contributor, starts from a page, not from the code | S |
| H4 | **Analytics: none by default.** If you want numbers, aggregate counts only, no cookies, nothing per person | Matches the no-tracking principle | — |
| H5 | **Release notes** generated from tags and E1's diff | Ties the code changelog to the catalogue changelog | S |

## Order of work

Phase 1, make it unbreakable and linkable: **A1, A2, A3**, then **B1**, **C1**, **C2**. The first three are small and protect the live
site from the changes most likely to hit it. C1 and C2 are the foundations the rest stands on (links, groups).

Phase 2, make the card worth opening: **C5** with **F4** first (screenshots and title screens need no new data), then **F1** and
**F2** (names, hashes, serials), **F3** (genre, year, developer), **C3**, **C6**, **C7**, **D1**, **D2**, **B2**, **E2**, **F9**.

Phase 3, understand and decide: **C4**, **E1**, the completeness and audit analyses (F1 and F2 make them possible), **D3**, **C8**,
**G1** and **G2**.

Phase 4, reach: **C9**, **C11**, **C10**, **C13**, and whatever you choose from G3. **H1** and **H2** belong early if you agree: the
reply shapes F and G.

A4, B3, B4 and C12 slot in beside whatever they touch. B5 only if the SQL console matters on phones.

## How we will know it worked

- First data file stays under 1 MB; mobile Lighthouse on the live site 90 or more with total blocking time under 200 ms; accessibility and
  best practices stay at 100.
- CI boots the built site in a real browser on every deploy, and a synthetic five-source dataset builds and renders.
- Each enrichment reports its coverage per platform (share of entries with year, genre, developer, hash) and its join precision on a
  hand-checked sample of 200, with a target of 99% before it ships.
- A shared URL reproduces the slice or the card it was copied from.
- The site is within three hours of romgi's latest catalogue, and the build summary says so.

## Risks

- **Upstream changes.** A new schema or a split database stops the build; A2 makes that loud instead of silent, and H1 asks early.
- **Licences of overlays.** Reference datasets differ (one is CC BY-SA 4.0 and needs attribution; some forbid redistribution of derived
  fields). Each overlay gets a verdict before it is joined, and a credits page.
- **Join mistakes.** Matching by name can attach the wrong game. Joins are checked on a sample, show their confidence, and a doubtful
  match is left out rather than guessed.
- **Third-party hosts.** Covers and screenshots come from libretro and GameTDB; both can be slow or change paths. The page degrades to the
  platform tile.
- **Local data loss.** Browsers can evict local storage; the export file and a nudge to use it are the answer.
- **Our own measurements.** Several numbers above come from a research pass and are marked unverified; each is re-measured when its item
  starts.

## Decisions for you

1. **Order.** Robustness first (A, then C1 and C2), or features first? Recommended: robustness first, because it is small.
2. **Spanish.** Add it, after the card work? Recommended: yes.
3. **Offline app.** Make the site installable? Recommended: yes.
4. **Sources.** Tier 1 (reference data) and tier 2 (licensed content) yes? A local-only "bring your own source" later? Never more
   download hosts on the public site? Recommended: yes, maybe later, never.
5. **romgi's maintainer and GameTDB.** Send H1 now, or after Phase 2? Recommended: now, because the answer shapes F and G. Separately,
   ask GameTDB for permission to use its data (F6); it also covers the art we hot-link from it today.
6. **Name.** Keep "Romgi Catalog Explorer", or a descriptive name that cannot be mistaken for the app?
7. **Analytics.** None (recommended) or aggregate-only?
8. **Hosting.** Stay on GitHub Pages (recommended for now), or move for Brotli and immutable caching?
