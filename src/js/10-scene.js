// ─────────────────────────────────────────────────────────────
// 3D viewport: draws the scene from `store`, handles picking and the
// move/rotate/scale gizmo, and shows the traced sound (rays, particles).
// ─────────────────────────────────────────────────────────────

const COLORS = {
  sensor: 0x3fb6ff,
  source: 0xff9f43,
  select: 0x3fb6ff,
};

// Intensity ramp shared with the legend in the viewport overlay (0 → −90 dB).
const INTENSITY_RAMP = ['#fff4b0', '#ffb44a', '#ff4d6d', '#8e3bd9', '#2a2f7a'].map((c) => new THREE.Color(c));
const BOUNCE_COLORS = ['#3fb6ff', '#3ecf8e', '#f5c451', '#ff9f43', '#ff5d6c', '#b58cff', '#9aa8b8'].map((c) => new THREE.Color(c));
const LEGEND_RANGE_DB = 90;

function intensityColor(t, out = new THREE.Color()) {
  // t: 0 = loudest, 1 = quietest
  const x = clamp(t, 0, 1) * (INTENSITY_RAMP.length - 1);
  const i = Math.min(Math.floor(x), INTENSITY_RAMP.length - 2);
  return out.copy(INTENSITY_RAMP[i]).lerp(INTENSITY_RAMP[i + 1], x - i);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function makeLabel(kind) {
  const el = document.createElement('div');
  el.className = `scene-label scene-label-${kind}`;
  return new CSS2DObject(el);
}

// Level (dB re Tx at 1 m) of a particle `s` metres along a ray.
function particleDb(rel, s, alphaDb) {
  return 10 * Math.log10(rel) - 20 * Math.log10(Math.max(s, 1)) - alphaDb * s;
}

const noRaycast = (o) => { o.raycast = () => {}; };

function createViewport(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cssVar('--bg') || '#0e1116');

  const camera = new THREE.PerspectiveCamera(45, 1, 0.02, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a1f28, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-4, 8, 5);
  scene.add(sun);

  // ── Grid, axes, room box ──
  let grid = null;
  const axes = new THREE.AxesHelper(0.6);
  scene.add(axes);
  const roomBox = new THREE.Group();
  scene.add(roomBox);

  function rebuildRoom() {
    const { room } = store.state.env;
    if (grid) { scene.remove(grid); grid.geometry.dispose(); }
    const size = Math.max(room.w, room.d);
    grid = new THREE.GridHelper(size, Math.round(size * 2), 0x3a4656, 0x252d38);
    grid.position.y = 0.001;
    scene.add(grid);
    axes.position.set(-room.w / 2 + 0.05, 0.002, room.d / 2 - 0.05);

    roomBox.clear();
    if (room.enclosed) {
      const geo = new THREE.BoxGeometry(room.w, room.h, room.d);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x4a5566 }));
      const shell = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x8c939c, transparent: true, opacity: 0.05, side: THREE.BackSide, depthWrite: false }));
      edges.position.y = shell.position.y = room.h / 2;
      noRaycast(shell);
      noRaycast(edges);
      roomBox.add(edges, shell);
    }
  }

  // ── Item views ──
  const views = new Map(); // id -> { type, root, label, selectTarget, update(item) }
  const pickables = [];

  function surfaceMaterial(item) {
    const m = MATERIALS[item.material] || MATERIALS.custom;
    return new THREE.MeshStandardMaterial({
      color: m.color,
      roughness: m.metal ? 0.3 : 0.85,
      metalness: m.metal ? 0.8 : 0,
      transparent: !!m.glass,
      opacity: m.glass ? 0.45 : 1,
    });
  }

  function createView(item) {
    const root = new THREE.Group();
    root.userData.itemId = item.id;
    const label = makeLabel(item.type === 'sensor' ? 'sensor' : item.type === 'source' ? 'source' : 'object');
    const view = { type: item.type, root, label, selectTarget: root };

    if (item.type === 'sensor') {
      root.rotation.order = 'YZX';
      const body = new THREE.Group();
      body.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.45), new THREE.MeshStandardMaterial({ color: 0x1f6fb2, roughness: 0.6 })));
      const canMat = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, metalness: 0.7, roughness: 0.35 });
      for (const z of [-0.12, 0.12]) {
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 32), canMat);
        can.rotation.z = Math.PI / 2;
        can.position.set(0.065, 0, z);
        body.add(can);
      }
      root.add(body);
      body.traverse((o) => { if (o.isMesh) pickables.push(o); });
      view.selectTarget = body;

      const cone = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: COLORS.sensor, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
      const coneEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLORS.sensor, transparent: true, opacity: 0.25 }));
      noRaycast(cone);
      noRaycast(coneEdges);
      root.add(cone, coneEdges);
      label.position.set(0, 0.32, 0);
      root.add(label);
      let coneKey = '';
      view.update = (it) => {
        root.position.set(it.pos.x, it.pos.y, it.pos.z);
        root.rotation.set(0, it.yaw * DEG, it.pitch * DEG);
        label.element.textContent = `${it.name} · ${fmt(it.freq, it.freq % 1 ? 1 : 0)} kHz`;
        const len = Math.min(it.maxRange, 4);
        const key = `${it.halfAngle}|${len}`;
        if (key !== coneKey) {
          coneKey = key;
          const geo = new THREE.ConeGeometry(Math.tan(clamp(it.halfAngle, 1, 80) * DEG) * len, len, 48, 1, true);
          geo.translate(0, -len / 2, 0);
          geo.rotateZ(Math.PI / 2);
          cone.geometry.dispose();
          coneEdges.geometry.dispose();
          cone.geometry = geo;
          coneEdges.geometry = new THREE.EdgesGeometry(geo, 1);
        }
        const active = store.activeSensorId === it.id;
        cone.visible = coneEdges.visible = store.state.display.cone;
        cone.material.opacity = active ? 0.07 : 0.03;
        coneEdges.material.opacity = active ? 0.25 : 0.1;
      };
    } else if (item.type === 'source') {
      root.rotation.order = 'YZX';
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), new THREE.MeshStandardMaterial({ color: COLORS.source, emissive: COLORS.source, emissiveIntensity: 0.6 }));
      // Bigger invisible sphere so the source is easy to click.
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
      root.add(core, hit);
      pickables.push(core, hit);
      [0.3, 0.6, 0.95].forEach((r, i) => {
        const shell = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshBasicMaterial({ color: COLORS.source, wireframe: true, transparent: true, opacity: 0.14 - i * 0.035 }));
        noRaycast(shell);
        root.add(shell);
        if (i === 0) view.selectTarget = shell;
      });
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 0.5, COLORS.source, 0.1, 0.06);
      arrow.traverse(noRaycast);
      root.add(arrow);
      label.position.set(0, 0.28, 0);
      root.add(label);
      view.update = (it) => {
        root.position.set(it.pos.x, it.pos.y, it.pos.z);
        root.rotation.set(0, it.yaw * DEG, it.pitch * DEG);
        arrow.visible = it.directivity < 180;
        label.element.textContent = `${it.name} · ${fmt(it.freq, it.freq % 1 ? 1 : 0)} kHz`;
      };
    } else if (item.type === 'floor') {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x1b2129, roughness: 0.95, transparent: true }));
      mesh.rotation.x = -Math.PI / 2;
      root.add(mesh);
      pickables.push(mesh);
      view.selectTarget = mesh;
      label.visible = false;
      view.update = (it) => {
        const { room } = store.state.env;
        mesh.scale.set(room.w, room.d, 1);
        // A hidden (non-reflecting) floor is drawn faintly so it can still be picked.
        mesh.material.opacity = it.visible ? 0.92 : 0.3;
      };
    } else {
      // wall / block / pipe / sphere: unit geometry scaled to size.
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMaterial(item));
      root.add(mesh);
      pickables.push(mesh);
      view.selectTarget = mesh;
      root.add(label);
      let shapeKey = '', matKey = item.material;
      view.update = (it) => {
        if (it.type !== shapeKey) {
          shapeKey = it.type;
          mesh.geometry.dispose();
          mesh.geometry = it.type === 'pipe' ? new THREE.CylinderGeometry(1, 1, 1, 40)
            : it.type === 'sphere' ? new THREE.SphereGeometry(1, 40, 24)
            : new THREE.BoxGeometry(1, 1, 1);
        }
        if (it.material !== matKey) { matKey = it.material; mesh.material.dispose(); mesh.material = surfaceMaterial(it); }
        root.position.set(it.pos.x, it.pos.y, it.pos.z);
        root.rotation.set(it.rot.x * DEG, it.rot.y * DEG, it.rot.z * DEG);
        let top;
        if (it.type === 'pipe') { mesh.scale.set(it.radius, it.length, it.radius); top = it.length / 2; }
        else if (it.type === 'sphere') { mesh.scale.setScalar(it.radius); top = it.radius; }
        else { mesh.scale.set(it.size.x, it.size.y, it.size.z); top = it.size.y / 2; }
        label.position.set(0, top + 0.18, 0);
        const matName = (MATERIALS[it.material] || MATERIALS.custom).label.split(/[ (/]/)[0].toLowerCase();
        label.element.textContent = `${it.name} · ${matName}`;
      };
    }
    scene.add(root);
    return view;
  }

  function removeView(id) {
    const v = views.get(id);
    if (!v) return;
    if (tc.object === v.root) tc.detach();
    v.root.traverse((o) => {
      const i = pickables.indexOf(o);
      if (i >= 0) pickables.splice(i, 1);
      if (o.isCSS2DObject) o.element.remove();
    });
    scene.remove(v.root);
    views.delete(id);
  }

  const family = (t) => (SHAPE_TYPES.includes(t) ? 'shape' : t);

  function sync() {
    const items = store.items;
    const ids = new Set(items.map((i) => i.id));
    for (const id of [...views.keys()]) if (!ids.has(id)) removeView(id);
    for (const it of items) {
      let v = views.get(it.id);
      if (v && family(v.type) !== family(it.type)) { removeView(it.id); v = null; }
      if (!v) { v = createView(it); views.set(it.id, v); }
      v.type = it.type;
      v.update(it);
      v.root.visible = it.visible || it.type === 'floor';
      v.label.visible = store.state.display.labels && it.type !== 'floor';
    }
    if (grid) grid.visible = axes.visible = store.state.display.grid;
    updateGizmo();
  }

  // ── Selection + gizmo ──
  const selectBox = new THREE.BoxHelper(undefined, COLORS.select);
  selectBox.material.transparent = true;
  selectBox.material.opacity = 0.9;
  selectBox.visible = false;
  scene.add(selectBox);

  const tc = new TransformControls(camera, renderer.domElement);
  tc.setSize(0.8);
  scene.add(tc);
  let tool = 'select';
  let snap = false;
  let gizmoUsed = false;

  tc.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    if (e.value) gizmoUsed = true;
    else bus.emit('scene', { source: 'gizmo-end' });
  });
  tc.addEventListener('objectChange', () => {
    const item = store.get(tc.object?.userData.itemId);
    if (!item) return;
    const r = tc.object;
    const round = (v) => Math.round(v * 1000) / 1000;
    item.pos.x = round(r.position.x);
    item.pos.y = round(r.position.y);
    item.pos.z = round(r.position.z);
    if (item.type === 'sensor' || item.type === 'source') {
      item.yaw = round(r.rotation.y / DEG);
      item.pitch = round(clamp(r.rotation.z / DEG, -90, 90));
    } else {
      item.rot.x = round(r.rotation.x / DEG);
      item.rot.y = round(r.rotation.y / DEG);
      item.rot.z = round(r.rotation.z / DEG);
    }
    if (tool === 'scale' && SHAPE_TYPES.includes(item.type)) {
      const s = r.scale;
      const pos = (v) => Math.max(0.01, round(v));
      if (item.type === 'pipe') { item.radius = pos(item.radius * Math.max(s.x, s.z)); item.length = pos(item.length * s.y); }
      else if (item.type === 'sphere') { item.radius = pos(item.radius * Math.max(s.x, s.y, s.z)); }
      else { item.size.x = pos(item.size.x * s.x); item.size.y = pos(item.size.y * s.y); item.size.z = pos(item.size.z * s.z); }
      r.scale.set(1, 1, 1);
    }
    views.get(item.id)?.update(item);
    bus.emit('scene', { source: 'gizmo' });
  });

  function updateGizmo() {
    const item = store.selected;
    const v = item && views.get(item.id);
    const movable = item && item.type !== 'floor' && item.visible;
    if (tool === 'select' || !movable || !v) {
      tc.detach();
    } else {
      if (tc.object !== v.root) tc.attach(v.root);
      tc.setMode(tool === 'move' ? 'translate' : tool === 'rotate' ? 'rotate' : 'scale');
      // Sensors and sources are aimed with yaw + pitch only; they have no size.
      const aimOnly = item.type === 'sensor' || item.type === 'source';
      const noScale = tool === 'scale' && aimOnly;
      tc.showX = !noScale && !(tool === 'rotate' && aimOnly);
      tc.showY = !noScale;
      tc.showZ = !noScale;
      tc.setSpace(tool === 'rotate' && aimOnly ? 'local' : 'world');
    }
    selectBox.visible = !!v;
    if (v) selectBox.setFromObject(v.selectTarget);
  }

  function setTool(t) { tool = t; updateGizmo(); }
  function setSnap(on) {
    snap = on;
    tc.setTranslationSnap(on ? 0.1 : null);
    tc.setRotationSnap(on ? 15 * DEG : null);
    tc.setScaleSnap(on ? 0.1 : null);
  }

  // ── Picking ──
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const isShown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; gizmoUsed = false; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || gizmoUsed || e.button !== 0) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables.filter(isShown), false)[0];
    let id = null;
    for (let o = hit?.object; o; o = o.parent) if (o.userData.itemId) { id = o.userData.itemId; break; }
    bus.emit('pick', id);
  });

  // ── Camera views ──
  function setView(name) {
    const { room } = store.state.env;
    const size = Math.max(room.w, room.d);
    const t = new THREE.Vector3(0, 0.6, 0);
    let p = null;
    if (name === 'top') { p = new THREE.Vector3(0, size * 1.25, 0.001); t.set(0, 0, 0); }
    else if (name === 'front') p = new THREE.Vector3(0, 1.6, size * 1.1);
    else if (name === 'side') p = new THREE.Vector3(size * 1.1, 1.6, 0);
    else if (name === 'sensor') {
      const s = store.activeSensor();
      if (s) {
        const f = aimVector(s.yaw, s.pitch);
        p = new THREE.Vector3(s.pos.x - f[0] * 0.8, s.pos.y - f[1] * 0.8 + 0.25, s.pos.z - f[2] * 0.8);
        t.set(s.pos.x + f[0] * 3, s.pos.y + f[1] * 3, s.pos.z + f[2] * 3);
      }
    }
    if (!p) { p = new THREE.Vector3(-size * 0.52, size * 0.42, size * 0.64); t.set(0, 0.7, 0.2); }
    camera.position.copy(p);
    controls.target.copy(t);
    controls.update();
  }

  // ── Sound visualisation ──
  const vis = { result: null, alphaDb: 0, c: 343 };
  const particleGeo = new THREE.BufferGeometry();
  const particles = new THREE.Points(particleGeo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  const rayLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.25, depthWrite: false }));
  const rxLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false }));
  for (const o of [particles, rayLines, rxLines]) { o.frustumCulled = false; noRaycast(o); scene.add(o); }

  const tmpColor = new THREE.Color();
  function colorFor(db, bounce) {
    const mode = store.state.sim.colorBy;
    if (mode === 'bounce') return tmpColor.copy(BOUNCE_COLORS[Math.min(bounce, BOUNCE_COLORS.length - 1)]);
    if (mode === 'source') return tmpColor.setHex(COLORS.sensor);
    return intensityColor(-db / LEGEND_RANGE_DB, tmpColor);
  }

  function setLineGeometry(lines, pos, col) {
    lines.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    lines.geometry = g;
  }

  function buildRayLines() {
    const r = vis.result;
    const pos = [], col = [];
    if (r && store.state.display.allRays) {
      const step = Math.max(1, Math.ceil(r.viz.length / 400));
      for (let i = 0; i < r.viz.length; i += step) {
        const v = r.viz[i];
        for (let k = 0; k < v.segRel.length; k++) {
          const a = k * 3;
          pos.push(v.pts[a], v.pts[a + 1], v.pts[a + 2], v.pts[a + 3], v.pts[a + 4], v.pts[a + 5]);
          for (const s of [v.cum[k], v.cum[k + 1]]) {
            const c = colorFor(particleDb(v.segRel[k], s, vis.alphaDb), k);
            col.push(c.r, c.g, c.b);
          }
        }
      }
    }
    setLineGeometry(rayLines, pos, col);
  }

  function buildRxLines() {
    const r = vis.result;
    const pos = [], col = [];
    if (r && store.state.display.rxRays && r.top.length) {
      const maxI = r.top[0].I;
      // Only paths that matter: within 25 dB of the detection threshold.
      const minI = Math.pow(10, (r.threshold - 25 - r.txLevel) / 10);
      for (const a of r.top.filter((x) => x.I >= minI).slice(0, 30)) {
        // Colour relative to the strongest return so weak paths fade out.
        const db = 1.5 * 10 * Math.log10(a.I / maxI);
        const p = a.pts;
        for (let k = 0; k + 5 < p.length; k += 3) {
          pos.push(p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 5]);
          const c = colorFor(db, k / 3);
          col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
    }
    setLineGeometry(rxLines, pos, col);
  }

  function setResult(result) {
    vis.result = result;
    if (result) {
      vis.alphaDb = result.alphaDb;
      vis.c = result.c;
      const n = Math.max(1, result.viz.length);
      const attr = particleGeo.getAttribute('position');
      if (!attr || attr.count < n) {
        particleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        particleGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      }
    }
    buildRayLines();
    buildRxLines();
  }

  let timeMs = 0;
  function setTime(t) { timeMs = t; }

  function updateParticles() {
    const r = vis.result;
    particles.visible = !!r && store.state.display.particles && timeMs > 0;
    if (!particles.visible) return;
    const s = vis.c * timeMs / 1000;
    const P = particleGeo.getAttribute('position').array;
    const C = particleGeo.getAttribute('color').array;
    const intensityMode = store.state.sim.colorBy === 'intensity';
    let n = 0;
    for (const v of r.viz) {
      if (s > v.len) continue;
      let k = 0;
      while (k < v.segRel.length - 1 && v.cum[k + 1] < s) k++;
      const db = particleDb(v.segRel[k], s, vis.alphaDb);
      if (intensityMode && db < -LEGEND_RANGE_DB - 10) continue;
      const segLen = v.cum[k + 1] - v.cum[k];
      const f = segLen > 0 ? (s - v.cum[k]) / segLen : 0;
      const a = k * 3;
      P[n * 3] = v.pts[a] + (v.pts[a + 3] - v.pts[a]) * f;
      P[n * 3 + 1] = v.pts[a + 1] + (v.pts[a + 4] - v.pts[a + 1]) * f;
      P[n * 3 + 2] = v.pts[a + 2] + (v.pts[a + 5] - v.pts[a + 2]) * f;
      const c = colorFor(db, k);
      C[n * 3] = c.r; C[n * 3 + 1] = c.g; C[n * 3 + 2] = c.b;
      n++;
    }
    particleGeo.setDrawRange(0, n);
    particleGeo.getAttribute('position').needsUpdate = true;
    particleGeo.getAttribute('color').needsUpdate = true;
  }

  // ── Render loop ──
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = w + 'px';
    renderer.domElement.style.height = h + 'px';
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  renderer.setAnimationLoop(() => {
    controls.update();
    if (selectBox.visible) {
      const v = views.get(store.selectedId);
      if (v) selectBox.setFromObject(v.selectTarget);
    }
    updateParticles();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  return {
    rebuild() { rebuildRoom(); sync(); },
    sync,
    select: updateGizmo,
    setTool, setSnap, setView,
    setResult, setTime,
    refreshLines() { buildRayLines(); buildRxLines(); },
    get snap() { return snap; },
  };
}
