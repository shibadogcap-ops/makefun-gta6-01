// Boot and the one loop for Palm Bay Heat: input is read once per frame, the
// simulation advances in fixed 1/60 s steps, and the renderer paints what is
// there. The game moves between five screens: title, help, play, pause, end.
//
// ?seed=N fixes the world (default 20261119 so every player gets the same
// Palm Bay). ?shot=name stages a screenshot scene instead of running the loop:
// the scene is painted twice through the same render path and
// window.__shotReady is set. shots.js is loaded defensively — until it lands,
// shot mode falls back to the plain title.

import { STEP, VIEW, WORLD, TUNE } from './config.js';
import { createRandom, clamp } from './random.js';
import { ACTION_CONFIRM, ACTION_PAUSE, ACTION_INTERACT, createInput } from './input.js';
import { createCity } from './city.js';
import { CAR_TYPES, createTraffic, drawCar } from './vehicles.js';
import { createPlayer, updatePlayer, drawPlayer } from './player.js';
import { createPeds } from './pedestrians.js';
import { createCombat } from './combat.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { loadSave, storeSave } from './save.js';

/** The longest frame the loop catches up on; a longer stall is dropped. */
const MAX_FRAME = 0.25;
const DEFAULT_SEED = 20261119;
const TAU = Math.PI * 2;

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : DEFAULT_SEED;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// World construction (deterministic per seed)
// ---------------------------------------------------------------------------

const rng = createRandom(seed);
const city = createCity(rng);
const traffic = createTraffic(city, rng, 14);
const peds = createPeds(city, rng, 24);
const player = createPlayer(city);
const police = createPolice(city, rng);
const combat = createCombat();
const save = loadSave();
const missions = createMissions(city, rng, save);
const hud = createHud();
const audio = createAudio();
audio.setMuted(save.muted);

const input = createInput(canvas);

/** Cars missions spawn (e.g. the Hot Wheels marker) land here. */
const extraCars = [];

const world = {
  city,
  player,
  police,
  combat,
  peds,
  cars: [],
  policeCars: police.cars,
  focus: player,
  danger: null,
  playerCar: null,
  addCar(car) {
    extraCars.push(car);
  },
};

// ---------------------------------------------------------------------------
// Canvas / camera
// ---------------------------------------------------------------------------

const view = { scale: 1, ox: 0, oy: 0, w: 1, h: 1 };
const cam = { x: 0, y: 0 };
const camFocus = { x: city.spawn.x, y: city.spawn.y };
let menuT = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = Math.max(1, Math.round(window.innerWidth * dpr));
  view.h = Math.max(1, Math.round(window.innerHeight * dpr));
  canvas.width = view.w;
  canvas.height = view.h;
}
window.addEventListener('resize', resize);
resize();

/** Cover-fit: the 1280x720 logical view covers the whole canvas, centred. */
function updateViewTransform() {
  view.scale = Math.max(view.w / VIEW.width, view.h / VIEW.height);
  view.ox = (view.w - VIEW.width * view.scale) / 2;
  view.oy = (view.h - VIEW.height * view.scale) / 2;
}
updateViewTransform();

function clampCam(v, worldSize, viewSize) {
  const max = worldSize - viewSize;
  if (max <= 0) return (worldSize - viewSize) / 2;
  return clamp(v, 0, max);
}

/** World-space top-left the camera wants, in view pixels. */
function cameraGoal() {
  let tx, ty;
  if (state === 'title' || state === 'help') {
    camFocus.x = clamp(2100 + Math.sin(menuT * 0.06) * 720, VIEW.width / 2, WORLD.width - VIEW.width / 2);
    camFocus.y = clamp(1500 + Math.cos(menuT * 0.045) * 430, VIEW.height / 2, WORLD.height - VIEW.height / 2);
    tx = camFocus.x;
    ty = camFocus.y;
  } else {
    const car = player.car;
    let vx = 0;
    let vy = 0;
    if (car) {
      tx = car.x;
      ty = car.y;
      vx = car.vx;
      vy = car.vy;
    } else {
      tx = player.x;
      ty = player.y;
      vx = Math.cos(player.angle) * player.speedNow;
      vy = Math.sin(player.angle) * player.speedNow;
    }
    const look = Math.min(120, Math.hypot(vx, vy) * 0.35);
    if (look > 0.01) {
      tx += (vx / Math.hypot(vx, vy)) * look;
      ty += (vy / Math.hypot(vx, vy)) * look;
    }
    camFocus.x = tx;
    camFocus.y = ty;
  }
  return {
    x: clampCam(tx - VIEW.width / 2, WORLD.width, VIEW.width),
    y: clampCam(ty - VIEW.height / 2, WORLD.height, VIEW.height),
  };
}

function updateCamera(dt) {
  const goal = cameraGoal();
  const k = dt > 0 ? 1 - Math.exp(-6 * dt) : 1;
  cam.x += (goal.x - cam.x) * k;
  cam.y += (goal.y - cam.y) * k;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

let state = 'title';
let endKind = 'downed';
let menuSel = 0;
let prevMenuY = 0;
let accumulator = 0;
let lastFrame = performance.now();
let simTime = 0;
let fireCooldown = 0;
let lastDamageAt = -999;
let carryDanger = null; // danger produced after peds.update, applied next step
let interacted = false;
let lastSaveAt = 0;
let saveDirty = false;

function setStatus(message) {
  if (status) status.textContent = message;
}

function markSave() {
  saveDirty = true;
  storeSave(save);
}

function menuItems() {
  const items = ['Start running jobs'];
  if (save.started) items.push('Continue');
  items.push('How to play');
  items.push(save.muted ? 'Sound: off' : 'Sound: on');
  return items;
}

function distTo(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

// ---------------------------------------------------------------------------
// Helpers shared by the simulation
// ---------------------------------------------------------------------------

function carLen(car) {
  return (CAR_TYPES[car.type] || CAR_TYPES.sedan).length;
}

/** Oriented-rectangle containment with a little padding (for car-vs-ped). */
function carContains(car, x, y, pad) {
  const t = CAR_TYPES[car.type] || CAR_TYPES.sedan;
  const dx = x - car.x;
  const dy = y - car.y;
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const lx = -fy;
  const ly = fx;
  return Math.abs(dx * fx + dy * fy) <= t.length * 0.5 + pad &&
         Math.abs(dx * lx + dy * ly) <= t.width * 0.5 + pad;
}

function allCars() {
  const list = world.cars.slice();
  for (const c of police.cars) list.push(c);
  return list;
}

/** True if any ped or police car is within r of (x, y). */
function anyWitness(x, y, r) {
  const r2 = r * r;
  for (const ped of peds.list) {
    const dx = ped.x - x;
    const dy = ped.y - y;
    if (dx * dx + dy * dy < r2) return true;
  }
  for (const car of police.cars) {
    const dx = car.x - x;
    const dy = car.y - y;
    if (dx * dx + dy * dy < r2) return true;
  }
  return false;
}

function nearestWitnessDist(x, y) {
  let best = Infinity;
  for (const ped of peds.list) {
    const d = distTo(x, y, ped.x, ped.y);
    if (d < best) best = d;
  }
  for (const car of police.cars) {
    const d = distTo(x, y, car.x, car.y);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Play-step wiring
// ---------------------------------------------------------------------------

function rebuildWorldCars() {
  world.cars.length = 0;
  for (const c of traffic.cars) world.cars.push(c);
  for (const c of traffic.parked) world.cars.push(c);
  for (const c of extraCars) world.cars.push(c);
  world.playerCar = player.car || null;
  world.focus = player;
}

function onEnterCar(car) {
  // First entry into a stealable car may be a witnessed grand theft.
  if (car.wasStolen || car.missionCar) return;
  car.wasStolen = true;
  const stealable = car.parked || !!car.roadAxis || car.cruise !== undefined;
  if (!stealable) return;
  if (nearestWitnessDist(car.x, car.y) < 300) {
    police.reportCrime('steal', car.x, car.y, true);
  }
}

function handlePlayerShot(ev) {
  police.reportCrime('shot', player.x, player.y, anyWitness(player.x, player.y, 420));
  const seen = (x, y) => anyWitness(x, y, 420);
  if (ev.hitType === 'ped') {
    police.reportCrime('pedHit', ev.x, ev.y, seen(ev.x, ev.y));
  } else if (ev.hitType === 'police') {
    police.reportCrime('shot', ev.x, ev.y, seen(ev.x, ev.y));
  } else if (ev.hitType === 'car') {
    police.reportCrime('carHit', ev.x, ev.y, seen(ev.x, ev.y));
  }
}

function tryMissionInteract(actions) {
  if (!(actions & ACTION_INTERACT)) return;
  const offer = missions.offerMarker();
  if (offer && distTo(player.x, player.y, offer.x, offer.y) < 80 && missions.startOffered()) {
    const obj = missions.currentObjective();
    setStatus(`Mission: ${obj ? obj.title : 'job'}.`);
    return;
  }
  const ramp = missions.rampageMarker();
  if (ramp && distTo(player.x, player.y, ramp.x, ramp.y) < 80 && missions.startRampage()) {
    setStatus('Rampage started.');
  }
}

function carCarCollision(a, b) {
  const ra = (carLen(a) + carLen(b)) * 0.5 * 0.8;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d >= ra || d < 0.001) return;
  const nx = dx / d;
  const ny = dy / d;
  const overlap = ra - d;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;
  const j = -vn * 0.6;
  a.vx -= nx * j;
  a.vy -= ny * j;
  b.vx += nx * j;
  b.vy += ny * j;
  a.speed *= 0.7;
  b.speed *= 0.7;
  const impact = Math.abs(vn);
  a.health = Math.max(0, (a.health || 100) - impact * 0.06);
  b.health = Math.max(0, (b.health || 100) - impact * 0.06);
  if (impact > 180) {
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    audio.crash(true);
    police.reportCrime('carHit', mx, my, anyWitness(mx, my, 420));
    missions.addMayhem(Math.round(impact));
    carryDanger = { x: mx, y: my, r: 200, kind: 'crash' };
  }
}

function carPedCollisions() {
  const pc = player.car;
  const cars = allCars();
  for (const car of cars) {
    const sp = Math.hypot(car.vx || 0, car.vy || 0);
    if (sp <= 60) continue;
    for (const ped of peds.list) {
      if (ped.state === 'down') continue;
      if (!carContains(car, ped.x, ped.y, 8)) continue;
      peds.knockDown(ped);
      if (car === pc || car.driver === 'player') {
        const high = sp > 220;
        police.reportCrime(high ? 'hitAndRun' : 'pedHit', ped.x, ped.y, anyWitness(ped.x, ped.y, 420));
        audio.hit();
        missions.addMayhem(Math.round(sp));
      }
    }
  }
}

function playerCarCollisions() {
  const pc = player.car;
  if (!pc) return;
  for (const other of allCars()) {
    if (other === pc || other.driver === 'player') continue;
    carCarCollision(pc, other);
  }
}

function handleMissionEvent(ev, offerBefore) {
  switch (ev.type) {
    case 'payout': {
      save.money += ev.amount || 0;
      // Story payouts advance the save's mission counter; errands and the
      // rampage pay out cash without touching the story chain.
      const storyPay = typeof offerBefore === 'number' && ev.label !== 'Odd Job' && ev.label !== 'Rampage';
      if (storyPay) save.missionsDone += 1;
      markSave();
      audio.cash();
      hud.toast(ev.label || 'Paid', `+$${ev.amount || 0}`);
      break;
    }
    case 'toast':
      hud.toast(ev.title || 'Palm Bay', ev.text || '');
      break;
    case 'crime':
      police.reportCrime(ev.kind, ev.x, ev.y, !!ev.seen);
      break;
    case 'missionFailed':
      hud.toast('Mission failed', ev.reason || 'Better luck next time.');
      audio.fail();
      break;
    case 'storyComplete':
      save.storyComplete = true;
      markSave();
      endKind = 'complete';
      state = 'end';
      setStatus('Story complete.');
      break;
    default:
      break;
  }
}

function endGame(kind) {
  if (state === 'end') return;
  endKind = kind;
  state = 'end';
  setStatus(kind === 'arrested' ? 'Arrested.' : 'Downed.');
  markSave();
}

/** A road-side point near a landmark that is not inside a wall or the sea. */
function spotNear(landmark, avoidPolice) {
  const cx = landmark ? landmark.x : city.spawn.x;
  const cy = landmark ? landmark.y : city.spawn.y;
  for (const r of [70, 120, 180, 250, 340, 460]) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (city.isWater(x, y) || city.collide(x, y, 16)) continue;
      if (avoidPolice) {
        let near = false;
        for (const car of police.cars) {
          if (distTo(x, y, car.x, car.y) < 320) { near = true; break; }
        }
        if (near) continue;
      }
      return { x, y };
    }
  }
  return { x: cx, y: cy };
}

function exitVehicle() {
  if (!player.car) return;
  player.car.driver = null;
  player.car = null;
  player.mode = 'foot';
  player.speedNow = 0;
}

function respawn() {
  exitVehicle();
  if (endKind === 'arrested') {
    const spot = spotNear(city.landmarks.diner, true);
    player.x = spot.x;
    player.y = spot.y;
    player.health = player.maxHealth;
    const fine = Math.min(save.money, 150);
    save.money -= fine;
    police.wanted = 0;
    police.heat = 0;
    police.busted = 0;
    police.unseenTimer = 0;
    setStatus(`Arrested. Fine: $${fine}.`);
  } else if (endKind === 'downed') {
    const spot = spotNear(city.landmarks.marina, false);
    player.x = spot.x;
    player.y = spot.y;
    player.health = player.maxHealth;
    const fine = Math.min(save.money, 100);
    save.money -= fine;
    police.busted = 0;
    setStatus(`Wrecked. Hospital bill: $${fine}.`);
  }
  player.angle = 0;
  player.speedNow = 0;
  player.walkPhase = 0;
  player.dead = false;
  accumulator = 0;
  state = 'play';
  markSave();
}

function playStep(dt, actions) {
  simTime += dt;
  rebuildWorldCars();
  world.danger = null;

  tryMissionInteract(actions);

  const pev = updatePlayer(player, dt, input, world, actions);
  if (pev.entered) onEnterCar(pev.entered);
  if (pev.crash) {
    audio.crash(!!pev.crash.hard);
    if (pev.crash.hard) lastDamageAt = simTime;
    carryDanger = carryDanger || { x: pev.crash.x, y: pev.crash.y, r: 200, kind: 'crash' };
  }

  traffic.update(dt, city, player, player.car);

  combat.update(dt, world);
  fireCooldown = Math.max(0, fireCooldown - dt);

  // Player shooting: on foot only, mouse aims, hold/click to fire.
  if (player.mode === 'foot' && input.mouse.down && fireCooldown <= 0 && player.aimAngle !== undefined) {
    const ev = combat.fire({ x: player.x, y: player.y, angle: player.aimAngle, side: 'player' }, world);
    audio.shot();
    fireCooldown = 0.24;
    handlePlayerShot(ev);
    carryDanger = { x: player.x, y: player.y, r: 340, kind: 'shot' };
  }

  // Pedestrian danger: shot > crash > fast car.
  let danger = null;
  const car = player.car;
  const fast = car ? Math.abs(car.speed) > 330 : false;
  if (carryDanger) danger = carryDanger;
  else if (fast) danger = { x: player.x, y: player.y, r: 120, kind: 'car' };
  world.danger = danger;
  carryDanger = null;
  peds.update(dt, world);

  playerCarCollisions();
  carPedCollisions();

  police.update(dt, world);

  // Police return fire in the same step their window opens.
  if (police.shotsDue && police.shooterCar) {
    const sc = police.shooterCar;
    const a = Math.atan2(player.y - sc.y, player.x - sc.x);
    const ev = combat.fire({ x: sc.x, y: sc.y, angle: a, side: 'police' }, world);
    audio.shot();
    if (ev.hitType === 'player') lastDamageAt = simTime;
    carryDanger = { x: sc.x, y: sc.y, r: 340, kind: 'shot' };
  }

  if (player.health <= 0) { endGame('downed'); return; }
  if (police.busted >= 1) { endGame('arrested'); return; }

  const offerBefore = missions.state.offered;
  const events = missions.update(dt, world) || [];
  for (const ev of events) handleMissionEvent(ev, offerBefore);
  if (state !== 'play') return;

  // Slow health regen after six seconds without taking damage.
  if (simTime - lastDamageAt > 6 && player.health < player.maxHealth) {
    player.health = Math.min(player.maxHealth, player.health + 2.2 * dt);
  }
}

// Title/help backdrop: traffic and peds keep living, no police, no player.
function ambientStep(dt) {
  world.focus = camFocus;
  traffic.update(dt, city, camFocus, null);
  world.danger = null;
  peds.update(dt, world);
}

// ---------------------------------------------------------------------------
// Frame-level input, menus and audio
// ---------------------------------------------------------------------------

function startPlay() {
  state = 'play';
  save.started = true;
  markSave();
  accumulator = 0;
  prevMenuY = 0;
  setStatus('Playing. Palm Bay Heat.');
}

function toggleSound() {
  audio.setMuted(!audio.muted);
  save.muted = audio.muted;
  markSave();
  if (audio.muted) {
    audio.engine(false);
    audio.siren(false);
    audio.radio(false);
  }
  setStatus(audio.muted ? 'Sound off.' : 'Sound on.');
}

function activateMenu() {
  const items = menuItems();
  const sel = clamp(menuSel, 0, items.length - 1);
  let i = 0;
  if (sel === i) { startPlay(); return; }
  i += 1;
  if (save.started) {
    if (sel === i) { startPlay(); return; }
    i += 1;
  }
  if (sel === i) {
    state = 'help';
    prevMenuY = 0;
    setStatus('How to play.');
    return;
  }
  toggleSound();
}

function handleFrameActions(actions) {
  if (actions & (ACTION_CONFIRM | ACTION_PAUSE | ACTION_INTERACT)) interacted = true;

  if (state === 'title') {
    const y = input.axis().y;
    if (y !== 0 && y !== prevMenuY) {
      const n = menuItems().length;
      menuSel = (menuSel + (y > 0 ? 1 : -1) + n) % n;
    }
    prevMenuY = y;
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      activateMenu();
    }
  } else if (state === 'help') {
    if (actions & (ACTION_CONFIRM | ACTION_PAUSE)) {
      state = 'title';
      prevMenuY = 0;
      setStatus('Palm Bay Heat title.');
    }
  } else if (state === 'play') {
    if (actions & ACTION_PAUSE) {
      state = 'pause';
      setStatus('Paused.');
    }
  } else if (state === 'pause') {
    if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
      state = 'play';
      setStatus('Playing.');
    }
  } else if (state === 'end') {
    if (actions & ACTION_CONFIRM) {
      audio.unlock();
      respawn();
      setStatus('Playing.');
    }
  }

  if (interacted && actions) audio.unlock();
}

function updateAim() {
  if (state === 'play' && player.mode === 'foot') {
    const wx = cam.x + (input.mouse.x - view.ox) / view.scale;
    const wy = cam.y + (input.mouse.y - view.oy) / view.scale;
    player.aimAngle = Math.atan2(wy - player.y, wx - player.x);
    player.aiming = input.mouse.down || mouseMoved;
  } else {
    player.aiming = false;
  }
}

let lastMouseX = -1;
let lastMouseY = -1;
let mouseMoved = false;

function updateMouse() {
  mouseMoved = input.mouse.x !== lastMouseX || input.mouse.y !== lastMouseY;
  lastMouseX = input.mouse.x;
  lastMouseY = input.mouse.y;
}

function continuousAudio() {
  if (!interacted) return;
  if (audio.muted) {
    audio.engine(false);
    audio.siren(false);
    audio.radio(false);
    return;
  }
  const driving = state === 'play' && player.mode === 'car' && player.car;
  let ratio = 0;
  if (driving) {
    const t = CAR_TYPES[player.car.type] || CAR_TYPES.sedan;
    ratio = clamp(Math.abs(player.car.speed) / (t.maxSpeed || 1), 0, 1);
  }
  audio.engine(!!driving, ratio);
  let sirenOn = false;
  if (state === 'play' && police.wanted > 0) {
    const r2 = 900 * 900;
    for (const car of police.cars) {
      const dx = car.x - player.x;
      const dy = car.y - player.y;
      if (dx * dx + dy * dy < r2) { sirenOn = true; break; }
    }
  }
  audio.siren(sirenOn);
  audio.radio(state === 'play');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function computePrompt() {
  if (state !== 'play') return null;
  if (player.mode === 'car') return '[F] Exit car';
  const offer = missions.offerMarker();
  if (offer && distTo(player.x, player.y, offer.x, offer.y) < 80) return '[F] Take the job';
  const ramp = missions.rampageMarker();
  if (ramp && distTo(player.x, player.y, ramp.x, ramp.y) < 80) return '[F] Start rampage';
  const r2 = TUNE.interactRange * TUNE.interactRange;
  for (const car of world.cars) {
    if (!car || car.driver === 'player') continue;
    const dx = car.x - player.x;
    const dy = car.y - player.y;
    if (dx * dx + dy * dy < r2) return '[F] Enter car';
  }
  return null;
}

function hudView(t) {
  const rs = missions.rampageState;
  return {
    t,
    money: save.money,
    player,
    carHealth: player.car ? { health: player.car.health, max: 100 } : null,
    wanted: police.wanted,
    busted: police.busted,
    city,
    trafficCars: world.cars,
    policeCars: police.cars,
    objective: missions.currentObjective(),
    rampage: rs.active ? { points: rs.points, target: rs.target, timeLeft: rs.timeLeft } : null,
    prompt: computePrompt(),
  };
}

function drawWorldScene(t) {
  const s = view.scale;
  ctx.setTransform(s, 0, 0, s, view.ox - cam.x * s, view.oy - cam.y * s);
  city.drawGround(ctx, cam, t);
  city.drawBuildings(ctx, cam);
  missions.drawWorld(ctx, t);
  for (const car of traffic.parked) drawCar(ctx, car, t);
  for (const car of traffic.cars) drawCar(ctx, car, t);
  for (const car of extraCars) drawCar(ctx, car, t);
  police.draw(ctx, t);
  peds.draw(ctx, t);
  drawPlayer(ctx, player, t);
  combat.draw(ctx);
}

function drawDuskGrade() {
  // View space: soft radial vignette plus a warm sunset wash.
  const cx = VIEW.width / 2;
  const cy = VIEW.height / 2;
  const g = ctx.createRadialGradient(cx, cy, VIEW.height * 0.35, cx, cy, VIEW.height * 0.95);
  g.addColorStop(0, 'rgba(10,5,20,0)');
  g.addColorStop(1, 'rgba(10,5,20,0.34)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  const warm = ctx.createLinearGradient(0, 0, VIEW.width * 0.4, VIEW.height);
  warm.addColorStop(0, 'rgba(255,140,60,0.05)');
  warm.addColorStop(1, 'rgba(30,8,60,0.16)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
}

/** Paint one full frame for the given screen through the shared path. */
function renderFrame(screen, t) {
  updateViewTransform();
  const s = view.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1a1033';
  ctx.fillRect(0, 0, view.w, view.h);

  drawWorldScene(t);

  // Grade and HUD live in the 1280x720 view space.
  ctx.setTransform(s, 0, 0, s, view.ox, view.oy);
  drawDuskGrade();

  if (screen === 'title') {
    hud.drawTitle(ctx, { menu: { items: menuItems(), selected: menuSel }, t });
  } else if (screen === 'help') {
    hud.drawHelp(ctx, { t });
  } else {
    hud.drawGame(ctx, hudView(t));
    if (screen === 'pause') hud.drawPause(ctx);
    if (screen === 'end') hud.drawEnd(ctx, { endKind, money: save.money });
  }
}

// ---------------------------------------------------------------------------
// Shot mode (screenshots): stage the scene, paint exactly two frames.
// ---------------------------------------------------------------------------

async function runShot(name) {
  let screen = 'title';
  let end = null;
  try {
    const mod = await import('./shots.js');
    const stage = {
      city, traffic, peds, player, police, missions, combat, hud, seed,
    };
    const result = await mod.stageShot(name, stage);
    if (result && result.screen) screen = result.screen;
    end = result && result.endKind;
  } catch {
    screen = 'title';
    end = null;
  }
  endKind = end || 'downed';
  state = screen === 'game' ? 'play' : 'title';
  updateCamera(10); // snap the camera onto the staged subject
  renderFrame(state, 1.7);
  requestAnimationFrame(() => {
    renderFrame(state, 1.72);
    window.__shotReady = true;
  });
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastFrame) / 1000, MAX_FRAME);
  lastFrame = now;
  const t = now / 1000;

  const actions = input.takeActions();
  handleFrameActions(actions);
  updateMouse();
  if (state === 'title' || state === 'help') menuT += dt;
  updateCamera(dt);
  updateAim();

  if (state === 'title' || state === 'help') {
    accumulator += dt;
    while (accumulator >= STEP) {
      ambientStep(STEP);
      accumulator -= STEP;
    }
  } else if (state === 'play') {
    accumulator += dt;
    let first = true;
    while (accumulator >= STEP && state === 'play') {
      playStep(STEP, first ? actions : 0);
      first = false;
      accumulator -= STEP;
    }
    if (accumulator < 0) accumulator = 0;
  } else {
    accumulator = 0;
  }

  continuousAudio();

  if (now - lastSaveAt > 10000) {
    lastSaveAt = now;
    storeSave(save);
    saveDirty = false;
  }

  renderFrame(state, t);
}

// Leaving the tab pauses a running game rather than letting the heat find you.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') {
    state = 'pause';
    setStatus('Paused.');
  }
});

setStatus('Palm Bay Heat title.');

if (shotName) {
  runShot(shotName);
} else {
  requestAnimationFrame(frame);
}
