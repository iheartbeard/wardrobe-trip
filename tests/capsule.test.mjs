/* Тесты капсулы. Нужен клон wardrobe-fits рядом с этим репозиторием: модель и данные берутся оттуда. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  LUGGAGE,
  TRIP_RULES,
  buildCapsule,
  buildPool,
  capsuleSlot,
  manualDays,
  planDays,
  seasonOf,
  tripOutfits,
  uniqueConditions,
} from '../js/trip/capsule.js';
import {evaluateColors} from '../js/trip/wardrobe.js';
import {dateRange} from '../js/trip/forecast.js';

const pool = buildPool();

const trips = {
  'осень с дождём': {days: 7, tmin: 8, tmax: 16, rain: true, season: 'autumn'},
  'осень, холодно': {days: 4, tmin: 6, tmax: 10, season: 'autumn'},
  'осень, тепло': {days: 5, tmin: 12, tmax: 18, season: 'autumn'},
  зима: {days: 5, tmin: 2, tmax: 9, rain: true, season: 'winter'},
};

const slotOf = (id) => capsuleSlot(pool.items[id]);
const ofSlot = (capsule, slot) => capsule.ids.filter((id) => slotOf(id) === slot);

for (const [name, trip] of Object.entries(trips)) {
  for (const luggage of Object.keys(LUGGAGE)) {
    test(`${name}, ${luggage}`, async (t) => {
      const days = manualDays(trip);
      const capsule = buildCapsule(pool, days, {luggage});

      await t.test('все дни закрыты', () => assert.deepEqual(capsule.gaps, []));

      await t.test('всё сочетается со всем: каждая пара вещей, которые носятся вместе', () => {
        for (const a of capsule.ids) {
          for (const b of capsule.ids) {
            if (a < b && slotOf(a) !== slotOf(b)) {
              assert.ok(evaluateColors([pool.items[a], pool.items[b]]), `${a} + ${b}`);
            }
          }
        }
      });

      await t.test('каждый образ из капсулы под погоду поездки проходит проверку цвета', () => {
        const all = tripOutfits(pool, uniqueConditions(days));
        all
          .filter((outfit) => outfit.ids.every((id) => capsule.ids.includes(id)))
          .forEach((outfit) => assert.notEqual(outfit.score, null, outfit.ids.join(' + ')));
      });

      await t.test('образы — это образы модели основного проекта', () => {
        capsule.outfits.forEach((outfit) => {
          const model = pool.models[trip.season];
          assert.ok(
            model.outfits.some((o) => o.o === outfit.o && o.m === outfit.m && o.b === outfit.b && o.s === outfit.s),
          );
        });
      });

      await t.test('лимиты багажа и правила сборов', () => {
        const limits = LUGGAGE[luggage];
        for (const slot of ['o', 'm', 'b', 'h']) {
          assert.ok(ofSlot(capsule, slot).length <= limits[slot], slot);
        }
        assert.ok(ofSlot(capsule, 's').length <= limits.s);
        assert.ok(ofSlot(capsule, 'm').length <= 2, 'средний слой максимум 2');
        assert.ok(
          ofSlot(capsule, 'm').filter((id) => pool.items[id].kind === TRIP_RULES.hoodieKind).length <= 1,
          'худи максимум 1',
        );
        assert.ok(capsule.ids.filter((id) => TRIP_RULES.jeans.includes(id)).length <= TRIP_RULES.maxJeans);
        assert.ok(capsule.ids.every((id) => ![...TRIP_RULES.notForWalking, ...TRIP_RULES.eventOnly].includes(id)));
      });

      await t.test('план по дням: образ на каждый день', () => {
        planDays(pool, capsule, days).forEach((entry) => assert.ok(entry.outfit, `день ${entry.day.t}`));
      });
    });
  }
}

test('сезон по дате и сезоны без данных', () => {
  assert.equal(seasonOf('2026-11-20'), 'autumn');
  assert.equal(seasonOf('2026-12-01'), 'winter');
  assert.equal(seasonOf('2027-04-10'), 'spring');
  assert.equal(seasonOf('2027-07-01'), 'summer');
  const summer = buildCapsule(pool, manualDays({days: 4, tmin: 24, tmax: 30, season: 'summer'}));
  assert.equal(summer.unsupported.length, summer.conditions.length);
  assert.deepEqual(summer.ids, []);
});

test('в ноябре зимние вещи не берутся', () => {
  const nov = tripOutfits(pool, uniqueConditions(manualDays({days: 5, tmin: 5, tmax: 10, season: 'autumn'})));
  assert.ok(nov.every((outfit) => outfit.o !== 'det2'));
});

test('джинсы берутся в последнюю очередь, но не больше двух', () => {
  const days = manualDays(trips['осень с дождём']);
  const pinned = buildCapsule(pool, days, {luggage: 'carryon', pinned: ['bn1', 'bn2', 'be']});
  assert.ok(pinned.ids.filter((id) => TRIP_RULES.jeans.includes(id)).length >= 2);
});

test('обувь первой, пара только для дороги и мероприятие', () => {
  const days = manualDays(trips['осень с дождём']);
  const capsule = buildCapsule(pool, days, {luggage: 'carryon', travelShoe: 'bos', event: true});
  assert.deepEqual(capsule.travelItems, ['bos']);
  assert.deepEqual(capsule.eventItems, ['tim']);
  assert.ok(ofSlot(capsule, 's').length <= LUGGAGE.carryon.s + 1);
  assert.ok(capsule.outfits.every((outfit) => outfit.s !== 'bos' && outfit.s !== 'tim'));
  planDays(pool, capsule, days).forEach((entry, i) => {
    assert.equal(entry.shoe === 'bos', i === 0 || i === days.length - 1);
  });
});

test('короткая поездка: две пары обуви', () => {
  const capsule = buildCapsule(pool, manualDays({...trips['осень с дождём'], days: 3}), {luggage: 'carryon'});
  assert.equal(capsule.limits.s, 2);
});

test('если все тёплые слои заменены, капсула подсказывает, что вернуть', () => {
  const excluded = Object.values(pool.items)
    .filter((item) => ['sw', 'ss', 'vs'].includes(item.kind) || item.warm || item.id === 'tu')
    .map((item) => item.id);
  const days = [6, 9, 10].map((t) => ({t, season: 'autumn'}));
  const capsule = buildCapsule(pool, days, {luggage: 'carryon', excluded});
  assert.ok(capsule.replacedGaps.length > 0);
  assert.ok(capsule.restore.length > 0 && capsule.restore.every((id) => excluded.includes(id)));
});

test('ручные дни и даты', () => {
  const days = manualDays({days: 5, tmin: 10, tmax: 20, rain: true, season: 'autumn'});
  assert.deepEqual(
    days.map((d) => d.t).sort((a, b) => a - b),
    [10, 13, 15, 18, 20],
  );
  assert.deepEqual(dateRange('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});
