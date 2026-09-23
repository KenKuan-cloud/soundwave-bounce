// Small shared helpers. No DOM or Three.js here (the tracer tests run in Node).

const DEG = Math.PI / 180;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Minimal pub/sub. Events used: 'scene' (anything that changes the acoustics),
// 'display' (view-only toggles), 'selection', 'items' (list membership/names).
function createBus() {
  const handlers = new Map();
  return {
    on(evt, fn) {
      if (!handlers.has(evt)) handlers.set(evt, []);
      handlers.get(evt).push(fn);
    },
    emit(evt, payload) {
      for (const fn of handlers.get(evt) || []) fn(payload);
    },
  };
}
const bus = createBus();

// Deterministic PRNG so a scene always traces to the same result.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Number with a real minus sign, and no "−0.00".
function fmt(v, dec = 2) {
  const s = Math.abs(v).toFixed(dec);
  return v < 0 && Number(s) !== 0 ? '−' + s : s;
}

const deepClone = (o) => JSON.parse(JSON.stringify(o));

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}
