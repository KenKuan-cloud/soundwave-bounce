// All sources in src/js are concatenated (in filename order) into one ES module
// by scripts/build.mjs, so imports live here and top-level names are shared.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
