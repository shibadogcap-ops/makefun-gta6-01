// All audio is synthesized with WebAudio. No assets, no network.
// Everything degrades to a no-op if WebAudio is unavailable or the context
// is suspended.

const MASTER_GAIN = 0.9;

function createNoiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Per-oscillator envelope: gain ramps to `peak` over `attack`, back to
// zero over `decay`. Returns the gain node (already connected downstream).
function env(ctx, dest, peak, attack, decay) {
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  g.connect(dest);
  return g;
}

// One-shot filtered oscillator note. wave/freqAt slides over duration.
function tone(ctx, dest, { wave = 'sine', freq = 440, freqEnd = null, dur = 0.1, peak = 0.2, attack = 0.005 }) {
  const osc = ctx.createOscillator();
  const g = env(ctx, dest, peak, attack, dur - attack);
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + dur);
  osc.connect(g);
  osc.start();
  osc.stop(ctx.currentTime + dur + 0.05);
}

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let noiseBuf = null;

  // Engine nodes (created lazily once, never recreated).
  let eng = null; // { osc, sub, filter, gain, ratio }

  // Siren nodes.
  let siren = null; // { osc, gain, lfo, lfoGain, state }

  // Radio pad nodes.
  let radio = null; // { oscA, oscB, gains, noise, gain, timer }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function resumeIfSuspended() {
    if (ctx && ctx.state === 'suspended') {
      try { ctx.resume(); } catch { /* ignore */ }
    }
  }

  function getNoise() {
    if (!noiseBuf) noiseBuf = createNoiseBuffer(ctx);
    return noiseBuf;
  }

  // Generic noise burst using the shared cached buffer.
  function burst(dest, { dur = 0.2, peak = 0.3, type = 'lowpass', freq = 1200, freqEnd = null, attack = 0.002 }) {
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, ctx.currentTime);
    if (freqEnd !== null) filter.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + dur);
    const g = env(ctx, dest, peak, attack, dur - attack);
    src.connect(filter);
    filter.connect(g);
    src.start();
    src.stop(ctx.currentTime + dur + 0.05);
  }

  function buildEngine() {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    sub.connect(filter);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start();
    sub.start();
    eng = { osc, sub, filter, gain, ratio: 0, on: false };
  }

  function buildSiren() {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 770;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 1 / 0.76; // half-period 0.38s: alternates 660/880
    // Square LFO output is +/-1; bias 770 +/- 110 => alternates 660 / 880.
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 110;
    const bias = ctx.createConstantSource();
    bias.offset.value = 770;
    const sum = ctx.createGain();
    sum.gain.value = 1;
    bias.connect(sum);
    lfo.connect(lfoAmt);
    lfoAmt.connect(sum);
    sum.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    lfo.start();
    bias.start();
    siren = { osc, gain, lfo, bias, state: 'off' };
  }

  function buildRadio() {
    // Am7 -> Fmaj7 pad: slow detuned triangle chords drifting.
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.connect(gain);
    gain.connect(master);

    const chords = [
      [220.0, 261.63, 329.63, 392.0],   // Am7 (A C E G)
      [174.61, 220.0, 261.63, 349.23],  // Fmaj7 (F A C E)
    ];
    const chordDur = 6; // seconds per chord
    const oscs = [];
    const gains = [];
    const start = ctx.currentTime;

    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.detune.value = i % 2 === 0 ? -4 : 4;
      const g = ctx.createGain();
      g.gain.value = 0.25 / 4;
      osc.connect(g);
      g.connect(filter);
      osc.start(start);
      oscs.push(osc);
      gains.push(g);
    }

    // Schedule chord tones: each osc plays chord A for chordDur then chord B,
    // looping. Use setTargetAtTime scheduling via an interval is heavy; instead
    // use a simple LFO-driven approach: assign each osc a fixed chord tone and
    // drift by scheduling frequency ramps every chordDur for a while ahead.
    const seq = () => {
      const t = ctx.currentTime + 0.05;
      const bar = Math.floor((t - start) / chordDur) % 2;
      const chord = chords[bar];
      const nextBar = chords[(bar + 1) % 2];
      for (let i = 0; i < oscs.length; i++) {
        const target = chord[i];
        const later = nextBar[i];
        oscs[i].frequency.cancelScheduledValues(t);
        oscs[i].frequency.setValueAtTime(oscs[i].frequency.value, t);
        oscs[i].frequency.linearRampToValueAtTime(target, t + 1.2);
        oscs[i].frequency.setValueAtTime(target, t + chordDur - 1.2);
        oscs[i].frequency.linearRampToValueAtTime(later, t + chordDur);
        // Soft gain LFO per voice for slow swell.
        gains[i].gain.cancelScheduledValues(t);
        gains[i].gain.setValueAtTime(gains[i].gain.value, t);
        gains[i].gain.linearRampToValueAtTime(0.25 / 4 * 1.3, t + chordDur / 2);
        gains[i].gain.linearRampToValueAtTime(0.25 / 4 * 0.6, t + chordDur);
      }
    };
    // Kick off and reschedule periodically while on.
    seq();
    const timer = setInterval(() => {
      if (radio && radio.on) seq();
      else clearInterval(timer);
    }, chordDur * 500);

    // Vinyl-ish noise at very low gain.
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = getNoise();
    nsrc.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.value = 0.15;
    nsrc.connect(nf);
    nf.connect(ng);
    ng.connect(gain);
    nsrc.start(start);

    radio = { gain, oscs, gains, nsrc, timer, on: true };
    // Fade in.
    gain.gain.setTargetAtTime(0.015, ctx.currentTime, 0.5);
  }

  return {
    get muted() {
      return muted;
    },

    unlock() {
      if (muted) return;
      if (!ensureCtx()) return;
      resumeIfSuspended();
      if (master) master.gain.setTargetAtTime(MASTER_GAIN, ctx.currentTime, 0.05);
    },

    setMuted(m) {
      muted = !!m;
      if (master && ctx) {
        try {
          master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime, 0.05);
        } catch { /* ignore */ }
      }
    },

    engine(on, ratio) {
      if (!ctx || !ensureCtx()) return;
      if (!eng) buildEngine();
      const r = Math.max(0, Math.min(1, ratio || 0));
      eng.ratio = r;
      if (on) {
        const t = ctx.currentTime;
        const freq = 55 + r * 140;
        eng.osc.frequency.setTargetAtTime(freq, t, 0.08);
        eng.sub.frequency.setTargetAtTime(freq * 0.5, t, 0.08);
        eng.filter.frequency.setTargetAtTime(500 + r * 1400, t, 0.08);
        eng.gain.gain.setTargetAtTime(0.05, t, 0.08);
        eng.on = true;
      } else if (eng.on) {
        const t = ctx.currentTime;
        eng.gain.gain.setTargetAtTime(0, t, 0.08);
        eng.on = false;
      }
    },

    siren(on) {
      if (!ctx || !ensureCtx()) return;
      if (!siren) buildSiren();
      const t = ctx.currentTime;
      if (on && siren.state === 'off') {
        siren.gain.gain.setTargetAtTime(0.03, t, 0.05);
        if (siren.lfo.state === 'suspended') try { siren.lfo.start(); } catch { /* ignore */ }
        siren.state = 'on';
      } else if (!on && siren.state === 'on') {
        siren.gain.gain.setTargetAtTime(0, t, 0.05);
        siren.state = 'off';
      }
    },

    shot() {
      if (!ensureCtx()) return;
      resumeIfSuspended();
      const t = ctx.currentTime;
      // Noise burst through highpass.
      burst(master, { dur: 0.09, peak: 0.5, type: 'highpass', freq: 900, attack: 0.001 });
      // Low thump.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const g = env(ctx, master, 0.5, 0.002, 0.12);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.15);
    },

    dryFire() {
      if (!ensureCtx()) return;
      resumeIfSuspended();
      burst(master, { dur: 0.03, peak: 0.15, type: 'bandpass', freq: 2500, attack: 0.001 });
    },

    hit() {
      if (!ensureCtx()) return;
      resumeIfSuspended();
      burst(master, { dur: 0.08, peak: 0.35, type: 'lowpass', freq: 400, attack: 0.001 });
    },

    crash(hard) {
      if (!ensureCtx()) return;
      resumeIfSuspended();
      const k = hard ? 1 : 0.5;
      burst(master, { dur: 0.25 * k + 0.1, peak: 0.4 * k, type: 'lowpass', freq: 600, freqEnd: 150, attack: 0.002 });
    },

    pickup() {
      if (!ensureCtx()) return;
      resumeIfSuspended();
      const t = ctx.currentTime;
      tone(ctx, master, { freq: 880, dur: 0.07, peak: 0.18 });
      setTimeout(() => {
        if (ctx) tone(ctx, master, { freq: 1320, dur: 0.07, peak: 0.18 });
      }, 70);
    },

    cash() {
      if (!ensureCtx()) return;
      resumeIfSuspended();
      const notes = [990, 1320, 1560];
      notes.forEach((f, i) => {
        setTimeout(() => {
          if (ctx) tone(ctx, master, { freq: f, dur: 0.09, peak: 0.16 });
        }, i * 55);
      });
    },

    fail() {
      if (!ensureCtx()) return;
      resumeIfSuspended();
      tone(ctx, master, { wave: 'triangle', freq: 330, freqEnd: 196, dur: 0.4, peak: 0.25 });
    },

    radio(on) {
      if (!ensureCtx()) return;
      resumeIfSuspended();
      if (on && (!radio || !radio.on)) {
        buildRadio();
      } else if (!on && radio && radio.on) {
        const t = ctx.currentTime;
        radio.gain.gain.setTargetAtTime(0, t, 0.4);
        const r = radio;
        radio = null;
        clearInterval(r.timer);
        try { r.nsrc.stop(t + 1.5); } catch { /* ignore */ }
        for (const o of r.oscs) {
          try { o.stop(t + 1.5); } catch { /* ignore */ }
        }
      }
    },
  };
}
