// Server-rendered charts: HTML bars and small inline SVGs. No chart library and no script,
// so they work under the site's CSP and on venue Wi-Fi. Every label is escaped here.
import { escapeHtml } from "./layout.js";
import type { DayCount } from "./stats.js";

export const COLORS = {
  scam: "var(--scam)",
  suspicious: "var(--warn)",
  quiet: "#a5b4fc",
  brand: "var(--brand)",
  violet: "var(--violet)",
  ok: "var(--ok)",
};

export interface Segment {
  label: string;
  value: number;
  color: string;
}

export interface BarRow {
  label: string;
  value: number;
  href?: string;
  color?: string;
}

/** Checks per day, stacked scam / suspicious / no red flags, with hover details. */
export function dailyBars(days: readonly DayCount[]): string {
  const totals = days.map((day) => day.scam + day.suspicious + day.quiet);
  const top = niceMax(Math.max(0, ...totals));
  const dense = days.length > 14;
  const bars = days.map((day, index) => dayBar(day, totals[index] ?? 0, top, index)).join("");
  const labels = days
    .map((day, index) => {
      // Month view: label every fifth day, counted back from today so today is always labeled.
      const show = !dense || (days.length - 1 - index) % 5 === 0;
      return `<span>${show ? escapeHtml(day.label) : ""}</span>`;
    })
    .join("");
  const empty = totals.every((total) => total === 0)
    ? `<div class="chart-empty"><div><b>No checks in this period</b>New checks show up here as they happen.</div></div>`
    : "";
  return `<div class="chart" style="--gap:${dense ? 3 : 12}px;--stagger:${dense ? 18 : 45}ms">
    <div class="chart-bars">
      <div class="bars-y" aria-hidden="true"><span style="top:0">${top}</span><span style="top:50%">${top / 2}</span><span style="top:100%">0</span></div>
      <div class="bars-plot">${bars}${empty}</div>
    </div>
    <div class="bars-x" aria-hidden="true">${labels}</div>
  </div>`;
}

function dayBar(day: DayCount, total: number, top: number, index: number): string {
  const percent = (value: number) => (top > 0 ? (value / top) * 100 : 0).toFixed(2);
  const parts = (
    [
      ["scam", day.scam],
      ["suspicious", day.suspicious],
      ["quiet", day.quiet],
    ] as const
  ).filter(([, value]) => value > 0);
  const segments = parts
    .map(
      ([kind, value], index) =>
        `<span class="seg-${kind}${index === parts.length - 1 ? " seg-top" : ""}" style="height:${percent(value)}%"></span>`,
    )
    .join("");
  const said = `${day.full}: ${day.scam} scam, ${day.suspicious} suspicious, ${day.quiet} no red flags`;
  return `<div class="bar" style="--h:${percent(total)}%;--i:${index}" role="img" aria-label="${escapeHtml(said)}">${segments}<div class="tip"><b>${escapeHtml(day.full)}</b><div><i style="background:${COLORS.scam}"></i>${day.scam} scam</div><div><i style="background:${COLORS.suspicious}"></i>${day.suspicious} suspicious</div><div><i style="background:${COLORS.quiet}"></i>${day.quiet} no red flags</div></div></div>`;
}

export function legend(segments: readonly Segment[]): string {
  return `<div class="legend">${segments
    .map((item) => `<span><i style="background:${escapeHtml(item.color)}"></i>${escapeHtml(item.label)} <b>${item.value}</b></span>`)
    .join("")}</div>`;
}

/** Ring chart with the total in the middle and a legend with shares underneath. */
export function donut(segments: readonly Segment[], centerLabel: string): string {
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter((item) => item.value > 0);
  const gap = visible.length > 1 ? 3 : 0;
  let offset = 0;
  const arcs = visible
    .map((item) => {
      const length = (item.value / total) * circumference;
      const dash = Math.max(length - gap, 0.5);
      // --start and --len (shares of the ring) let the CSS draw all arcs as one sweep.
      const sweep = `--start:${(offset / circumference).toFixed(3)};--len:${(length / circumference).toFixed(3)}`;
      const arc = `<circle class="arc" cx="88" cy="88" r="${radius}" fill="none" stroke-width="18" style="stroke:${escapeHtml(item.color)};${sweep}" stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"><title>${escapeHtml(`${item.label}: ${item.value}`)}</title></circle>`;
      offset += length;
      return arc;
    })
    .join("");
  const rows = segments
    .map((item) => {
      const share = total > 0 ? `${Math.round((item.value / total) * 100)}%` : "–";
      return `<div><i style="background:${escapeHtml(item.color)}"></i><span>${escapeHtml(item.label)}</span><b>${item.value}</b><small>${share}</small></div>`;
    })
    .join("");
  return `<div class="donut-wrap">
    <div class="donut">
      <svg viewBox="0 0 176 176" width="176" height="176" aria-hidden="true"><circle cx="88" cy="88" r="${radius}" fill="none" stroke-width="18" style="stroke:var(--line-2)"/>${arcs}</svg>
      <div class="donut-center"><b data-count="${total}">${total.toLocaleString("en-US")}</b><span>${escapeHtml(centerLabel)}</span></div>
    </div>
    <div class="donut-legend">${rows}</div>
  </div>`;
}

/** Horizontal bars. `max` pins 100% width (e.g. a funnel); otherwise the biggest row is full. */
export function barList(rows: readonly BarRow[], empty: string, max?: number): string {
  if (rows.length === 0 || rows.every((row) => row.value === 0)) return `<p class="empty-note">${escapeHtml(empty)}</p>`;
  const top = max ?? Math.max(...rows.map((row) => row.value));
  return `<div class="barlist">${rows
    .map((row, index) => {
      const width = top > 0 ? Math.min(100, Math.max(row.value > 0 ? 3 : 0, (row.value / top) * 100)) : 0;
      const label = row.href ? `<a href="${escapeHtml(row.href)}">${escapeHtml(row.label)}</a>` : escapeHtml(row.label);
      const color = row.color ? `;background:${escapeHtml(row.color)}` : "";
      return `<div class="barlist-row" style="--i:${index}"><div class="barlist-top"><span>${label}</span><b>${row.value}</b></div><div class="barlist-track"><div class="barlist-fill" style="width:${width.toFixed(1)}%${color}"></div></div></div>`;
    })
    .join("")}</div>`;
}

/** Tiny trend line for a KPI card. */
export function sparkline(values: readonly number[], color: string): string {
  if (values.length < 2 || values.every((value) => value === 0)) return "";
  const max = Math.max(1, ...values);
  const step = 100 / (values.length - 1);
  const line = values.map((value, index) => `${(index * step).toFixed(2)},${(27 - (value / max) * 24).toFixed(2)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,30 ${line} 100,30" style="fill:${escapeHtml(color)};opacity:0.12"/><polyline points="${line}" fill="none" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" style="stroke:${escapeHtml(color)}"/></svg>`;
}

/** Even axis maximum so the midline label is a whole number. */
export function niceMax(value: number): number {
  for (const step of [2, 4, 6, 8, 10, 12, 16, 20, 30, 40, 50, 60, 80, 100]) {
    if (value <= step) return step;
  }
  return Math.ceil(value / 50) * 50;
}
