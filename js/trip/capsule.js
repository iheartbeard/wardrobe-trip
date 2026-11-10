/**
 * Капсула для поездки. Берёт все сезоны (осень, зиму и летние вещи для поездок), собирает образы,
 * которые работают при температурах и погоде поездки, и подбирает небольшой набор вещей,
 * из которого получается как можно больше сочетаний без цветовых конфликтов.
 * Модуль не зависит от DOM.
 */
import {SEASONS} from '../data/seasons.js';
import {buildModel} from '../model.js';
import {evaluateColors} from '../lib/color.js';
import {SUMMER_SEASON} from './summer.js';

/**
 * Лимиты вещей под багаж. Вещи, в которых едешь, тоже считаются.
 * Рюкзак (~24 л): большую часть места занимают техника, туалетный набор и куб с бельём,
 * поэтому одежды немного и одна пара обуви, та, что на ногах.
 * Рюкзак + маленький чемодан для ручной клади (~38 л): одежда едет в чемодане, рюкзак под технику.
 * Верхний слой всегда один: куртка или жилетка (поверх лёгкого слоя или тёплого худи), несколько не берутся.
 * Сочетания только из основного гардероба: «куртка + жилетка» там бывает только с Taion под курткой,
 * а Taion под курткой считается средним слоем.
 */
export const LUGGAGE = {
  backpack: {label: 'Рюкзак', o: 1, m: 2, t: 3, b: 2, s: 1, h: 1},
  carryon: {label: 'Маленький чемодан', o: 1, m: 3, t: 7, b: 3, s: 3, h: 2},
};

export const DEFAULT_LUGGAGE = 'carryon';

/** Поездка до стольких дней включительно считается короткой: с чемоданом берутся две пары обуви, а не три. */
export const SHORT_TRIP_DAYS = 4;

export const SLOT_TITLES = {
  o: 'Верхний слой',
  m: 'Средний слой',
  t: 'Футболки',
  b: 'Низ',
  s: 'Обувь',
  h: 'Головной убор',
  sc: 'Шарф',
};

/**
 * Вещи, которые в поездку не берутся для каждого дня: тяжёлые, долго в них не походишь.
 * Попадают в капсулу только под официальное мероприятие (свадьба и т.п.), отдельно от лимитов и плана по дням.
 */
export const EVENT_ONLY = ['tim'];

/** Неудобная для долгой ходьбы обувь в поездку не берётся: слипоны, Palermo, Wallabee, Birkenstock Boston. Club C удобные, они остаются. */
export const NOT_FOR_WALKING = ['van', 'pal', 'w1', 'w2', 'bos'];

/** Самый холодный и самый тёплый день, которые умеет собрать гардероб. */
export const TRIP_LIMITS = [0, 32];

const COVER_WEIGHT = 1000;

/** Модели всех сезонов и общий каталог вещей. У аксессуаров диапазоны сезонов объединяются. */
export function buildPool() {
  const models = [
    ...Object.keys(SEASONS).map((key) => Object.assign(buildModel(key), {season: key})),
    Object.assign(buildModel('summer', SUMMER_SEASON), {season: 'summer'}),
  ];
  const items = {};
  for (const model of models) {
    for (const item of Object.values(model.byId)) {
      if (item.isNone) {
        continue;
      }
      const known = items[item.id];
      if (!known) {
        items[item.id] = {...item};
      } else if (item.range && known.range) {
        known.range = [Math.min(known.range[0], item.range[0]), Math.max(known.range[1], item.range[1])];
      }
    }
  }
  return {models, items};
}

/** Слот вещи в капсуле: футболки отдельно от остального среднего слоя. */
export const capsuleSlot = (item) =>
  item.slot === 'm' || item.slot === 't' ? (item.kind === 'tee' ? 't' : 'm') : item.slot;

const clampTemp = (t) => Math.max(TRIP_LIMITS[0], Math.min(TRIP_LIMITS[1], Math.round(t)));

/** Условия поездки без повторов: [{t, rain}]. */
export function uniqueConditions(days) {
  const seen = new Map();
  days.forEach((day) => {
    const t = clampTemp(day.t);
    const season = day.season || DEFAULT_SEASON;
    seen.set(`${season}|${t}|${day.rain ? 1 : 0}`, {t, rain: !!day.rain, season});
  });
  return [...seen.values()].sort((a, b) => a.t - b.t || Number(a.rain) - Number(b.rain));
}

/** Сезон по дате: декабрь–февраль зима, март–май весна, июнь–август лето, сентябрь–ноябрь осень. */
export function seasonOf(date) {
  const month = Number(String(date).slice(5, 7));
  if (month === 12 || month <= 2) {
    return 'winter';
  }
  if (month <= 5) {
    return 'spring';
  }
  if (month <= 8) {
    return 'summer';
  }
  return 'autumn';
}

export const SEASON_LABELS = {autumn: 'Осень', winter: 'Зима', spring: 'Весна', summer: 'Лето'};
export const DEFAULT_SEASON = 'autumn';

/**
 * Из какого сезонного гардероба брать вещи. Вещь идёт в поездку, только если отмечена на этот сезон,
 * дальше внутри сезона работает её диапазон температур. Весенних данных пока нет: весной берётся
 * осенний гардероб (почти все осенние вещи отмечены и на весну).
 */
export const SEASON_MODELS = {autumn: ['autumn'], winter: ['winter'], spring: ['autumn'], summer: ['summer']};

/**
 * Все образы, которые работают хотя бы при одном условии поездки и проходят проверку цвета.
 * Образ: {o, m, b, s, ids, conds: Set<number>, score}.
 */
export function tripOutfits(pool, conditions) {
  const byKey = new Map();
  for (const model of pool.models) {
    const {scale} = model;
    for (const outfit of model.outfits) {
      conditions.forEach((cond, index) => {
        if (!SEASON_MODELS[cond.season || DEFAULT_SEASON].includes(model.season)) {
          return;
        }
        if (cond.t < scale.min || cond.t > scale.max) {
          return;
        }
        const bit = 1 << (cond.t - scale.min);
        if (!((cond.rain ? outfit.rain : outfit.dry) & bit)) {
          return;
        }
        const key = `${outfit.o}|${outfit.m}|${outfit.b}|${outfit.s}`;
        let entry = byKey.get(key);
        if (!entry) {
          const ids = [outfit.o, outfit.m, outfit.b, outfit.s].filter((id) => id !== 'none');
          const evaluation = evaluateColors(ids.map((id) => pool.items[id]));
          entry = {
            o: outfit.o,
            m: outfit.m,
            b: outfit.b,
            s: outfit.s,
            ids,
            conds: new Set(),
            score: evaluation ? evaluation.score : null,
          };
          byKey.set(key, entry);
        }
        entry.conds.add(index);
      });
    }
  }
  return [...byKey.values()].filter((entry) => entry.score !== null);
}

/**
 * Верхний слой в капсуле один, поэтому он должен подходить под всю погоду поездки:
 * закрывать каждый день, когда без куртки или жилетки не обойтись. Остальные варианты верхнего слоя
 * отбрасываются, в том числе при замене. Если ни один не закрывает все такие дни, остаются те,
 * что закрывают больше всего.
 */
export function weatherFitOuter(outfits, conditions) {
  const needOuter = conditions
    .map((_, index) => index)
    .filter((index) => !outfits.some((outfit) => outfit.o === 'none' && outfit.conds.has(index)));
  if (!needOuter.length) {
    return Object.assign(outfits, {outerShort: false});
  }
  const reach = {};
  outfits.forEach((outfit) => {
    if (outfit.o !== 'none') {
      reach[outfit.o] = reach[outfit.o] || new Set();
      outfit.conds.forEach((c) => reach[outfit.o].add(c));
    }
  });
  const score = (id) => needOuter.filter((c) => reach[id].has(c)).length;
  const best = Math.max(0, ...Object.keys(reach).map(score));
  const allowed = new Set(Object.keys(reach).filter((id) => score(id) === best));
  const result = outfits.filter((outfit) => outfit.o === 'none' || allowed.has(outfit.o));
  /* Ни один оставшийся вариант не закрывает всю погоду: обычно это после нескольких замен */
  return Object.assign(result, {outerShort: best < needOuter.length});
}

/**
 * Обувь подбирается первой. Жадно: сначала пары, которые закрывают больше всего ещё не закрытых дней,
 * при равенстве та, с которой больше сочетаний без цветовых конфликтов. Закреплённые пары берутся всегда.
 */
export function pickShoes(outfits, conditions, limit, pinned, pool) {
  const byShoe = {};
  outfits.forEach((outfit) => {
    const entry = (byShoe[outfit.s] = byShoe[outfit.s] || {conds: new Set(), combos: 0, score: 0});
    outfit.conds.forEach((c) => entry.conds.add(c));
    entry.combos += 1;
    entry.score += outfit.score;
  });
  const chosen = pinned.filter((id) => pool.items[id] && pool.items[id].slot === 's');
  const covered = new Set();
  chosen.forEach((id) => (byShoe[id] ? byShoe[id].conds : []).forEach((c) => covered.add(c)));
  while (chosen.length < limit) {
    let best = null;
    let bestValue = 0;
    Object.entries(byShoe).forEach(([id, entry]) => {
      if (chosen.includes(id)) {
        return;
      }
      const opens = [...entry.conds].filter((c) => !covered.has(c)).length;
      const value = opens * 1000 + entry.combos + entry.score * 0.1;
      if (value > bestValue) {
        bestValue = value;
        best = id;
      }
    });
    if (!best) {
      break;
    }
    chosen.push(best);
    byShoe[best].conds.forEach((c) => covered.add(c));
  }
  return chosen;
}

/**
 * Подбор капсулы.
 * @param {object} pool Результат buildPool()
 * @param {{t: number, rain: boolean}[]} days Дни поездки
 * @param {{luggage?: string, pinned?: string[], excluded?: string[]}} [options]
 */
export function buildCapsule(pool, days, options = {}) {
  const limits = {...(LUGGAGE[options.luggage] || LUGGAGE[DEFAULT_LUGGAGE])};
  /* С чемоданом обычно 2–3 пары, включая ту, в которой едешь: на короткую поездку две, на длинную три */
  if (limits.s > 2 && days.length <= SHORT_TRIP_DAYS) {
    limits.s = 2;
  }
  const ruleExcluded = [...EVENT_ONLY, ...NOT_FOR_WALKING];
  const excluded = new Set([...(options.excluded || []), ...ruleExcluded]);
  const pinned = (options.pinned || []).filter((id) => pool.items[id] && !excluded.has(id));
  const conditions = uniqueConditions(days);
  const possibleAtAll = tripOutfits(pool, conditions).filter((outfit) =>
    outfit.ids.every((id) => !ruleExcluded.includes(id)),
  );
  const allowedOutfits = tripOutfits(pool, conditions).filter((outfit) => outfit.ids.every((id) => !excluded.has(id)));
  let outfits = weatherFitOuter(allowedOutfits, conditions);

  const pinnedCounts = {o: 0, m: 0, t: 0, b: 0, s: 0};
  pinned.forEach((id) => {
    const slot = capsuleSlot(pool.items[id]);
    if (slot in pinnedCounts) {
      pinnedCounts[slot] += 1;
    }
  });
  Object.keys(pinnedCounts).forEach((slot) => {
    limits[slot] = Math.max(limits[slot], pinnedCounts[slot]);
  });
  limits.t = Math.min(limits.t, Math.max(2, days.length, pinnedCounts.t));
  /*
   * Пара только для дороги (любая, которую выберешь): едешь в ней в первый и последний день,
   * в образы на остальные дни она не идёт и занимает одно место в лимите обуви.
   * С одной парой в лимите отдельной пары для дороги нет.
   */
  const travelItems = options.travelShoe && pool.items[options.travelShoe] && limits.s > 1 ? [options.travelShoe] : [];
  travelItems.forEach((id) => excluded.add(id));
  limits.s -= travelItems.length;
  /* Пара только для дороги входит в те же 2–3 пары, поэтому на ходьбу остаётся на одну меньше */

  /*
   * Сначала обувь, как на основной странице: подбираются пары, которые вместе закрывают всю погоду поездки
   * и дают больше всего сочетаний, а вся остальная капсула собирается уже вокруг них.
   */
  const shoes = pickShoes(allowedOutfits, conditions, limits.s, pinned, pool);
  outfits = weatherFitOuter(
    allowedOutfits.filter((outfit) => shoes.includes(outfit.s)),
    conditions,
  );
  const pinnedWithShoes = [...new Set([...pinned, ...shoes])];

  /* Сколько образов поездки держится на вещи: универсальные вещи важнее */
  const freq = {};
  const byItem = {};
  outfits.forEach((outfit) => {
    outfit.ids.forEach((id) => {
      freq[id] = (freq[id] || 0) + 1;
      (byItem[id] = byItem[id] || []).push(outfit);
    });
  });

  /* Холодные дни определяют куртку и низ, жаркие лёгкие вещи, поэтому пробуем несколько порядков и берём лучший */
  const optionCount = conditions.map((_, index) => outfits.filter((o) => o.conds.has(index)).length);
  const indexes = conditions.map((_, index) => index);
  const orders = [[...indexes], [...indexes].reverse(), [...indexes].sort((a, b) => optionCount[a] - optionCount[b])];
  let chosen = null;
  let counts = null;
  let best = null;
  for (const order of orders) {
    const run = greedy(order);
    const runOutfits = outfits.filter((outfit) => outfit.ids.every((id) => run.chosen.has(id)));
    const covered = new Set();
    runOutfits.forEach((outfit) => outfit.conds.forEach((c) => covered.add(c)));
    const value = covered.size * COVER_WEIGHT + runOutfits.length;
    if (!best || value > best.value) {
      best = {value, ...run};
    }
  }
  ({chosen, counts} = best);
  const add = (id) => {
    if (!chosen.has(id)) {
      chosen.add(id);
      counts[capsuleSlot(pool.items[id])] += 1;
    }
  };
  const complete = (outfit) => outfit.ids.every((id) => chosen.has(id));
  const coveredSet = () => {
    const covered = new Set();
    outfits.forEach((outfit) => {
      if (complete(outfit)) {
        outfit.conds.forEach((c) => covered.add(c));
      }
    });
    return covered;
  };

  function greedy(order) {
    const chosen = new Set();
    const counts = {o: 0, m: 0, t: 0, b: 0, s: 0};
    const add = (id) => {
      if (!chosen.has(id)) {
        chosen.add(id);
        counts[capsuleSlot(pool.items[id])] += 1;
      }
    };
    pinnedWithShoes.filter((id) => capsuleSlot(pool.items[id]) in counts).forEach(add);

    const fits = (ids) => {
      const extra = {};
      for (const id of ids) {
        if (chosen.has(id)) {
          continue;
        }
        const slot = capsuleSlot(pool.items[id]);
        extra[slot] = (extra[slot] || 0) + 1;
        if (counts[slot] + extra[slot] > limits[slot]) {
          return false;
        }
      }
      return true;
    };
    const complete = (outfit) => outfit.ids.every((id) => chosen.has(id));
    const coveredSet = () => {
      const covered = new Set();
      outfits.forEach((outfit) => {
        if (complete(outfit)) {
          outfit.conds.forEach((c) => covered.add(c));
        }
      });
      return covered;
    };

    /* Шаг 1: каждое условие поездки закрывается хотя бы одним образом */
    for (const index of order) {
      const coveredNow = coveredSet();
      if (coveredNow.has(index)) {
        continue;
      }
      let best = null;
      let bestValue = Infinity;
      for (const outfit of outfits) {
        if (!outfit.conds.has(index) || !fits(outfit.ids)) {
          continue;
        }
        const fresh = outfit.ids.filter((id) => !chosen.has(id));
        const versatility = fresh.reduce((sum, id) => sum + freq[id], 0);
        /* Образ, который заодно закрывает другие ещё не закрытые дни, экономит место в багаже */
        let opens = 0;
        outfit.conds.forEach((c) => {
          if (!coveredNow.has(c)) {
            opens += 1;
          }
        });
        const value = fresh.length * 10 - outfit.score - opens * 3 - versatility * 0.002;
        if (value < bestValue) {
          bestValue = value;
          best = outfit;
        }
      }
      if (best) {
        best.ids.forEach(add);
      }
    }

    /* Шаг 2: добавляем вещи, пока они дают новые сочетания */
    for (;;) {
      const covered = coveredSet();
      let bestId = null;
      let bestGain = 0;
      for (const id of Object.keys(byItem)) {
        if (chosen.has(id) || excluded.has(id) || !fits([id])) {
          continue;
        }
        let gain = 0;
        const newConds = new Set();
        for (const outfit of byItem[id]) {
          if (outfit.ids.every((other) => other === id || chosen.has(other))) {
            gain += 1 + 0.25 * outfit.score;
            outfit.conds.forEach((c) => {
              if (!covered.has(c)) {
                newConds.add(c);
              }
            });
          }
        }
        gain += newConds.size * COVER_WEIGHT;
        if (gain > bestGain) {
          bestGain = gain;
          bestId = id;
        }
      }
      if (!bestId) {
        break;
      }
      add(bestId);
    }
    return {chosen, counts};
  }

  const capsuleOutfits = outfits.filter(complete);

  /* Футболки под свитеры и свитшоты: добираем до лимита теми, что спокойнее ложатся по цвету */
  const tees = Object.values(pool.items).filter(
    (item) => capsuleSlot(item) === 't' && !chosen.has(item.id) && !excluded.has(item.id),
  );
  const teeFit = (tee) =>
    capsuleOutfits.filter((outfit) => evaluateColors([...outfit.ids, tee.id].map((id) => pool.items[id]))).length;
  tees
    .map((tee) => ({tee, fit: teeFit(tee)}))
    .sort((a, b) => b.fit - a.fit)
    .forEach(({tee}) => {
      if (counts.t < limits.t) {
        add(tee.id);
      }
    });

  const temps = conditions.map((cond) => cond.t);
  const accessoryFit = (item) =>
    capsuleOutfits.length
      ? capsuleOutfits.filter((outfit) => evaluateColors([...outfit.ids, item.id].map((id) => pool.items[id]))).length /
        capsuleOutfits.length
      : 0;
  const pickAccessories = (slot, limit, needed) => {
    if (!needed.length || !limit) {
      return [];
    }
    const pinnedHere = pinned.filter((id) => pool.items[id].slot === slot);
    const result = [...pinnedHere];
    const uncovered = new Set(needed.filter((t) => !pinnedHere.some((id) => inRange(pool.items[id], t))));
    const candidates = Object.values(pool.items).filter(
      (item) => item.slot === slot && !excluded.has(item.id) && !result.includes(item.id),
    );
    while (result.length < limit && uncovered.size) {
      let best = null;
      let bestValue = 0;
      candidates.forEach((item) => {
        if (result.includes(item.id)) {
          return;
        }
        const hits = [...uncovered].filter((t) => inRange(item, t)).length;
        const value = hits ? hits + accessoryFit(item) * 2 : 0;
        if (value > bestValue) {
          bestValue = value;
          best = item;
        }
      });
      if (!best) {
        break;
      }
      result.push(best.id);
      [...uncovered].forEach((t) => {
        if (inRange(best, t)) {
          uncovered.delete(t);
        }
      });
    }
    /* Если место ещё есть, добираем до лимита для разнообразия: подходит по погоде хотя бы в часть дней и по цвету */
    while (result.length < limit) {
      let best = null;
      let bestValue = 0;
      candidates.forEach((item) => {
        if (result.includes(item.id)) {
          return;
        }
        const hits = needed.filter((t) => inRange(item, t)).length;
        const fit = accessoryFit(item);
        const value = hits && fit > 0 ? hits / needed.length + fit * 2 : 0;
        if (value > bestValue) {
          bestValue = value;
          best = item;
        }
      });
      if (!best) {
        break;
      }
      result.push(best.id);
    }
    return result;
  };
  const head = pickAccessories('h', limits.h, temps);
  const scarves = pickAccessories(
    'sc',
    1,
    temps.filter((t) => t <= 10),
  );
  [...head, ...scarves].forEach((id) => chosen.add(id));
  const eventItems = options.event ? EVENT_ONLY.filter((id) => pool.items[id]) : [];

  const finalCovered = coveredSet();
  const gapIdx = conditions.map((_, i) => i).filter((i) => !finalCovered.has(i));
  const impossibleIdx = gapIdx.filter((i) => !possibleAtAll.some((outfit) => outfit.conds.has(i)));
  const replacedIdx = gapIdx.filter(
    (i) => !impossibleIdx.includes(i) && !allowedOutfits.some((outfit) => outfit.conds.has(i)),
  );
  /* Какие из заменённых вещей вернут образ на эти дни: чем больше дней закрывает, тем выше */
  const restore = (options.excluded || [])
    .map((id) => ({
      id,
      fixes: replacedIdx.filter((i) => possibleAtAll.some((outfit) => outfit.conds.has(i) && outfit.ids.includes(id)))
        .length,
    }))
    .filter((entry) => entry.fixes > 0)
    .sort((a, b) => b.fixes - a.fixes)
    .map((entry) => entry.id);
  /* Остальные пробелы: подходящие вещи есть, но места в группе заняты закреплёнными */
  const pinBlocked = new Set();
  gapIdx
    .filter((i) => !impossibleIdx.includes(i) && !replacedIdx.includes(i))
    .forEach((i) => {
      allowedOutfits
        .filter((outfit) => outfit.conds.has(i))
        .forEach((outfit) =>
          outfit.ids
            .filter((id) => !chosen.has(id))
            .forEach((id) => {
              const slot = capsuleSlot(pool.items[id]);
              const pinnedInSlot = pinned.filter((p) => capsuleSlot(pool.items[p]) === slot).length;
              if (slot in limits && pinnedInSlot >= limits[slot]) {
                pinBlocked.add(slot);
              }
            }),
        );
    });
  return {
    conditions,
    limits: {...limits, s: limits.s + travelItems.length},
    ids: [...chosen, ...eventItems, ...travelItems],
    travelItems,
    eventItems,
    outfits: capsuleOutfits,
    gaps: conditions.filter((_, index) => !finalCovered.has(index)),
    outerShort: outfits.outerShort,
    /* Нет образа во всём гардеробе (без учёта твоих замен) */
    impossible: impossibleIdx.map((i) => conditions[i]),
    /* Образ в гардеробе есть, но всё подходящее заменено */
    replacedGaps: replacedIdx.map((i) => conditions[i]),
    restore,
    pinBlocked: [...pinBlocked],
  };
}

const inRange = (item, t) => item.range && t >= item.range[0] && t <= item.range[1];

/**
 * План по дням: на каждый день образ из капсулы, по возможности без повторов.
 * @returns {{day: object, outfit: object|null, tee: string|null, head: string|null, scarf: string|null}[]}
 */
export function planDays(pool, capsule, days) {
  const used = {};
  const usedKey = new Set();
  const teeUse = {};
  const tees = capsule.ids.filter((id) => capsuleSlot(pool.items[id]) === 't');
  const heads = capsule.ids.filter((id) => pool.items[id].slot === 'h');
  const scarves = capsule.ids.filter((id) => pool.items[id].slot === 'sc');
  let previous = null;

  return days.map((day, dayIndex) => {
    const travel = capsule.travelItems.length > 0 && (dayIndex === 0 || dayIndex === days.length - 1);
    const season = day.season || DEFAULT_SEASON;
    const condIndex = capsule.conditions.findIndex(
      (c) => c.t === clampTemp(day.t) && c.rain === !!day.rain && c.season === season,
    );
    const options = capsule.outfits.filter((outfit) => outfit.conds.has(condIndex));
    let best = null;
    let bestValue = -Infinity;
    options.forEach((outfit) => {
      const key = outfit.ids.join('|');
      let value = outfit.score * 2;
      value -= (used[outfit.m] || 0) * 3 + (used[outfit.b] || 0) * 2 + (used[outfit.o] || 0) * 0.5;
      if (usedKey.has(key)) {
        value -= 6;
      }
      value -= (used[outfit.s] || 0) * 1;
      if (previous && previous.s === outfit.s) {
        value -= 1.5;
      }
      if (value > bestValue) {
        bestValue = value;
        best = outfit;
      }
    });
    if (!best) {
      return {day, outfit: null, shoe: null, travel, tee: null, head: null, scarf: null};
    }
    usedKey.add(best.ids.join('|'));
    [best.m, best.b, best.o, best.s].forEach((id) => {
      used[id] = (used[id] || 0) + 1;
    });
    previous = best;

    let tee = null;
    if (pool.items[best.m].kind !== 'tee') {
      const ranked = tees
        .map((id) => ({id, ok: evaluateColors([...best.ids, id].map((x) => pool.items[x]))}))
        .filter((x) => x.ok)
        .sort((a, b) => (teeUse[a.id] || 0) - (teeUse[b.id] || 0) || b.ok.score - a.ok.score);
      tee = ranked.length ? ranked[0].id : tees[0] || null;
      if (tee) {
        teeUse[tee] = (teeUse[tee] || 0) + 1;
      }
    }
    const t = clampTemp(day.t);
    const fitting = (ids) =>
      ids
        .filter((id) => inRange(pool.items[id], t))
        .find((id) => evaluateColors([...best.ids, id].map((x) => pool.items[x]))) || null;
    return {
      day,
      outfit: best,
      shoe: travel ? capsule.travelItems[0] : best.s,
      travel,
      tee,
      head: fitting(heads),
      scarf: t <= 10 ? fitting(scarves) : null,
    };
  });
}

/** Дни для режима без прогноза: температуры от tmax до tmin вперемешку (тёплый, прохладный, …), дождь каждый третий день. */
export function manualDays({days, tmin, tmax, rain, season = DEFAULT_SEASON}) {
  const count = Math.max(1, Math.min(30, Math.round(days)));
  const lo = Math.min(tmin, tmax);
  const hi = Math.max(tmin, tmax);
  const spread = Array.from({length: count}, (_, i) => (count === 1 ? hi : hi - ((hi - lo) * i) / (count - 1)));
  const order = [];
  for (let left = 0, right = count - 1; left <= right; left++, right--) {
    order.push(spread[left]);
    if (left !== right) {
      order.push(spread[right]);
    }
  }
  return order.map((t, i) => ({t: Math.round(t), rain: !!rain && i % 3 === 1, season}));
}
