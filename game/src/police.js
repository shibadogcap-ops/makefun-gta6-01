// Wanted system and police response: heat/stars, spawning pursuers, pursuit AI,
// bust progress and shooting windows. main.js performs the actual shots.

import { TUNE, WORLD } from './config.js';
import { clamp } from './random.js';
import { createCar, stepCar, drawCar } from './vehicles.js';

const CRIME_HEAT = {
  shot: 60,
  pedHit: 90,
  hitAndRun: 120,
  carHit: 35,
  steal: 80,
  mission: 50,
  crash: 25,
};

const TAU = Math.PI * 2;

/** Wrap an angle difference to [-PI, PI]. */
function wrapAngle(d) {
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function starsFor(heat) {
  return heat <= 0 ? 0 : Math.min(5, 1 + Math.floor(heat / 110));
}

export function createPolice(city, rng) {
  const police = {
    wanted: 0,
    heat: 0,
    unseenTimer: 0,
    cars: [],
    busted: 0,
    shotsDue: false,
    shooterCar: null,
    lastSeenPos: { x: 0, y: 0 },
    // internal
    _shootCooldown: 0,
    _patrolPhase: 0,
  };

  function playerPos(world) {
    const p = world.player;
    return { x: p.x, y: p.y };
  }

  function playerSpeed(world) {
    const p = world.player;
    if (p.car) return Math.abs(p.car.speed || 0);
    return p.speedNow || 0;
  }

  function minCarDist(world) {
    const p = world.player;
    let best = Infinity;
    for (const c of police.cars) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < best) best = d;
    }
    return best;
  }

  /** Register a crime; seen=true means a witness/police saw it happen. */
  police.reportCrime = function (kind, x, y, seen) {
    police.heat = Math.min(500, police.heat + (CRIME_HEAT[kind] || 0));
    if (seen) {
      police.lastSeenPos = { x, y };
      police.unseenTimer = 0;
    }
    police.wanted = starsFor(police.heat);
  };

  function trySpawn(world) {
    const p = world.player;
    for (let attempt = 0; attempt < 40; attempt++) {
      const ang = rng.range(0, TAU);
      const d = rng.range(700, 900);
      const px = p.x + Math.cos(ang) * d;
      const py = p.y + Math.sin(ang) * d;
      if (px < 60 || py < 60 || px > WORLD.width - 60 || py > WORLD.height - 60) continue;
      const np = city.nearestRoadPoint(px, py);
      if (city.isWater(np.x, np.y)) continue;
      const face = Math.atan2(p.y - np.y, p.x - np.x);
      const car = createCar('police', np.x, np.y, face);
      car.driver = 'police';
      car.lightsOn = true;
      car.pStuck = 0;
      car.pReverse = 0;
      car.pPatrolA = rng.range(0, TAU);
      police.cars.push(car);
      return;
    }
  }

  /** Steering + throttle for one cop chasing (or patrolling) a point. */
  function pursuitControl(car, tx, ty, world, dt) {
    const dx = tx - car.x;
    const dy = ty - car.y;
    const dist = Math.hypot(dx, dy) || 1;
    const desired = Math.atan2(dy, dx);
    const diff = wrapAngle(desired - car.angle);
    const steer = clamp(diff / 0.6, -1, 1);

    const p = world.player;
    const driving = !!p.car;
    const onFootNear = !driving && dist < 130;

    let throttle = 1;
    if (Math.abs(diff) > 1.1) throttle = 0.35; // turn before charging
    if (dist < 110) throttle = 0.35; // ease off to avoid ramming circles
    if (onFootNear) throttle = p.speedNow > 5 ? -0.5 : 0; // stop and bust

    // unstick: if stalled with throttle, reverse briefly
    if (car.pReverse > 0) {
      car.pReverse -= dt;
      return { throttle: -0.9, steer: clamp(diff / 1.2, -1, 1), handbrake: false };
    }
    if (throttle > 0.4 && Math.abs(car.speed) < 12) {
      car.pStuck += dt;
      if (car.pStuck > 1.2) {
        car.pReverse = 0.6;
        car.pStuck = 0;
      }
    } else {
      car.pStuck = 0;
    }

    return { throttle, steer, handbrake: false };
  }

  police.update = function (dt, world) {
    const p = world.player;
    police.shotsDue = false;
    police.shooterCar = null;
    if (police._shootCooldown > 0) police._shootCooldown -= dt;

    // --- contact / unseen tracking ---
    const contact = minCarDist(world) < 620;
    if (contact) police.unseenTimer = 0;
    else police.unseenTimer += dt;
    if (police.unseenTimer > 6 && police.heat > 0) {
      police.heat = Math.max(0, police.heat - 26 * dt);
      police.wanted = starsFor(police.heat);
    }

    // --- despawn far cars (further if heat is high) ---
    const maxDist = police.wanted >= 4 ? 2400 : 1900;
    const maxD2 = maxDist * maxDist;
    for (let i = police.cars.length - 1; i >= 0; i--) {
      const c = police.cars[i];
      if ((c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y) > maxD2) {
        police.cars.splice(i, 1);
      }
    }

    // --- spawn toward target strength ---
    const targetCount = TUNE.policeByStars[police.wanted] || 0;
    let spawnGuard = 0;
    while (police.cars.length < targetCount && spawnGuard++ < 3) {
      trySpawn(world);
    }

    // --- pursuit AI ---
    const lost = police.unseenTimer > 4;
    for (const car of police.cars) {
      let tx, ty;
      if (lost && police.lastSeenPos) {
        // slow patrol around the last seen position
        police._patrolPhase += dt * 0.9;
        tx = police.lastSeenPos.x + Math.cos(police._patrolPhase + car.pPatrolA) * 120;
        ty = police.lastSeenPos.y + Math.sin(police._patrolPhase + car.pPatrolA) * 120;
      } else {
        tx = p.x;
        ty = p.y;
      }
      const control = pursuitControl(car, tx, ty, world, dt);
      stepCar(car, dt, control, world.city || city);
    }

    // --- busted progress ---
    const near = minCarDist(world);
    const pSpeed = playerSpeed(world);
    if (near < 95 && pSpeed < 45) {
      police.busted = Math.min(1, police.busted + dt / 2.6);
    } else {
      police.busted = Math.max(0, police.busted - dt / 1.2);
    }

    // --- shooting window ---
    if (police.wanted >= 3 && police._shootCooldown <= 0) {
      const driving = !!p.car;
      const slowCar = driving && Math.abs(p.car.speed || 0) < 150;
      if (!driving || slowCar) {
        let best = null;
        let bestD = 300 * 300;
        for (const c of police.cars) {
          const d2 = (c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y);
          if (d2 < bestD) {
            bestD = d2;
            best = c;
          }
        }
        if (best) {
          police.shotsDue = true;
          police.shooterCar = best;
          police._shootCooldown = 0.9;
        }
      }
    }
  };

  police.draw = function (ctx, t) {
    for (const car of police.cars) {
      drawCar(ctx, car, t);
    }
  };

  return police;
}
