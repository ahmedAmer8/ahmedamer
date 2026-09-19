/* Behaviour for ahmedamer. No dependencies.
   Four things: search, the trace, the section rail, and content filters.
   Everything here is an enhancement — the pages work without it. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const BASE = document.querySelector('link[rel="stylesheet"]').href
    .replace(/\/static\/css\/site\.css.*$/, '');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- theme */
  const themeBtn = $('#themebtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme
        || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) { /* private mode */ }
    });
  }

  /* --------------------------------------------------------------- search */
  const dialog = $('#search');
  const input = $('#q');
  const results = $('#results');
  let docs = null, loading = null, sel = 0, lastFocus = null;

  const load = () => {
    if (docs) return Promise.resolve(docs);
    if (!loading) {
      loading = fetch(`${BASE}/search-index.json`)
        .then(r => r.json())
        .then(d => (docs = d))
        .catch(() => (docs = []));
    }
    return loading;
  };

  const openSearch = () => {
    lastFocus = document.activeElement;
    dialog.hidden = false;
    input.value = '';
    results.innerHTML = '';
    input.focus();
    load().then(() => render(''));
  };

  const closeSearch = () => {
    dialog.hidden = true;
    if (lastFocus) lastFocus.focus();
  };

  const esc = s => String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const mark = (text, terms) => {
    let out = esc(text);
    terms.forEach(t => {
      out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
        '<mark>$1</mark>');
    });
    return out;
  };

  const score = (d, terms) => {
    let s = 0;
    const title = d.t.toLowerCase(), sum = (d.s || '').toLowerCase();
    const princ = (d.p || '').toLowerCase(), body = (d.b || '').toLowerCase();
    const tags = (d.tg || []).join(' ').toLowerCase();
    for (const t of terms) {
      let hit = 0;
      if (title.includes(t)) hit += title.startsWith(t) ? 14 : 10;
      if (tags.includes(t)) hit += 7;
      if (sum.includes(t)) hit += 5;
      if (princ.includes(t)) hit += 4;
      if (body.includes(t)) hit += 2;
      if (!hit) return 0;
      s += hit;
    }
    if (d.k === 'technology' || d.k === 'topic') s += 3;
    if (d.st === 'unfixed' || d.st === 'unresolved') s += 1;
    return s;
  };

  const render = q => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    let list;
    if (!terms.length) {
      list = (docs || []).filter(d => d.k === 'lessons' || d.k === 'projects').slice(0, 8);
    } else {
      list = (docs || [])
        .map(d => [score(d, terms), d])
        .filter(([s]) => s > 0)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 10)
        .map(([, d]) => d);
    }
    sel = 0;
    if (!list.length) {
      results.innerHTML = `<li class="search__empty">Nothing matches “${esc(q)}”.</li>`;
      return;
    }
    results.innerHTML = list.map((d, i) => {
      const rel = d.rel && d.rel.length
        ? `<span class="search__rel">${d.rel.map(r => esc(r.t)).join(' · ')}</span>` : '';
      const status = d.st ? ` — ${esc(d.st)}` : '';
      return `<li role="option" aria-selected="${i === 0}">
        <a href="${d.u}">
          <span class="search__kind">${esc(d.k)}${status}</span>
          <span class="search__title">${mark(d.t, terms)}</span>
          ${d.s ? `<span class="search__sum">${mark(d.s, terms)}</span>` : ''}
          ${rel}
        </a></li>`;
    }).join('');
  };

  const move = dir => {
    const items = $$('li[role="option"]', results);
    if (!items.length) return;
    items[sel].setAttribute('aria-selected', 'false');
    sel = (sel + dir + items.length) % items.length;
    items[sel].setAttribute('aria-selected', 'true');
    items[sel].scrollIntoView({ block: 'nearest' });
  };

  if (dialog) {
    $('#searchbtn').addEventListener('click', openSearch);
    input.addEventListener('input', () => render(input.value));
    dialog.addEventListener('mousedown', e => { if (e.target === dialog) closeSearch(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        const a = $('li[aria-selected="true"] a', results);
        if (a) { e.preventDefault(); location.href = a.href; }
      } else if (e.key === 'Tab') {
        e.preventDefault();  /* the dialog is a two-stop trap: input and results */
      }
    });
  }

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.key === 'Escape' && dialog && !dialog.hidden) { closeSearch(); return; }
    if (e.key === '/' && !typing && dialog) { e.preventDefault(); openSearch(); return; }
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && dialog) {
      e.preventDefault(); openSearch();
    }
  });

  /* ---------------------------------------------------------------- trace */
  const traceEl = $('[data-trace]');
  if (traceEl) {
    const steps = $$('.trace__step', traceEl);
    const show = i => {
      steps.forEach((btn, n) => {
        const on = n === i;
        btn.setAttribute('aria-expanded', String(on));
        const panel = document.getElementById(btn.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
    };
    const current = () => steps.findIndex(b => b.getAttribute('aria-expanded') === 'true');
    steps.forEach((btn, i) => {
      btn.addEventListener('click', () => show(current() === i ? -1 : i));
    });
    document.addEventListener('keydown', e => {
      if (dialog && !dialog.hidden) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = current();
      const next = e.key === 'ArrowRight'
        ? Math.min(steps.length - 1, i + 1)
        : Math.max(0, i - 1);
      if (next === i) return;
      e.preventDefault();
      show(next);
      steps[next].focus({ preventScroll: true });
    });
  }

  /* ----------------------------------------------------------------- rail */
  const rail = $('[data-rail]');
  const prose = $('[data-prose]');
  if (rail && prose) {
    const heads = $$('h2', prose);
    const traceHead = traceEl ? [{ el: traceEl, text: 'The investigation', id: 'trace' }] : [];
    const items = traceHead.concat(heads.map((h, i) => {
      if (!h.id) h.id = 'h-' + (i + 1);
      return { el: h, text: h.textContent, id: h.id };
    }));
    if (items.length > 1) {
      rail.innerHTML = items.map((it, i) =>
        `<a href="#${it.id}"><span class="tick-n">${String(i + 1).padStart(2, '0')}</span><span>${esc(it.text)}</span></a>`
      ).join('');
      const links = $$('a', rail);
      const seen = new Map();
      const io = new IntersectionObserver(entries => {
        entries.forEach(en => seen.set(en.target, en.isIntersecting));
        const active = items.findIndex(it => seen.get(it.el));
        links.forEach((a, i) => a.classList.toggle('is-current', i === active));
      }, { rootMargin: '-10% 0px -70% 0px' });
      items.forEach(it => io.observe(it.el));
    }
  }

  /* ------------------------------------------------------------- progress */
  const bar = $('#progress');
  if (bar && prose && !reduced) {
    bar.hidden = false;
    let ticking = false;
    const update = () => {
      const r = prose.getBoundingClientRect();
      const total = r.height - innerHeight;
      const done = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
      bar.style.width = (done * 100).toFixed(2) + '%';
      ticking = false;
    };
    addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* -------------------------------------------------------------- filters */
  const filters = $('[data-filters]');
  const list = $('[data-list]');
  if (filters && list) {
    const rows = $$('.entry', list);
    const count = $('[data-count]');
    filters.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      $$('button', filters).forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      const f = btn.dataset.filter;
      let shown = 0;
      rows.forEach(row => {
        let ok = f === 'all';
        if (!ok) {
          const [key, val] = f.split(':');
          ok = row.dataset[key] === val;
        }
        row.hidden = !ok;
        if (ok) shown++;
      });
      if (count) count.textContent = `${shown} ${shown === 1 ? 'entry' : 'entries'}`;
    });
  }
})();
