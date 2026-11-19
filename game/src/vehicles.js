// Vehicles: car types, arcade physics, top-down drawing, traffic AI and parked cars.

import { ROAD_W, WORLD, PALETTE } from './config.js';
import { clamp, dist2, angleLerp } from './random.js';

/** Vehicle dimensions and performance per type. Colors are picked at spawn. */
export const CAR_TYPES = {
  sedan:  { length: 46, width: 22, maxSpeed: 430, accel: 240, grip: 6.0 },
  hatch:  { length: 44, width: 21, maxSpeed: 440, accel: 265, grip: 6.4 },
  taxi:   { length: 46, width: 22, maxSpeed: 430, accel: 240, grip: 6.0 },
  sports: { length: 48, width: 22, maxSpeed: 640, accel: 380, grip: 7.2 },
  truck:  { length: 62, width: 26, maxSpeed: 300, accel: 140, grip: 4.6 },
  police: { length: 48, width: 23, maxSpeed: 600, accel: 360, grip: 6.6 },
};

const TRAFFIC_TYPES = ['sedan', 'hatch', 'sedan', 'taxi', 'hatch', 'truck', 'sports', 'sedan'];
const LANE_OFF = ROAD_W / 4; // lane offset to the right of travel direction

function typeOf(car) {
  return CAR_TYPES[car.type] || CAR_TYPES.sedan;
}

/** Deterministic pseudo-random phase in [0,1) derived from a car's position. */
function hashPhase(x, y, salt) {
  const v = Math.sin(x * 0.01337 + y * 0.00771 + salt * 91.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Darken (amt < 0) or lighten (amt > 0) a #rrggbb color by a fraction. */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * (1 + amt)), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * (1 + amt)), 0, 255);
  const b = clamp(Math.round((n & 255) * (1 + amt)), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function createCar(type, x, y, angle, color) {
  return {
    type,
    x, y,
    angle,
    vx: 0, vy: 0,
    speed: 0, // signed forward speed
    color: color || PALETTE.CAR_COLORS[0],
    health: 100,
    driver: null, // 'traffic' | 'player' | 'police'
    parked: false,
    sirenPhase: hashPhase(x, y, 3),
    damageSmoke: false,
    steerVis: 0,
    lightsOn: false,
  };
}

/**
 * Arcade car physics shared by player, traffic and police.
 * control = { throttle: -1..1, steer: -1..1, handbrake: bool }.
 * Returns { hit: null | { hard, x, y } } for world collisions only.
 */
export function stepCar(car, dt, control, city) {
  const t = typeOf(car);
  const throttle = clamp(control ? control.throttle || 0 : 0, -1, 1);
  const steer = clamp(control ? control.steer || 0 : 0, -1, 1);
  const handbrake = !!(control && control.handbrake);

  // --- longitudinal ---
  const maxRev = -t.maxSpeed * 0.4;
  if (throttle > 0) {
    // braking while rolling backward gets a stronger shove to get moving
    car.speed += throttle * t.accel * dt * (car.speed < -5 ? 2.0 : 1);
  } else if (throttle < 0) {
    if (car.speed > 2) {
      car.speed += throttle * t.accel * 1.5 * dt; // brake
    } else {
      car.speed = Math.max(car.speed + throttle * t.accel * dt, maxRev);
    }
  }
  // drag + rolling resistance
  car.speed -= car.speed * (0.5 + t.accel / 1100) * dt;
  car.speed -= Math.sign(car.speed) * (handbrake ? 60 : 20) * dt;
  if (Math.abs(car.speed) < 5 && throttle === 0) car.speed = 0;
  car.speed = clamp(car.speed, maxRev, t.maxSpeed);

  // --- steering: less at speed, none at standstill, reversed in reverse ---
  const sf = Math.abs(car.speed);
  const speedFactor =
    clamp(sf / 140, 0, 1) *
    (1 - 0.45 * clamp((sf - t.maxSpeed * 0.55) / (t.maxSpeed * 0.45), 0, 1));
  const turnDir = car.speed < -1 ? -1 : 1;
  car.angle += steer * 2.9 * speedFactor * dt * turnDir;
  car.steerVis = (car.steerVis || 0) * 0.72 + steer * 0.28;

  // --- velocity: mostly along heading, grip kills the sideways component ---
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const lx = -fy;
  const ly = fx;
  let lvx = car.vx * lx + car.vy * ly;
  const grip = handbrake ? t.grip * 0.22 : t.grip;
  lvx *= Math.exp(-grip * dt);
  if (handbrake) car.speed -= Math.sign(car.speed) * 90 * dt;
  car.vx = fx * car.speed + lx * lvx;
  car.vy = fy * car.speed + ly * lvx;

  // --- integrate ---
  car.x += car.vx * dt;
  car.y += car.vy * dt;

  // --- world collision at nose and tail sample points ---
  const half = t.length * 0.5 - 2;
  const r = t.width * 0.5;
  let hit = null;
  for (const end of [1, -1]) {
    const px = car.x + fx * half * end;
    const py = car.y + fy * half * end;
    const res = city.collide(px, py, r);
    if (!res) continue;
    // normal: prefer one returned by collide(), else point from sample to car centre
    let nx, ny;
    if (typeof res === 'object' && res.nx !== undefined) {
      nx = res.nx; ny = res.ny;
    } else {
      const len = Math.hypot(car.x - px, car.y - py) || 1;
      nx = (car.x - px) / len; ny = (car.y - py) / len;
    }
    const vn = car.vx * nx + car.vy * ny;
    if (vn < 0) { car.vx -= nx * vn * 1.7; car.vy -= ny * vn * 1.7; } // kill into-wall component, slight bounce
    car.speed *= -0.25;
    car.x -= nx * 2; car.y -= ny * 2;
    hit = { hard: Math.abs(vn) > 260, x: px, y: py };
  }
  return { hit };
}

/** Draw a car top-down. ctx is already translated to the world; we centre on the car. */
export function drawCar(ctx, car, t) {
  const d = typeOf(car);
  const L = d.length;
  const W = d.width;
  const isPolice = car.type === 'police';
  const body = isPolice ? '#eef1f5' : car.color;

  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  // soft shadow
  ctx.fillStyle = 'rgba(24,18,32,0.30)';
  roundRect(ctx, -L / 2 + 2, -W / 2 + 3, L, W, W * 0.42);
  ctx.fill();

  // body
  ctx.fillStyle = body;
  roundRect(ctx, -L / 2, -W / 2, L, W, W * 0.4);
  ctx.fill();
  ctx.strokeStyle = shade(isPolice ? '#c9ced6' : body, -0.38);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // police: navy door band along both flanks
  if (isPolice) {
    ctx.fillStyle = '#1d3557';
    ctx.fillRect(-L / 2 + 4, -W / 2 + 2, L - 8, 4);
    ctx.fillRect(-L / 2 + 4, W / 2 - 6, L - 8, 4);
  }

  // cabin / roof
  const cabL = L * 0.5;
  const cabW = W * 0.62;
  ctx.fillStyle = shade(body, -0.14);
  roundRect(ctx, -cabL * 0.55, -cabW / 2, cabL * 1.1, cabW, 5);
  ctx.fill();

  // glass: windshield toward front (+x), rear window at back
  const glass = '#2b3a4a';
  ctx.fillStyle = glass;
  roundRect(ctx, cabL * 0.12, -cabW / 2 + 1.5, cabL * 0.34, cabW - 3, 3);
  ctx.fill();
  roundRect(ctx, -cabL * 0.62, -cabW / 2 + 1.5, cabL * 0.2, cabW - 3, 3);
  ctx.fill();

  // headlights (pale) and taillights (red)
  ctx.fillStyle = '#fff6c9';
  ctx.fillRect(L / 2 - 3, -W / 2 + 3, 3, 4);
  ctx.fillRect(L / 2 - 3, W / 2 - 7, 3, 4);
  ctx.fillStyle = '#d7263d';
  ctx.fillRect(-L / 2, -W / 2 + 3, 3, 4);
  ctx.fillRect(-L / 2, W / 2 - 7, 3, 4);

  // headlights cone
  if (car.lightsOn) {
    const grad = ctx.createLinearGradient(L / 2, 0, L / 2 + 170, 0);
    grad.addColorStop(0, 'rgba(255,244,200,0.30)');
    grad.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(L / 2 - 2, -W * 0.32);
    ctx.lineTo(L / 2 + 170, -W * 1.7);
    ctx.lineTo(L / 2 + 170, W * 1.7);
    ctx.lineTo(L / 2 - 2, W * 0.32);
    ctx.closePath();
    ctx.fill();
  }

  // wheels (front pair steers visually)
  const wy = W / 2 - 3;
  const wx = L * 0.33;
  const steerAng = (car.steerVis || 0) * 0.45;
  ctx.fillStyle = '#15151c';
  const wheel = (x, y, ang) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillRect(-4.5, -2.6, 9, 5.2);
    ctx.restore();
  };
  wheel(wx, -wy, steerAng); wheel(wx, wy, steerAng);
  wheel(-wx, -wy, 0); wheel(-wx, wy, 0);

  // police light bar: red/blue halves alternate with time
  if (isPolice) {
    const ph = (t / 0.9 + car.sirenPhase) % 1;
    const redOn = ph < 0.5;
    ctx.fillStyle = '#22262e';
    roundRect(ctx, -7, -W * 0.18, 14, W * 0.36, 3);
    ctx.fill();
    ctx.fillStyle = redOn ? 'rgba(255,60,60,0.95)' : 'rgba(255,60,60,0.18)';
    ctx.fillRect(-6, -W * 0.16, 6, W * 0.32);
    ctx.fillStyle = !redOn ? 'rgba(70,140,255,0.95)' : 'rgba(70,140,255,0.18)';
    ctx.fillRect(0, -W * 0.16, 6, W * 0.32);
    ctx.fillStyle = redOn ? 'rgba(255,80,80,0.5)' : 'rgba(255,80,80,0.08)';
    ctx.beginPath(); ctx.arc(-4, 0, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = !redOn ? 'rgba(90,160,255,0.5)' : 'rgba(90,160,255,0.08)';
    ctx.beginPath(); ctx.arc(4, 0, 7, 0, Math.PI * 2); ctx.fill();
  }

  // damage: grey smoke puffs (deterministic from position + t)
  if (car.health < 45) {
    for (let i = 0; i < 3; i++) {
      const seed = hashPhase(car.x, car.y, i + 11);
      const life = (t * 0.55 + seed) % 1;
      ctx.fillStyle = `rgba(125,122,128,${(1 - life) * 0.4})`;
      ctx.beginPath();
      ctx.arc(-L * 0.3 + ((seed * 37 + i * 13) % 10) - 5, -W * 0.3 + ((seed * 91 + i * 29) % (W * 0.6)) - life * 14, 3 + life * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // heavy damage: scorch marks
  if (car.health < 20) {
    ctx.fillStyle = 'rgba(28,22,26,0.6)';
    ctx.beginPath(); ctx.ellipse(-L * 0.05, -W * 0.1, L * 0.22, W * 0.2, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(L * 0.18, W * 0.12, L * 0.12, W * 0.16, -0.4, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

/** The 4 corner points of the car's footprint (for other modules' collision). */
export function carCorners(car) {
  const t = typeOf(car);
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const rx = -fy;
  const ry = fx;
  const hl = t.length * 0.5;
  const hw = t.width * 0.5;
  const pts = [];
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      pts.push({
        x: car.x + fx * hl * sx + rx * hw * sy,
        y: car.y + fy * hl * sx + ry * hw * sy,
      });
    }
  }
  return pts;
}

/** True if world point (x,y) is inside the car's oriented rectangle. */
export function pointInCar(car, x, y) {
  const t = typeOf(car);
  const dx = x - car.x;
  const dy = y - car.y;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const lx = -fy;
  const ly = fx;
  const along = dx * fx + dy * fy;
  const across = dx * lx + dy * ly;
  return Math.abs(along) <= t.length * 0.5 && Math.abs(across) <= t.width * 0.5;
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

function trafficColor(type, rng) {
  if (type === 'taxi') return '#e9c46a';
  if (type === 'police') return '#eef1f5';
  return rng.pick(PALETTE.CAR_COLORS);
}

function roadAngle(axis, dir) {
  if (axis === 'v') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

function lanePoint(car) {
  // lane centreline point nearest the car + signed lateral error (right = positive)
  if (car.roadAxis === 'v') {
    const laneX = car.roadCoord - car.roadDir * LANE_OFF;
    return { x: laneX, y: car.y, lat: car.roadDir * (laneX - car.x) };
  }
  const laneY = car.roadCoord + car.roadDir * LANE_OFF;
  return { x: car.x, y: laneY, lat: car.roadDir * (car.y - laneY) };
}

function sortedRoads(list) {
  return (list || []).slice().sort((a, b) => a - b);
}

function createTraffic(city, rng, count) {
  const cars = [];
  const parked = [];
  const roadsV = sortedRoads(city.roadsX || []);
  const roadsH = sortedRoads(city.roadsY || []);

  function spawnTrafficCar(focus) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const axis = rng.chance(0.5) ? 'v' : 'h';
      const list = axis === 'v' ? roadsV : roadsH;
      if (!list.length) return null;
      const coord = rng.pick(list);
      const dir = rng.chance(0.5) ? 1 : -1;
      const margin = 160;
      const along = rng.range(margin, (axis === 'v' ? WORLD.height : WORLD.width) - margin);
      const lane = axis === 'v' ? coord - dir * LANE_OFF : coord + dir * LANE_OFF;
      const x = axis === 'v' ? lane : along;
      const y = axis === 'v' ? along : lane;
      if (dist2(x, y, focus.x, focus.y) < 500 * 500) continue;
      if (dist2(x, y, focus.x, focus.y) > 1500 * 1500) continue;
      if (city.isWater(x, y)) continue;
      const type = rng.pick(TRAFFIC_TYPES);
      const car = createCar(type, x, y, roadAngle(axis, dir), trafficColor(type, rng));
      car.driver = 'traffic';
      car.cruise = rng.range(130, 210);
      car.roadAxis = axis; car.roadCoord = coord; car.roadDir = dir;
      car.roadProgress = axis === 'v' ? y : x;
      cars.push(car);
      return car;
    }
    return null;
  }

  function spawnParkedCar() {
    for (let attempt = 0; attempt < 40; attempt++) {
      const axis = rng.chance(0.5) ? 'v' : 'h';
      const list = axis === 'v' ? roadsV : roadsH;
      if (!list.length) return;
      const coord = rng.pick(list);
      const side = rng.chance(0.5) ? 1 : -1;
      const perp = side * (ROAD_W / 2 - 14); // near the kerb
      const along = rng.range(120, (axis === 'v' ? WORLD.height : WORLD.width) - 120);
      // mostly parallel to the road, sometimes nose-in
      const parallel = rng.chance(0.8);
      const ang = roadAngle(axis, rng.chance(0.5) ? 1 : -1) + (parallel ? 0 : Math.PI / 2);
      const x = axis === 'v' ? coord + perp : along;
      const y = axis === 'v' ? along : coord + perp;
      if (city.isWater(x, y)) continue;
      const type = rng.pick(['sedan', 'hatch', 'sedan', 'truck', 'sports']);
      const car = createCar(type, x, y, ang, trafficColor(type, rng));
      car.driver = null; car.parked = true;
      parked.push(car); return;
    }
  }

  // scatter an initial batch of parked cars
  const parkedTarget = Math.max(8, Math.floor(count / 3));
  for (let i = 0; i < parkedTarget * 3 && parked.length < parkedTarget; i++) {
    spawnParkedCar();
  }

  /** Next intersection coordinate ahead along the car's road, or null. */
  function nextCrossing(car) {
    const list = car.roadAxis === 'v' ? roadsH : roadsV;
    const p = car.roadProgress, dir = car.roadDir;
    let best = null;
    for (const c of list) {
      if (dir > 0 ? c > p + 20 : c < p - 20) {
        if (best === null || (dir > 0 ? c < best : c > best)) best = c;
      }
    }
    return best;
  }

  /** Maybe turn at an intersection; mutates car.road* fields. */
  function maybeTurn(car) {
    const cross = nextCrossing(car);
    if (cross === null || Math.abs(cross - car.roadProgress) > 46) return;
    if (!rng.chance(0.38)) return; // at the junction: sometimes turn
    const tx = car.roadAxis === 'v' ? car.x : cross;
    const ty = car.roadAxis === 'v' ? cross : car.y;
    if (city.isWater(tx, ty)) return; // don't turn into water
    car.roadAxis = car.roadAxis === 'v' ? 'h' : 'v';
    car.roadCoord = cross;
    car.roadDir = rng.chance(0.5) ? 1 : -1;
    car.angle = roadAngle(car.roadAxis, car.roadDir);
  }

  function trafficControl(car, dt, focusCar) {
    maybeTurn(car);

    // lane keeping: steer toward the lane centreline
    const lp = lanePoint(car);
    const base = roadAngle(car.roadAxis, car.roadDir);
    const err = clamp(-lp.lat * 0.045, -0.55, 0.55);
    let desired = base + err;
    // wrap desired near current heading
    let diff = desired - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = clamp(diff * 2.4, -1, 1);

    // car-following: slow for traffic cars and the player car ahead in our lane
    let throttle = 1;
    const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
    const rx = -fy, ry = fx;
    const halfLen = typeOf(car).length * 0.5;
    const check = (o) => {
      if (!o || o === car || o.parked) return;
      const dx = o.x - car.x, dy = o.y - car.y;
      const along = dx * fx + dy * fy, lat = Math.abs(dx * rx + dy * ry);
      if (along <= 0 || along > 150 || lat > 30) return;
      const gap = along - halfLen - typeOf(o).length * 0.5;
      if (gap < 150) throttle = Math.min(throttle, clamp((gap - 46) / 90, 0, 1));
      if (gap < 30) throttle = 0;
    };
    for (const o of cars) check(o);
    if (focusCar) check(focusCar);

    // don't exceed cruising speed
    if (car.speed > car.cruise + 15) throttle = -0.5;

    return { throttle, steer, handbrake: false };
  }

  return {
    cars,
    parked,
    update(dt, cityArg, focus, focusCar) {
      const c = cityArg || city;
      // despawn far cars
      const R2 = 1700 * 1700;
      for (let i = cars.length - 1; i >= 0; i--) {
        if (dist2(cars[i].x, cars[i].y, focus.x, focus.y) > R2) cars.splice(i, 1);
      }
      // keep the population topped up
      let guard = 0;
      while (cars.length < count && guard++ < 50) {
        if (!spawnTrafficCar(focus)) break;
      }
      for (const car of cars) {
        car.roadProgress = car.roadAxis === 'v' ? car.y : car.x;
        const control = trafficControl(car, dt, focusCar);
        stepCar(car, dt, control, c);
        // gentle unstick: if completely stalled with throttle, nudge angle toward road
        if (Math.abs(car.speed) < 8 && control.throttle > 0.5) {
          const base = roadAngle(car.roadAxis, car.roadDir);
          car.angle = angleLerp(car.angle, base, 0.08);
        }
      }
    },
  };
}

export { createTraffic };
