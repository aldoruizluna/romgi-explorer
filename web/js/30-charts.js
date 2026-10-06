/* ============================================================ charts: thin marks, 2px gaps, hairline grids, a table twin for every chart */

Tip.showAt = function (node, x, y) {
  this.el.replaceChildren(node); this.el._for = null; this.el.classList.add('on'); this.place(x, y);
};

/** A chart card. `twin` is the accessible table version of the same numbers; the Table button swaps to it. */
function chartCard({ id, cls = '', title, sub = '', acts = '', body, twin }) {
  const showTwin = App.ui.twin.includes(id);
  return `<section class="card ${cls}" data-card="${esc(id)}">
    <div class="card-h"><div><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
      <div class="acts">${acts}${twin ? `<button class="btn sm ghost" data-act="twin" data-id="${esc(id)}" aria-pressed="${showTwin}" data-tip="Show the same numbers as a table">${icon('table', 14)}<span>Table</span></button>` : ''}</div></div>
    <div class="viz"${showTwin ? ' hidden' : ''}>${body}</div>
    ${twin ? `<div class="twin"${showTwin ? '' : ' hidden'}>${twin}</div>` : ''}
  </section>`;
}
/** cols: [{label, right?}], rows: [[cell, ...]] where cells are plain strings. */
function twinHTML(cols, rows) {
  return `<div class="table-twin"><table><thead><tr>${cols.map(c => `<th class="${c.right ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td class="${cols[i].right ? 'r' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const legendHTML = items => `<div class="legend">${items.map(i => `<span><i class="sw" style="--c:${i.color}"></i>${esc(i.label)}</span>`).join('')}</div>`;

/** Horizontal bars for one series. items: [{v, label, value, color?, code?}] */
function hbarHTML(items, { facet, max, fmt = fmtN, selected, tipFor, labelDot, labelW, twoLine, static: isStatic = false } = {}) {
  max = max ?? Math.max(1, ...items.map(i => i.value));
  const anySel = selected && selected.size > 0;
  return `<div class="hb${twoLine ? ' two' : ''}">${items.map(i => {
    const sel = selected?.has(i.v);
    const tk = tipFor ? Tip.tk(() => tipFor(i)) : null;
    const ratio = (i.value / max).toFixed(4);
    const tag = isStatic ? 'div' : 'button';
    return `<${tag} class="hb-row${sel ? ' sel' : ''}${anySel ? ' dim-all' : ''}"${labelW && !twoLine ? ` style="grid-template-columns:minmax(70px,${labelW}) minmax(0,1fr)"` : ''}${isStatic ? '' : ` data-act="facet" data-f="${facet}" data-v="${i.v}"`}${tk != null ? ` data-tk="${tk}"` : ''}>
      <span class="lab">${labelDot ? labelDot(i) : ''}<span>${esc(i.label)}</span></span>
      <span class="track"><i class="bar" style="width:calc((100% - 74px) * ${ratio});${i.color ? `background:${i.color}` : ''}"></i><span class="val">${fmt(i.value)}</span></span></${tag}>`;
  }).join('')}</div>`;
}

/** Stacked horizontal bars. rows: [{v, label, parts:[n...]}], series: [{label,color}] (color is a CSS value). */
function stackedHTML(rows, series, { facet, mode = 'abs', fmt = fmtN, tipFor } = {}) {
  const max = Math.max(1, ...rows.map(r => r.parts.reduce((a, b) => a + b, 0)));
  return `<div class="sb">${rows.map(r => {
    const tot = r.parts.reduce((a, b) => a + b, 0);
    let last = -1; r.parts.forEach((p, k) => { if (p > 0) last = k; });
    const width = mode === 'pct' ? '100%' : `${((tot / max) * 100).toFixed(3)}%`;
    return `<div class="sb-row" role="group" aria-label="${esc(r.label)}">
      <span class="lab">${esc(r.label)}</span>
      <span class="bars"><span class="stack" style="width:calc((100% - 72px) * ${mode === 'pct' ? 1 : (tot / max).toFixed(4)})">${r.parts.map((p, k) => {
        if (!p) return '';
        const tk = Tip.tk(() => tipFor(r, k, p, tot));
        return `<button class="seg-b${k === last ? ' last' : ''}" style="flex:${p} 0 0;--c:${series[k].color}" data-act="facet2" data-f="${facet}" data-v="${r.v}" data-f2="${series[k].facet}" data-v2="${series[k].v}" data-tk="${tk}"><span>${mode === 'pct' ? ((100 * p) / tot).toFixed(0) + '%' : compact(p)}</span></button>`;
      }).join('')}</span><span class="tot">${mode === 'pct' ? '' : fmt(tot)}</span></span></div>`;
  }).join('')}</div>`;
}

/** Column chart for an ordered scale (size classes): colours come from the validated ordinal ramp. */
function colsHTML(items, { facet, selected, fmt = compact, tipFor } = {}) {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="cols">${items.map(i => {
    const hpx = i.value ? Math.max(3, Math.round((i.value / max) * 118)) : 2;
    const tk = Tip.tk(() => tipFor(i));
    return `<button class="col-slot${selected?.has(i.v) ? ' sel' : ''}" data-act="facet" data-f="${facet}" data-v="${i.v}" data-tk="${tk}">
      <span class="cv">${fmt(i.value)}</span><span class="cb" style="height:${hpx}px;--c:${i.color}"></span><span class="cl">${esc(i.label)}</span></button>`;
  }).join('')}</div>`;
}
function meterHTML(label, a, b, note = '') {
  const p = b ? (100 * a) / b : 0;
  return `<div class="meter"><div class="mh"><span>${esc(label)}</span><span><b class="num">${p.toFixed(p >= 10 ? 0 : 1)}%</b> <span class="muted num">${fmtN(a)} of ${fmtN(b)}</span></span></div>
    <div class="mt" role="img" aria-label="${esc(label)} ${p.toFixed(1)} percent"><i style="width:${p.toFixed(2)}%"></i></div>${note ? `<div class="muted" style="font-size:12px">${esc(note)}</div>` : ''}</div>`;
}

/** After insertion: remove segment labels that do not fit with padding (never clip text). */
function fitLabels(root) {
  for (const s of $$('.seg-b > span', root)) if (s.scrollWidth + 10 > s.parentElement.clientWidth) s.remove();
}

/* ------------------------------------------------------------ treemap (squarified, two levels: brand > platform) */
function worstRatio(areas, side) {
  const s = areas.reduce((a, b) => a + b, 0), mx = Math.max(...areas), mn = Math.min(...areas);
  return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
}
function squarify(items, x, y, w, h) {
  const out = [];
  let i = 0;
  while (i < items.length && w > 0.5 && h > 0.5) {
    const side = Math.min(w, h);
    let j = i + 1, best = worstRatio([items[i].a], side);
    while (j < items.length) { const r = worstRatio(items.slice(i, j + 1).map(v => v.a), side); if (r > best) break; best = r; j++; }
    const row = items.slice(i, j), sum = row.reduce((s, v) => s + v.a, 0);
    if (w >= h) { const cw = sum / h; let cy = y; for (const v of row) { const ch = v.a / cw; out.push({ v, x, y: cy, w: cw, h: ch }); cy += ch; } x += cw; w -= cw; }
    else { const rh = sum / w; let cx = x; for (const v of row) { const cw = v.a / rh; out.push({ v, x: cx, y, w: cw, h: rh }); cx += cw; } y += rh; h -= rh; }
    i = j;
  }
  return out;
}
/** groups: [{name, children:[{id, code, name, value}]}] */
function treemapHTML(groups, W, H, { selected, fmt = fmtN, tipFor }) {
  const live = groups.map(g => ({ ...g, children: g.children.filter(c => c.value > 0).sort((a, b) => b.value - a.value) })).filter(g => g.children.length);
  live.forEach(g => { g.value = g.children.reduce((s, c) => s + c.value, 0); });
  live.sort((a, b) => b.value - a.value);
  const total = live.reduce((s, g) => s + g.value, 0);
  if (!total) return '<div class="vt-empty">Nothing in this slice.</div>';
  live.forEach(g => { g.a = (g.value / total) * W * H; });
  let html = '';
  for (const R of squarify(live, 0, 0, W, H)) {
    const g = R.v, ix = 3, hdr = R.h >= 64 && R.w >= 70 ? 18 : 0;
    const bx = R.x + ix, by = R.y + ix, bw = R.w - 2 * ix, bh = R.h - 2 * ix;
    if (hdr) html += `<span class="tm-brand" style="left:${bx.toFixed(1)}px;top:${by.toFixed(1)}px;width:${bw.toFixed(1)}px">${esc(g.name)}</span>`;
    const inner = g.children.map(c => ({ ...c, a: 0 }));
    const area = (bw) * (bh - hdr);
    inner.forEach(c => { c.a = (c.value / g.value) * area; });
    for (const T of squarify(inner, bx, by + hdr, bw, bh - hdr)) {
      const c = T.v, tw = T.w - 2, th = T.h - 2;
      if (tw < 3 || th < 3) continue;
      const tk = Tip.tk(() => tipFor(c, g));
      const label = tw >= 54 && th >= 38 ? `<span class="c">${esc(c.code)}</span><span class="n">${fmt(c.value)}</span>` : tw >= 30 && th >= 20 ? `<span class="c">${esc(c.code)}</span>` : '';
      const sel = selected?.has(c.id);
      html += `<button class="tm-tile${sel ? ' sel' : ''}${selected?.size && !sel ? ' dim' : ''}" style="left:${(T.x + 1).toFixed(1)}px;top:${(T.y + 1).toFixed(1)}px;width:${tw.toFixed(1)}px;height:${th.toFixed(1)}px" data-act="facet" data-f="plat" data-v="${c.id}" data-tk="${tk}" aria-label="${esc(c.name)} ${fmt(c.value)}">${label}</button>`;
    }
  }
  return html;
}

/* ------------------------------------------------------------ line chart (snapshot history) */
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
/** series: [{id,label,css,points:[{t,y,tip}]}] ; bands: [{t0,t1,label}] */
function mountLine(el, { series, bands = [], fmt = fmtN }) {
  const W = Math.max(320, el.clientWidth), H = 280, m = { l: 48, r: 112, t: 16, b: 28 };
  const all = series.flatMap(s => s.points);
  const t0 = Math.min(...all.map(p => p.t)), t1 = Math.max(...all.map(p => p.t));
  const ymax = niceMax(Math.max(...all.map(p => p.y)) * 1.04);
  const X = t => m.l + ((t - t0) / (t1 - t0 || 1)) * (W - m.l - m.r), Y = v => H - m.b - (v / ymax) * (H - m.t - m.b);
  const ticks = 4, grid = [];
  for (let k = 0; k <= ticks; k++) { const v = (ymax / ticks) * k; grid.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" class="ax">${compact(v)}</text>`); }
  const months = [];
  for (let d = new Date(t0); d <= t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) if (d.getTime() >= t0) months.push(new Date(d));
  const xt = months.filter((_, i) => i % Math.ceil(months.length / Math.max(2, Math.floor((W - m.l - m.r) / 70))) === 0)
    .map(d => `<text x="${X(d.getTime())}" y="${H - 8}" text-anchor="middle" class="ax">${d.toLocaleString('en', { month: 'short' })}${d.getMonth() === 0 ? ' ' + d.getFullYear() : ''}</text>`).join('');
  const bandSvg = bands.map(b => {
    const x0 = clamp(X(b.t0) - 6, m.l, W - m.r), x1 = clamp(X(b.t1) + 6, m.l, W - m.r);
    return `<rect x="${x0}" y="${m.t}" width="${Math.max(2, x1 - x0)}" height="${H - m.t - m.b}" class="band"/><text x="${x0 + 4}" y="${m.t + 12}" class="bandl">${esc(b.label)}</text>`;
  }).join('');
  const paths = series.map(s => `<path d="${s.points.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join('')}" fill="none" stroke="${s.css}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  const ends = series.map(s => {
    const p = s.points[s.points.length - 1];
    return `<circle cx="${X(p.t)}" cy="${Y(p.y)}" r="4" fill="${s.css}" stroke="var(--panel)" stroke-width="2"/><text x="${X(p.t) + 10}" y="${Y(p.y) + 4}" class="endl">${esc(s.label)} <tspan class="endv">${fmt(p.y)}</tspan></text>`;
  }).join('');
  el.innerHTML = `<svg class="line" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(series.map(s => s.label).join(' and '))} across weekly snapshots">
    ${grid.join('')}${xt}${bandSvg}${paths}${ends}<line class="xh" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" style="display:none"/><g class="hd"></g>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg>`;
  const svg = $('svg', el), xh = $('.xh', svg), hd = $('.hd', svg), hit = $('.hit', svg);
  const base = series[0].points;
  const move = e => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    let bi = 0, bd = Infinity;
    base.forEach((p, i) => { const d = Math.abs(X(p.t) - px); if (d < bd) { bd = d; bi = i; } });
    const x = X(base[bi].t);
    xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.style.display = '';
    hd.innerHTML = series.map(s => { const p = s.points[bi]; return p ? `<circle cx="${x}" cy="${Y(p.y)}" r="4" fill="${s.css}" stroke="var(--panel)" stroke-width="2"/>` : ''; }).join('');
    const node = tipBox(base[bi].tip.title, series.map(s => [s.label, s.points[bi] ? fmt(s.points[bi].y) : 'n/a', s.css]), base[bi].tip.foot);
    Tip.showAt(node, e.clientX, e.clientY);
  };
  const leave = () => { xh.style.display = 'none'; hd.innerHTML = ''; Tip.hide(); };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerleave', leave);
}
