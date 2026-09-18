import { el, getJson, chf, num, pct, makeTimers } from '../util.js';

/**
 * "What happened to the RAM I bought?" — price history since the purchase date
 * plus the paper position for the units held.
 *
 * Price points come from data/ram-price-history.json (see config.ram.historyFile);
 * the position maths only ever uses the numbers in that file.
 */
export function position(c, points) {
  const bought = points.find((p) => p.date === c.purchaseDate);
  const basisUnit = c.purchasePriceChf ?? (bought && bought.price);
  const last = points[points.length - 1];
  const nowUnit = last ? last.price : basisUnit;

  const units = c.units || 1;
  const cost = basisUnit * units;
  const value = nowUnit * units;
  const fee = value * (c.resaleFeeRate || 0);
  const netValue = value - fee;

  const peak = points.reduce((a, b) => (b.price > a.price ? b : a), points[0]);
  const trough = points.reduce((a, b) => (b.price < a.price ? b : a), points[0]);

  const days = Math.max(1, (new Date(last.date) - new Date(c.purchaseDate)) / 86400000);

  return {
    basisUnit, nowUnit, units, cost, value, fee, netValue, last, peak, trough, days,
    changePct: nowUnit / basisUnit - 1,
    multiple: nowUnit / basisUnit,
    gross: value - cost,
    net: netValue - cost,
    peakNet: peak.price * units * (1 - (c.resaleFeeRate || 0)) - cost,
    cagr: Math.pow(nowUnit / basisUnit, 365 / days) - 1,
  };
}

/** Monthly deltas, newest first. */
function deltas(points) {
  return points.slice(1).map((p, i) => ({
    ...p,
    prev: points[i].price,
    change: p.price / points[i].price - 1,
  })).reverse();
}

const MONTH = (iso) =>
  new Date(iso).toLocaleDateString('de-CH', { month: 'short', year: '2-digit' });

/** Price line since purchase, with the purchase price as a reference line. */
function chart(points, pos) {
  const W = 1000, H = 440, L = 70, R = 24, T = 24, B = 46;
  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const span = Math.max(1, t1 - t0);
  const pMax = Math.max(...points.map((p) => p.price)) * 1.08;

  const x = (iso) => L + ((new Date(iso).getTime() - t0) / span) * (W - L - R);
  const y = (v) => H - B - (v / pMax) * (H - T - B);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.at(-1).date).toFixed(1)},${y(0)} L${x(points[0].date).toFixed(1)},${y(0)} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * pMax);
  const last = points.at(-1);

  return `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
       aria-label="16 GB DDR5 module price since ${points[0].date}">
    <defs>
      <linearGradient id="ramg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity=".38"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
      </linearGradient>
    </defs>

    ${ticks.map((t) => `
      <line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"
            stroke="var(--line)" stroke-width="1"/>
      <text x="${L - 10}" y="${(y(t) + 7).toFixed(1)}" text-anchor="end"
            fill="var(--fg-faint)" font-size="21">${num(t, 0)}</text>`).join('')}

    <!-- what you paid -->
    <line x1="${L}" x2="${W - R}" y1="${y(pos.basisUnit).toFixed(1)}" y2="${y(pos.basisUnit).toFixed(1)}"
          stroke="var(--warn)" stroke-width="2.5" stroke-dasharray="8 7"/>
    <text x="${W - R}" y="${(y(pos.basisUnit) - 12).toFixed(1)}" text-anchor="end"
          fill="var(--warn)" font-size="21">bought at ${chf(pos.basisUnit)}</text>

    <path d="${area}" fill="url(#ramg)"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="5"
          stroke-linejoin="round" stroke-linecap="round"/>

    ${points.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.price).toFixed(1)}"
        r="${p.observed ? 8 : 5}" fill="${p.observed ? 'var(--fg)' : 'var(--accent)'}"/>`).join('')}

    ${points.filter((_, i) => i % 2 === 0).map((p) => `
      <text x="${x(p.date).toFixed(1)}" y="${H - 12}" text-anchor="middle"
            fill="var(--fg-faint)" font-size="21">${MONTH(p.date)}</text>`).join('')}

    <text x="${x(last.date).toFixed(1)}" y="${(y(last.price) - 18).toFixed(1)}" text-anchor="end"
          fill="var(--fg)" font-size="30" font-weight="700">${chf(last.price)}</text>
  </svg>`;
}

export default function ramPage(cfg) {
  const timers = makeTimers();
  const c = cfg.ram;
  const root = el('div', { class: 'page' });
  let history = null;

  function kpi(label, value, note, tone) {
    return el('div', { class: 'kpi' },
      el('div', { class: 'label' }, label),
      el('div', { class: `value ${tone || ''}` }, value),
      el('div', { class: 'note' }, note));
  }

  function render() {
    if (!history) return;
    const points = history.points;
    const pos = position(c, points);
    const tone = (v) => (v >= 0 ? 'pos' : 'neg');
    const sign = (v) => (v >= 0 ? '+' : '−');

    root.innerHTML = '';
    root.append(
      el('div', { class: 'head' },
        el('h1', {}, 'RAM price watch'),
        el('span', { class: 'sub' }, `${c.product} · ${history.currency}`),
        el('div', { class: 'right' },
          el('strong', {}, `${pos.units} × bought ${new Date(c.purchaseDate).toLocaleDateString('de-CH')}`),
          el('div', {}, `at CHF ${chf(pos.basisUnit)} each · ${Math.round(pos.days)} days held`)),
      ),
      el('div', { class: 'rule' }),

      el('div', { class: 'kpis' },
        kpi('Price today', `CHF ${chf(pos.nowUnit)}`,
            `${MONTH(pos.last.date)} · per module`),
        kpi('Since purchase', `${sign(pos.changePct)}${pct(Math.abs(pos.changePct), 0)}`,
            `${num(pos.multiple, 1)}× · ${sign(pos.cagr)}${pct(Math.abs(pos.cagr), 0)} p.a.`, tone(pos.changePct)),
        kpi(`Value of ${pos.units} modules`, `CHF ${num(pos.value, 0)}`,
            `cost basis CHF ${chf(pos.cost)}`),
        kpi('Gain if sold now', `${sign(pos.net)}CHF ${num(Math.abs(pos.net), 0)}`,
            `after ${pct(c.resaleFeeRate || 0, 0)} resale fee · peak was ${sign(pos.peakNet)}${num(Math.abs(pos.peakNet), 0)}`,
            tone(pos.net)),
      ),

      el('div', { class: 'panels' },
        (() => {
          const p = el('div', { class: 'panel' }, el('h3', {}, `Price per module since ${new Date(c.purchaseDate).toLocaleDateString('de-CH')}`));
          const holder = el('div', { style: { flex: '1', minHeight: '0', display: 'flex' } });
          holder.innerHTML = chart(points, pos);
          p.append(holder);
          return p;
        })(),

        el('div', { class: 'panel' },
          el('h3', {}, 'Month on month'),
          el('div', { class: 'movers' },
            deltas(points).slice(0, 7).map((d) => el('div', { class: 'mover' },
              el('span', { class: 'm' }, MONTH(d.date)),
              el('span', { class: 'p' }, chf(d.price)),
              el('span', { class: `c ${d.change >= 0 ? 'pos' : 'neg'}` },
                `${sign(d.change)}${pct(Math.abs(d.change), 0)}`),
            )),
          ),
          el('div', { class: 'assump' },
            `Peak ${chf(pos.peak.price)} (${MONTH(pos.peak.date)}), low ${chf(pos.trough.price)} (${MONTH(pos.trough.date)}). `
            + `White dots are prices actually observed; green dots are modelled from published DRAM price moves. `
            + `Add real quotes to data/ram-price-history.json — the board picks them up on its own.`),
        ),
      ),
    );
  }

  async function load() { history = await getJson('/api/ram-prices'); render(); }

  return {
    id: 'ram',
    title: 'RAM',
    async mount(stage) { stage.append(root); await load(); timers.every(600000, () => load().catch(console.error), false); },
    unmount() { timers.clear(); root.remove(); },
  };
}
