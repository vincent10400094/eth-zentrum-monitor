import { el, getJson, hhmm, makeTimers } from '../util.js';

/* VBZ-ish line colours; unknown lines fall back to ETH blue. */
const LINE_COLOR = {
  '2': '#e2001a', '3': '#00a0df', '4': '#009a3e', '5': '#6e4a28', '6': '#b87a2c',
  '7': '#111111', '8': '#9fc32b', '9': '#4f4a9e', '10': '#d9008f', '11': '#009c4b',
  '12': '#7b7b7b', '13': '#f7a600', '14': '#00b4c8', '15': '#e2001a', '17': '#8b1a6b',
};
const busColor = '#00519e';

function badge(dep) {
  const color = LINE_COLOR[dep.line] || (dep.category === 'B' ? busColor : 'var(--eth)');
  return el('div', { class: 'badge', style: { background: color } }, dep.line);
}

function row(dep, walkMinutes) {
  const mins = Math.round((dep.expected - Date.now()) / 60000);
  const reachable = mins >= walkMinutes;
  const minsNode = el('div', {
    class: `mins ${mins <= 0 ? 'now' : mins <= walkMinutes ? 'walk' : ''}`,
  }, mins <= 0 ? 'jetzt' : String(mins));

  return el('div', { class: `dep ${mins <= 2 ? 'soon' : ''} ${reachable ? '' : 'unreachable'}`,
                     style: { borderLeftColor: LINE_COLOR[dep.line] || 'var(--eth)' } },
    badge(dep),
    el('div', { class: 'dest' }, dep.to.replace(/^Zürich,\s*/, ''),
      dep.platform ? el('span', { class: 'plat' }, `Kante ${dep.platform}`) : null),
    el('div', { class: 'time' }, hhmm(dep.planned),
      dep.delayMinutes ? el('span', { class: 'delay' }, `+${dep.delayMinutes}'`) : null),
    minsNode,
  );
}

export default function tramPage(cfg) {
  const timers = makeTimers();
  const root = el('div', { class: 'page' });
  const head = el('div', { class: 'head' },
    el('h1', {}, cfg.tram.stationLabel || cfg.tram.station),
    el('span', { class: 'sub' }, 'Abfahrten · Departures'),
    el('div', { class: 'right' }),
  );
  const rows = el('div', { class: 'tram-rows' });
  const board = el('div', { class: 'tram-board' },
    el('div', { class: 'tram-head' },
      el('div', {}, 'Linie'), el('div', {}, 'Richtung'), el('div', { style: { textAlign: 'right' } }, 'Abfahrt'),
      el('div', { style: { textAlign: 'right' } }, 'in Min')),
    rows,
  );
  const legend = el('div', { class: 'legend' },
    el('div', {}, 'Echtzeitdaten · transport.opendata.ch'),
    el('div', {}, 'Laufzeit zur Haltestelle: ', el('b', {}, `${cfg.tram.walkMinutes} min`)),
  );
  root.append(head, el('div', { class: 'rule' }), board, legend);

  let data = null;

  function render() {
    if (!data) return;
    const walk = data.walkMinutes || 0;
    const visible = data.departures
      .filter((d) => d.expected - Date.now() > -60000)
      .slice(0, cfg.tram.limit || 10);
    rows.innerHTML = '';
    if (!visible.length) {
      rows.append(el('div', { class: 'closed' }, el('span', {}, '🌙'), el('div', {}, 'Keine Abfahrten · No departures')));
    } else {
      visible.forEach((d) => rows.append(row(d, walk)));
    }
    head.querySelector('.right').textContent =
      `Stand ${hhmm(data.generated)}`;
  }

  async function load() { data = await getJson('/api/tram'); render(); }

  return {
    id: 'tram',
    title: 'Tram',
    async mount(stage) {
      stage.append(root);
      await load();
      timers.every((cfg.refresh?.tramSeconds ?? 20) * 1000, () => load().catch(console.error), false);
      timers.every(1000, render, false); // countdown ticks locally between fetches
    },
    unmount() { timers.clear(); root.remove(); },
  };
}
