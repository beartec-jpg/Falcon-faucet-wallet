/**
 * Falcon Ledger — homepage interactions
 * Hero canvas network · load / scroll reveals · nav
 */

(function () {
  "use strict";

  /* ---------- Year ---------- */
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Header scroll state ---------- */
  const header = document.querySelector(".site-header");
  const onScrollHeader = () => {
    if (!header) return;
    header.classList.toggle("scrolled", window.scrollY > 24);
  };
  window.addEventListener("scroll", onScrollHeader, { passive: true });
  onScrollHeader();

  /* ---------- Mobile nav ---------- */
  const toggle = document.querySelector(".nav-toggle");
  const menu = document.getElementById("nav-menu");

  if (toggle && menu) {
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.classList.toggle("open", open);
      document.body.style.overflow = open ? "hidden" : "";
    };

    toggle.addEventListener("click", () => {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setOpen(false));
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 768) setOpen(false);
    });
  }

  /* ---------- Hero load animations ---------- */
  const loadReveals = document.querySelectorAll(".reveal-load");
  requestAnimationFrame(() => {
    loadReveals.forEach((el) => {
      const delay = Number(el.dataset.delay || 0);
      setTimeout(() => el.classList.add("visible"), delay);
    });
  });

  /* ---------- Scroll-triggered reveals ---------- */
  const revealEls = document.querySelectorAll(".reveal");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion) {
    revealEls.forEach((el) => el.classList.add("visible"));
  } else if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );
    revealEls.forEach((el) => observer.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("visible"));
  }

  /* ---------- Hero canvas: soft network + particles ---------- */
  const canvas = document.getElementById("hero-canvas");
  if (!canvas || reduceMotion) return;

  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let dpr = 1;
  let particles = [];
  let animationId = 0;
  let mouse = { x: null, y: null };
  let running = true;

  const ACCENT = { r: 224, g: 168, b: 74 }; // brand gold neon
  const CONNECT_DIST = 140;
  const MOUSE_DIST = 160;

  function countForSize() {
    const area = width * height;
    return Math.min(90, Math.max(30, Math.floor(area / 18000)));
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
  }

  function initParticles() {
    const n = countForSize();
    particles = Array.from({ length: n }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.6 + 0.6,
      a: Math.random() * 0.4 + 0.25,
    }));
  }

  function step() {
    if (!running) return;
    ctx.clearRect(0, 0, width, height);

    // Soft geometric accents — faint hex grid feel
    drawSoftShapes();

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < -20) p.y = height + 20;
      if (p.y > height + 20) p.y = -20;

      // Gentle mouse attraction
      if (mouse.x != null) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < MOUSE_DIST && dist > 1) {
          p.vx += (dx / dist) * 0.008;
          p.vy += (dy / dist) * 0.008;
        }
      }

      // Dampen
      p.vx *= 0.995;
      p.vy *= 0.995;
      // Keep some drift
      if (Math.abs(p.vx) < 0.05) p.vx += (Math.random() - 0.5) * 0.02;
      if (Math.abs(p.vy) < 0.05) p.vy += (Math.random() - 0.5) * 0.02;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${p.a})`;
      ctx.fill();
    }

    // Connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < CONNECT_DIST) {
          const alpha = (1 - dist / CONNECT_DIST) * 0.18;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    animationId = requestAnimationFrame(step);
  }

  let shapePhase = 0;
  function drawSoftShapes() {
    shapePhase += 0.002;
    const cx = width * 0.5;
    const cy = height * 0.42;

    // Large faint ring
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(width, height) * 0.28 + Math.sin(shapePhase) * 8, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.04)`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Second ring
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(width, height) * 0.4 + Math.cos(shapePhase * 0.7) * 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.025)`;
    ctx.stroke();

    // Floating geometric nodes
    const nodes = [
      { x: width * 0.18, y: height * 0.3, s: 28 },
      { x: width * 0.82, y: height * 0.35, s: 22 },
      { x: width * 0.25, y: height * 0.7, s: 18 },
      { x: width * 0.75, y: height * 0.65, s: 24 },
    ];
    nodes.forEach((n, i) => {
      const ox = Math.sin(shapePhase + i) * 6;
      const oy = Math.cos(shapePhase * 1.1 + i) * 5;
      ctx.beginPath();
      ctx.arc(n.x + ox, n.y + oy, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.2)`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(n.x + ox, n.y + oy, n.s, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${ACCENT.r}, ${ACCENT.g}, ${ACCENT.b}, 0.06)`;
      ctx.stroke();
    });
  }

  canvas.addEventListener(
    "pointermove",
    (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    },
    { passive: true }
  );

  canvas.addEventListener("pointerleave", () => {
    mouse.x = null;
    mouse.y = null;
  });

  // Pause when off-screen
  if ("IntersectionObserver" in window) {
    const heroObs = new IntersectionObserver(
      ([entry]) => {
        running = entry.isIntersecting;
        if (running && !animationId) {
          animationId = requestAnimationFrame(step);
        }
      },
      { threshold: 0 }
    );
    heroObs.observe(canvas);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  // Visibility API — pause when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(animationId);
      animationId = 0;
    } else {
      running = true;
      animationId = requestAnimationFrame(step);
    }
  });

  resize();
  animationId = requestAnimationFrame(step);
})();
