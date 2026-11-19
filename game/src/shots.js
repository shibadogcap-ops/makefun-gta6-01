// Screenshot scenes for ?shot=<name>&seed=<n>. Nothing simulates in shot mode,
// so each scene calls traffic.update()/peds.update() a few ticks around a staged
// focus to populate the frame, then hand-places the hero entities. Everything
// is deterministic: the only randomness is createRandom(stage.seed).

import { PALETTE } from './config.js';
import { createRandom } from './random.js';
import { createCar } from './vehicles.js';

const DT = 1 / 30;
const TAU = Math.PI * 2;

/** True when a circle of radius r at (x,y) is on land and clear of buildings. */
function free(city, x, y, r) {
  return !city.isWater(x, y) && !city.collide(x, y, r);
}

/** First free point among candidates, trying rings of nudges around each. */
function spot(city, candidates, r) {
  for (const [cx, cy] of candidates) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const d = i * 7;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      if (free(city, x, y, r)) return { x, y };
    }
  }
  return { x: candidates[0][0], y: candidates[0][1] };
}

/** vx/vy consistent with the heading so the car reads as moving. */
function driveLook(car, speed) {
  car.speed = speed;
  car.vx = Math.cos(car.angle) * speed;
  car.vy = Math.sin(car.angle) * speed;
}

/** Advance traffic + peds a few ticks so cars and pedestrians fill the frame. */
function populate(stage, focus, focusCar, ticks = 9) {
  for (let i = 0; i < ticks; i++) {
    stage.traffic.update(DT, stage.city, focus, focusCar || null);
    stage.peds.update(DT, { city: stage.city, focus, danger: null });
  }
}

/** A traffic car already committed to a lane so it keeps driving sensibly. */
function laneCar(stage, type, x, y, axis, coord, dir, color) {
  const car = createCar(type, x, y, axis === 'v'
    ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2)
    : (dir > 0 ? 0 : Math.PI), color);
  car.driver = 'traffic';
  car.cruise = 175;
  car.roadAxis = axis;
  car.roadCoord = coord;
  car.roadDir = dir;
  car.roadProgress = axis === 'v' ? y : x;
  driveLook(car, 150);
  stage.traffic.cars.push(car);
  return car;
}

/** The player's car: driven look, optionally lane-aware for the traffic AI. */
function heroCar(stage, type, x, y, angle, color, speed, road) {
  const car = createCar(type, x, y, angle, color);
  car.driver = 'player';
  car.cruise = speed;
  driveLook(car, speed);
  car.steerVis = 0.12;
  if (road) Object.assign(car, road);
  stage.traffic.cars.push(car);
  return car;
}

/** Reset a hero car after populate() — traffic.update drives everything in traffic.cars. */
function rePin(car, x, y, angle, speed) {
  car.x = x;
  car.y = y;
  car.angle = angle;
  driveLook(car, speed);
  car.steerVis = 0.12;
  if (car.roadAxis) car.roadProgress = car.roadAxis === 'v' ? y : x;
}

function copCar(stage, x, y, tx, ty, speed = 320) {
  const car = createCar('police', x, y, Math.atan2(ty - y, tx - x));
  car.driver = 'police';
  car.lightsOn = true;
  driveLook(car, speed);
  car.steerVis = 0.2;
  stage.police.cars.push(car);
  return car;
}

/** Drop traffic cars that ended up parked on top of a staged (kept) car. */
function clearTraffic(stage, keep, minD = 95) {
  const cars = stage.traffic.cars;
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    if (keep.has(c)) continue;
    for (const k of keep) {
      if (Math.hypot(c.x - k.x, c.y - k.y) < minD) {
        cars.splice(i, 1);
        break;
      }
    }
  }
}

function syncPlayerCar(player, car) {
  player.mode = 'car';
  player.car = car;
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.speedNow = Math.abs(car.speed);
  player.walkPhase = 0;
  player.dead = false;
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/** Living downtown backdrop for the title screen; player idles at the diner spawn. */
function shotTitle(stage) {
  populate(stage, { x: 2100, y: 1700 }, null, 10);
  return { screen: 'title' };
}

/** The cover shot: a sports car fleeing two police units on the y=1400 road. */
function shotChase(stage, rng) {
  const { player, police, missions } = stage;
  const hx = 2000;
  const hy = 1424; // eastbound lane of the y=1400 road
  const hero = heroCar(stage, 'sports', hx, hy, 0, '#f2685c', 340, {
    roadAxis: 'h', roadCoord: 1400, roadDir: 1, roadProgress: hx,
  });
  syncPlayerCar(player, hero);

  const keep = new Set([hero]);
  for (const c of [
    laneCar(stage, 'sedan', 2280, 1424, 'h', 1400, 1, rng.pick(PALETTE.CAR_COLORS)),
    laneCar(stage, 'hatch', 2520, 1424, 'h', 1400, 1, rng.pick(PALETTE.CAR_COLORS)),
    laneCar(stage, 'taxi', 2400, 1376, 'h', 1400, -1, '#e9c46a'),
    laneCar(stage, 'sedan', 2760, 1376, 'h', 1400, -1, rng.pick(PALETTE.CAR_COLORS)),
  ]) keep.add(c);

  copCar(stage, 1860, 1390, hx, hy);
  copCar(stage, 1880, 1440, hx, hy);

  police.heat = 250;
  police.wanted = 3;
  police.busted = 0;
  missions.startOffered();

  populate(stage, hero, hero, 9);

  rePin(hero, hx, hy, 0, 340);
  syncPlayerCar(player, hero);
  clearTraffic(stage, keep);
  return { screen: 'game' };
}

/** On foot on a downtown sidewalk with a parked car at the kerb. */
function shotOnFoot(stage, rng) {
  const { city, traffic, peds, player, police } = stage;
  police.heat = 0;
  police.wanted = 0;
  police.busted = 0;
  police.cars.length = 0;

  // North sidewalk of the y=1800 road near x=2300.
  const base = spot(city, [
    [2300, 1740], [2280, 1739], [2320, 1741], [2260, 1742], [2340, 1738],
  ], 16);
  player.x = base.x;
  player.y = base.y;
  player.mode = 'foot';
  player.car = null;
  player.speedNow = 0;
  player.angle = Math.PI / 2;
  player.walkPhase = 0.4;
  player.dead = false;

  // Parked car at the kerb, within interact range (64px) of the player.
  let car = null;
  let best = Infinity;
  for (const c of traffic.parked) {
    const d = Math.hypot(c.x - base.x, c.y - base.y);
    if (d < best) { best = d; car = c; }
  }
  const carPos = spot(city, [
    [base.x - 46, 1772], [base.x - 20, 1774], [base.x + 30, 1770], [base.x + 52, 1772],
  ], 20);
  if (!car) {
    car = createCar('sedan', carPos.x, carPos.y, 0, rng.pick(PALETTE.CAR_COLORS));
    traffic.parked.push(car);
  } else {
    car.x = carPos.x;
    car.y = carPos.y;
    car.angle = 0;
  }
  car.parked = true;
  car.driver = null;

  // Traffic flowing on the y=1800 road, both lanes.
  const keep = new Set([car]);
  for (const c of [
    laneCar(stage, 'sedan', base.x + 320, 1824, 'h', 1800, 1, rng.pick(PALETTE.CAR_COLORS)),
    laneCar(stage, 'hatch', base.x - 380, 1776, 'h', 1800, -1, rng.pick(PALETTE.CAR_COLORS)),
    laneCar(stage, 'taxi', base.x + 560, 1824, 'h', 1800, 1, '#e9c46a'),
  ]) keep.add(c);

  populate(stage, player, null, 9);

  // Hand-place a few pedestrians on the sidewalks around the player.
  const pedSpots = [
    [base.x - 150, 1742], [base.x - 60, 1739], [base.x + 55, 1741],
    [base.x + 140, 1738], [base.x + 30, 1860],
  ];
  const near = peds.list
    .slice()
    .sort((a, b) => Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y))
    .slice(0, pedSpots.length);
  near.forEach((ped, i) => {
    const s = spot(city, [pedSpots[i]], 10);
    if (!free(city, s.x, s.y, 10)) return;
    ped.x = s.x;
    ped.y = s.y;
    ped.state = 'walk';
    ped.panic = 0;
    ped.downTimer = 0;
    ped.axis = 'h';
    ped.dir = i % 2 ? 1 : -1;
    ped.speed = 70;
    ped.targetX = Math.min(Math.max(s.x + ped.dir * 90, 20), 4780);
    ped.targetY = s.y;
    ped.angle = ped.dir > 0 ? 0 : Math.PI;
  });

  clearTraffic(stage, keep);
  return { screen: 'game' };
}

/** Mission 1 at the delivery stage, then a coastal-road drive south with heat. */
function shotMission(stage, rng) {
  const { city, traffic, peds, player, police, missions } = stage;

  // Teleport to the diner and run mission 1 up to its delivery objective.
  const diner = city.landmarks.diner;
  player.x = diner.x;
  player.y = diner.y;
  player.mode = 'foot';
  player.car = null;
  player.speedNow = 0;
  player.angle = 0;
  player.walkPhase = 0;
  player.dead = false;
  player.health = 100;
  missions.startOffered();
  const stub = { city, player, police, cars: [], addCar: () => {} };
  for (let i = 0; i < 8; i++) {
    const obj = missions.currentObjective();
    if (obj && obj.kind === 'deliver') break;
    missions.update(0.1, stub);
  }

  // Teal sedan, southbound in the x=4200 coastal-road lane, heading for the marina.
  const cx = 4176;
  const cy = 1900;
  const hero = heroCar(stage, 'sedan', cx, cy, Math.PI / 2, '#2a9d8f', 320, {
    roadAxis: 'v', roadCoord: 4200, roadDir: 1, roadProgress: cy,
  });
  syncPlayerCar(player, hero);

  const keep = new Set([hero]);
  for (const c of [
    laneCar(stage, 'sedan', 4176, 2250, 'v', 4200, 1, rng.pick(PALETTE.CAR_COLORS)),
    laneCar(stage, 'hatch', 4176, 2550, 'v', 4200, 1, rng.pick(PALETTE.CAR_COLORS)),
    laneCar(stage, 'taxi', 4224, 2400, 'v', 4200, -1, '#e9c46a'),
  ]) keep.add(c);

  copCar(stage, 4195, 1500, cx, cy);
  police.heat = 40;
  police.wanted = 1;
  police.busted = 0;

  populate(stage, hero, hero, 9);

  rePin(hero, cx, cy, Math.PI / 2, 320);
  syncPlayerCar(player, hero);
  clearTraffic(stage, keep);
  return { screen: 'game' };
}

/** Stage the named scene; unknown names fall back to the title backdrop. */
export async function stageShot(name, stage) {
  const rng = createRandom(stage.seed);
  if (name === 'chase') return shotChase(stage, rng);
  if (name === 'onfoot') return shotOnFoot(stage, rng);
  if (name === 'mission') return shotMission(stage, rng);
  return shotTitle(stage);
}
