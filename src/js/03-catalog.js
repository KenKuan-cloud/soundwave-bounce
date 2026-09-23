// Material and sensor presets.
// Ultrasound reflects strongly off anything hard: absorption is small except
// for porous materials. Scattering: 0 = mirror-like, 1 = fully diffuse.
const MATERIALS = {
  concrete: { label: 'Concrete (smooth)', absorption: 0.02, scattering: 0.01, color: 0x8c939c },
  brick:    { label: 'Brick',             absorption: 0.03, scattering: 0.25, color: 0x9c5a44 },
  wood:     { label: 'Wood',              absorption: 0.06, scattering: 0.1,  color: 0xa57a4f },
  steel:    { label: 'Steel',             absorption: 0.01, scattering: 0.02, color: 0xaab4bf, metal: true },
  glass:    { label: 'Glass',             absorption: 0.01, scattering: 0.01, color: 0x9fd4e8, glass: true },
  water:    { label: 'Water (still)',     absorption: 0.001, scattering: 0,   color: 0x2f7fb8, glass: true },
  foam:     { label: 'Acoustic foam',     absorption: 0.85, scattering: 0.7,  color: 0x3d4350 },
  fabric:   { label: 'Fabric / curtain',  absorption: 0.55, scattering: 0.6,  color: 0x6d5a8c },
  custom:   { label: 'Custom',            absorption: null, scattering: null, color: 0x7f8fa0 },
};

const SENSOR_MODELS = {
  generic58: { label: 'Generic 58 kHz',               freq: 58, bw: 4, halfAngle: 18 },
  hcsr04:    { label: '40 kHz narrow (HC-SR04 class)', freq: 40, bw: 2, halfAngle: 15 },
  maxbotix:  { label: 'MaxBotix-style (42 kHz, wide)', freq: 42, bw: 3, halfAngle: 30 },
  custom:    { label: 'Custom',                        freq: null, bw: null, halfAngle: null },
};

const TYPE_LABELS = {
  sensor: 'Sensor', source: 'Source', wall: 'Wall', block: 'Block', pipe: 'Pipe', sphere: 'Sphere', floor: 'Floor',
};

const SHAPE_TYPES = ['wall', 'block', 'pipe', 'sphere'];

// Smallest pipe the tool accepts (m).
const MIN_PIPE_RADIUS = 0.03;

// Ambient ultrasonic noise at the receiver, dB SPL.
const AMBIENT_NOISE_DB = 20;
