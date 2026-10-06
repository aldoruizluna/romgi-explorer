#!/usr/bin/env node
/*
 * The Spanish dictionary: every message the page can show has a translation, each translation keeps what the English has, and nothing in
 * the dictionary is unused.
 *
 *   node tests/i18n.test.js [<dataset.json.gz>] [--missing]
 *
 * The messages are found in the page's source: the first argument of __(), __h() and N_() and the second of __n(), when it is a plain
 * string. Calls whose argument is a variable (a label read from a table) are listed and must be on the allow-list below, because the table
 * they read from marks its own messages with N_(). The text the dataset builder writes in English and the page translates when it is
 * prepared or shown (flag and size-class labels, region and link-type names, the SQL examples) is read from the dataset. A translation
 * must have the same {names} as its English, the same forms for a plural, and the same tags for a message with markup; it must differ from
 * the English unless the word is a name or a term the Spanish uses as it is. --missing prints what is not translated yet, one per line.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');

const root = path.join(__dirname, '..');
const dsPath = process.argv.slice(2).find(a => !a.startsWith('--'));
const listMissing = process.argv.includes('--missing');
const problems = [];
const fail = msg => problems.push(msg);

// ---- the messages in the source
const jsDir = path.join(root, 'web', 'js');
const keys = new Map();                       // message -> { kind, where }
const dynamic = [];
const unescape = lit => { try { return new Function('return ' + lit)(); } catch { return null; } };

/** Parse a string literal starting at src[i] (a quote). Returns { text, end } or null if it is not a plain literal. */
function literalAt(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let j = i + 1;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (q === '`' && c === '$' && src[j + 1] === '{') return { bad: true };
    if (c === q) break;
    if (c === '\n' && q !== '`') return null;
  }
  const text = unescape(src.slice(i, j + 1));
  return text == null ? null : { text, end: j + 1 };
}
/** Skip the first argument of a call (up to its top-level comma), returning the index just after the comma and any spaces. */
function skipArg(src, i) {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') { const l = literalAt(src, i); if (!l || l.bad) return -1; i = l.end - 1; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (!depth) return -1; depth--; }
    else if (c === ',' && !depth) { i++; while (/\s/.test(src[i])) i++; return i; }
  }
  return -1;
}
for (const f of fs.readdirSync(jsDir).filter(x => x.endsWith('.js')).sort()) {
  let src = fs.readFileSync(path.join(jsDir, f), 'utf8');
  if (f === '01-i18n.js') src = src.slice(src.indexOf('const LOCALES'));                    // its header explains the calls with examples
  const re = /(?<![\w$.])(__h|__n|__|N_)\(/g;
  let m;
  while ((m = re.exec(src))) {
    const kind = m[1], line = src.slice(0, m.index).split('\n').length;
    let i = m.index + m[0].length;
    if (kind === '__n') { i = skipArg(src, i); if (i < 0) { fail(`${f}:${line}: cannot read the first argument of __n`); continue; } }
    const lit = literalAt(src, i);
    if (!lit) { dynamic.push({ f, line, kind, expr: `${kind}(${src.slice(i, src.indexOf(')', i) + 1)}`.slice(0, 70) }); continue; }
    if (lit.bad) { fail(`${f}:${line}: a message must not have \${} in it; use {name}: ${src.slice(i, i + 60)}`); continue; }
    if (!keys.has(lit.text)) keys.set(lit.text, { kind, where: `${f}:${line}` });
    else if (kind === '__h' && keys.get(lit.text).kind !== '__h') keys.get(lit.text).kind = '__h';
  }
}
// the page's own markup: an element marked data-t names the attributes (or "text") that are translated by their English
{
  const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8'), re = /<([a-z0-9]+)\b([^>]*\bdata-t="([^"]+)"[^>]*)>([^<]*)/g;
  let m;
  while ((m = re.exec(html))) {
    for (const what of m[3].split(' ')) {
      const text = what === 'text' ? m[4].trim() : (new RegExp(`\\b${what}="([^"]*)"`).exec(m[2]) || [])[1];
      if (!text) fail(`web/index.html: <${m[1]}> is marked data-t="${what}" but has nothing there`);
      else if (!keys.has(text)) keys.set(text, { kind: '__', where: `web/index.html <${m[1]}>` });
    }
  }
}
// calls whose argument is a variable: each reads a table whose messages are marked N_() or come from the dataset
const DYNAMIC_OK = [/^__\(g\.label\)/, /^__\(t\.label\)/, /^__\(c\.label\)/, /^__\(c\.title\)/, /^__\(c\.blurb\)/, /^__\(x\.label\)/, /^__\(l\)/, /^__\(q\.label\)/, /^__\(m\.label\)/,
  /^__\(SEV\[s\]\.label\)/, /^__\(e\.title\)/, /^__\(e\.note\)/, /^__\(x\.kind\)/, /^__\(h\.status\)/, /^__\(k\)/, /^__\(b\.note\)/, /^__\(NL_NAMES\[v\]\)/, /^__\(RA_NAMES\[v\]\)/,
  /^__\(ART_NAMES\[v\]\)/, /^__\(Live\.phase\)/, /^__\(f\.label\)/, /^__\(s\.label\)/, /^__\(s\.hint\)/, /^__\(r\.name\)/, /^__\(x\)/, /^__\(el\.textContent/, /^__\(el\.getAttribute/,
  /^__\(known/, /^__\(msg/, /^__\(SEV/, /^__\(QUALITY/, /^__\(what\)/, /^__\(\)/];
for (const d of dynamic) if (!DYNAMIC_OK.some(r => r.test(d.expr))) fail(`${d.f}:${d.line}: ${d.expr} reads a message from a variable that this test does not know; mark its table with N_() and allow it here`);

// ---- messages the dataset builder writes
let fromData = new Map();
if (dsPath) {
  const ds = JSON.parse(zlib.gunzipSync(fs.readFileSync(dsPath)).toString('utf8'));
  const add = (text, where) => { if (text && !fromData.has(text)) fromData.set(text, where); };
  for (const f of ds.dims.flags) add(f.label, 'dims.flags');
  for (const s of ds.dims.sizes) { add(s.label, 'dims.sizes'); add(s.hint, 'dims.sizes'); }
  for (const r of ds.dims.regions) add(r.name, 'dims.regions');
  for (const t of ds.dims.types) add(t, 'dims.types');
  for (const e of ds.examples) { add(e.title, 'examples'); add(e.note, 'examples'); }
  for (const s of ds.storage) add(s.kind, 'storage');
  for (const q of ds.quality) {
    if (!/^[a-z]+$/.test(q.id)) fail(`quality check ${q.id}: odd id`);
    if (q.vars && q.vars.checked) for (const [name] of q.vars.checked) add(name, 'quality.fk');
  }
  // every check has its words in the page
  const text = fs.readFileSync(path.join(jsDir, '46-quality.js'), 'utf8');
  for (const q of ds.quality) if (!new RegExp(`^  ${q.id}: \\{ title:`, 'm').test(text)) fail(`quality check "${q.id}" has no text in web/js/46-quality.js`);
}
const all = new Map([...fromData].map(([k, w]) => [k, { kind: '__', where: w }]));
for (const [k, v] of keys) all.set(k, v);
// words the boot script and the loader write themselves are not in the dictionary

// ---- the dictionary
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'web', 'lang', 'es.js'), 'utf8'), { window: win });
const es = (win.ROMGI_LANGS || {}).es || {};

const names = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const tags = s => [...s.matchAll(/<\/?([a-z0-9]+)/gi)].map(m => m[1].toLowerCase()).sort().join(',');
// terms a Spanish speaker uses as they are: a name, a file format, or a word the Spanish borrows
const SAME_OK = new Set(['Total', 'Aftermarket', 'Xbox Live', 'Nintendo digital']);
const ENGLISH = /(?<!\p{L})(the|and|with|from|that|this|your|for|are|is|of the|in the|not|you|can)(?!\p{L})/u;      // \b would see a letter with an accent as a word edge
let translated = 0, missing = [];
for (const [k, v] of all) {
  const t = es[k];
  if (t == null) { missing.push(k); continue; }
  translated++;
  if (typeof t !== 'string' || !t.trim()) { fail(`"${k}": the translation is empty`); continue; }
  if (names(k) !== names(t)) fail(`"${k}": the translation has {${names(t)}}, the English has {${names(k)}}`);
  if (k.split('|').length !== t.split('|').length) fail(`"${k}": the translation has ${t.split('|').length} form(s), the English has ${k.split('|').length}`);
  if (v.kind === '__h' ? tags(k) !== tags(t) : /[<>]/.test(t) || /<|>/.test(k)) fail(`"${k}": the markup differs (${v.kind === '__h' ? tags(k) + ' vs ' + tags(t) : 'a plain message must not hold < or >'})`);
  if (k !== k.trim() && k.length - k.trimStart().length !== t.length - t.trimStart().length) fail(`"${k}": leading spaces differ`);
  if (k.trim() !== k && t.length - t.trimEnd().length !== k.length - k.trimEnd().length) fail(`"${k}": trailing spaces differ`);
  if (t === k && !SAME_OK.has(k) && /[a-z]{3}/i.test(k) && !/^[\x00-\x7f]{0,6}$/.test(k)) fail(`"${k}": not translated (same as the English; add it to SAME_OK in this test if Spanish uses it as it is)`);
  if (t !== k && ENGLISH.test(t.replace(/\{\w+\}/g, '').toLowerCase())) fail(`"${k}": the translation looks English: ${t}`);
}
const used = new Set([...all.keys()]);
for (const k of Object.keys(es)) if (!used.has(k)) fail(`"${k}": in the dictionary but never used by the page`);
if (listMissing) { for (const k of missing) console.log(JSON.stringify(k)); process.exit(0); }
for (const k of missing) fail(`not translated: ${JSON.stringify(k)}   (${all.get(k).where})`);

if (problems.length) { console.error(problems.slice(0, 60).join('\n') + (problems.length > 60 ? `\n... and ${problems.length - 60} more` : '')); console.error(`\n${problems.length} problem(s)`); process.exit(1); }
console.log(`ok   ${translated.toLocaleString()} messages (${keys.size} in the source, ${fromData.size} from the dataset), each translated with the same {names}, forms and markup, none unused`);
console.log('ALL PASS');
