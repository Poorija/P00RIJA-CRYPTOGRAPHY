/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The panel's charts, drawn here as SVG: lines over time, bars and a ring.
 * Nothing is fetched and nothing runs from elsewhere (the page's policy is
 * 'self' only), and no style attribute is written: colours are SVG
 * attributes, so the policy's style-src stays strict. Every label a server
 * sent is escaped. A line chart answers the pointer with the values at that
 * moment (wireCharts). */
import { state, esc, num, fmtBytes, fmtNum } from './ui.js';

export const PALETTE = ['#38bdf8', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#a3e635', '#fb923c', '#94a3b8', '#e879f9', '#2dd4bf'];
export const colorOf = (index) => PALETTE[index % PALETTE.length];
const charts = new Map();
let chartSeq = 0;
/* Charts drawn before a redraw are forgotten with it. */
export function forgetCharts(root = document) {
  for (const id of [...charts.keys()]) if (!root.querySelector(`[data-chart="${id}"]`)) charts.delete(id);
}

export function fmtValue(value, unit) {
  if (unit === 'B/s') return `${fmtBytes(value)}/s`;
  if (unit === 'B') return fmtBytes(value);
  if (unit === '%') return `${Math.round(num(value))}%`;
  if (unit === 'MB') return `${fmtNum(value)} MB`;
  if (unit === '/min') return `${fmtNum(value)}/min`;
  return fmtNum(value);
}

/* A round top for an axis: 0, then 1, 2 or 5 times a power of ten. */
function niceMax(value) {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

function timeLabel(at, span) {
  const date = new Date(at);
  const locale = state.lang === 'fa' ? 'fa-IR' : 'en-GB';
  return span > 36 * 3600 * 1000
    ? date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
    : date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

const legend = (series) => `<div class="legend chart-legend">${series.map((entry) => `<span><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="3" fill="${esc(entry.color)}"${entry.dashed ? ' fill-opacity=".45"' : ''}/></svg>${esc(entry.label)}</span>`).join('')}</div>`;

/* Lines over time. series: [{ label, color, points: [[t, value]], dashed }]. */
export function lineChart({ title = '', series = [], unit = '', max = null, height = 170, from = null, to = null, empty = '—' }) {
  const id = `chart${chartSeq += 1}`;
  const all = series.flatMap((entry) => entry.points);
  if (!all.length) return `<figure class="chart"><figcaption>${esc(title)}</figcaption><div class="chart-empty mut">${esc(empty)}</div></figure>`;
  const width = 600;
  const pad = { top: 10, right: 12, bottom: 22, left: 52 };
  const start = from ?? Math.min(...all.map(([at]) => at));
  const end = Math.max(to ?? 0, ...all.map(([at]) => at), start + 1);
  const top = max ?? niceMax(Math.max(...all.map(([, value]) => num(value))) * 1.1);
  const x = (at) => pad.left + ((at - start) / (end - start)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - Math.min(1, num(value) / top)) * (height - pad.top - pad.bottom);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((part) => {
    const value = top * part;
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="grid"/><text x="${pad.left - 6}" y="${(y(value) + 4).toFixed(1)}" class="axis" text-anchor="end">${esc(fmtValue(value, unit))}</text>`;
  }).join('');
  const ticks = [0, 1 / 3, 2 / 3, 1].map((part) => {
    const at = start + (end - start) * part;
    return `<text x="${x(at).toFixed(1)}" y="${height - 6}" class="axis" text-anchor="${part === 0 ? 'start' : part === 1 ? 'end' : 'middle'}">${esc(timeLabel(at, end - start))}</text>`;
  }).join('');
  const lines = series.map((entry) => {
    if (!entry.points.length) return '';
    /* A gap longer than three steps is drawn as a gap, not a straight line across it. */
    const steps = entry.points.slice(1).map(([at], index) => at - entry.points[index][0]).sort((a, b) => a - b);
    const typical = steps[Math.floor(steps.length / 2)] || 0;
    let d = '';
    entry.points.forEach(([at, value], index) => {
      const gap = index > 0 && typical && at - entry.points[index - 1][0] > typical * 3;
      d += `${index === 0 || gap ? 'M' : 'L'}${x(at).toFixed(1)},${y(value).toFixed(1)}`;
    });
    const area = series.length === 1 && !entry.dashed ? `<path d="${d}L${x(entry.points[entry.points.length - 1][0]).toFixed(1)},${y(0).toFixed(1)}L${x(entry.points[0][0]).toFixed(1)},${y(0).toFixed(1)}Z" fill="${esc(entry.color)}" fill-opacity=".12"/>` : '';
    return `${area}<path d="${d}" fill="none" stroke="${esc(entry.color)}" stroke-width="2" stroke-linejoin="round"${entry.dashed ? ' stroke-dasharray="6 4"' : ''}/>`;
  }).join('');
  charts.set(id, { series, unit, start, end, x, width, height, pad });
  const latest = series.map((entry) => entry.points.length ? `${entry.label}: ${fmtValue(entry.points[entry.points.length - 1][1], unit)}` : '').filter(Boolean).join(' · ');
  return `<figure class="chart"><figcaption><span>${esc(title)}</span><span class="mut small">${esc(latest)}</span></figcaption>
    <svg viewBox="0 0 ${width} ${height}" class="chart-svg" data-chart="${id}" role="img" aria-label="${esc(title)}" preserveAspectRatio="none">${grid}${ticks}${lines}<line class="cursor" x1="-10" x2="-10" y1="${pad.top}" y2="${height - pad.bottom}"/></svg>
    ${series.length > 1 ? legend(series) : ''}</figure>`;
}

/* Bars, one row per item, one segment (stacked) or one bar (grouped) per key.
   items: [{ label, values: [...] }], keys: [{ label, color }]. */
export function barChart({ title = '', items = [], keys = [], unit = '', stacked = true, limit = 15 }) {
  const shown = items.slice(0, limit);
  if (!shown.length) return `<figure class="chart"><figcaption>${esc(title)}</figcaption><div class="chart-empty mut">—</div></figure>`;
  const totals = shown.map((item) => (stacked ? item.values.reduce((sum, value) => sum + num(value), 0) : Math.max(...item.values.map(num))));
  const top = niceMax(Math.max(...totals, 0));
  const rowHeight = stacked ? 22 : 10 * keys.length + 10;
  const width = 600;
  const labelWidth = 150;
  const height = shown.length * rowHeight + 8;
  const rows = shown.map((item, index) => {
    const y = index * rowHeight + 4;
    let at = labelWidth;
    const bars = item.values.map((value, k) => {
      const w = (num(value) / top) * (width - labelWidth - 70);
      const rect = stacked
        ? `<rect x="${at.toFixed(1)}" y="${y}" width="${Math.max(0, w).toFixed(1)}" height="${rowHeight - 6}" rx="3" fill="${esc(keys[k]?.color || colorOf(k))}"><title>${esc(`${item.label} · ${keys[k]?.label || ''}: ${fmtValue(value, unit)}`)}</title></rect>`
        : `<rect x="${labelWidth}" y="${y + k * 10}" width="${Math.max(0, w).toFixed(1)}" height="8" rx="2" fill="${esc(keys[k]?.color || colorOf(k))}"><title>${esc(`${item.label} · ${keys[k]?.label || ''}: ${fmtValue(value, unit)}`)}</title></rect>`;
      if (stacked) at += w;
      return rect;
    }).join('');
    const label = String(item.label).length > 22 ? `${String(item.label).slice(0, 21)}…` : String(item.label);
    return `<text x="${labelWidth - 8}" y="${y + rowHeight / 2}" class="axis" text-anchor="end">${esc(label)}</text>${bars}<text x="${(stacked ? at : labelWidth + (totals[index] / top) * (width - labelWidth - 70)) + 6}" y="${y + rowHeight / 2}" class="axis">${esc(fmtValue(totals[index], unit))}</text>`;
  }).join('');
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption><svg viewBox="0 0 ${width} ${height}" class="chart-svg bars" role="img" aria-label="${esc(title)}">${rows}</svg>${keys.length > 1 ? legend(keys) : ''}</figure>`;
}

/* A ring of shares. items: [{ label, value, color }]. */
export function donut({ title = '', items = [], unit = '' }) {
  const total = items.reduce((sum, item) => sum + num(item.value), 0);
  if (!total) return `<figure class="chart"><figcaption>${esc(title)}</figcaption><div class="chart-empty mut">—</div></figure>`;
  let angle = -Math.PI / 2;
  const arcs = items.filter((item) => num(item.value) > 0).map((item, index) => {
    const part = num(item.value) / total;
    const next = angle + part * Math.PI * 2;
    const large = part > 0.5 ? 1 : 0;
    const p = (a, r) => `${(60 + Math.cos(a) * r).toFixed(2)},${(60 + Math.sin(a) * r).toFixed(2)}`;
    const d = part >= 0.9999
      ? 'M60,8A52,52 0 1,1 59.99,8ZM60,30A30,30 0 1,0 60.01,30Z'
      : `M${p(angle, 52)}A52,52 0 ${large},1 ${p(next, 52)}L${p(next, 30)}A30,30 0 ${large},0 ${p(angle, 30)}Z`;
    angle = next;
    return `<path d="${d}" fill="${esc(item.color || colorOf(index))}"><title>${esc(`${item.label}: ${fmtValue(item.value, unit)} (${Math.round(part * 100)}%)`)}</title></path>`;
  }).join('');
  return `<figure class="chart donut"><figcaption>${esc(title)}</figcaption><div class="donut-body"><svg viewBox="0 0 120 120" width="140" height="140" role="img" aria-label="${esc(title)}">${arcs}<text x="60" y="64" text-anchor="middle" class="axis big">${esc(fmtValue(total, unit))}</text></svg>
    ${legend(items.map((item, index) => ({ label: `${item.label} · ${Math.round((num(item.value) / total) * 100)}%`, color: item.color || colorOf(index) })))}</div></figure>`;
}

/* A small line in a table cell. */
export function sparkline(values, color = PALETTE[0]) {
  const list = values.map(num);
  if (list.length < 2) return '';
  const top = Math.max(...list, 1);
  const d = list.map((value, index) => `${index ? 'L' : 'M'}${((index / (list.length - 1)) * 80).toFixed(1)},${(18 - (value / top) * 16).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 80 20" width="80" height="20" class="spark" aria-hidden="true"><path d="${d}" fill="none" stroke="${esc(color)}" stroke-width="1.5"/></svg>`;
}

/* The values under the pointer, in a tip that follows it. */
export function wireCharts(root) {
  const tip = document.getElementById('chartTip');
  if (!tip || root.dataset.chartsWired) return;
  root.dataset.chartsWired = '1';
  root.addEventListener('pointermove', (event) => {
    const svg = event.target.closest?.('svg[data-chart]');
    const chart = svg && charts.get(svg.getAttribute('data-chart'));
    if (!chart) { tip.hidden = true; return; }
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * chart.width;
    const at = chart.start + ((px - chart.pad.left) / (chart.width - chart.pad.left - chart.pad.right)) * (chart.end - chart.start);
    const rows = chart.series.map((entry) => {
      let best = null;
      for (const point of entry.points) if (!best || Math.abs(point[0] - at) < Math.abs(best[0] - at)) best = point;
      return best ? { label: entry.label, color: entry.color, value: best[1], at: best[0] } : null;
    }).filter(Boolean);
    if (!rows.length) { tip.hidden = true; return; }
    const cursor = svg.querySelector('.cursor');
    if (cursor) { cursor.setAttribute('x1', chart.x(rows[0].at).toFixed(1)); cursor.setAttribute('x2', chart.x(rows[0].at).toFixed(1)); }
    tip.innerHTML = `<div class="mut small">${esc(new Date(rows[0].at).toLocaleString(state.lang === 'fa' ? 'fa-IR' : 'en-GB'))}</div>${rows.map((row) => `<div><svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" rx="2" fill="${esc(row.color)}"/></svg> ${esc(row.label)}: <strong>${esc(fmtValue(row.value, chart.unit))}</strong></div>`).join('')}`;
    tip.hidden = false;
    const left = Math.min(window.innerWidth - tip.offsetWidth - 8, event.clientX + 14);
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, event.clientY - tip.offsetHeight - 12)}px`;
  });
  root.addEventListener('pointerleave', () => { tip.hidden = true; }, true);
  root.addEventListener('pointerout', (event) => { if (!event.relatedTarget?.closest?.('svg[data-chart]')) tip.hidden = true; });
}
