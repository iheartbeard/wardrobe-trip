/**
 * Капсула для поездки поверх гардероба основного проекта.
 *
 * Все сочетания, слои, температуры и проверка цвета берутся из основного проекта (wardrobe.js):
 * капсула не придумывает своих пар, а выбирает из образов, которые строит его модель сезона.
 * Своё у капсулы только одно: собрать из этих образов небольшой набор вещей, где
 *  - обувь подбирается первой и вместе закрывает погоду поездки;
 *  - всё сочетается со всем: любые две вещи, которые носятся вместе, проходят проверку цвета,
 *    и каждый образ, который можно собрать из капсулы под погоду поездки, тоже её проходит;
 *  - соблюдены лимиты багажа и правила сборов (rules.js).
 * Модуль не зависит от DOM.
 */
import {SEASONS, buildModel, evaluateColors} from './wardrobe.js';
import {DEFAULT_LUGGAGE, LUGGAGE, TRIP_RULES} from './rules.js';

export {DEFAULT_LUGGAGE, LUGGAGE, TRIP_RULES};

export const SLOT_TITLES = {
  s: 'Обувь',
  o: 'Верхний слой',
  m: 'Средний слой',
  t: 'Футболки',
  b: 'Низ',
  h: 'Головной убор',
  sc: 'Шарф',
};

export const SEASON_LABELS = {autumn: 'Осень', winter: 'Зима', spring: 'Весна', summer: 'Лето'};

const COVER_WEIGHT = 1000;
const LOOK_BONUS = 1;

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

/** Сезоны, которые уже есть в основном проекте. Для остальных капсулу не собрать, пока их там нет. */
export const supportedSeason = (season) => Boolean(SEASONS[season]);

/** Модели сезонов основного проекта и общий каталог вещей. */
export function buildPool() {
  const models = {};
  const items = {};
  Object.keys(SEASONS).forEach((key) => {
    const model = buildModel(key);
    models[key] = model;
    Object.values(model.byId).forEach((item) => {
      if (!item.isNone && !items[item.id]) {
        items[item.id] = item;
      }
    });
  });
  return {models, items};
}

/** Слот вещи в капсуле: футболки отдельно от остального среднего слоя. */
export const capsuleSlot = (item) =>
  item.slot === 'm' || item.slot === 't' ? (item.kind === 'tee' ? 't' : 'm') : item.slot;

/** Пары слотов, вещи из которых не надеваются одновременно: их между собой сочетать не нужно. */
const notWornTogether = (a, b) => a === b;

/** Помечает сухие первый и последний день как дорогу. */
export function markTravelDays(days, on = true) {
  return days.map((day, i) => ({...day, travel: on && !day.rain && (i === 0 || i === days.length - 1)}));
}

/** Условия поездки без повторов: [{t, rain, season}]. */
export function uniqueConditions(days) {
  const seen = new Map();
  days.forEach((day) => {
    const t = Math.round(day.t);
    const season = day.season;
    const cond = {t, rain: !!day.rain, season};
    if (day.travel) {
      /* Сухой день в дороге — отдельное условие: на него своя обувь */
      cond.travel = true;
    }
    seen.set(`${season}|${t}|${day.rain ? 1 : 0}|${day.travel ? 1 : 0}`, cond);
  });
  return [...seen.values()].sort((a, b) => a.t - b.t || Number(a.rain) - Number(b.rain));
}

/**
 * Образы основного проекта, которые подходят хотя бы под одно условие поездки.
 * {o, m, b, s, ids, conds: Set<number>, score: number|null, look: boolean}; score null — образ не проходит проверку цвета.
 */
export function tripOutfits(pool, conditions) {
  const byKey = new Map();
  const fits = (cond, outfit) => {
    const model = pool.models[cond.season];
    return (cond.rain ? outfit.rain : outfit.dry) & (1 << (cond.t - model.scale.min));
  };
  const inRange = (cond) => {
    const model = pool.models[cond.season];
    return model && cond.t >= model.scale.min && cond.t <= model.scale.max;
  };
  /*
   * В дождь пух и флис верхним слоем не берутся. Если в какой-то дождливый день без них образа нет совсем
   * (холодный дождь без непромокаемого тёплого верха), правило снимается на всю поездку: верх в капсуле один,
   * и раз его всё равно везёшь, он идёт и в остальные дождливые дни.
   */
  let relaxRain = false;
  conditions.forEach((cond) => {
    if (!cond.rain || !inRange(cond)) {
      return;
    }
    const fitting = pool.models[cond.season].outfits.filter((outfit) => fits(cond, outfit));
    if (fitting.length && fitting.every((outfit) => TRIP_RULES.notInRain.includes(outfit.o))) {
      cond.relaxedRain = true;
      relaxRain = true;
    }
  });
  conditions.forEach((cond, index) => {
    const model = pool.models[cond.season];
    if (!model || cond.t < model.scale.min || cond.t > model.scale.max) {
      return;
    }
    const looks = new Set(model.looks.map((look) => look.ids.slice(0, 4).join('|')));
    const use = model.outfits.filter(
      (outfit) =>
        fits(cond, outfit) &&
        (relaxRain || !cond.rain || !TRIP_RULES.notInRain.includes(outfit.o)) &&
        !(cond.travel && TRIP_RULES.notOnDryTravel.includes(outfit.s)),
    );
    use.forEach((outfit) => {
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
          score: evaluation ? evaluation.score + (looks.has(key) ? LOOK_BONUS : 0) : null,
          look: looks.has(key),
        };
        byKey.set(key, entry);
      }
      entry.conds.add(index);
    });
  });
  return [...byKey.values()];
}

/**
 * Верхний слой в капсуле один, поэтому он должен закрывать все дни, когда без куртки или жилетки
 * не обойтись. Остальные варианты отбрасываются. Если всё не закрывает ни один, остаются лучшие.
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
  return Object.assign(result, {outerShort: best < needOuter.length});
}

/** Проверка цвета пары вещей с кэшем. */
function pairChecker(pool) {
  const cache = new Map();
  return (a, b) => {
    const sa = capsuleSlot(pool.items[a]);
    const sb = capsuleSlot(pool.items[b]);
    if (a === b || notWornTogether(sa, sb)) {
      return true;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!cache.has(key)) {
      cache.set(key, Boolean(evaluateColors([pool.items[a], pool.items[b]])));
    }
    return cache.get(key);
  };
}

/**
 * Обувь первой. Жадно: пары, которые закрывают больше всего ещё не закрытых дней; при равенстве та,
 * с которой больше хороших образов и больше общего низа с уже выбранной обувью (чтобы остальная
 * капсула могла сочетаться со всеми парами сразу).
 */
export function pickShoes(outfits, conditions, limit, pinned, pool, compatible) {
  const byShoe = {};
  outfits.forEach((outfit) => {
    if (outfit.score === null) {
      return;
    }
    const entry = (byShoe[outfit.s] = byShoe[outfit.s] || {conds: new Set(), combos: 0, bottoms: new Set()});
    outfit.conds.forEach((c) => entry.conds.add(c));
    entry.combos += 1 + outfit.score * 0.1;
    entry.bottoms.add(outfit.b);
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
      const shared = [...entry.bottoms].filter((b) =>
        chosen.every((s) => compatible(s, b) && byShoe[s]?.bottoms.has(b)),
      ).length;
      const value = opens * COVER_WEIGHT + shared * 20 + entry.combos;
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
 * @param {{t: number, rain: boolean, season: string}[]} days Дни поездки
 * @param {{luggage?: string, pinned?: string[], excluded?: string[], event?: boolean, travelShoe?: string}} [options]
 */
export function buildCapsule(pool, days, options = {}) {
  const limits = {...(LUGGAGE[options.luggage] || LUGGAGE[DEFAULT_LUGGAGE])};
  if (limits.s > 2 && days.length <= TRIP_RULES.shortTripDays) {
    limits.s = 2;
  }
  const ruleExcluded = [
    ...TRIP_RULES.eventOnly,
    ...TRIP_RULES.notForWalking,
    ...TRIP_RULES.neverPack,
    ...(options.bagsOver ? TRIP_RULES.waxed : []),
  ];
  const excluded = new Set([...(options.excluded || []), ...ruleExcluded]);
  const pinned = (options.pinned || []).filter((id) => pool.items[id] && !excluded.has(id));
  /*
   * Первый и последний день — дорога. В сухой день дороги нужна обувь без Gore-Tex и не челси.
   * Правило работает, когда в капсуле больше одной пары и нет отдельной пары только для дороги.
   */
  const travelRule = !options.travelShoe && (LUGGAGE[options.luggage] || LUGGAGE[DEFAULT_LUGGAGE]).s > 1;
  const markedDays = markTravelDays(days, travelRule);
  const conditions = uniqueConditions(markedDays);
  const compatible = pairChecker(pool);
  const isJeans = (id) => TRIP_RULES.jeans.includes(id);
  const isHoodie = (id) => pool.items[id].kind === TRIP_RULES.hoodieKind;

  /* Пара только для дороги занимает место в лимите обуви и в образы на остальные дни не идёт */
  const travelItems = options.travelShoe && pool.items[options.travelShoe] && limits.s > 1 ? [options.travelShoe] : [];
  travelItems.forEach((id) => excluded.add(id));

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
  /* Футболок всего на поездку столько, а цветов меньше: каждого цвета по 2–3 одинаковых */
  const teeTotal = limits.t;
  limits.t = Math.max(2, Math.ceil(teeTotal / TRIP_RULES.teeCopies), pinnedCounts.t);
  limits.s -= travelItems.length;

  const all = tripOutfits(pool, conditions);
  const possibleAtAll = all.filter(
    (outfit) => outfit.score !== null && outfit.ids.every((id) => !ruleExcluded.includes(id)),
  );
  const allowedRaw = all.filter((outfit) => outfit.ids.every((id) => !excluded.has(id)));
  const allowedOutfits = allowedRaw.filter((outfit) => outfit.score !== null);

  const shoes = pickShoes(allowedOutfits, conditions, limits.s, pinned, pool, compatible);
  const rawWithShoes = allowedRaw.filter((outfit) => shoes.includes(outfit.s));
  const outfits = weatherFitOuter(
    rawWithShoes.filter((outfit) => outfit.score !== null),
    conditions,
  );
  const outerAllowed = new Set(outfits.map((outfit) => outfit.o));
  /* Все образы, которые можно собрать под погоду поездки, в том числе не прошедшие проверку цвета */
  const rawOutfits = rawWithShoes.filter((outfit) => outerAllowed.has(outfit.o));
  const rawByItem = {};
  rawOutfits.forEach((outfit) => outfit.ids.forEach((id) => (rawByItem[id] = rawByItem[id] || []).push(outfit)));

  const freq = {};
  const byItem = {};
  outfits.forEach((outfit) => {
    outfit.ids.forEach((id) => {
      freq[id] = (freq[id] || 0) + 1;
      (byItem[id] = byItem[id] || []).push(outfit);
    });
  });

  const seed = [...new Set([...pinned, ...shoes])];
  const optionCount = conditions.map((_, index) => outfits.filter((o) => o.conds.has(index)).length);
  const indexes = conditions.map((_, index) => index);
  const orders = [[...indexes], [...indexes].reverse(), [...indexes].sort((a, b) => optionCount[a] - optionCount[b])];

  let best = null;
  for (const order of orders) {
    const run = greedy(order);
    const covered = new Set();
    const runOutfits = outfits.filter((outfit) => outfit.ids.every((id) => run.chosen.has(id)));
    runOutfits.forEach((outfit) => outfit.conds.forEach((c) => covered.add(c)));
    const jeansCount = [...run.chosen].filter(isJeans).length;
    const value = covered.size * COVER_WEIGHT + runOutfits.length - jeansCount * 5;
    if (!best || value > best.value) {
      best = {value, ...run};
    }
  }
  const {chosen, counts} = best;

  function greedy(order) {
    const picked = new Set();
    const count = {o: 0, m: 0, t: 0, b: 0, s: 0};
    const add = (id) => {
      if (!picked.has(id)) {
        picked.add(id);
        count[capsuleSlot(pool.items[id])] += 1;
      }
    };

    /* Можно ли добавить вещи так, чтобы всё в капсуле по-прежнему сочеталось со всем */
    const fits = (ids) => {
      const fresh = ids.filter((id) => !picked.has(id));
      const extra = {};
      let jeans = [...picked].filter(isJeans).length;
      let hoodies = [...picked].filter(isHoodie).length;
      for (const id of fresh) {
        const slot = capsuleSlot(pool.items[id]);
        extra[slot] = (extra[slot] || 0) + 1;
        if (count[slot] + extra[slot] > limits[slot]) {
          return false;
        }
        if (isJeans(id) && ++jeans > TRIP_RULES.maxJeans) {
          return false;
        }
        if (isHoodie(id) && ++hoodies > TRIP_RULES.maxHoodies) {
          return false;
        }
        for (const other of [...picked, ...fresh]) {
          if (!compatible(id, other)) {
            return false;
          }
        }
      }
      /* Каждый образ под погоду поездки, который соберётся из капсулы, должен проходить проверку цвета */
      const after = new Set([...picked, ...fresh]);
      for (const id of fresh) {
        for (const outfit of rawByItem[id] || []) {
          if (outfit.score === null && outfit.ids.every((x) => after.has(x))) {
            return false;
          }
        }
      }
      return true;
    };
    const covered = () => {
      const result = new Set();
      outfits.forEach((outfit) => {
        if (outfit.ids.every((id) => picked.has(id))) {
          outfit.conds.forEach((c) => result.add(c));
        }
      });
      return result;
    };

    seed.forEach((id) => {
      if (fits([id]) || pinned.includes(id) || shoes.includes(id)) {
        add(id);
      }
    });

    /* Шаг 1: каждое условие поездки закрывается хотя бы одним образом */
    for (const index of order) {
      const coveredNow = covered();
      if (coveredNow.has(index)) {
        continue;
      }
      let pick = null;
      let pickValue = Infinity;
      for (const outfit of outfits) {
        if (!outfit.conds.has(index) || !fits(outfit.ids)) {
          continue;
        }
        const fresh = outfit.ids.filter((id) => !picked.has(id));
        let opens = 0;
        outfit.conds.forEach((c) => {
          if (!coveredNow.has(c)) {
            opens += 1;
          }
        });
        const versatility = fresh.reduce((sum, id) => sum + freq[id], 0);
        const jeans = fresh.filter(isJeans).length;
        const value = fresh.length * 10 + jeans * 6 - outfit.score - opens * 3 - versatility * 0.002;
        if (value < pickValue) {
          pickValue = value;
          pick = outfit;
        }
      }
      if (pick) {
        pick.ids.forEach(add);
      }
    }

    /* Шаг 2: добавляем вещи, пока они дают новые сочетания */
    for (;;) {
      const coveredNow = covered();
      let pickId = null;
      let pickGain = 0;
      for (const id of Object.keys(byItem)) {
        if (picked.has(id) || !fits([id])) {
          continue;
        }
        let gain = 0;
        const opens = new Set();
        for (const outfit of byItem[id]) {
          if (outfit.ids.every((other) => other === id || picked.has(other))) {
            gain += 1 + 0.25 * outfit.score;
            outfit.conds.forEach((c) => {
              if (!coveredNow.has(c)) {
                opens.add(c);
              }
            });
          }
        }
        if (isJeans(id)) {
          gain *= TRIP_RULES.jeansPenalty;
        }
        gain += opens.size * COVER_WEIGHT;
        if (gain > pickGain) {
          pickGain = gain;
          pickId = id;
        }
      }
      if (!pickId) {
        break;
      }
      add(pickId);
    }
    return {chosen: picked, counts: count, fits, add};
  }

  /*
   * Футболки: каждого цвета есть по 2–3 штуки, поэтому берётся как можно меньше цветов (не меньше двух),
   * но по несколько одинаковых, всего столько, сколько нужно на поездку. Цвета — те, что сочетаются со всем.
   */
  const hasClothes = [...chosen].some((id) => capsuleSlot(pool.items[id]) !== 't');
  Object.values(pool.items)
    .filter((item) => capsuleSlot(item) === 't' && !chosen.has(item.id) && !excluded.has(item.id))
    .map((tee) => ({tee, fit: [...chosen].filter((id) => compatible(tee.id, id)).length}))
    .sort((a, b) => b.fit - a.fit)
    .forEach(({tee}) => {
      if (hasClothes && counts.t < limits.t && best.fits([tee.id])) {
        best.add(tee.id);
      }
    });
  const teeIds = [...chosen].filter((id) => capsuleSlot(pool.items[id]) === 't');
  const copies = {};
  teeIds.forEach((id) => (copies[id] = 0));
  for (let left = hasClothes ? Math.max(teeTotal, teeIds.length) : 0, k = 0; left > 0 && teeIds.length; k++) {
    const id = teeIds[k % teeIds.length];
    if (copies[id] < TRIP_RULES.teeCopies) {
      copies[id] += 1;
      left -= 1;
    } else if (teeIds.every((t) => copies[t] >= TRIP_RULES.teeCopies)) {
      break;
    }
  }

  const capsuleOutfits = outfits.filter((outfit) => outfit.ids.every((id) => chosen.has(id)));
  const clothes = [...chosen];

  /* Головные уборы и шарф из моделей тех сезонов, что есть в поездке, сочетаются со всей одеждой */
  const accessories = (slot, limit, needed) => {
    if (!needed.length || !limit) {
      return [];
    }
    const candidates = {};
    needed.forEach((cond) => {
      const model = pool.models[cond.season];
      const list = slot === 'h' ? model.headwear : model.scarves;
      list.forEach((item) => {
        if (excluded.has(item.id) || !(item.mask & (1 << (cond.t - model.scale.min)))) {
          return;
        }
        if (!clothes.every((id) => compatible(item.id, id))) {
          return;
        }
        (candidates[item.id] = candidates[item.id] || new Set()).add(`${cond.season}|${cond.t}`);
      });
    });
    const result = pinned.filter((id) => pool.items[id].slot === slot);
    const uncovered = new Set(needed.map((cond) => `${cond.season}|${cond.t}`));
    result.forEach((id) => (candidates[id] || []).forEach((key) => uncovered.delete(key)));
    while (result.length < limit) {
      const ranked = Object.entries(candidates)
        .filter(([id]) => !result.includes(id))
        .map(([id, keys]) => ({id, value: [...keys].filter((k) => uncovered.has(k)).length * 10 + keys.size}))
        .sort((a, b) => b.value - a.value);
      if (!ranked.length) {
        break;
      }
      result.push(ranked[0].id);
      candidates[ranked[0].id].forEach((key) => uncovered.delete(key));
    }
    return result;
  };
  const supported = conditions.filter((cond) => pool.models[cond.season]);
  const head = accessories('h', limits.h, supported);
  const scarves = accessories(
    'sc',
    1,
    supported.filter((cond) =>
      pool.models[cond.season].scarves.some((s) => s.mask & (1 << (cond.t - pool.models[cond.season].scale.min))),
    ),
  );
  [...head, ...scarves].forEach((id) => chosen.add(id));

  const eventItems = options.event ? TRIP_RULES.eventOnly.filter((id) => pool.items[id]) : [];

  /* Почему какие-то дни остались без образа */
  const finalCovered = new Set();
  capsuleOutfits.forEach((outfit) => outfit.conds.forEach((c) => finalCovered.add(c)));
  const gapIdx = conditions.map((_, i) => i).filter((i) => !finalCovered.has(i));
  const unsupportedIdx = gapIdx.filter((i) => !pool.models[conditions[i].season]);
  const impossibleIdx = gapIdx.filter(
    (i) => !unsupportedIdx.includes(i) && !possibleAtAll.some((outfit) => outfit.conds.has(i)),
  );
  const replacedIdx = gapIdx.filter(
    (i) => !unsupportedIdx.includes(i) && !impossibleIdx.includes(i) && !allowedOutfits.some((o) => o.conds.has(i)),
  );
  const restore = (options.excluded || [])
    .map((id) => ({
      id,
      fixes: replacedIdx.filter((i) => possibleAtAll.some((o) => o.conds.has(i) && o.ids.includes(id))).length,
    }))
    .filter((entry) => entry.fixes > 0)
    .sort((a, b) => b.fixes - a.fixes)
    .map((entry) => entry.id);
  const pinBlocked = new Set();
  gapIdx
    .filter((i) => ![...unsupportedIdx, ...impossibleIdx, ...replacedIdx].includes(i))
    .forEach((i) =>
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
        ),
    );

  return {
    conditions,
    limits: {...limits, s: limits.s + travelItems.length},
    ids: [...chosen, ...eventItems, ...travelItems],
    travelItems,
    eventItems,
    travelRule,
    teeTotal,
    /* Сколько штук каждой футболки взять */
    copies,
    outfits: capsuleOutfits,
    gaps: gapIdx.map((i) => conditions[i]),
    outerShort: outfits.outerShort,
    /* Сезона ещё нет в основном проекте */
    unsupported: unsupportedIdx.map((i) => conditions[i]),
    /* Нет образа во всём гардеробе (без учёта замен) */
    impossible: impossibleIdx.map((i) => conditions[i]),
    /* Образ в гардеробе есть, но всё подходящее заменено */
    replacedGaps: replacedIdx.map((i) => conditions[i]),
    restore,
    pinBlocked: [...pinBlocked],
    /* Дождливые дни, где без пуха или флиса верхним слоем образа не собрать */
    relaxedRain: conditions.filter((cond) => cond.relaxedRain),
    /* Закреплённые вещи, которые не входят ни в один образ на дни поездки (не по погоде или не сочетаются) */
    unusedPinned: pinned.filter(
      (id) =>
        ['o', 'm', 'b', 's'].includes(capsuleSlot(pool.items[id])) && !capsuleOutfits.some((o) => o.ids.includes(id)),
    ),
  };
}

/**
 * План по дням: на каждый день образ из капсулы, по возможности без повторов.
 * Вещи капсулы сочетаются между собой, поэтому футболка, головной убор и шарф подходят к любому образу.
 */
export function planDays(pool, capsule, days) {
  const used = {};
  const usedKey = new Set();
  const teeUse = {};
  const tees = capsule.ids.filter((id) => capsuleSlot(pool.items[id]) === 't');
  const heads = capsule.ids.filter((id) => pool.items[id].slot === 'h');
  const scarves = capsule.ids.filter((id) => pool.items[id].slot === 'sc');
  let previous = null;

  const marked = markTravelDays(days, capsule.travelRule);
  return days.map((day, dayIndex) => {
    const road = dayIndex === 0 || dayIndex === days.length - 1;
    const travel = capsule.travelItems.length > 0 && road;
    const t = Math.round(day.t);
    const condIndex = capsule.conditions.findIndex(
      (c) => c.t === t && c.rain === !!day.rain && c.season === day.season && !!c.travel === marked[dayIndex].travel,
    );
    const options = capsule.outfits.filter((outfit) => outfit.conds.has(condIndex));
    let pick = null;
    let pickValue = -Infinity;
    options.forEach((outfit) => {
      const key = outfit.ids.join('|');
      /*
       * Сначала разнообразие, потом цвет: штаны и средний слой чередуются по кругу (каждый повтор стоит
       * больше любой разницы в оценке цвета), затем обувь; оценка цвета решает только между равными.
       */
      let value = outfit.score;
      value -= (used[outfit.b] || 0) * 20 + (used[outfit.m] || 0) * 15 + (used[outfit.s] || 0) * 6;
      value -= (used[outfit.o] || 0) * 0.5;
      if (usedKey.has(key)) {
        value -= 40;
      }
      if (previous && previous.s === outfit.s) {
        value -= 1.5;
      }
      // В дорогу (первый и последний день) — штаны для дороги, сколько бы раз они уже ни были.
      if (road && TRIP_RULES.roadBottoms.includes(outfit.b)) {
        value += 1000;
      }
      if (value > pickValue) {
        pickValue = value;
        pick = outfit;
      }
    });
    if (!pick) {
      return {day, outfit: null, shoe: null, travel, road, tee: null, head: null, scarf: null};
    }
    usedKey.add(pick.ids.join('|'));
    [pick.m, pick.b, pick.o, pick.s].forEach((id) => {
      used[id] = (used[id] || 0) + 1;
    });
    previous = pick;

    let tee = null;
    if (pool.items[pick.m].kind !== 'tee' && tees.length) {
      const share = (id) => (teeUse[id] || 0) / (capsule.copies[id] || 1);
      tee = [...tees].sort((a, b) => share(a) - share(b))[0];
      teeUse[tee] = (teeUse[tee] || 0) + 1;
    }
    const model = pool.models[day.season];
    const fitsDay = (id) => {
      const item = model && model.byId[id];
      return item && item.mask & (1 << (t - model.scale.min));
    };
    return {
      day,
      outfit: pick,
      shoe: travel ? capsule.travelItems[0] : pick.s,
      travel,
      road,
      tee,
      head: heads.find(fitsDay) || null,
      scarf: scarves.find(fitsDay) || null,
    };
  });
}

/** Дни для режима без прогноза: температуры от tmax до tmin вперемешку, дождь каждый третий день. */
export function manualDays({days, tmin, tmax, rain, season}) {
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
