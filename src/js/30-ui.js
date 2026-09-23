// ─────────────────────────────────────────────────────────────
// UI wiring — preview only. Controls respond visually (tabs, selection,
// slider read-outs, toggles) but nothing drives a simulation yet.
// ─────────────────────────────────────────────────────────────

function initUI({ viewport }) {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // Right panel tabs
  $$('.panel-right > .tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.panel-right > .tabs .tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.panel-right .tab-page').forEach((p) => {
        const on = p.dataset.page === tab.dataset.tab;
        p.hidden = !on;
        p.classList.toggle('is-active', on);
      });
    });
  });

  // Dock tabs (visual only)
  $$('.dock .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.dock .tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    });
  });

  // Outliner selection → inspector + 3D highlight
  function select(item) {
    $$('.outliner-item').forEach((i) => i.classList.toggle('is-selected', i === item));
    const kind = item.dataset.kind;
    $$('.inspector').forEach((ins) => { ins.hidden = ins.dataset.kind !== kind; });
    // Jump to the Properties tab when something is picked.
    $('.panel-right > .tabs .tab[data-tab="props"]').click();
    viewport?.select(item.dataset.id);
  }
  $$('.outliner-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.eye')) return;
      select(item);
    });
  });
  $$('.outliner .eye').forEach((eye) => {
    eye.addEventListener('click', () => {
      const off = eye.textContent === '◉';
      eye.textContent = off ? '○' : '◉';
      eye.title = off ? 'Show' : 'Hide';
    });
  });

  // Segmented controls
  $$('.segmented').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      $$('button', seg).forEach((b) => b.classList.toggle('is-active', b === btn));
    });
  });

  // Viewport tool + camera buttons (one active per group)
  for (const groupSel of ['.vp-tools', '.vp-views']) {
    const group = $(groupSel);
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn');
      if (!btn || btn.title === 'Snap to grid') {
        btn?.classList.toggle('is-active');
        return;
      }
      $$('.btn', group).forEach((b) => { if (b.title !== 'Snap to grid') b.classList.toggle('is-active', b === btn); });
    });
  }
  const toolKeys = { q: 0, w: 1, e: 2, r: 3 };
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    const i = toolKeys[e.key.toLowerCase()];
    if (i === undefined) return;
    $$('.vp-tools .btn')[i]?.click();
  });

  // Slider read-outs: keep the output's unit text, swap the number.
  $$('.slider').forEach((wrap) => {
    const input = $('input[type="range"]', wrap);
    const out = $('output', wrap);
    const template = out.textContent;
    const scale = template.match(/^0\.\d+$/) ? 0.01 : 1; // 0–100 slider shown as 0.00–1.00
    input.addEventListener('input', () => {
      const v = Number(input.value) * scale;
      const text = scale === 1 ? String(Math.round(v)) : v.toFixed(2);
      out.textContent = template.replace(/[−-]?\d+(\.\d+)?/, text.replace('-', '−'));
    });
  });

  // Placeholder: remind that actions aren't wired yet.
  const toast = document.createElement('div');
  toast.className = 'toast';
  document.body.appendChild(toast);
  let toastTimer;
  const notWired = (what) => {
    toast.textContent = `${what}: not wired up yet (UI preview)`;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
  };
  $$('.topbar .btn, .add-tile, .inspector-head .btn-danger').forEach((b) => {
    b.addEventListener('click', () => notWired(b.title || b.textContent.trim()));
  });
}
