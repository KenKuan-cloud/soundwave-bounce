// ─────────────────────────────────────────────────────────────
// UI wiring: outliner, inspector data binding, toolbar, keyboard, files.
//
// Inputs declare what they edit: data-bind="pos.x" inside a
// [data-scope] container (item = selected object, env, sim, display).
// ─────────────────────────────────────────────────────────────

function initUI({ viewport, sim }) {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ── Toast ──
  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  document.body.appendChild(toastEl);
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2200);
  }

  // ── Select options from the catalogs ──
  const fillOptions = (sel, map) => {
    sel.replaceChildren(...Object.entries(map).map(([k, v]) => new Option(v.label, k)));
  };
  $$('select[data-options="materials"]').forEach((s) => fillOptions(s, MATERIALS));
  $$('select[data-options="sensorModels"]').forEach((s) => fillOptions(s, SENSOR_MODELS));

  // ── Outliner ──
  const outliner = $('#outliner');
  const GROUPS = [
    ['Sensors', (i) => i.type === 'sensor', 'sensor'],
    ['Interference sources', (i) => i.type === 'source', 'source'],
    ['Objects', (i) => SHAPE_TYPES.includes(i.type) || i.type === 'floor', 'object'],
  ];

  function renderOutliner() {
    const frag = document.createDocumentFragment();
    for (const [title, test, dot] of GROUPS) {
      const items = store.items.filter(test);
      const head = document.createElement('li');
      head.className = 'outliner-group';
      head.textContent = title;
      frag.appendChild(head);
      if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'outliner-empty';
        empty.textContent = 'None';
        frag.appendChild(empty);
      }
      for (const it of items) {
        const li = document.createElement('li');
        li.className = 'outliner-item';
        li.classList.toggle('is-selected', it.id === store.selectedId);
        li.classList.toggle('is-hidden', !it.visible);
        li.dataset.id = it.id;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(it.id === store.selectedId));
        const d = document.createElement('span');
        d.className = `dot dot-${dot}`;
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = it.name;
        li.append(d, name);
        if (it.type === 'sensor' && it.id === store.activeSensor()?.id) {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = 'active';
          tag.title = 'The echo chart and readouts show this sensor';
          li.appendChild(tag);
        }
        const eye = document.createElement('button');
        eye.className = 'eye';
        eye.textContent = it.visible ? '◉' : '○';
        eye.title = it.type === 'floor' ? (it.visible ? 'Floor reflects (click to turn off)' : 'Floor off') : it.visible ? 'Hide' : 'Show';
        li.appendChild(eye);
        frag.appendChild(li);
      }
    }
    outliner.replaceChildren(frag);
    $('#scene-count').textContent = String(store.items.length);
  }

  outliner.addEventListener('click', (e) => {
    const li = e.target.closest('.outliner-item');
    if (!li) return;
    if (e.target.closest('.eye')) {
      const it = store.get(li.dataset.id);
      it.visible = !it.visible;
      renderOutliner();
      viewport.sync();
      bus.emit('scene', { source: 'visibility' });
      return;
    }
    selectItem(li.dataset.id);
  });

  function selectItem(id) {
    store.select(id);
    // Show the picked item's properties even if another tab is open.
    if (id) $('.panel-right > .tabs .tab[data-tab="props"]')?.click();
    renderOutliner();
    showInspector();
    viewport.sync();
    bus.emit('selection');
  }
  bus.on('pick', (id) => selectItem(id));

  // ── Inspector ──
  function inspectorKind(item) {
    if (!item) return 'none';
    if (item.type === 'sensor' || item.type === 'source') return item.type;
    return 'object';
  }

  function showInspector() {
    const item = store.selected;
    const kind = inspectorKind(item);
    for (const ins of $$('.inspector')) ins.hidden = ins.dataset.kind !== kind;
    const ins = $(`.inspector[data-kind="${kind}"]`);
    if (item && ins) {
      for (const el of $$('[data-show-for]', ins)) el.hidden = !el.dataset.showFor.split(' ').includes(item.type);
      for (const el of $$('[data-hide-for]', ins)) el.hidden = el.dataset.hideFor.split(' ').includes(item.type);
      applyShowWhen(ins, item);
    }
    fillScope($('[data-scope="item"]'));
    updateSourceCallout();
  }

  function scopeTarget(scope) {
    if (scope === 'item') return store.selected;
    return store.state[scope];
  }

  function formatOut(el, v) {
    if (el.dataset.omni && v >= Number(el.dataset.omni)) { el.textContent = 'omni'; return; }
    const dec = Number(el.dataset.dec || 0);
    el.textContent = fmt(v, dec) + (el.dataset.unit || '');
  }

  // data-show-when="emission=sensor,tone mode=pulsed": every condition must hold.
  function applyShowWhen(root, item) {
    for (const el of $$('[data-show-when]', root)) {
      el.hidden = !el.dataset.showWhen.split(' ').every((cond) => {
        const [key, values] = cond.split('=');
        return values.split(',').includes(String(item[key]));
      });
    }
  }

  function fillScope(scopeEl) {
    const target = scopeTarget(scopeEl.dataset.scope);
    if (!target) return;
    for (const el of $$('[data-bind]', scopeEl)) {
      if (el.closest('.inspector')?.hidden) continue;
      const v = getPath(target, el.dataset.bind);
      if (v === undefined || el === document.activeElement) continue;
      if (el.classList.contains('segmented')) {
        for (const b of $$('button', el)) b.classList.toggle('is-active', b.dataset.value === String(v));
      } else if (el.type === 'checkbox') {
        el.checked = !!v;
      } else if (el.type === 'number') {
        // data-scale shows a value in other units (e.g. metres as cm).
        el.value = String(Math.round(v * Number(el.dataset.scale || 1) * 1000) / 1000);
      } else {
        el.value = String(v);
      }
    }
    for (const el of $$('[data-out]', scopeEl)) {
      if (el.closest('.inspector')?.hidden) continue;
      const v = getPath(target, el.dataset.out);
      if (v !== undefined) formatOut(el, v);
    }
  }

  function fillAll() {
    for (const s of $$('[data-scope]')) fillScope(s);
    applyShowWhen($('#slice-settings'), store.state.display);
    updateDerived();
    updateSourceCallout();
  }

  function parseValue(el, eventType) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number' || el.type === 'range' || el.dataset.type === 'number') {
      const v = Number(el.value);
      if (el.value === '' || !Number.isFinite(v)) return undefined;
      const min = el.min !== '' ? Number(el.min) : -Infinity;
      const max = el.max !== '' ? Number(el.max) : Infinity;
      const scale = Number(el.dataset.scale || 1);
      if (v < min || v > max) {
        // Clamp once editing is done; while typing, just wait.
        if (eventType !== 'change') return undefined;
        const c = clamp(v, min, max);
        el.value = String(c);
        return c / scale;
      }
      return v / scale;
    }
    return el.value;
  }

  function onBoundInput(e) {
    const el = e.target.closest('[data-bind]');
    if (!el || el.classList.contains('segmented')) return;
    const scopeEl = el.closest('[data-scope]');
    if (!scopeEl) return;
    const value = parseValue(el, e.type);
    if (value === undefined) return;
    applyChange(scopeEl, el.dataset.bind, value);
  }
  document.addEventListener('input', onBoundInput);
  document.addEventListener('change', onBoundInput);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented[data-bind] button');
    if (!btn) return;
    const seg = btn.closest('.segmented');
    const scopeEl = seg.closest('[data-scope]');
    if (scopeEl) applyChange(scopeEl, seg.dataset.bind, btn.dataset.value);
  });

  function applyChange(scopeEl, path, value) {
    const scope = scopeEl.dataset.scope;
    const target = scopeTarget(scope);
    if (!target || getPath(target, path) === value) return;
    setPath(target, path, value);

    if (scope === 'item') {
      const it = target;
      if (path === 'material') {
        const m = MATERIALS[value];
        if (m && m.absorption != null) { it.absorption = m.absorption; it.scattering = m.scattering; }
      } else if (path === 'absorption' || path === 'scattering') {
        it.material = 'custom';
      } else if (path === 'model') {
        const m = SENSOR_MODELS[value];
        if (m && m.freq != null) { it.freq = m.freq; it.bw = m.bw; it.halfAngle = m.halfAngle; }
      } else if (it.type === 'sensor' && (path === 'freq' || path === 'bw' || path === 'halfAngle')) {
        it.model = 'custom';
      } else if (path === 'type') {
        // Keep auto-generated names in step with the shape: "Wall 2" → "Pipe 2".
        const m = it.name.match(/^(Wall|Block|Pipe|Sphere)(\b.*)$/);
        if (m) it.name = TYPE_LABELS[value] + m[2];
        showInspector();
      }
      applyShowWhen($(`.inspector[data-kind="${inspectorKind(it)}"]`), it);
      fillScope(scopeEl);
      updateSourceCallout();
      if (['name', 'type', 'material', 'freq'].includes(path)) renderOutliner();
      viewport.sync();
      bus.emit('scene', { source: 'inspector' });
    } else if (scope === 'env') {
      if (path.startsWith('room.')) viewport.rebuild();
      fillScope(scopeEl);
      updateDerived();
      bus.emit('scene', { source: 'env' });
    } else if (scope === 'sim') {
      fillScope(scopeEl);
      if (path === 'colorBy' || path === 'vizRangeDb') viewport.refreshLines();
      else bus.emit('scene', { source: 'sim' });
    } else if (scope === 'display') {
      fillAll();
      applyShowWhen($('#slice-settings'), store.state.display);
      viewport.sync();
      viewport.refreshLines();
      // The slice is computed by the tracer.
      if (path.startsWith('slice')) bus.emit('scene', { source: 'slice' });
    }
  }

  function updateDerived() {
    const s = store.activeSensor();
    const env = store.state.env;
    const c = speedOfSound(env.temperature);
    $('#env-c').textContent = `${fmt(c, 1)} m/s`;
    $('#env-c-assumed').textContent = `${fmt(C_ASSUMED, 1)} m/s`;
    if (s) {
      const f = s.freq * 1000;
      $('#env-at').textContent = `at ${fmt(s.freq, s.freq % 1 ? 1 : 0)} kHz`;
      $('#env-lambda').textContent = `${fmt(c / f * 1000, 2)} mm`;
      $('#env-alpha').textContent = `${fmt(airAbsorptionDbPerM(f, env.temperature, env.humidity, env.pressure), 2)} dB/m`;
    } else {
      $('#env-at').textContent = '';
      $('#env-lambda').textContent = '—';
      $('#env-alpha').textContent = '—';
    }
  }

  function updateSourceCallout() {
    const el = $('#source-band');
    const src = store.selected;
    if (!el || src?.type !== 'source') return;
    const s = store.activeSensor();
    el.replaceChildren();
    const b = document.createElement('b');
    if (!s) {
      b.textContent = 'No sensor. ';
      el.append(b, 'Add a sensor to see whether this source can disturb it.');
      return;
    }
    const lo = s.freq - s.bw / 2, hi = s.freq + s.bw / 2;
    const gDb = 10 * Math.log10(bandGain(s, src.freq, src.emission));
    const inBand = gDb > -25;
    b.textContent = gDb > -3 ? 'Can interfere: ' : inBand ? 'Partly filtered: ' : 'Mostly filtered out: ';
    const what = src.emission === 'hiss'
      ? `broadband hiss; ${s.name} hears the slice inside its ${fmt(lo, 1)}–${fmt(hi, 1)} kHz band`
      : `${fmt(src.freq, 1)} kHz vs ${s.name}'s ${fmt(lo, 1)}–${fmt(hi, 1)} kHz band`;
    el.append(b, `${what} (filter ${fmt(gDb, 1)} dB).`);
    if (!src.visible) {
      const note = document.createElement('span');
      note.className = 'muted';
      note.textContent = ' Hidden sources are silent.';
      el.append(note);
    }
    el.classList.toggle('callout-ok', !inBand);
  }

  // ── Right panel tabs ──
  $$('.panel-right > .tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.panel-right > .tabs .tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.panel-right .tab-page').forEach((p) => {
        const on = p.dataset.page === tab.dataset.tab;
        p.hidden = !on;
        p.classList.toggle('is-active', on);
      });
      fillAll();
    });
  });

  // ── Dock tabs ──
  $$('.dock .tab[data-pane]').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.dock .tab[data-pane]').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.dock-pane').forEach((p) => { p.hidden = p.dataset.pane !== tab.dataset.pane; });
      document.querySelector('.dock-body').classList.toggle('is-wide', tab.dataset.pane === 'sensors');
      bus.emit('pane', tab.dataset.pane);
    });
  });

  // ── Viewport tools + camera ──
  function setTool(name) {
    $$('.vp-tools [data-tool]').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === name));
    viewport.setTool(name);
  }
  $$('.vp-tools [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  const snapBtn = $('#btn-snap');
  function toggleSnap() {
    const on = !viewport.snap;
    viewport.setSnap(on);
    snapBtn.classList.toggle('is-active', on);
    toast(on ? 'Snapping on: 0.1 m, 15°' : 'Snapping off');
  }
  snapBtn.addEventListener('click', toggleSnap);
  function resetView() {
    $$('.vp-views [data-view]').forEach((x) => x.classList.toggle('is-active', x.dataset.view === 'persp'));
    viewport.setView('persp');
  }
  function focusSelected() {
    if (!viewport.frameSelected()) toast('Select something to focus on');
  }
  $('#btn-reset-view').addEventListener('click', resetView);

  // Zoom slider: logarithmic in camera distance, top = closest.
  const zoomSlider = $('#zoom-slider');
  const zoomToSlider = (d) => {
    const lo = Math.log(viewport.minDistance), hi = Math.log(viewport.maxDistance);
    return Math.round(1000 * (hi - Math.log(d)) / (hi - lo));
  };
  const sliderToZoom = (v) => {
    const lo = Math.log(viewport.minDistance), hi = Math.log(viewport.maxDistance);
    return Math.exp(hi - (v / 1000) * (hi - lo));
  };
  viewport.onZoom((d) => {
    if (document.activeElement !== zoomSlider) zoomSlider.value = String(zoomToSlider(d));
    $('#zoom-readout').textContent = `${fmt(d, d < 10 ? 1 : 0)} m`;
  });
  zoomSlider.addEventListener('input', () => viewport.setDistance(sliderToZoom(Number(zoomSlider.value))));
  $('#btn-zoom-in').addEventListener('click', () => viewport.zoomBy(1 / 1.15));
  $('#btn-zoom-out').addEventListener('click', () => viewport.zoomBy(1.15));
  $('#btn-focus').addEventListener('click', focusSelected);
  $$('.vp-views [data-view]').forEach((b) => {
    b.addEventListener('click', () => {
      $$('.vp-views [data-view]').forEach((x) => x.classList.toggle('is-active', x === b));
      viewport.setView(b.dataset.view);
    });
  });

  // ── Add / delete / duplicate ──
  const ADD_DEFAULTS = {
    sensor: () => ({ pos: { x: -2, y: 1, z: 0 } }),
    source: () => ({ pos: { x: 0, y: 1, z: 2 } }),
  };
  $$('.add-tile').forEach((b) => {
    b.addEventListener('click', () => {
      const type = b.dataset.add;
      const n = store.items.length;
      const over = ADD_DEFAULTS[type]?.() || {};
      // Nudge new items so they don't all land in the same spot.
      const jitter = ((n * 0.37) % 1.2) - 0.6;
      const base = makeItem(type).pos;
      over.pos = { ...base, ...(over.pos || {}) };
      over.pos.z += jitter;
      const item = store.add(type, over);
      renderOutliner();
      viewport.sync();
      selectItem(item.id);
      if (type !== 'sensor' && type !== 'source') setTool('move');
      bus.emit('scene', { source: 'add' });
      toast(`${item.name} added. Drag the arrows to move it.`);
    });
  });

  function deleteSelected() {
    const it = store.selected;
    if (!it) return;
    if (it.type === 'floor') { toast('The floor can be turned off with its eye icon, not deleted'); return; }
    store.remove(it.id);
    renderOutliner();
    viewport.sync();
    showInspector();
    bus.emit('scene', { source: 'delete' });
    toast(`${it.name} deleted`);
  }

  function duplicateSelected() {
    const it = store.selected;
    if (!it || it.type === 'floor') return;
    const copy = store.duplicate(it.id);
    renderOutliner();
    viewport.sync();
    selectItem(copy.id);
    bus.emit('scene', { source: 'add' });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'delete') deleteSelected();
    if (b.dataset.action === 'duplicate') duplicateSelected();
  });

  // ── Files + presets ──
  function loadScene(fn) {
    fn();
    viewport.rebuild();
    renderOutliner();
    showInspector();
    fillAll();
    sim.clearHistory();
    sim.reset();
    bus.emit('scene', { source: 'load' });
    resetHistory();
    viewport.setView('persp');
  }

  $('#btn-new').addEventListener('click', () => {
    loadScene(() => store.loadPreset('empty'));
    toast('New scene');
  });

  const fileInput = $('#file-input');
  $('#btn-open').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.items)) throw new Error('no items');
      loadScene(() => store.load(data));
      toast(`Opened ${file.name}`);
    } catch (err) {
      toast(`Couldn't open ${file.name}: not a Soundwave Bounce scene`);
    }
  });

  $('#btn-save').addEventListener('click', () => {
    const blob = new Blob([store.serialize()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'soundwave-scene.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Scene saved as soundwave-scene.json');
  });

  const presetsBtn = $('#btn-presets');
  const menu = $('#presets-menu');
  for (const [key, p] of Object.entries(PRESETS)) {
    if (key === 'empty') continue;
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.dataset.preset = key;
    b.textContent = p.label;
    menu.appendChild(b);
  }
  function setMenu(open) {
    menu.hidden = !open;
    presetsBtn.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button')?.focus();
  }
  presetsBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    setMenu(false);
    loadScene(() => store.loadPreset(b.dataset.preset));
    toast(`Loaded "${PRESETS[b.dataset.preset].label}"`);
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.menu-wrap')) setMenu(false); });

  function download(name, href) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (href.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  const blobUrl = (text, type) => URL.createObjectURL(new Blob([text], { type }));

  // ── Export ──
  const exportBtn = $('#btn-export');
  const exportMenu = $('#export-menu');
  function setExportMenu(open) {
    exportMenu.hidden = !open;
    exportBtn.setAttribute('aria-expanded', String(open));
    if (open) exportMenu.querySelector('button')?.focus();
  }
  exportBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(false); setExportMenu(exportMenu.hidden); });
  exportMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    setExportMenu(false);
    if (b.dataset.export === 'png') {
      download('soundwave-view.png', viewport.screenshot());
    } else if (b.dataset.export === 'echo') {
      const csv = sim.echoCsv();
      if (!csv) { toast('Add a sensor first'); return; }
      download('soundwave-echo.csv', blobUrl(csv, 'text/csv'));
    } else {
      download('soundwave-ray-log.csv', blobUrl(sim.logCsv(), 'text/csv'));
    }
    toast('Exported');
  });
  document.addEventListener('click', (e) => { if (!exportMenu.hidden && !e.target.closest('.menu-wrap')) setExportMenu(false); });

  // ── Undo / redo ──
  // Snapshots of the scene (items + environment), taken once edits settle.
  const undoStack = [];
  const redoStack = [];
  let snapTimer = null;
  const snapshot = () => JSON.stringify({ items: store.state.items, env: store.state.env });
  function resetHistory() {
    undoStack.length = 0;
    redoStack.length = 0;
    undoStack.push(snapshot());
    updateUndoButtons();
  }
  function recordSoon() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => {
      const s = snapshot();
      if (s === undoStack[undoStack.length - 1]) return;
      undoStack.push(s);
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      updateUndoButtons();
    }, 350);
  }
  function updateUndoButtons() {
    $('#btn-undo').disabled = undoStack.length < 2;
    $('#btn-redo').disabled = redoStack.length === 0;
  }
  function restore(snap) {
    const data = JSON.parse(snap);
    store.state.items = data.items;
    store.state.env = data.env;
    if (!store.get(store.selectedId)) store.selectedId = null;
    if (!store.get(store.activeSensorId)) store.activeSensorId = store.activeSensor()?.id ?? null;
    viewport.rebuild();
    renderOutliner();
    showInspector();
    fillAll();
    bus.emit('scene', { source: 'undo' });
  }
  function undo() {
    clearTimeout(snapTimer);
    // Capture edits that haven't been recorded yet, so they can be redone.
    const now = snapshot();
    if (now !== undoStack[undoStack.length - 1]) undoStack.push(now);
    if (undoStack.length < 2) return;
    redoStack.push(undoStack.pop());
    restore(undoStack[undoStack.length - 1]);
    updateUndoButtons();
  }
  function redo() {
    if (!redoStack.length) return;
    const s = redoStack.pop();
    undoStack.push(s);
    restore(s);
    updateUndoButtons();
  }
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  bus.on('scene', (e) => {
    const src = e?.source;
    if (src === 'undo' || src === 'load' || src === 'gizmo' || src === 'sim' || src === 'slice') return;
    recordSoon();
  });

  // ── Transport ──
  $('#btn-play').addEventListener('click', () => sim.togglePlay());
  $('#btn-reset').addEventListener('click', () => sim.reset());
  $('#btn-back').addEventListener('click', () => sim.step(-1));
  $('#btn-fwd').addEventListener('click', () => sim.step(1));
  $('#sel-speed').addEventListener('change', (e) => sim.setSpeed(Number(e.target.value)));
  $('#chk-loop').addEventListener('change', (e) => sim.setLoop(e.target.checked));

  // ── Help ──
  const help = $('#help-dialog');
  function showHelpPage(page) {
    $$('[data-help-tab]', help).forEach((b) => {
      const on = b.dataset.helpTab === page;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('[data-help-page]', help).forEach((p) => { p.hidden = p.dataset.helpPage !== page; });
    $('.help-pages', help).scrollTop = 0;
  }
  function openHelp(page = 'start') {
    showHelpPage(page);
    if (!help.open) help.showModal();
  }
  $('#btn-help').addEventListener('click', () => openHelp());
  $$('[data-help-tab]', help).forEach((b) => b.addEventListener('click', () => showHelpPage(b.dataset.helpTab)));
  // "?" buttons inside settings group headings: open help without toggling the group.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.help-link');
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    openHelp(link.dataset.help);
  }, true);

  // ── Keyboard ──
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || help.open) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'escape') {
      if (!menu.hidden) setMenu(false);
      else if (!exportMenu.hidden) setExportMenu(false);
      else selectItem(null);
      return;
    }
    const tools = { q: 'select', w: 'move', e: 'rotate', r: 'scale' };
    if (tools[k]) { setTool(tools[k]); return; }
    if (k === 's') { toggleSnap(); return; }
    if (k === '?' ) { openHelp(); return; }
    if (k === 'h' || k === 'home') { resetView(); return; }
    if (k === 'f') { focusSelected(); return; }
    if (k === '+' || k === '=') { viewport.zoomBy(1 / 1.15); return; }
    if (k === '-' || k === '_') { viewport.zoomBy(1.15); return; }
    if (k === ' ') { e.preventDefault(); sim.togglePlay(); return; }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelected(); }
  });

  // Gizmo drags change position/rotation/size: keep the inspector in step.
  bus.on('scene', (e) => {
    if (e?.source === 'gizmo') fillScope($('[data-scope="item"]'));
  });
  bus.on('selection', updateDerived);
  bus.on('slice', (info) => {
    const el = $('#legend-slice');
    el.hidden = !info;
    if (!info) return;
    const r = (v) => `${fmt(Math.round(v), 0)}`;
    $('#legend-slice-top').textContent = `${r(info.top)} dB`;
    $('#legend-slice-mid').textContent = r(info.top - info.range / 2);
    $('#legend-slice-bot').textContent = r(info.top - info.range);
  });

  resetHistory();
  return { renderOutliner, showInspector, fillAll, toast, resetHistory };
}
