// The player: on-foot movement, entering/exiting cars, driving, health hooks.

import { TUNE } from './config.js';
import { angleLerp } from './random.js';
import { ACTION_INTERACT } from './input.js';
import { stepCar, CAR_TYPES } from './vehicles.js';

const HARD_CRASH_DAMAGE = 6;

function carWidth(car) {
  return (CAR_TYPES[car.type] || CAR_TYPES.sedan).width;
}

/** Nearest enterable car within range, or null. */
function nearestCar(player, cars) {
  const r2 = TUNE.interactRange * TUNE.interactRange;
  let best = null;
  let bestD = r2;
  for (const car of cars) {
    if (!car || car.driver === 'player') continue;
    const dx = car.x - player.x;
    const dy = car.y - player.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = car;
    }
  }
  return best;
}

function tryMove(city, x, y, r) {
  return !city.collide(x, y, r);
}

function updateFoot(player, dt, input, city) {
  const axis = input.axis();
  const speed = input.sprint() ? TUNE.runSpeed : TUNE.walkSpeed;
  let vx = axis.x * speed;
  let vy = axis.y * speed;
  const mag = Math.hypot(vx, vy);
  player.speedNow = mag;

  if (mag > 1) {
    player.angle = angleLerp(player.angle, Math.atan2(vy, vx), 1 - Math.exp(-14 * dt));
    player.walkPhase += mag * dt * 0.055;
  } else {
    player.walkPhase *= Math.exp(-8 * dt);
  }

  const r = TUNE.playerRadius;
  const nx = player.x + vx * dt;
  const ny = player.y + vy * dt;
  if (tryMove(city, nx, ny, r)) {
    player.x = nx; player.y = ny;
  } else if (tryMove(city, player.x + vx * dt, player.y, r)) {
    player.x += vx * dt;
  } else if (tryMove(city, player.x, player.y + vy * dt, r)) {
    player.y += vy * dt;
  }
}

/** Candidate exit spots around the car, in preference order. */
function exitSpots(car) {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const lx = -fy; // left of heading
  const ly = fx;
  const off = carWidth(car) * 0.5 + TUNE.playerRadius + 4;
  const spots = [
    { x: car.x + lx * off, y: car.y + ly * off },
    { x: car.x - lx * off, y: car.y - ly * off },
    { x: car.x + fx * off * 1.6, y: car.y + fy * off * 1.6 },
    { x: car.x - fx * off * 1.6, y: car.y - fy * off * 1.6 },
    { x: car.x, y: car.y },
  ];
  return spots;
}

function updateCar(player, dt, input, city, actions) {
  const car = player.car;
  if (!car) {
    // car vanished; fall back to foot mode
    player.mode = 'foot';
    player.speedNow = 0;
    return { crash: null };
  }

  const throttle =
    (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) +
    (input.down('KeyS') || input.down('ArrowDown') ? -1 : 0);
  const steer =
    (input.down('KeyA') || input.down('ArrowLeft') ? -1 : 0) +
    (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0);
  const handbrake = input.down('Space');

  const { hit } = stepCar(car, dt, { throttle, steer, handbrake }, city);
  player.x = car.x;
  player.y = car.y;
  player.angle = car.angle;
  player.speedNow = Math.abs(car.speed);
  player.walkPhase = 0;

  let crash = null;
  if (hit) {
    crash = hit;
    if (hit.hard) player.health = Math.max(0, player.health - HARD_CRASH_DAMAGE);
  }

  if (actions & ACTION_INTERACT) {
    const r = TUNE.playerRadius;
    let placed = null;
    for (const s of exitSpots(car)) {
      if (tryMove(city, s.x, s.y, r)) {
        placed = s;
        break;
      }
    }
    if (!placed) placed = exitSpots(car)[0];
    player.x = placed.x;
    player.y = placed.y;
    car.driver = null;
    player.car = null;
    player.mode = 'foot';
    player.speedNow = 0;
    return { crash, exited: true };
  }

  return { crash };
}

export function createPlayer(city) {
  return {
    x: city.spawn.x,
    y: city.spawn.y,
    angle: 0,
    speedNow: 0,
    health: 100,
    maxHealth: 100,
    mode: 'foot',
    car: null,
    walkPhase: 0,
    dead: false,
  };
}

export function updatePlayer(player, dt, input, world, actions = 0) {
  const events = { entered: null, exited: false, crash: null };
  const city = world.city;

  if (player.mode === 'car') {
    const r = updateCar(player, dt, input, city, actions);
    events.crash = r.crash;
    if (r.exited) events.exited = true;
    return events;
  }

  updateFoot(player, dt, input, city);

  if (actions & ACTION_INTERACT) {
    const car = nearestCar(player, world.cars);
    if (car) {
      car.driver = 'player';
      player.car = car;
      player.mode = 'car';
      player.x = car.x;
      player.y = car.y;
      player.angle = car.angle;
      player.speedNow = Math.abs(car.speed);
      events.entered = car;
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

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

export function drawPlayer(ctx, player, t) {
  if (player.mode !== 'foot' || player.dead) return;

  const moving = player.speedNow > 4;
  const bob = moving ? Math.sin(player.walkPhase * 2) * 1.6 : Math.sin(t * 2 + player.x * 0.01) * 0.5;
  const legSwing = moving ? Math.sin(player.walkPhase) * 3.2 : 0;

  ctx.save();
  ctx.translate(player.x, player.y + bob * 0.4);

  // soft shadow
  ctx.fillStyle = 'rgba(24,18,32,0.30)';
  ctx.beginPath();
  ctx.ellipse(0, 3, 11, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.rotate(player.angle);

  // legs (two small dark rects, offset by walk phase)
  ctx.fillStyle = '#2c2f3a';
  roundRect(ctx, -7, -8 - legSwing * 0.4, 7, 5, 2); // left leg
  roundRect(ctx, -7, 3 + legSwing * 0.4, 7, 5, 2);  // right leg
  ctx.fill();

  // body: teal shirt
  ctx.fillStyle = '#2a9d8f';
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,40,38,0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // arms when aiming: line toward aimAngle with a small pistol dot
  if (player.aiming && player.aimAngle !== undefined) {
    const aim = player.aimAngle - player.angle; // local angle
    const ax = Math.cos(aim);
    const ay = Math.sin(aim);
    ctx.strokeStyle = '#e76f51';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax * 4, ay * 4);
    ctx.lineTo(ax * 13, ay * 13);
    ctx.stroke();
    ctx.fillStyle = '#33334a';
    ctx.beginPath();
    ctx.arc(ax * 15, ay * 15, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // head (skin tone)
  ctx.fillStyle = '#f2c89b';
  ctx.beginPath();
  ctx.arc(6, 0, 6, 0, Math.PI * 2);
  ctx.fill();

  // coral cap facing forward
  ctx.fillStyle = '#ff6b6b';
  ctx.beginPath();
  ctx.arc(6, 0, 5.4, -Math.PI * 0.55, Math.PI * 0.55);
  ctx.fill();
  // brim
  ctx.fillRect(9.5, -1.4, 4.5, 2.8);

  // subtle direction tick ahead of the body
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(17, 0);
  ctx.stroke();

  ctx.restore();
}
