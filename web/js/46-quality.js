/* ============================================================ quality: what is wrong, odd or fine in the data, each check inspectable */

const SEV = {
  critical: { label: 'Critical', icon: 'x-c', cls: 'critical', rank: 0 },
  serious: { label: 'Serious', icon: 'alert', cls: 'serious', rank: 1 },
  warn: { label: 'Worth a look', icon: 'alert', cls: 'warn', rank: 2 },
  info: { label: 'For context', icon: 'info', cls: 'info', rank: 3 },
  ok: { label: 'Fine', icon: 'check-c', cls: 'ok', rank: 4 },
};
const sevPill = s => `<span class="pill ${SEV[s].cls}">${icon(SEV[s].icon, 13)}${SEV[s].label}</span>`;

App.views.quality = {
  render(root) {
    const { D } = App, checks = [...D.raw.quality].sort((a, b) => SEV[a.sev].rank - SEV[b.sev].rank);
    const tally = {}; checks.forEach(c => { tally[c.sev] = (tally[c.sev] || 0) + 1; });
    const open = App.ui.qopen || [];
    const head = `<div class="card" style="margin-bottom:14px"><div class="card-h" style="margin-bottom:0"><div><h3>Data quality</h3>
      <p>${checks.length} checks run against the ${esc(D.meta.version)} snapshot. Each one is a SQL query you can run yourself, and most open the affected rows.</p></div></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">${['critical', 'serious', 'warn', 'info', 'ok'].filter(s => tally[s]).map(s => `<span class="pill ${SEV[s].cls}">${icon(SEV[s].icon, 13)}${tally[s]} ${SEV[s].label.toLowerCase()}</span>`).join('')}</div></div>`;
    const cards = checks.map(c => {
      const isOpen = open.includes(c.id);
      const meter = c.count != null && c.total ? `<div class="meter" style="min-width:140px"><div class="mt"><i style="width:${Math.max(1, (100 * c.count) / c.total).toFixed(1)}%;background:var(--${c.sev === 'ok' ? 'good' : c.sev === 'info' ? 'accent' : c.sev === 'warn' ? 'warn' : c.sev})"></i></div></div>` : '';
      let extra = '';
      if (c.id === 'dips' && c.evidence) {
        try { extra = `<div class="runs">${JSON.parse(c.evidence).map(r => `<div class="run"><b>${esc(r.start)}${r.end !== r.start ? ' to ' + esc(r.end) : ''}</b><span class="muted">${fmtN(r.min)} entries against ${fmtN(r.base)} before, ${(100 * (1 - r.min / r.base)).toFixed(0)}% fewer</span></div>`).join('')}</div>`; } catch { /* evidence is optional */ }
      }
      if (c.id === 'moji' && c.evidence) extra = `<div class="runs"><div class="run"><span class="muted">Example, as stored</span><span class="mono">${esc(c.evidence)}</span></div></div>`;
      const showRows = c.preset ? `<button class="btn sm primary" data-act="qshow" data-id="${esc(c.id)}">${icon('table', 13)}Show the rows</button>` : '';
      const go = c.action ? `<button class="btn sm" data-act="qgo" data-id="${esc(c.id)}">${icon('chev-r', 13)}${c.action.view === 'sources' ? 'See the history' : 'Open in Schema'}</button>` : '';
      return `<section class="card q ${c.sev}" data-q="${esc(c.id)}">
        <div class="q-top">${sevPill(c.sev)}<h3>${esc(c.title)}</h3>
          <span class="q-n num">${c.count != null && c.sev !== 'ok' ? `${fmtN(c.count)}${c.total ? `<span class="muted"> of ${fmtN(c.total)}</span>` : ''}` : ''}</span></div>
        <p class="q-s">${esc(c.summary)}</p>${extra}${meter}
        <div class="q-act">${showRows}${go}${c.sql ? `<button class="btn sm ghost" data-act="qsql" data-id="${esc(c.id)}" aria-expanded="${isOpen}">${icon('code', 13)}SQL</button>` : ''}</div>
        ${c.sql ? `<div class="codebox q-sql"${isOpen ? '' : ' hidden'}><pre>${hiSQL(c.sql)}</pre><div class="copy" style="display:flex;gap:6px"><button class="btn sm" data-act="copy" data-text="${esc(c.sql)}">${icon('copy', 13)}Copy</button>${D.caps.sql ? `<button class="btn sm primary" data-act="to-sql" data-sql="${esc(c.sql)}">${icon('term', 13)}Run</button>` : ''}</div></div>` : ''}
      </section>`;
    }).join('');
    root.innerHTML = head + `<div class="q-list">${cards}</div>`;
  },
};
Object.assign(App.handlers, {
  qshow(el) {
    const c = App.D.raw.quality.find(x => x.id === el.dataset.id);
    App.S.applyPreset(c.preset); $('#q').value = '';
    store.set('grain', App.S.state.grain);
    App.show('browse');
  },
  qgo(el) {
    const c = App.D.raw.quality.find(x => x.id === el.dataset.id);
    if (c.action.table) App.ui.schemaTable = c.action.table;
    App.saveUI(); App.show(c.action.view);
    if (c.action.anchor) setTimeout(() => $('#' + c.action.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  },
  qsql(el) {
    const id = el.dataset.id, sec = el.closest('.q'), box = $('.q-sql', sec), open = box.hidden;
    box.hidden = !open; el.setAttribute('aria-expanded', String(open));
    App.ui.qopen = open ? [...(App.ui.qopen || []), id] : (App.ui.qopen || []).filter(x => x !== id);
  },
});
