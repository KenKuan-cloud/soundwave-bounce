// ─────────────────────────────────────────────────────────────
// 3D viewport — UI preview.
// Everything drawn here is a static placeholder that shows how the
// simulation will look. No acoustics are computed yet.
// ─────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;

const COLORS = {
  sensor: 0x3fb6ff,
  source: 0xff9f43,
  select: 0x3fb6ff,
};

// Intensity ramp shared with the legend in the viewport overlay.
const INTENSITY_RAMP = ['#fff4b0', '#ffb44a', '#ff4d6d', '#8e3bd9', '#2a2f7a'].map((c) => new THREE.Color(c));

function intensityColor(t) {
  // t: 0 = loudest, 1 = quietest
  const x = Math.min(Math.max(t, 0), 1) * (INTENSITY_RAMP.length - 1);
  const i = Math.min(Math.floor(x), INTENSITY_RAMP.length - 2);
  return INTENSITY_RAMP[i].clone().lerp(INTENSITY_RAMP[i + 1], x - i);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function makeLabel(text, kind, [x, y, z] = [0, 0, 0]) {
  const el = document.createElement('div');
  el.className = `scene-label scene-label-${kind}`;
  el.textContent = text;
  const label = new CSS2DObject(el);
  label.position.set(x, y, z);
  return label;
}

function createViewport(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'label-layer';
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  camera.position.set(-5.2, 4.2, 6.4);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.7, 0.2);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();

  // ── Lighting ──
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a1f28, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-4, 8, 5);
  scene.add(sun);

  // ── Floor + grid ──
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x1b2129, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  scene.add(floor);

  const grid = new THREE.GridHelper(10, 20, 0x3a4656, 0x252d38);
  grid.position.y = 0.001;
  scene.add(grid);

  const axes = new THREE.AxesHelper(0.6);
  axes.position.set(-4.95, 0.002, 4.95);
  scene.add(axes);

  const objects = {}; // id -> Object3D, used for selection highlight
  const hitTargets = []; // meshes the placeholder rays bounce off
  hitTargets.push(floor);
  objects.floor = floor;

  // ── Sensor A ──
  const sensor = new THREE.Group();
  sensor.position.set(-3, 0.5, 0);
  {
    const body = new THREE.Group();
    sensor.add(body);
    sensor.userData.selectTarget = body;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.2, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x1f6fb2, roughness: 0.6 })
    );
    body.add(board);
    const canMat = new THREE.MeshStandardMaterial({ color: 0xc9d2dc, metalness: 0.7, roughness: 0.35 });
    for (const z of [-0.12, 0.12]) {
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 32), canMat);
      can.rotation.z = Math.PI / 2;
      can.position.set(0.065, 0, z);
      body.add(can);
    }

    // Beam cone (apex at the sensor, opening along +X).
    const halfAngle = 18 * DEG;
    const len = 4.2;
    const coneGeo = new THREE.ConeGeometry(Math.tan(halfAngle) * len, len, 48, 1, true);
    coneGeo.translate(0, -len / 2, 0);
    coneGeo.rotateZ(Math.PI / 2);
    const cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({ color: COLORS.sensor, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
    );
    cone.position.x = 0.12;
    sensor.add(cone);
    const coneEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(coneGeo, 1),
      new THREE.LineBasicMaterial({ color: COLORS.sensor, transparent: true, opacity: 0.25 })
    );
    coneEdges.position.x = 0.12;
    sensor.add(coneEdges);

    sensor.add(makeLabel('Sensor A · 58 kHz', 'sensor', [0, 0.32, 0]));
  }
  scene.add(sensor);
  objects.sensor1 = sensor;

  // ── Wall (concrete, turned 20°) ──
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 2, 4),
    new THREE.MeshStandardMaterial({ color: 0x8c939c, roughness: 0.9 })
  );
  wall.position.set(2, 1, 0);
  wall.rotation.y = 20 * DEG;
  wall.add(makeLabel('Wall · concrete', 'object', [0, 1.18, 0]));
  scene.add(wall);
  objects.wall1 = wall;
  hitTargets.push(wall);

  // ── Block (wood) ──
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xa57a4f, roughness: 0.8 })
  );
  block.position.set(0.3, 0.4, -1.9);
  block.rotation.y = 30 * DEG;
  block.add(makeLabel('Block · wood', 'object', [0, 0.6, 0]));
  scene.add(block);
  objects.block1 = block;
  hitTargets.push(block);

  // ── Pipe (steel, vertical) ──
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 2.4, 40),
    new THREE.MeshStandardMaterial({ color: 0xaab4bf, metalness: 0.8, roughness: 0.3 })
  );
  pipe.position.set(0.1, 1.2, 1.4);
  pipe.add(makeLabel('Pipe · steel', 'object', [0, 1.4, 0]));
  scene.add(pipe);
  objects.pipe1 = pipe;
  hitTargets.push(pipe);

  // ── Interference sources ──
  function makeSource(id, pos, text) {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 24, 16),
      new THREE.MeshStandardMaterial({ color: COLORS.source, emissive: COLORS.source, emissiveIntensity: 0.6 })
    ));
    [0.3, 0.6, 0.95].forEach((r, i) => {
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(r, 32, 16),
        new THREE.MeshBasicMaterial({ color: COLORS.source, wireframe: true, transparent: true, opacity: 0.14 - i * 0.035 })
      );
      g.add(shell);
      if (i === 0) g.userData.selectTarget = shell;
    });
    g.add(makeLabel(text, 'source', [0, 0.28, 0]));
    scene.add(g);
    objects[id] = g;
    return g;
  }
  makeSource('source1', new THREE.Vector3(-1, 1.2, 3), 'Neighbour sensor · 57 kHz');
  makeSource('source2', new THREE.Vector3(3.6, 0.3, -3.4), 'Air leak');

  // ── Placeholder ray paths (bounced with a real raycast so the look is right) ──
  scene.updateMatrixWorld(true);
  addPlaceholderRays(scene, sensor.position.clone().add(new THREE.Vector3(0.12, 0, 0)), hitTargets);

  // ── Placeholder wavefront shell ──
  addPlaceholderWavefront(scene, sensor.position.clone().add(new THREE.Vector3(0.12, 0, 0)));

  // ── Selection highlight ──
  const selectBox = new THREE.BoxHelper(undefined, COLORS.select);
  selectBox.material.transparent = true;
  selectBox.material.opacity = 0.9;
  scene.add(selectBox);

  function select(id) {
    const obj = objects[id];
    if (!obj) { selectBox.visible = false; return; }
    selectBox.visible = true;
    // Sensors and sources box their core only, not the beam cone or rings.
    selectBox.setFromObject(obj.userData.selectTarget || obj);
  }

  function applyTheme() {
    scene.background = new THREE.Color(cssVar('--bg') || '#0e1116');
  }
  applyTheme();

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
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  return { select, applyTheme };
}

function addPlaceholderRays(scene, origin, targets) {
  const raycaster = new THREE.Raycaster();
  const positions = [];
  const colors = [];
  const maxBounces = 3;
  const halfAngle = 16 * DEG;

  // A small fan of rays across the beam.
  const dirs = [];
  for (let ring = 0; ring <= 2; ring++) {
    const theta = (ring / 2) * halfAngle;
    const n = ring === 0 ? 1 : ring * 8;
    for (let k = 0; k < n; k++) {
      const phi = (k / n) * Math.PI * 2;
      dirs.push(new THREE.Vector3(Math.cos(theta), Math.sin(theta) * Math.sin(phi), Math.sin(theta) * Math.cos(phi)).normalize());
    }
  }

  for (const d0 of dirs) {
    let o = origin.clone();
    let d = d0.clone();
    let travelled = 0;
    for (let b = 0; b <= maxBounces; b++) {
      raycaster.set(o, d);
      raycaster.far = 8;
      const hit = raycaster.intersectObjects(targets, false)[0];
      const end = hit ? hit.point : o.clone().addScaledVector(d, 2.5);
      const seg = hit ? hit.distance : 2.5;
      const c0 = intensityColor(travelled / 12 + b * 0.18);
      travelled += seg;
      const c1 = intensityColor(travelled / 12 + b * 0.18);
      positions.push(o.x, o.y, o.z, end.x, end.y, end.z);
      colors.push(c0.r, c0.g, c0.b, c1.r, c1.g, c1.b);
      if (!hit) break;
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      d.reflect(n).normalize();
      o = hit.point.clone().addScaledVector(n, 1e-3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 })));
}

function addPlaceholderWavefront(scene, origin) {
  // Points on a spherical cap: the outgoing pulse a few ms after the ping.
  const radius = 2.4;
  const halfAngle = 26 * DEG;
  const pts = [];
  const cols = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const cosT = 1 - rand() * (1 - Math.cos(halfAngle));
    const theta = Math.acos(cosT);
    const phi = rand() * Math.PI * 2;
    const r = radius + (rand() - 0.5) * 0.04;
    pts.push(
      origin.x + r * cosT,
      origin.y + r * Math.sin(theta) * Math.sin(phi),
      origin.z + r * Math.sin(theta) * Math.cos(phi)
    );
    // Beam pattern: loudest on-axis, fading towards the edge.
    const c = intensityColor(Math.pow(theta / halfAngle, 1.6) * 0.9 + 0.05);
    cols.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.035, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })));
}
