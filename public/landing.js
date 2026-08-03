(function () {
  if (window.__mgMain) return;
  window.__mgMain = true;
  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cl(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function run() {
    var vh = window.innerHeight, wide = window.innerWidth >= 1080;

    var film = document.querySelector('[data-film]');
    if (film && !RM) {
      var fr = film.getBoundingClientRect();
      var p = cl(-fr.top / Math.max(1, fr.height - vh));
      var layers = film.querySelectorAll('[data-layer]');
      var n = layers.length;
      layers.forEach(function (el, i) {
        var seg = 1 / n, mid = i * seg;
        var v = i === 0 ? cl(1 - (p - seg * 0.72) / (seg * 0.5)) : cl((p - mid * 0.92) / (seg * 0.45)) * cl(1 - (p - (mid + seg * 0.8)) / (seg * 0.45));
        el.style.opacity = String(i === n - 1 ? cl((p - mid * 0.92) / (seg * 0.5)) : v);
        el.style.transform = 'scale(' + (1.06 - p * 0.06).toFixed(3) + ')';
      });
      film.querySelectorAll('[data-filmtext]').forEach(function (el) {
        var i = Number(el.getAttribute('data-filmtext'));
        var s = i * 0.25, v;
        if (i === 0) v = cl(1 - (p - 0.2) / 0.1);
        else if (i === 3) v = cl((p - 0.72) / 0.12);
        else v = cl((p - s) / 0.1) * cl(1 - (p - (s + 0.2)) / 0.1);
        el.style.opacity = String(v);
        el.style.transform = 'translateY(' + ((1 - v) * 22).toFixed(1) + 'px)';
      });
    }

    document.querySelectorAll('[data-rise]').forEach(function (el) {
      if (RM) { el.style.opacity = '1'; el.style.transform = 'none'; return; }
      if (!el.getAttribute('data-ready')) {
        el.setAttribute('data-ready', '1');
        el.style.transition = 'opacity 700ms cubic-bezier(0.4,0,0.2,1), transform 700ms cubic-bezier(0.4,0,0.2,1)';
        el.style.transitionDelay = (Number(el.getAttribute('data-rise')) || 0) * 90 + 'ms';
        el.style.opacity = '0';
        el.style.transform = 'translateY(26px)';
      }
      if (el.getAttribute('data-seen')) return;
      if (el.getBoundingClientRect().top < vh * 0.86) { el.setAttribute('data-seen', '1'); el.style.opacity = '1'; el.style.transform = 'none'; }
    });

    var act = null, tone = 'light';
    document.querySelectorAll('[data-ch]').forEach(function (s) {
      if (s.getBoundingClientRect().top <= vh * 0.42) { act = s.getAttribute('data-ch'); tone = s.getAttribute('data-tone') || 'light'; }
    });
    var idx = document.querySelector('[data-index]');
    if (idx) {
      idx.style.display = wide && act ? 'grid' : 'none';
      var dim = tone === 'dark' ? 'rgba(255,255,255,0.52)' : 'rgba(23,23,25,0.44)';
      var hi = tone === 'dark' ? '#FFFFFF' : '#171719';
      idx.querySelectorAll('[data-to]').forEach(function (a) {
        var on = a.getAttribute('data-to') === act;
        a.style.color = on ? hi : dim;
        var b = a.querySelector('[data-bar]');
        if (b) { b.style.background = on ? hi : dim; b.style.width = on ? '26px' : '10px'; }
      });
    }
    var hd = document.querySelector('[data-hdr]');
    if (hd) {
      var on2 = window.scrollY > vh * 0.7;
      hd.style.opacity = on2 ? '1' : '0';
      hd.style.visibility = on2 ? 'visible' : 'hidden';
      hd.style.pointerEvents = on2 ? 'auto' : 'none';
    }
  }
  function boot() { run(); window.addEventListener('scroll', run, { passive: true }); window.addEventListener('resize', run); setInterval(run, 120); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
