// ─────────────────────────────────────────────────────────────
// Echo (A-scan) chart — UI preview with mock data.
// Shows received envelope vs. time, the blanking window, the
// detection threshold and where the sensor "decided" it saw an echo.
// ─────────────────────────────────────────────────────────────

const MOCK = {
  tMax: 40,            // ms
  c: 343.4,            // m/s, for the distance axis
  blanking: 1.2,       // ms
  threshold: 0.34,     // normalised amplitude
  playhead: 14.62,     // ms
  detectedAt: 11.3,    // ms (the false echo)
  // Gaussian envelope peaks: [centre ms, width ms, amplitude, kind]
  peaks: [
    [0.35, 0.45, 1.0, 'tx'],          // transmit burst / ring-down
    [11.3, 0.22, 0.52, 'interf'],     // neighbour sensor, 57 kHz
    [24.9, 0.35, 0.14, 'echo'],       // block (diffuse, weak)
    [28.36, 0.28, 0.61, 'echo'],      // wall, direct echo (4.87 m)
    [33.2, 0.4, 0.2, 'echo'],         // wall → floor multipath
    [36.4, 0.3, 0.12, 'interf'],      // air leak hiss burst
  ],
};

function createEchoChart(canvas) {
  const ctx = canvas.getContext('2d');

  // Deterministic noise floor so the preview looks the same every load.
  const noise = [];
  let seed = 11;
  for (let i = 0; i < 800; i++) {
    seed = (seed * 16807) % 2147483647;
    noise.push(seed / 2147483647);
  }

  function envelope(t, kinds) {
    let v = 0;
    for (const [c, w, a, k] of MOCK.peaks) {
      if (!kinds.includes(k)) continue;
      v += a * Math.exp(-((t - c) ** 2) / (2 * w * w));
    }
    return v;
  }

  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const col = {
      text: cssVar('--text-muted'),
      faint: cssVar('--text-faint'),
      grid: cssVar('--border'),
      accent: cssVar('--accent'),
      source: cssVar('--source'),
      bad: cssVar('--bad'),
      panel2: cssVar('--panel-2'),
    };

    const pad = { l: 40, r: 24, t: 24, b: 24 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const x = (t) => pad.l + (t / MOCK.tMax) * pw;
    const y = (a) => pad.t + ph - Math.min(a, 1.05) / 1.05 * ph;

    ctx.font = '10.5px ' + cssVar('--mono');

    // Blanking window
    ctx.fillStyle = col.panel2;
    ctx.fillRect(x(0), pad.t, x(MOCK.blanking) - x(0), ph);

    // Grid + time axis
    ctx.strokeStyle = col.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = col.faint;
    ctx.textAlign = 'center';
    for (let t = 0; t <= MOCK.tMax; t += 5) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x(t)) + 0.5, pad.t);
      ctx.lineTo(Math.round(x(t)) + 0.5, pad.t + ph);
      ctx.stroke();
      ctx.fillText(`${t}`, x(t), H - 8);
      // Distance axis on top: one-way distance = c·t/2
      const d = (MOCK.c * t / 1000 / 2).toFixed(1);
      ctx.fillText(`${d} m`, x(t), 14);
    }
    ctx.textAlign = 'right';
    for (const a of [0, 0.5, 1]) {
      ctx.beginPath();
      ctx.moveTo(pad.l, Math.round(y(a)) + 0.5);
      ctx.lineTo(pad.l + pw, Math.round(y(a)) + 0.5);
      ctx.stroke();
      ctx.fillText(a.toFixed(1), pad.l - 6, y(a) + 3);
    }
    ctx.textAlign = 'left';
    ctx.fillText('ms', 6, H - 8);

    // Filled traces: echoes (incl. transmit) and interference
    const N = Math.max(200, Math.floor(pw));
    const trace = (kinds, color, withNoise) => {
      ctx.beginPath();
      ctx.moveTo(x(0), y(0));
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * MOCK.tMax;
        const n = withNoise ? noise[i % noise.length] * 0.035 : 0;
        ctx.lineTo(x(t), y(envelope(t, kinds) + n));
      }
      ctx.lineTo(x(MOCK.tMax), y(0));
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    trace(['tx', 'echo'], col.accent, true);
    trace(['interf'], col.source, false);

    // Threshold
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = col.bad;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x(MOCK.blanking), y(MOCK.threshold));
    ctx.lineTo(pad.l + pw, y(MOCK.threshold));
    ctx.stroke();
    ctx.setLineDash([]);

    // Detection marker
    const dx = x(MOCK.detectedAt);
    ctx.fillStyle = col.bad;
    ctx.beginPath();
    ctx.moveTo(dx, y(MOCK.threshold) - 2);
    ctx.lineTo(dx - 5, y(MOCK.threshold) - 10);
    ctx.lineTo(dx + 5, y(MOCK.threshold) - 10);
    ctx.closePath();
    ctx.fill();
    ctx.font = '600 11px ' + cssVar('--font');
    ctx.fillText('Detected', dx + 8, y(MOCK.threshold) - 4);

    // Playhead
    ctx.strokeStyle = col.text;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(MOCK.playhead)) + 0.5, pad.t);
    ctx.lineTo(Math.round(x(MOCK.playhead)) + 0.5, pad.t + ph);
    ctx.stroke();

    ctx.fillStyle = col.faint;
    ctx.font = '10.5px ' + cssVar('--font');
    ctx.save();
    ctx.translate(x(MOCK.blanking) - 4, pad.t + ph - 4);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('blanking', 0, 0);
    ctx.restore();
  }

  new ResizeObserver(draw).observe(canvas);
  draw();
  return { draw };
}
