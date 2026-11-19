// Hitscan shooting: tracers, impact sparks, target resolution and damage.
// Ammo and fire rate are the caller's job — fire() just resolves one shot.

import { dist2 } from './random.js';

const RANGE = 560;
const STEP = 8;
const SPREAD = 0.035;
const TRACER_LIFE = 0.07;
const PED_RADIUS = 12;
const CAR_RADIUS = 30;
const PLAYER_RADIUS = 13;
const PLAYER_CAR_RADIUS = 30;

export function createCombat() {
  const tracers = [];
  const sparks = [];

  // deterministic PRNG (no Math.random allowed); fixed seed is fine here
  let seed = 0x9e3779b9;
  function rand() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function addSparks(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const sp = 40 + rand() * 160;
      sparks.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.18 + rand() * 0.22,
      });
    }
  }

  function fire(shooter, world) {
    const angle = shooter.angle + (rand() * 2 - 1) * SPREAD;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const sx = shooter.x + dx * 16;
    const sy = shooter.y + dy * 16;

    let hitX = sx + dx * RANGE;
    let hitY = sy + dy * RANGE;
    let hitType = null;
    let hitObj = null;

    const maxSteps = Math.ceil(RANGE / STEP);
    for (let i = 1; i <= maxSteps; i++) {
      const px = sx + dx * i * STEP;
      const py = sy + dy * i * STEP;

      // walls / water block the shot
      if (world.city.collide(px, py, 2)) {
        hitX = px - dx * STEP;
        hitY = py - dy * STEP;
        hitType = 'wall';
        break;
      }

      if (shooter.side === 'police') {
        const t = resolvePlayerTarget(world);
        if (t) {
          const r = t.radius;
          if (dist2(px, py, t.x, t.y) < r * r) {
            hitX = px; hitY = py; hitType = 'player'; hitObj = t;
            break;
          }
        }
      } else {
        const ped = firstPedHit(world, px, py);
        if (ped) { hitX = px; hitY = py; hitType = 'ped'; hitObj = ped; break; }
        const pc = firstCarHit(world.policeCars, px, py);
        if (pc) { hitX = px; hitY = py; hitType = 'police'; hitObj = pc; break; }
        const tc = firstCarHit(world.cars, px, py);
        if (tc) { hitX = px; hitY = py; hitType = 'car'; hitObj = tc; break; }
      }
    }

    tracers.push({ x1: sx, y1: sy, x2: hitX, y2: hitY, life: TRACER_LIFE });
    addSparks(hitX, hitY, hitType === 'wall' ? 3 : 6);
    addSparks(sx, sy, 2); // muzzle flash

    // apply damage
    if (hitType === 'ped' && hitObj) {
      if (world.peds && world.peds.knockDown) world.peds.knockDown(hitObj);
    } else if (hitType === 'car' && hitObj) {
      hitObj.health -= 18;
    } else if (hitType === 'police' && hitObj) {
      hitObj.health -= 14;
    } else if (hitType === 'player' && world.player) {
      world.player.health -= 7;
    }

    return { type: 'shot', hitType, x: hitX, y: hitY };
  }

  function firstPedHit(world, px, py) {
    const peds = world.peds && world.peds.list;
    if (!peds) return null;
    for (const ped of peds) {
      if (ped.state === 'down') continue;
      if (dist2(px, py, ped.x, ped.y) < PED_RADIUS * PED_RADIUS) return ped;
    }
    return null;
  }

  function firstCarHit(cars, px, py) {
    if (!cars) return null;
    for (const car of cars) {
      if (car && dist2(px, py, car.x, car.y) < CAR_RADIUS * CAR_RADIUS) return car;
    }
    return null;
  }

  function resolvePlayerTarget(world) {
    const p = world.player;
    if (!p) return null;
    // driving? hit their car instead of the on-foot body
    const car = p.car || world.playerCar;
    if (car && car.x !== undefined) {
      return { x: car.x, y: car.y, radius: PLAYER_CAR_RADIUS };
    }
    if (p.x === undefined) return null;
    return { x: p.x, y: p.y, radius: PLAYER_RADIUS };
  }

  function update(dt, world) {
    for (let i = tracers.length - 1; i >= 0; i--) {
      tracers[i].life -= dt;
      if (tracers[i].life <= 0) tracers.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.92;
      s.vy *= 0.92;
      s.life -= dt;
      if (s.life <= 0) sparks.splice(i, 1);
    }
  }

  function draw(ctx) {
    for (const tr of tracers) {
      const a = Math.max(0, tr.life / TRACER_LIFE);
      ctx.strokeStyle = `rgba(255,240,170,${0.85 * a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tr.x1, tr.y1);
      ctx.lineTo(tr.x2, tr.y2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,170,60,0.9)';
    for (const s of sparks) {
      const a = Math.max(0, s.life / 0.4);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  return { tracers, sparks, update, fire, draw };
}
