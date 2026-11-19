// HUD: every screen-space overlay for Palm Bay Heat.
// main.js restores the camera transform before calling drawGame, so all
// drawing here uses raw 1280x720 viewport coordinates.

const W = 1280;
const H = 720;

const COL = {
  gold: '#f5c542',
  coral: '#f2685c',
  teal: '#2fb3a3',
  white: '#f2f0ea',
  grey: '#b8b4c8',
  dim: '#8b87a0',
  panel: 'rgba(12,12,22,0.78)',
  panelSolid: 'rgba(10,10,18,0.92)',
  line: 'rgba(255,255,255,0.14)',
  police: '#4a90d9',
};

const FONT = {
  money: '700 26px system-ui, sans-serif',
  label: '600 13px system-ui, sans-serif',
  body: '500 15px system-ui, sans-serif',
  cardTitle: '700 18px system-ui, sans-serif',
  cardText: '500 15px system-ui, sans-serif',
  objTitle: '700 20px system-ui, sans-serif',
  objText: '600 16px system-ui, sans-serif',
  objSub: '500 13px system-ui, sans-serif',
  speed: 'italic 900 46px system-ui, sans-serif',
  announce: 'italic 900 44px system-ui, sans-serif',
  logo: 'italic 900 92px Georgia, serif',
  logoSub: 'italic 900 68px Georgia, serif',
  menu: '600 24px system-ui, sans-serif',
  title: 'italic 900 72px Georgia, serif',
  end: 'italic 900 64px Georgia, serif',
  small: '500 14px system-ui, sans-serif',
};

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function money(n) {
  const s = String(Math.max(0, Math.round(n || 0)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return '$' + out;
}

function mmss(sec) {
  const s = Math.max(0, Math.ceil(sec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx, cx, cy, r, rot, fill) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// Draws text with manual letter spacing (ctx.letterSpacing is unreliable).
function spaced(ctx, text, cx, cy, spacing, font, color, align = 'center') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  const widths = [...text].map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let x = align === 'center' ? cx - total / 2 : cx - total;
  if (align === 'right') x = cx - total;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, cy);
    x += widths[i] + spacing;
  }
}

function carFrac(ch) {
  if (ch == null) return 0;
  if (typeof ch === 'number') return clamp01(ch);
  const v = ch.hp ?? ch.health ?? ch.value ?? 0;
  const m = ch.max ?? ch.maxHealth ?? ch.maxHp ?? 100;
  return m > 0 ? clamp01(v / m) : 0;
}

export function createHud() {
  let now = 0;
  const toasts = [];
  let announceState = null;

  function advance(view) {
    const t = view && typeof view.t === 'number' ? view.t : null;
    if (t != null) now = t;
    else now += 1 / 60;
    return now;
  }

  function toast(title, text, seconds = 3.5) {
    toasts.push({ title, text, created: now, dur: seconds });
    while (toasts.length > 4) toasts.shift();
  }

  function announce(text) {
    announceState = { text, created: now, dur: 2.2 };
  }

  // ------------------------------------------------------------- pieces

  function drawMoneyAndVitals(ctx, view) {
    const p = view.player || {};
    ctx.font = FONT.money;
    const label = money(view.money);
    const w = Math.max(96, ctx.measureText(label).width + 28);
    rr(ctx, 20, 18, w, 42, 10);
    ctx.fillStyle = 'rgba(12,12,22,0.75)';
    ctx.fill();
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COL.gold;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 34, 40);

    // player health
    const bx = 24, bw = 180, bh = 12;
    rr(ctx, bx - 2, 72 - 2, bw + 4, bh + 4, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill();
    const hp = clamp01((p.health || 0) / (p.maxHealth || 100));
    if (hp > 0) {
      rr(ctx, bx, 72, bw * hp, bh, 5);
      ctx.fillStyle = COL.coral;
      ctx.fill();
    }

    // car health (only while driving)
    const driving = p.mode === 'car' && view.carHealth != null;
    if (driving) {
      const cy = 94;
      rr(ctx, bx - 2, cy - 2, bw + 4, bh + 4, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
      const cf = carFrac(view.carHealth);
      if (cf > 0) {
        rr(ctx, bx, cy, bw * cf, bh, 5);
        ctx.fillStyle = COL.teal;
        ctx.fill();
      }
    }
  }

  function drawWanted(ctx, view) {
    const stars = Math.round(clamp01((view.wanted || 0) / 5) * 5);
    const cy = 44;
    const step = 36;
    const right = W - 24;
    for (let i = 0; i < 5; i++) {
      const cx = right - (4 - i) * step;
      star(ctx, cx, cy, 13, -Math.PI / 2, i < stars ? COL.gold : null);
      if (i >= stars) {
        ctx.fillStyle = 'rgba(40,40,52,0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    const busted = clamp01(view.busted || 0);
    if (busted > 0) {
      const bw = 190, bh = 12;
      const bx = right - bw, by = 74;
      ctx.font = FONT.label;
      ctx.fillStyle = COL.grey;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('ARRESTED IN', bx - 8, by + bh / 2);
      ctx.textAlign = 'left';
      const flash = Math.sin(now * 12) > 0;
      rr(ctx, bx, by, bw, bh, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
      if (busted > 0) {
        rr(ctx, bx, by, bw * busted, bh, 6);
        ctx.fillStyle = flash ? COL.police : COL.coral;
        ctx.fill();
      }
      ctx.font = FONT.objSub;
      ctx.fillStyle = COL.white;
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(busted * 100) + '%', bx + bw / 2, by + bh / 2 + 16);
      ctx.textAlign = 'left';
    }
  }

  function drawMinimap(ctx, view) {
    const city = view.city;
    if (!city) return;
    const mw = 216, mh = 144;
    const mx = 20, my = H - 20 - mh;
    const s = Math.min(mw / 4800, mh / 3200);
    const px = wx => mx + wx * s;
    const py = wy => my + wy * s;

    ctx.save();
    rr(ctx, mx, my, mw, mh, 10);
    ctx.clip();
    ctx.fillStyle = '#33413a';
    ctx.fillRect(mx, my, mw, mh);

    // sand strip and water region (east side of the map)
    const wsx = px(4280);
    const wex = px(4400);
    ctx.fillStyle = '#c9b083';
    ctx.fillRect(wsx, my, wex - wsx, mh);
    ctx.fillStyle = '#27567d';
    ctx.fillRect(wex, my, mx + mw - wex + 1, mh);

    // roads
    ctx.strokeStyle = '#c3d2da';
    ctx.lineWidth = 5.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const rx of city.roadsX) {
      ctx.moveTo(px(rx), my);
      ctx.lineTo(px(rx), my + mh);
    }
    for (const ry of city.roadsY) {
      ctx.moveTo(mx, py(ry));
      ctx.lineTo(mx + mw, py(ry));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // traffic cars: grey dots
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#9aa0a8';
    for (const c of view.trafficCars || []) {
      ctx.beginPath();
      ctx.arc(px(c.x), py(c.y), 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // police cars: flashing red/blue
    const copCol = Math.floor(now * 4) % 2 === 0 ? '#e63946' : '#4a90d9';
    ctx.fillStyle = copCol;
    for (const c of view.policeCars || []) {
      ctx.beginPath();
      ctx.arc(px(c.x), py(c.y), 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // objective: pulsing gold ring
    const obj = view.objective;
    if (obj) {
      const r = 4 + Math.sin(now * 6) * 1.5;
      ctx.strokeStyle = COL.gold;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px(obj.x), py(obj.y), r + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = COL.gold;
      ctx.beginPath();
      ctx.arc(px(obj.x), py(obj.y), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // player arrow
    const pl = view.player;
    if (pl) {
      const ax = px(pl.x), ay = py(pl.y);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(pl.angle || 0);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-4, -4);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
    rr(ctx, mx, my, mw, mh, 10);
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawToasts(ctx) {
    const visible = toasts.slice(-2);
    let y = 56;
    for (const t of visible) {
      const age = now - t.created;
      const fadeIn = Math.min(1, age / 0.25);
      const fadeOut = Math.min(1, Math.max(0, (t.dur + 0.5 - age) / 0.5));
      const a = Math.min(fadeIn, fadeOut);
      if (a <= 0) continue;
      ctx.font = FONT.cardTitle;
      const tw = ctx.measureText(t.title || '').width;
      ctx.font = FONT.cardText;
      const ew = ctx.measureText(t.text || '').width;
      const cw = Math.min(W - 80, Math.max(tw, ew) + 76);
      const ch = 62;
      ctx.save();
      ctx.globalAlpha = a;
      rr(ctx, W / 2 - cw / 2, y, cw, ch, 8);
      ctx.fillStyle = COL.panelSolid;
      ctx.fill();
      ctx.strokeStyle = COL.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = COL.gold;
      ctx.fillRect(W / 2 - cw / 2 + 1, y + 8, 4, ch - 16);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = FONT.cardTitle;
      ctx.fillStyle = COL.gold;
      ctx.fillText(t.title || '', W / 2 + 8, y + 22);
      ctx.font = FONT.cardText;
      ctx.fillStyle = COL.white;
      ctx.fillText(t.text || '', W / 2 + 8, y + 43);
      ctx.restore();
      y += ch + 10;
    }
  }

  function drawObjective(ctx, view) {
    const obj = view.objective;
    if (!obj) return;
    const cx = W / 2;
    const y = 224;
    const sub = obj.sub || '';
    const lastY = (sub !== '' || obj.timer != null) ? y + 46 : y + 24;
    rr(ctx, cx - 250, y - 14, 500, lastY + 10 - (y - 14), 10);
    ctx.fillStyle = 'rgba(8,10,18,0.55)';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = FONT.objTitle;
    ctx.fillStyle = COL.gold;
    ctx.fillText((obj.title || '').toUpperCase(), cx, y);
    ctx.font = FONT.objText;
    ctx.fillStyle = COL.white;
    ctx.fillText(obj.text || '', cx, y + 24);
    ctx.font = FONT.objSub;
    const subW = ctx.measureText(sub).width;
    const gap = obj.timer != null ? 14 : 0;
    ctx.fillStyle = COL.grey;
    ctx.fillText(sub, cx - (subW + gap) / 2, y + 46);
    if (obj.timer != null) {
      ctx.fillStyle = obj.timer < 20 ? COL.coral : COL.gold;
      ctx.fillText(mmss(obj.timer), cx + (subW + gap) / 2, y + 46);
    }
    ctx.textAlign = 'left';
  }

  function drawAnnounce(ctx) {
    if (!announceState) return;
    const age = now - announceState.created;
    const a = Math.min(1, age / 0.15) * Math.min(1, Math.max(0, (announceState.dur - age) / 0.4));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = FONT.announce;
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = COL.white;
    ctx.fillText(announceState.text.toUpperCase(), W / 2, H * 0.42);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  function drawSpeedAndRampage(ctx, view) {
    const p = view.player || {};
    const driving = p.mode === 'car';
    let y = H - 34;

    if (view.rampage) {
      const rw = 230, rh = 64;
      const rx = W - 24 - rw, ry = y - rh - 14;
      rr(ctx, rx, ry, rw, rh, 10);
      ctx.fillStyle = COL.panel;
      ctx.fill();
      ctx.strokeStyle = COL.gold;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = FONT.objTitle;
      ctx.fillStyle = COL.gold;
      ctx.fillText('RAMPAGE', rx + rw / 2, ry + 20);
      ctx.font = FONT.objText;
      ctx.fillStyle = COL.white;
      ctx.fillText(`${view.rampage.points || 0}/${view.rampage.target || 0}`, rx + rw / 2, ry + 42);
      ctx.font = FONT.objSub;
      ctx.fillStyle = view.rampage.timeLeft < 10 ? COL.coral : COL.grey;
      ctx.fillText(mmss(view.rampage.timeLeft), rx + rw / 2, ry + 56);
      ctx.textAlign = 'left';
    }

    if (driving) {
      const mph = Math.round(Math.abs(p.speedNow || 0) * 0.12);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.font = FONT.speed;
      ctx.fillStyle = COL.white;
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 8;
      ctx.fillText(String(mph), W - 110, y);
      ctx.shadowBlur = 0;
      ctx.font = FONT.label;
      ctx.fillStyle = COL.grey;
      ctx.fillText('MPH', W - 24, y - 18);
      ctx.textAlign = 'left';
    }
  }

  function drawPrompt(ctx, view) {
    if (!view.prompt) return;
    const label = /^\[/.test(view.prompt) ? view.prompt : '[F] ' + view.prompt;
    ctx.font = FONT.body;
    const w = ctx.measureText(label).width + 36;
    const h = 38;
    const x = W / 2 - w / 2, y = H - 64;
    rr(ctx, x, y, w, h, 19);
    ctx.fillStyle = COL.panelSolid;
    ctx.fill();
    ctx.strokeStyle = COL.line;
    ctx.stroke();
    ctx.fillStyle = COL.white;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, y + h / 2 + 1);
  }

  // ------------------------------------------------------------- public

  function drawGame(ctx, view) {
    advance(view);
    // prune expired toasts
    while (toasts.length && now - toasts[0].created > toasts[0].dur + 0.6) toasts.shift();

    drawMoneyAndVitals(ctx, view);
    drawWanted(ctx, view);
    drawMinimap(ctx, view);
    drawToasts(ctx);
    drawObjective(ctx, view);
    drawAnnounce(ctx);
    drawSpeedAndRampage(ctx, view);
    drawPrompt(ctx, view);
  }

  function drawTitle(ctx, view) {
    advance(view);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(26,10,44,0)');
    g.addColorStop(1, 'rgba(26,10,44,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    spaced(ctx, 'PALM BAY', cx, 268, 10, FONT.logo, COL.white);

    // coral underline swoosh
    ctx.strokeStyle = COL.coral;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 250, 292);
    ctx.quadraticCurveTo(cx, 312, cx + 250, 288);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 230, 302);
    ctx.quadraticCurveTo(cx, 320, cx + 230, 298);
    ctx.stroke();

    // HEAT with gold gradient
    const lg = ctx.createLinearGradient(cx - 140, 0, cx + 140, 0);
    lg.addColorStop(0, '#ffe9a8');
    lg.addColorStop(0.5, COL.gold);
    lg.addColorStop(1, COL.coral);
    spaced(ctx, 'HEAT', cx, 386, 14, FONT.logoSub, lg);

    ctx.font = 'italic 500 19px Georgia, serif';
    ctx.fillStyle = 'rgba(242,240,234,0.85)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText("Everybody's got a price in Palm Bay.", cx, 438);

    // menu
    const items = (view.menu && view.menu.items) || [];
    const sel = (view.menu && view.menu.selected) || 0;
    const my = 500;
    items.forEach((item, i) => {
      const y = my + i * 46;
      const active = i === sel;
      ctx.font = FONT.menu;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (active) {
        ctx.fillStyle = COL.gold;
        ctx.fillText('>', cx - 130, y);
        ctx.fillStyle = COL.gold;
        ctx.fillText(item, cx + 10, y);
      } else {
        ctx.fillStyle = 'rgba(242,240,234,0.75)';
        ctx.fillText(item, cx, y);
      }
    });

    ctx.font = FONT.small;
    ctx.fillStyle = COL.dim;
    ctx.fillText('WASD drive · F enter car · Mouse aim · Click shoot · Esc pause', cx, H - 60);
    ctx.fillText('An original fan-free crime sandbox — not affiliated with any publisher.', cx, H - 34);
    ctx.textAlign = 'left';
  }

  function drawHelp(ctx) {
    const pw = 760, ph = 480;
    const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
    rr(ctx, px, py, pw, ph, 14);
    ctx.fillStyle = COL.panelSolid;
    ctx.fill();
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    spaced(ctx, 'HOW TO PLAY', W / 2, py + 44, 6, FONT.objTitle, COL.gold);

    const col = (x, rows) => {
      let y = py + 96;
      for (const [head, body] of rows) {
        ctx.textAlign = 'left';
        ctx.font = FONT.label;
        ctx.fillStyle = COL.gold;
        ctx.fillText(head, x, y);
        ctx.font = FONT.small;
        ctx.fillStyle = COL.white;
        ctx.fillText(body, x, y + 20);
        y += 52;
      }
    };

    col(px + 48, [
      ['MOVE', 'WASD on foot, or WASD / arrows to drive'],
      ['CARS', 'Walk up to a car and press F to enter, F again to exit'],
      ['AIM & SHOOT', 'Mouse aims, click or hold to fire'],
      ['PAUSE', 'Esc opens this menu'],
    ]);
    col(px + pw / 2 + 24, [
      ['THE JOB', 'Run jobs for Marla around Palm Bay'],
      ['CASH', 'Deliveries and scores pay out in dollars'],
      ['THE HEAT', 'Crime raises your wanted level — lose the PD'],
      ['SURVIVE', 'Health, wrecks and arrests all end badly'],
    ]);

    ctx.textAlign = 'center';
    ctx.font = FONT.small;
    ctx.fillStyle = COL.dim;
    ctx.fillText('Esc — back', W / 2, py + ph - 28);
    ctx.textAlign = 'left';
  }

  function drawPause(ctx) {
    ctx.fillStyle = 'rgba(4,4,10,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    spaced(ctx, 'PAUSED', W / 2, H / 2 - 40, 12, FONT.title, COL.white);
    ctx.font = FONT.body;
    ctx.fillStyle = COL.grey;
    ctx.fillText('Esc resume · R restart · H help', W / 2, H / 2 + 30);
    ctx.textAlign = 'left';
  }

  function drawEnd(ctx, view) {
    const kind = view.endKind || 'downed';
    const conf = {
      arrested: { text: 'ARRESTED', color: COL.police, sub: 'The Palm Bay PD thanks you for your cooperation.' },
      downed: { text: 'WRECKED', color: COL.coral, sub: 'You wake up at Palm Bay General. The car is not so lucky.' },
      complete: { text: 'STORY COMPLETE', color: COL.gold, sub: 'You retire to a quiet marina. Final take: ' + money(view.money) + '.' },
    }[kind] || { text: 'GAME OVER', color: COL.white, sub: '' };

    ctx.fillStyle = 'rgba(4,4,10,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    spaced(ctx, conf.text, W / 2, H / 2 - 60, 6, FONT.end, conf.color);
    ctx.font = FONT.objText;
    ctx.fillStyle = COL.grey;
    ctx.fillText(conf.sub, W / 2, H / 2 + 10);
    ctx.font = FONT.small;
    ctx.fillStyle = COL.dim;
    ctx.fillText('Press Enter to keep playing', W / 2, H / 2 + 60);
    ctx.textAlign = 'left';
  }

  return { toast, announce, drawGame, drawTitle, drawHelp, drawPause, drawEnd };
}
