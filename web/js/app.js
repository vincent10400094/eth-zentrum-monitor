import { $, el, getJson, makeTimers, minutesOf, nowMinutes } from './util.js';
import mensaPage from './pages/mensa.js';
import tramPage from './pages/tram.js';
import ramPage from './pages/ram.js';
import clockPage from './pages/clock.js';

/* Register a page here and it becomes usable from config.json
   (either as a schedule slot or in "flexPages"). */
const PAGES = {
  mensa: mensaPage,
  tram: tramPage,
  ram: ramPage,
  clock: clockPage,
};

const stage = $('#stage');
const statusPage = $('#status-page');
const statusDots = $('#status-dots');
const statusNet = $('#status-net');
const statusClock = $('#status-clock');

let cfg = null;
let current = null;      // { id, instance }
let manual = null;       // page id pinned by keyboard, cleared on next schedule change
let flexIndex = 0;
let lastFlexSwitch = 0;

/** Which page does the clock say we should be on right now? */
function scheduledPage(now = new Date()) {
  const m = nowMinutes(now);
  for (const slot of cfg.schedule || []) {
    const from = minutesOf(slot.from), to = minutesOf(slot.to);
    const inSlot = from <= to ? m >= from && m <= to : m >= from || m <= to; // handles wrap past midnight
    if (inSlot && PAGES[slot.page]) return slot.page;
  }
  return null;
}

function flexDeck() {
  return (cfg.flexPages || ['clock']).filter((p) => PAGES[p]);
}

async function show(id) {
  if (current && current.id === id) return;
  const factory = PAGES[id];
  if (!factory) return;

  const outgoing = current;
  const instance = factory(cfg);
  current = { id, instance };
  try {
    await instance.mount(stage);
    setNet(true);
  } catch (err) {
    console.error('page failed', id, err);
    setNet(false, err.message);
    stage.append(el('div', { class: 'err' }, `«${id}» could not load: ${err.message}`));
  }
  if (outgoing) {
    try { outgoing.instance.unmount(); } catch (e) { console.error(e); }
  }
  paintStatus();
}

function setNet(ok, msg) {
  statusNet.className = `net ${ok ? '' : 'down'}`;
  statusNet.textContent = ok ? 'live' : `offline${msg ? ' · ' + msg : ''}`;
}

function paintStatus() {
  if (!current) return;
  statusPage.textContent = current.instance.title || current.id;
  const deck = flexDeck();
  statusDots.innerHTML = '';
  const onFlex = !scheduledPage();
  if (onFlex) deck.forEach((p) => statusDots.append(el('i', { class: p === current.id ? 'on' : '' })));
}

/** Runs once a second: schedule wins, flex deck rotates when no slot matches. */
function tick() {
  statusClock.textContent = new Date().toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

  const scheduled = scheduledPage();
  if (manual) {
    if (manual.until > Date.now()) return;
    manual = null;
  }
  if (scheduled) { show(scheduled); return; }

  const deck = flexDeck();
  if (!deck.length) return;
  const period = (cfg.flexRotationSeconds || 45) * 1000;
  const now = Date.now();
  if (!current || !deck.includes(current.id)) { lastFlexSwitch = now; show(deck[flexIndex % deck.length]); return; }
  if (now - lastFlexSwitch >= period) {
    lastFlexSwitch = now;
    flexIndex = (flexIndex + 1) % deck.length;
    show(deck[flexIndex]);
  }
}

/* Keyboard: handy while setting the screen up, harmless in kiosk mode. */
function keys(e) {
  const all = Object.keys(PAGES);
  if (e.key === 'f') document.documentElement.requestFullscreen?.();
  if (e.key === 'r') location.reload();
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const i = all.indexOf(current?.id);
    const next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
    manual = { until: Date.now() + 5 * 60000 };
    show(next);
  }
  if (e.key === 'Escape') manual = null;
}

async function boot() {
  const timers = makeTimers();
  try {
    cfg = await getJson('/api/config');
  } catch (err) {
    stage.append(el('div', { class: 'err' }, 'Cannot reach the monitor server: ' + err.message));
    setTimeout(() => location.reload(), 10000);
    return;
  }
  document.addEventListener('keydown', keys);
  timers.every(1000, tick);

  // Nightly reload keeps a long-running kiosk from drifting or leaking.
  setInterval(() => { if (new Date().getHours() === 4) location.reload(); }, 60 * 60 * 1000);
}

boot();
