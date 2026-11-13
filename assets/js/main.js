(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Theme toggle ----------
  function isDark() {
    var t = root.getAttribute("data-theme");
    if (t) return t === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  var toggle = document.querySelector(".theme-toggle");
  if (toggle) toggle.addEventListener("click", function () {
    var next = isDark() ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
  });

  // ---------- Year ----------
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  // ---------- Before/after dumbbell chart ----------
  var metrics = [
    { label: "p90 response latency", note: "seconds", before: 38.4, after: 11.9, unit: "s", lowerBetter: true },
    { label: "p99 response latency", note: "seconds", before: 83.0, after: 26.2, unit: "s", lowerBetter: true },
    { label: "Responses slower than 30s", note: "share of replies", before: 14.0, after: 0.6, unit: "%", lowerBetter: true },
    { label: "False rejections", note: "AI validation layer, replay of real traffic", before: 68.4, after: 3.9, unit: "%", lowerBetter: true },
    { label: "Task completion", note: "same replay", before: 30, after: 86, unit: "%", lowerBetter: false }
  ];
  var NS = "http://www.w3.org/2000/svg";
  var host = document.querySelector(".dumbbells");
  var tip = document.querySelector("#before-after .tooltip");
  var card = document.getElementById("before-after");
  var tbody = document.querySelector("#before-after tbody");

  function fmt(v, u) { return (u === "%" ? v.toFixed(1).replace(/\.0$/, "") : v.toFixed(1)) + u; }
  function change(m) {
    var pct = Math.round(Math.abs(m.after - m.before) / m.before * 100);
    return (m.after < m.before ? "−" : "+") + pct + "%";
  }
  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function showTip(evt, m) {
    tip.hidden = false;
    tip.textContent = m.label + ": " + fmt(m.before, m.unit) + " → " + fmt(m.after, m.unit) + " (" + change(m) + ")";
    var r = card.getBoundingClientRect();
    var x = evt.clientX - r.left + 12, yy = evt.clientY - r.top - 40;
    var maxX = r.width - tip.offsetWidth - 8;
    tip.style.left = Math.max(8, Math.min(x, maxX)) + "px";
    tip.style.top = yy + "px";
  }
  function hideTip() { tip.hidden = true; }

  function draw() {
    if (!host) return;
    host.innerHTML = "";
    metrics.forEach(function (m) {
      var row = document.createElement("div");
      row.className = "db-row";
      var lab = document.createElement("div");
      lab.className = "db-label";
      lab.innerHTML = m.label + "<span>" + m.note + "</span>";
      row.appendChild(lab);

      var wrap = document.createElement("div");
      row.appendChild(wrap);
      host.appendChild(row);
      var W = Math.max(wrap.clientWidth, 200), H = 44, pad = 28, cy = 26;
      var max = Math.max(m.before, m.after) * 1.05;
      var sx = function (v) { return pad + (v / max) * (W - pad * 2); };

      var svg = el("svg", { class: "db-svg", viewBox: "0 0 " + W + " " + H, width: W, height: H, "aria-hidden": "true" });
      svg.appendChild(el("line", { class: "track", x1: pad, x2: W - pad, y1: cy, y2: cy }));
      var xb = sx(m.before), xa = sx(m.after);
      var link = el("line", { class: "link", x1: xb, x2: xb, y1: cy, y2: cy });
      svg.appendChild(link);
      svg.appendChild(el("circle", { class: "before", cx: xb, cy: cy, r: 7 }));
      var dot = el("circle", { class: "after", cx: xb, cy: cy, r: 8 });
      svg.appendChild(dot);

      var tb = el("text", { class: "val", x: xb, y: cy - 14, "text-anchor": "middle" });
      tb.textContent = fmt(m.before, m.unit);
      var ta = el("text", { class: "val strong", x: xa, y: cy - 14, "text-anchor": "middle" });
      ta.textContent = fmt(m.after, m.unit) + "  " + change(m);
      // keep the "after" label inside the plot when it sits at an edge
      if (xa < 60) ta.setAttribute("text-anchor", "start"), ta.setAttribute("x", Math.max(2, xa - 8));
      if (xa > W - 60) ta.setAttribute("text-anchor", "end"), ta.setAttribute("x", Math.min(W - 2, xa + 8));
      if (xb > W - 40) tb.setAttribute("text-anchor", "end"), tb.setAttribute("x", Math.min(W - 2, xb + 8));
      if (Math.abs(xa - xb) < 70) tb.setAttribute("y", cy + 20);
      svg.appendChild(tb);
      svg.appendChild(ta);

      var hit = el("rect", { class: "hit", x: 0, y: 0, width: W, height: H });
      hit.addEventListener("mousemove", function (e) { showTip(e, m); });
      hit.addEventListener("mouseleave", hideTip);
      svg.appendChild(hit);
      wrap.appendChild(svg);

      // animate the "after" dot travelling from the before value
      function finish() {
        dot.setAttribute("cx", xa);
        link.setAttribute("x2", xa);
      }
      if (reduce || !("IntersectionObserver" in window)) { finish(); return; }
      ta.style.opacity = 0;
      var io = new IntersectionObserver(function (ents) {
        if (!ents[0].isIntersecting) return;
        io.disconnect();
        var t0 = null;
        function step(ts) {
          if (!t0) t0 = ts;
          var p = Math.min(1, (ts - t0) / 900);
          var e = 1 - Math.pow(1 - p, 3);
          var x = xb + (xa - xb) * e;
          dot.setAttribute("cx", x);
          link.setAttribute("x2", x);
          if (p < 1) requestAnimationFrame(step); else { ta.style.transition = "opacity .3s"; ta.style.opacity = 1; }
        }
        requestAnimationFrame(step);
      }, { threshold: 0.4 });
      io.observe(row);
    });
  }

  if (tbody) {
    metrics.forEach(function (m) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + m.label + "</td><td>" + fmt(m.before, m.unit) + "</td><td>" + fmt(m.after, m.unit) + "</td><td>" + change(m) + "</td>";
      tbody.appendChild(tr);
    });
  }
  draw();
  var rt;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { reduce = true; draw(); }, 150); });

  // ---------- Count-up stats ----------
  var nums = document.querySelectorAll("[data-count]");
  function countUp(n) {
    var target = +n.getAttribute("data-count");
    var comma = n.getAttribute("data-format") === "comma";
    var t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / 1100);
      var v = Math.round(target * (1 - Math.pow(1 - p, 3)));
      n.textContent = comma ? v.toLocaleString("en-US") : v;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (!reduce && "IntersectionObserver" in window) {
    var io2 = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); io2.unobserve(e.target); } });
    }, { threshold: 0.6 });
    nums.forEach(function (n) { io2.observe(n); });
  }

  // ---------- Reveal on scroll + active nav ----------
  if (!reduce && "IntersectionObserver" in window) {
    var items = document.querySelectorAll(".sec-head, .stat, .chart-card, .pillar, .node, .skill-group, .project, .cert-list li, .journey li");
    var io3 = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io3.unobserve(e.target); } });
    }, { threshold: 0.12 });
    items.forEach(function (it) { it.classList.add("reveal"); io3.observe(it); });
  }
  var links = document.querySelectorAll(".nav-links a");
  if ("IntersectionObserver" in window) {
    var io4 = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    document.querySelectorAll("main section[id]").forEach(function (s) { io4.observe(s); });
  }
})();
