/* 작동 방식 문서의 현재 위치 표시. */
(() => {
  "use strict";
  const headings = [...document.querySelectorAll(".mg-doc h2")];
  if (!headings.length || !("IntersectionObserver" in window)) return;
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.classList.toggle("mg-doc-current", entry.isIntersecting);
    }
  }, { rootMargin: "-20% 0px -70% 0px" });
  for (const heading of headings) watcher.observe(heading);
})();
