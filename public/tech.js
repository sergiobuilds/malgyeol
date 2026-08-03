(function () {
  if (window.__mgTech) return;
  window.__mgTech = true;
  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function run() {
    var vh = window.innerHeight, wide = window.innerWidth >= 1180;
    document.querySelectorAll('[data-rise]').forEach(function (el) {
      if (RM) { el.style.opacity = '1'; el.style.transform = 'none'; return; }
      if (!el.getAttribute('data-ready')) {
        el.setAttribute('data-ready', '1');
        el.style.transition = 'opacity 620ms cubic-bezier(0.4,0,0.2,1), transform 620ms cubic-bezier(0.4,0,0.2,1)';
        el.style.transitionDelay = (Number(el.getAttribute('data-rise')) || 0) * 70 + 'ms';
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
      }
      if (el.getAttribute('data-seen')) return;
      if (el.getBoundingClientRect().top < vh * 0.9) { el.setAttribute('data-seen', '1'); el.style.opacity = '1'; el.style.transform = 'none'; }
    });
    var act = null;
    document.querySelectorAll('[data-ch]').forEach(function (s) { if (s.getBoundingClientRect().top <= 160) act = s.id; });
    var idx = document.querySelector('[data-index]');
    if (idx) {
      idx.style.display = wide ? 'grid' : 'none';
      idx.querySelectorAll('a').forEach(function (a) {
        var on = a.getAttribute('href') === '#' + act;
        a.style.color = on ? '#0066FF' : '#6B6B70';
        a.style.fontWeight = on ? '700' : '500';
      });
    }
  }
  function boot() { run(); window.addEventListener('scroll', run, { passive: true }); window.addEventListener('resize', run); setInterval(run, 140); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
