/* Optional reference facts. The publisher binds them to the exact catalogue
 * and artwork order; a missing, stale or malformed overlay never adds facts. */
const REFERENCE_GENRES = [N_('Action'), N_('Adventure'), N_('Platform'), N_('Role-playing'), N_('Strategy'), N_('Simulation'), N_('Racing'), N_('Sports'),
  N_('Fighting'), N_("Beat 'em up"), N_('Shooter'), N_("Shoot 'em up"), N_('Puzzle'), N_('Board and card'), N_('Gambling'), N_('Quiz'), N_('Music and rhythm'),
  N_('Party and mini games'), N_('Educational'), N_('Pinball'), N_('Hunting and fishing'), N_('Survival horror'), N_('Interactive fiction'), N_('Compilation'), N_('Other')];
function attachReference(D, meta, expectedKey) {
  if (!meta || meta.v !== 1 || meta.n !== D.E.n || !/^[a-f0-9]{64}$/.test(expectedKey || '') || meta.catalogue_key !== expectedKey) throw new Error('reference catalogue mismatch');
  const source = meta.source, dims = meta.dims, cols = meta.cols;
  if (!source || source.name !== 'libretro-database' || source.url !== 'https://github.com/libretro/libretro-database'
      || source.license !== 'CC BY-SA 4.0' || source.license_url !== 'https://creativecommons.org/licenses/by-sa/4.0/'
      || !/^[a-f0-9]{40}$/.test(source.commit || '')) throw new Error('unsupported reference provenance');
  if (!dims || !cols || !['genre', 'dev', 'pub'].every(key => Array.isArray(dims[key]) && dims[key].every(value => typeof value === 'string'))
      || JSON.stringify(dims.genre) !== JSON.stringify(REFERENCE_GENRES)) throw new Error('invalid reference vocabulary');
  const limits = { genre: Math.pow(2, dims.genre.length) - 1, year: 2100, month: 12, dev: dims.dev.length, pub: dims.pub.length, players: 16 };
  if (Object.keys(cols).length !== Object.keys(limits).length) throw new Error('unsupported reference columns');
  for (const [key, limit] of Object.entries(limits)) {
    if (!Array.isArray(cols[key]) || cols[key].length !== meta.n || cols[key].some(value => !Number.isInteger(value) || value < 0 || value > limit)) throw new Error('invalid reference column');
  }
  if (cols.year.some(year => year && year < 1950) || cols.month.some((month, i) => month && !cols.year[i])) throw new Error('invalid reference date');
  D.reference = meta;
}

async function loadReference() {
  const url = window.ROMGI.reference, D = App.D;
  if (!url || !D) return;
  App.referenceState = 'loading';
  try {
    const meta = await readNdjson(url, 0, () => {}, { signal: AbortSignal.timeout(15_000) });
    attachReference(D, meta, window.ROMGI.referenceKey);
    App.referenceState = 'ready';
  } catch (error) {
    App.referenceState = 'failed';
    console.warn('Reference metadata unavailable:', error.message);
  }
  if (App.sel != null) Drawer.render();
}

function referenceFacts(i) {
  if (!window.ROMGI.reference) return '';
  const meta = App.D.reference;
  const message = !meta ? (App.referenceState === 'failed' ? __('Reference metadata is unavailable.') : __('Loading reference metadata…'))
    : Object.values(meta.cols).every(column => column[i] === 0) ? __('No exact reference match.') : '';
  if (message) return `<section class="reference"><h3 class="sec-h">${__('Reference metadata')}</h3><p class="muted">${esc(message)}</p></section>`;
  const { cols, dims, source } = meta;
  const genres = dims.genre.filter((_genre, bit) => cols.genre[i] & (1 << bit)).map(x => __(x));
  const values = [[__('Genre'), genres.join(' / ')], [__('Release date'), cols.year[i] ? String(cols.year[i]) + (cols.month[i] ? '-' + String(cols.month[i]).padStart(2, '0') : '') : ''],
    [__('Developer'), dims.dev[cols.dev[i] - 1]], [__('Publisher'), dims.pub[cols.pub[i] - 1]], [__('Players'), cols.players[i] ? String(cols.players[i]) : '']];
  return `<section class="reference"><h3 class="sec-h">${__('Reference metadata')}</h3><dl class="facts">${values.filter(([_key, value]) => value).map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
    <p class="muted">${__h('Reference metadata: {source}, {license}. Matched by exact name or serial; unknown facts are omitted.', {
      source: raw(`<a href="${source.url}/tree/${source.commit}" target="_blank" rel="noopener noreferrer">libretro-database · ${source.commit.slice(0, 8)}</a>`),
      license: raw(`<a href="${source.license_url}" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>`),
    })}</p></section>`;
}
