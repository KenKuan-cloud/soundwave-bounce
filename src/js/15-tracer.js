// ─────────────────────────────────────────────────────────────
// Acoustic ray tracer (geometric acoustics).
//
// At 40–60 kHz the wavelength is a few millimetres, much smaller than the
// objects, so sound can be treated like light:
//   • Rays leave the transducer over its beam (piston directivity), spaced
//     evenly in solid angle.
//   • At each surface: energy × (1 − absorption); a fraction `scattering`
//     is re-radiated diffusely (Lambert), the rest reflects like a mirror.
//   • Air absorbs energy along the path (ISO 9613-1).
//   • Each ray is a thin Gaussian beam. Its width grows with distance and
//     faster after bouncing off curved surfaces (pipes, spheres), so specular
//     echoes stay accurate even with few rays hitting a small, curved target.
//   • Diffuse returns use "diffuse rain": every hit sends its scattered share
//     straight to the receiver if nothing blocks it.
//   • The direct echo off a pipe or sphere is computed exactly (curved-mirror
//     formula at the specular point) instead of by sampling, because a thin
//     curved target catches too few rays for a stable estimate.
// No DOM or Three.js in here.
// ─────────────────────────────────────────────────────────────

const TRACE_EPS = 1e-6;
const SURFACE_OFFSET = 1e-5;

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Rotation matrix columns (local X, Y, Z axes in world) for Euler XYZ in degrees,
// same convention as three.js Object3D.rotation.
function eulerXYZAxes(rx, ry, rz) {
  const a = Math.cos(rx * DEG), b = Math.sin(rx * DEG);
  const c = Math.cos(ry * DEG), d = Math.sin(ry * DEG);
  const e = Math.cos(rz * DEG), f = Math.sin(rz * DEG);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  return [
    [c * e, af + be * d, bf - ae * d],
    [-c * f, ae - bf * d, be + af * d],
    [d, -b * c, a * c],
  ];
}

// Sensor/source aim: yaw about +Y, then pitch up. yaw = pitch = 0 looks along +X.
function aimVector(yawDeg, pitchDeg) {
  const y = yawDeg * DEG, p = pitchDeg * DEG;
  return [Math.cos(p) * Math.cos(y), Math.sin(p), -Math.cos(p) * Math.sin(y)];
}

function orthoBasis(n) {
  const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [n[1] * helper[2] - n[2] * helper[1], n[2] * helper[0] - n[0] * helper[2], n[0] * helper[1] - n[1] * helper[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return [u, v];
}

// ── Scene → primitives ──
function buildPrimitives(state) {
  const prims = [];
  const room = state.env.room;
  const surf = (it) => ({ id: it.id, name: it.name, absorption: it.absorption, scattering: it.scattering });
  const P = (p) => [p.x, p.y, p.z];

  for (const it of state.items) {
    if (!it.visible) continue;
    switch (it.type) {
      case 'floor':
        prims.push({ ...surf(it), kind: 'rect', p: [0, 0, 0], n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], hu: room.w / 2, hv: room.d / 2 });
        break;
      case 'wall':
      case 'block':
        prims.push({ ...surf(it), kind: 'box', c: P(it.pos), R: eulerXYZAxes(it.rot.x, it.rot.y, it.rot.z), h: [it.size.x / 2, it.size.y / 2, it.size.z / 2] });
        break;
      case 'pipe':
        prims.push({ ...surf(it), kind: 'cyl', c: P(it.pos), R: eulerXYZAxes(it.rot.x, it.rot.y, it.rot.z), r: it.radius, hl: it.length / 2 });
        break;
      case 'sphere':
        prims.push({ ...surf(it), kind: 'sph', c: P(it.pos), r: it.radius });
        break;
    }
  }

  if (room.enclosed) {
    const m = MATERIALS.concrete;
    const s = (id, name) => ({ id, name, absorption: m.absorption, scattering: m.scattering });
    const { w, h, d } = room;
    prims.push({ ...s('room-xp', 'Room wall +X'), kind: 'rect', p: [w / 2, h / 2, 0], n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], hu: h / 2, hv: d / 2 });
    prims.push({ ...s('room-xn', 'Room wall −X'), kind: 'rect', p: [-w / 2, h / 2, 0], n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], hu: h / 2, hv: d / 2 });
    prims.push({ ...s('room-zp', 'Room wall +Z'), kind: 'rect', p: [0, h / 2, d / 2], n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], hu: w / 2, hv: h / 2 });
    prims.push({ ...s('room-zn', 'Room wall −Z'), kind: 'rect', p: [0, h / 2, -d / 2], n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], hu: w / 2, hv: h / 2 });
    prims.push({ ...s('room-ceil', 'Ceiling'), kind: 'rect', p: [0, h, 0], n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], hu: w / 2, hv: d / 2 });
  }
  return prims;
}

// ── Intersection ──
// Each returns the hit distance (< tBest) or Infinity and writes the surface
// normal (world space, not yet facing the ray) into NT.
const NT = [0, 0, 0];
let CURVED = 0; // curvature (1/m) of the last reported hit; 0 = flat

function hitBox(pr, o, d, tBest) {
  const R = pr.R;
  const lo = [0, 0, 0], ld = [0, 0, 0];
  const w = [o[0] - pr.c[0], o[1] - pr.c[1], o[2] - pr.c[2]];
  for (let i = 0; i < 3; i++) { lo[i] = dot3(w, R[i]); ld[i] = dot3(d, R[i]); }
  let tmin = -Infinity, tmax = Infinity, amin = -1, amax = -1, smin = 0, smax = 0;
  for (let i = 0; i < 3; i++) {
    const h = pr.h[i];
    if (Math.abs(ld[i]) < 1e-12) {
      if (Math.abs(lo[i]) > h) return Infinity;
      continue;
    }
    let t1 = (-h - lo[i]) / ld[i];
    let t2 = (h - lo[i]) / ld[i];
    let s1 = -1, s2 = 1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; [s1, s2] = [s2, s1]; }
    if (t1 > tmin) { tmin = t1; amin = i; smin = s1; }
    if (t2 < tmax) { tmax = t2; amax = i; smax = s2; }
    if (tmin > tmax) return Infinity;
  }
  let t, a, s;
  if (tmin > TRACE_EPS) { t = tmin; a = amin; s = smin; } else if (tmax > TRACE_EPS) { t = tmax; a = amax; s = smax; } else return Infinity;
  if (t >= tBest || a < 0) return Infinity;
  NT[0] = R[a][0] * s; NT[1] = R[a][1] * s; NT[2] = R[a][2] * s;
  CURVED = 0;
  return t;
}

function hitCylinder(pr, o, d, tBest) {
  const R = pr.R;
  const w = [o[0] - pr.c[0], o[1] - pr.c[1], o[2] - pr.c[2]];
  const ox = dot3(w, R[0]), oy = dot3(w, R[1]), oz = dot3(w, R[2]);
  const dx = dot3(d, R[0]), dy = dot3(d, R[1]), dz = dot3(d, R[2]);
  const r = pr.r, hl = pr.hl;
  let best = tBest, nx = 0, ny = 0, nz = 0, found = false, curved = 0;

  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = ox * dx + oz * dz;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / a, (-b + sq) / a]) {
        if (t > TRACE_EPS && t < best && Math.abs(oy + t * dy) <= hl) {
          best = t; nx = (ox + t * dx) / r; ny = 0; nz = (oz + t * dz) / r; found = true; curved = 1 / r;
          break;
        }
      }
    }
  }
  if (Math.abs(dy) > 1e-12) {
    for (const sgn of [-1, 1]) {
      const t = (sgn * hl - oy) / dy;
      if (t > TRACE_EPS && t < best) {
        const x = ox + t * dx, z = oz + t * dz;
        if (x * x + z * z <= r * r) { best = t; nx = 0; ny = sgn; nz = 0; found = true; curved = 0; }
      }
    }
  }
  if (!found) return Infinity;
  for (let i = 0; i < 3; i++) NT[i] = R[0][i] * nx + R[1][i] * ny + R[2][i] * nz;
  CURVED = curved;
  return best;
}

function hitSphere(pr, o, d, tBest) {
  const w = [o[0] - pr.c[0], o[1] - pr.c[1], o[2] - pr.c[2]];
  const b = dot3(w, d);
  const c = dot3(w, w) - pr.r * pr.r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t <= TRACE_EPS) t = -b + sq;
  if (t <= TRACE_EPS || t >= tBest) return Infinity;
  for (let i = 0; i < 3; i++) NT[i] = (w[i] + t * d[i]) / pr.r;
  CURVED = 1 / pr.r;
  return t;
}

function hitRect(pr, o, d, tBest) {
  const denom = dot3(d, pr.n);
  if (Math.abs(denom) < 1e-12) return Infinity;
  const t = ((pr.p[0] - o[0]) * pr.n[0] + (pr.p[1] - o[1]) * pr.n[1] + (pr.p[2] - o[2]) * pr.n[2]) / denom;
  if (t <= TRACE_EPS || t >= tBest) return Infinity;
  const q = [o[0] + t * d[0] - pr.p[0], o[1] + t * d[1] - pr.p[1], o[2] + t * d[2] - pr.p[2]];
  if (Math.abs(dot3(q, pr.u)) > pr.hu || Math.abs(dot3(q, pr.v)) > pr.hv) return Infinity;
  NT[0] = pr.n[0]; NT[1] = pr.n[1]; NT[2] = pr.n[2];
  CURVED = 0;
  return t;
}

const HIT_FN = { box: hitBox, cyl: hitCylinder, sph: hitSphere, rect: hitRect };

// Nearest hit along the ray, or null. Result object is reused between calls.
const HIT = { t: 0, n: [0, 0, 0], prim: null, curvature: 0 };
function nearestHit(prims, o, d, tMax) {
  let best = tMax, prim = null;
  for (const pr of prims) {
    const t = HIT_FN[pr.kind](pr, o, d, best);
    if (t < best) {
      best = t; prim = pr;
      HIT.n[0] = NT[0]; HIT.n[1] = NT[1]; HIT.n[2] = NT[2];
      HIT.curvature = CURVED;
    }
  }
  if (!prim) return null;
  HIT.t = best; HIT.prim = prim;
  return HIT;
}

function occluded(prims, o, d, dist) {
  const limit = dist - 1e-4;
  for (const pr of prims) if (HIT_FN[pr.kind](pr, o, d, limit) < limit) return true;
  return false;
}

// ── Main trace ──
function traceSensor(state, sensor, prims = buildPrimitives(state)) {
  const started = (typeof performance !== 'undefined' ? performance : Date).now();
  const { env, sim } = state;

  const fHz = sensor.freq * 1000;
  const c = speedOfSound(env.temperature);
  const alphaDb = airAbsorptionDbPerM(fHz, env.temperature, env.humidity, env.pressure);
  const alphaNp = alphaDb * Math.LN10 / 10; // power: 10^(−αL/10) = e^(−αNp·L)
  const tWindow = 2 * sensor.maxRange / c * 1000; // ms, round trip at max range
  const tMax = Math.max(5, Math.ceil((tWindow + 2) / 5) * 5);
  const Lmax = c * tMax / 1000;

  const dtMs = 0.005;
  const nBins = Math.ceil(tMax / dtMs) + 1;
  const power = new Float64Array(nBins);
  const binTopI = new Float64Array(nBins);
  const binTopLabel = new Array(nBins);

  const ka = pistonKa(sensor.halfAngle);
  const thMax = pistonMaxAngle(ka);
  const fwd = aimVector(sensor.yaw, sensor.pitch);
  const [bu, bv] = orthoBasis(fwd);
  const rx = [sensor.pos.x, sensor.pos.y, sensor.pos.z];

  const N = Math.max(1, Math.round(sim.rays));
  const cosMax = Math.cos(thMax);
  const dOmega = 2 * Math.PI * (1 - cosMax) / N;
  // Gaussian beam width per metre. The footprint-equivalent width is
  // sqrt(dΩ/2π); widening it smooths the estimate (the energy stays the same).
  const BEAM_SMOOTHING = 2;
  const beamSigma0 = BEAM_SMOOTHING * Math.sqrt(dOmega / (2 * Math.PI));
  const cutoff = Math.pow(10, sim.cutoffDb / 10);
  const vizStride = Math.max(1, Math.ceil(N / Math.max(1, sim.particles)));
  const rng = mulberry32(1234567);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  const viz = [];
  const groups = new Map();
  const top = [];
  const TOP_N = 120;

  // Receive gain for sound arriving from direction `from` (unit vector from the
  // receiver towards where the sound comes from).
  const rxGain = (fx, fy, fz) => {
    const cosT = fx * fwd[0] + fy * fwd[1] + fz * fwd[2];
    if (cosT <= 0) return 0;
    return pistonPower(ka, Math.acos(Math.min(1, cosT)));
  };

  function addArrival(L, I, sig, label, bounces, diffuse, pts) {
    const tMs = L / c * 1000;
    if (tMs >= tMax || !(I > 0)) return;
    const b = Math.round(tMs / dtMs);
    power[b] += I;
    if (I > binTopI[b]) { binTopI[b] = I; binTopLabel[b] = label; }
    let g = groups.get(sig);
    if (!g) {
      g = { sig, label, bounces, diffuse, power: 0, maxI: 0, tPeak: 0, tFirst: Infinity };
      groups.set(sig, g);
    }
    g.power += I;
    if (I > g.maxI) { g.maxI = I; g.tPeak = tMs; }
    if (tMs < g.tFirst) g.tFirst = tMs;
    if (top.length < TOP_N || I > top[top.length - 1].I) {
      const entry = { I, tMs, label, diffuse, pts: pts.concat(rx) };
      let k = top.length;
      while (k > 0 && top[k - 1].I < I) k--;
      top.splice(k, 0, entry);
      if (top.length > TOP_N) top.pop();
    }
  }

  const o = [0, 0, 0], d = [0, 0, 0], q = [0, 0, 0], n = [0, 0, 0];

  for (let i = 0; i < N; i++) {
    const cosT = 1 - (i + 0.5) / N * (1 - cosMax);
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const phi = i * GOLDEN;
    const cp = Math.cos(phi) * sinT, sp = Math.sin(phi) * sinT;
    for (let k = 0; k < 3; k++) d[k] = fwd[k] * cosT + bu[k] * cp + bv[k] * sp;

    const dirPow = pistonPower(ka, Math.acos(cosT));
    if (dirPow < cutoff) continue;

    let E = dirPow * dOmega; // ray power, re. on-axis intensity at 1 m
    let rel = dirPow;        // same without the solid-angle factor (for display)
    let L = 0;
    let bounces = 0;
    let diffuse = false; // after a diffuse bounce, only diffuse rain reaches the receiver
    // Beam footprint: half-widths (wA, wB) growing at rates (gA, gB) per metre,
    // along axes ea and eb = d × ea (both perpendicular to the ray).
    let wA = 0, wB = 0, gA = beamSigma0, gB = beamSigma0;
    let ea = [bu[0] * -sp + bv[0] * cp, bu[1] * -sp + bv[1] * cp, bu[2] * -sp + bv[2] * cp];
    {
      // Make ea exactly perpendicular to d.
      const k = dot3(ea, d);
      ea = [ea[0] - k * d[0], ea[1] - k * d[1], ea[2] - k * d[2]];
      const l = Math.hypot(ea[0], ea[1], ea[2]);
      ea = l > 1e-9 ? [ea[0] / l, ea[1] / l, ea[2] / l] : orthoBasis(d)[0];
    }
    let sig = '';
    let label = '';
    let curvedFirst = false; // first bounce off a pipe/sphere side: handled analytically
    o[0] = rx[0]; o[1] = rx[1]; o[2] = rx[2];

    const keepViz = i % vizStride === 0;
    const pts = [o[0], o[1], o[2]];
    const cum = [0];
    const segRel = [];

    for (;;) {
      const hit = nearestHit(prims, o, d, Lmax - L);
      const segLen = hit ? hit.t : Lmax - L;
      const prim = hit ? hit.prim : null;
      const nHit = hit ? [hit.n[0], hit.n[1], hit.n[2]] : null;
      const curvature = hit ? hit.curvature : 0;

      // Specular return passing the receiver on this segment?
      if (bounces > 0 && !diffuse && !(bounces === 1 && curvedFirst)) {
        const wx = rx[0] - o[0], wy = rx[1] - o[1], wz = rx[2] - o[2];
        const tc = wx * d[0] + wy * d[1] + wz * d[2];
        if (tc > 0 && tc < segLen) {
          const eb = [d[1] * ea[2] - d[2] * ea[1], d[2] * ea[0] - d[0] * ea[2], d[0] * ea[1] - d[1] * ea[0]];
          const da = wx * ea[0] + wy * ea[1] + wz * ea[2];
          const db = wx * eb[0] + wy * eb[1] + wz * eb[2];
          const sa = Math.max(sim.rxRadius, wA + gA * tc);
          const sb = Math.max(sim.rxRadius, wB + gB * tc);
          const q2 = (da * da) / (sa * sa) + (db * db) / (sb * sb);
          if (q2 < 9) {
            // Time and arrival direction from the last bounce point, which
            // stays right even when a wide beam passes the receiver off-centre.
            const wl = Math.hypot(wx, wy, wz);
            const g = rxGain(-wx / wl, -wy / wl, -wz / wl);
            if (g > 0) {
              const Lr = L + wl;
              const I = E * Math.exp(-alphaNp * Lr) * Math.exp(-q2 / 2) / (2 * Math.PI * sa * sb) * g;
              addArrival(Lr, I, sig, label, bounces, false, pts);
            }
          }
        }
      }

      segRel.push(rel);
      if (!prim) {
        pts.push(o[0] + d[0] * segLen, o[1] + d[1] * segLen, o[2] + d[2] * segLen);
        cum.push(L + segLen);
        break;
      }

      L += segLen;
      wA += gA * segLen;
      wB += gB * segLen;
      for (let k = 0; k < 3; k++) q[k] = o[k] + d[k] * segLen;
      pts.push(q[0], q[1], q[2]);
      cum.push(L);
      bounces++;
      if (bounces === 1) curvedFirst = curvature > 0;

      // Normal facing back towards where the ray came from.
      const flip = dot3(nHit, d) > 0 ? -1 : 1;
      for (let k = 0; k < 3; k++) n[k] = nHit[k] * flip;

      const a = prim.absorption;
      const sc = prim.scattering;
      const hopLabel = label ? `${label} → ${prim.name}` : prim.name;

      // Diffuse rain: scattered share sent straight to the receiver.
      if (sc > 0 && a < 1) {
        const vx = rx[0] - q[0], vy = rx[1] - q[1], vz = rx[2] - q[2];
        const dist = Math.hypot(vx, vy, vz);
        const ux = vx / dist, uy = vy / dist, uz = vz / dist;
        const cosOut = ux * n[0] + uy * n[1] + uz * n[2];
        const Lr = L + dist;
        if (cosOut > 0 && Lr < Lmax) {
          const g = rxGain(-ux, -uy, -uz);
          if (g > 0) {
            const from = [q[0] + n[0] * SURFACE_OFFSET, q[1] + n[1] * SURFACE_OFFSET, q[2] + n[2] * SURFACE_OFFSET];
            if (!occluded(prims, from, [ux, uy, uz], dist)) {
              const I = E * (1 - a) * sc * cosOut / Math.PI / (dist * dist) * Math.exp(-alphaNp * Lr) * g;
              addArrival(Lr, I, `${sig}>${prim.id}*`, `${hopLabel} (scatter)`, bounces, true, pts);
            }
          }
        }
      }

      E *= 1 - a;
      rel *= 1 - a;
      if (bounces >= sim.maxBounces) break;
      if (rel * Math.exp(-alphaNp * L) / Math.max(L * L, 1) < cutoff) break;

      if (rng() < sc) {
        diffuse = true;
        // Lambert (cosine-weighted) direction.
        const r1 = rng(), r2 = rng();
        const [tu, tv] = orthoBasis(n);
        const ph = 2 * Math.PI * r1, st = Math.sqrt(r2), ct = Math.sqrt(1 - r2);
        for (let k = 0; k < 3; k++) d[k] = n[k] * ct + tu[k] * Math.cos(ph) * st + tv[k] * Math.sin(ph) * st;
        sig += `>${prim.id}~`;
        label = `${hopLabel} (scatter)`;
      } else {
        const dn = 2 * dot3(d, n);
        for (let k = 0; k < 3; k++) d[k] -= dn * n[k];
        if (curvature > 0 && prim.kind === 'cyl') {
          // Convex cylinder: the beam fans out across the axis only.
          // Re-align ea with the across-axis direction first.
          const axis = prim.R[1];
          let ax = [axis[1] * d[2] - axis[2] * d[1], axis[2] * d[0] - axis[0] * d[2], axis[0] * d[1] - axis[1] * d[0]];
          const l = Math.hypot(ax[0], ax[1], ax[2]);
          if (l > 1e-6) {
            ax = [ax[0] / l, ax[1] / l, ax[2] / l];
            // Keep the footprint size when rotating the frame (use the larger width).
            const r = Math.max(wA, wB), k0 = Math.max(gA, gB);
            wA = r; wB = Math.min(wA, wB) || r; gA = k0;
            ea = ax;
          }
          gA += 2 * wA * curvature;
        } else {
          // Mirror the footprint frame; a sphere spreads it both ways.
          const en = 2 * dot3(ea, n);
          for (let k = 0; k < 3; k++) ea[k] -= en * n[k];
          if (curvature > 0) { gA += 2 * wA * curvature; gB += 2 * wB * curvature; }
        }
        sig += `>${prim.id}`;
        label = hopLabel;
      }
      for (let k = 0; k < 3; k++) o[k] = q[k] + n[k] * SURFACE_OFFSET;
    }

    if (keepViz) viz.push({ pts, cum, segRel, len: cum[cum.length - 1] });
  }

  // ── Direct echoes off curved surfaces (exact) ──
  // A spherical wave (radius R) reflects off a convex surface with principal
  // radii of curvature Rc; the reflected wavefront radius is 1/(1/R + 2/Rc),
  // and intensity back at the sensor falls by ρ/(ρ + R) in each direction.
  for (const pr of prims) {
    if (pr.kind !== 'sph' && pr.kind !== 'cyl') continue;
    let p, R, rho1, rho2;
    if (pr.kind === 'sph') {
      const v = [rx[0] - pr.c[0], rx[1] - pr.c[1], rx[2] - pr.c[2]];
      const dist = Math.hypot(v[0], v[1], v[2]);
      if (dist <= pr.r) continue;
      p = [pr.c[0] + v[0] / dist * pr.r, pr.c[1] + v[1] / dist * pr.r, pr.c[2] + v[2] / dist * pr.r];
      R = dist - pr.r;
      rho1 = rho2 = 1 / (1 / R + 2 / pr.r);
    } else {
      const w = [rx[0] - pr.c[0], rx[1] - pr.c[1], rx[2] - pr.c[2]];
      const lx = dot3(w, pr.R[0]), ly = dot3(w, pr.R[1]), lz = dot3(w, pr.R[2]);
      const radial = Math.hypot(lx, lz);
      if (Math.abs(ly) > pr.hl || radial <= pr.r) continue; // no perpendicular point on the side
      const px = lx / radial * pr.r, pz = lz / radial * pr.r;
      p = [0, 1, 2].map((i) => pr.c[i] + pr.R[0][i] * px + pr.R[1][i] * ly + pr.R[2][i] * pz);
      R = radial - pr.r;
      rho1 = 1 / (1 / R + 2 / pr.r); // across the axis
      rho2 = R;                       // along the axis (flat)
    }
    const u = [(p[0] - rx[0]) / R, (p[1] - rx[1]) / R, (p[2] - rx[2]) / R];
    const cosT = dot3(u, fwd);
    if (cosT <= 0) continue;
    const D = pistonPower(ka, Math.acos(Math.min(1, cosT)));
    if (D <= 0 || occluded(prims, rx, u, R)) continue;
    const I = D * D / (R * R) * (rho1 / (rho1 + R)) * (rho2 / (rho2 + R)) *
      (1 - pr.absorption) * (1 - pr.scattering) * Math.exp(-alphaNp * 2 * R);
    addArrival(2 * R, I, `>${pr.id}`, pr.name, 1, false, [rx[0], rx[1], rx[2], p[0], p[1], p[2]]);
  }

  // ── Received envelope ──
  // Each arrival is a pulse of `cycles` periods; the transducer smooths it.
  const pulseMs = sensor.cycles / fHz * 1000;
  const sigmaBins = Math.max(0.02, pulseMs / 2.5) / dtMs;
  const half = Math.ceil(4 * sigmaBins);
  const kernel = new Float64Array(2 * half + 1);
  for (let k = -half; k <= half; k++) kernel[k + half] = Math.exp(-(k * k) / (2 * sigmaBins * sigmaBins));

  const echoRel = new Float64Array(nBins);
  for (let b = 0; b < nBins; b++) {
    const p = power[b];
    if (!p) continue;
    const lo = Math.max(0, b - half), hi = Math.min(nBins - 1, b + half);
    for (let j = lo; j <= hi; j++) echoRel[j] += p * kernel[j - b + half];
  }

  const tx = sensor.txLevel;
  const noiseRel = Math.pow(10, (AMBIENT_NOISE_DB - tx) / 10);
  const noiseRng = mulberry32(99);
  const echoDb = new Float32Array(nBins);   // echoes only (for the chart trace)
  const totalDb = new Float32Array(nBins);  // what the receiver sees
  for (let b = 0; b < nBins; b++) {
    const t = b * dtMs;
    // Transmit burst + ring-down: fades 100 dB over the blanking time.
    const ringDb = -100 * t / Math.max(0.1, sensor.blanking);
    const ring = Math.pow(10, ringDb / 10);
    const noise = noiseRel * (0.6 + 0.8 * noiseRng());
    echoDb[b] = tx + 10 * Math.log10(echoRel[b] + ring + noise);
    totalDb[b] = echoDb[b];
  }

  // ── Detection: first threshold crossing after blanking, within max range ──
  let detection = null;
  const bStart = Math.ceil(sensor.blanking / dtMs);
  const bEnd = Math.min(nBins - 1, Math.floor(tWindow / dtMs));
  for (let b = bStart; b <= bEnd; b++) {
    if (totalDb[b] >= sensor.threshold) {
      const tMs = b * dtMs;
      // Attribute it to the strongest contribution around the crossing.
      let bestI = 0, bestLabel = null;
      for (let j = Math.max(0, b - half); j <= Math.min(nBins - 1, b + 2 * half); j++) {
        if (binTopI[j] > bestI) { bestI = binTopI[j]; bestLabel = binTopLabel[j]; }
      }
      detection = { tMs, distance: C_ASSUMED * tMs / 1000 / 2, label: bestLabel };
      break;
    }
  }

  // ── Ground truth: first surface straight along the sensor axis ──
  const axisHit = nearestHit(prims, rx, fwd, 1000);
  const trueDistance = axisHit ? axisHit.t : null;
  const trueTarget = axisHit ? axisHit.prim.name : null;

  const groupList = [...groups.values()]
    .map((g) => ({ ...g, levelDb: tx + 10 * Math.log10(g.power) }))
    .filter((g) => g.levelDb > AMBIENT_NOISE_DB - 10)
    .sort((a, b) => b.power - a.power);

  const ended = (typeof performance !== 'undefined' ? performance : Date).now();
  return {
    sensorId: sensor.id,
    c, alphaDb, lambda: c / fHz, fHz,
    tMax, tWindow, dtMs, nBins,
    echoDb, totalDb,
    noiseDb: tx + 10 * Math.log10(noiseRel),
    threshold: sensor.threshold,
    txLevel: tx,
    blanking: sensor.blanking,
    detection,
    trueDistance, trueTarget,
    groups: groupList,
    top,
    viz,
    rays: N,
    traceMs: ended - started,
  };
}
