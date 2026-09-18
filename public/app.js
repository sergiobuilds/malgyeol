/* 말결 담당자 화면.
 * 공통 조회 API(/api/support)와 요청 진행 API(/api/coordination)에만 연결합니다.
 * 로그인 없이 요청 진행 화면을 열며 변경 요청은 같은 Origin에서 보냅니다.
 */
(() => {
  "use strict";

  /* ── 공통 유틸 ─────────────────────────────── */
  const view = document.getElementById("view");
  const live = document.getElementById("live-region");
  const sessionSlot = document.getElementById("session-slot");

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const listOf = (items, cls = "mg-bullets") =>
    `<ul class="${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  const announce = (message) => { live.textContent = message; };

  const timeText = (iso) => {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", {
      month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(at);
  };
  const sinceText = (iso) => {
    const gap = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(gap) || gap < 0) return "";
    const minutes = Math.floor(gap / 60000);
    if (minutes < 1) return "방금 전";
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    return `${Math.floor(hours / 24)}일 전`;
  };

  class ApiError extends Error {
    constructor(status, code, message) { super(message); this.status = status; this.code = code; }
  }
  async function api(method, path, body) {
    let response;
    try {
      response = await fetch(path, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(0, "NETWORK", "연결 끊김 · 재시도 필요");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = payload?.error?.code ?? "ERROR";
      throw new ApiError(response.status, code,
        REASON[code] ?? payload?.error?.message ?? "요청 처리 실패");
    }
    return payload;
  }

  /* 서버 사유 코드를 담당자 화면 표시 문구로 옮긴다. */
  const REASON = {
    CALL_ACTIVE: "통화 진행 중 · 종료 후 재시도",
    RESULT_UNKNOWN: "통화 결과 미확정 · 재연락 불가",
    STALE_INQUIRY: "요청 조건 정정 · 문의 재준비 필요",
    RETRY_NOT_ALLOWED: "재연락 불가 상태",
    NEED_STOPPED: "진행 중단된 필요",
    CHOICE_REQUIRED: "시민 선택 대기 · 다음 연락 불가",
    CONSENT_REQUIRED: "전달 범위 미확인",
    CONSENT_SCOPE: "전달 범위 외 기관",
    ANSWER_FINAL: "정리 완료된 답변",
    ATTEMPT_FINAL: "종료된 통화",
    INVALID_INPUT: "입력값 오류 · 확인 필요",
    INVALID_REVISION: "정정 내용 오류 · 확인 필요",
    REQUEST_NOT_FOUND: "요청 없음 · 목록 재조회 필요",
    NEED_NOT_FOUND: "필요 없음 · 목록 재조회 필요",
    INQUIRY_NOT_FOUND: "문의 없음 · 목록 재조회 필요",
    DURABLE_LEDGER_REQUIRED: "요청 저장 연결 준비 중 · 재확인 필요",
  };

  /* ── 표시 문구 ─────────────────────────────── */
  const PROGRAM_NAMES = new Map();

  const NEED_STATE = {
    open: { label: "연락 준비", badge: "bg-light-primary", note: "기관 문의 준비 중" },
    contacting: { label: "기관 연락 중", badge: "bg-light-information", note: "등록 창구 조건 확인 중" },
    "awaiting-choice": { label: "시민 선택 대기", badge: "bg-light-warning", note: "조건 변경 · 시민 선택 필요" },
    connected: { label: "이용 경로 연결", badge: "bg-light-success", note: "이용 방법·조건 확인 완료 · 제공 여부는 기관 절차" },
    "needs-attention": { label: "담당자 확인 필요", badge: "bg-light-danger", note: "연락 미도달 또는 이용 어려움 회신" },
    stopped: { label: "진행 중단", badge: "bg-light-gray", note: "진행 중단" },
  };
  const INQUIRY_STATE = {
    prepared: { label: "문의 준비", badge: "bg-light-gray" },
    calling: { label: "통화 중", badge: "bg-light-information" },
    answered: { label: "답변 도착", badge: "bg-light-success" },
    "no-answer": { label: "부재중", badge: "bg-light-warning" },
    failed: { label: "재연락 필요", badge: "bg-light-danger" },
    unknown: { label: "담당자 확인 필요", badge: "bg-light-warning" },
    cancelled: { label: "문의 취소", badge: "bg-light-gray" },
  };
  const OUTCOME = {
    available: { label: "이용 가능", badge: "bg-light-success", tone: "result" },
    alternative: { label: "다른 방법 안내", badge: "bg-light-warning", tone: "" },
    declined: { label: "이용 어려움", badge: "bg-light-danger", tone: "attention" },
  };
  const CALLBACK_STATE = {
    completed: { label: "회신 완료", badge: "bg-light-success" },
    "no-answer": { label: "시민 부재중", badge: "bg-light-warning" },
    failed: { label: "회신 재시도 필요", badge: "bg-light-danger" },
  };
  const ATTEMPT_RESULT = {
    started: "통화 연결 중", completed: "통화 완료",
    "no-answer": "부재중", failed: "재연락 필요", unknown: "담당자 확인 필요",
  };

  /* 시민 성명. 없으면 '신규 요청'이며 자치구를 사람 이름 자리에 쓰지 않는다. */
  const rawName = (request) => {
    const name = request?.citizenProfile?.name;
    return typeof name === "string" && name.trim() ? name.trim() : "";
  };
  const personName = (request) => rawName(request) || "신규 요청";

  /* 값이 있는 항목만 dt·dd로 만든다. */
  const defRows = (rows) => rows
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("");

  const badge = (state, fallback) => {
    const found = state ?? fallback;
    return `<span class="krds-badge ${found.badge}"><i class="mg-dot" aria-hidden="true"></i>${esc(found.label)}</span>`;
  };

  /* ── 대화 상자 ─────────────────────────────── */
  const dialog = {
    root: document.getElementById("dialog"),
    title: document.getElementById("dialog-title"),
    body: document.getElementById("dialog-body"),
    foot: document.getElementById("dialog-foot"),
    opener: null,
    open({ title, body, actions = [] }) {
      // 내용을 바꿔 다시 열 때는 처음 연 요소를 그대로 기억한다.
      if (this.root.dataset.open !== "true") this.opener = document.activeElement;
      this.title.textContent = title;
      this.body.innerHTML = body;
      this.foot.innerHTML = "";
      for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `krds-btn medium ${action.kind ?? "tertiary"}`;
        button.textContent = action.label;
        button.addEventListener("click", () => action.onClick(this));
        this.foot.append(button);
      }
      this.foot.hidden = actions.length === 0;
      this.root.dataset.open = "true";
      document.body.style.overflow = "hidden";
      const focusable = this.focusable();
      (this.body.querySelector("input,select,textarea") ?? focusable[0])?.focus();
    },
    close() {
      if (this.root.dataset.open !== "true") return;
      this.root.dataset.open = "false";
      document.body.style.overflow = "";
      this.body.innerHTML = "";
      this.foot.innerHTML = "";
      this.opener?.focus?.();
      this.opener = null;
    },
    focusable() {
      return [...this.root.querySelectorAll(
        'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
        .filter((node) => node.offsetParent !== null);
    },
    isOpen() { return this.root.dataset.open === "true"; },
  };
  dialog.root.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-dialog]")) dialog.close();
  });
  document.addEventListener("keydown", (event) => {
    if (!dialog.isOpen()) return;
    if (event.key === "Escape") { event.preventDefault(); dialog.close(); return; }
    if (event.key !== "Tab") return;
    const nodes = dialog.focusable();
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  /* ── 지원망 화면 ───────────────────────────── */
  const network = {
    programs: [], institutions: [], districts: [],
    filters: { programId: "foodbank-market", district: "", query: "" },
    loading: false, failed: false,

    async start() {
      view.innerHTML = this.frame();
      this.bind();
      try {
        const { programs } = await api("GET", "/api/support/programs");
        this.programs = programs;
        for (const program of programs) PROGRAM_NAMES.set(program.id, program.name);
        document.getElementById("program-tabs").innerHTML = this.tabs();
        await this.loadDistricts();
      } catch {
        this.failed = true;
      }
      await this.search();
    },

    async loadDistricts() {
      const { institutions } = await api("GET", "/api/support/institutions");
      const total = document.getElementById("network-total");
      if (total) total.textContent = `${institutions.length}개소`;
      this.districts = [...new Set(institutions.map((item) => item.district))]
        .sort((a, b) => a.localeCompare(b, "ko-KR"));
      document.getElementById("district").innerHTML =
        `<option value="">전체 지역</option>` +
        this.districts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
    },

    frame() {
      return `
      <div class="mg-pagehead">
        <div>
          <p class="mg-eyebrow">지원망</p>
          <h1>지원사업별 기관·이용절차</h1>
          <p>관할 지역 · 신청 절차 · 문의 창구</p>
        </div>
        <div class="mg-pagehead__aside">
          <p class="mg-inst__meta">등록 기관</p>
          <p class="mg-reqbtn__dist" id="network-total">조회 중</p>
        </div>
      </div>

      <div class="mg-section">
        <div class="krds-tab-area" id="program-tabs"></div>
      </div>

      <form class="mg-card mg-section" id="search-form" novalidate>
        <div class="mg-filters">
          <div class="form-group">
            <div class="form-tit"><label for="district">지역</label></div>
            <div class="form-conts">
              <select id="district" class="krds-form-select"><option value="">전체 지역</option></select>
            </div>
          </div>
          <div class="form-group">
            <div class="form-tit"><label for="query">기관명·주소·지원 범주 검색</label></div>
            <div class="form-conts">
              <input type="search" id="query" class="krds-input" autocomplete="off" placeholder="예: 성동, 생필품">
            </div>
          </div>
          <div class="mg-filters__actions">
            <button type="submit" class="krds-btn medium primary">조회</button>
            <button type="button" class="krds-btn medium tertiary" id="reset">조건 해제</button>
          </div>
        </div>
      </form>

      <div class="mg-resultbar">
        <h2 class="sr-only">사업별 기관 조회 결과</h2>
        <p id="result-count" role="status" aria-live="polite"></p>
      </div>
      <div id="results" role="tabpanel" tabindex="0" aria-labelledby="tab-${esc(this.filters.programId)}"></div>`;
    },

    tabs() {
      return `<div class="tab line full"><ul role="tablist" aria-label="지원사업 선택">${
        this.programs.map((program) => {
          const selected = program.id === this.filters.programId;
          return `<li role="presentation" class="${selected ? "active" : ""}">
            <button type="button" class="btn-tab" id="tab-${esc(program.id)}" role="tab"
                    aria-selected="${selected}" aria-controls="results"
                    tabindex="${selected ? 0 : -1}" data-program="${esc(program.id)}">${esc(program.name)}${
              selected ? '<i class="sr-only"> 선택됨</i>' : ""}</button>
          </li>`;
        }).join("")}</ul></div>`;
    },

    bind() {
      document.getElementById("search-form").addEventListener("submit", (event) => {
        event.preventDefault();
        this.filters.district = document.getElementById("district").value;
        this.filters.query = document.getElementById("query").value.trim();
        this.search();
      });
      document.getElementById("reset").addEventListener("click", () => {
        document.getElementById("district").value = "";
        document.getElementById("query").value = "";
        this.filters.district = ""; this.filters.query = "";
        this.search();
      });
      document.getElementById("program-tabs").addEventListener("click", (event) => {
        const tab = event.target.closest("[data-program]");
        if (tab) this.selectProgram(tab.dataset.program);
      });
      document.getElementById("program-tabs").addEventListener("keydown", (event) => {
        const last = this.programs.length - 1;
        const current = this.programs.findIndex((p) => p.id === this.filters.programId);
        const step = { ArrowLeft: -1, ArrowRight: 1 };
        let index;
        if (event.key in step) index = (current + step[event.key] + this.programs.length) % this.programs.length;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = last;
        else return;
        event.preventDefault();
        const next = this.programs[index];
        this.selectProgram(next.id);
        document.querySelector(`[data-program="${next.id}"]`)?.focus();
      });
      document.getElementById("results").addEventListener("click", (event) => {
        const open = event.target.closest("[data-institution]");
        if (open) this.openDetail(open.dataset.institution);
      });
    },

    selectProgram(programId) {
      if (this.filters.programId === programId) return;
      this.filters.programId = programId;
      document.getElementById("program-tabs").innerHTML = this.tabs();
      document.getElementById("results").setAttribute("aria-labelledby", `tab-${programId}`);
      this.search();
    },

    async search() {
      const results = document.getElementById("results");
      const counter = document.getElementById("result-count");
      results.innerHTML = `<div class="mg-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>`;
      counter.textContent = "조회 중";
      const params = new URLSearchParams({ programId: this.filters.programId });
      if (this.filters.district) params.set("district", this.filters.district);
      if (this.filters.query) params.set("query", this.filters.query);
      try {
        const { institutions } = await api("GET", `/api/support/institutions?${params}`);
        this.institutions = institutions;
        const name = PROGRAM_NAMES.get(this.filters.programId) ?? "";
        counter.innerHTML = `${esc(name)} · 조회 결과 <strong>${institutions.length}개소</strong>`;
        results.innerHTML = institutions.length ? this.cards(institutions) : this.empty();
      } catch (error) {
        counter.textContent = "";
        results.innerHTML = `<div class="mg-empty">
          <h3>지원망 조회 실패</h3>
          <p>${esc(error.message)} · 재조회 필요</p></div>`;
      }
    },

    empty() {
      const conditions = [];
      if (this.filters.district) conditions.push(`지역 ‘${this.filters.district}’`);
      if (this.filters.query) conditions.push(`검색어 ‘${this.filters.query}’`);
      return `<div class="mg-empty">
        <h3>조회 결과 없음</h3>
        <p>${conditions.length ? `${esc(conditions.join(", "))} · 해당 조건 운영 기관 없음 · ` : ""}사업 탭 변경 또는 조건 해제 후 재조회</p></div>`;
    },

    cards(institutions) {
      return `<ul class="mg-list mg-list--network">${institutions.map((item) => {
        const offering = item.programs.find((p) => p.programId === this.filters.programId);
        const place = item.address
          ? `${esc(item.district)} · ${esc(item.address)}`
          : `${esc(item.district)} 대상 안내 창구 · 전화 문의`;
        const contacts = item.contacts.map((contact) =>
          `<span><b>${esc(contact.purpose)}</b> ${esc(contact.phone)}</span>`).join("");
        return `<li class="mg-inst">
          <div>
            <h3 class="mg-inst__name">${esc(item.name)}</h3>
            <p class="mg-inst__meta">${place}</p>
            <div class="mg-inst__tags mg-badges">
              ${item.programs.map((p) => `<span class="krds-badge ${p.programId === this.filters.programId ? "bg-light-primary" : "outline-gray"}">${esc(PROGRAM_NAMES.get(p.programId) ?? p.programId)}</span>`).join("")}
              ${(offering?.categories ?? []).map((c) => `<span class="krds-badge bg-light-secondary">${esc(c)}</span>`).join("")}
            </div>
            <p class="mg-inst__contact">${contacts}</p>
          </div>
          <button type="button" class="krds-btn medium secondary" data-institution="${esc(item.id)}">
            기관 상세 보기<span class="sr-only"> ${esc(item.name)}</span>
          </button>
        </li>`;
      }).join("")}</ul>`;
    },

    async openDetail(id) {
      dialog.open({ title: "기관 상세", body: `<p class="mg-inst__meta">기관 정보 조회 중</p>` });
      try {
        const { institution } = await api("GET", `/api/support/institutions/${encodeURIComponent(id)}`);
        dialog.open({
          title: institution.name,
          body: this.detail(institution),
          actions: [{ label: "닫기", kind: "tertiary", onClick: (d) => d.close() }],
        });
      } catch (error) {
        dialog.open({
          title: "기관 정보 조회 실패",
          body: `<p class="mg-inst__meta">${esc(error.message)}</p>`,
          actions: [{ label: "닫기", kind: "tertiary", onClick: (d) => d.close() }],
        });
      }
    },

    detail(institution) {
      const rows = [];
      if (institution.address) rows.push(["방문 주소", esc(institution.address)]);
      else rows.push(["이용 방법", "안내 창구 · 방문처 아님 · 아래 연락처로 관할 창구 안내"]);
      rows.push(["관할", esc(institution.district)]);
      rows.push(["기관 역할", listOf(institution.roles)]);
      rows.push(["목적별 연락처", `<ul class="mg-bullets">${institution.contacts.map((c) =>
        `<li><b>${esc(c.purpose)}</b> — ${esc(c.phone)}</li>`).join("")}</ul>`]);

      const programs = institution.programs.map((offering) => `
        <section class="mg-program">
          <div class="mg-program__head">
            <h4>${esc(PROGRAM_NAMES.get(offering.programId) ?? offering.programId)}</h4>
            <p class="mg-inst__meta">운영시간 ${esc(offering.hours)}</p>
          </div>
          <div class="mg-program__body">
            <p class="mg-subhead">지원 범주</p>
            <div class="mg-badges">${offering.categories.map((c) =>
              `<span class="krds-badge bg-light-secondary">${esc(c)}</span>`).join("")}</div>
            <p class="mg-subhead">이용 대상</p>
            ${listOf(offering.eligibility)}
            <p class="mg-subhead">이용 절차와 준비물</p>
            <ol class="mg-steps">${offering.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
            <p class="mg-subhead">이용·수령 방법</p>
            ${listOf(offering.access)}
            <div class="mg-sources">
              <p class="mg-subhead">공식 출처</p>
              ${offering.sources.map((s) =>
                `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} (새 창)</a>`).join("")}
            </div>
          </div>
        </section>`).join("");

      return `
        <dl class="mg-defs">${rows.map(([key, value]) =>
          `<dt>${esc(key)}</dt><dd>${value}</dd>`).join("")}</dl>
        ${programs}
        <div class="mg-sources">
          <p class="mg-subhead">기관 목록 출처</p>
          ${institution.sources.map((s) =>
            `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} (새 창)</a>`).join("")}
        </div>`;
    },
  };

  /* ── 요청 진행 화면 ─────────────────────────── */
  const work = {
    requests: [], events: [], eventsLoading: false, queued: false, institutions: new Map(),
    history: [], historyLoading: false,
    selectedId: null, timer: null, busy: false, lastLoadedAt: null,

    async start() {
      sessionSlot.innerHTML = "";
      await this.loadCatalog();
      view.innerHTML = this.frame();
      this.bind();
      await this.refresh(true);
      this.startPolling();
    },

    async loadCatalog() {
      try {
        const [{ programs }, { institutions }] = await Promise.all([
          api("GET", "/api/support/programs"),
          api("GET", "/api/support/institutions"),
        ]);
        for (const program of programs) PROGRAM_NAMES.set(program.id, program.name);
        for (const item of institutions) this.institutions.set(item.id, item);
      } catch { /* 이름을 못 불러와도 진행 상황은 표시한다 */ }
    },

    frame() {
      return `
        <div class="mg-pagehead">
          <div>
            <p class="mg-eyebrow">요청 진행</p>
            <h1>시민 요청·기관 문의 현황</h1>
            <p>필요별 진행 상태 · 기관 답변 · 후속 조치</p>
          </div>
          <div class="mg-pagehead__aside">
            <p class="mg-inst__meta">자동 갱신</p>
            <p class="mg-reqbtn__dist" id="poll-state">진행 중</p>
          </div>
        </div>
        <p class="mg-status" id="work-status" role="status" aria-live="polite"></p>
        <div class="mg-work">
          <div class="mg-rail">
            <div class="mg-rail__head">
              <h2>접수한 요청</h2>
              <span class="mg-rail__count" id="request-count"></span>
            </div>
            <div id="request-list"></div>
          </div>
          <div class="mg-canvas" id="request-detail"></div>
        </div>`;
    },

    bind() {
      document.getElementById("request-list").addEventListener("click", (event) => {
        const button = event.target.closest("[data-request-index]");
        if (!button) return;
        const chosen = this.requests[Number(button.dataset.requestIndex)];
        if (!chosen) return;
        if (chosen.id === this.selectedId) return;
        this.selectedId = chosen.id;
        // 이력은 요청마다 따로 조회한다. 이전 요청·다른 시민의 이력을 잠시라도 보여주지 않는다.
        this.events = [];
        this.eventsLoading = true;
        this.history = [];
        this.historyLoading = true;
        this.renderList(); this.renderDetail();
        document.getElementById("request-detail")?.scrollIntoView({ block: "start", behavior: "smooth" });
        this.refresh(false);
      });
      document.getElementById("request-detail").addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]");
        if (!action) return;
        const { action: name, need, inquiry } = action.dataset;
        if (name === "revise") this.askRevise();
        if (name === "stop") this.askStop(Number(need));
        if (name === "retry") this.askRetry(Number(inquiry));
      });
    },

    /* 조회 */
    startPolling() {
      this.stopPolling();
      this.timer = window.setInterval(() => {
        if (document.hidden || this.busy) return;
        this.refresh(false);
      }, 3000);
      document.addEventListener("visibilitychange", this.visibility);
      this.updatePollState();
    },
    stopPolling() {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = null;
      document.removeEventListener("visibilitychange", this.visibility);
    },
    visibility: null,
    updatePollState() {
      const node = document.getElementById("poll-state");
      if (!node) return;
      node.textContent = document.hidden ? "다른 탭에서 보는 중 · 멈춤" : "3초마다 갱신";
    },

    status(message, tone = "") {
      const node = document.getElementById("work-status");
      if (!node) return;
      node.textContent = message;
      if (tone) node.dataset.tone = tone; else delete node.dataset.tone;
    },

    async refresh(first) {
      // 조회가 겹치면 잠시 뒤 한 번만 다시 시도한다. 선택을 바꾼 직후에도 이력이 곧 채워진다.
      if (this.busy) {
        if (!this.queued) {
          this.queued = true;
          window.setTimeout(() => { this.queued = false; this.refresh(false); }, 250);
        }
        return;
      }
      this.busy = true;
      const slow = window.setTimeout(() => this.status("응답 지연 · 대기 중"), 1200);
      const slower = window.setTimeout(() => this.status("서버 응답 5초 초과 · 연결 상태 확인 필요", "error"), 5000);
      try {
        const { requests } = await api("GET", "/api/coordination/requests");
        this.requests = requests;
        if (!this.requests.some((r) => r.id === this.selectedId)) {
          // 선택이 서버 상태에 따라 바뀌면 이전 시민의 이력을 남기지 않는다.
          this.selectedId = this.requests[0]?.id ?? null;
          this.events = []; this.eventsLoading = Boolean(this.selectedId);
          this.history = []; this.historyLoading = Boolean(this.selectedId);
        }
        if (this.selectedId) {
          const requestedId = this.selectedId;
          const { events } = await api("GET", `/api/coordination/requests/${requestedId}/events`);
          // 조회 중에 담당자가 다른 요청을 골랐다면 늦게 도착한 이력을 버린다.
          if (requestedId !== this.selectedId) { this.refresh(false); return; }
          this.events = events;
          this.eventsLoading = false;
          await this.loadHistory(requestedId);
          if (requestedId !== this.selectedId) { this.refresh(false); return; }
        } else {
          this.events = [];
          this.eventsLoading = false;
          this.history = [];
          this.historyLoading = false;
        }
        this.lastLoadedAt = new Date().toISOString();
        this.status(requests.length
          ? `요청 ${requests.length}건 · ${timeText(this.lastLoadedAt)} 기준`
          : "");
        this.renderList(); this.renderDetail();
        if (first) announce(requests.length
          ? `요청 ${requests.length}건 조회 완료`
          : "접수 요청 없음");
      } catch (error) {
        this.status(`${error.message} · 자동 갱신 유지`, "error");
      } finally {
        window.clearTimeout(slow); window.clearTimeout(slower);
        this.busy = false;
        this.updatePollState();
      }
    },

    /* 같은 시민의 다른 요청. 서버 필터를 신뢰하지 않고 citizenRef 일치 건만 남긴다. */
    async loadHistory(requestedId) {
      const request = this.requests.find((item) => item.id === requestedId);
      const ref = request?.citizenRef;
      if (!ref) { this.history = []; this.historyLoading = false; return; }
      try {
        const { requests } = await api(
          "GET", `/api/coordination/requests?citizenRef=${encodeURIComponent(ref)}`);
        // 조회 중에 선택이 바뀌면 늦게 도착한 다른 시민의 이력을 버린다.
        if (requestedId !== this.selectedId) return;
        this.history = (Array.isArray(requests) ? requests : [])
          .filter((item) => item.citizenRef === ref && item.id !== requestedId);
      } catch {
        // 이력 조회 실패는 본 화면 갱신을 막지 않는다.
        if (requestedId === this.selectedId) this.history = [];
      }
      if (requestedId === this.selectedId) this.historyLoading = false;
    },

    renderList() {
      const list = document.getElementById("request-list");
      const counter = document.getElementById("request-count");
      if (!list) return;
      counter.textContent = `${this.requests.length}건`;
      const shell = document.querySelector(".mg-work");
      if (shell) shell.dataset.empty = String(this.requests.length === 0);
      if (!this.requests.length) { list.innerHTML = ""; return; }
      list.innerHTML = this.requests.map((request, index) => {
        const active = request.id === this.selectedId;
        const counts = new Map();
        for (const need of request.needs) counts.set(need.status, (counts.get(need.status) ?? 0) + 1);
        return `<button type="button" class="mg-reqbtn" aria-current="${active}" data-request-index="${index}">
          <span class="mg-reqbtn__top">
            <span class="mg-reqbtn__dist">${esc(personName(request))}</span>
            <span class="mg-reqbtn__time">${esc(sinceText(request.updatedAt))}</span>
          </span>
          <span class="mg-reqbtn__sum">${esc(request.summary)}</span>
          <span class="mg-reqbtn__tags mg-badges">${[...counts].map(([state, count]) => {
            const shown = NEED_STATE[state];
            return shown ? `<span class="krds-badge ${shown.badge}">${esc(shown.label)} ${count}</span>` : "";
          }).join("")}</span>
        </button>`;
      }).join("");
    },

    renderDetail() {
      const canvas = document.getElementById("request-detail");
      if (!canvas) return;
      const request = this.requests.find((item) => item.id === this.selectedId);
      if (!request) {
        canvas.innerHTML = this.requests.length
          ? `<div class="mg-empty"><h3>요청 미선택</h3><p>왼쪽 목록에서 요청 선택</p></div>`
          : `<div class="mg-empty"><h3>접수 요청 없음</h3></div>`;
        return;
      }
      const profile = request.citizenProfile ?? {};
      const revised = request.revision > 1
        ? `<p class="mg-inst__meta">요청 조건 정정 ${request.revision - 1}회 · 진행 중 필요 연락 준비 상태 복귀</p>` : "";
      canvas.innerHTML = `
        <section class="mg-overview">
          <div class="mg-overview__top">
            <div>
              <p class="mg-eyebrow">요청 개요</p>
              <h2>${rawName(request) ? `${esc(rawName(request))} 지원 요청` : "신규 요청"}</h2>
              <blockquote class="mg-quote">
                <p>${esc(request.summary)}</p>
                <cite>시민 전화 접수 내용</cite>
              </blockquote>
              ${revised}
            </div>
            <div class="mg-overview__act">
              <button type="button" class="krds-btn medium secondary" data-action="revise">요청 내용 정정</button>
            </div>
          </div>
          <dl class="mg-facts">
            ${defRows([
              ["성명", rawName(request)],
              ["연령", profile.age],
              ["주소", profile.address],
              ["가구 구성", profile.household],
              ["이동 여건", profile.mobility],
              ["연락 시간", profile.contactPreference],
              ["거주 자치구", request.district],
              ["접수", timeText(request.createdAt)],
              ["최근 진행", timeText(request.updatedAt)],
              ["접수 방법", "전화 접수"],
            ])}
          </dl>
          ${request.constraints.length ? `<div class="mg-note mg-note--quiet"><strong>시민 제약 사항</strong>${
            esc(request.constraints.join(" · "))}</div>` : ""}
        </section>

        <section class="mg-section mg-section--tight">
          <div class="mg-section__head"><h3>필요별 진행</h3></div>
          <div class="mg-list">${request.needs.map((need, index) => this.needCard(request, need, index)).join("")}</div>
        </section>

        ${request.callbacks.length ? `
        <section class="mg-section mg-section--tight">
          <div class="mg-section__head"><h3>시민 회신</h3></div>
          <ul class="mg-inq">${request.callbacks.map((callback) => `
            <li><div class="mg-inq__head">
              <div><p class="mg-inq__inst">${esc(callback.summary)}</p>
                   <p class="mg-inq__prog">${esc(timeText(callback.at))}</p></div>
              ${badge(CALLBACK_STATE[callback.status], { label: callback.status, badge: "bg-light-gray" })}
            </div></li>`).join("")}</ul>
        </section>` : ""}

        <section class="mg-section mg-section--tight">
          <div class="mg-section__head"><h3>동일 시민 요청 이력</h3></div>
          <div class="mg-card"><ul class="mg-trail">${this.personHistory(request)}</ul></div>
        </section>

        <section class="mg-section mg-section--tight">
          <div class="mg-section__head"><h3>진행 이력</h3></div>
          <div class="mg-card"><ul class="mg-trail">${this.trail(request)}</ul></div>
        </section>`;
    },

    needCard(request, need, needIndex) {
      const state = NEED_STATE[need.status] ?? { label: need.status, badge: "bg-light-gray", note: "" };
      const details = need.requestDetails ?? {};
      const inquiries = request.inquiries.filter((item) => item.needId === need.id);
      const canStop = need.status !== "stopped";
      const result = need.result
        ? `<div class="mg-note ${need.status === "connected" ? "mg-note--result" : need.status === "needs-attention" ? "mg-note--attention" : ""}">
             <strong>확인한 내용과 다음 행동</strong>${esc(need.result)}</div>` : "";
      const choice = need.status === "awaiting-choice"
        ? `<div class="mg-note"><strong>시민 선택 대기</strong>통화를 통한 시민 직접 선택 · 담당자 대리 선택 불가</div>`
        : need.choice
          ? `<div class="mg-note mg-note--quiet"><strong>시민 선택 방법</strong>${esc(need.choice)}</div>` : "";
      return `
        <section class="mg-need">
          <div class="mg-need__head">
            <div>
              <p class="mg-need__cat">${esc(need.category)}</p>
              <p class="mg-need__desc">${esc(need.description)}</p>
              <p class="mg-need__state">${esc(state.note)}</p>
            </div>
            <div class="mg-badges">${badge(state)}</div>
          </div>
          <div class="mg-need__body">
            <dl class="mg-facts">
              ${defRows([
                ["지원 내용", need.description],
                ["수량", details.quantity],
                ["희망 일정", details.requestedDate],
                ["수령 방법", details.deliveryMethod],
              ])}
            </dl>
            ${need.constraints.length ? `<p class="mg-inst__meta mg-need__cond">필요 조건 · ${esc(need.constraints.join(" · "))}</p>` : ""}
            ${choice}${result}
            ${inquiries.length
              ? `<ul class="mg-inq">${inquiries.map((inquiry) => this.inquiryCard(request, need, inquiry)).join("")}</ul>`
              : `<p class="mg-inst__meta">기관 문의 없음</p>`}
          </div>
          ${canStop ? `<div class="mg-need__actions">
            <button type="button" class="krds-btn small tertiary" data-action="stop" data-need="${needIndex}">
              이 필요 진행 중단<span class="sr-only"> · ${esc(need.description)}</span></button>
          </div>` : ""}
        </section>`;
    },

    inquiryCard(request, need, inquiry) {
      const institution = this.institutions.get(inquiry.institutionId);
      const state = INQUIRY_STATE[inquiry.status] ?? { label: inquiry.status, badge: "bg-light-gray" };
      const attempts = request.attempts.filter((attempt) => attempt.inquiryId === inquiry.id);
      const last = attempts[attempts.length - 1];
      const stale = inquiry.revision !== request.revision;
      const canRetry = ["no-answer", "failed"].includes(inquiry.status) && !stale && need.status !== "stopped";
      const answer = inquiry.answer;
      const outcome = answer ? OUTCOME[answer.outcome] : null;
      return `<li>
        <div class="mg-inq__head">
          <div>
            <p class="mg-inq__inst">${esc(institution?.name ?? "등록 문의 창구")}</p>
            <p class="mg-inq__prog">${esc(PROGRAM_NAMES.get(inquiry.programId) ?? inquiry.programId)} · ${esc(inquiry.contactPurpose)}</p>
          </div>
          <div class="mg-badges">${badge(state)}${outcome ? badge(outcome) : ""}</div>
        </div>
        <div class="mg-inq__body">
          <p class="mg-subhead">문의한 내용</p>
          ${listOf(inquiry.questions)}
          ${answer ? `
            <p class="mg-subhead">기관 답변</p>
            <p class="mg-inq__answer">${esc(answer.summary)}</p>
            ${answer.conditions.length ? `<p class="mg-subhead">이용 조건</p>${listOf(answer.conditions)}` : ""}
            <p class="mg-subhead">다음 행동</p>
            <p class="mg-inq__next">${esc(answer.nextAction)}</p>` : ""}
          ${last ? `<p class="mg-inq__time">${
            esc(timeText(last.startedAt))} 연락 · ${esc(ATTEMPT_RESULT[last.status] ?? last.status)}${
            attempts.length > 1 ? ` · 연락 ${attempts.length}회` : ""}</p>` : ""}
          ${inquiry.status === "unknown" ? `
            <div class="mg-note mg-note--quiet mg-inq__aside">
              <strong>다음 행동</strong>
              <ul class="mg-bullets">
                <li>통화 기록 대조 · 해당 창구 응답 여부 확인</li>
                <li>응답 없음 · 부재중 확정 후 재연락 준비</li>
                <li>응답 있음 · 기관 답변 정리 후 필요 상태 진행</li>
              </ul>
            </div>` : ""}
          ${stale && ["no-answer", "failed"].includes(inquiry.status)
            ? `<p class="mg-inst__meta mg-inq__aside">요청 조건 정정 · 문의 사용 중지 · 변경 조건 재준비</p>` : ""}
          ${canRetry ? `<div class="btn-wrap mg-inq__act">
            <button type="button" class="krds-btn small secondary" data-action="retry" data-inquiry="${request.inquiries.indexOf(inquiry)}">
              이 창구에 다시 연락 준비<span class="sr-only"> · ${esc(institution?.name ?? "")}</span></button>
          </div>` : ""}
        </div>
      </li>`;
    },

    /* 선택한 시민의 다른 요청만 표시한다. */
    personHistory(request) {
      if (this.historyLoading) return `<li>요청 이력 조회 중</li>`;
      const ref = request.citizenRef;
      const rows = this.history.filter((item) => ref && item.citizenRef === ref && item.id !== request.id);
      if (!rows.length) return `<li>동일 시민 다른 요청 없음</li>`;
      return rows.map((item) => {
        const counts = new Map();
        for (const need of item.needs ?? []) counts.set(need.status, (counts.get(need.status) ?? 0) + 1);
        const tags = [...counts].map(([state, count]) => {
          const shown = NEED_STATE[state];
          return shown ? `<span class="krds-badge ${shown.badge}">${esc(shown.label)} ${count}</span>` : "";
        }).join("");
        return `<li>
          <time datetime="${esc(item.createdAt)}">${esc(timeText(item.createdAt))}</time>
          <strong>${esc(item.summary)}</strong>
          <span class="mg-badges">${tags}</span></li>`;
      }).join("");
    },

    trail(request) {
      const needName = (id) => request.needs.find((n) => n.id === id)?.description;
      const inquiryName = (id) => {
        const inquiry = request.inquiries.find((q) => q.id === id);
        if (!inquiry) return null;
        return this.institutions.get(inquiry.institutionId)?.name ?? null;
      };
      const attemptName = (id) => inquiryName(request.attempts.find((a) => a.id === id)?.inquiryId ?? "");
      const line = (event) => {
        const [head, tail] = String(event.detail ?? "").split(":");
        switch (event.type) {
          case "request-created": return ["요청 접수", "전화 접수 · 필요 확인"];
          case "consent-recorded": return ["전달 범위 확인", `전달 범위 확인 · 목적 · ${event.detail}`];
          case "inquiry-prepared": return ["문의 준비", `${inquiryName(head) ?? "등록 창구"} · 질문 정리 완료`];
          case "call-started": return ["기관 연락 시작", `${attemptName(head) ?? "등록 창구"} · 연락 시작`];
          case "call-finished": return ["기관 연락 종료", `${attemptName(head) ?? "등록 창구"} · ${ATTEMPT_RESULT[tail] ?? tail}`];
          case "answer-recorded": return ["답변 정리", `${inquiryName(head) ?? "기관"} · ${OUTCOME[tail]?.label ?? tail}`];
          case "retry-ready": return ["다시 연락 준비", `${inquiryName(head) ?? "등록 창구"} · 재연락 준비 완료`];
          case "need-stopped": return ["진행 중단", `${needName(head) ?? "선택 필요"} · 진행 중단`];
          case "choice-recorded": return ["시민 선택 반영", `${needName(head) ?? "필요"} · ${tail ?? ""}`];
          case "request-revised": return ["요청 조건 정정", "지역·제약 변경 · 진행 중 필요 재준비"];
          case "summary-corrected": return ["요청 요약 정정", "요청 내용 재정리"];
          case "callback-recorded": return ["시민 회신", event.detail];
          default: return null;
        }
      };
      const rows = this.events.map(line).map((row, index) =>
        row ? { row, at: this.events[index].at } : null).filter(Boolean).reverse();
      if (this.eventsLoading) return `<li>진행 이력 조회 중</li>`;
      if (!rows.length) return `<li>진행 이력 없음</li>`;
      return rows.map(({ row: [title, detail], at }) => `<li>
        <time datetime="${esc(at)}">${esc(timeText(at))}</time>
        <strong>${esc(title)}</strong> · ${esc(detail)}</li>`).join("");
    },

    /* 담당자 동작 */
    askRevise() {
      const request = this.requests.find((item) => item.id === this.selectedId);
      if (!request) return;
      dialog.open({
        title: "요청 내용 정정",
        body: `
          <p class="mg-detail__lead">지역·제약 변경 시 진행 중 필요 전체 연락 준비 상태 복귀 · 기존 답변 재확인 필요</p>
          <div class="form-group">
            <div class="form-tit"><label for="revise-summary">요청 요약</label><span class="mg-required">필수</span></div>
            <div class="form-conts"><div class="textarea-wrap"><textarea id="revise-summary" class="krds-input" rows="3" required aria-required="true">${esc(request.summary)}</textarea></div></div>
            <p class="form-hint">요약 단독 수정 시 진행 상태 유지</p>
          </div>
          <div class="form-group">
            <div class="form-tit"><label for="revise-district">거주 자치구</label><span class="mg-required">필수</span></div>
            <div class="form-conts"><input type="text" id="revise-district" class="krds-input" required aria-required="true" value="${esc(request.district)}"></div>
          </div>
          <div class="form-group">
            <div class="form-tit"><label for="revise-constraints">시민이 알려 준 제약</label></div>
            <div class="form-conts"><div class="textarea-wrap"><textarea id="revise-constraints" class="krds-input" rows="3">${esc(request.constraints.join("\n"))}</textarea></div></div>
            <p class="form-hint">한 줄에 하나</p>
          </div>
          <p class="form-hint-invalid" id="revise-error" role="status" aria-live="polite"></p>`,
        actions: [
          { label: "취소", kind: "tertiary", onClick: (d) => d.close() },
          { label: "정정 내용 저장", kind: "primary", onClick: async (d) => {
            const summary = document.getElementById("revise-summary").value.trim();
            const district = document.getElementById("revise-district").value.trim();
            const constraints = document.getElementById("revise-constraints").value
              .split("\n").map((line) => line.trim()).filter(Boolean);
            const error = document.getElementById("revise-error");
            if (!summary || !district) { error.textContent = "요약·자치구 필수 입력"; return; }
            try {
              await api("PATCH", `/api/coordination/requests/${request.id}`, { summary, district, constraints });
              d.close();
              announce("요청 내용 정정 완료");
              await this.refresh(false);
            } catch (failure) { error.textContent = failure.message; }
          } },
        ],
      });
    },

    askStop(needIndex) {
      const request = this.requests.find((item) => item.id === this.selectedId);
      const need = request?.needs[needIndex];
      if (!need) return;
      dialog.open({
        title: "필요 진행 중단",
        body: `<p class="mg-detail__lead">대상 · ‘${esc(need.description)}’ · 준비·진행 중 문의 취소 · 동일 요청의 다른 필요 유지</p>
               <p class="form-hint-invalid" id="stop-error" role="status" aria-live="polite"></p>`,
        actions: [
          { label: "취소", kind: "tertiary", onClick: (d) => d.close() },
          { label: "진행 중단", kind: "primary", onClick: async (d) => {
            try {
              await api("POST", `/api/coordination/requests/${request.id}/needs/${need.id}/stop`);
              d.close();
              announce("필요 진행 중단 완료");
              await this.refresh(false);
            } catch (failure) { document.getElementById("stop-error").textContent = failure.message; }
          } },
        ],
      });
    },

    askRetry(inquiryIndex) {
      const request = this.requests.find((item) => item.id === this.selectedId);
      const inquiry = request?.inquiries[inquiryIndex];
      if (!inquiry) return;
      const institution = this.institutions.get(inquiry.institutionId);
      dialog.open({
        title: "다시 연락 준비",
        body: `<p class="mg-detail__lead">대상 · ${esc(institution?.name ?? "등록 문의 창구")} ‘${esc(inquiry.contactPurpose)}’ 창구 · 동일 내용 재문의 준비 · 즉시 발신 없음 · 통화 결과 대리 기록 없음</p>
               <p class="form-hint-invalid" id="retry-error" role="status" aria-live="polite"></p>`,
        actions: [
          { label: "취소", kind: "tertiary", onClick: (d) => d.close() },
          { label: "다시 연락 준비", kind: "primary", onClick: async (d) => {
            try {
              await api("POST", `/api/coordination/requests/${request.id}/inquiries/${inquiry.id}/retry`);
              d.close();
              announce("재연락 준비 완료");
              await this.refresh(false);
            } catch (failure) { document.getElementById("retry-error").textContent = failure.message; }
          } },
        ],
      });
    },
  };
  work.visibility = () => { work.updatePollState(); if (!document.hidden) work.refresh(false); };

  /* ── 화면 전환 ─────────────────────────────── */
  const route = window.location.pathname === "/ops" ? "/ops" : "/app";
  for (const link of document.querySelectorAll("[data-route]")) {
    if (link.dataset.route === route) link.setAttribute("aria-current", "page");
  }
  document.title = route === "/ops" ? "요청 진행 · 말결 담당자 화면" : "지원망 · 말결 담당자 화면";
  (route === "/ops" ? work : network).start();
})();
