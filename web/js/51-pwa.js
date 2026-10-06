/* ============================================================ the installed app: a copy that works offline, newer versions, install */

/*
 * Only the hosted site has a service worker (sw.js, written by bundle.py). It keeps the page and the catalogue in the browser, so the app
 * opens without a connection. The page registers it once its own downloads are done, so the two never fetch the same files at once.
 * A newer build installs in the background and waits; the page says so and swaps only when asked, so nothing changes under someone who is
 * reading. The slice and the open card are in the address (50-url.js) and the view is saved, so the reload comes back to the same place.
 */
const Pwa = {
  state: 'off',              // off | saving | ready | unsupported
  reg: null, hadController: false, reloading: false, dismissed: false, lastCheck: 0, deferred: null,

  get supported() { return window.ROMGI.mode !== 'local' && !!window.ROMGI.data && 'serviceWorker' in navigator && window.isSecureContext; },
  get standalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
  get ios() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },

  /** The page is up: show the connection, and register the worker when the titles and covers (the page's own downloads) have arrived. */
  init() {
    if (!this.supported) return;                  // the local explorer and the single-file builds have nothing saved to fall back on
    this.paintNet();
    addEventListener('online', () => this.netChanged());
    addEventListener('offline', () => this.netChanged());
    this.hadController = !!navigator.serviceWorker.controller;
    if (this.hadController) this.state = 'ready';
    const t0 = performance.now();
    const wait = () => { if ((App.D.detailReady && App.artState !== 'loading') || performance.now() - t0 > 20000) this.register(); else setTimeout(wait, 400); };
    wait();
  },

  async register() {
    try {
      const reg = this.reg = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });   // always ask the network whether sw.js changed
      navigator.serviceWorker.addEventListener('controllerchange', () => this.tookOver());
      reg.addEventListener('updatefound', () => this.track(reg.installing));
      this.track(reg.installing);
      if (reg.waiting && navigator.serviceWorker.controller) this.offer(reg.waiting);
      this.lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => {        // the worker checks at every start; an app left open for days checks again when it is shown
        if (document.visibilityState === 'visible' && Date.now() - this.lastCheck > 30 * 60e3) { this.lastCheck = Date.now(); reg.update().catch(() => {}); }
      });
    } catch (e) { this.state = 'unsupported'; console.warn('The offline copy is unavailable:', e.message); }
    this.paintHelp();
  },

  /** Follow a worker that is installing: the first one means the app is saved; a later one is a newer build, waiting for a go-ahead. */
  track(worker) {
    if (!worker) return;
    if (!navigator.serviceWorker.controller && this.state !== 'ready') this.state = 'saving';
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) this.offer(worker);
      else if (worker.state === 'activated' && !this.hadController) this.saved();
      else if (worker.state === 'redundant' && this.state === 'saving') this.state = 'off';          // the install failed; the next visit tries again
      this.paintHelp();
    });
  },
  saved() {
    this.state = 'ready'; this.paintHelp();
    if (!store.get('offline-told', false)) { store.set('offline-told', true); toast('Saved in this browser: the explorer now opens without a connection.'); }
  },
  /** The worker in charge changed. The first time that is just the first worker taking over; later it is a newer build starting. */
  tookOver() {
    if (!this.hadController) { this.hadController = true; return this.saved(); }
    if (this.reloading) return location.reload();
    this.say('This page was updated in another tab.');             // its files are gone from the saved copy; a reload brings the new ones
  },

  /** Ask a waiting worker which catalogue it brings, and tell the visitor a newer build is ready. */
  async offer(worker) {
    let info = null;
    try { info = await new Promise((resolve, reject) => { const ch = new MessageChannel(); ch.port1.onmessage = e => resolve(e.data); setTimeout(() => reject(new Error('no answer')), 3000); worker.postMessage({ type: 'info' }, [ch.port2]); }); }
    catch { /* the bar still says a new version is ready */ }
    const day = s => (s || '').slice(0, 10);
    this.say(info && info.generated_at && day(info.generated_at) !== day(App.D.meta.generated_at) ? `A newer catalogue (${day(info.generated_at)}) is ready.` : 'A new version of the explorer is ready.');
  },
  say(text) {
    const bar = $('#pwa-bar');
    if (!bar || this.dismissed) return;
    bar.innerHTML = `<span>${esc(text)}</span><button class="btn sm primary" data-act="pwa-reload">Reload</button><button class="btn sm ghost icon" data-act="pwa-later" aria-label="Not now">${icon('x', 14)}</button>`;
    bar.classList.add('on');
  },
  /** Let the waiting worker take over, then reload when it has; the page it brings reads the same address and the same saved view. */
  reload() {
    Url.sync(false); store.set('ui', App.ui);
    const waiting = this.reg && this.reg.waiting;
    if (!waiting) return location.reload();
    this.reloading = true;
    waiting.postMessage({ type: 'skip-waiting' });
    setTimeout(() => location.reload(), 3000);                     // if the hand-over never reports, reload anyway
  },

  /* ---------------------------------------------------------------- the connection and install */
  netChanged() {
    this.paintNet();
    toast(navigator.onLine ? 'Back online.' : 'You are offline. The catalogue saved in this browser is still here; covers need a connection.');
  },
  paintNet() {
    const el = $('#net');
    if (!el) return;
    el.hidden = navigator.onLine !== false;
    if (App.D) el.dataset.tip = `You are offline. This is the catalogue of ${(App.D.meta.generated_at || '').slice(0, 10)}, saved in this browser. Covers need a connection.`;
  },
  async install() {
    const ev = this.deferred;
    if (!ev) return;
    this.deferred = null;
    ev.prompt();
    try { await ev.userChoice; } catch { /* dismissed */ }
    this.paintHelp();
  },
  /** The part of the help dialog about offline use and installing. */
  helpHTML() {
    if (!this.supported || this.state === 'unsupported') return '';
    const day = (App.D.meta.generated_at || '').slice(0, 10);
    const status = this.state === 'ready' ? `This browser has saved the explorer and the catalogue of ${day}, so it opens without a connection. Covers need one.`
      : this.state === 'saving' ? 'Saving the explorer in this browser…' : 'The explorer has not been saved in this browser yet.';
    const act = this.standalone ? '' : this.deferred ? `<div style="margin-top:10px"><button class="btn" data-act="pwa-install">${icon('download', 14)}Install the app</button></div>`
      : this.ios ? '<p class="muted" style="margin:8px 0 0">To install it on an iPhone or iPad, tap Share, then Add to Home Screen.</p>'
      : '<p class="muted" style="margin:8px 0 0">Your browser\'s menu offers Install app or Add to Home Screen.</p>';
    return `<h3 style="margin:18px 0 0;font-size:14px">Offline and install</h3><p class="muted" style="margin:6px 0 0">${esc(status)}</p>${act}`;
  },
  paintHelp() { if ($('#modal')?.classList.contains('on') && $('#modal [data-modal="help"]')) App.help(); },
};
// the browser offers installing once; keep the offer for the help dialog's button
addEventListener('beforeinstallprompt', e => { e.preventDefault(); Pwa.deferred = e; Pwa.paintHelp(); });
addEventListener('appinstalled', () => { Pwa.deferred = null; toast('Installed.'); Pwa.paintHelp(); });
Object.assign(App.handlers, {
  'pwa-reload'() { Pwa.reload(); },
  'pwa-later'() { Pwa.dismissed = true; $('#pwa-bar').classList.remove('on'); },
  'pwa-install'() { Pwa.install(); },
});
