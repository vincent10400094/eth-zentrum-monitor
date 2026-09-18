#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const CONFIG_PATH = process.env.MONITOR_CONFIG || path.join(ROOT, 'config.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}
let config = loadConfig();
fs.watchFile(CONFIG_PATH, { interval: 5000 }, () => {
  try { config = loadConfig(); log('config reloaded'); }
  catch (e) { log('config reload failed: ' + e.message); }
});

const PORT = Number(process.env.PORT || config.port || 8080);

function log(...a) { console.log(new Date().toISOString(), ...a); }

/* ------------------------------------------------------------------ *
 * tiny cache with stale-on-error fallback                             *
 * ------------------------------------------------------------------ */
const cache = new Map(); // key -> { at, ttl, value }

async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value;
  try {
    const value = await producer();
    cache.set(key, { at: now, value });
    return value;
  } catch (err) {
    if (hit) {
      log(`upstream failed for ${key}, serving stale (${Math.round((now - hit.at) / 1000)}s old):`, err.message);
      return hit.value;
    }
    throw err;
  }
}

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'eth-monitor/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchJson(new URL(res.headers.location, url).toString(), timeoutMs));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('bad JSON: ' + e.message)); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ *
 * ETH Gastro (cookpit) menu                                           *
 * ------------------------------------------------------------------ */
const COOKPIT = 'https://idapps.ethz.ch/cookpit-pub-services/v1';

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// cookpit returns whole weekly rotas; ask from last Monday so the current week is included
function weekStart(now) {
  const d = new Date(now);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}

function priceFor(meal, group) {
  const arr = meal['meal-price-array'] || [];
  const hit = arr.find((p) => (p['customer-group-desc'] || '').toLowerCase() === group) || arr[0];
  return hit ? hit.price : null;
}

function extractMeals(rotaArray, facilityId, now, mealTimeName, priceGroup) {
  const today = isoDate(now);
  const dowCode = now.getDay() === 0 ? 7 : now.getDay(); // 1=Mon..7=Sun
  const rota = (rotaArray || []).find(
    (r) => r['facility-id'] === facilityId && r['valid-from'] <= today && today <= r['valid-to']
  );
  if (!rota) return { open: false, meals: [], reason: 'no menu published for today' };

  const day = (rota['day-of-week-array'] || []).find((d) => d['day-of-week-code'] === dowCode);
  const openings = (day && day['opening-hour-array']) || [];
  if (!openings.length) return { open: false, meals: [], reason: 'closed today' };

  const hours = openings.map((o) => `${o['time-from']}–${o['time-to']}`).join(', ');
  const mealTimes = openings.flatMap((o) => o['meal-time-array'] || []);
  const wanted = mealTimes.filter(
    (m) => !mealTimeName || (m.name || '').toLowerCase().includes(mealTimeName.toLowerCase())
  );
  const chosen = wanted.length ? wanted : mealTimes;

  const meals = [];
  for (const mt of chosen) {
    for (const line of mt['line-array'] || []) {
      const meal = line.meal;
      if (!meal) continue;
      meals.push({
        line: line.name || '',
        mealTime: mt.name || '',
        name: meal.name || '',
        description: meal.description || '',
        price: priceFor(meal, priceGroup),
        classes: (meal['meal-class-array'] || []).map((c) => c.desc),
        allergens: (meal['allergen-array'] || []).map((a) => a.desc),
        energy: meal.energy || null,
        image: meal['image-url']
          ? `/api/image?u=${encodeURIComponent(meal['image-url'] + '?client-id=ethz-wcms')}`
          : null,
      });
    }
  }
  return { open: true, hours, meals };
}

async function getMenu(lang) {
  const now = new Date();
  const after = isoDate(weekStart(now));
  const url =
    `${COOKPIT}/weeklyrotas?client-id=ethz-wcms&lang=${encodeURIComponent(lang)}` +
    `&rs-first=0&rs-size=50&valid-after=${after}`;
  const data = await fetchJson(url, 25000);
  const rotas = data['weekly-rota-array'] || [];
  const mc = config.mensa;
  return {
    date: isoDate(now),
    lang,
    facilities: mc.facilities.map((f) => ({
      id: f.id,
      label: f.label,
      sub: f.sub,
      ...extractMeals(rotas, f.id, now, mc.mealTime, mc.priceGroup),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Tram departures (transport.opendata.ch)                             *
 * ------------------------------------------------------------------ */
async function getTram() {
  const t = config.tram;
  const url =
    `https://transport.opendata.ch/v1/stationboard?station=${encodeURIComponent(t.station)}` +
    `&limit=${t.limit || 12}`;
  const data = await fetchJson(url, 15000);
  const departures = (data.stationboard || []).map((d) => {
    const stop = d.stop || {};
    const plannedTs = (stop.departureTimestamp || 0) * 1000;
    const delayMin = Number(stop.delay || 0);
    return {
      line: d.number || d.name || '?',
      category: d.category || '',
      to: d.to || '',
      planned: plannedTs,
      delayMinutes: delayMin,
      expected: plannedTs + delayMin * 60000,
      platform: stop.platform || null,
    };
  }).sort((a, b) => a.expected - b.expected);
  return {
    station: data.station ? data.station.name : t.station,
    label: t.stationLabel || (data.station && data.station.name) || t.station,
    walkMinutes: t.walkMinutes || 0,
    generated: Date.now(),
    departures,
  };
}

/* ------------------------------------------------------------------ *
 * News (RSS)                                                          *
 * ------------------------------------------------------------------ */
function fetchText(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'eth-monitor/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString(), timeoutMs));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => resolve(buf));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeXml(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENTITIES[e])
    .trim();
}
const tagOf = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decodeXml(m[1]) : '';
};

/** Minimal RSS 2.0 reader — enough for the 20 Minuten front feed, no dependencies. */
function parseRss(xml, limit) {
  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const body = m[1];
    const encl = body.match(/<enclosure\b[^>]*url="([^"]+)"[^>]*>/i);
    const media = body.match(/<media:(?:content|thumbnail)\b[^>]*url="([^"]+)"[^>]*>/i);
    const imgUrl = (encl && encl[1]) || (media && media[1]) || null;
    const published = Date.parse(tagOf(body, 'pubDate')) || null;
    items.push({
      title: tagOf(body, 'title'),
      summary: tagOf(body, 'description'),
      link: tagOf(body, 'link'),
      published,
      image: imgUrl ? `/api/image?u=${encodeURIComponent(imgUrl)}` : null,
    });
  }
  return items;
}

async function getNews() {
  const n = config.news || {};
  const xml = await fetchText(n.feed, 20000);
  const items = parseRss(xml, n.count || 12);
  if (!items.length) throw new Error('feed had no items');
  return {
    source: n.source || tagOf(xml.slice(0, 2000), 'title') || 'News',
    fetched: Date.now(),
    items,
  };
}

/* ------------------------------------------------------------------ *
 * RAM price history (a file you edit by hand; read fresh every time)   *
 * ------------------------------------------------------------------ */
function readPriceHistory() {
  const rel = (config.ram && config.ram.historyFile) || 'data/ram-price-history.json';
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) throw new Error('historyFile must live inside the project');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.points = (data.points || [])
    .filter((p) => p && p.date && Number.isFinite(p.price))
    .sort((a, b) => a.date.localeCompare(b.date));
  return data;
}

/* ------------------------------------------------------------------ *
 * image proxy (whitelisted host, disk-cached)                         *
 * ------------------------------------------------------------------ */
const IMG_DIR = path.join(ROOT, '.cache', 'images');
fs.mkdirSync(IMG_DIR, { recursive: true });
const IMG_HOSTS = new Set(['idapps.ethz.ch', 'image.20min.ch']);

function proxyImage(target, res) {
  let u;
  try { u = new URL(target); } catch { return send(res, 400, 'text/plain', 'bad url'); }
  if (u.protocol !== 'https:' || !IMG_HOSTS.has(u.hostname)) return send(res, 403, 'text/plain', 'host not allowed');

  const key = Buffer.from(u.toString()).toString('base64url').slice(0, 120);
  const file = path.join(IMG_DIR, key);
  if (fs.existsSync(file)) {
    const meta = fs.existsSync(file + '.type') ? fs.readFileSync(file + '.type', 'utf8') : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': meta, 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(file).pipe(res);
  }
  https.get(u, { headers: { 'User-Agent': 'eth-monitor/1.0' } }, (up) => {
    const type = up.headers['content-type'] || '';
    if (up.statusCode !== 200 || !type.startsWith('image/')) {
      up.resume();
      return send(res, 502, 'text/plain', `upstream ${up.statusCode} ${type}`);
    }
    const chunks = [];
    up.on('data', (c) => chunks.push(c));
    up.on('end', () => {
      const body = Buffer.concat(chunks);
      try {
        fs.writeFileSync(file, body);
        fs.writeFileSync(file + '.type', type);
      } catch (e) { log('image cache write failed:', e.message); }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
      res.end(body);
    });
  }).on('error', (e) => send(res, 502, 'text/plain', e.message));
}

/* ------------------------------------------------------------------ *
 * static + routing                                                    *
 * ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}
const sendJson = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(WEB, rel);
  if (!file.startsWith(WEB)) return send(res, 403, 'text/plain', 'forbidden');
  fs.readFile(file, (err, body) => {
    if (err) return send(res, 404, 'text/plain', 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/config') {
      const { port, ...client } = config;
      return sendJson(res, 200, client);
    }
    if (url.pathname === '/api/menu') {
      const lang = url.searchParams.get('lang') === 'de' ? 'de' : 'en';
      const ttl = (config.refresh?.menuMinutes ?? 30) * 60000;
      return sendJson(res, 200, await cached('menu:' + lang, ttl, () => getMenu(lang)));
    }
    if (url.pathname === '/api/tram') {
      const ttl = Math.max(10, config.refresh?.tramSeconds ?? 20) * 1000;
      return sendJson(res, 200, await cached('tram', ttl, getTram));
    }
    if (url.pathname === '/api/news') {
      const ttl = (config.refresh?.newsMinutes ?? 10) * 60000;
      return sendJson(res, 200, await cached('news', ttl, getNews));
    }
    if (url.pathname === '/api/ram-prices') {
      return sendJson(res, 200, readPriceHistory());
    }
    if (url.pathname === '/api/image') {
      return proxyImage(url.searchParams.get('u') || '', res);
    }
    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, uptime: process.uptime(), cached: [...cache.keys()] });
    }
    return serveStatic(url.pathname, res);
  } catch (err) {
    log('request failed', url.pathname, err.message);
    return sendJson(res, 502, { error: err.message });
  }
});

server.listen(PORT, () => log(`monitor server on http://localhost:${PORT}`));
