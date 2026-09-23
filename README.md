# Soundwave Bounce

A 3D simulator for ultrasonic sensors. Place a sensor, add walls, blocks, pipes
and other ultrasonic sources, then watch how the pulse spreads, bounces and
fades, and what the sensor finally measures.

**Open `soundwave-bounce.html` in a browser.** It is a single self-contained
file. It needs internet access the first time to load Three.js from a CDN.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | UI layout (no functionality, placeholder scene and values) | ✅ current |
| 1 | Scene editing: add / select / move / rotate / delete objects, materials | ⏳ |
| 2 | Sensor + ray tracing: beam pattern, reflections, spreading and air loss | ⏳ |
| 3 | Visualisation: animated wavefront, timeline, echo (A-scan) chart, measured distance | ⏳ |
| 4 | Interfering ultrasonic sources (crosstalk, false echoes) | ⏳ |
| 5 | Temperature / humidity, presets, save / load JSON | ⏳ |

Defaults: 58 kHz sensor (λ ≈ 5.9 mm), so geometric ray tracing is used
rather than a full wave solver.

## Development

Sources live in `src/` and are packed into the single HTML file:

```
src/index.html        page markup (with @inline-css / @inline-js markers)
src/styles/*.css      theme, layout, components
src/js/*.js           concatenated in filename order into one ES module
scripts/build.mjs     the packer (no dependencies)
```

```
npm run build         # writes soundwave-bounce.html
```

Edit files in `src/`, never the generated `soundwave-bounce.html`.
