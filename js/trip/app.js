/**
 * Страница «Капсула в поездку»: форма поездки, капсула с закреплением и исключением вещей,
 * план по дням и чек-лист сборов. Состояние хранится в localStorage, поэтому собранная капсула
 * открывается и без сети.
 */
import {esc} from '../ui/templates.js';
import {formatTemp} from '../lib/temperature.js';
import {
  DEFAULT_LUGGAGE,
  LUGGAGE,
  SLOT_TITLES,
  buildCapsule,
  buildPool,
  capsuleSlot,
  manualDays,
  planDays,
  SEASON_LABELS,
  seasonOf,
} from './capsule.js';
import {searchPlaces, tripWeather} from './forecast.js';

const STORAGE_KEY = 'garderob-trip';
const SLOT_ORDER = ['o', 'm', 't', 'b', 's', 'h', 'sc'];
const doc = document;
const $ = (id) => doc.getElementById(id);

const defaults = () => {
  const start = new Date();
  start.setDate(start.getDate() + 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return {
    mode: 'place',
    query: '',
    place: null,
    start: iso(start),
    end: iso(end),
    manual: {days: 7, tmin: 12, tmax: 20, rain: false},
    luggage: DEFAULT_LUGGAGE,
    bags: {backpack: true, suitcase: true},
    event: false,
    travelShoe: '',
    built: false,
    pinned: [],
    excluded: [],
    packed: [],
    weather: null,
  };
};

const BAGS = [
  {key: 'backpack', label: 'Рюкзак'},
  {key: 'suitcase', label: 'Маленький чемодан'},
];

/** Лимиты задаёт чемодан: с ним одежда едет в нём, без него всё в рюкзаке. */
const luggageFor = (bags) => (bags.suitcase ? 'carryon' : 'backpack');

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const saved = {...defaults(), ...raw};
    if (!LUGGAGE[saved.luggage]) {
      saved.luggage = DEFAULT_LUGGAGE;
    }
    /* Раньше багаж был одним выбором: «Рюкзак» значит только рюкзак, остальное значит рюкзак и чемодан */
    if (!raw.bags || (!saved.bags.backpack && !saved.bags.suitcase)) {
      saved.bags = {backpack: true, suitcase: saved.luggage !== 'backpack'};
    }
    saved.luggage = luggageFor(saved.bags);
    return saved;
  } catch {
    return defaults();
  }
}

let state = load();
let pool = null;
let lastCapsule = null;
let lastPlan = [];

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* без хранилища капсула просто не запоминается */
  }
}

const status = (text) => {
  $('status').textContent = text;
};

const dot = (item) =>
  `<span class="dot${item.hex ? '' : ' nc'}"${item.hex ? ` style="--swatch:${esc(item.hex)}"` : ''}></span>`;
const miniDot = (item) =>
  `<i class="cd${item.hex ? '' : ' nc'}"${item.hex ? ` style="--swatch:${esc(item.hex)}"` : ''}></i>`;

const PIN_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 4 4v2h-5v6l-1 1-1-1v-6H6v-2l4-4z" fill="currentColor"/></svg>';
const SWAP_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function weekday(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {weekday: 'short', day: 'numeric', month: 'short'});
}

/* ---------- форма ---------- */

const placeLabel = (place) => `${place.name}${place.country ? `, ${place.country}` : ''}`;

/** Переключатели режима и багажа. Поля ввода здесь не трогаются, чтобы не сбросить то, что уже введено. */
function renderForm() {
  const season = manualSeason();
  $('season').innerHTML = Object.entries(SEASON_LABELS)
    .map(
      ([key, label]) => `<button type="button" data-season="${key}" aria-pressed="${key === season}">${label}</button>`,
    )
    .join('');
  doc
    .querySelectorAll('#mode button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  $('place-fields').hidden = state.mode !== 'place';
  $('manual-fields').hidden = state.mode !== 'manual';
  $('luggage').innerHTML = BAGS.map(
    (bag) =>
      `<button type="button" data-bag="${bag.key}" aria-pressed="${!!state.bags[bag.key]}">${esc(bag.label)}</button>`,
  ).join('');
}

/** Поля ввода заполняются из сохранённого состояния один раз, при открытии страницы. */
function fillInputs() {
  $('q').value = state.place ? placeLabel(state.place) : state.query;
  $('start').value = state.start;
  $('end').value = state.end;
  $('days').value = state.manual.days;
  $('tmin').value = state.manual.tmin;
  $('tmax').value = state.manual.tmax;
  $('rain').checked = state.manual.rain;
  $('event').checked = state.event;
  pool = pool || buildPool();
  const shoes = Object.values(pool.items)
    .filter((item) => item.slot === 's')
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  $('travel-shoe').innerHTML =
    '<option value="">Нет, еду в одной из пар капсулы</option>' +
    shoes.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}, ${esc(item.colorName)}</option>`).join('');
  $('travel-shoe').value = pool.items[state.travelShoe] ? state.travelShoe : '';
}

/** Сезон ручного режима: выбранный или по сегодняшнему месяцу. */
const manualSeason = () => state.manual.season || seasonOf(new Date().toISOString().slice(0, 10));

function readForm() {
  state.start = $('start').value;
  state.end = $('end').value;
  state.manual = {
    season: state.manual.season,
    days: Number($('days').value) || 1,
    tmin: Number($('tmin').value),
    tmax: Number($('tmax').value),
    rain: $('rain').checked,
  };
}

function renderPlaces(list) {
  const box = $('places');
  if (!list.length) {
    box.hidden = false;
    box.innerHTML = '<p class="note">Ничего не нашлось. Попробуй по-другому или по-английски.</p>';
    return;
  }
  box.hidden = false;
  box.innerHTML = list
    .map(
      (p, i) =>
        `<button type="button" class="btn place" data-i="${i}">${esc(p.name)}<span>${esc([p.admin, p.country].filter(Boolean).join(', '))}</span></button>`,
    )
    .join('');
  box.onclick = (event) => {
    const button = event.target.closest('[data-i]');
    if (!button) {
      return;
    }
    state.place = list[Number(button.dataset.i)];
    state.query = state.place.name;
    box.hidden = true;
    $('q').value = placeLabel(state.place);
    save();
    refreshWeather();
  };
}

let searchToken = 0;
let searchTimer = null;

/** Подсказки места по мере ввода: запрос уходит через 300 мс после последней буквы. */
async function findPlace() {
  const query = $('q').value.trim();
  if (query.length < 2) {
    $('places').hidden = true;
    return;
  }
  state.query = query;
  const token = ++searchToken;
  try {
    const list = await searchPlaces(query);
    if (token !== searchToken || state.place) {
      return;
    }
    renderPlaces(list);
    status('');
  } catch {
    if (token === searchToken) {
      status('Без сети место не найти. Можно задать погоду вручную.');
    }
  }
}

function suggestPlaces() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(findPlace, 300);
}

let weatherToken = 0;

/** Погода для выбранного места и дат и краткая сводка под формой. */
async function refreshWeather() {
  readForm();
  const box = $('wx-preview');
  if (!state.place || !state.start || !state.end || state.end < state.start) {
    box.hidden = true;
    return false;
  }
  const token = ++weatherToken;
  box.hidden = false;
  box.textContent = 'Смотрю погоду…';
  try {
    const weather = await tripWeather(state.place, state.start, state.end);
    if (token !== weatherToken) {
      return false;
    }
    state.weather = {...weather, place: state.place.name, start: state.start, end: state.end};
    save();
    renderWeatherPreview();
    return true;
  } catch {
    if (token === weatherToken) {
      box.textContent = 'Погоду получить не удалось. Проверь сеть или задай погоду вручную.';
    }
    return false;
  }
}

function renderWeatherPreview() {
  const box = $('wx-preview');
  const w = state.weather;
  if (!w || !state.place || w.place !== state.place.name || w.start !== state.start || w.end !== state.end) {
    box.hidden = true;
    return;
  }
  const days = w.days;
  const highs = days.map((d) => d.tmax);
  const lows = days.map((d) => d.tmin);
  const rainy = days.filter((d) => d.rain).length;
  const seasons = [...new Set(days.map((d) => SEASON_LABELS[seasonOf(d.date)]))].join(' и ').toLowerCase();
  const source =
    w.source === 'forecast' ? 'прогноз' : `ориентир по тем же датам ${w.year} года, прогноза так далеко ещё нет`;
  box.hidden = false;
  box.innerHTML =
    `<span><b>${esc(placeLabel(state.place))}</b>, ${esc(weekday(w.start))} — ${esc(weekday(w.end))}</span>` +
    `<span>Днём ${formatTemp(Math.min(...highs))}…${formatTemp(Math.max(...highs))} °C, ночью ${formatTemp(Math.min(...lows))}…${formatTemp(Math.max(...lows))} °C (ощущается)</span>` +
    `<span>${rainy ? `Дождь ${rainy} ${rainy === 1 ? 'день' : rainy < 5 ? 'дня' : 'дней'} из ${days.length}` : 'Без дождя'} · сезон: ${esc(seasons)}</span>` +
    `<small>${esc(source)}</small>`;
}

/* ---------- сборка ---------- */

function tripDays() {
  if (state.mode === 'manual') {
    return manualDays({...state.manual, season: manualSeason()});
  }
  return state.weather ? state.weather.days.map((day) => ({...day, season: seasonOf(day.date)})) : [];
}

async function submit() {
  readForm();
  if (state.mode === 'place') {
    if (!state.place) {
      status('Начни вводить город и выбери его из подсказок.');
      return;
    }
    if (!state.start || !state.end || state.end < state.start) {
      status('Проверь даты поездки.');
      return;
    }
    status('Смотрю погоду…');
    const ok = await refreshWeather();
    if (!ok) {
      if (!state.weather) {
        status('Погоду получить не удалось. Можно задать её вручную.');
        return;
      }
      status('Погоду обновить не удалось, беру сохранённую.');
    }
  }
  save();
  rebuild();
}

function rebuild() {
  const days = tripDays();
  if (!days.length) {
    return;
  }
  status('Собираю капсулу…');
  setTimeout(() => {
    pool = pool || buildPool();
    const capsule = buildCapsule(pool, days, {
      luggage: state.luggage,
      event: state.event,
      travelShoe: state.travelShoe,
      pinned: state.pinned,
      excluded: state.excluded,
    });
    const plan = planDays(pool, capsule, days);
    state.packed = state.packed.filter((id) => id.startsWith('x:') || capsule.ids.includes(id));
    state.built = true;
    save();
    renderResult(capsule, plan, days);
    status('');
  }, 30);
}

/* ---------- результат ---------- */

/** В дорогу надевается самое тёплое: куртка и обувь с самой низкой нижней границей. */
/** Вещи сверх лимитов: под мероприятие и для дороги. */
const extraTag = (capsule, id) =>
  capsule.eventItems.includes(id) ? 'для мероприятия' : capsule.travelItems.includes(id) ? 'только в дорогу' : '';

function travelWear(capsule) {
  const lowest = (slot, low) =>
    capsule.ids
      .filter((id) => capsuleSlot(pool.items[id]) === slot && !extraTag(capsule, id))
      .sort((a, b) => low(pool.items[a]) - low(pool.items[b]))[0];
  const shoeLow = (s) => Math.min(...[s.dry, s.rain].filter(Boolean).map((r) => r[0]));
  const shoe = capsule.travelItems[0] || lowest('s', shoeLow);
  return [lowest('o', (o) => o.minTemp), shoe].filter(Boolean);
}

function renderStats(capsule, days) {
  const clothes = capsule.ids.filter((id) => !['h', 'sc'].includes(pool.items[id].slot)).length;
  const temps = days.map((d) => d.t);
  const rainy = days.filter((d) => d.rain).length;
  $('stats').innerHTML = [
    [capsule.ids.length, 'вещей', `из них ${clothes} одежда и обувь`],
    [capsule.outfits.length, 'сочетаний', 'без цветовых конфликтов'],
    [
      days.length,
      days.length === 1 ? 'день' : 'дней',
      `${formatTemp(Math.min(...temps))}…${formatTemp(Math.max(...temps))} °C${rainy ? `, дождь ${rainy}` : ''}`,
    ],
  ]
    .map(([n, label, sub]) => `<div class="stat"><b>${n}</b><span>${label}</span><small>${esc(sub)}</small></div>`)
    .join('');

  const w = state.mode === 'place' && state.weather;
  $('wx').innerHTML = w
    ? `<p class="note">${esc(w.place)}, ${esc(weekday(w.start))} — ${esc(weekday(w.end))}${weekday(w.end).endsWith('.') ? '' : '.'} ${
        w.source === 'forecast'
          ? 'Прогноз Open-Meteo, ощущаемая температура днём.'
          : `Прогноза на эти даты ещё нет, взята погода тех же дат ${w.year} года как ориентир. Ближе к поездке пересобери.`
      }</p>`
    : '<p class="note">Погода задана вручную: температуры разложены по дням от тёплых к прохладным.</p>';

  const lines = [];
  if (days.some((day) => day.season === 'spring')) {
    lines.push('Весенних вещей в гардеробе пока нет: на весенние дни берутся вещи, отмеченные на осень.');
  }
  const name = (c) => `${formatTemp(c.t)}${c.rain ? ' в дождь' : ''}`;
  if (capsule.impossible.length) {
    lines.push(`Для ${capsule.impossible.map(name).join(', ')} в гардеробе нет подходящего образа.`);
  }
  const tight = capsule.gaps.filter((g) => !capsule.impossible.includes(g) && !capsule.replacedGaps.includes(g));
  if (capsule.replacedGaps.length) {
    lines.push(
      `Для ${capsule.replacedGaps.map(name).join(', ')} всё подходящее уже заменено. Верни одну из заменённых вещей.`,
    );
  }
  if (capsule.outerShort && !capsule.replacedGaps.length) {
    lines.push(
      'Курток и жилеток, которые подходят под всю погоду поездки, больше не осталось. Верни одну из заменённых.',
    );
  } else if (tight.length) {
    lines.push(`Для ${tight.map(name).join(', ')} образ не уместился в лимит багажа, попробуй добавить чемодан.`);
  }
  $('gaps').hidden = !lines.length;
  $('gaps').textContent = lines.join(' ');
}

function renderCapsule(capsule) {
  const usage = {};
  capsule.outfits.forEach((outfit) =>
    outfit.ids.forEach((id) => {
      usage[id] = (usage[id] || 0) + 1;
    }),
  );
  const wear = travelWear(capsule);
  const bySlot = {};
  capsule.ids.forEach((id) => {
    const slot = capsuleSlot(pool.items[id]);
    (bySlot[slot] = bySlot[slot] || []).push(pool.items[id]);
  });
  $('capsule').innerHTML = SLOT_ORDER.filter((slot) => bySlot[slot])
    .map((slot) => {
      const cards = bySlot[slot]
        .map((item) => {
          const pinned = state.pinned.includes(item.id);
          const tags = [
            usage[item.id] ? `в ${usage[item.id]} сочет.` : '',
            wear.includes(item.id) ? 'надеть в дорогу' : '',
            extraTag(capsule, item.id),
          ].filter(Boolean);
          if (extraTag(capsule, item.id)) {
            return `<div class="card tcard">${dot(item)}<span class="nm">${esc(item.name)}</span><span class="meta"><span>${esc(item.colorName)}</span>${tags.map((t) => `<span class="tg">${esc(t)}</span>`).join('')}</span></div>`;
          }
          return (
            `<div class="card tcard${pinned ? ' pinned' : ''}">${dot(item)}<span class="nm">${esc(item.name)}</span>` +
            `<span class="meta"><span>${esc(item.colorName)}</span>${tags.map((t) => `<span class="tg">${esc(t)}</span>`).join('')}</span>` +
            `<span class="acts"><button type="button" class="ib" data-pin="${esc(item.id)}" aria-pressed="${pinned}" aria-label="${pinned ? 'Открепить' : 'Закрепить'}: ${esc(item.name)}" title="${pinned ? 'Открепить' : 'Беру точно'}">${PIN_ICON}</button>` +
            `<button type="button" class="ib" data-ex="${esc(item.id)}" aria-label="Заменить: ${esc(item.name)}" title="Заменить">${SWAP_ICON}</button></span></div>`
          );
        })
        .join('');
      const limit = capsule.limits[slot];
      /* Пара для дороги считается в лимите обуви, пара под мероприятие идёт сверх него */
      const daily = bySlot[slot].filter((item) => !capsule.eventItems.includes(item.id)).length;
      const extra = bySlot[slot].length - daily;
      const counter = limit
        ? ` <span class="cnt">${daily} из ${limit}${extra ? ` + ${extra} сверх лимита` : ''}</span>`
        : '';
      return `<div class="grp"><h3>${SLOT_TITLES[slot]}${counter}</h3><div class="cards">${cards}</div></div>`;
    })
    .join('');

  const excluded = state.excluded.filter((id) => pool.items[id]);
  $('excluded-wrap').hidden = !excluded.length;
  $('excluded').innerHTML = excluded
    .map(
      (id) =>
        `<button type="button" class="chip chip--btn" data-back="${esc(id)}" title="Вернуть">${miniDot(pool.items[id])}${esc(pool.items[id].name)} ↺</button>`,
    )
    .join('');
}

function renderPlan(plan) {
  $('plan').innerHTML = plan
    .map(({day, outfit, shoe, travel, tee, head, scarf}, index) => {
      const title = day.date ? weekday(day.date) : `День ${index + 1}`;
      const range = day.tmin != null ? `<small>${formatTemp(day.tmin)}…${formatTemp(day.tmax)}</small>` : '';
      const badge =
        (travel ? '<span class="road">в дороге</span>' : '') + (day.rain ? '<span class="rainy">дождь</span>' : '');
      if (!outfit) {
        return `<article class="day"><header><b>${esc(title)}</b><span class="t">${formatTemp(day.t)}°${range}</span>${badge}</header><p class="note">Нет образа из капсулы на эту погоду.</p></article>`;
      }
      const ids = [outfit.o !== 'none' ? outfit.o : null, tee, outfit.m, outfit.b, shoe, head, scarf].filter(Boolean);
      const unique = [...new Set(ids)];
      const items = unique
        .map(
          (id) =>
            `<li>${miniDot(pool.items[id])}<span>${esc(pool.items[id].name)} <em>${esc(pool.items[id].colorName)}</em></span></li>`,
        )
        .join('');
      const swatches = unique.map((id) => miniDot(pool.items[id])).join('');
      return (
        `<article class="day"><header><b>${esc(title)}</b><span class="t">${formatTemp(day.t)}°${range}</span>${badge}</header>` +
        `<div class="dots">${swatches}</div><ul>${items}</ul></article>`
      );
    })
    .join('');
}

/**
 * Чек-лист по местам: что надеть в дорогу, что в рюкзак, что в чемодан.
 * Small куб с бельём и носками едет в рюкзаке, футболки и средний слой в Medium кубе.
 */
function packSections(capsule) {
  const days = lastPlan.length;
  const wearIds = [];
  const first = lastPlan[0];
  if (first && first.outfit) {
    [
      first.outfit.o !== 'none' ? first.outfit.o : null,
      first.tee,
      first.outfit.m,
      first.outfit.b,
      first.shoe,
      first.head,
      first.scarf,
    ]
      .filter(Boolean)
      .forEach((id) => wearIds.push(id));
  }
  /* Самую объёмную куртку и обувь везём на себе, даже если первый день тёплый */
  travelWear(capsule).forEach((id) => {
    if (!wearIds.includes(id) && !(first && first.outfit && capsuleSlot(pool.items[id]) === 's')) {
      wearIds.unshift(id);
    }
  });
  const rest = SLOT_ORDER.flatMap((slot) =>
    capsule.ids.filter((id) => capsuleSlot(pool.items[id]) === slot && !wearIds.includes(id)),
  );
  const cube = rest.filter((id) => ['t', 'm'].includes(capsuleSlot(pool.items[id])));
  const loose = rest.filter((id) => !cube.includes(id));
  const underwear = Math.min(days || 1, 7);
  const basics = [
    {id: 'x:tech', text: 'Техника и зарядки'},
    {id: 'x:wash', text: 'Туалетный набор'},
    {id: 'x:under', text: `Small куб: трусы и носки × ${underwear}`},
  ];
  const {backpack, suitcase} = state.bags;
  let sections;
  if (backpack && suitcase) {
    sections = [
      {title: 'Рюкзак', items: basics},
      {title: 'Чемодан: Medium куб', items: cube},
      {title: 'Чемодан: остальное', items: loose},
    ];
  } else if (suitcase) {
    sections = [
      {title: 'Чемодан: техника и мелочи', items: basics},
      {title: 'Чемодан: Medium куб', items: cube},
      {title: 'Чемодан: остальное', items: loose},
    ];
  } else {
    sections = [{title: 'Рюкзак', items: [...basics, ...cube, ...loose]}];
  }
  return [{title: 'На себе в дорогу', items: wearIds}, ...sections].filter((section) => section.items.length);
}

function renderPack(capsule) {
  const wear = travelWear(capsule);
  const sections = packSections(capsule);
  const row = (entry) => {
    const id = typeof entry === 'string' ? entry : entry.id;
    const done = state.packed.includes(id);
    let body;
    if (typeof entry === 'string') {
      const item = pool.items[id];
      const tag = extraTag(capsule, id);
      body = `${miniDot(item)}<span>${esc(item.name)} <em>${esc(item.colorName)}</em>${tag ? ` <span class="tg">${tag}</span>` : ''}</span>`;
    } else {
      body = `<i class="cd nc"></i><span>${esc(entry.text)}</span>`;
    }
    return `<li><label class="${done ? 'done' : ''}"><input type="checkbox" data-pack="${esc(id)}"${done ? ' checked' : ''} />${body}</label></li>`;
  };
  $('pack').innerHTML = sections
    .map((section) => `<li class="pack-h">${esc(section.title)}</li>${section.items.map(row).join('')}`)
    .join('');
  const all = sections.flatMap((section) => section.items.map((e) => (typeof e === 'string' ? e : e.id)));
  const left = all.filter((id) => !state.packed.includes(id)).length;
  $('pack-hint').textContent = left ? `Осталось уложить: ${left}. Отметки сохраняются на телефоне.` : 'Всё уложено.';
  return wear;
}

function renderResult(capsule, plan, days) {
  $('out').hidden = false;
  renderStats(capsule, days);
  renderCapsule(capsule);
  renderPlan(plan);
  lastCapsule = capsule;
  lastPlan = plan;
  renderPack(capsule);
}

/* ---------- события ---------- */

function toggle(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function bind() {
  $('mode').addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (button) {
      readForm();
      state.mode = button.dataset.mode;
      save();
      renderForm();
    }
  });
  $('luggage').addEventListener('click', (event) => {
    const button = event.target.closest('[data-bag]');
    if (button) {
      readForm();
      const key = button.dataset.bag;
      const next = {...state.bags, [key]: !state.bags[key]};
      if (!next.backpack && !next.suitcase) {
        return;
      }
      state.bags = next;
      state.luggage = luggageFor(next);
      save();
      renderForm();
      if (lastCapsule) {
        rebuild();
      }
    }
  });
  $('q').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const first = $('places').querySelector('[data-i]');
      if (first && !$('places').hidden) {
        first.click();
      }
    }
  });
  $('q').addEventListener('input', () => {
    state.place = null;
    state.query = $('q').value.trim();
    $('wx-preview').hidden = true;
    save();
    suggestPlaces();
  });
  $('season').addEventListener('click', (event) => {
    const button = event.target.closest('[data-season]');
    if (button) {
      state.manual.season = button.dataset.season;
      save();
      renderForm();
      if (lastCapsule) {
        rebuild();
      }
    }
  });
  /* Даты и ручная погода запоминаются сразу, без нажатия «Собрать капсулу» */
  $('travel-shoe').addEventListener('change', () => {
    state.travelShoe = $('travel-shoe').value;
    save();
    if (lastCapsule) {
      rebuild();
    }
  });
  $('event').addEventListener('change', () => {
    state.event = $('event').checked;
    save();
    if (lastCapsule) {
      rebuild();
    }
  });
  $('form').addEventListener('change', (event) => {
    if (event.target.matches('#start, #end, #days, #tmin, #tmax, #rain')) {
      readForm();
      save();
      if (event.target.matches('#start, #end') && state.place) {
        refreshWeather();
      }
    }
  });
  $('form').addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  $('capsule').addEventListener('click', (event) => {
    const pin = event.target.closest('[data-pin]');
    const ex = event.target.closest('[data-ex]');
    if (pin) {
      state.pinned = toggle(state.pinned, pin.dataset.pin);
    } else if (ex) {
      state.excluded = [...state.excluded, ex.dataset.ex];
      state.pinned = state.pinned.filter((id) => id !== ex.dataset.ex);
    } else {
      return;
    }
    save();
    rebuild();
  });
  $('excluded').addEventListener('click', (event) => {
    const back = event.target.closest('[data-back]');
    if (back) {
      state.excluded = state.excluded.filter((id) => id !== back.dataset.back);
      save();
      rebuild();
    }
  });
  $('pack').addEventListener('change', (event) => {
    const box = event.target.closest('[data-pack]');
    if (box) {
      state.packed = toggle(state.packed, box.dataset.pack);
      save();
      renderPack(lastCapsule);
    }
  });
  $('reset').addEventListener('click', () => {
    if (!window.confirm('Сбросить всё: поездку, закреплённые и заменённые вещи, отметки сборов?')) {
      return;
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* без хранилища просто начинаем заново */
    }
    state = defaults();
    lastCapsule = null;
    lastPlan = [];
    $('out').hidden = true;
    $('places').hidden = true;
    $('wx-preview').hidden = true;
    status('');
    renderForm();
    fillInputs();
  });
  $('unpack').addEventListener('click', () => {
    state.packed = [];
    save();
    renderPack(lastCapsule);
  });
}

renderForm();
fillInputs();
bind();
renderWeatherPreview();
if (state.built) {
  rebuild();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
