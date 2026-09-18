import { el, getJson, chf, makeTimers } from '../util.js';

function tagFor(classes = []) {
  const lower = classes.map((c) => (c || '').toLowerCase());
  for (const key of ['vegan', 'vegetarian', 'fish', 'meat']) {
    if (lower.some((c) => c.includes(key))) return key;
  }
  return null;
}

function dishCard(dish, alt) {
  const tag = tagFor(dish.classes);
  const thumb = el('div', {
    class: 'thumb',
    style: dish.image ? { backgroundImage: `url("${dish.image}")` } : {},
  }, dish.image ? '' : '🍽');

  return el('article', { class: 'dish' },
    thumb,
    el('div', { class: 'body' },
      el('div', { class: 'line-name' }, dish.line || dish.mealTime),
      el('h3', {}, dish.name, alt && alt.name && alt.name !== dish.name ? el('span', { class: 'alt' }, alt.name) : null),
      el('p', {}, dish.description),
      el('div', { class: 'meta' },
        dish.price != null ? el('div', { class: 'price' }, el('small', {}, 'CHF'), chf(dish.price)) : null,
        tag ? el('span', { class: `tag ${tag}` }, tag) : null,
        dish.energy ? el('span', { class: 'tag kcal' }, `${dish.energy} kcal`) : null,
      ),
    ),
  );
}

function venueCard(fac, altFac, maxDishes) {
  const body = fac.open && fac.meals.length
    ? el('div', { class: 'dishes' },
        fac.meals.slice(0, maxDishes).map((d, i) => dishCard(d, altFac?.meals?.[i])))
    : el('div', { class: 'closed' },
        el('span', {}, '🕐'),
        el('div', {}, fac.reason === 'closed today' ? 'Closed today · Heute geschlossen' : 'No menu published · Kein Menü'),
      );

  return el('section', { class: 'venue' },
    el('header', {},
      el('h2', {}, fac.label),
      el('span', { class: 'venue-sub' }, fac.sub || ''),
      el('span', { class: 'hours' }, fac.hours || ''),
    ),
    body,
  );
}

export default function mensaPage(cfg) {
  const timers = makeTimers();
  const root = el('div', { class: 'page' });
  let primaryLang = 'en';
  let data = { en: null, de: null };

  const head = el('div', { class: 'head' },
    el('h1', {}, 'Lunch today'),
    el('span', { class: 'sub' }, 'Mittagsmenü · ETH Zentrum'),
    el('div', { class: 'right' }),
  );
  const grid = el('div', { class: 'mensa-grid' });
  grid.style.setProperty('--cols', String(cfg.mensa.facilities.length));
  root.append(head, el('div', { class: 'rule' }), grid);

  function render() {
    const main = data[primaryLang];
    const alt = data[primaryLang === 'en' ? 'de' : 'en'];
    if (!main) return;
    head.querySelector('h1').textContent = primaryLang === 'en' ? 'Lunch today' : 'Mittagessen heute';
    head.querySelector('.sub').textContent = primaryLang === 'en' ? 'Menu · ETH Zentrum' : 'Menü · ETH Zentrum';
    head.querySelector('.right').innerHTML = '';
    head.querySelector('.right').append(
      el('strong', {}, new Date().toLocaleDateString(primaryLang === 'en' ? 'en-GB' : 'de-CH',
        { weekday: 'long', day: 'numeric', month: 'long' })),
      el('div', {}, cfg.mensa.priceGroup === 'students'
        ? (primaryLang === 'en' ? 'student prices' : 'Studierendenpreise')
        : cfg.mensa.priceGroup),
    );

    // Fit dish count to available height: ~ one card per 16vmin of panel.
    const maxDishes = Math.max(2, Math.min(5, Math.floor(grid.clientHeight / (window.innerHeight * 0.20)) || 4));
    grid.innerHTML = '';
    main.facilities.forEach((fac, i) => grid.append(venueCard(fac, alt?.facilities?.[i], maxDishes)));
  }

  async function load() {
    const [en, de] = await Promise.all([
      getJson('/api/menu?lang=en').catch(() => null),
      getJson('/api/menu?lang=de').catch(() => null),
    ]);
    if (!en && !de) throw new Error('menu unavailable');
    data = { en: en || de, de: de || en };
    render();
  }

  return {
    id: 'mensa',
    title: 'Mensa',
    async mount(stage) {
      stage.append(root);
      await load();
      timers.every((cfg.refresh?.menuMinutes ?? 30) * 60000, () => load().catch(console.error), false);
      timers.every((cfg.mensa.languageSwapSeconds ?? 12) * 1000, () => {
        primaryLang = primaryLang === 'en' ? 'de' : 'en';
        render();
      }, false);
    },
    unmount() { timers.clear(); root.remove(); },
  };
}
