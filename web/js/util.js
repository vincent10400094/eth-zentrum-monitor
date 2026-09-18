export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export const chf = (n) =>
  new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const num = (n, d = 0) =>
  new Intl.NumberFormat('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
export const pct = (n, d = 1) => `${num(n * 100, d)}%`;

export const hhmm = (ts) =>
  new Date(ts).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });

/** Minutes since local midnight, from "HH:MM". */
export function minutesOf(hhmmStr) {
  const [h, m] = hhmmStr.split(':').map(Number);
  return h * 60 + m;
}
export const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

/** Interval that is cleared automatically when the page unmounts. */
export function makeTimers() {
  const ids = [];
  return {
    every(ms, fn, runNow = true) { if (runNow) fn(); ids.push(setInterval(fn, ms)); },
    clear() { ids.forEach(clearInterval); ids.length = 0; },
  };
}
