'use strict';
/* ============================================================ util */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const NF = new Intl.NumberFormat('en-US');
const fmtN = n => NF.format(Math.round(n));
const compact = n => {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return Math.round(n / 1e3) + 'K';
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n * 10) / 10);
};
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
const popcount = m => { let n = 0; while (m) { n += m & 1; m >>= 1; } return n; };
const fmtBytes = (n, d = 1) => {
  if (!n) return '0 B';
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++; }
  return (i === 0 ? String(Math.round(n)) : n.toFixed(n >= 100 ? 0 : d)) + ' ' + UNITS[i];
};
const pct = (a, b, d = 1) => (b ? ((100 * a) / b).toFixed(d) + '%' : '0%');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const raf = fn => requestAnimationFrame(fn);
const asciiLower = s => s.replace(/[A-Z]+/g, m => m.toLowerCase());
const plural = (n, one, many) => `${fmtN(n)} ${n === 1 ? one : many || one + 's'}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Let the browser paint and answer input before the next slice of work. */
const yieldToMain = () => (typeof scheduler !== 'undefined' && scheduler.yield ? scheduler.yield() : new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); }));
/** Run a generator that yields between slices of work; returns what it returns. */
async function runSliced(gen) { for (;;) { const r = gen.next(); if (r.done) return r.value; await yieldToMain(); } }

const store = {
  get(k, d) { try { const v = localStorage.getItem('romgi.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('romgi.' + k, JSON.stringify(v)); } catch { /* storage can be blocked */ } },
};

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const html = s => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content; };

/* ------------------------------------------------------------ icons (24px grid, stroke) */
const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  'chev-d': '<path d="m6 9 6 6 6-6"/>',
  'chev-r': '<path d="m9 6 6 6-6 6"/>',
  'chev-l': '<path d="m15 6-6 6 6 6"/>',
  'chev-u': '<path d="m6 15 6-6 6 6"/>',
  dice: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.15" fill="currentColor" stroke="none"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M9.5 5v14"/>',
  rows: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  ext: '<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  db: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  alert: '<path d="M12 4 3 19.5h18L12 4z"/><path d="M12 10v4.5M12 17v.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
  'check-c': '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>',
  'x-c': '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  play: '<path d="M8 5.5v13l11-6.5-11-6.5z"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5z"/>',
  sliders: '<path d="M5 7h9M18 7h1M5 17h1M10 17h9"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12"/>',
  term: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="m7.5 10 3 2.5-3 2.5M12.5 15h4"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.7 9.5a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.8M12 16.5v.01"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4h4M12 8v4.5l3 1.8"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 3.5 3 2.5-2L20 17"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4"/>',
  disc: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  up: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
  down: '<path d="M12 5v14M6.5 13.5 12 19l5.5-5.5"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
  box: '<path d="M12 3 4 7v10l8 4 8-4V7l-8-4zM4 7l8 4 8-4M12 11v10"/>',
  swap: '<path d="M7 7h12M15 3l4 4-4 4M17 17H5M9 13l-4 4 4 4"/>',
  overview: '<rect x="4" y="4" width="7" height="9" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="13" y="11" width="7" height="9" rx="1.5"/><rect x="4" y="15" width="7" height="5" rx="1.5"/>',
  tree: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 3.5v17M12 11h8.5M3.5 14h8.5"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6l-7-2.5z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  tag: '<path d="M4 4h8l8 8-8 8-8-8V4z"/><circle cx="8.5" cy="8.5" r="1.2"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3M4.5 19v-4.5H9"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
};
const icon = (n, s = 16) => `<svg class="ic" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ------------------------------------------------------------ tooltip (event delegation; content from a registry) */
const Tip = {
  el: null, reg: [], raf: 0,
  init() {
    this.el = $('#tip');
    document.addEventListener('pointermove', e => { if (e.pointerType === 'touch') return; this.update(e.target, e.clientX, e.clientY); });
    document.addEventListener('pointerleave', () => this.hide(), true);
    document.addEventListener('focusin', e => {
      const t = e.target.closest?.('[data-tip],[data-tk]');
      if (t && e.target.matches(':focus-visible')) { const r = t.getBoundingClientRect(); this.update(t, r.left + r.width / 2, r.bottom); }
    });
    document.addEventListener('focusout', () => this.hide());
    document.addEventListener('scroll', () => this.hide(), true);
  },
  reset() { this.reg = []; },
  /** Register a function that returns a node (or string) and get back the attribute value for data-tk. */
  tk(fn) { this.reg.push(fn); return this.reg.length - 1; },
  update(target, x, y) {
    const t = target.closest?.('[data-tip],[data-tk]');
    if (!t) return this.hide();
    let node;
    if (t.dataset.tk != null) { const fn = this.reg[+t.dataset.tk]; node = fn && fn(); }
    else node = t.dataset.tip;
    if (!node) return this.hide();
    if (this.el._for !== t || this.el._tk !== t.dataset.tk) { this.el.replaceChildren(typeof node === 'string' ? document.createTextNode(node) : node); this.el._for = t; }
    this.el.classList.add('on'); this.el.setAttribute('aria-hidden', 'false');
    cancelAnimationFrame(this.raf);
    this.raf = raf(() => this.place(x, y));
  },
  place(x, y) {
    const r = this.el.getBoundingClientRect();
    let nx = x + 14, ny = y + 18;
    if (nx + r.width > innerWidth - 8) nx = Math.max(8, x - r.width - 14);
    if (ny + r.height > innerHeight - 8) ny = Math.max(8, y - r.height - 14);
    this.el.style.left = nx + 'px'; this.el.style.top = ny + 'px';
  },
  hide() { this.el?.classList.remove('on'); if (this.el) { this.el._for = null; this.el.setAttribute('aria-hidden', 'true'); } },
};
/** A tooltip body: title, rows of [key, value, colour?], footer. Everything goes through textContent. */
function tipBox(title, rows = [], foot) {
  const box = h('div', null);
  if (title) box.append(h('div', { class: 'tt', text: title }));
  for (const [k, v, c] of rows) box.append(h('div', { class: 'tr' }, c ? h('span', { class: 'sd', style: { '--c': c } }) : null, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v })));
  if (foot) box.append(h('div', { class: 'tf', text: foot }));
  return box;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 1900);
}
async function copyText(text, note = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(note); return true; }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0, left: '-999px' } }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); toast(ok ? note : 'Select the text and copy it with Cmd/Ctrl+C'); return ok;
  }
}
function downloadText(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------------------------------------ SQL highlighting */
const SQL_KW = new Set(('SELECT FROM WHERE AND OR NOT IN EXISTS JOIN LEFT INNER OUTER ON GROUP BY ORDER HAVING LIMIT OFFSET AS COUNT SUM AVG MIN MAX DISTINCT LIKE ESCAPE BETWEEN IS NULL CASE WHEN THEN ELSE END UNION ALL WITH COLLATE NOCASE DESC ASC COALESCE LOWER UPPER INSTR SUBSTR GROUP_CONCAT GLOB MATCH PRAGMA CAST INTEGER TEXT').split(' '));
function hiSQL(src) {
  const re = /(--[^\n]*)|('(?:[^']|'')*')|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += `<span class="cm">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="st">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="nm">${esc(m[3])}</span>`;
    else out += SQL_KW.has(m[4].toUpperCase()) ? `<span class="kw">${esc(m[4])}</span>` : esc(m[4]);
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}
const sq = s => "'" + String(s).replace(/'/g, "''") + "'";

/* ------------------------------------------------------------ colour ramps read from the theme tokens */
const Color = {
  _seq: null, _div: null, _src: null,
  reset() { this._seq = this._div = this._src = null; },
  css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); },
  rgb(hex) { hex = hex.replace('#', ''); if (hex.length === 3) hex = [...hex].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)); },
  mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); },
  str(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; },
  lum(c) { const f = c.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]; },
  seqStops() { return this._seq || (this._seq = [0, 1, 2, 3, 4, 5, 6].map(i => this.rgb(this.css('--seq-' + i)))); },
  /** t in [0,1] -> {bg, fg} on the one-hue sequential ramp (low = near the surface). */
  seq(t) {
    const s = this.seqStops(), x = clamp(t, 0, 1) * (s.length - 1), i = Math.min(s.length - 2, Math.floor(x));
    const c = this.mix(s[i], s[i + 1], x - i);
    return { bg: this.str(c), fg: this.lum(c) > 0.32 ? '#0b0f17' : '#ffffff' };
  },
  /** t in [-1,1] -> blue (under) .. neutral .. red (over). */
  div(t) {
    const lo = this.rgb(this.css('--div-lo')), mid = this.rgb(this.css('--div-mid')), hi = this.rgb(this.css('--div-hi'));
    const c = t < 0 ? this.mix(mid, lo, clamp(-t, 0, 1)) : this.mix(mid, hi, clamp(t, 0, 1));
    return { bg: this.str(c), fg: this.lum(c) > 0.32 ? '#0b0f17' : '#ffffff' };
  },
};

/* ------------------------------------------------------------ theme */
const Theme = {
  get() { return store.get('theme', 'system'); },
  effective() {
    const t = this.get();
    if (t !== 'system') return t;
    const host = document.documentElement.getAttribute('data-theme');       // a host page may have set it for us
    return host === 'light' || host === 'dark' ? host : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  },
  apply() { const t = this.get(); if (t !== 'system') document.documentElement.setAttribute('data-theme', t); Color.reset(); },
  toggle() { store.set('theme', this.effective() === 'dark' ? 'light' : 'dark'); this.apply(); },
  /** The browser's own bars (an installed app's title bar, a phone's address bar) take the page's background. */
  paintMeta() { const m = $('meta[name="theme-color"]'), c = Color.css('--bg'); if (m && c) m.content = c; },
};
