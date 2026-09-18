import { el, getJson, makeTimers, minutesOf, nowMinutes } from '../util.js';

/**
 * The default board: a full-bleed news slideshow, with the clock and the
 * day's schedule reduced to a top bar — the SBB platform-display layout.
 */
/** Where the slideshow had got to, so returning to the board resumes
 *  instead of replaying the same top stories every rotation. */
let resumeAt = 0;

export default function clockPage(cfg) {
  const timers = makeTimers();
  const root = el('div', { class: 'page board-page' });

  const t = el('div', { class: 'bar-time' });
  const d = el('div', { class: 'bar-date' });
  const slots = el('div', { class: 'bar-slots' });

  const shot = el('div', { class: 'shot' });
  const kicker = el('div', { class: 'kicker' });
  const headline = el('h2', { class: 'headline' });
  const teaser = el('p', { class: 'teaser' });
  const progress = el('i', { class: 'bar' });
  const ticker = el('div', { class: 'ticker-track' });

  root.append(
    el('div', { class: 'topbar' },
      el('div', { class: 'bar-clock' }, t, d),
      slots,
    ),
    el('article', { class: 'news hero' },
      shot,
      el('div', { class: 'news-body' }, kicker, headline, teaser),
      el('div', { class: 'progress' }, progress),
    ),
    el('div', { class: 'ticker' }, ticker),
  );

  const LABEL = { mensa: 'Mensa', tram: 'Tram', ram: 'RAM' };

  function renderClock() {
    const now = new Date();
    t.textContent = now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    d.textContent = now.toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'long' });

    const m = nowMinutes(now);
    slots.innerHTML = '';
    for (const slot of cfg.schedule || []) {
      const from = minutesOf(slot.from), to = minutesOf(slot.to);
      const live = m >= from && m <= to;
      const mins = from - m;
      const when = live ? 'jetzt'
        : mins > 0 ? `in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
        : 'vorbei';
      slots.append(el('div', { class: `slot ${live ? 'live' : ''} ${mins < 0 && !live ? 'past' : ''}` },
        el('b', {}, LABEL[slot.page] || slot.page),
        el('span', {}, `${slot.from}–${slot.to}`),
        el('em', {}, when),
      ));
    }
  }

  /* ---------------- news ---------------- */
  let news = null;
  let idx = 0;
  let shownAt = 0;

  const relTime = (ts) => {
    if (!ts) return '';
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 60) return `vor ${Math.max(1, mins)} Min.`;
    const h = Math.round(mins / 60);
    return h < 24 ? `vor ${h} Std.` : `vor ${Math.round(h / 24)} Tg.`;
  };

  function showStory(i) {
    if (!news || !news.items.length) return;
    idx = ((i % news.items.length) + news.items.length) % news.items.length;
    resumeAt = idx;
    const story = news.items[idx];
    shownAt = Date.now();

    shot.style.backgroundImage = story.image ? `url("${story.image}")` : '';
    shot.classList.toggle('empty', !story.image);
    shot.style.animation = 'none';
    void shot.offsetWidth;            // restart the slow zoom on every slide
    shot.style.animation = '';

    kicker.innerHTML = '';
    kicker.append(
      el('span', { class: 'badge-src' }, news.source),
      el('span', {}, relTime(story.published)),
      el('span', { class: 'count' }, `${idx + 1}/${news.items.length}`),
    );
    headline.textContent = story.title;
    teaser.textContent = story.summary || '';

    const next = news.items[(idx + 1) % news.items.length];
    if (next && next.image) new Image().src = next.image;
  }

  function renderTicker() {
    if (!news) return;
    const titles = news.items.map((s) => s.title);
    ticker.innerHTML = '';
    for (let pass = 0; pass < 2; pass++) {
      for (const title of titles) ticker.append(el('span', { class: 'tick' }, el('i', {}), title));
    }
    ticker.style.animationDuration = `${Math.max(40, titles.join('').length * 0.28)}s`;
  }

  function tickProgress() {
    const period = (cfg.news?.rotationSeconds || 20) * 1000;
    const elapsed = Date.now() - shownAt;
    progress.style.width = `${Math.min(100, (elapsed / period) * 100)}%`;
    if (elapsed >= period) showStory(idx + 1);
  }

  async function loadNews(first = false) {
    news = await getJson('/api/news');
    renderTicker();
    showStory(first ? resumeAt + 1 : idx);
  }

  return {
    id: 'clock',
    title: 'Board',
    async mount(stage) {
      stage.append(root);
      timers.every(1000, renderClock);
      try {
        await loadNews(true);
      } catch (err) {
        console.error('news unavailable', err);
        headline.textContent = 'Keine Nachrichten verfügbar';
        teaser.textContent = String(err.message);
        shot.classList.add('empty');
      }
      timers.every(250, tickProgress, false);
      timers.every((cfg.refresh?.newsMinutes ?? 10) * 60000,
        () => loadNews().catch(console.error), false);
    },
    unmount() { timers.clear(); root.remove(); },
  };
}
