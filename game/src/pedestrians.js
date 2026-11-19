// Sidewalk pedestrians: ambient strollers, panic fleeing, knockdowns.
// Deterministic: all randomness flows through the seeded rng passed in.

import { WORLD, ROAD_W } from './config.js';
import { clamp, dist2, angleLerp } from './random.js';

const SIDE_OFFSET = ROAD_W / 2 + 12; // sidewalk band centreline
const SPAWN_DIST = 1300;
const DESPAWN_DIST = 1500;
const FLEE_SPEED = 230;
const DOWN_TIME = 6;

const SHIRTS = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#9b5de5', '#f9c74f', '#f8961e', '#90be6d', '#f72585', '#00bbf9'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];

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

export function createPeds(city, rng, count = 24) {
  const list = [];

  function pickRoadNear(focus) {
    // Choose a horizontal or vertical road centreline near the focus.
    if (rng.chance(0.5)) {
      const ry = city.roadsY[rng.int(0, city.roadsY.length - 1)];
      return { axis: 'h', line: ry };
    }
    const rx = city.roadsX[rng.int(0, city.roadsX.length - 1)];
    return { axis: 'v', line: rx };
  }

  function trySpawn(focus) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const road = pickRoadNear(focus);
      const along = road.axis === 'h'
        ? clamp(focus.x + rng.range(-520, 520), 30, WORLD.width - 40)
        : clamp(focus.y + rng.range(-520, 520), 30, WORLD.height - 40);
      const side = rng.chance(0.5) ? 1 : -1;
      const off = side * (SIDE_OFFSET + rng.range(0, 8));
      const x = road.axis === 'h' ? along : road.line + off;
      const y = road.axis === 'h' ? road.line + off : along;
      if (x < 20 || y < 20 || x > WORLD.width - 20 || y > WORLD.height - 20) continue;
      if (city.isWater(x, y) || city.collide(x, y, 10)) continue;
      const dir = rng.chance(0.5) ? 1 : -1;
      const ped = {
        x, y,
        angle: road.axis === 'h' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2),
        speed: rng.range(55, 95),
        color: rng.pick(SHIRTS),
        skin: rng.pick(SKINS),
        state: 'walk',
        targetX: x, targetY: y,
        panic: 0,
        downTimer: 0,
        fleeX: 0, fleeY: 0,
        axis: road.axis,
        dir,
        phase: rng.range(0, Math.PI * 2),
      };
      pickTarget(ped, true);
      list.push(ped);
      return ped;
    }
    return null;
  }

  // Choose the next waypoint along the sidewalk. Occasionally turn at an
  // intersection onto the crossing road's sidewalk.
  function pickTarget(ped, first = false) {
    const axis = ped.axis;
    const reach = rng.range(90, 220);
    let tx = ped.x, ty = ped.y;

    if (axis === 'h') {
      tx = clamp(ped.x + ped.dir * reach, 20, WORLD.width - 20);
      // near a vertical road crossing? maybe turn onto it
      const lines = city.roadsX;
      for (const rx of lines) {
        const between = (rx - ped.x) * ped.dir;
        if (between > 4 && between < reach) {
          if (rng.chance(first ? 0.5 : 0.3)) {
            const side = rng.chance(0.5) ? 1 : -1;
            ped.x = rx + side * SIDE_OFFSET;
            ped.axis = 'v';
            ped.dir = rng.chance(0.5) ? 1 : -1;
            ped.targetX = ped.x;
            ped.targetY = clamp(ped.y + ped.dir * reach, 20, WORLD.height - 20);
            ped.angle = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
            return;
          }
        }
      }
    } else {
      ty = clamp(ped.y + ped.dir * reach, 20, WORLD.height - 20);
      for (const ry of city.roadsY) {
        const between = (ry - ped.y) * ped.dir;
        if (between > 4 && between < reach) {
          if (rng.chance(first ? 0.5 : 0.3)) {
            const side = rng.chance(0.5) ? 1 : -1;
            ped.y = ry + side * SIDE_OFFSET;
            ped.axis = 'h';
            ped.dir = rng.chance(0.5) ? 1 : -1;
            ped.targetX = clamp(ped.x + ped.dir * reach, 20, WORLD.width - 20);
            ped.targetY = ped.y;
            ped.angle = ped.dir > 0 ? 0 : Math.PI;
            return;
          }
        }
      }
    }

    // blocked ahead? reverse direction
    if (city.collide(tx, ty, 10) || tx >= WORLD.width - 15 || ty >= WORLD.height - 15) {
      ped.dir *= -1;
      tx = ped.x + (axis === 'h' ? ped.dir * reach : 0);
      ty = ped.y + (axis === 'v' ? ped.dir * reach : 0);
      tx = clamp(tx, 20, WORLD.width - 20);
      ty = clamp(ty, 20, WORLD.height - 20);
      ped.angle = axis === 'h' ? (ped.dir > 0 ? 0 : Math.PI) : (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    ped.targetX = tx;
    ped.targetY = ty;
  }

  // Axis-aligned slide move with building/water collision.
  function moveWithSlide(ped, mx, my, dt) {
    const step = 10;
    let moved = false;
    // sub-step so fast flees don't tunnel through thin walls
    const dist = Math.hypot(mx, my);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i < n; i++) {
      const sx = mx / n, sy = my / n;
      if (!city.collide(ped.x + sx, ped.y, 10)) { ped.x += sx; moved = true; }
      if (!city.collide(ped.x, ped.y + sy, 10)) { ped.y += sy; moved = true; }
    }
    return moved;
  }

  function panicAway(ped, danger) {
    const dx = ped.x - danger.x;
    const dy = ped.y - danger.y;
    const d = Math.hypot(dx, dy) || 1;
    ped.fleeX = dx / d;
    ped.fleeY = dy / d;
    ped.state = 'flee';
    ped.panic = rng.range(1.5, 3);
  }

  function update(dt, world) {
    const focus = world && world.focus ? world.focus : { x: WORLD.width / 2, y: WORLD.height / 2 };
    const danger = world && world.danger ? world.danger : null;
    const c = (world && world.city) || city;

    for (let i = list.length - 1; i >= 0; i--) {
      const ped = list[i];

      if (dist2(ped.x, ped.y, focus.x, focus.y) > DESPAWN_DIST * DESPAWN_DIST) {
        list.splice(i, 1);
        continue;
      }

      if (ped.state === 'down') {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) {
          ped.state = 'flee';
          ped.panic = rng.range(1.5, 2.5);
          ped.fleeX = ped.dir >= 0 ? 1 : -1;
          ped.fleeY = 0;
          if (ped.axis === 'v') { ped.fleeX = 0; ped.fleeY = ped.dir >= 0 ? 1 : -1; }
        }
        continue;
      }

      // panic check
      if (danger && ped.state !== 'flee' &&
          dist2(ped.x, ped.y, danger.x, danger.y) < danger.r * danger.r) {
        panicAway(ped, danger);
      }

      if (ped.state === 'flee') {
        ped.panic -= dt;
        const sp = FLEE_SPEED * dt;
        moveWithSlide(ped, ped.fleeX * sp, ped.fleeY * sp, dt);
        const want = Math.atan2(ped.fleeY, ped.fleeX);
        ped.angle = angleLerp(ped.angle, want, 0.2);
        if (ped.panic <= 0) ped.state = 'walk';
        continue;
      }

      // walk toward target
      const dx = ped.targetX - ped.x;
      const dy = ped.targetY - ped.y;
      const d = Math.hypot(dx, dy);
      if (d < Math.max(4, ped.speed * dt)) {
        pickTarget(ped);
      } else {
        const sp = ped.speed * dt;
        const mx = (dx / d) * sp;
        const my = (dy / d) * sp;
        const beforeX = ped.x, beforeY = ped.y;
        moveWithSlide(ped, mx, my, dt);
        const moved = Math.hypot(ped.x - beforeX, ped.y - beforeY);
        if (moved > 0.01) {
          ped.angle = angleLerp(ped.angle, Math.atan2(ped.y - beforeY, ped.x - beforeX), 0.25);
        } else {
          pickTarget(ped); // fully blocked, pick a new route
        }
      }
    }

    // keep population topped up near the focus
    let guard = 0;
    while (list.length < count && guard++ < count * 4) {
      if (!trySpawn(focus)) break;
    }
  }

  function knockDown(ped) {
    if (ped && ped.state !== 'down') {
      ped.state = 'down';
      ped.downTimer = DOWN_TIME;
      ped.panic = 0;
    }
  }

  function draw(ctx, t) {
    for (const ped of list) {
      const down = ped.state === 'down';
      const phase = t * 9 + ped.phase;
      const bob = down ? 0 : Math.sin(phase) * 1.6;
      const swing = down ? 0 : Math.sin(phase) * 5;

      // shadow
      ctx.fillStyle = 'rgba(30,10,40,0.28)';
      ctx.beginPath();
      ctx.ellipse(ped.x + 2, ped.y + 4, 15, 6, down ? ped.angle : 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(ped.x, ped.y + bob);
      ctx.rotate(ped.angle);

      if (down) {
        // knockdown pose: flattened body + head, same footprint as the player
        ctx.fillStyle = shadeOf(ped.color, 0.55);
        ctx.beginPath();
        ctx.ellipse(1, 0, 16, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ped.skin;
        ctx.beginPath();
        ctx.arc(14, 0, 6.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // legs (two dark rects stepping with the walk cycle)
        ctx.fillStyle = '#2c2f3a';
        roundRect(ctx, -9, -7 - swing * 0.4, 9, 4, 1.5);
        roundRect(ctx, -9, 3 + swing * 0.4, 9, 4, 1.5);
        ctx.fill();

        // body: rounded torso ~17 wide x 21 long in the ped's shirt colour
        ctx.fillStyle = ped.color;
        roundRect(ctx, -10.5, -8.5, 21, 17, 6);
        ctx.fill();
        ctx.strokeStyle = shadeOf(ped.color, 0.6);
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // head (skin tone) with a per-ped hair arc
        ctx.fillStyle = ped.skin;
        ctx.beginPath();
        ctx.arc(12, 0, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shadeOf(ped.color, 0.45);
        ctx.beginPath();
        ctx.arc(12, 0, 5.8, -Math.PI * 0.55, Math.PI * 0.55);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function shadeOf(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
    const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
    const b = clamp(Math.round((n & 255) * f), 0, 255);
    return `rgb(${r},${g},${b})`;
  }

  return { list, update, draw, knockDown };
}
