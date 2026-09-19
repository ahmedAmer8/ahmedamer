/* Relationship graph: a small force simulation on canvas.
   The written index below the canvas carries the same information, so this is
   purely an alternative view — it is never the only way to reach a page. */
(() => {
  'use strict';
  const canvas = document.querySelector('[data-graph]');
  if (!canvas || !canvas.getContext) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  const BASE = document.querySelector('link[rel="stylesheet"]').href
    .replace(/\/static\/css\/site\.css.*$/, '');

  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let INK, INK2, INK3, RULE, OPEN, EXP, PAPER;
  const readColours = () => {
    INK = css('--ink'); INK2 = css('--ink-2'); INK3 = css('--ink-3');
    RULE = css('--rule'); OPEN = css('--open'); EXP = css('--experiment');
    PAPER = css('--paper-2');
  };
  readColours();

  const GROUP = {
    project:    { r: 8,   colour: () => INK },
    lesson:     { r: 5.5, colour: n => (n.status === 'unfixed' || n.status === 'unresolved') ? OPEN : INK2 },
    note:       { r: 5.5, colour: () => EXP },
    technology: { r: 3.5, colour: () => INK3 },
    topic:      { r: 3.5, colour: () => INK3 },
  };

  let nodes = [], links = [], view = { x: 0, y: 0, k: 1 };
  let dragging = null, panning = null, hover = null, raf = null, alpha = 1;
  let W = 0, H = 0, dpr = 1;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  fetch(`${BASE}/graph.json`).then(r => r.json()).then(data => {
    const index = new Map();
    nodes = data.nodes.map((n, i) => {
      const a = (i / data.nodes.length) * Math.PI * 2;
      const node = Object.assign({}, n, {
        x: Math.cos(a) * 180 + (Math.random() - 0.5) * 40,
        y: Math.sin(a) * 180 + (Math.random() - 0.5) * 40,
        vx: 0, vy: 0, deg: 0,
      });
      index.set(n.id, node);
      return node;
    });
    links = data.links
      .map(l => ({ s: index.get(l.s), t: index.get(l.t), k: l.k }))
      .filter(l => l.s && l.t);
    links.forEach(l => { l.s.deg++; l.t.deg++; });

    resize();
    for (let i = 0; i < 400; i++) step();
    fit();
    alpha = reduced ? 0 : 0.25;
    draw();
    if (!reduced) run();
  }).catch(() => { canvas.hidden = true; });

  function step() {
    const centre = 0.0009;
    for (const n of nodes) {
      n.vx -= n.x * centre; n.vy -= n.y * centre;
    }
    /* repulsion, O(n^2) — the graph is small enough that a quadtree is not worth it */
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
        if (d2 > 160000) continue;
        const f = 3200 / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 115) * 0.016;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
    }
    for (const n of nodes) {
      if (n === dragging) { n.vx = n.vy = 0; continue; }
      n.vx *= 0.86; n.vy *= 0.86;
      n.x += n.vx * alpha; n.y += n.vy * alpha;
    }
  }

  function fit() {
    if (!nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x;
      if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y;
    }
    const pad = 30;
    const k = Math.min((W - pad * 2) / Math.max(1, x1 - x0),
                       (H - pad * 2) / Math.max(1, y1 - y0));
    view.k = Math.min(1.5, Math.max(0.62, k));
    view.x = -((x0 + x1) / 2) * view.k;
    view.y = -((y0 + y1) / 2) * view.k;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    ctx.scale(view.k, view.k);

    const near = hover
      ? new Set(links.flatMap(l => l.s === hover ? [l.t] : l.t === hover ? [l.s] : []))
      : null;

    ctx.lineWidth = 1 / view.k;
    for (const l of links) {
      const lit = hover && (l.s === hover || l.t === hover);
      ctx.strokeStyle = lit ? INK2 : RULE;
      ctx.globalAlpha = hover ? (lit ? 1 : 0.22) : 0.65;
      ctx.beginPath();
      ctx.moveTo(l.s.x, l.s.y);
      ctx.lineTo(l.t.x, l.t.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const n of nodes) {
      const g = GROUP[n.group] || GROUP.topic;
      const dim = hover && n !== hover && !near.has(n);
      ctx.globalAlpha = dim ? 0.25 : 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, g.r, 0, Math.PI * 2);
      ctx.fillStyle = g.colour(n);
      ctx.fill();
      if (n === hover) {
        ctx.lineWidth = 2 / view.k;
        ctx.strokeStyle = PAPER;
        ctx.stroke();
      }
    }

    const placed = [];
    const order = nodes.slice().sort((a, b) =>
      (b === hover) - (a === hover) || (b.w || 0) - (a.w || 0));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of order) {
      const g = GROUP[n.group] || GROUP.topic;
      const near2 = hover ? near : null;
      const show = n === hover || (near2 && near2.has(n)) ||
                   (!hover && (n.group === 'project' || view.k > 1.05));
      if (!show || view.k < 0.4) continue;
      const size = n.group === 'project' ? 12 : 11;
      ctx.font = `${size}px "IBM Plex Mono", monospace`;
      const label = n.label.length > 32 ? n.label.slice(0, 31) + '…' : n.label;
      const w = ctx.measureText(label).width;
      const x = n.x, y = n.y + g.r + 5;
      const box = { x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + size + 2 };
      if (placed.some(b => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      placed.push(box);
      ctx.globalAlpha = (hover && n !== hover && !near2.has(n)) ? 0.3 : 1;
      ctx.fillStyle = n === hover ? INK : INK2;
      ctx.fillText(label, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function run() {
    step();
    draw();
    alpha *= 0.994;
    raf = alpha > 0.02 ? requestAnimationFrame(run) : null;
  }
  const kick = () => { alpha = Math.max(alpha, 0.5); if (!raf && !reduced) run(); };

  const toWorld = e => {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - W / 2 - view.x) / view.k,
      y: (e.clientY - r.top - H / 2 - view.y) / view.k,
    };
  };
  const pick = p => {
    let best = null, bd = 14 / view.k;
    for (const n of nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    const n = pick(toWorld(e));
    if (n) { dragging = n; kick(); }
    else panning = { x: e.clientX - view.x, y: e.clientY - view.y };
  });
  canvas.addEventListener('pointermove', e => {
    if (dragging) {
      const p = toWorld(e);
      dragging.x = p.x; dragging.y = p.y;
      draw(); kick(); return;
    }
    if (panning) { view.x = e.clientX - panning.x; view.y = e.clientY - panning.y; draw(); return; }
    const n = pick(toWorld(e));
    if (n !== hover) {
      hover = n;
      canvas.style.cursor = n ? (n.url ? 'pointer' : 'default') : 'grab';
      canvas.title = n ? n.label : '';
      draw();
    }
  });
  const end = e => {
    if (dragging) { dragging = null; kick(); }
    panning = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('click', e => {
    const n = pick(toWorld(e));
    if (n && n.url) location.href = n.url;
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    view.k = Math.min(2.6, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.11 : 0.9)));
    draw();
  }, { passive: false });

  addEventListener('resize', () => { resize(); fit(); draw(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    setTimeout(() => { readColours(); draw(); }, 30);
  });
  const themeBtn = document.getElementById('themebtn');
  if (themeBtn) themeBtn.addEventListener('click', () => {
    setTimeout(() => { readColours(); draw(); }, 30);
  });
})();
