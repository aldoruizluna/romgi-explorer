/* ============================================================ collections: hand-picked slices, and a daily shelf of covers */


/** Editorial entry points. A preset names platforms, regions and sources by id, so it keeps working when the catalogue grows;
 *  one that no longer matches anything is left out rather than shown empty. `gallery` opens Browse as a gallery sorted that way. */
const COLLECTIONS = [
  { id: 'mirrored', icon: 'layers', title: 'Mirrored everywhere', blurb: 'Entries offered by three or more sources, so one outage does not take them away.',
    preset: { grain: 'entries', avail: 'min3' } },
  { id: 'achievers', icon: 'trophy', title: 'Achievement hunters', blurb: 'Releases with 50 or more RetroAchievements and box art.',
    preset: { grain: 'entries', ra: [4, 5, 6], art: [1, 2] }, gallery: 'ra' },
  { id: 'cartridge', icon: 'grid', title: 'Cartridge classics', blurb: 'NES, SNES, Mega Drive, Game Boy and N64 games that have achievements and box art.',
    preset: { grain: 'entries', plat: ['nes', 'snes', 'smd', 'gb', 'gbc', 'gba', 'n64'], ra: [1, 2, 3, 4, 5, 6], art: [1, 2] }, gallery: 'ra' },
  { id: 'discs', icon: 'disc', title: 'The disc era', blurb: 'PlayStation, Saturn and Dreamcast releases that have box art.',
    preset: { grain: 'entries', plat: ['ps1', 'sat', 'dc'], art: [1, 2] }, gallery: 'ra' },
  { id: 'unreleased', icon: 'tag', title: 'Prototypes and betas', blurb: 'Unfinished builds: prototypes, betas, demos and samples.',
    preset: { grain: 'entries', flag: ['proto', 'beta', 'demo', 'sample'] } },
  { id: 'japan', icon: 'code', title: 'Japan only', blurb: 'Releases that only exist as Japanese editions.',
    preset: { grain: 'entries', reg: ['jp'], exclude: { reg: ['us', 'eu'] } } },
  { id: 'big', icon: 'download', title: 'Beyond a DVD', blurb: 'Files of 4.7 GiB and up that are still believable sizes.',
    preset: { grain: 'links', sz: [5] } },
  { id: 'single', icon: 'link', title: 'One copy only', blurb: 'Entries with a single link in the catalogue.',
    preset: { grain: 'entries', nl: [0] } },
];

/** Turn the ids in a preset into the facet values the engine uses; null when a named id is gone. */
function resolvePreset(p, D) {
  const d = D.dims, at = (list, id) => list.findIndex(x => x.id === id);
  const map = {
    plat: ids => ids.map(id => at(d.platforms, id)),
    reg: ids => ids.map(id => at(d.regions, id)),
    src: ids => ids.map(id => at(d.sources, id)),
    avail: v => (v === 'min3' ? [...Array(1 << d.sources.length).keys()].filter(m => popcount(m) >= 3) : v),
  };
  const out = { ...p };
  let ok = true;
  const fix = (k, v) => { const r = map[k] ? map[k](v) : v; if (Array.isArray(r) && r.some(x => x < 0)) ok = false; return r; };
  for (const k of Object.keys(map)) if (out[k]) out[k] = fix(k, out[k]);
  if (out.exclude) out.exclude = Object.fromEntries(Object.entries(out.exclude).map(([k, v]) => [k, fix(k, v)]));
  return ok ? out : null;
}

/** Resolve and count every collection once, in slices (the counts do not depend on the slice you are looking at). */
function* collectionSteps() {
  App._colls = [];
  const S = App.S, keep = { state: S.state, cache: S.cache };
  try {
    for (const c of COLLECTIONS) {
      const preset = resolvePreset(c.preset, App.D);
      if (!preset) continue;
      const count = S.countPresetHere(preset);          // the slice stays on the last preset between steps (the page is not drawn yet); restored below
      if ((preset.grain === 'links' ? count.links : count.entries) > 0) App._colls.push({ ...c, preset, count });
      yield;
    }
  } finally { S.state = keep.state; S.cache = keep.cache; S.recompute(); }
}

function collectionsHTML() {
  const cs = App._colls || [];
  if (!cs.length) return '';
  return `<section class="s12 shelf" aria-labelledby="start-h"><div class="shelf-h"><div><h3 id="start-h">Start here</h3><p>Hand-picked slices. Each one sets the filters for you.</p></div></div>
    <div class="colls">${cs.map(c => {
    const links = c.preset.grain === 'links';
    return `<button class="coll" data-act="collection" data-id="${esc(c.id)}"><span class="ic-wrap">${icon(c.icon, 18)}</span>
        <span class="ct"><b>${esc(c.title)}</b><span>${esc(c.blurb)}</span></span>
        <span class="n num">${fmtN(links ? c.count.links : c.count.entries)}<small>${links ? 'links' : 'entries'}</small></span></button>`;
  }).join('')}</div></section>`;
}

/* ------------------------------------------------------------ the daily shelf */
/** A small seeded generator, so everyone sees the same picks on the same day. */
function seeded(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

/** Entries that read like games, with box art, from different platforms; the same set for the whole UTC day. */
function dailyPicks(n = 6, day = new Date().toISOString().slice(0, 10)) {
  const D = App.D, E = D.E, dims = D.dims;
  if (App._picks && App._picks.day === day && App._picks.n === n) return App._picks.ids;
  const skip = dims.flags.reduce((m, f, b) => (['dlc', 'addon', 'update', 'theme', 'bios', 'baddump', 'moji', 'padded', 'empty', 'pirate', 'aftermarket', 'demo', 'trial', 'sample'].includes(f.id) ? m | (1 << b) : m), 0);
  const pool = new Map();
  for (let i = 0; i < E.n; i++) {
    if (!E.artk[i] || (E.flags[i] & skip) || !(E.nsrc[i] >= 2 || E.ran[i] >= 25)) continue;
    const p = E.platform[i];
    (pool.get(p) || pool.set(p, []).get(p)).push(i);
  }
  const rng = seeded(day), plats = [...pool.keys()].filter(p => pool.get(p).length >= 40).sort((a, b) => a - b);
  for (let k = plats.length - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); [plats[k], plats[j]] = [plats[j], plats[k]]; }
  const ids = plats.slice(0, n).map(p => {
    const list = pool.get(p);
    const score = c => E.ran[c] + 20 * (E.nsrc[c] - 1);          // achievements and extra sources are the best hint of a well-known game
    let best = list[Math.floor(rng() * list.length)];
    for (let t = 0; t < 11; t++) { const c = list[Math.floor(rng() * list.length)]; if (score(c) > score(best)) best = c; }
    return best;
  });
  App._picks = { day, n, ids };
  return ids;
}

function picksHTML() {
  const D = App.D;
  if (!D.detailReady || !(D.caps.art || window.ROMGI.art)) return '';       // the cards need titles; covers need somewhere to come from
  const ids = dailyPicks();
  if (!ids.length) return '';
  return `<section class="s12 shelf" aria-labelledby="picks-h"><div class="shelf-h"><div><h3 id="picks-h">Today's picks</h3><p>${ids.length} covers, one per platform. New every day.</p></div></div>
    <div class="gal picks">${ids.map(i => galCardHTML(i)).join('')}</div></section>`;
}

Object.assign(App.handlers, {
  collection(el) {
    const c = (App._colls || []).find(x => x.id === el.dataset.id);
    if (!c) return;
    const b = App.ui.browse;
    if (c.gallery) { b.mode = 'gallery'; b.galSort = c.gallery; b.artOnly = true; App._galN = 0; }
    else if (b.mode === 'gallery') b.mode = 'table';
    App.saveUI();
    App.S.applyPreset(c.preset);
    App.show('browse');
  },
});
