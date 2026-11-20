/**
 * Страница «Капсула в поездку»: форма поездки, капсула с закреплением и исключением вещей,
 * план по дням и чек-лист сборов. Состояние хранится в localStorage, поэтому собранная капсула
 * открывается и без сети.
 */
import {esc, formatTemp, swatchBackground} from './wardrobe.js';
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
  TRIP_RULES,
} from './capsule.js';
import {searchPlaces, tripWeather} from './forecast.js';

const STORAGE_KEY = 'garderob-trip';
/* Обувь первой: капсула собирается вокруг неё */
const SLOT_ORDER = ['s', 'o', 'm', 't', 'b', 'h', 'sc'];
const doc = document;
const $ = (id) => doc.getElementById(id);

/** Сегодняшняя дата по местному времени, YYYY-MM-DD. */
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* По умолчанию поездка начинается сегодня, дату возвращения выбираешь сам */
const defaults = () => {
  return {
    mode: 'place',
    query: '',
    place: null,
    start: todayIso(),
    end: '',
    manual: {days: 7, tmin: 12, tmax: 20, rain: false},
    luggage: DEFAULT_LUGGAGE,
    bags: {backpack: true, suitcase: true},
    event: false,
    /* Рюкзак или сумка поверх куртки: вощёные куртки не берутся */
    bagsOver: true,
    travelShoe: '',
    built: false,
    pinned: [],
    /* Перебор вариантов по группам: какие вещи уже показаны и пропущены в текущем круге */
    cycle: {},
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
    /* Раньше заменённые вещи копились в отдельном списке; теперь варианты перебираются по кругу */
    delete saved.excluded;
    if (!saved.cycle || typeof saved.cycle !== 'object') {
      saved.cycle = {};
    }
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

/* Плашки цвета как в основном проекте: основной цвет и заметные детали (colors.js там же) */
const swatchStyle = (item) => {
  const background = swatchBackground(item);
  return background ? ` style="--swatch:${esc(background)}"` : '';
};
const dot = (item) => `<span class="dot${item.hex ? '' : ' nc'}"${swatchStyle(item)}></span>`;
const miniDot = (item) => `<i class="cd${item.hex ? '' : ' nc'}"${swatchStyle(item)}></i>`;

const PIN_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 4 4v2h-5v6l-1 1-1-1v-6H6v-2l4-4z" fill="currentColor"/></svg>';
const DROP_ICON =
  '<svg viewBox="0 0 12 16" aria-hidden="true"><path d="M6 1C6 1 1.5 7 1.5 10.2A4.5 4.5 0 0 0 10.5 10.2C10.5 7 6 1 6 1Z" fill="currentColor"/></svg>';
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
  $('end').min = state.start || '';
  $('days').value = state.manual.days;
  $('tmin').value = state.manual.tmin;
  $('tmax').value = state.manual.tmax;
  $('rain').checked = state.manual.rain;
  $('event').checked = state.event;
  $('bags-over').checked = state.bagsOver;
  renderTravelShoes();
}

/** Подходит ли пара под погоду дня: по сезону, температуре и дождю, как в основном гардеробе. */
function shoeFitsDay(id, day) {
  const model = pool.models[day.season];
  const item = model && model.byId[id];
  const t = Math.round(day.t);
  if (!item || t < model.scale.min || t > model.scale.max) {
    return false;
  }
  const mask = day.rain ? item.rainMask : item.dryMask;
  if (!(mask & (1 << (t - model.scale.min)))) {
    return false;
  }
  /* В сухую дорогу без Gore-Tex и челси */
  return day.rain || !TRIP_RULES.notOnDryTravel.includes(id);
}

/**
 * Список пар для дороги. Пары, которые не подходят под погоду первого или последнего дня,
 * показаны, но выбрать их нельзя. Если выбранная пара перестала подходить, выбор сбрасывается.
 */
let pendingShoeNote = '';

function renderTravelShoes() {
  pool = pool || buildPool();
  const days = tripDays();
  const road = days.length ? [days[0], days[days.length - 1]] : [];
  const fits = (id) => road.every((day) => shoeFitsDay(id, day));
  const shoes = Object.values(pool.items)
    .filter((item) => item.slot === 's')
    .map((item) => ({item, ok: fits(item.id)}))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.item.name.localeCompare(b.item.name, 'ru'));
  $('travel-shoe').innerHTML =
    '<option value="">Нет, еду в одной из пар капсулы</option>' +
    shoes
      .map(
        ({item, ok}) =>
          `<option value="${esc(item.id)}"${ok ? '' : ' disabled'}>${esc(item.name)}, ${esc(item.colorName)}${ok ? '' : ' — не по погоде'}</option>`,
      )
      .join('');
  let note = '';
  if (state.travelShoe && !(pool.items[state.travelShoe] && fits(state.travelShoe))) {
    if (pool.items[state.travelShoe]) {
      note = `Пара для дороги сброшена: ${pool.items[state.travelShoe].name} не подходит под погоду в дни дороги.`;
    }
    state.travelShoe = '';
    save();
    pendingShoeNote = note;
  }
  $('travel-shoe').value = state.travelShoe || '';
  return note;
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
    /* Дни дороги: дождь дома (откуда уезжаешь и куда возвращаешься) тоже считается */
    weather.days.forEach((day) => {
      day.destRain = day.rain;
    });
    try {
      const home = await tripWeather(TRIP_RULES.home, state.start, state.end);
      const ends = [0, weather.days.length - 1];
      ends.forEach((i) => {
        const homeDay = home.days[i];
        if (homeDay && weather.days[i]) {
          weather.days[i].homeRain = homeDay.rain;
          weather.days[i].rain = weather.days[i].rain || homeDay.rain;
        }
      });
    } catch {
      /* без погоды дома считаем только место назначения */
    }
    state.weather = {...weather, place: state.place.name, start: state.start, end: state.end, fetchedAt: Date.now()};
    save();
    renderWeatherPreview();
    return true;
  } catch {
    if (token === weatherToken) {
      const w = state.weather;
      const saved = w && w.place === state.place.name && w.start === state.start && w.end === state.end;
      if (saved) {
        /* Без сети показываем последний полученный прогноз, в подписи видно, когда он обновлён */
        renderWeatherPreview();
      } else {
        box.textContent = 'Погоду получить не удалось. Проверь сеть или задай погоду вручную.';
      }
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
  const seasons = [...new Set(days.map((d) => SEASON_LABELS[seasonOf(d.date)]))].join(' и ').toLowerCase();
  const fetched = w.fetchedAt
    ? `, обновлён ${new Date(w.fetchedAt).toLocaleString('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}`
    : '';
  const source =
    w.source === 'forecast'
      ? `прогноз Open-Meteo${fetched}`
      : `ориентир по тем же датам ${w.year} года, прогноза так далеко ещё нет${fetched}`;
  const range = (list) => `${formatTemp(Math.min(...list))}…${formatTemp(Math.max(...list))} °C`;
  /* Лента дней: день недели и число, температура днём и ночью, капля с вероятностью у дождливых */
  const strip = days
    .map((d) => {
      const date = new Date(`${d.date}T12:00:00`);
      const wd = date.toLocaleDateString('ru-RU', {weekday: 'short'});
      const label = `${weekday(d.date)}: днём ${formatTemp(d.tmax)}, ночью ${formatTemp(d.tmin)}${d.rain ? `, дождь${d.probability != null ? ` ${d.probability}%` : ''}` : ''}`;
      return (
        `<li class="wx-cell${d.rain ? ' wet' : ''}" aria-label="${esc(label)}">` +
        `<span class="wx-wd">${esc(wd)}</span><span class="wx-dn">${date.getDate()}</span>` +
        `<span class="wx-hi">${formatTemp(d.tmax)}°</span><span class="wx-lo">${formatTemp(d.tmin)}°</span>` +
        `<span class="wx-rain">${d.rain ? `${DROP_ICON}${d.probability != null ? `${d.probability}%` : ''}` : ''}</span></li>`
      );
    })
    .join('');
  box.hidden = false;
  box.innerHTML =
    `<div class="wx-head"><b>${esc(placeLabel(state.place))}</b><span>${esc(weekday(w.start))} — ${esc(weekday(w.end))}</span></div>` +
    '<dl class="wx-rows">' +
    `<dt>Днём</dt><dd>${range(highs)}</dd>` +
    `<dt>Ночью</dt><dd>${range(lows)}</dd>` +
    `<dt>Сезон</dt><dd>${esc(seasons)}</dd>` +
    '</dl>' +
    `<div class="wx-strip-wrap"><ol class="wx-strip" aria-label="Погода по дням">${strip}</ol></div>` +
    `<small>Ощущаемая температура, ${esc(source)}</small>`;
  /* Список пар для дороги зависит от погоды в дни дороги */
  status(renderTravelShoes() || $('status').textContent);
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
      status(state.end ? 'Дата возвращения раньше даты отъезда.' : 'Выбери дату возвращения.');
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

const cycleExcluded = (cycle) => Object.values(cycle).flat();

function compute(days, cycle) {
  pool = pool || buildPool();
  return buildCapsule(pool, days, {
    luggage: state.luggage,
    event: state.event,
    bagsOver: state.bagsOver,
    travelShoe: state.travelShoe,
    pinned: state.pinned,
    excluded: cycleExcluded(cycle),
  });
}

const slotCount = (capsule, slot) => capsule.ids.filter((id) => capsuleSlot(pool.items[id]) === slot).length;

/**
 * Пересборка капсулы. swap — вещь, на которой нажали «Следующий вариант»: она пропускается в этом круге,
 * и в её группу приходит следующий вариант. Когда подходящих вариантов не остаётся, круг начинается заново
 * с первого варианта. Закрепление вещи завершает перебор в её группе.
 */
function rebuild(swap = null) {
  const days = tripDays();
  if (!days.length) {
    return;
  }
  status('Собираю капсулу…');
  setTimeout(() => {
    /* Сначала проверяем пару для дороги под погоду, потом собираем капсулу */
    const shoeNote = renderTravelShoes();
    let capsule;
    if (swap && lastCapsule) {
      const slot = capsuleSlot(pool.items[swap]);
      const before = lastCapsule;
      const next = {...state.cycle, [slot]: [...(state.cycle[slot] || []), swap]};
      capsule = compute(days, next);
      const exhausted =
        capsule.replacedGaps.length > 0 ||
        capsule.gaps.length > before.gaps.length ||
        slotCount(capsule, slot) < slotCount(before, slot);
      if (exhausted) {
        /* Варианты в группе закончились: по кругу к первому */
        state.cycle = {...state.cycle, [slot]: []};
        capsule = compute(days, state.cycle);
      } else {
        state.cycle = next;
      }
    } else {
      capsule = compute(days, state.cycle);
      if (capsule.replacedGaps.length && cycleExcluded(state.cycle).length) {
        /* После смены дат, погоды или багажа пропущенные варианты могут понадобиться снова */
        state.cycle = {};
        capsule = compute(days, state.cycle);
      }
    }
    const plan = planDays(pool, capsule, days);
    state.packed = state.packed.filter((id) => capsule.ids.includes(id));
    state.built = true;
    save();
    renderResult(capsule, plan, days);
    status(shoeNote || pendingShoeNote);
    pendingShoeNote = '';
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
  if (capsule.unsupported.length) {
    const seasons = [...new Set(capsule.unsupported.map((c) => SEASON_LABELS[c.season]))].join(' и ');
    lines.push(
      `Сезона «${seasons}» в основном гардеробе пока нет, поэтому на эти дни капсулу не собрать. Он появится здесь, когда его заведут там.`,
    );
  }
  const name = (c) => `${formatTemp(c.t)}${c.rain ? ' в дождь' : ''}`;
  if (capsule.impossible.length) {
    lines.push(`Для ${capsule.impossible.map(name).join(', ')} в гардеробе нет подходящего образа.`);
  }
  const tight = capsule.gaps.filter(
    (g) => !capsule.impossible.includes(g) && !capsule.replacedGaps.includes(g) && !capsule.unsupported.includes(g),
  );
  let restoreHtml = '';
  if (capsule.replacedGaps.length) {
    lines.push(`Для ${capsule.replacedGaps.map(name).join(', ')} всё подходящее заменено. Верни одну из этих вещей:`);
    restoreHtml = capsule.restore
      .map(
        (id) =>
          `<button type="button" class="chip chip--btn" data-back="${esc(id)}">${miniDot(pool.items[id])}${esc(pool.items[id].name)} ↺</button>`,
      )
      .join('');
  }
  if (capsule.relaxedRain.length) {
    lines.push(
      `Для ${capsule.relaxedRain.map(name).join(', ')} в гардеробе нет непромокаемого тёплого верха, поэтому в этот холодный дождь допущены пух или флис. Держи зонт.`,
    );
  }
  if (capsule.unusedPinned.length) {
    const names = capsule.unusedPinned.map((id) => `${pool.items[id].name} ${pool.items[id].colorName}`).join(', ');
    lines.push(
      `Закреплено, но не подходит ни под один день поездки по погоде: ${names}. Эти вещи в план по дням не попадут, их можно открепить.`,
    );
  }
  if (capsule.pinBlocked.length) {
    const groups = capsule.pinBlocked.map((slot) => `«${SLOT_TITLES[slot]}»`).join(', ');
    lines.push(`Места в ${groups} заняты закреплёнными вещями, и для части дней не подходит ни одна. Открепи одну.`);
  }
  if (capsule.outerShort && !capsule.replacedGaps.length) {
    lines.push(
      'Курток и жилеток, которые подходят под всю погоду поездки, больше не осталось. Верни одну из заменённых.',
    );
  } else if (tight.length) {
    lines.push(
      `Для ${tight.map(name).join(', ')} не получилось собрать образ, который сочетается со всей капсулой и влезает в багаж. Попробуй добавить чемодан или заменить вещь.`,
    );
  }
  $('gaps').hidden = !lines.length;
  $('gaps').innerHTML = esc(lines.join(' ')) + (restoreHtml ? `<span class="chips restore">${restoreHtml}</span>` : '');
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
          if (capsule.copies[item.id] > 1) {
            tags.unshift(`× ${capsule.copies[item.id]}`);
          }
          if (extraTag(capsule, item.id)) {
            return `<div class="card tcard">${dot(item)}<span class="nm">${esc(item.name)}</span><span class="meta"><span>${esc(item.colorName)}</span>${tags.map((t) => `<span class="tg">${esc(t)}</span>`).join('')}</span></div>`;
          }
          return (
            `<div class="card tcard${pinned ? ' pinned' : ''}">${dot(item)}<span class="nm">${esc(item.name)}</span>` +
            `<span class="meta"><span>${esc(item.colorName)}</span>${tags.map((t) => `<span class="tg">${esc(t)}</span>`).join('')}</span>` +
            `<span class="acts"><button type="button" class="ib" data-pin="${esc(item.id)}" aria-pressed="${pinned}" aria-label="${pinned ? 'Открепить' : 'Закрепить'}: ${esc(item.name)}" title="${pinned ? 'Открепить' : 'Беру точно'}">${PIN_ICON}</button>` +
            `<button type="button" class="ib" data-ex="${esc(item.id)}" aria-label="Следующий вариант вместо: ${esc(item.name)}" title="Следующий вариант">${SWAP_ICON}</button></span></div>`
          );
        })
        .join('');
      const limit = slot === 't' ? capsule.teeTotal : capsule.limits[slot];
      /* Пара для дороги считается в лимите обуви, пара под мероприятие идёт сверх него */
      const daily = bySlot[slot]
        .filter((item) => !capsule.eventItems.includes(item.id))
        .reduce((sum, item) => sum + (capsule.copies[item.id] || 1), 0);
      const extra = bySlot[slot].filter((item) => capsule.eventItems.includes(item.id)).length;
      const counter = limit
        ? ` <span class="cnt">${daily} из ${limit}${extra ? ` + ${extra} сверх лимита` : ''}</span>`
        : '';
      return `<div class="grp"><h3>${SLOT_TITLES[slot]}${counter}</h3><div class="cards">${cards}</div></div>`;
    })
    .join('');
}

function renderPlan(plan) {
  $('plan').innerHTML = plan
    .map(({day, outfit, shoe, road, tee, head, scarf}, index) => {
      const title = day.date ? weekday(day.date) : `День ${index + 1}`;
      const range = day.tmin != null ? `<small>${formatTemp(day.tmin)}…${formatTemp(day.tmax)}</small>` : '';
      const badge =
        (road ? '<span class="road">в дороге</span>' : '') +
        (day.rain ? `<span class="rainy">${day.homeRain && !day.destRain ? 'дождь дома' : 'дождь'}</span>` : '');
      if (!outfit) {
        return `<article class="day"><header><b>${esc(title)}</b><span class="t">${formatTemp(day.t)}°${range}</span>${badge}</header><p class="note">Нет образа из капсулы на эту погоду, причина написана над капсулой.</p></article>`;
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

/** Чек-лист: что надеть в дорогу и что уложить. Только вещи из капсулы. */
function packSections(capsule) {
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
  return [
    {title: 'На себе в дорогу', items: wearIds},
    {title: 'Уложить', items: rest},
  ].filter((section) => section.items.length);
}

function renderPack(capsule) {
  const wear = travelWear(capsule);
  const sections = packSections(capsule);
  const row = (id) => {
    const done = state.packed.includes(id);
    const item = pool.items[id];
    const tag = extraTag(capsule, id);
    const count = capsule.copies[id] > 1 ? ` <span class="tg">× ${capsule.copies[id]}</span>` : '';
    const body = `${miniDot(item)}<span>${esc(item.name)} <em>${esc(item.colorName)}</em>${count}${tag ? ` <span class="tg">${tag}</span>` : ''}</span>`;
    return `<li><label class="${done ? 'done' : ''}"><input type="checkbox" data-pack="${esc(id)}"${done ? ' checked' : ''} />${body}</label></li>`;
  };
  $('pack').innerHTML = sections
    .map((section) => `<li class="pack-h">${esc(section.title)}</li>${section.items.map(row).join('')}`)
    .join('');
  const all = sections.flatMap((section) => section.items);
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
  $('bags-over').addEventListener('change', () => {
    state.bagsOver = $('bags-over').checked;
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
      /* В календаре возвращения нельзя выбрать дату раньше отъезда */
      $('end').min = state.start || '';
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
      const id = pin.dataset.pin;
      state.pinned = toggle(state.pinned, id);
      if (state.pinned.includes(id)) {
        /* Выбор сделан: перебор в этой группе закончен */
        state.cycle = {...state.cycle, [capsuleSlot(pool.items[id])]: []};
      }
      save();
      rebuild();
    } else if (ex) {
      state.pinned = state.pinned.filter((id) => id !== ex.dataset.ex);
      save();
      rebuild(ex.dataset.ex);
    }
  });
  $('gaps').addEventListener('click', (event) => {
    const back = event.target.closest('[data-back]');
    if (back) {
      state.cycle = Object.fromEntries(
        Object.entries(state.cycle).map(([slot, ids]) => [slot, ids.filter((id) => id !== back.dataset.back)]),
      );
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
/* Прогноз обновляется при каждом открытии (не чаще раза в полчаса): сохранённый мог устареть на дни */
const WEATHER_MAX_AGE = 30 * 60 * 1000;
if (
  state.mode === 'place' &&
  state.place &&
  (!state.weather || !state.weather.fetchedAt || Date.now() - state.weather.fetchedAt > WEATHER_MAX_AGE)
) {
  refreshWeather().then((ok) => {
    if (ok && state.built) {
      rebuild();
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
