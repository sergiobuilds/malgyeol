/* 소개 화면의 실제 수치 채우기. 진입 연출은 두지 않습니다. */
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
      if (Array.isArray(institutions?.institutions)) put("fact-institutions", `${institutions.institutions.length}개소`);
    } catch { /* 조회에 실패하면 문서에 적힌 값을 그대로 둡니다 */ }
  })();
})();
