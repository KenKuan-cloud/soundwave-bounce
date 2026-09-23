# Soundwave Bounce

A 3D simulator for ultrasonic sensors. Place a sensor, add walls, blocks, pipes
and other ultrasonic sources, then watch how the pulse spreads, bounces and
fades, and what the sensor finally measures.

**Open `soundwave-bounce.html` in a browser.** It is a single self-contained
file. It needs internet access the first time to load Three.js from a CDN.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | UI layout | ✅ |
| 1 | Scene editing: add / select / move / rotate / resize / delete, materials, presets, save / open JSON | ✅ |
| 2 | Sensor + ray tracing: beam pattern, reflections, spreading, air absorption, detection | ✅ |
| 3 | Visualisation: animated wavefront, timeline, echo (A-scan) chart, ray log, distance history | ✅ |
| 4 | Interfering ultrasonic sources and other sensors: crosstalk, false echoes, band filter, ping timing | ✅ |
| 5 | Intensity slice plane, compare sensors, undo/redo, export (PNG/CSV), more presets, fine zoom + zoom slider | ✅ |

## How the simulation works

At 58 kHz the wavelength is about 6 mm, far smaller than walls, blocks and
pipes, so sound is traced like light (geometric acoustics):

- **Beam:** rays leave the transducer evenly spaced in solid angle and weighted
  by a circular-piston directivity. The *beam angle* is the −6 dB half-angle.
  Rays go out to the second null, so the first side lobe (which often hits
  the floor) is included.
- **Surfaces:** each bounce loses `absorption` of the energy. A `scattering`
  share is re-radiated diffusely (Lambert); the rest reflects like a mirror.
- **Air:** ISO 9613-1 absorption (about 1.9 dB/m at 58 kHz, 20 °C, 50 % RH)
  plus spherical spreading.
- **Receiving:** every ray is a thin Gaussian beam whose width grows with
  distance, and faster after convex surfaces. Diffuse energy uses "diffuse rain".
  The direct echo off a pipe or sphere uses the exact curved-mirror formula.
- **Detection:** the received envelope (pulse length = cycles / frequency) is
  compared to the threshold after the blanking time. The sensor converts the
  first crossing to distance with the speed of sound at 20 °C, like real
  firmware. That is why temperature changes show up as a distance error.
- **Interference:** every other emitter (interference sources and other
  sensors) is traced to the active sensor the same way, including the direct
  path. It is scaled by the sensor's band-pass filter (4th order, −3 dB at the
  band edges; broadband hiss counts only the slice in band) and placed in time
  by when it fires relative to the sensor's ping. When the intervals differ,
  false echoes move from ping to ping. Turn on Loop to see it.
- **Intensity slice:** rays deposit power × path length into a thin slab
  around a plane (horizontal, or upright along the beam). Dividing by the cell
  volume gives the intensity summed over the whole ping. Drawn on its own
  40 dB colour scale from the plane's strongest spots.
- **Not modelled:** diffraction and phase interference.

## Using it

- **Mouse:** drag to orbit, scroll to zoom (Shift + scroll for finer steps), right-drag to pan.
  You can also use the zoom slider on the right edge of the 3D view. Press **H** or click **Reset view** if you get lost.
- **Keys:** Space ping/pause · Q W E R select/move/rotate/resize · S snap ·
  F focus · Del delete · Ctrl+D duplicate · Ctrl+Z / Ctrl+Y undo/redo · + / − zoom.
- **Presets:** demo room, wall straight ahead, tilted wall, corner reflector, pipe,
  foam vs concrete, crosstalk, corridor, pipe rack, tank level, parking, enclosed room.

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
