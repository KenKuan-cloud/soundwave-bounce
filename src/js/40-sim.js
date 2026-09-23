// ─────────────────────────────────────────────────────────────
// Simulation controller: re-traces when the scene changes, runs the
// playback clock, and fills the readouts, ray log and status bar.
// ─────────────────────────────────────────────────────────────

function createSim({ viewport, echoChart, historyChart }) {
  const $ = (sel) => document.querySelector(sel);
  let result = null;
  let t = 0;
  let playing = false;
  let loop = false;
  let speed = 0.005; // simulated ms per real ms
  let lastTraceAt = 0;
  let pending = null;

  const timeline = $('#timeline');
  const playBtn = $('#btn-play');

  // ── Tracing ──
  function retrace() {
    pending = null;
    const s = store.activeSensor();
    result = s ? traceSensor(store.state, s) : null;
    lastTraceAt = performance.now();
    viewport.setResult(result);
    echoChart.setResult(result);
    const tMax = result ? result.tMax : 40;
    timeline.max = String(tMax);
    $('#tl-max').textContent = `${tMax} ms`;
    if (t > tMax) t = tMax;
    setTime(t);
    updateReadouts();
    updateLog();
    updateStatus();
  }

  // Re-trace soon after a change, but not more often than the trace allows,
  // so dragging stays smooth even with many rays.
  function schedule() {
    if (pending) return;
    const cost = result ? result.traceMs : 30;
    const wait = Math.max(0, Math.max(50, cost * 2) - (performance.now() - lastTraceAt));
    pending = setTimeout(retrace, wait);
  }
  bus.on('scene', schedule);
  let lastActive = null;
  bus.on('selection', () => {
    const id = store.activeSensor()?.id ?? null;
    if (id !== lastActive) { lastActive = id; schedule(); }
  });

  // ── Clock ──
  function setTime(v) {
    t = v;
    viewport.setTime(t);
    echoChart.setTime(t);
    timeline.value = String(t);
    const c = result ? result.c : speedOfSound(store.state.env.temperature);
    $('#vp-t').textContent = fmt(t, 2);
    $('#vp-dist').textContent = `pulse travelled ${fmt(c * t / 1000, 2)} m`;
  }

  function setPlaying(on) {
    playing = on;
    playBtn.classList.toggle('is-playing', on);
    playBtn.querySelector('span').textContent = on ? 'Pause' : 'Ping';
    playBtn.title = on ? 'Pause (Space)' : 'Fire a ping (Space)';
  }

  function pingFinished() {
    if (!result) return;
    historyChart.push({ measured: result.detection ? result.detection.distance : null, truth: result.trueDistance });
  }

  let lastFrame = performance.now();
  function frame(now) {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    if (playing && result) {
      let next = t + dt * speed;
      if (next >= result.tMax) {
        pingFinished();
        if (loop) next = 0;
        else { next = result.tMax; setPlaying(false); }
      }
      setTime(next);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  timeline.addEventListener('input', () => {
    setPlaying(false);
    setTime(Number(timeline.value));
  });

  // ── Readouts ──
  function setReadout(id, text, cls) {
    const el = $(id);
    el.textContent = '';
    if (text == null) { el.textContent = '—'; el.className = 'readout-value mono'; return; }
    el.append(text);
    const unit = document.createElement('small');
    unit.textContent = ' m';
    el.append(unit);
    el.className = `readout-value mono${cls ? ' ' + cls : ''}`;
  }

  function updateReadouts() {
    const status = $('#ro-status');
    const msg = $('#ro-status-msg');
    const s = store.activeSensor();
    if (!result || !s) {
      setReadout('#ro-true', null);
      setReadout('#ro-measured', null);
      setReadout('#ro-error', null);
      status.textContent = 'No sensor';
      status.className = 'status-pill status-warn';
      msg.textContent = 'Add a sensor from the left panel.';
      return;
    }
    const truth = result.trueDistance;
    const det = result.detection;
    setReadout('#ro-true', truth == null ? null : fmt(truth, 2));
    $('#ro-true').title = truth == null ? 'Nothing straight ahead' : `Straight ahead: ${result.trueTarget}`;

    if (!det) {
      setReadout('#ro-measured', null);
      setReadout('#ro-error', null);
      status.textContent = 'No echo';
      status.className = 'status-pill status-bad';
      msg.textContent = `Nothing crossed ${s.threshold} dB SPL within ${fmt(s.maxRange, 1)} m.`;
      return;
    }

    const measured = det.distance;
    const source = det.label ? det.label : 'an unknown path';
    if (truth == null) {
      setReadout('#ro-measured', fmt(measured, 2), 'is-warn');
      setReadout('#ro-error', null);
      status.textContent = 'Echo, nothing ahead';
      status.className = 'status-pill status-warn';
      msg.textContent = `Echo from ${source}.`;
      return;
    }
    const err = measured - truth;
    const ok = Math.abs(err) <= Math.max(0.03, 0.02 * truth);
    setReadout('#ro-measured', fmt(measured, 2), ok ? 'is-good' : 'is-warn');
    setReadout('#ro-error', (err > 0 ? '+' : '') + fmt(err, 2), ok ? '' : 'is-bad');
    status.textContent = ok ? 'OK' : 'Off target';
    status.className = `status-pill ${ok ? 'status-good' : 'status-warn'}`;
    if (ok) msg.textContent = `Echo from ${source}.`;
    else if (det.label === result.trueTarget) msg.textContent = `Echo from ${source}, but from a point off the beam axis that faces the sensor.`;
    else msg.textContent = `First echo came from ${source}.`;
  }

  // ── Ray log ──
  function updateLog() {
    const body = $('#ray-log-body');
    body.replaceChildren();
    if (!result) return;
    const det = result.detection;
    const rows = result.groups.slice(0, 30); // strongest first
    if (!rows.length) {
      const tr = body.insertRow();
      const td = tr.insertCell();
      td.colSpan = 4;
      td.className = 'muted';
      td.textContent = 'No echoes reached the sensor.';
      return;
    }
    for (const g of rows) {
      const tr = body.insertRow();
      if (det && g.label === det.label && Math.abs(g.tPeak - det.tMs) < 0.5) tr.className = 'is-detected';
      else if (g.levelDb < result.threshold) tr.className = 'is-below';
      const cells = [
        [`${fmt(g.tPeak, 2)} ms`, 'mono'],
        [`${fmt(C_ASSUMED * g.tPeak / 2000, 2)} m`, 'mono'],
        [`${fmt(g.levelDb, 1)} dB`, 'mono'],
        [g.label, 'path'],
      ];
      for (const [text, cls] of cells) {
        const td = tr.insertCell();
        td.textContent = text;
        td.className = cls;
      }
    }
  }

  function updateStatus() {
    const s = store.activeSensor();
    const c = speedOfSound(store.state.env.temperature);
    $('#sb-sensor').textContent = s ? `${s.name} · ${fmt(s.freq, s.freq % 1 ? 1 : 0)} kHz` : 'No sensor';
    $('#sb-rays').textContent = `${store.state.sim.rays.toLocaleString()} rays · ≤ ${store.state.sim.maxBounces} bounces`;
    $('#sb-c').textContent = `c = ${fmt(c, 1)} m/s`;
    $('#sb-lambda').textContent = s ? `λ = ${fmt(c / (s.freq * 1000) * 1000, 2)} mm` : '';
    $('#sb-trace').textContent = result ? `trace ${Math.round(result.traceMs)} ms` : '';
    $('#trace-info').textContent = result
      ? `${result.rays.toLocaleString()} rays in ${Math.round(result.traceMs)} ms, ${result.groups.length} echo paths`
      : '—';
  }

  return {
    retrace,
    togglePlay() {
      if (!result) return;
      if (!playing && t >= result.tMax) setTime(0);
      setPlaying(!playing);
    },
    reset() { setPlaying(false); setTime(0); },
    step(dir) {
      setPlaying(false);
      const tMax = result ? result.tMax : 40;
      setTime(clamp(t + dir * tMax / 100, 0, tMax));
    },
    scrub(v) { setPlaying(false); setTime(v); },
    setSpeed(v) { speed = v; },
    setLoop(v) { loop = v; },
    clearHistory() { historyChart.clear(); },
  };
}
