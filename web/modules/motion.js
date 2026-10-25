// Juvia motion layer (GSAP). Presets from UI UX Pro Max: "Stagger List · Standard" for entrances,
// "Page Transition · Subtle" for view changes, "Hover Micro-interaction · Complex" for the one magnetic CTA.
// Guarantees: only opacity/transform are animated; nothing runs while the live camera is on (the tracking
// loop keeps the main thread to itself); reduced-motion users get the final state; if GSAP fails to load,
// content is simply shown (gsap.from() only hides an element at the moment it starts animating it).
const Motion = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const ok = () => !!window.gsap && !reduce.matches && !document.body.classList.contains('tryon-live');
  const seen = new WeakSet();
  const list = t => [...(typeof t === 'string' ? document.querySelectorAll(t) : (t || []))];

  // Staggered entrance; each element animates once (re-rendered nodes are new elements and animate again).
  function stagger(targets, { y = 16, scale = .92, each = .06, delay = 0, duration = .4 } = {}) {
    if (!ok()) return;
    const els = list(targets).filter(el => el && !seen.has(el) && el.getClientRects().length);
    if (!els.length) return;
    els.forEach(el => seen.add(el));
    gsap.from(els, { opacity: 0, y, scale, duration, ease: 'back.out(1.4)', stagger: { each, from: 'start', grid: 'auto' }, delay, clearProps: 'opacity,transform' });
  }
  // View change: a short fade-up of the view, then its [data-reveal] children in sequence.
  function page(view) {
    if (!ok() || !view) return;
    gsap.fromTo(view, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .26, ease: 'power1.out', clearProps: 'opacity,transform' });
    stagger(view.querySelectorAll('[data-reveal]'), { y: 14, scale: .98, each: .07, delay: .04, duration: .5 });
  }
  // Sections reveal their children when scrolled into view (IntersectionObserver, no scroll listeners).
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); stagger(e.target.children, { y: 18, scale: .97, each: .08 }); }
  }, { rootMargin: '0px 0px -12% 0px' }) : null;
  const onScroll = el => { if (io && el && ok()) io.observe(el); };
  // A single new element (chat bubble, card) pops in.
  function pop(el) { if (!ok() || !el) return; gsap.from(el, { opacity: 0, y: 10, scale: .96, duration: .34, ease: 'back.out(1.6)', clearProps: 'opacity,transform' }); }
  // Numbers count up (admin stats).
  function countUp(el, to) {
    if (!ok() || !Number.isFinite(to) || to <= 0) { el.textContent = to; return; }
    const o = { v: 0 }; gsap.to(o, { v: to, duration: .9, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(o.v); } });
  }
  // One magnetic focal CTA, pointer devices only; quickTo reuses one tween per axis (no GC churn).
  function magnetic(el) {
    if (!window.gsap || !el || reduce.matches || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const xTo = gsap.quickTo(el, 'x', { duration: .45, ease: 'power3.out' }), yTo = gsap.quickTo(el, 'y', { duration: .45, ease: 'power3.out' });
    el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); xTo((e.clientX - r.left - r.width / 2) * .22); yTo((e.clientY - r.top - r.height / 2) * .3); });
    el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  }
  // Live camera: settle every running tween instantly so GSAP's ticker goes idle for the tracking loop.
  function freeze() { if (window.gsap) gsap.globalTimeline.getChildren(true, true, false).forEach(t => t.progress(1)); }
  return { stagger, page, onScroll, pop, countUp, magnetic, freeze };
})();
window.Motion = Motion;
