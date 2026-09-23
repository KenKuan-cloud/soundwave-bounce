// Scene model. Plain JSON-able data; the viewport, tracer and UI all read it.

const SCENE_VERSION = 1;

function defaultEnv() {
  return {
    temperature: 20,
    humidity: 50,
    pressure: 101.325,
    room: { enclosed: false, w: 10, h: 3, d: 10 },
  };
}

function defaultSim() {
  return { rays: 20000, maxBounces: 6, cutoffDb: -90, rxRadius: 0.01, particles: 5000, colorBy: 'intensity', vizRangeDb: 20 };
}

function defaultDisplay() {
  return {
    particles: true, cone: true, allRays: false, rxRays: true, grid: true, labels: true,
    slice: false, sliceMode: 'vertical', sliceHeight: 1, sliceAll: false,
  };
}

const v3 = (x, y, z) => ({ x, y, z });

function makeItem(type, over = {}) {
  const base = { id: '', type, name: '', visible: true };
  let item;
  switch (type) {
    case 'sensor':
      item = {
        ...base, pos: v3(0, 1, 0), yaw: 0, pitch: 0,
        model: 'generic58', freq: 58, bw: 4, halfAngle: 18,
        txLevel: 115, cycles: 8, interval: 60, pingOffset: 0,
        threshold: 60, blanking: 1.2, maxRange: 6,
      };
      break;
    case 'source':
      item = {
        ...base, pos: v3(0, 1, 0), yaw: 0, pitch: 0,
        emission: 'sensor', freq: 57, level: 112, directivity: 20,
        mode: 'pulsed', period: 55, offset: 3,
      };
      break;
    case 'floor':
      item = { ...base, material: 'concrete', absorption: 0.02, scattering: 0.01 };
      break;
    default: // wall, block, pipe, sphere
      item = {
        ...base, pos: v3(0, 0, 0), rot: v3(0, 0, 0),
        size: v3(1, 1, 1), radius: 0.15, length: 2,
        material: 'concrete', absorption: 0.02, scattering: 0.01,
      };
      if (type === 'wall') { item.size = v3(0.1, 2, 4); item.pos.y = 1; }
      if (type === 'block') { item.size = v3(0.8, 0.8, 0.8); item.pos.y = 0.4; item.material = 'wood'; }
      if (type === 'pipe') { item.radius = 0.15; item.length = 2.4; item.pos.y = 1.2; item.material = 'steel'; }
      if (type === 'sphere') { item.radius = 0.4; item.pos.y = 0.4; item.material = 'steel'; }
      if (MATERIALS[item.material].absorption != null) {
        item.absorption = MATERIALS[item.material].absorption;
        item.scattering = MATERIALS[item.material].scattering;
      }
  }
  // Merge overrides one level deep so partial vectors work: { pos: { x: 2 } }.
  for (const [k, v] of Object.entries(over)) {
    item[k] = v && typeof v === 'object' && !Array.isArray(v) && item[k] && typeof item[k] === 'object'
      ? { ...item[k], ...v }
      : v;
  }
  return item;
}

// ── Preset scenes ──
function withMaterial(type, material, over) {
  const m = MATERIALS[material];
  return makeItem(type, { material, absorption: m.absorption, scattering: m.scattering, ...over });
}

const PRESETS = {
  demo: {
    label: 'Demo room',
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -3, y: 1, z: 0 } }),
      makeItem('source', { name: 'Neighbour sensor', pos: { x: -1, y: 1.2, z: 3 }, yaw: 30 }),
      makeItem('source', { name: 'Air leak', emission: 'hiss', freq: 60, level: 80, directivity: 90, mode: 'continuous', pos: { x: 3.6, y: 0.3, z: -3.4 } }),
      withMaterial('wall', 'concrete', { name: 'Wall', pos: { x: 2, y: 1, z: 0 }, rot: { y: 20 } }),
      withMaterial('block', 'wood', { name: 'Block', pos: { x: 0.3, y: 0.4, z: -1.9 }, rot: { y: 30 } }),
      withMaterial('pipe', 'steel', { name: 'Pipe', pos: { x: 0.1, y: 1.2, z: 1.4 } }),
    ],
  },
  straight: {
    label: 'Wall straight ahead',
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -2, y: 1, z: 0 } }),
      withMaterial('wall', 'concrete', { name: 'Wall', pos: { x: 1, y: 1, z: 0 } }),
    ],
  },
  tilted: {
    label: 'Tilted wall (echo lost)',
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -2, y: 1, z: 0 } }),
      withMaterial('wall', 'concrete', { name: 'Wall', pos: { x: 1, y: 1, z: 0 }, rot: { y: 45 } }),
    ],
  },
  corner: {
    label: 'Corner reflector',
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -1.5, y: 1, z: 1.5 }, yaw: 45 }),
      withMaterial('wall', 'concrete', { name: 'Wall 1', pos: { x: 1.5, y: 1, z: 0 }, size: { x: 0.1, y: 2, z: 3 } }),
      withMaterial('wall', 'concrete', { name: 'Wall 2', pos: { x: 0, y: 1, z: -1.5 }, rot: { y: 90 }, size: { x: 0.1, y: 2, z: 3 } }),
    ],
  },
  pipe: {
    label: 'Single pipe',
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -2, y: 1, z: 0 } }),
      withMaterial('pipe', 'steel', { name: 'Pipe', pos: { x: 0.5, y: 1.2, z: 0 }, radius: 0.1 }),
    ],
  },
  foam: {
    label: 'Foam vs concrete',
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -2, y: 1, z: 0.8 } }),
      makeItem('sensor', { name: 'Sensor B', pos: { x: -2, y: 1, z: -0.8 }, pingOffset: 25 }),
      withMaterial('block', 'concrete', { name: 'Concrete block', pos: { x: 1, y: 1, z: 0.8 }, size: { x: 0.3, y: 2, z: 1.2 } }),
      withMaterial('block', 'foam', { name: 'Foam block', pos: { x: 1, y: 1, z: -0.8 }, size: { x: 0.3, y: 2, z: 1.2 } }),
    ],
  },
  crosstalk: {
    label: 'Crosstalk: two sensors',
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -2, y: 1, z: 0.6 }, yaw: -8 }),
      makeItem('sensor', { name: 'Sensor B', pos: { x: -2, y: 1, z: -0.6 }, yaw: 8, interval: 55 }),
      withMaterial('wall', 'concrete', { name: 'Wall', pos: { x: 2.5, y: 1, z: 0 } }),
    ],
  },
  corridor: {
    label: 'Corridor, sensor at an angle',
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -3.5, y: 1, z: 0.4 }, yaw: -25 }),
      withMaterial('wall', 'concrete', { name: 'Left wall', pos: { x: 0, y: 1, z: -1 }, rot: { y: 90 }, size: { x: 0.1, y: 2, z: 8 } }),
      withMaterial('wall', 'concrete', { name: 'Right wall', pos: { x: 0, y: 1, z: 1 }, rot: { y: 90 }, size: { x: 0.1, y: 2, z: 8 } }),
      withMaterial('wall', 'wood', { name: 'Door at the end', pos: { x: 2, y: 1, z: 0 }, size: { x: 0.08, y: 2, z: 1.9 } }),
    ],
  },
  pipeRack: {
    label: 'Pipe rack (thin vs thick)',
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -2.5, y: 1, z: 0 } }),
      withMaterial('pipe', 'steel', { name: 'Pipe Ø60 mm', pos: { x: -0.5, y: 1.2, z: 0.15 }, radius: 0.03 }),
      withMaterial('pipe', 'steel', { name: 'Pipe Ø100 mm', pos: { x: 0.5, y: 1.2, z: -0.1 }, radius: 0.05 }),
      withMaterial('pipe', 'steel', { name: 'Pipe Ø200 mm', pos: { x: 1.6, y: 1.2, z: 0.05 }, radius: 0.1 }),
    ],
  },
  tank: {
    label: 'Tank level (looking down)',
    items: () => [
      makeItem('sensor', { name: 'Level sensor', pos: { x: 0, y: 2.8, z: 0 }, pitch: -90, maxRange: 4 }),
      withMaterial('block', 'water', { name: 'Liquid', pos: { x: 0, y: 0.5, z: 0 }, size: { x: 1.4, y: 1, z: 1.4 } }),
      withMaterial('wall', 'steel', { name: 'Tank wall 1', pos: { x: 0.75, y: 1.5, z: 0 }, size: { x: 0.04, y: 3, z: 1.54 } }),
      withMaterial('wall', 'steel', { name: 'Tank wall 2', pos: { x: -0.75, y: 1.5, z: 0 }, size: { x: 0.04, y: 3, z: 1.54 } }),
      withMaterial('wall', 'steel', { name: 'Tank wall 3', pos: { x: 0, y: 1.5, z: 0.75 }, rot: { y: 90 }, size: { x: 0.04, y: 3, z: 1.46 } }),
      withMaterial('wall', 'steel', { name: 'Tank wall 4', pos: { x: 0, y: 1.5, z: -0.75 }, rot: { y: 90 }, size: { x: 0.04, y: 3, z: 1.46 } }),
    ],
  },
  parking: {
    label: 'Parking: pole and kerb',
    items: () => [
      makeItem('sensor', { name: 'Bumper sensor', pos: { x: -1.5, y: 0.5, z: 0 }, pitch: 5, model: 'maxbotix', freq: 42, bw: 3, halfAngle: 30, maxRange: 3 }),
      withMaterial('pipe', 'steel', { name: 'Pole', pos: { x: 0.3, y: 0.6, z: 0.35 }, radius: 0.04, length: 1.2 }),
      withMaterial('block', 'concrete', { name: 'Kerb', pos: { x: 1.2, y: 0.07, z: 0 }, size: { x: 0.15, y: 0.14, z: 3 } }),
    ],
  },
  room: {
    label: 'Enclosed room (reverberation)',
    env: { room: { enclosed: true, w: 6, h: 3, d: 5 } },
    items: () => [
      makeItem('sensor', { name: 'Sensor A', pos: { x: -2, y: 1.2, z: 0.5 }, yaw: 10 }),
      withMaterial('block', 'wood', { name: 'Cabinet', pos: { x: 1.2, y: 0.5, z: -1.2 }, size: { x: 0.6, y: 1, z: 1 } }),
      withMaterial('block', 'fabric', { name: 'Sofa', pos: { x: 0.6, y: 0.4, z: 1.5 }, size: { x: 2, y: 0.8, z: 0.9 } }),
    ],
  },
  empty: {
    label: 'Empty',
    items: () => [makeItem('sensor', { name: 'Sensor A', pos: { x: -2, y: 1, z: 0 } })],
  },
};

// ── Store ──
const store = {
  state: null,
  selectedId: null,
  activeSensorId: null,
  _next: 1,

  newId(type) {
    let id;
    do { id = `${type}${this._next++}`; } while (this.state?.items.some((i) => i.id === id));
    return id;
  },

  load(data) {
    const d = data || {};
    const room = { ...defaultEnv().room, ...(d.env?.room || {}) };
    this.state = {
      version: SCENE_VERSION,
      env: { ...defaultEnv(), ...(d.env || {}), room },
      sim: { ...defaultSim(), ...(d.sim || {}) },
      display: { ...defaultDisplay(), ...(d.display || {}) },
      items: [],
    };
    this._next = 1;
    const items = Array.isArray(d.items) ? d.items : [];
    if (!items.some((i) => i.type === 'floor')) items.push(makeItem('floor', { name: 'Floor' }));
    for (const raw of items) {
      if (!TYPE_LABELS[raw.type]) continue;
      const item = makeItem(raw.type, raw);
      if (item.type === 'pipe') item.radius = Math.max(MIN_PIPE_RADIUS, item.radius);
      if (!item.id || this.state.items.some((i) => i.id === item.id)) item.id = this.newId(item.type);
      if (!item.name) item.name = TYPE_LABELS[item.type];
      this.state.items.push(item);
    }
    const firstSensor = this.state.items.find((i) => i.type === 'sensor');
    this.activeSensorId = firstSensor?.id ?? null;
    this.selectedId = firstSensor?.id ?? null;
  },

  loadPreset(key) {
    const p = PRESETS[key] || PRESETS.demo;
    // Keep the user's simulation and display settings across scenes.
    this.load({ items: p.items(), env: p.env ? deepClone(p.env) : undefined, sim: this.state?.sim, display: this.state?.display });
  },

  serialize() {
    return JSON.stringify(this.state, null, 2);
  },

  get items() { return this.state.items; },
  get(id) { return this.state.items.find((i) => i.id === id) || null; },
  get selected() { return this.get(this.selectedId); },

  activeSensor() {
    return this.get(this.activeSensorId) || this.state.items.find((i) => i.type === 'sensor') || null;
  },

  add(type, over = {}) {
    const n = this.state.items.filter((i) => i.type === type).length + 1;
    const item = makeItem(type, { name: `${TYPE_LABELS[type]} ${n}`, ...over });
    item.id = this.newId(type);
    // Keep the floor last in the list.
    const floorIdx = this.state.items.findIndex((i) => i.type === 'floor');
    this.state.items.splice(floorIdx < 0 ? this.state.items.length : floorIdx, 0, item);
    return item;
  },

  remove(id) {
    const item = this.get(id);
    if (!item || item.type === 'floor') return false;
    this.state.items = this.state.items.filter((i) => i.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    if (this.activeSensorId === id) this.activeSensorId = this.activeSensor()?.id ?? null;
    return true;
  },

  duplicate(id) {
    const src = this.get(id);
    if (!src || src.type === 'floor') return null;
    const copy = deepClone(src);
    delete copy.id;
    copy.name = `${src.name} copy`;
    if (copy.pos) { copy.pos.x += 0.5; copy.pos.z += 0.5; }
    return this.add(src.type, copy);
  },

  select(id) {
    this.selectedId = id;
    const item = this.get(id);
    if (item?.type === 'sensor') this.activeSensorId = id;
  },
};
