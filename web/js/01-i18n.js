/* ============================================================ language: English and Spanish */

/*
 * Every message is written in English where it is used and passed through one of these:
 *   __('Clear all filters')                      plain text
 *   __('{shown} of {total}', { shown, total })   {name} is filled in when it runs; a number is written the way the visitor's locale writes it
 *   __h('<b>{name}</b> is ready', { name })      a message that holds markup; the values are escaped unless wrapped in raw()
 *   __n(count, '{n} entry|{n} entries')          the form for one, then the form for any other count ({n} is the count)
 *   N_('Overview')                               marks an English message in a table, to be translated when it is shown
 * A language is a dictionary from the English message to its translation (web/lang/es.js). A message with no entry shows in English, so a
 * missing translation is a gap, never a failure. tests/i18n.test.js keeps the dictionary complete. Anything built when the script loads
 * keeps the English and is translated where it is drawn, because the dictionary may arrive a moment later than the script.
 * The language is chosen once per page, by the small script at the top of the page (web/lang/boot.js): the saved choice, else the
 * browser's languages. Changing it reloads the page, which comes back to the same place (the slice is in the address, the view is saved).
 */
const LOCALES = { en: 'en-US', es: 'es-MX' };            // the locale numbers are written in when the browser names none for that language
const N_ = s => s;
const raw = html => ({ raw: String(html) });
const fmtVar = v => (typeof v === 'number' ? fmtN(v) : String(v));
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? fmtVar(vars[k]) : m)) : s);
const known = (dict, msg) => !!dict && Object.prototype.hasOwnProperty.call(dict, msg);
const __ = (msg, vars) => fill(known(Lang.dict, msg) ? Lang.dict[msg] : msg, vars);
const __h = (msg, vars) => {
  const s = known(Lang.dict, msg) ? Lang.dict[msg] : msg;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in (vars || {}) ? (vars[k] && vars[k].raw !== undefined ? vars[k].raw : esc(fmtVar(vars[k]))) : m));
};
const __n = (n, msg, vars) => {
  const forms = (known(Lang.dict, msg) ? Lang.dict[msg] : msg).split('|');
  return fill(forms[forms.length > 1 && Lang.rules.select(n) !== 'one' ? 1 : 0], { n, ...vars });
};

const Lang = {
  code: 'en', locale: 'en-US', dict: null, rules: new Intl.PluralRules('en-US'),

  /** Use a language: its dictionary, if the page has one, and its way of writing numbers and counts. */
  use(code, locale) {
    this.code = LOCALES[code] ? code : 'en';
    this.locale = locale || LOCALES[this.code];
    try { NF = new Intl.NumberFormat(this.locale); this.rules = new Intl.PluralRules(this.locale); }
    catch { this.locale = LOCALES[this.code]; NF = new Intl.NumberFormat(this.locale); this.rules = new Intl.PluralRules(this.locale); }
    FD = {}; CF = null; PF = {};
    this.dict = (window.ROMGI_LANGS || {})[this.code] || null;
    if (typeof document !== 'undefined') document.documentElement.lang = this.code;
  },
  /** Translate what the page's own markup says: the elements marked data-t (attribute names, or "text") are looked up by their English. */
  apply(root) {
    if (!this.dict) return;
    for (const el of root.querySelectorAll('[data-t]')) for (const what of el.dataset.t.split(' ')) {
      if (what === 'text') el.textContent = __(el.textContent.trim());
      else if (el.hasAttribute(what)) el.setAttribute(what, __(el.getAttribute(what)));
    }
  },
  /** The other language the page offers, for the switch in the top bar. */
  get other() { return this.code === 'es' ? 'en' : 'es'; },
  set(code) {
    if (!LOCALES[code] || code === this.code) return;
    store.set('lang', code);
    Url.sync(false); store.set('ui', App.ui);
    location.reload();
  },
};
