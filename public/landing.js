/* 소개 화면의 진입 연출. 관측이 늦어도 내용이 가려지지 않도록 지연 후 반드시 드러냅니다. */
(() => {
  "use strict";

  /* 사업 수와 기관 수는 공통 조회 API의 실제 값으로 채웁니다. */
  (async () => {
    const put = (id, text) => { const node = document.getElementById(id); if (node) node.textContent = text; };
    try {
      const [programs, institutions] = await Promise.all([
        fetch("/api/support/programs", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/support/institutions", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (Array.isArray(programs?.programs)) put("fact-programs", `${programs.programs.length}개`);
      if (Array.isArray(institutions?.institutions)) put("fact-institutions", `${institutions.institutions.length}곳`);
    } catch { /* 조회에 실패하면 문서에 적힌 값을 그대로 둡니다 */ }
  })();

  const targets = [...document.querySelectorAll(".mg-band__in > *, .mg-hero__in > *")];
  if (!targets.length) return;
  const revealAll = () => { for (const node of targets) node.classList.add("mg-entered"); };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || !("IntersectionObserver" in window)) { revealAll(); return; }
  for (const node of targets) node.classList.add("mg-enter");
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("mg-entered");
      watcher.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
  for (const node of targets) watcher.observe(node);
  window.setTimeout(() => { watcher.disconnect(); revealAll(); }, 1800);
})();
