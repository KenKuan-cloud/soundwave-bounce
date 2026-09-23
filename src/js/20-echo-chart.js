// ─────────────────────────────────────────────────────────────
// Echo (A-scan) chart: received level vs time for the active sensor,
// with the blanking window, threshold, detection and true distance.
// Also the small "distance history" chart.
// ─────────────────────────────────────────────────────────────

const CHART_DB_MIN = 0;
const CHART_DB_MAX = 120;

function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  return function prepare() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return null;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H };
  };
}

function chartColors() {
  return {
    text: cssVar('--text-muted'),
    faint: cssVar('--text-faint'),
    grid: cssVar('--border'),
    accent: cssVar('--accent'),
    bad: cssVar('--bad'),
    good: cssVar('--good'),
    source: cssVar('--source'),
    panel2: cssVar('--panel-2'),
    mono: cssVar('--mono'),
    font: cssVar('--font'),
  };
}

function createEchoChart(canvas, { onScrub } = {}) {
  const prepare = setupCanvas(canvas);
  let result = null;
  let timeMs = 0;
  const pad = { l: 44, r: 16, t: 24, b: 22 };
  let layout = null;

  function draw() {
    const p = prepare();
    if (!p) return;
    const { ctx, W, H } = p;
    const col = chartColors();
    const tMax = result ? result.tMax : 40;
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const x = (t) => pad.l + (t / tMax) * pw;
    const y = (db) => pad.t + ph - (clamp(db, CHART_DB_MIN, CHART_DB_MAX) - CHART_DB_MIN) / (CHART_DB_MAX - CHART_DB_MIN) * ph;
    layout = { x0: pad.l, pw, tMax };

    ctx.font = '10.5px ' + col.mono;
    ctx.lineWidth = 1;

    if (result) {
      // Blanking window and the part beyond max range.
      ctx.fillStyle = col.panel2;
      ctx.fillRect(x(0), pad.t, x(result.blanking) - x(0), ph);
      if (result.tWindow < tMax) ctx.fillRect(x(result.tWindow), pad.t, x(tMax) - x(result.tWindow), ph);
    }

    // Grid, time axis (bottom) and the distance the sensor would report (top).
    const tStep = tMax > 60 ? 10 : 5;
    ctx.strokeStyle = col.grid;
    ctx.fillStyle = col.faint;
    ctx.textAlign = 'center';
    for (let t = 0; t <= tMax + 1e-9; t += tStep) {
      const gx = Math.round(x(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, pad.t + ph);
      ctx.stroke();
      ctx.fillText(`${t}`, x(t), H - 7);
      ctx.fillText(`${fmt(C_ASSUMED * t / 2000, 1)} m`, x(t), 14);
    }
    ctx.textAlign = 'right';
    for (let db = CHART_DB_MIN; db <= CHART_DB_MAX; db += 20) {
      const gy = Math.round(y(db)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(pad.l + pw, gy);
      ctx.stroke();
      ctx.fillText(`${db}`, pad.l - 6, gy + 3);
    }
    ctx.textAlign = 'left';
    ctx.fillText('ms', 4, H - 7);
    ctx.fillText('dB', 4, pad.t + 3);

    if (!result) {
      ctx.fillStyle = col.text;
      ctx.textAlign = 'center';
      ctx.font = '12px ' + col.font;
      ctx.fillText('Add a sensor to see its echoes', pad.l + pw / 2, pad.t + ph / 2);
      return;
    }

    // Own echoes (+ noise): peak per pixel column so short echoes aren't lost.
    const { echoDb: totalDb, nBins } = result;
    const cols = Math.max(1, Math.floor(pw));
    ctx.beginPath();
    ctx.moveTo(x(0), y(CHART_DB_MIN));
    for (let c = 0; c <= cols; c++) {
      const b0 = Math.floor((c / cols) * (nBins - 1));
      const b1 = Math.max(b0, Math.floor(((c + 1) / cols) * (nBins - 1)));
      let m = -Infinity;
      for (let b = b0; b <= b1; b++) if (totalDb[b] > m) m = totalDb[b];
      ctx.lineTo(pad.l + c, y(m));
    }
    ctx.lineTo(pad.l + cols, y(CHART_DB_MIN));
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = col.accent;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col.accent;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.lineWidth = 1;

    // Interference from other emitters, where it rises above the noise.
    const { interfDb } = result;
    if (result.interferers.some((it) => it.trace)) {
      const floor = AMBIENT_NOISE_DB + 3;
      ctx.beginPath();
      let pen = false;
      for (let c = 0; c <= cols; c++) {
        const b0 = Math.floor((c / cols) * (nBins - 1));
        const b1 = Math.max(b0, Math.floor(((c + 1) / cols) * (nBins - 1)));
        let m = -Infinity;
        for (let b = b0; b <= b1; b++) if (interfDb[b] > m) m = interfDb[b];
        if (m > floor) {
          if (!pen) { ctx.moveTo(pad.l + c, y(floor)); pen = true; }
          ctx.lineTo(pad.l + c, y(m));
        } else if (pen) {
          ctx.lineTo(pad.l + c, y(floor));
          pen = false;
        }
      }
      ctx.strokeStyle = col.source;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Threshold
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = col.bad;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x(result.blanking), y(result.threshold));
    ctx.lineTo(x(result.tWindow), y(result.threshold));
    ctx.stroke();

    // True distance (round trip at the real speed of sound)
    if (result.trueDistance != null) {
      const tt = 2 * result.trueDistance / result.c * 1000;
      if (tt <= tMax) {
        ctx.strokeStyle = col.good;
        ctx.beginPath();
        ctx.moveTo(Math.round(x(tt)) + 0.5, pad.t);
        ctx.lineTo(Math.round(x(tt)) + 0.5, pad.t + ph);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Detection marker
    const det = result.detection;
    if (det) {
      const dx = x(det.tMs);
      const dy = y(result.threshold);
      ctx.fillStyle = col.bad;
      ctx.beginPath();
      ctx.moveTo(dx, dy - 2);
      ctx.lineTo(dx - 5, dy - 10);
      ctx.lineTo(dx + 5, dy - 10);
      ctx.closePath();
      ctx.fill();
      ctx.font = '600 11px ' + col.font;
      const text = `${det.interference ? 'False echo' : 'Detected'} ${fmt(det.distance, 2)} m`;
      const tw = ctx.measureText(text).width;
      ctx.fillText(text, dx + 8 + tw > pad.l + pw ? dx - 8 - tw : dx + 8, dy - 4);
    }

    // Playhead
    ctx.strokeStyle = col.text;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(timeMs)) + 0.5, pad.t);
    ctx.lineTo(Math.round(x(timeMs)) + 0.5, pad.t + ph);
    ctx.stroke();

    ctx.fillStyle = col.faint;
    ctx.font = '10.5px ' + col.font;
    ctx.save();
    ctx.translate(x(result.blanking) - 4, pad.t + ph - 4);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('blanking', 0, 0);
    ctx.restore();
  }

  // Click / drag on the chart to scrub time.
  function scrub(e) {
    if (!layout || !onScrub) return;
    const rect = canvas.getBoundingClientRect();
    const t = ((e.clientX - rect.left) - layout.x0) / layout.pw * layout.tMax;
    onScrub(clamp(t, 0, layout.tMax));
  }
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); scrub(e); });
  canvas.addEventListener('pointermove', (e) => { if (e.buttons & 1) scrub(e); });

  new ResizeObserver(draw).observe(canvas);
  draw();
  return {
    draw,
    setResult(r) { result = r; draw(); },
    setTime(t) { timeMs = t; draw(); },
  };
}

function createHistoryChart(canvas) {
  const prepare = setupCanvas(canvas);
  const MAX = 60;
  let entries = []; // { measured: number|null, truth: number|null }

  function draw() {
    const p = prepare();
    if (!p) return;
    const { ctx, W, H } = p;
    const col = chartColors();
    const pad = { l: 44, r: 16, t: 14, b: 22 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;

    const values = entries.flatMap((e) => [e.measured, e.truth]).filter((v) => v != null);
    const hi = Math.max(1, Math.ceil(Math.max(0, ...values) + 0.5));
    const x = (i) => pad.l + (i / (MAX - 1)) * pw;
    const y = (v) => pad.t + ph - (v / hi) * ph;

    ctx.font = '10.5px ' + col.mono;
    ctx.strokeStyle = col.grid;
    ctx.fillStyle = col.faint;
    ctx.textAlign = 'right';
    const step = hi > 10 ? 2 : hi > 4 ? 1 : 0.5;
    for (let v = 0; v <= hi + 1e-9; v += step) {
      const gy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(pad.l, gy);
      ctx.lineTo(pad.l + pw, gy);
      ctx.stroke();
      ctx.fillText(fmt(v, step < 1 ? 1 : 0), pad.l - 6, gy + 3);
    }
    ctx.textAlign = 'left';
    ctx.fillText('m', 4, pad.t + 3);
    ctx.fillText('pings →', pad.l, H - 7);

    if (!entries.length) {
      ctx.fillStyle = col.text;
      ctx.textAlign = 'center';
      ctx.font = '12px ' + col.font;
      ctx.fillText('Each finished ping adds a point. Turn on Loop and move things around.', pad.l + pw / 2, pad.t + ph / 2);
      return;
    }

    const line = (key, color, dashed) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dashed ? [5, 4] : []);
      ctx.beginPath();
      let pen = false;
      entries.forEach((e, i) => {
        const v = e[key];
        if (v == null) { pen = false; return; }
        if (pen) ctx.lineTo(x(i), y(v)); else ctx.moveTo(x(i), y(v));
        pen = true;
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line('truth', col.good, true);
    line('measured', col.accent, false);
    entries.forEach((e, i) => {
      if (e.measured == null) {
        // No echo: red tick on the axis.
        ctx.fillStyle = col.bad;
        ctx.fillRect(x(i) - 2, pad.t + ph - 6, 4, 6);
      } else {
        ctx.fillStyle = col.accent;
        ctx.beginPath();
        ctx.arc(x(i), y(e.measured), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  new ResizeObserver(draw).observe(canvas);
  draw();
  return {
    draw,
    push(entry) { entries.push(entry); if (entries.length > MAX) entries = entries.slice(-MAX); draw(); },
    clear() { entries = []; draw(); },
  };
}
