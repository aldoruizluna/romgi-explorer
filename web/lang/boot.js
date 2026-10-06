/*
 * Runs before the page's own script, right after the loader's headline has been parsed. It settles the language, so the first words on
 * screen are already in it, and on the hosted site starts fetching the dictionary at once, in parallel with everything else.
 * The language is the saved choice (the switch in the top bar), else the first language of the browser's list the page has. The locale
 * is the browser's own for that language when it names one (Spain and Mexico write numbers differently), else the page's default.
 */
(function () {
  var LOCALES = { en: 'en-US', es: 'es-MX' }, code = '', locale = '';
  try { var saved = JSON.parse(localStorage.getItem('romgi.lang')); if (LOCALES[saved]) code = saved; } catch (e) { /* storage can be blocked */ }
  var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
  for (var i = 0; i < langs.length; i++) {
    var base = String(langs[i]).toLowerCase().split('-')[0];
    if (!code && LOCALES[base]) code = base;
    if (code && base === code && !locale) { try { new Intl.NumberFormat(langs[i]); locale = langs[i]; } catch (e) { /* not a usable language tag */ } }
  }
  code = code || 'en'; locale = locale || LOCALES[code];
  document.documentElement.lang = code;
  var state = window.ROMGI_LANG = { code: code, locale: locale, ready: null };
  if (code === 'es') {
    var hero = document.querySelector('.lhero'), phase = document.querySelector('#loader .phase');
    if (phase) phase.textContent = 'Iniciando';
    if (hero) {                                                    // the headline numbers, in Spanish and in the visitor's number format
      var d = hero.dataset, nf = new Intl.NumberFormat(locale), n = function (k) { return nf.format(+d[k]); };
      var many = function (k, one, other) { return n(k) + ' ' + (+d[k] === 1 ? one : other); };
      hero.querySelector('.lh-big').textContent = n('entries');
      hero.querySelector('.lh-cap').textContent = 'lanzamientos en ' + many('platforms', 'plataforma', 'plataformas') + ', ofrecidos mediante '
        + many('links', 'enlace', 'enlaces') + ' de ' + many('sources', 'fuente', 'fuentes');
      hero.querySelector('.lh-snap').textContent = 'instantánea ' + d.version;
    }
  }
  var url = '/*@LANGURL@*/';                                       // set on the hosted site, where the dictionary is its own file
  if (code !== 'en' && url) {
    state.ready = new Promise(function (done) {
      var s = document.createElement('script');
      s.src = url; s.onload = s.onerror = function () { done(); };
      document.head.appendChild(s);
    });
  }
})();
