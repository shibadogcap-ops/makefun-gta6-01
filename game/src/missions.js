// Missions: the Marla Quinn story chain, the endless errand loop, and the
// repeatable rampage. Owns stage logic, timers, payouts and the glowing world
// markers. Deterministic: all randomness flows through the injected rng.
// Never touches the DOM or audio.

import { PALETTE } from './config.js';
import { dist2 } from './random.js';
import { createCar } from './vehicles.js';

const FOOT_R = 70;
const CAR_R = 90;
const TAU = Math.PI * 2;

const RAMPAGE_TIME = 90;
const RAMPAGE_TARGET = 1200;
const RAMPAGE_PAY = 500;

const GOLD = '255,213,74';
const PHONE_GREEN = '74,222,128';
const RAMPAGE_ORANGE = '255,150,60';
const CHECKPOINT_CYAN = '90,215,255';

/** Story chain, in order. text is Marla's dry one-liner per job. */
const STORY = [
  { title: 'First Delivery', pay: 250, text: "Marla's package for the marina. Don't open it. Don't ask." },
  { title: 'Beach Sprint', pay: 400, text: 'Coastal run, eight markers. The road owes Marla money.' },
  { title: 'Hot Wheels', pay: 650, text: 'Slick sports car at the parking lot. Borrow it. Permanently.' },
  { title: 'The Big Score', pay: 1500, text: "Crew's set — marina, beach, bank, gone before the sirens clock in." },
];

function hypot(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function reachRadius(player) {
  return player.mode === 'car' ? CAR_R : FOOT_R;
}

/** Beach-sprint checkpoints: the x=4200 coastal road, y 2600 -> 400. */
function beachCheckpoints() {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    pts.push({ x: 4200, y: 2600 - (i * 2200) / 7 });
  }
  return pts;
}

export function createMissions(city, rng, save) {
  const hints = save || {};
  let storyIdx = Math.min(Math.max(hints.missionsDone | 0, 0), STORY.length);
  if (hints.storyComplete) storyIdx = STORY.length;
  let completedStory = storyIdx >= STORY.length;

  const L = city.landmarks;

  const api = {
    state: {
      active: null,
      offered: storyIdx < STORY.length ? storyIdx : 'errands',
      completedStory,
      rampageActive: false,
    },
    rampageState: { active: false, timeLeft: 0, points: 0, target: RAMPAGE_TARGET },
    markedCar: null,
    lastEvents: [],
  };

  // ------------------------------------------------------------- helpers

  function playerNear(world, x, y, radius) {
    const p = world.player;
    const r = radius === undefined ? reachRadius(p) : radius;
    return dist2(p.x, p.y, x, y) <= r * r;
  }

  function completeStory(m, ev) {
    const def = STORY[m.story];
    ev.push({ type: 'payout', amount: def.pay, label: def.title });
    storyIdx += 1;
    api.state.offered = storyIdx < STORY.length ? storyIdx : 'errands';
    if (m.story === STORY.length - 1) {
      completedStory = true;
      api.state.completedStory = true;
      ev.push({ type: 'storyComplete' });
    }
    api.state.active = null;
  }

  function failMission(reason, ev) {
    api.state.active = null;
    ev.push({ type: 'missionFailed', reason });
  }

  function newErrand() {
    const keys = Object.keys(L);
    const i = rng.int(0, keys.length - 1);
    let j = rng.int(0, keys.length - 2);
    if (j >= i) j += 1;
    const from = L[keys[i]];
    const to = L[keys[j]];
    const d = hypot(from.x, from.y, to.x, to.y);
    return {
      errand: true,
      stage: 0,
      from,
      to,
      timer: Math.max(60, d / 9),
      pay: Math.max(1, Math.round(d / 6)),
    };
  }

  // ------------------------------------------------------------- offers

  api.offerMarker = function () {
    if (api.state.active) return null;
    return { x: L.diner.x, y: L.diner.y, label: 'JOB' };
  };

  api.rampageMarker = function () {
    if (api.rampageState.active) return null;
    return { x: L.rampage.x, y: L.rampage.y, label: 'RAMPAGE!' };
  };

  api.startOffered = function () {
    if (api.state.active) return false;
    const offer = api.state.offered;
    if (offer === 'errands') {
      api.state.active = newErrand();
      return true;
    }
    const m = { story: offer, stage: 0, timer: 0 };
    if (offer === 1) {
      m.checkpoints = beachCheckpoints();
      m.cp = 0;
      m.spawnMarked = true; // car spawns on the next update() once world exists
    }
    if (offer === 2) {
      m.crimeT = 0;
      m.bankT = 0;
    }
    api.state.active = m;
    return true;
  };

  api.startRampage = function () {
    if (api.rampageState.active) return false;
    api.rampageState.active = true;
    api.rampageState.timeLeft = RAMPAGE_TIME;
    api.rampageState.points = 0;
    api.state.rampageActive = true;
    return true;
  };

  api.addMayhem = function (points) {
    if (api.rampageState.active) {
      api.rampageState.points += points | 0;
    }
  };

  // ------------------------------------------------------------- update

  api.update = function (dt, world) {
    const ev = [];
    api.lastEvents = ev;
    if (!world) return ev;

    // Hot Wheels: spawn the marked car the first frame we have a world.
    const m = api.state.active;
    if (m && m.spawnMarked && !api.markedCar) {
      m.spawnMarked = false;
      const car = createCar(
        'sports',
        L.parking.x + rng.range(-30, 30),
        L.parking.y + rng.range(-24, 24),
        rng.range(0, TAU),
        rng.pick(PALETTE.CAR_COLORS),
      );
      car.driver = null;
      car.parked = true;
      car.missionCar = true;
      api.markedCar = car;
      if (world.addCar) world.addCar(car);
    }

    if (m) {
      if (m.errand) updateErrand(m, dt, world, ev);
      else updateStory(m, dt, world, ev);
    }
    if (api.rampageState.active) updateRampage(dt, ev);
    return ev;
  };

  function updateErrand(m, dt, world, ev) {
    m.timer -= dt;
    if (m.timer <= 0) {
      failMission("Marla's patience expired. Try again.", ev);
      return;
    }
    const target = m.stage === 0 ? m.from : m.to;
    if (playerNear(world, target.x, target.y)) {
      if (m.stage === 0) {
        m.stage = 1;
        ev.push({ type: 'toast', title: 'Odd Job', text: "Package's in the car. Don't be interesting." });
      } else {
        ev.push({ type: 'payout', amount: m.pay, label: 'Odd Job' });
        api.state.active = null;
      }
    }
  }

  function updateStory(m, dt, world, ev) {
    const p = world.player;
    switch (m.story) {
      case 0: { // First Delivery
        if (m.stage === 0) {
          if (playerNear(world, L.diner.x, L.diner.y)) {
            m.stage = 1;
            m.timer = 150;
            ev.push({ type: 'toast', title: 'Marla', text: 'Package collected. Try not to lose it.' });
          }
        } else {
          m.timer -= dt;
          if (m.timer <= 0) { failMission('Delivery window missed. Marla is not amused.', ev); return; }
          if (playerNear(world, L.marina.x, L.marina.y)) completeStory(m, ev);
        }
        break;
      }
      case 1: { // Beach Sprint
        if (m.stage === 0) {
          if (p.mode === 'car' && playerNear(world, L.rampage.x, L.rampage.y)) {
            m.stage = 1;
            m.timer = 110;
          }
        } else {
          m.timer -= dt;
          if (m.timer <= 0) { failMission('Ran out of road. Eight markers, remember?', ev); return; }
          const cp = m.checkpoints[m.cp];
          if (playerNear(world, cp.x, cp.y, CAR_R)) {
            m.cp += 1;
            if (m.cp >= m.checkpoints.length) completeStory(m, ev);
          }
        }
        break;
      }
      case 2: { // Hot Wheels
        const car = api.markedCar;
        if (car && car.health <= 0) { failMission('The car died on the way. Rude.', ev); return; }
        if (m.stage === 0) {
          if (car && p.car === car) {
            ev.push({ type: 'crime', kind: 'steal', x: car.x, y: car.y, seen: true });
            m.stage = 1;
            ev.push({ type: 'toast', title: 'Marla', text: 'Good. Chop shop. Try not to scratch it.' });
          }
        } else if (car && p.car === car && hypot(p.x, p.y, L.chopShop.x, L.chopShop.y) <= 100) {
          completeStory(m, ev);
        }
        break;
      }
      case 3: { // The Big Score
        if (m.stage === 0) {
          if (p.mode === 'car' && playerNear(world, L.marina.x, L.marina.y, CAR_R)) {
            m.stage = 1;
            ev.push({ type: 'toast', title: 'Marla', text: "Crew's in. Beach next — try not to lose them." });
          }
        } else if (m.stage === 1) {
          if (p.mode === 'car' && playerNear(world, L.rampage.x, L.rampage.y, CAR_R)) {
            m.stage = 2;
            m.bankT = 0;
            m.crimeT = 5;
            ev.push({ type: 'crime', kind: 'mission', x: L.bank.x, y: L.bank.y, seen: true });
            ev.push({ type: 'toast', title: 'Marla', text: "Bank's next. Fifteen seconds inside. Then we vanish." });
          }
        } else if (m.stage === 2) {
          if (playerNear(world, L.bank.x, L.bank.y, 110)) {
            m.bankT += dt;
            m.crimeT -= dt;
            if (m.crimeT <= 0) {
              m.crimeT += 5;
              ev.push({ type: 'crime', kind: 'mission', x: L.bank.x, y: L.bank.y, seen: true });
            }
            if (m.bankT >= 15) {
              m.stage = 3;
              ev.push({ type: 'toast', title: 'Marla', text: 'Money talks. Hideout. Move.' });
            }
          }
        } else if (playerNear(world, L.hideout.x, L.hideout.y, 110)) {
          completeStory(m, ev);
        }
        break;
      }
    }
  }

  function updateRampage(dt, ev) {
    const rs = api.rampageState;
    rs.timeLeft -= dt;
    if (rs.timeLeft <= 0) {
      rs.active = false;
      api.state.rampageActive = false;
      if (rs.points >= rs.target) {
        ev.push({ type: 'payout', amount: RAMPAGE_PAY, label: 'Rampage' });
        ev.push({ type: 'toast', title: 'Marla', text: 'Fine. You can break things on Palm Bay.' });
      } else {
        ev.push({ type: 'toast', title: 'Rampage', text: 'Over. Mayhem quota missed. How dull.' });
      }
      return;
    }
    // mayhem points arrive via addMayhem(); nothing else to tick here.
  }

  // ------------------------------------------------------------- queries

  api.currentObjective = function () {
    const m = api.state.active;
    if (m) return objectiveFor(m);
    const rs = api.rampageState;
    if (rs.active) {
      return {
        x: L.rampage.x,
        y: L.rampage.y,
        title: 'Rampage!',
        text: `Make Palm Bay regret existing.`,
        sub: `${rs.points}/${rs.target} mayhem`,
        timer: Math.max(0, rs.timeLeft),
        kind: 'rampage',
      };
    }
    return null;
  };

  function objectiveFor(m) {
    if (m.errand) {
      const t = m.stage === 0 ? m.from : m.to;
      return {
        x: t.x,
        y: t.y,
        title: 'Odd Job',
        text: m.stage === 0 ? 'Pickup first. Then the drop.' : 'Get it to the drop-off.',
        sub: `${Math.ceil(m.timer)}s left`,
        timer: Math.max(0, m.timer),
        kind: 'errand',
      };
    }
    switch (m.story) {
      case 0:
        return m.stage === 0
          ? { x: L.diner.x, y: L.diner.y, title: STORY[0].title, text: STORY[0].text, sub: 'Pick up at the diner.', timer: null, kind: 'reach' }
          : { x: L.marina.x, y: L.marina.y, title: STORY[0].title, text: 'Marina. Clock is ticking.', sub: 'Deliver the package.', timer: Math.max(0, m.timer), kind: 'deliver' };
      case 1: {
        if (m.stage === 0) {
          return { x: L.rampage.x, y: L.rampage.y, title: STORY[1].title, text: STORY[1].text, sub: 'Any car will do.', timer: null, kind: 'reach' };
        }
        const cp = m.checkpoints[m.cp];
        return { x: cp.x, y: cp.y, title: STORY[1].title, text: `Checkpoint ${m.cp + 1} of 8.`, sub: 'Coastal road — floor it.', timer: Math.max(0, m.timer), kind: 'race' };
      }
      case 2: {
        const car = api.markedCar;
        if (m.stage === 0) {
          const p = car || L.parking;
          return { x: p.x, y: p.y, title: STORY[2].title, text: STORY[2].text, sub: car ? 'That one. Gold ring means it\'s yours.' : 'Spawned at the parking lot.', timer: null, kind: 'reach' };
        }
        return { x: L.chopShop.x, y: L.chopShop.y, title: STORY[2].title, text: 'Chop shop. In the car, please.', sub: 'Deliver the ride.', timer: null, kind: 'deliver' };
      }
      case 3: {
        if (m.stage === 0) return { x: L.marina.x, y: L.marina.y, title: STORY[3].title, text: STORY[3].text, sub: 'Crew member, marina dock.', timer: null, kind: 'reach' };
        if (m.stage === 1) return { x: L.rampage.x, y: L.rampage.y, title: STORY[3].title, text: 'Crew member, beach lot.', sub: 'Stay in the car.', timer: null, kind: 'reach' };
        if (m.stage === 2) return { x: L.bank.x, y: L.bank.y, title: STORY[3].title, text: 'The bank. Hold position.', sub: `${Math.floor(m.bankT)}s / 15s — do not leave`, timer: null, kind: 'hold' };
        return { x: L.hideout.x, y: L.hideout.y, title: STORY[3].title, text: 'Hideout. Now.', sub: 'Lose the heat, keep the money.', timer: null, kind: 'escape' };
      }
    }
    return null;
  }

  // ------------------------------------------------------------- drawing

  function beam(ctx, x, y, radius, t, rgb) {
    const pulse = 0.85 + 0.15 * Math.sin(t * 4.2);
    // translucent vertical column
    const g = ctx.createLinearGradient(0, y - 180, 0, y + 8);
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(0.7, `rgba(${rgb},0.20)`);
    g.addColorStop(1, `rgba(${rgb},0.34)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - 15, y - 180, 30, 188);
    // ground glow
    ctx.fillStyle = `rgba(${rgb},0.16)`;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 1.9 * pulse, radius * 0.8 * pulse, 0, 0, TAU);
    ctx.fill();
    // pulsing ring
    ctx.strokeStyle = `rgba(${rgb},0.9)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * pulse, radius * 0.55 * pulse, 0, 0, TAU);
    ctx.stroke();
  }

  function ringMarker(ctx, x, y, t, rgb, label) {
    const pulse = 1 + 0.14 * Math.sin(t * 3.4);
    // floating phone-ish glyph: small rounded body with a stub
    ctx.fillStyle = `rgba(${rgb},0.95)`;
    ctx.save();
    ctx.translate(x, y - 46 * pulse);
    ctx.beginPath();
    ctx.roundRect(-7, -11, 14, 22, 3);
    ctx.fill();
    ctx.fillStyle = `rgba(${rgb},0.35)`;
    ctx.fillRect(-3, 11, 6, 4);
    ctx.restore();
    // ground ring
    ctx.strokeStyle = `rgba(${rgb},0.85)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x, y, 30 * pulse, 14 * pulse, 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = `rgba(${rgb},0.25)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 30 * pulse, 14 * pulse, 0, 0, TAU);
    ctx.fill();
    if (label) {
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = `rgba(${rgb},0.9)`;
      ctx.fillRect(x - w / 2, y - 62 * pulse - 8, w, 16);
      ctx.fillStyle = '#1c1c26';
      ctx.fillText(label, x, y - 62 * pulse);
    }
  }

  api.drawWorld = function (ctx, t) {
    const obj = api.currentObjective();
    if (obj) beam(ctx, obj.x, obj.y, 46, t, GOLD);

    const offer = api.offerMarker();
    if (offer) ringMarker(ctx, offer.x, offer.y, t, PHONE_GREEN, offer.label);

    const ramp = api.rampageMarker();
    if (ramp) ringMarker(ctx, ramp.x, ramp.y, t, RAMPAGE_ORANGE, ramp.label);

    // race checkpoint: cyan ring at the current marker
    const m = api.state.active;
    if (m && !m.errand && m.story === 1 && m.stage === 1) {
      const cp = m.checkpoints[m.cp];
      const pulse = 1 + 0.18 * Math.sin(t * 6);
      ctx.strokeStyle = `rgba(${CHECKPOINT_CYAN},0.95)`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(cp.x, cp.y, 34 * pulse, 16 * pulse, 0, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${CHECKPOINT_CYAN},0.4)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cp.x, cp.y, 48 * pulse, 22 * pulse, 0, 0, TAU);
      ctx.stroke();
    }

    // marked-car halo
    const car = api.markedCar;
    if (car) {
      const pulse = 1 + 0.1 * Math.sin(t * 5);
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);
      ctx.strokeStyle = `rgba(${GOLD},0.95)`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 7]);
      ctx.beginPath();
      ctx.ellipse(0, 0, 42 * pulse, 26 * pulse, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  };

  return api;
}
