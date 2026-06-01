const Sound = (() => {
  let ctx = null;
  let master = null;
  let engineOsc = null;        // mid sawtooth (harmonics)
  let engineSubOsc = null;     // sub sine (deep rumble body)
  let engineGain = null;
  let engineFilter = null;
  let muted = localStorage.getItem('jm-muted') === '1';

  // Build the AudioContext lazily on the first user gesture so browsers
  // don't block it. Returns true on success.
  function ensure() {
    if (ctx) return true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.6;
      master.connect(ctx.destination);
    } catch (e) {
      console.warn('Audio init failed', e);
      return false;
    }
    return true;
  }

  // Resume a suspended context (Safari/iOS quirk after gesture).
  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(()=>{});
  }

  function setMuted(m) {
    muted = m;
    localStorage.setItem('jm-muted', m ? '1' : '0');
    if (master) master.gain.linearRampToValueAtTime(m ? 0 : 0.6, ctx.currentTime + 0.05);
    document.body.classList.toggle('is-muted', m);
  }
  function toggleMute() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }

  // ---- Engine: a layered car-engine voice instead of the old
  // single resonant sawtooth (which hummed like a lawnmower).
  //   - SUB sine for the deep chest-thump rumble.
  //   - MID sawtooth one octave up for the harmonic "growl".
  //   - Gentle lowpass (low Q) so it stays warm not whiny.
  // The two oscillators are detuned slightly for a richer beat.
  function startEngine() {
    if (!ensure() || engineOsc) return;
    engineOsc    = ctx.createOscillator();
    engineSubOsc = ctx.createOscillator();
    engineGain   = ctx.createGain();
    engineFilter = ctx.createBiquadFilter();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 90;     // mid voice
    engineOsc.detune.value = 6;
    engineSubOsc.type = 'sine';
    engineSubOsc.frequency.value = 45;  // deep rumble (octave below)
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 380;
    engineFilter.Q.value = 0.7;         // soft, not resonant
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineSubOsc.connect(engineFilter);
    engineFilter.connect(engineGain).connect(master);
    engineOsc.start();
    engineSubOsc.start();
  }
  // Update engine pitch + volume from current speed (0..1).
  function setEngine(speedNorm) {
    if (!engineOsc) return;
    const t = ctx.currentTime;
    // Mid voice sweeps from a 75Hz idle up to ~260Hz at full throttle.
    const midFreq = 75 + speedNorm * 185;
    engineOsc.frequency.linearRampToValueAtTime(midFreq, t + 0.1);
    // Sub voice tracks one octave below for the body of the sound.
    engineSubOsc.frequency.linearRampToValueAtTime(midFreq * 0.5, t + 0.1);
    // Filter opens with speed but stops well short of the harsh
    // top end that made the old version sound like small machinery.
    engineFilter.frequency.linearRampToValueAtTime(360 + speedNorm * 900, t + 0.1);
    // Idle hum is faint; gets louder as you accelerate.
    const targetGain = 0.04 + speedNorm * 0.18;
    engineGain.gain.linearRampToValueAtTime(targetGain, t + 0.1);
  }

  // ---- One-shot chime: two-tone bell when entering marker proximity.
  function chime() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = t + i * 0.06;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.18, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      osc.connect(g).connect(master);
      osc.start(start);
      osc.stop(start + 0.65);
    });
  }

  // ---- Modal whoosh: pink-ish noise pushed through a sweeping bandpass.
  function whoosh() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const dur = 0.35;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.6;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 2;
    filt.frequency.setValueAtTime(400, t);
    filt.frequency.exponentialRampToValueAtTime(3200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur);
  }

  // ---- Tiny click for button presses.
  function click() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.08);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g).connect(master);
    osc.start(t); osc.stop(t + 0.1);
  }

  // ---- Rocket launch: low rumble (sawtooth + filtered noise) ramping up.
  function rocket() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const dur = 4.6;

    // Low rumble oscillator (pitches down as it climbs away).
    const rumble = ctx.createOscillator();
    const rg = ctx.createGain();
    rumble.type = 'sawtooth';
    rumble.frequency.setValueAtTime(45, t);
    rumble.frequency.exponentialRampToValueAtTime(28, t + dur);
    rg.gain.setValueAtTime(0, t);
    rg.gain.linearRampToValueAtTime(0.35, t + 0.4);    // ignition swell
    rg.gain.linearRampToValueAtTime(0.18, t + 2.0);    // distance falloff
    rg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 4;
    rumble.connect(lp).connect(rg).connect(master);
    rumble.start(t); rumble.stop(t + dur + 0.1);

    // Noise hiss (the actual rocket exhaust roar).
    const noise = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
    const ns = ctx.createBufferSource(); ns.buffer = noise;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.setValueAtTime(420, t);
    nbp.frequency.exponentialRampToValueAtTime(140, t + dur);
    nbp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.45, t + 0.4);
    ng.gain.linearRampToValueAtTime(0.20, t + 2.0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    ns.connect(nbp).connect(ng).connect(master);
    ns.start(t); ns.stop(t + dur);
  }

  // ---- Splash: short low-mid noise burst (car bumping water).
  function splash() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const dur = 0.28;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      // White noise with quick exponential decay envelope baked in.
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.06));
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + dur);
  }

  // ---- Firework: short crackle + bright pop.
  function firework() {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    // Pop: short triangle burst.
    const pop = ctx.createOscillator();
    const pg  = ctx.createGain();
    pop.type = 'triangle';
    pop.frequency.setValueAtTime(320, t);
    pop.frequency.exponentialRampToValueAtTime(80, t + 0.18);
    pg.gain.setValueAtTime(0.28, t);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    pop.connect(pg).connect(master);
    pop.start(t); pop.stop(t + 0.22);

    // Crackle: noise burst with highpass for sparkle.
    const dur = 0.5;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.7;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0, t + 0.05);
    cg.gain.linearRampToValueAtTime(0.22, t + 0.08);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(hp).connect(cg).connect(master);
    src.start(t + 0.05); src.stop(t + dur + 0.05);
  }

  return { ensure, resume, setMuted, toggleMute, isMuted,
           startEngine, setEngine, chime, whoosh, click, splash,
           rocket, firework };
})();

/* ---------- WORLD CONSTANTS ---------- */
// Horizontal "journey" world. The viewport scrolls horizontally to follow
// the car. Locations are arranged left-to-right in story order.
const WORLD_W = 3600;
const WORLD_H = 900;

/* ---------- DATA: location definitions (positions in world coords) ---------- */
const LOCATIONS = [
  {
    id: 'origins',
    title: 'Hometown Cottage',
    eyebrow: 'About Me',
    icon: '🧭',
    x: 380, y: 320,
    render: renderAboutMe,
  },
  {
    id: 'year1',
    title: 'Foundations Hall',
    eyebrow: 'Year 1 Projects',
    icon: '🌱',
    x: 950, y: 200,
    render: () => renderYearProjects(1),
  },
  {
    id: 'year2',
    title: 'Horizons Tower',
    eyebrow: 'Year 2 Projects',
    icon: '🌿',
    x: 1518, y: 260,
    render: () => renderYearProjects(2),
  },
  {
    id: 'reflection',
    title: 'Reflection Bridge',
    eyebrow: 'Growth & Reflection',
    icon: '👤',
    x: 1900, y: 540,
    render: renderReflection,
  },
  {
    id: 'year3',
    title: 'Mastery Heights',
    eyebrow: 'Year 3 Projects',
    icon: '🌳',
    x: 2278, y: 200,
    render: () => renderYearProjects(3),
  },
  {
    id: 'featured',
    title: 'Featured Projects Plaza',
    eyebrow: 'Featured Work',
    icon: '🏆',
    x: 2680, y: 320,
    render: renderFeatured,
  },
  {
    id: 'future',
    title: 'Future Destination',
    eyebrow: 'What Comes Next',
    icon: '🔭',
    x: 3500, y: 320,
    render: renderFuture,
  },
];

/* ---------- STATE ---------- */
const state = {
  projects: [],
  visited: new Set(),
  nearLocation: null, // location id when in proximity
  modalOpen: false,
  started: false,     // true after the user clicks Start
};

/* ---------- BOOT ---------- */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 1. Load project data from JSON via fetch (required by spec).
  try {
    const res = await fetch('./projects.json');
    state.projects = await res.json();
  } catch (err) {
    console.error('Failed to load projects.json', err);
    state.projects = [];
  }

  // 2. Build the map markers.
  buildMarkers();

  // 2b. Generate the twinkling starfield in the sky parallax layer.
  generateStarfield();

  // 3. Show on-screen touch controls if this is a touch device.
  setupTouchControls();

  // 4. Initialize the car + driving controls (always — keyboard for
  //    desktop, joystick + action button for touch devices).
  initCar();

  // 5. Wire up the welcome screen + modal close handlers.
  wireUI();

  // 6. Update progress UI.
  updateProgress();
  // NOTE: ambient world events (rocket, fireworks) and audio init
  // are deferred until the user clicks Start (see wireUI()).
}

/* =============================================================
   AMBIENT WORLD EVENTS
   - Rocket launches every ~22 seconds (first one early so it's
     visible without a long wait).
   - Fireworks burst over the castle every ~7 seconds.
   ============================================================= */
function scheduleRocketLaunches() {
  const fire = () => launchRocket();
  setTimeout(fire, 6000);                    // first launch ~6s in
  setInterval(fire, 22000);                  // then every 22s
}

function launchRocket() {
  const pad = document.getElementById('rocket-pad');
  if (!pad || pad.classList.contains('is-launching')) return;
  pad.classList.add('is-launching');
  Sound.rocket();
  // After the launch animation completes (~5s), reset so it's
  // back on the pad and ready for the next launch.
  setTimeout(() => pad.classList.remove('is-launching'), 5200);
}

function scheduleFireworks() {
  const fire = () => spawnFirework();
  setTimeout(fire, 4000);
  setInterval(fire, 7000);
}

// Spawn a colourful firework burst above the castle. Uses CSS variables
// (--dx, --dy) so each spark animates outward to its own position.
const FIREWORK_COLORS = [
  ['#ff6f7a','#ffd166'], ['#5e7bff','#3aff9d'],
  ['#ff7ad9','#a855f7'], ['#fff5d4','#ffb24c'],
  ['#3aff9d','#5e7bff'],
];
function spawnFirework() {
  const layer = document.getElementById('fireworks');
  if (!layer) return;
  // Position the burst within the castle area (~75-95% across the screen,
  // 15-35% down). The fireworks layer covers the whole sky so this is
  // viewport-relative.
  const cx = 70 + Math.random() * 22;        // % from left
  const cy = 18 + Math.random() * 18;        // % from top
  const palette = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];

  // 1) A rising trail dot to imply the rocket-tail before the burst.
  const trail = document.createElement('span');
  trail.className = 'firework-trail';
  trail.style.left = cx + '%';
  trail.style.top  = (cy + 18) + '%';
  trail.style.setProperty('--rise', `-${100 + Math.random() * 60}px`);
  layer.appendChild(trail);
  setTimeout(() => trail.remove(), 850);

  // 2) The burst itself, after the trail completes.
  setTimeout(() => {
    Sound.firework();
    const sparkCount = 28 + Math.floor(Math.random() * 12);
    for (let i = 0; i < sparkCount; i++) {
      const spark = document.createElement('span');
      spark.className = 'firework';
      const angle = (i / sparkCount) * Math.PI * 2;
      const dist  = 60 + Math.random() * 80;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      spark.style.left = cx + '%';
      spark.style.top  = cy + '%';
      spark.style.background = i % 2 ? palette[0] : palette[1];
      spark.style.boxShadow  = `0 0 6px ${i % 2 ? palette[0] : palette[1]}, 0 0 12px ${i % 2 ? palette[1] : palette[0]}`;
      spark.style.setProperty('--dx', dx + 'px');
      spark.style.setProperty('--dy', dy + 'px');
      spark.style.animationDelay = Math.random() * 0.05 + 's';
      layer.appendChild(spark);
      setTimeout(() => spark.remove(), 1500);
    }
  }, 800);
}

// Detect touch capability. Some laptops also report coarse pointer, so we
// check both ontouchstart and matchMedia to be safe.
function isTouchDevice() {
  return ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    window.matchMedia('(pointer: coarse)').matches;
}

function setupTouchControls() {
  if (isTouchDevice()) {
    document.getElementById('touch-controls').classList.add('is-active');
  }
}

// Generate a random twinkling starfield in the sky parallax layer.
function generateStarfield() {
  const container = document.querySelector('.stars');
  if (!container) return;
  const count = 90;
  const frag = document.createDocumentFragment();
  // Use a seeded pseudo-random so positions are stable per page load (no SSR mismatch concerns here, just nice).
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 'star' + (Math.random() < 0.18 ? ' is-big' : '');
    s.style.left = Math.random() * 100 + '%';
    s.style.top  = (Math.random() * 55) + '%'; // upper portion of sky only
    s.style.setProperty('--dur', (1.6 + Math.random() * 3.2).toFixed(2) + 's');
    s.style.setProperty('--delay', (-Math.random() * 4).toFixed(2) + 's');
    frag.appendChild(s);
  }
  container.appendChild(frag);
}

/* =============================================================
   WELCOME OVERLAY + NAV
   ============================================================= */
function wireUI() {
  // Mute toggle button.
  const muteBtn = document.getElementById('mute-btn');
  if (muteBtn) {
    // Reflect persisted state on first paint.
    document.body.classList.toggle('is-muted', Sound.isMuted());
    muteBtn.setAttribute('aria-pressed', Sound.isMuted() ? 'true' : 'false');
    muteBtn.addEventListener('click', () => {
      const m = Sound.toggleMute();
      muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
      if (!m) Sound.click();
    });
  }

  // Locations Visited panel: collapsible chevron toggles the chip
  // list + progress bar so users can shrink the panel to just the
  // count when they need more map real estate. State persists in
  // localStorage so the choice survives reloads.
  const progPanel  = document.getElementById('hud-progress');
  const progToggle = document.getElementById('hud-progress-toggle');
  if (progPanel && progToggle) {
    const setCollapsed = (collapsed) => {
      progPanel.classList.toggle('is-collapsed', collapsed);
      progToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      progToggle.setAttribute('aria-label', collapsed ? 'Expand visited list' : 'Collapse visited list');
      localStorage.setItem('jm-progress-collapsed', collapsed ? '1' : '0');
    };
    // Default to COLLAPSED on first visit so the panel doesn't
    // cover the map. Only expand if the user explicitly opened it
    // before (saved as '0' in localStorage).
    setCollapsed(localStorage.getItem('jm-progress-collapsed') !== '0');
    progToggle.addEventListener('click', () => {
      setCollapsed(!progPanel.classList.contains('is-collapsed'));
      Sound.click();
    });
  }

  // "How to drive" panel: dismissible + auto-hides on first drive key.
  const hudPanel  = document.getElementById('hud-instructions');
  const hudClose  = document.getElementById('hud-instructions-close');
  const hudHelp   = document.getElementById('hud-help-btn');
  if (hudPanel && hudClose && hudHelp) {
    const setHidden = (hidden, persist = true) => {
      hudPanel.classList.toggle('is-hidden', hidden);
      hudHelp.classList.toggle('is-visible', hidden);
      // Mirror the help-panel state onto <body> so CSS can hide
      // mobile-only chrome (the speedometer wheel + number) when
      // the help panel is hidden, without depending on :has().
      document.body.classList.toggle('help-hidden', hidden);
      if (persist) localStorage.setItem('jm-help-hidden', hidden ? '1' : '0');
    };
    // Restore last state. On mobile (≤760px), default to hidden so
    // the panel doesn't cover the map on first load — the "?" button
    // is always available to bring it back.
    const stored = localStorage.getItem('jm-help-hidden');
    if (stored === '1' || (stored === null && window.matchMedia('(max-width: 760px)').matches)) {
      setHidden(true, false);
    }
    hudClose.addEventListener('click', () => { setHidden(true); Sound.click(); });
    hudHelp.addEventListener('click',  () => { setHidden(false); Sound.click(); });
    // Auto-collapse the first time the user presses a drive key.
    const driveKeys = new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);
    const autoHide = (e) => {
      if (driveKeys.has(e.key.toLowerCase())) {
        setHidden(true);
        window.removeEventListener('keydown', autoHide);
      }
    };
    window.addEventListener('keydown', autoHide);
  }

  // Day / night cycle.
  // - DEFAULT: the world auto-cycles between day and night every
  //   CYCLE_MS milliseconds. This is purely an ambient effect — it
  //   has nothing to do with the wall clock — so the user gets to
  //   see both moods over the course of browsing.
  // - MANUAL: clicking the toggle PAUSES the cycle and locks the
  //   chosen mode. Long-press (600ms) resumes the auto-cycle.
  const CYCLE_MS = 45_000; // ~45s in each phase
  const dayBtn = document.getElementById('day-btn');
  if (dayBtn) {
    let cycleTimer = null;
    const setMode = (day) => {
      document.body.classList.toggle('is-day', day);
      dayBtn.setAttribute('aria-pressed', day ? 'true' : 'false');
    };
    const startCycle = () => {
      stopCycle();
      cycleTimer = setInterval(() => {
        setMode(!document.body.classList.contains('is-day'));
      }, CYCLE_MS);
      dayBtn.title = 'Auto day/night cycle — click to pause';
    };
    const stopCycle = () => {
      if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; }
    };
    // Initial state: respect manual override if set, else start cycling.
    const manual = localStorage.getItem('jm-day-manual'); // '1' / '0' / null
    if (manual !== null) {
      setMode(manual === '1');
      dayBtn.title = `Paused (${manual === '1' ? 'day' : 'night'}) — long-press to resume cycle`;
    } else {
      // Start in night (the original mood) and let the cycle take over.
      setMode(false);
      startCycle();
    }
    // Click = toggle + pause cycle.
    dayBtn.addEventListener('click', () => {
      stopCycle();
      const isDay = !document.body.classList.contains('is-day');
      setMode(isDay);
      localStorage.setItem('jm-day-manual', isDay ? '1' : '0');
      dayBtn.title = `Paused (${isDay ? 'day' : 'night'}) — long-press to resume cycle`;
      Sound.click();
    });
    // Long-press (600ms) clears the override and resumes auto-cycling.
    let pressTimer = null;
    const startPress = () => {
      pressTimer = setTimeout(() => {
        localStorage.removeItem('jm-day-manual');
        startCycle();
        Sound.click();
        pressTimer = 'consumed';
      }, 600);
    };
    const cancelPress = (e) => {
      if (pressTimer === 'consumed') {
        e?.preventDefault?.();
        e?.stopPropagation?.();
      }
      if (pressTimer && pressTimer !== 'consumed') clearTimeout(pressTimer);
      pressTimer = null;
    };
    dayBtn.addEventListener('pointerdown',  startPress);
    dayBtn.addEventListener('pointerup',    cancelPress);
    dayBtn.addEventListener('pointerleave', cancelPress);
  }

  // Start button: hides welcome AND boots up everything that should
  // only run while the user is actively driving — audio context,
  // engine sound, rocket launches, fireworks. This guarantees nothing
  // animates or makes noise behind the welcome overlay.
  document.getElementById('start-btn').addEventListener('click', () => {
    if (state.started) return;
    state.started = true;
    document.getElementById('welcome').style.display = 'none';
    document.body.classList.add('is-started');
    // Boot audio (this is a user gesture — browsers allow it).
    Sound.ensure();
    Sound.resume();
    Sound.startEngine();
    Sound.click();
    // Now start the ambient world events.
    scheduleRocketLaunches();
    scheduleFireworks();
  });

  // Top nav buttons either go home or open a location modal.
  document.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => openLocation(btn.dataset.open));
  });
  document.querySelectorAll('[data-nav="home"]').forEach(btn => {
    btn.addEventListener('click', () => closeModal());
  });

  // Close modal handlers.
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', closeModal);
  });
  document.querySelectorAll('[data-close-detail]').forEach(el => {
    el.addEventListener('click', closeDetailModal);
  });

  // Escape closes whichever modal is open.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('detail-modal').hidden) closeDetailModal();
      else if (state.modalOpen) closeModal();
    }
  });
}

/* =============================================================
   MARKERS (desktop SVG map)
   ============================================================= */
function buildMarkers() {
  const container = document.getElementById('markers');
  container.innerHTML = '';

  LOCATIONS.filter(l => !l.hidden).forEach(loc => {
    const el = document.createElement('div');
    el.className = 'marker';
    el.dataset.id = loc.id;
    // Position within the world coordinate space.
    el.style.left = `${(loc.x / WORLD_W) * 100}%`;
    el.style.top  = `${(loc.y / WORLD_H) * 100}%`;
    el.innerHTML = `
      <div class="marker__ring"></div>
      <button class="marker__pin" aria-label="${loc.title}">
        <span>${loc.icon}</span>
      </button>
      <div class="marker__label">${loc.title}</div>
    `;
    el.querySelector('.marker__pin').addEventListener('click', () => openLocation(loc.id));
    container.appendChild(el);
  });
}

/* =============================================================
   CAR + CONTROLS (keyboard + virtual joystick + action button)
   ============================================================= */
function initCar() {
  const carEl = document.getElementById('car');
  const mapView = document.getElementById('map-view');
  const mapWorld = document.getElementById('map-world');
  const skyLayer = document.getElementById('sky-layer');
  const mountainsLayer = document.getElementById('mountains-layer');
  const particlesEl = document.getElementById('particles');
  const journeyFill = document.getElementById('journey-bar-fill');
  const journeyCar  = document.getElementById('journey-bar-car');
  const speedoNeedle = document.getElementById('speedo-needle');
  const speedoValue  = document.getElementById('speedo-value');
  let particleTimer = 0;

  // Position in world coords (3600x900). Start at the left edge facing right.
  const car = {
    x: 200, y: 600,
    vx: 0, vy: 0,
    angle: 0,
    speed: 0,
  };

  const keys = new Set();
  const PROXIMITY = 200;
  const ACCEL = 0.55;
  const FRICTION = 0.88;
  const MAX_SPEED = 8;
  const TURN_RATE = 0.07;

  // ---- Road auto-snap (lightly guided driving) ----
  // Sample the SVG road path once at startup so we can ask "what's
  // the road's y at this x?" in O(log n) per frame. The car's y and
  // angle are smoothly pulled toward the road, while the user keeps
  // full control of throttle/reverse along the road's direction.
  const roadEl = document.getElementById('road');
  const roadSamples = [];
  (function buildRoadSamples() {
    if (!roadEl || typeof roadEl.getTotalLength !== 'function') return;
    const len = roadEl.getTotalLength();
    const N = 280;
    for (let i = 0; i <= N; i++) {
      const p = roadEl.getPointAtLength((len * i) / N);
      roadSamples.push({ x: p.x, y: p.y });
    }
    roadSamples.sort((a, b) => a.x - b.x);
  })();
  function sampleRoadY(x) {
    if (roadSamples.length === 0) return 600;
    if (x <= roadSamples[0].x) return roadSamples[0].y;
    if (x >= roadSamples[roadSamples.length - 1].x) return roadSamples[roadSamples.length - 1].y;
    let lo = 0, hi = roadSamples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (roadSamples[mid].x <= x) lo = mid; else hi = mid;
    }
    const a = roadSamples[lo], b = roadSamples[hi];
    const t = (x - a.x) / ((b.x - a.x) || 1);
    return a.y + (b.y - a.y) * t;
  }

  // ---- Keyboard listeners ----
  window.addEventListener('keydown', (e) => {
    if (state.modalOpen) return;
    const k = e.key.toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d',' '].includes(k)) {
      e.preventDefault();
    }
    keys.add(k);
    if (k === 'e' && state.nearLocation) openLocation(state.nearLocation);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  // ---- Virtual joystick (touch + mouse-drag fallback) ----
  // Output: joy.x, joy.y in [-1, 1]. y is "up = forward" in screen space, so
  // we feed -joy.y as throttle and joy.x as turn — matches the keyboard
  // mapping (W = throttle +1, D = turn +1).
  const joystick = document.getElementById('joystick');
  const thumb = document.getElementById('joystick-thumb');
  const joy = { x: 0, y: 0, active: false, pointerId: null };
  const JOY_RADIUS = 50; // px the thumb can travel from center

  function updateThumb() {
    thumb.style.transform =
      `translate(calc(-50% + ${joy.x * JOY_RADIUS}px), calc(-50% + ${joy.y * JOY_RADIUS}px))`;
  }
  function setJoyFromEvent(e) {
    const r = joystick.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2);
    let dy = (e.clientY - cy) / (r.height / 2);
    const mag = Math.hypot(dx, dy);
    if (mag > 1) { dx /= mag; dy /= mag; } // clamp to unit circle
    joy.x = dx; joy.y = dy;
    updateThumb();
  }
  joystick.addEventListener('pointerdown', (e) => {
    if (state.modalOpen) return;
    if (joy.active) return; // ignore extra fingers while one is already driving
    joy.active = true;
    joy.pointerId = e.pointerId;
    joystick.classList.add('is-active');
    joystick.setPointerCapture(e.pointerId);
    setJoyFromEvent(e);
    e.preventDefault();
  });
  joystick.addEventListener('pointermove', (e) => {
    if (!joy.active || e.pointerId !== joy.pointerId) return;
    setJoyFromEvent(e);
  });
  const endJoy = (e) => {
    if (e.pointerId !== joy.pointerId) return;
    joy.active = false; joy.x = 0; joy.y = 0; joy.pointerId = null;
    joystick.classList.remove('is-active');
    updateThumb();
  };
  joystick.addEventListener('pointerup', endJoy);
  joystick.addEventListener('pointercancel', endJoy);
  joystick.addEventListener('pointerleave', endJoy);

  // ---- Action button (mobile equivalent of "E" key) ----
  const actionBtn = document.getElementById('action-btn');
  actionBtn.addEventListener('click', () => {
    if (state.nearLocation && !state.modalOpen) openLocation(state.nearLocation);
  });

  // ---- Animation loop ----
  function tick() {
    if (!state.modalOpen) {
      // Combine keyboard + joystick input.
      let throttle = 0, turn = 0;
      if (keys.has('w') || keys.has('arrowup'))    throttle += 1;
      if (keys.has('s') || keys.has('arrowdown'))  throttle -= 1;
      if (keys.has('a') || keys.has('arrowleft'))  turn -= 1;
      if (keys.has('d') || keys.has('arrowright')) turn += 1;
      if (joy.active) {
        // Apply a small dead zone so resting fingers don't crawl.
        const tx = Math.abs(joy.x) > 0.15 ? joy.x : 0;
        const ty = Math.abs(joy.y) > 0.15 ? joy.y : 0;
        throttle += -ty; // up on screen = forward
        turn += tx;
      }
      // Clamp combined input.
      throttle = Math.max(-1, Math.min(1, throttle));
      turn = Math.max(-1, Math.min(1, turn));

      // Free-form movement (top-down arcade feel): turning rotates the car
      // while moving; reverse turning inverts naturally.
      if (throttle !== 0) {
        car.angle += turn * TURN_RATE * (throttle > 0 ? 1 : -1);
      } else if (turn !== 0) {
        // Allow turning while stationary (slow).
        car.angle += turn * TURN_RATE * 0.5;
      }
      car.vx += Math.cos(car.angle) * ACCEL * throttle;
      car.vy += Math.sin(car.angle) * ACCEL * throttle;

      // Apply friction.
      car.vx *= FRICTION;
      car.vy *= FRICTION;

      // Clamp speed.
      const sp = Math.hypot(car.vx, car.vy);
      if (sp > MAX_SPEED) {
        car.vx = (car.vx / sp) * MAX_SPEED;
        car.vy = (car.vy / sp) * MAX_SPEED;
      }

      car.x += car.vx;
      car.y += car.vy;

      // Keep car inside the world.
      car.x = Math.max(60, Math.min(WORLD_W - 60, car.x));
      car.y = Math.max(180, Math.min(WORLD_H - 100, car.y));

      // ---- Soft road bias (very lightly guided) ----
      // While the player has any input (throttle or turn), they have
      // full freedom — no snap fights them. When they release all
      // controls, the car gently drifts back toward the road over
      // ~1-2 seconds so navigation feels guided but never restrictive.
      const idle = throttle === 0 && turn === 0;
      if (idle) {
        const targetY = sampleRoadY(car.x) - 18;
        car.y += (targetY - car.y) * 0.04;
      }

      // ---- Splash effect (rare safety net) ----
      // Auto-snap normally keeps the car on the road. If physics ever
      // pushes the car well below the road's lower edge into the river
      // x-range, trigger a splash + rebound for feel.
      if (car.x > 1740 && car.x < 2060 && car.y > sampleRoadY(car.x) + 60) {
        car.vx *= -0.35; car.vy *= -0.35;
        const now = performance.now();
        if (state.started && now - (car._lastSplash || 0) > 350) {
          car._lastSplash = now;
          Sound.splash();
          // Spawn a CSS-animated splash dot at the collision point.
          const wr = mapWorld.getBoundingClientRect();
          const sx = (car.x / WORLD_W) * wr.width;
          const sy = (car.y / WORLD_H) * wr.height;
          const dot = document.createElement('div');
          dot.className = 'splash';
          dot.style.left = sx + 'px';
          dot.style.top  = sy + 'px';
          mapWorld.appendChild(dot);
          // Self-cleanup once the keyframe finishes.
          dot.addEventListener('animationend', () => dot.remove(), { once: true });
        }
      }

      // Project to world-pixel coords (car lives INSIDE #map-world, so its
      // transform is relative to that element).
      const worldRect = mapWorld.getBoundingClientRect();
      const px = (car.x / WORLD_W) * worldRect.width;
      const py = (car.y / WORLD_H) * worldRect.height;

      // ---- Side-view orientation fix ----
      // The car SVG is drawn from the side (wheels on the bottom edge,
      // headlights on the right). Naively rotating it by `car.angle`
      // works when the car faces the right half of the world, but when
      // it points left (cos(angle) < 0) a pure rotation flips wheels to
      // the top. Instead, when facing left we mirror horizontally with
      // scaleX(-1) and apply the equivalent reduced rotation so the car
      // keeps its wheels on the ground. The headlight cone is a child
      // div so it gets mirrored along with the body — exactly what we
      // want for backwards / left-facing driving.
      const facingLeft = Math.cos(car.angle) < 0;
      const visualAngle = facingLeft ? car.angle - Math.PI : car.angle;
      const deg = (visualAngle * 180) / Math.PI;
      const sx = facingLeft ? -1 : 1;
      carEl.style.transform =
        `translate(${px}px, ${py}px) translate(-50%, -50%) rotate(${deg}deg) scale(${sx}, 1)`;

      // Camera: scroll the world horizontally so the car stays centered,
      // clamped to world bounds. Parallax layers scroll at slower rates.
      const viewportW = mapView.clientWidth;
      const cameraX = Math.max(
        0,
        Math.min(worldRect.width - viewportW, px - viewportW / 2)
      );
      mapWorld.style.transform       = `translate(${-cameraX}px, 0)`;
      if (mountainsLayer) mountainsLayer.style.transform = `translate(${-cameraX * 0.55}px, 0)`;
      if (skyLayer)       skyLayer.style.transform       = `translate(${-cameraX * 0.22}px, 0)`;

      // Journey progress bar (along x axis). Normalize to the actual
      // drivable range — the car spawns at x=200 and is clamped at
      // x=WORLD_W-60 — so reaching the far right of the map fills
      // the bar to exactly 100% (instead of the previous ~98%).
      const JOURNEY_START = 200;
      const JOURNEY_END   = WORLD_W - 60;
      const progress = Math.min(1, Math.max(0, (car.x - JOURNEY_START) / (JOURNEY_END - JOURNEY_START)));
      if (journeyFill) journeyFill.style.width = `${progress * 100}%`;
      if (journeyCar)  journeyCar.style.left = `${progress * 100}%`;

      // Speedometer (map [0..MAX_SPEED] -> [0..120] mph and -135deg..+135deg)
      const speed = Math.hypot(car.vx, car.vy);
      const speedPct = Math.min(1, speed / MAX_SPEED);
      // Engine pitch follows the speed. When a modal is open the car
      // coasts to a stop but driving input is gated, so we force the
      // engine sound to silent immediately — otherwise the throttle
      // hum lingers behind the modal until the car fully decelerates.
      Sound.setEngine(state.modalOpen ? 0 : speedPct);
      if (speedoNeedle) {
        const angle = -135 + speedPct * 270;
        speedoNeedle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
      }
      if (speedoValue) speedoValue.textContent = Math.round(speedPct * 120);

      // Tire trail particles — spawn every few frames when moving.
      particleTimer++;
      if (speed > 1.2 && particleTimer % 3 === 0 && particlesEl) {
        const p = document.createElement('span');
        p.className = 'particle';
        // Offset slightly behind the car based on its angle
        const back = 16;
        const tx = px - Math.cos(car.angle) * back;
        const ty = py - Math.sin(car.angle) * back;
        p.style.left = `${tx}px`;
        p.style.top  = `${ty}px`;
        // Cap particle pool
        if (particlesEl.childElementCount > 80) {
          particlesEl.firstElementChild?.remove();
        }
        particlesEl.appendChild(p);
        // Auto-remove after the CSS animation duration
        setTimeout(() => p.remove(), 1100);
      }

      // Proximity check.
      let near = null, nearDist = Infinity;
      LOCATIONS.filter(l => !l.hidden).forEach(loc => {
        // Proximity uses HORIZONTAL distance only — markers/labels
        // float above the buildings (off the road) but the car
        // drives on the road, so a pure hypot would never trigger.
        const d = Math.abs(loc.x - car.x);
        const markerEl = document.querySelector(`.marker[data-id="${loc.id}"]`);
        if (markerEl) markerEl.classList.toggle('is-near', d < PROXIMITY);
        if (d < PROXIMITY && d < nearDist) { near = loc; nearDist = d; }
      });
      // Play a chime when we ENTER proximity of a new marker.
      const newNearId = near ? near.id : null;
      if (newNearId && newNearId !== state.nearLocation) Sound.chime();
      state.nearLocation = newNearId;
      carEl.classList.toggle('is-near', !!near);
      const prompt = document.getElementById('prompt');
      if (near) {
        prompt.hidden = false;
        document.getElementById('prompt-text').textContent = `Enter ${near.title}`;
      } else {
        prompt.hidden = true;
      }
      // Enable the touch action button when near a marker.
      actionBtn.disabled = !near;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* =============================================================
   MODAL OPEN / CLOSE
   ============================================================= */
function openLocation(id) {
  const loc = LOCATIONS.find(l => l.id === id);
  if (!loc) return;
  document.getElementById('modal-eyebrow').textContent = loc.eyebrow;
  document.getElementById('modal-title').textContent = loc.title;
  document.getElementById('modal-body').innerHTML = loc.render();
  // Re-attach handlers for any "View Details" buttons inside.
  document.querySelectorAll('[data-detail-id]').forEach(btn => {
    btn.addEventListener('click', () => openProjectDetail(Number(btn.dataset.detailId)));
  });
  // Year tab handlers, if present.
  document.querySelectorAll('[data-year-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-year-tab]').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const y = Number(btn.dataset.yearTab);
      document.getElementById('full-portfolio-list').innerHTML =
        renderProjectGrid(state.projects.filter(p => p.year === y));
      attachDetailHandlers();
    });
  });
  attachDetailHandlers();

  document.getElementById('modal').hidden = false;
  state.modalOpen = true;
  // Snap the engine to silent the moment the modal opens so the
  // gas/throttle hum doesn't keep playing while the user is reading.
  Sound.setEngine(0);
  Sound.whoosh();
  if (!state.visited.has(id) && !loc.hidden) {
    state.visited.add(id);
    updateProgress();
    const m = document.querySelector(`.marker[data-id="${id}"]`);
    if (m) m.classList.add('is-visited');
  }
}

function attachDetailHandlers() {
  document.querySelectorAll('[data-detail-id]').forEach(btn => {
    btn.onclick = () => openProjectDetail(Number(btn.dataset.detailId));
  });
}

function closeModal() {
  document.getElementById('modal').hidden = true;
  state.modalOpen = false;
  Sound.click();
}
function openProjectDetail(id) {
  const p = state.projects.find(pr => pr.id === id);
  if (!p) return;
  const isSandbox = (p.githubLink || '').includes('codesandbox.io');
  const codeLabel = isSandbox ? 'CodeSandbox ↗' : 'GitHub ↗';
  const imgMarkup = p.image
    ? `<div class="proj__img has-image" aria-label="Screenshot of ${escapeHtml(p.title)}"><img src="${escapeAttr(p.image)}" alt="Screenshot of ${escapeHtml(p.title)}" loading="lazy" /></div>`
    : `<div class="proj__img" aria-label="Screenshot placeholder for ${escapeHtml(p.title)}"></div>`;
  document.getElementById('detail-title').textContent = p.title;
  document.getElementById('detail-body').innerHTML = `
    ${imgMarkup}
    <p style="margin-top:12px;"><strong>Year ${p.year} · ${escapeHtml(p.category)}</strong></p>
    <p>${escapeHtml(p.description)}</p>
    <h3>Skills learned</h3>
    <p>${escapeHtml(p.skillsLearned)}</p>
    <h3>Reflection</h3>
    <p>${escapeHtml(p.reflection)}</p>
    <h3>Tags</h3>
    <ul class="proj__tags">${p.tags.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
    <div class="proj__actions" style="margin-top:14px;">
      <a href="${escapeAttr(p.liveLink)}" target="_blank" rel="noopener">Live Project ↗</a>
      ${p.githubLink ? `<a href="${escapeAttr(p.githubLink)}" target="_blank" rel="noopener">${codeLabel}</a>` : ''}
      ${p.detailPage ? `<a class="is-primary" href="${escapeAttr(p.detailPage)}" target="_blank" rel="noopener">Project Page ↗</a>` : ''}
    </div>
  `;
  document.getElementById('detail-modal').hidden = false;
}
function closeDetailModal() {
  document.getElementById('detail-modal').hidden = true;
}

/* =============================================================
   PROGRESS HUD
   ============================================================= */
function updateProgress() {
  const total = LOCATIONS.filter(l => !l.hidden).length;
  document.getElementById('total-count').textContent = total;
  document.getElementById('visited-count').textContent = state.visited.size;
  const pct = Math.round((state.visited.size / total) * 100);
  document.getElementById('visited-bar').style.width = `${pct}%`;
  const list = document.getElementById('visited-list');
  list.innerHTML = '';
  state.visited.forEach(id => {
    const loc = LOCATIONS.find(l => l.id === id);
    if (loc) {
      const li = document.createElement('li');
      li.textContent = loc.title;
      list.appendChild(li);
    }
  });
}

/* =============================================================
   RENDERERS — return HTML strings for each modal location
   ============================================================= */
function renderAboutMe() {
  return `
    <div class="about about--no-photo">
      <div>
        <p>
          <strong>Hi, I'm Ethan Chang.</strong> I am a senior in the Web
          Design Pathway Program. Growing up, I spent different parts of my
          childhood in both Taiwan and the United States, adapting to new
          schools, communities, and cultures along the way. Those experiences
          taught me how to be flexible, open minded, and comfortable stepping
          into unfamiliar environments. As I moved between countries, I
          developed an appreciation for different perspectives and learned how
          to connect with people from diverse backgrounds.
        </p>
        <p>
          Today, I am passionate about computer science, mathematics, and web
          design because they challenge me to think critically and create
          solutions from the ground up. I enjoy tackling complex problems,
          whether through programming projects, mathematical research,
          hackathons, or data and actuarial competitions. What excites me most
          is the process of turning ideas into something tangible, combining
          logic, creativity, and persistence to build solutions that can make
          a meaningful impact.
        </p>
        <h3>Skillset</h3>
        <ul class="about__interests">
          <li>HTML</li>
          <li>CSS</li>
          <li>JavaScript</li>
          <li>jQuery</li>
          <li>Vue</li>
          <li>JSON</li>
        </ul>
        <h3>Things I'm into</h3>
        <ul class="about__interests">
          <li>Coding</li>
          <li>Mathematics</li>
          <li>Badminton</li>
          <li>Pickleball</li>
          <li>Drumming</li>
          <li>Video games</li>
        </ul>
      </div>
    </div>
  `;
}

function renderYearProjects(year) {
  const list = state.projects.filter(p => p.year === year);
  const yearBlurb = {
    1: 'Sophomore year — my first dive into Bootstrap, the grid system, and responsive layouts.',
    2: 'Junior year — JavaScript, the DOM, JSON, multi-page sites, and a wide range of small interactive projects.',
    3: 'Senior year — AJAX, jQuery, Vue, multi-page client-style sites, and my most ambitious builds.',
  }[year];
  return `
    <p>${yearBlurb}</p>
    ${renderProjectGrid(list)}
  `;
}

function renderFeatured() {
  const featured = state.projects.filter(p => p.featured);
  const y1 = featured.filter(p => p.year === 1);
  const y2 = featured.filter(p => p.year === 2);
  const y3 = featured.filter(p => p.year === 3);
  return `
    <p>Eight of my best projects across all three years — each one has its own dedicated <em>Project Page</em> with the tech stack, features, and what I learned. Click <em>View Details</em> for the quick version, or <em>Project Page</em> for the full write-up.</p>
    ${renderProjectGrid(y1, { showDetail: true, galleryClass: 'gallery--3col' })}
    ${renderProjectGrid(y2, { showDetail: true, galleryClass: 'gallery--3col' })}
    ${renderProjectGrid(y3, { showDetail: true, galleryClass: 'gallery--3col' })}
  `;
}

function renderProjectGrid(list, opts = {}) {
  if (!list.length) return `<p>No projects yet — check back soon.</p>`;
  return `
    <div class="gallery${opts.galleryClass ? ' ' + opts.galleryClass : ''}">
      ${list.map(p => {
        const isSandbox = (p.githubLink || '').includes('codesandbox.io');
        const codeLabel = isSandbox ? 'CodeSandbox ↗' : 'GitHub ↗';
        const imgMarkup = p.image
          ? `<div class="proj__img has-image" aria-label="Screenshot of ${escapeHtml(p.title)}"><img src="${escapeAttr(p.image)}" alt="Screenshot of ${escapeHtml(p.title)}" loading="lazy" /></div>`
          : `<div class="proj__img" aria-label="Screenshot placeholder for ${escapeHtml(p.title)}"></div>`;
        return `
        <article class="proj">
          ${imgMarkup}
          <div class="proj__body">
            <span class="proj__year">Year ${p.year} · ${escapeHtml(p.category)}</span>
            <h3 class="proj__title">${escapeHtml(p.title)}</h3>
            <p class="proj__desc">${escapeHtml(p.description)}</p>
            <ul class="proj__tags">${p.tags.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
            <div class="proj__actions">
              <a href="${escapeAttr(p.liveLink)}" target="_blank" rel="noopener">Live ↗</a>
              ${p.githubLink ? `<a href="${escapeAttr(p.githubLink)}" target="_blank" rel="noopener">${codeLabel}</a>` : ''}
              ${opts.showDetail ? `<button data-detail-id="${p.id}">View Details</button>` : ''}
              ${p.detailPage ? `<a class="is-primary" href="${escapeAttr(p.detailPage)}" target="_blank" rel="noopener">Project Page ↗</a>` : ''}
            </div>
          </div>
        </article>
      `;}).join('')}
    </div>
  `;
}

function renderReflection() {
  return `
    <p>
      The Web Design Pathway Program has been the place where I stopped
      doing assignments and started building things that feel like they
      belong to me. It taught me how to bring together the skills I am
      most interested in, the values I care about, and the attitude I want
      to bring to future work.
    </p>
    <h3>My overall experience</h3>
    <p>
      The class helped me develop a strong sense of craft. I learned the
      fundamentals of HTML, CSS, and JavaScript, and I started to see how
      those skills fit into larger design decisions. I also learned the
      value of persistence, of rewriting something until it feels right.
      I became more curious about why a layout works, more disciplined about
      working with constraints, and more patient with the process of making.
      My interest in design grew alongside my interest in writing code, and
      that combination now feels like the core of how I enjoy building.
    </p>
    <h3>How I have grown</h3>
    <p>
      In year one I learned to think in structure. The grid and the layout
      rules were new territory, and I spent a lot of time learning how to
      put pieces in the right place. In year two I learned to think in
      experience. I started paying attention to how people move through a
      page and how interactions feel when a button is clicked or an image
      appears.
    </p>
    <p>
      The Memory Game and the Roster Site were both moments where I had to
      make the page feel stable and reliable. The Memory Game taught me how
      to manage state, handle user actions, and make feedback clear.
      The Roster Site taught me how to make a data-heavy page feel easy to
      scan and how to keep a simple design system working across many items.
      Those experiences changed the way I think about building something
      that people can actually use.
    </p>
    <h3>Key moments and challenges</h3>
    <p>
      The Snowflake Designer Lab was a big challenge because it could have
      become cluttered very quickly. It forced me to choose which controls
      mattered most and to keep the interface clean while still making the
      interaction fun. I learned that a project can be ambitious and still
      feel thoughtful if the design is organized.
    </p>
    <p>
      MHSToday was a different kind of challenge. It taught me how to pay
      attention to writing for a real audience, to think about readability,
      and to respect deadlines. That project showed me how design and
      communication work together when people are expecting a polished
      final product.
    </p>
    <p>
      Little Bird Toys and KeySpace Piano Studio taught me the importance
      of consistency. Those projects pushed me to keep the same visual
      language across multiple sections, to make brand choices that felt
      intentional, and to turn separate pages into a coherent whole.
      I learned how much trust is built when a site feels unified.
    </p>
    <h3>Why this feels personal</h3>
    <p>
      This portfolio feels personal because it reflects the way I think now.
      I am not just showing finished pages, I am showing the way I learned
      to care about the process. I care about clarity, about making things
      that are useful, and about building with purpose.
    </p>
    <p>
      I am proud of these projects because they represent the habits I have
      developed: testing, refining, and listening to feedback. The work is
      not perfect, but it is honest, and that honesty is what makes it feel
      like my own.
    </p>
    <p>
      Above all, I want the pages I build to be welcoming and easy to use.
      That value has shaped the way I design, and it is the reason this
      portfolio feels like more than a collection of assignments.
    </p>
  `;
}

function renderFuture() {
  return `
    <p>
      After graduation, I'm attending the University of Michigan as a Michigan Research and Discovery Scholar (MRADS), where I'll double major in Computer Science and Mathematics. There, I'll expand my knowledge of software development, artificial intelligence, machine learning, and mathematical modeling through advanced coursework and research opportunities. My experience in web design has shown me how technology can combine creativity, problem solving, and user experience to create meaningful solutions. The programming, design, and analytical skills I have developed through web design will continue to play an important role as I work on larger and more complex projects, helping me create technology that is both effective and accessible.
    </p>
  `;
}

function renderAI() {
  // Three placeholder examples per the rubric.
  const examples = [
    {
      prompt: 'Write a CSS keyframe animation that makes a map marker bob gently.',
      output: '@keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }',
      use: 'I used the structure but rewrote the timing function and combined it with my existing rotate transform so the pin stayed angled. I rejected the AI-suggested infinite scaling because it felt distracting.',
      understand: 'I understand keyframes name a sequence of states, and the animation property binds duration, easing, iteration count, and direction. I chose ease-in-out so the bob feels physical, not mechanical.',
    },
    {
      prompt: 'How do I load a local JSON file into a vanilla JS site without a backend?',
      output: 'Use the Fetch API: fetch("./data.json").then(r => r.json()).then(data => ...).',
      use: 'I used fetch but switched to async/await for readability and added a try/catch so a missing file fails loudly instead of silently breaking my UI.',
      understand: 'I understand fetch returns a Promise that resolves to a Response, and .json() returns another Promise that parses the body. Without await I would have rendered before data arrived.',
    },
    {
      prompt: 'Suggest a color palette for an interactive map portfolio with a deep navy background.',
      output: 'A list of palettes including navy, beige roads, soft greens, and a coral accent.',
      use: 'I picked the navy + beige + green direction but chose my own coral and a warmer cream so it didn\'t look generic. I rejected the suggested neon yellow accent because it clashed with the calm map vibe.',
      understand: 'I understand why warm accents pop against a cool navy base — it\'s simultaneous contrast. I used the accent only on interactive things (markers, the car, CTA buttons) so the eye is guided to action.',
    },
  ];
  return `
    <p>
      I used AI tools like ChatGPT and GitHub Copilot during this build.
      Below are real examples of how I used them, what they gave me,
      and what I changed or rejected.
    </p>
    <div class="stack">
      ${examples.map((ex, i) => `
        <div class="note">
          <h4>Example ${i + 1}</h4>
          <p><strong>Prompt:</strong></p>
          <pre>${escapeHtml(ex.prompt)}</pre>
          <p><strong>What the AI returned:</strong></p>
          <pre>${escapeHtml(ex.output)}</pre>
          <p><strong>How I used / modified / rejected it:</strong> ${escapeHtml(ex.use)}</p>
          <p><strong>What I personally understand:</strong> ${escapeHtml(ex.understand)}</p>
        </div>
      `).join('')}
      <div class="note">
        <h4>Reflection on AI</h4>
        <p>
          AI was great for boilerplate, syntax reminders, and bouncing
          ideas around when I was stuck. It was bad at taste — every
          palette and layout suggestion needed serious editing, and it
          couldn't debug my actual code without me explaining the
          context. I treated it like a fast pair-programmer who's read
          every doc but hasn't seen my project, and that framing kept
          me in the driver's seat instead of just copy-pasting.
        </p>
      </div>
    </div>
  `;
}

function renderFeedback() {
  return `
    <p>
      During Demo Day my classmates drove around the map, tried each
      location, and gave me written feedback. Below is what I heard
      and what I changed before the final submission.
    </p>
    <div class="stack">
      <div class="note">
        <h4>Feedback received</h4>
        <p>People loved the car physics and the ambient sound, but a few classmates said the map markers weren't obviously clickable and that the mobile controls weren't discoverable on first load. One person pointed out the project cards had two equally-styled buttons, making it unclear which one to press first.</p>
      </div>
      <div class="note">
        <h4>Changes I made</h4>
        <p>I added a gentle bobbing animation to map markers so they read as interactive, made the mobile joystick visible by default instead of waiting for first touch, and gave the primary action on each project card a distinct accent color so the hierarchy reads immediately.</p>
      </div>
      <div class="note">
        <h4>Before / after</h4>
        <div class="proj__img" aria-label="Screenshot of project cards before peer feedback"></div>
        <p style="margin-top:8px;">Before — every button looked the same; nothing pulled the eye.</p>
        <div class="proj__img" aria-label="Screenshot of project cards after peer feedback" style="margin-top:12px;"></div>
        <p style="margin-top:8px;">After — one clear primary action per card, secondary actions stepped back.</p>
      </div>
      <div class="note">
        <h4>How feedback improved the site</h4>
        <p>Outside eyes caught things I'd gone blind to from staring at the build for weeks. Every fix from this round was something I would have called "obviously fine" the day before — which is exactly the value of running real demos before you ship.</p>
      </div>
    </div>
  `;
}

/* =============================================================
   UTILITIES
   ============================================================= */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
