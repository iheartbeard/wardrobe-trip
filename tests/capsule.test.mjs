import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  LUGGAGE,
  buildCapsule,
  buildPool,
  capsuleSlot,
  manualDays,
  planDays,
  uniqueConditions,
} from '../js/trip/capsule.js';
import {evaluateColors} from '../js/lib/color.js';
import {dateRange} from '../js/trip/forecast.js';

const pool = buildPool();

const trips = {
  осень: {days: 7, tmin: 10, tmax: 18, rain: true},
  зима: {days: 5, tmin: 2, tmax: 10, rain: true},
  лето: {days: 10, tmin: 24, tmax: 30, rain: false},
  разброс: {days: 14, tmin: 8, tmax: 26, rain: true},
};

test('ручные дни включают обе границы и не выходят за них', () => {
  const days = manualDays({days: 5, tmin: 10, tmax: 20, rain: true});
  assert.equal(days.length, 5);
  const temps = days.map((d) => d.t);
  assert.ok(temps.includes(10) && temps.includes(20));
  assert.ok(temps.every((t) => t >= 10 && t <= 20));
  assert.ok(days.some((d) => d.rain));
  assert.deepEqual(manualDays({days: 1, tmin: 15, tmax: 15}), [{t: 15, rain: false}]);
});

test('условия поездки без повторов и в пределах гардероба', () => {
  const conds = uniqueConditions([{t: 40}, {t: 40}, {t: -10, rain: true}, {t: 12.4}]);
  assert.deepEqual(conds, [
    {t: 0, rain: true},
    {t: 12, rain: false},
    {t: 32, rain: false},
  ]);
});

test('даты поездки', () => {
  assert.deepEqual(dateRange('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});

for (const [name, trip] of Object.entries(trips)) {
  for (const luggage of Object.keys(LUGGAGE)) {
    test(`${name}, ${luggage}: капсула в лимитах, покрывает погоду, образы без цветовых конфликтов`, () => {
      const days = manualDays(trip);
      const capsule = buildCapsule(pool, days, {luggage});
      const counts = {};
      capsule.ids.forEach((id) => {
        const slot = capsuleSlot(pool.items[id]);
        counts[slot] = (counts[slot] || 0) + 1;
      });
      for (const slot of ['o', 'm', 'b', 's', 'h']) {
        assert.ok((counts[slot] || 0) <= capsule.limits[slot], `${slot}: ${counts[slot]} > ${capsule.limits[slot]}`);
      }
      assert.ok((counts.t || 0) >= 2, 'хотя бы две футболки');
      /* Непокрытыми могут остаться только условия, под которые в гардеробе нет образа вообще */
      /* В один рюкзак с одной парой обуви дождь и сухие дни закрываются не всегда, это честные пробелы */
      if (luggage !== 'backpack') {
        assert.ok(
          capsule.gaps.every((gap) => capsule.impossible.includes(gap)),
          'все возможные дни закрыты',
        );
      }
      capsule.outfits.forEach((outfit) => {
        assert.ok(outfit.ids.every((id) => capsule.ids.includes(id)));
        assert.ok(evaluateColors(outfit.ids.map((id) => pool.items[id])));
      });

      const plan = planDays(pool, capsule, days);
      assert.equal(plan.length, days.length);
      plan
        .filter((entry) => !capsule.gaps.some((c) => c.t === entry.day.t && c.rain === entry.day.rain))
        .forEach((entry) => assert.ok(entry.outfit, `образ на ${entry.day.t}`));
    });
  }
}

test('закреплённая вещь остаётся, убранная не попадает', () => {
  const days = manualDays(trips.осень);
  const base = buildCapsule(pool, days);
  const drop = base.ids.find((id) => capsuleSlot(pool.items[id]) === 's');
  const capsule = buildCapsule(pool, days, {pinned: ['bd'], excluded: [drop]});
  assert.ok(capsule.ids.includes('bd'));
  assert.ok(!capsule.ids.includes(drop));
});

test('ботинки 3-Eye в поездку только под мероприятие, вне лимитов и плана', () => {
  for (const trip of Object.values(trips)) {
    const days = manualDays(trip);
    const plain = buildCapsule(pool, days, {luggage: 'carryon'});
    assert.ok(!plain.ids.includes('tim'));
    const withEvent = buildCapsule(pool, days, {luggage: 'carryon', event: true});
    assert.deepEqual(withEvent.eventItems, ['tim']);
    assert.ok(withEvent.ids.includes('tim'));
    assert.ok(withEvent.outfits.every((outfit) => outfit.s !== 'tim'));
    planDays(pool, withEvent, days).forEach((entry) => assert.notEqual(entry.outfit && entry.outfit.s, 'tim'));
  }
});

test('слипоны и Palermo в поездку не предлагаются', () => {
  for (const trip of Object.values(trips)) {
    for (const luggage of Object.keys(LUGGAGE)) {
      const capsule = buildCapsule(pool, manualDays(trip), {luggage, pinned: ['van']});
      assert.ok(['van', 'pal', 'w1', 'w2', 'bos'].every((id) => !capsule.ids.includes(id)));
    }
  }
});

test('пара только для дороги: любая, на первый и последний день, входит в лимит', () => {
  const days = manualDays(trips.осень);
  for (const shoe of ['bos', 'n990t']) {
    const capsule = buildCapsule(pool, days, {luggage: 'carryon', travelShoe: shoe});
    assert.deepEqual(capsule.travelItems, [shoe]);
    assert.ok(capsule.outfits.every((outfit) => outfit.s !== shoe));
    const shoes = capsule.ids.filter((id) => capsuleSlot(pool.items[id]) === 's');
    assert.ok(shoes.length <= LUGGAGE.carryon.s);
    planDays(pool, capsule, days).forEach((entry, i) => {
      const road = i === 0 || i === days.length - 1;
      assert.equal(entry.travel, road);
      assert.equal(entry.shoe === shoe, road);
    });
  }
  assert.deepEqual(buildCapsule(pool, days, {luggage: 'backpack', travelShoe: 'bos'}).travelItems, []);
});

test('с чемоданом на короткую поездку две пары обуви, на длинную три', () => {
  const short = buildCapsule(pool, manualDays({days: 3, tmin: 10, tmax: 17, rain: true}), {luggage: 'carryon'});
  const long = buildCapsule(pool, manualDays({days: 8, tmin: 10, tmax: 17, rain: true}), {luggage: 'carryon'});
  const count = (c) => c.ids.filter((id) => capsuleSlot(pool.items[id]) === 's').length;
  assert.equal(short.limits.s, 2);
  assert.ok(count(short) <= 2);
  assert.equal(long.limits.s, 3);
});

test('куртка в поездку всегда одна', () => {
  for (const trip of Object.values(trips)) {
    for (const luggage of Object.keys(LUGGAGE)) {
      const capsule = buildCapsule(pool, manualDays(trip), {luggage});
      assert.ok(capsule.ids.filter((id) => capsuleSlot(pool.items[id]) === 'o').length <= 1);
    }
  }
});

test('верхний слой один: куртка или жилетка, без выдуманных пар', () => {
  for (const trip of Object.values(trips)) {
    for (const luggage of Object.keys(LUGGAGE)) {
      const capsule = buildCapsule(pool, manualDays(trip), {luggage});
      assert.ok(capsule.ids.filter((id) => capsuleSlot(pool.items[id]) === 'o').length <= 1);
      capsule.outfits.forEach((outfit) => {
        const outer = pool.items[outfit.o];
        if (outer && outer.group === 'Жилетки') {
          assert.notEqual(pool.items[outfit.m].kind, 'vs', 'жилетка под жилеткой');
        }
      });
    }
  }
});
