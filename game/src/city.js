// Palm Bay Heat — city generation, ground/building rendering, collision queries.
// Everything is deterministic: layout comes from the seeded rng, drawing uses
// only the camera and the time parameter (no Math.random / Date.now).

import { WORLD, VIEW, ROAD_W, PALETTE } from './config.js';
import { clamp } from './random.js';

const HALF_ROAD = ROAD_W / 2;
const SIDEWALK = 14; // sidewalk band beyond the asphalt
const WATER_X = 4360;
const SAND_X = 4180;
const DT_X = 2100;
const DT_Y = 1500;

const WALL_COLORS = [
  '#f6d8c4', '#f2e3c9', '#dcead3', '#e8d5e8',
  '#f9e7b8', '#d5e6ef', '#f4cfcf', '#e6e0f4',
];

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inView(x, y, w, h, cam, pad = 80) {
  return x + w > cam.x - pad && x < cam.x + VIEW.width + pad &&
         y + h > cam.y - pad && y < cam.y + VIEW.height + pad;
}

function shade(hex, f) {
  let r, g, b;
  if (hex.startsWith('rgb')) {
    [r, g, b] = hex.match(/\d+/g).map(Number);
  } else {
    const n = parseInt(hex.slice(1), 16);
    r = (n >> 16) & 255;
    g = (n >> 8) & 255;
    b = n & 255;
  }
  r = clamp(Math.round(r * f), 0, 255);
  g = clamp(Math.round(g * f), 0, 255);
  b = clamp(Math.round(b * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

export function createCity(rng) {
  const roadsX = [];
  const roadsY = [];
  for (let i = 0; i <= 10; i++) roadsX.push(200 + 400 * i);
  for (let j = 0; j <= 7; j++) roadsY.push(200 + 400 * j);

  // ---- landmark plan: block key "bx,by" -> {kind, label} ----
  const padPlan = new Map([
    ['0,0', { kind: 'pad', label: "SAFEHOUSE" }],
    ['0,4', { kind: 'pad', label: "RAY'S CHOP SHOP" }],
    ['5,2', { kind: 'pad', label: "MARLA'S DINER" }],
    ['4,3', { kind: 'pad', label: 'PALM BAY BANK' }],
    ['9,5', { kind: 'pad', label: 'MARINA' }],
    ['3,3', { kind: 'lot', label: 'PARKING' }],
    ['9,6', { kind: 'lot', label: 'BEACH PARTY' }],
  ]);

  const buildings = [];
  const parks = [];
  const lots = [];
  const pads = [];
  const palms = [];
  const landmarks = {};
  const sparkles = [];

  const blockRects = [];

  for (let bx = 0; bx < roadsX.length - 1; bx++) {
    for (let by = 0; by < roadsY.length - 1; by++) {
      const x0 = roadsX[bx] + HALF_ROAD + SIDEWALK;
      const x1 = roadsX[bx + 1] - HALF_ROAD - SIDEWALK;
      const y0 = roadsY[by] + HALF_ROAD + SIDEWALK;
      const y1 = roadsY[by + 1] - HALF_ROAD - SIDEWALK;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const interior = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      blockRects.push({ bx, by, interior, cx, cy });

      const plan = padPlan.get(`${bx},${by}`);
      const downtown = Math.hypot(cx - DT_X, cy - DT_Y) < 900;
      const beach = cx > 3600;

      // landmark pad rect, centered in the block interior
      let padRect = null;
      if (plan) {
        const pw = Math.min(196, interior.w - 24);
        const ph = Math.min(150, interior.h - 24);
        padRect = {
          x: cx - pw / 2, y: cy - ph / 2, w: pw, h: ph,
          kind: plan.kind, label: plan.label,
        };
        pads.push(padRect);
        landmarks[plan.label === 'MARINA' ? 'marina'
          : plan.label === "MARLA'S DINER" ? 'diner'
          : plan.label === 'PALM BAY BANK' ? 'bank'
          : plan.label === 'RAY\'S CHOP SHOP' ? 'chopShop'
          : plan.label === 'SAFEHOUSE' ? 'hideout'
          : plan.label === 'PARKING' ? 'parking' : 'rampage'] = {
          x: padRect.x + padRect.w / 2,
          y: padRect.y + padRect.h / 2,
          label: plan.label,
        };
      }

      const avoid = padRect ? { x: padRect.x - 8, y: padRect.y - 8, w: padRect.w + 16, h: padRect.h + 16 } : null;

      if (plan && plan.kind === 'lot') {
        // whole block is an open drivable lot
        lots.push({ ...interior, label: plan.label });
      } else if (!plan && rng.chance(0.16)) {
        parks.push({
          ...interior,
          pathX: cx, pathY: cy,
        });
        const n = rng.int(3, 6);
        for (let i = 0; i < n; i++) {
          palms.push({
            x: rng.range(x0 + 18, x1 - 18),
            y: rng.range(y0 + 18, y1 - 18),
            s: rng.range(0.8, 1.3),
          });
        }
      } else if (!plan && rng.chance(0.10)) {
        lots.push({ ...interior, label: null });
      } else {
        // buildings: 1-4 (fewer when a pad takes space)
        const n = plan ? rng.int(1, 2) : rng.int(1, 4);
        const vertical = rng.chance(0.5);
        const gap = 10;
        const blockStart = buildings.length;
        for (let i = 0; i < n; i++) {
          let bx0, by0, bx1, by1;
          if (n === 1) {
            bx0 = x0 + gap; by0 = y0 + gap; bx1 = x1 - gap; by1 = y1 - gap;
          } else if (vertical) {
            const t0 = i / n, t1 = (i + 1) / n;
            const sx0 = x0 + (x1 - x0) * t0 + gap / 2;
            const sx1 = x0 + (x1 - x0) * t1 - gap / 2;
            bx0 = sx0 + rng.range(0, 8); bx1 = sx1 - rng.range(0, 8);
            by0 = y0 + gap + rng.range(0, 10); by1 = y1 - gap - rng.range(0, 10);
          } else {
            const t0 = i / n, t1 = (i + 1) / n;
            const sy0 = y0 + (y1 - y0) * t0 + gap / 2;
            const sy1 = y0 + (y1 - y0) * t1 - gap / 2;
            by0 = sy0 + rng.range(0, 8); by1 = sy1 - rng.range(0, 8);
            bx0 = x0 + gap + rng.range(0, 10); bx1 = x1 - gap - rng.range(0, 10);
          }
          if (bx1 - bx0 < 30 || by1 - by0 < 30) continue;
          const b = {
            x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0,
            height: downtown ? rng.range(46, 96)
              : beach ? rng.range(26, 48)
              : rng.range(10, 24),
            color: rng.pick(WALL_COLORS),
            roof: rng.pick(PALETTE.ROOF_COLORS),
          };
          if (avoid && overlap(b, avoid)) continue;
          buildings.push(b);
        }

        // a lone building covering most of the block splits in two
        if (buildings.length - blockStart === 1) {
          const b = buildings[buildings.length - 1];
          if (b.w >= interior.w * 0.6 && b.h >= interior.h * 0.6) {
            buildings.pop();
            const alongX = b.w >= b.h;
            const splitGap = 18;
            const len = (alongX ? b.w : b.h) - splitGap;
            const dims = alongX
              ? [[b.x, len / 2], [b.x + len / 2 + splitGap, len / 2]]
              : [[b.y, len / 2], [b.y + len / 2 + splitGap, len / 2]];
            dims.forEach(([o, l], k) => {
              const f = k === 0 ? 0.94 : 1.06;
              buildings.push({
                x: alongX ? o : b.x,
                y: alongX ? b.y : o,
                w: alongX ? l : b.w,
                h: alongX ? b.h : l,
                height: rng.range(6, Math.max(9, b.height * 0.7)),
                color: shade(b.color, f),
                roof: shade(b.roof, f),
              });
            });
          }
        }
      }

      // occasional sidewalk palms just outside the interior edge
      if (rng.chance(0.55)) {
        const edge = rng.int(0, 3);
        let px, py;
        if (edge === 0) { px = rng.range(x0 - SIDEWALK + 3, x0 - 1); py = rng.range(y0, y1); }
        else if (edge === 1) { px = rng.range(x1 + 1, x1 + SIDEWALK - 3); py = rng.range(y0, y1); }
        else if (edge === 2) { px = rng.range(x0, x1); py = rng.range(y0 - SIDEWALK + 3, y0 - 1); }
        else { px = rng.range(x0, x1); py = rng.range(y1 + 1, y1 + SIDEWALK - 3); }
        palms.push({ x: px, y: py, s: rng.range(0.8, 1.2) });
      }
    }
  }

  // beach palms scattered along the sand
  const nBeach = rng.int(10, 16);
  for (let i = 0; i < nBeach; i++) {
    palms.push({
      x: rng.range(SAND_X + 10, WATER_X - 12),
      y: rng.range(30, WORLD.height - 30),
      s: rng.range(0.9, 1.3),
    });
  }

  // water sparkles (deterministic positions, shimmer driven by t at draw time)
  const nSpark = rng.int(30, 46);
  for (let i = 0; i < nSpark; i++) {
    sparkles.push({
      x: rng.range(WATER_X + 12, WORLD.width - 12),
      y: rng.range(10, WORLD.height - 10),
      len: rng.range(8, 26),
      phase: rng.range(0, Math.PI * 2),
    });
  }

  // diner spawn point: on the road in front of the diner pad (south side)
  const dinerPad = pads.find(p => p.label === "MARLA'S DINER");
  let spawn = { x: DT_X, y: DT_Y };
  if (dinerPad) {
    const padBottom = dinerPad.y + dinerPad.h;
    const roadY = roadsY.find(ry => ry > padBottom) || roadsY[roadsY.length - 1];
    spawn = { x: dinerPad.x + dinerPad.w / 2, y: roadY };
  }

  // ---------------- queries ----------------

  function isOnRoad(x, y) {
    if (x < 0 || y < 0 || x > WORLD.width || y > WORLD.height || x >= WATER_X) return false;
    for (const rx of roadsX) {
      if (Math.abs(x - rx) <= HALF_ROAD) return true;
    }
    for (const ry of roadsY) {
      if (Math.abs(y - ry) <= HALF_ROAD) return true;
    }
    return false;
  }

  function isWater(x, y) {
    return x >= WATER_X;
  }

  function collide(x, y, r) {
    if (x - r < 0 || y - r < 0 || x + r > WORLD.width || y + r > WORLD.height) return true;
    if (x + r >= WATER_X) return true;
    for (const b of buildings) {
      if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
    }
    return false;
  }

  function nearestRoadPoint(x, y) {
    let nx = roadsX[0], ndx = Math.abs(x - nx);
    for (const rx of roadsX) {
      const d = Math.abs(x - rx);
      if (d < ndx) { ndx = d; nx = rx; }
    }
    let ny = roadsY[0], ndy = Math.abs(y - ny);
    for (const ry of roadsY) {
      const d = Math.abs(y - ry);
      if (d < ndy) { ndy = d; ny = ry; }
    }
    return { x: nx, y: ny };
  }

  // ---------------- drawing ----------------

  function drawGround(ctx, cam, t) {
    const vx = cam.x, vy = cam.y;
    const vw = VIEW.width, vh = VIEW.height;

    // base grass
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(vx, vy, vw, vh);

    // water (only the visible part of the ocean)
    if (vx + vw > WATER_X) {
      const wx = Math.max(vx, WATER_X);
      const g = ctx.createLinearGradient(0, vy, 0, vy + vh);
      g.addColorStop(0, PALETTE.waterDeep);
      g.addColorStop(1, PALETTE.water);
      ctx.fillStyle = g;
      ctx.fillRect(wx, vy, vx + vw - wx, vh);
      // shimmering sparkles
      ctx.strokeStyle = 'rgba(220,240,255,0.5)';
      ctx.lineWidth = 2;
      for (const s of sparkles) {
        if (!inView(s.x, s.y, s.len, 4, cam)) continue;
        const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2.2 + s.phase));
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + s.len, s.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // sand band
    if (vx + vw > SAND_X && vx < WATER_X) {
      ctx.fillStyle = PALETTE.sand;
      ctx.fillRect(Math.max(vx, SAND_X), vy, Math.min(vx + vw, WATER_X) - Math.max(vx, SAND_X), vh);
    }

    // parks, lots and landmark pads (block interiors)
    for (const p of parks) {
      if (!inView(p.x, p.y, p.w, p.h, cam)) continue;
      ctx.fillStyle = PALETTE.park;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = '#cbb98a';
      ctx.fillRect(p.pathX - 12, p.y, 24, p.h);
      ctx.fillRect(p.x, p.pathY - 12, p.w, 24);
    }
    for (const l of lots) {
      if (!inView(l.x, l.y, l.w, l.h, cam)) continue;
      ctx.fillStyle = '#55555f';
      ctx.fillRect(l.x, l.y, l.w, l.h);
      drawBayLines(ctx, l);
      if (l.label) drawPadLabel(ctx, l);
    }
    for (const p of pads) {
      if (!inView(p.x, p.y, p.w, p.h, cam)) continue;
      if (p.kind === 'lot') continue; // already drawn as a full lot above? no - pads drawn separately
      ctx.fillStyle = '#4c4c57';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.strokeStyle = 'rgba(240,230,200,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 4, p.y + 4, p.w - 8, p.h - 8);
      drawPadLabel(ctx, p);
    }

    // roads: pale sidewalk underlay, then asphalt
    const sw = ROAD_W + SIDEWALK * 2;
    ctx.fillStyle = PALETTE.sidewalk;
    for (const rx of roadsX) {
      if (!inView(rx - sw / 2, vy, sw, vh, cam, 0)) continue;
      ctx.fillRect(rx - sw / 2, vy, sw, vh);
    }
    for (const ry of roadsY) {
      const xEnd = Math.min(vx + vw, WATER_X);
      if (xEnd <= vx) continue;
      ctx.fillRect(vx, ry - sw / 2, xEnd - vx, sw);
    }
    ctx.fillStyle = PALETTE.road;
    for (const rx of roadsX) {
      if (!inView(rx - HALF_ROAD, vy, ROAD_W, vh, cam, 0)) continue;
      ctx.fillRect(rx - HALF_ROAD, vy, ROAD_W, vh);
    }
    for (const ry of roadsY) {
      const xEnd = Math.min(vx + vw, WATER_X);
      if (xEnd <= vx) continue;
      ctx.fillRect(vx, ry - HALF_ROAD, xEnd - vx, ROAD_W);
    }

    // lane dashes
    ctx.fillStyle = PALETTE.laneMark;
    const dash = 26, gapD = 34, period = dash + gapD;
    for (const rx of roadsX) {
      if (!inView(rx - 2, vy, 4, vh, cam, 0)) continue;
      const start = Math.floor(vy / period) * period;
      for (let y = start; y < vy + vh; y += period) {
        ctx.fillRect(rx - 2, y, 4, dash);
      }
    }
    for (const ry of roadsY) {
      const xEnd = Math.min(vx + vw, WATER_X);
      if (xEnd <= vx) continue;
      const start = Math.floor(vx / period) * period;
      for (let x = start; x < xEnd; x += period) {
        ctx.fillRect(x, ry - 2, dash, 4);
      }
    }

    // crosswalks at intersections near the camera
    ctx.fillStyle = PALETTE.crosswalk;
    ctx.globalAlpha = 0.5;
    const m = 40;
    for (const rx of roadsX) {
      for (const ry of roadsY) {
        if (rx < vx - m || rx > vx + vw + m || ry < vy - m || ry > vy + vh + m) continue;
        // stripes across the vertical road (walking north-south)
        for (let i = -2; i <= 2; i++) {
          ctx.fillRect(rx - HALF_ROAD + 8 + i * 26, ry - HALF_ROAD - 4, 9, ROAD_W + 8);
        }
        // stripes across the horizontal road (walking east-west)
        for (let i = -2; i <= 2; i++) {
          ctx.fillRect(rx - HALF_ROAD - 4, ry - HALF_ROAD + 8 + i * 26, ROAD_W + 8, 9);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPadLabel(ctx, r) {
    ctx.save();
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const tw = ctx.measureText(r.label).width + 14;
    ctx.fillStyle = 'rgba(240,236,220,0.9)';
    ctx.fillRect(cx - tw / 2, cy - 10, tw, 20);
    ctx.fillStyle = '#3a2a20';
    ctx.fillText(r.label, cx, cy + 1);
    ctx.restore();
  }

  function drawBayLines(ctx, l) {
    ctx.strokeStyle = 'rgba(240,230,200,0.35)';
    ctx.lineWidth = 2;
    const step = 34;
    for (let x = l.x + step; x < l.x + l.w - 6; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, l.y + 6);
      ctx.lineTo(x, l.y + l.h / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, l.y + l.h / 2 + 8);
      ctx.lineTo(x, l.y + l.h - 6);
      ctx.stroke();
    }
  }

  function drawBuildings(ctx, cam) {
    for (const b of buildings) {
      const off = b.height * 0.32;
      const wallH = clamp(b.height * 2.2, 10, 22);
      if (!inView(b.x - 20, b.y - off - 20, b.w + 40, b.h + off + wallH + 40, cam)) continue;

      const seed = (Math.floor(b.x) * 31 + Math.floor(b.y) * 17) >>> 0;

      // soft shadow
      ctx.fillStyle = 'rgba(30,10,40,0.25)';
      ctx.fillRect(b.x + 7, b.y + 9, b.w, b.h);

      // pseudo-3D south wall hanging below the roof's bottom edge
      const wallTop = b.y - off + b.h;
      ctx.fillStyle = shade(b.roof, 0.55);
      ctx.fillRect(b.x, wallTop, b.w, wallH);

      // roof
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x, b.y - off, b.w, b.h);
      ctx.strokeStyle = PALETTE.roofEdge;
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x + 1, b.y - off + 1, b.w - 2, b.h - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(b.x + 5, b.y - off + 5, b.w - 10, b.h - 10);

      // windows on the wall band
      if (b.w >= 60) {
        const nWin = 3 + (seed % 4);
        const wy = wallTop + (wallH - 6) / 2;
        for (let i = 0; i < nWin; i++) {
          const wx = b.x + 8 + (i * (b.w - 16)) / Math.max(1, nWin - 1) - 5;
          ctx.fillStyle = (seed + i) % 3 === 0 ? '#26303a' : 'rgba(255,217,160,0.85)';
          ctx.fillRect(wx, wy, 10, 6);
        }
      }

      // AC units, deterministic from the building's own numbers
      for (let i = 0; i < 2; i++) {
        const ux = b.x + 8 + ((seed * (i + 3) * 37) % Math.max(10, b.w - 26));
        const uy = b.y - off + 8 + ((seed * (i + 5) * 53) % Math.max(10, b.h - 26));
        const us = 6 + (seed % 5);
        ctx.fillStyle = 'rgba(60,60,70,0.8)';
        ctx.fillRect(ux, uy, us, us);
      }
    }

    // palms (drawn above buildings so they overlap nicely)
    for (const p of palms) {
      if (!inView(p.x - 20 * p.s, p.y - 24 * p.s, 40 * p.s, 48 * p.s, cam)) continue;
      const s = p.s;
      const topX = p.x + 2 * s;
      const topY = p.y - 16 * s;
      ctx.strokeStyle = PALETTE.palmTrunk;
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(p.x + s, p.y - 10 * s, topX, topY);
      ctx.stroke();
      ctx.strokeStyle = '#2e7d5b';
      ctx.lineWidth = 3 * s;
      ctx.lineCap = 'round';
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + s;
        ctx.beginPath();
        ctx.arc(topX, topY, 17 * s, a - 1.0, a + 0.45);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
  }

  return {
    roadsX,
    roadsY,
    waterX: WATER_X,
    sandX: SAND_X,
    buildings,
    parks,
    lots,
    pads,
    palms,
    landmarks,
    spawn,
    isOnRoad,
    isWater,
    collide,
    nearestRoadPoint,
    drawGround,
    drawBuildings,
  };
}
