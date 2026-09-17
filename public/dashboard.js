/*
 * 말결 보조금 정산 운영 대시보드
 *
 * 데이터 원칙
 * - 실측(LIVE): /api/food-support/program, /api/demo/food-order-proof
 *   (참고본에 명시된 필드만 사용: programName, integrationStatus,
 *    categories.allowed/prohibited / 주문 ID 585492, 국내산 모듬잡곡, 12300, PREPARING)
 * - 합성(SYNTHETIC): 시연용 시나리오. 화면에서 항상 라벨 표기.
 * - 실측 실패 시 DEMO-FALLBACK 라벨을 노출하고 조용히 대체하지 않음.
 * - 예산 등식: allocated = available + reserved + committed
 */
(function () {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- 포맷터 ---------- */
  const fmtKRW = (n) => (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString('ko-KR') + '원' : '확인 필요';
  const fmtNum = (n) => (typeof n === 'number' && isFinite(n))
    ? n.toLocaleString('ko-KR') : '—';
  const fmtPct = (num, den) => (den > 0)
    ? (num / den * 100).toFixed(1) + '%' : '—';
  const safe = (v, fb = '확인 필요') => (v == null || v === '') ? fb : String(v);

  function toast(msg, isErr = false) {
    const el = $('#toast'); if (!el) return;
    el.textContent = msg;
    el.classList.toggle('toast--error', !!isErr);
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 3000);
  }
  const showLoading = (b) => { const el = $('#loading'); if (el) el.hidden = !b; };

  /* =========================================================
   * SYNTHETIC — 참고본에 명시된 데이터 모델만 반영
   *   allocated = available + reserved + committed
   *   5,000,000 = 2,000,000 + 1,800,000 + 1,200,000
   * ========================================================= */
  const SYN = {
    budget: {
      allocated: 5000000,
      available: 2000000,
      reserved:  1800000,
      committed: 1200000,
    },
    asOf: '2026-01-17',
    fiscalPeriod: '2026 회계연도 · 1월',

    dailyCommitted: [
      { d: '01-11', v: 120000 },
      { d: '01-12', v: 165000 },
      { d: '01-13', v: 142000 },
      { d: '01-14', v: 198000 },
      { d: '01-15', v: 215000 },
      { d: '01-16', v: 178000 },
      { d: '01-17', v: 182000 },
    ],
    dailyTarget: 170000,

    funnel: [
      { stage: '요청',   count: 42 },
      { stage: '해석',   count: 39 },
      { stage: '정책',   count: 34 },
      { stage: '주문',   count: 30 },
      { stage: '배송',   count: 26 },
      { stage: '정산',   count: 21 },
    ],

    // 정책 API 실패 시 폴백 (참고본에 명시된 식품지원 성격 유지)
    fallbackPolicy: {
      programName: '식품지원 시연 프로그램',
      integrationStatus: 'COMPATIBLE_RULESET_NOT_OFFICIAL_PAYMENT_INTEGRATION',
      categories: {
        allowed:    ['국내산 잡곡', '두부·계란', '흰 우유', '국내산 채소', '국내산 과일', '육류', '임산물 견과류'],
        prohibited: ['백미', '라면', '가공식품', '수입식품', '수산물', '주류', '담배'],
      },
    },

    suppliers: [
      {
        id: 'SUP-01', name: '서울부흥', region: '서울 강동',
        policyOk: true, activeOrders: 8, processing: 1250000,
        avgHandle: '38분', delays: 1, missingProof: 0,
        status: '정상',
      },
      {
        id: 'SUP-02', name: '경기물산', region: '경기 성남',
        policyOk: true, activeOrders: 5, processing: 780000,
        avgHandle: '54분', delays: 2, missingProof: 1,
        status: '주의',
      },
      {
        id: 'SUP-03', name: '충남푸드', region: '충남 천안',
        policyOk: false, activeOrders: 3, processing: 420000,
        avgHandle: '1시간 12분', delays: 0, missingProof: 0,
        status: '정책 확인',
      },
    ],

    cases: [
      {
        id: 'CASE-2026-005', at: '10:05',
        item: '보리쌀 5kg', policy: 'ok',
        supplier: '서울부흥', order: 'ORD-1105', orderStatus: 'delivering',
        prio: 'high',
        timeline: [
          { title: '전화 요청 접수',       desc: '070 회선 · 10:05', s: 'ok' },
          { title: 'Gemini 의도 해석',     desc: '보리쌀 5kg · 배송 요청', s: 'ok' },
          { title: '정책 판정',            desc: '허용 품목 · 예산 충족', s: 'ok' },
          { title: '사용자 확인',          desc: '음성 서명 검증 완료', s: 'ok' },
          { title: '공급자 배정',          desc: '서울부흥 · 강동권역', s: 'ok' },
          { title: '주문 접수',            desc: 'ORD-1105 · 42,000원', s: 'ok' },
          { title: '배송',                 desc: '배송 진행 중 (18분 경과)', s: 'info' },
          { title: '정산 증거',            desc: '배송 완료 후 연결 예정', s: 'pending' },
        ],
      },
      {
        id: 'CASE-2026-004', at: '09:55',
        item: '흰 우유 1L', policy: 'ok',
        supplier: '충남푸드', order: 'ORD-1104', orderStatus: 'new',
        prio: 'high',
        timeline: [
          { title: '전화 요청 접수',       desc: '070 회선 · 09:55', s: 'ok' },
          { title: 'Gemini 의도 해석',     desc: '흰 우유 1L', s: 'ok' },
          { title: '정책 판정',            desc: '허용 품목 · 예산 충족', s: 'ok' },
          { title: '사용자 확인',          desc: '음성 서명 검증 완료', s: 'ok' },
          { title: '공급자 배정',          desc: '충남푸드 (정책 확인 중)', s: 'warn' },
          { title: '주문 접수',            desc: '대기', s: 'pending' },
        ],
      },
      {
        id: 'CASE-2026-003', at: '09:41',
        item: '완제조리식품 3인분', policy: 'hold',
        supplier: '—', order: '—', orderStatus: 'hold',
        prio: 'high',
        timeline: [
          { title: '전화 요청 접수',       desc: '070 회선 · 09:41', s: 'ok' },
          { title: 'Gemini 의도 해석',     desc: '완제조리식품 3인분', s: 'ok' },
          { title: '정책 판정',            desc: '금지 품목 · 보류', s: 'danger' },
          { title: '사용자 확인',          desc: '대안 품목 안내 필요', s: 'pending' },
        ],
      },
      {
        id: 'CASE-2026-002', at: '09:18',
        item: '두부 5모, 계란 30구', policy: 'ok',
        supplier: '경기물산', order: 'ORD-1102', orderStatus: 'done',
        prio: 'low',
        timeline: [
          { title: '전화 요청 접수',       desc: '070 회선 · 09:18', s: 'ok' },
          { title: '정책 판정',            desc: '허용 품목', s: 'ok' },
          { title: '공급자 배정',          desc: '경기물산', s: 'ok' },
          { title: '주문 접수',            desc: 'ORD-1102 · 18,500원', s: 'ok' },
          { title: '배송',                 desc: '완료', s: 'ok' },
          { title: '정산 증거',            desc: '연결됨', s: 'ok' },
        ],
      },
      {
        id: 'CASE-2026-001', at: '09:02',
        item: '국내산 모듬잡곡 5kg', policy: 'ok',
        supplier: '서울부흥', order: 'ORD-1101', orderStatus: 'done',
        prio: 'low',
        timeline: [
          { title: '전화 요청 접수',       desc: '070 회선 · 09:02', s: 'ok' },
          { title: '정책 판정',            desc: '허용 품목', s: 'ok' },
          { title: '공급자 배정',          desc: '서울부흥', s: 'ok' },
          { title: '주문 접수',            desc: 'ORD-1101 · 42,000원', s: 'ok' },
          { title: '배송',                 desc: '완료', s: 'ok' },
          { title: '정산 증거',            desc: '연결됨', s: 'ok' },
        ],
      },
    ],

    counters: {
      holdCount: 1, holdOldest: '09:41',
      delayCount: 3, delayOldest: '전일 18:20',
    },
  };

  const STATUS_LABEL = {
    new: '신규', processing: '진행 중', delivering: '배송 중',
    done: '완료', hold: '보류',
  };
  const POLICY_LABEL = { ok: '허용', hold: '보류' };
  const CATEGORY_LABEL = {
    DOMESTIC_FRUIT: '국내산 과일', DOMESTIC_VEGETABLE: '국내산 채소',
    WHITE_MILK: '흰 우유', FRESH_EGGS: '신선 계란', MEAT: '육류',
    MIXED_GRAINS: '잡곡', TOFU: '두부', FOREST_NUTS: '임산물 견과류',
    WHITE_RICE: '백미', INSTANT_NOODLES: '라면', PROCESSED_FOOD: '가공식품',
    FOREIGN_FOOD: '수입식품', SEAFOOD: '수산물', ALCOHOL: '주류', TOBACCO: '담배',
    GIFT_CARD: '상품권', CASH_EQUIVALENT: '현금성 물품', FIREARM: '총기',
    AMMUNITION: '탄약', ILLEGAL_DRUG: '불법 약물', HIGH_RISK_UNKNOWN: '고위험 미확인 품목',
    OUT_OF_POLICY: '정책 외 품목',
  };
  const DELIVERY_LABEL = { PREPARING: '배송 준비', SHIPPED: '발송', IN_TRANSIT: '배송 중', DELIVERED: '배송 완료', CANCELLED: '취소' };
  let loading = false;
  const VIEW_TITLE = {
    overview:'프로그램 현황',
    cases:'전화 요청 사건',
    suppliers:'지정 공급자',
    settlement:'정산 증거',
  };

  /* =========================================================
   * 상태
   * ========================================================= */
  const state = {
    view: 'overview',
    program: null, programSrc: 'loading',
    proof: null,   proofSrc:   'loading',
    caseFilter: { status: 'all', prio: 'all', q: '' },
    selectedCaseId: null,
  };

  /* =========================================================
   * 초기화
   * ========================================================= */
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    validateBudget();
    bind();
    renderContextStatic();
    renderBudget();
    renderTrend();
    renderFunnel();
    renderCases();
    renderSuppliers();
    renderAlerts();
    updateStamp();
    loadAll();
  }

  function bind() {
    const tabs = $$('.nav-btn');
    tabs.forEach((tab, index) => {
      tab.tabIndex = index === 0 ? 0 : -1;
      tab.addEventListener('keydown', (event) => {
        const offset = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (offset === undefined && !['Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
        switchView(tabs[next].dataset.view);
        tabs[next].focus();
      });
    });
    $$('.view').forEach(panel => { panel.tabIndex = 0; });
    $$('.nav-btn').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
    $$('[data-jump]').forEach((el) => {
      const go = () => {
        if (el.dataset.jump === 'cases') {
          state.caseFilter.status = 'hold';
          $('#case-status').value = 'hold';
          renderCases();
        }
        switchView(el.dataset.jump);
        $('.view:not([hidden])')?.focus();
      };
      el.addEventListener('click', go);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
    $('#case-status')?.addEventListener('change', (e) => {
      state.caseFilter.status = e.target.value; renderCases();
    });
    $('#case-prio')?.addEventListener('change', (e) => {
      state.caseFilter.prio = e.target.value; renderCases();
    });
    $('#case-search')?.addEventListener('input', (e) => {
      state.caseFilter.q = e.target.value.trim().toLowerCase(); renderCases();
    });
    $('#btn-refresh')?.addEventListener('click', () => loadAll(true));
    window.addEventListener('resize', debounce(() => {
      renderTrend(); renderFunnel();
    }, 200));
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function switchView(view) {
    if (!Object.hasOwn(VIEW_TITLE, view) || view === state.view) return;
    state.view = view;
    $$('.nav-btn').forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $$('.view').forEach((p) => {
      const on = p.id === 'view-' + view;
      p.hidden = !on;
      p.setAttribute('aria-hidden', String(!on));
    });
    // 접근성: 뷰 전환 시 컨텍스트바 유지, 스크롤을 상단으로
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function validateBudget() {
    const b = SYN.budget;
    if (b.available + b.reserved + b.committed !== b.allocated) {
      console.error('[budget] 등식 위반');
    }
  }

  function updateStamp() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const el = $('#last-updated'); if (el) el.textContent = `${hh}:${mm}`;
  }

  /* =========================================================
   * 컨텍스트 바
   * ========================================================= */
  function renderContextStatic() {
    $('#ctx-asof').textContent = `${SYN.asOf} · ${SYN.fiscalPeriod}`;
  }
  function renderContextFromProgram() {
    const el = $('#ctx-program');
    const st = $('#ctx-status');
    const badge = $('#program-badge');
    const policyBadge = $('#policy-source-badge');

    const live = state.programSrc === 'live' && state.program;
    const p = live ? state.program : SYN.fallbackPolicy;

    if (el) el.textContent = safe(p.programName, '식품지원 프로그램');

    if (st) {
      st.className = 'badge ' + (live ? 'b-info' : 'b-warn');
      st.innerHTML = '';
      const dot = document.createElement('span'); dot.className = 'badge-dot';
      st.appendChild(dot);
      st.appendChild(document.createTextNode(p.integrationStatus === 'COMPATIBLE_RULESET_NOT_OFFICIAL_PAYMENT_INTEGRATION'
        ? '호환 정책 · 공식 결제 연동 아님' : '연동 상태 확인 필요'));
    }

    if (badge) {
      badge.className = 'badge ' + (live ? 'b-live' : 'b-danger');
      badge.innerHTML = '';
      const dot = document.createElement('span'); dot.className = 'badge-dot';
      badge.appendChild(dot);
      badge.appendChild(document.createTextNode(
        live ? '정책 API 연결됨' : '정책 연결 불가 · 예시 규칙'
      ));
    }

    if (policyBadge) {
      policyBadge.className = 'badge ' + (live ? 'b-live' : 'b-warn');
      policyBadge.innerHTML = '';
      const dot = document.createElement('span'); dot.className = 'badge-dot';
      policyBadge.appendChild(dot);
      policyBadge.appendChild(document.createTextNode(
        live ? '정책 API 연결됨' : '예시 규칙 · 정책 API 확인 필요'
      ));
    }

    renderPolicyChips(p, !live);
  }
  function renderPolicyChips(p, isFallback) {
    const allow = Array.isArray(p?.categories?.allowed)    ? p.categories.allowed    : [];
    const deny  = Array.isArray(p?.categories?.prohibited) ? p.categories.prohibited : [];

    const aList = $('#allow-list');
    const dList = $('#deny-list');
    if (!aList || !dList) return;

    aList.innerHTML = '';
    dList.innerHTML = '';

    allow.forEach((name) => {
      const li = document.createElement('li');
      li.textContent = safe(name);
      aList.appendChild(li);
    });
    deny.forEach((name) => {
      const li = document.createElement('li');
      li.textContent = safe(name);
      dList.appendChild(li);
    });

    $('#allow-count').textContent = String(allow.length);
    $('#deny-count') .textContent = String(deny.length);

    const note = $('#policy-fallback');
    if (note) note.hidden = !isFallback;
  }

  /* =========================================================
   * 예산 패널
   * ========================================================= */
  function renderBudget() {
    const b = SYN.budget;

    $('#fig-allocated').textContent = fmtKRW(b.allocated);
    $('#fig-available').textContent = fmtKRW(b.available);
    $('#fig-reserved') .textContent = fmtKRW(b.reserved);
    $('#fig-committed').textContent = fmtKRW(b.committed);

    $('#pct-available').textContent = fmtPct(b.available, b.allocated);
    $('#pct-reserved') .textContent = fmtPct(b.reserved,  b.allocated);
    $('#pct-committed').textContent = fmtPct(b.committed, b.allocated);

    const pA = b.available / b.allocated * 100;
    const pR = b.reserved  / b.allocated * 100;
    const pC = b.committed / b.allocated * 100;
    $('#seg-avail').style.width = pA.toFixed(2) + '%';
    $('#seg-resv') .style.width = pR.toFixed(2) + '%';
    $('#seg-comm') .style.width = pC.toFixed(2) + '%';

    const eq = $('#budget-eq');
    if (eq) {
      eq.innerHTML = '';
      eq.appendChild(txt('배정 '));
      eq.appendChild(bold(fmtKRW(b.allocated)));
      eq.appendChild(txt(' = 사용 가능 '));
      eq.appendChild(bold(fmtKRW(b.available)));
      eq.appendChild(txt(' + 예약 '));
      eq.appendChild(bold(fmtKRW(b.reserved)));
      eq.appendChild(txt(' + 집행 '));
      eq.appendChild(bold(fmtKRW(b.committed)));
    }
  }
  function txt(t) { return document.createTextNode(t); }
  function bold(t) { const b = document.createElement('b'); b.textContent = t; return b; }

  /* =========================================================
   * 즉시 조치 카드
   * ========================================================= */
  function renderAlerts() {
    const c = SYN.counters;
    $('#alert-hold').textContent  = fmtNum(c.holdCount) + '건';
    $('#alert-hold-oldest').textContent = safe(c.holdOldest, '—');
    $('#alert-delay').textContent = fmtNum(c.delayCount) + '건';
    $('#alert-delay-oldest').textContent = safe(c.delayOldest, '—');
    $('#alert-proof').textContent = state.proofSrc === 'live' ? '1건' : '확인 필요';
  }

  /* =========================================================
   * 차트: 추이 (라인 + 목표선)
   * ========================================================= */
  function renderTrend() {
    const svg = $('#chart-trend'); if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = 720, H = 200, pad = { l: 44, r: 16, t: 14, b: 28 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const data = SYN.dailyCommitted;
    const max = Math.max(SYN.dailyTarget, ...data.map((d) => d.v)) * 1.15;
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const xStep = iw / (data.length - 1);
    const yFor = (v) => pad.t + ih - (v / max) * ih;
    const xFor = (i) => pad.l + i * xStep;

    // defs
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="gradInfo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#245a9a" stop-opacity="0.45"/>
        <stop offset="1" stop-color="#245a9a" stop-opacity="0.02"/>
      </linearGradient>`;
    svg.appendChild(defs);

    // grid + Y axis
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ih / 4) * i;
      svg.appendChild(svgEl('line', {
        x1: pad.l, x2: W - pad.r, y1: y, y2: y, class: 'grid',
      }));
      const v = max - max * (i / 4);
      const t = svgEl('text', {
        x: pad.l - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-text',
      });
      t.textContent = Math.round(v / 1000) + 'k';
      svg.appendChild(t);
    }
    // X axis
    data.forEach((d, i) => {
      const t = svgEl('text', {
        x: xFor(i), y: H - 8, 'text-anchor': 'middle', class: 'axis-text',
      });
      t.textContent = d.d;
      svg.appendChild(t);
    });

    // 목표선
    const yT = yFor(SYN.dailyTarget);
    svg.appendChild(svgEl('line', {
      x1: pad.l, x2: W - pad.r, y1: yT, y2: yT, class: 'line-avg',
    }));
    const tT = svgEl('text', {
      x: W - pad.r, y: yT - 4, 'text-anchor': 'end', class: 'axis-text',
    });
    tT.textContent = '목표 ' + Math.round(SYN.dailyTarget / 1000) + 'k';
    tT.setAttribute('fill', '#167a45');
    svg.appendChild(tT);

    // 영역
    let dArea = `M ${xFor(0)} ${pad.t + ih} `;
    data.forEach((d, i) => { dArea += `L ${xFor(i)} ${yFor(d.v)} `; });
    dArea += `L ${xFor(data.length - 1)} ${pad.t + ih} Z`;
    svg.appendChild(svgEl('path', { d: dArea, class: 'area-main' }));

    // 라인
    let dLine = '';
    data.forEach((d, i) => { dLine += (i === 0 ? 'M ' : 'L ') + xFor(i) + ' ' + yFor(d.v) + ' '; });
    svg.appendChild(svgEl('path', { d: dLine, class: 'line-main' }));

    // 점 + hover
    const tip = $('#trend-tooltip');
    data.forEach((d, i) => {
      const cx = xFor(i), cy = yFor(d.v);
      svg.appendChild(svgEl('circle', { cx, cy, r: 3.4, class: 'dot-main' }));
      const hit = svgEl('circle', { cx, cy, r: 12, class: 'dot-hit' });
      hit.addEventListener('mouseenter', () => {
        if (!tip) return;
        tip.hidden = false;
        tip.textContent = `${d.d} · ${fmtKRW(d.v)}`;
        posTooltip(tip, svg, cx, cy);
      });
      hit.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; });
      svg.appendChild(hit);
    });

    // 접근성 텍스트 표
    const tb = $('#trend-tbody');
    if (tb) {
      tb.innerHTML = '';
      data.forEach((d) => {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td'); td1.textContent = d.d;
        const td2 = document.createElement('td'); td2.className = 'num'; td2.textContent = fmtKRW(d.v);
        tr.append(td1, td2); tb.appendChild(tr);
      });
    }
  }

  /* =========================================================
   * 차트: 병목 퍼널 (수직 바 + 이탈률)
   * ========================================================= */
  function renderFunnel() {
    const svg = $('#chart-funnel'); if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const W = 720, H = 200, pad = { l: 16, r: 16, t: 14, b: 36 };
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const data = SYN.funnel;
    const max  = Math.max(...data.map((d) => d.count));
    const iw   = W - pad.l - pad.r;
    const bw   = iw / data.length - 12;
    const tip  = $('#funnel-tooltip');

    data.forEach((d, i) => {
      const h = Math.round((d.count / max) * (H - pad.t - pad.b));
      const x = pad.l + i * (bw + 12);
      const y = H - pad.b - h;

      const r = svgEl('rect', {
        x, y, width: bw, height: h, rx: 3, ry: 3, class: 'bar-fn',
      });
      r.addEventListener('mouseenter', () => {
        if (!tip) return;
        tip.hidden = false;
        const drop = i > 0 ? Math.round((1 - d.count / data[i-1].count) * 100) : 0;
        tip.textContent = `${d.stage} · ${fmtNum(d.count)}건${i > 0 ? ` · 이탈 ${drop}%` : ''}`;
        posTooltip(tip, svg, x + bw / 2, y);
      });
      r.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; });
      svg.appendChild(r);

      const val = svgEl('text', {
        x: x + bw / 2, y: y - 6, 'text-anchor': 'middle', class: 'bar-val',
      });
      val.textContent = fmtNum(d.count);
      svg.appendChild(val);

      const lab = svgEl('text', {
        x: x + bw / 2, y: H - 18, 'text-anchor': 'middle', class: 'bar-axis',
      });
      lab.textContent = d.stage;
      svg.appendChild(lab);

      if (i > 0) {
        const drop = Math.round((1 - d.count / data[i-1].count) * 100);
        const sub = svgEl('text', {
          x: x + bw / 2, y: H - 4, 'text-anchor': 'middle', class: 'axis-text',
        });
        sub.textContent = '-' + drop + '%';
        sub.setAttribute('fill', drop >= 15 ? '#c62828' : '#626b78');
        svg.appendChild(sub);
      }
    });

    // 접근성 텍스트 표
    const tb = $('#funnel-tbody');
    if (tb) {
      tb.innerHTML = '';
      data.forEach((d, i) => {
        const tr = document.createElement('tr');
        const t1 = document.createElement('td'); t1.textContent = d.stage;
        const t2 = document.createElement('td'); t2.className = 'num'; t2.textContent = fmtNum(d.count);
        const t3 = document.createElement('td'); t3.className = 'num';
        t3.textContent = i > 0 ? '-' + Math.round((1 - d.count / data[i-1].count) * 100) + '%' : '—';
        tr.append(t1, t2, t3); tb.appendChild(tr);
      });
    }
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function posTooltip(tip, svg, cx, cy) {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const sx = rect.width / vb.width, sy = rect.height / vb.height;
    const p = svg.parentElement.getBoundingClientRect();
    tip.style.left = (rect.left - p.left + cx * sx) + 'px';
    tip.style.top  = (rect.top  - p.top  + cy * sy) + 'px';
  }

  /* =========================================================
   * 사건 (전화 요청 목록 + 상세 타임라인)
   * ========================================================= */
  function renderCases() {
    const tb = $('#cases-tbody'); if (!tb) return;
    const info = $('#case-result');
    tb.innerHTML = '';

    const rows = SYN.cases.filter((c) => {
      const stKey = mapOrderToFilter(c.orderStatus, c.policy);
      if (state.caseFilter.status !== 'all' && stKey !== state.caseFilter.status) return false;
      if (state.caseFilter.prio   !== 'all' && c.prio  !== state.caseFilter.prio)   return false;
      if (state.caseFilter.q) {
        const hay = (c.id + ' ' + c.item + ' ' + (c.supplier || '')).toLowerCase();
        if (!hay.includes(state.caseFilter.q)) return false;
      }
      return true;
    });

    if (info) info.textContent = `총 ${rows.length}건 표시`;
    if (!rows.some((row) => row.id === state.selectedCaseId)) {
      state.selectedCaseId = null;
      renderCaseDetail(null);
    }

    if (rows.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7" class="tbl-empty">조건에 맞는 사건이 없습니다.</td>';
      tb.appendChild(tr);
      renderCaseDetail(null);
      return;
    }

    rows.forEach((c) => {
      const tr = document.createElement('tr');
      tr.dataset.clickable = 'true';
      tr.tabIndex = 0;
      tr.setAttribute('aria-selected', String(state.selectedCaseId === c.id));

      // 접수 · ID · 품목
      tr.appendChild(td(c.at));
      tr.appendChild(td(c.id));
      tr.appendChild(td(c.item));

      // 정책
      const tdP = document.createElement('td');
      const bP = document.createElement('span');
      bP.className = 'badge ' + (c.policy === 'ok' ? 'b-live' : 'b-danger');
      const dot = document.createElement('span'); dot.className = 'badge-dot';
      bP.appendChild(dot);
      bP.appendChild(document.createTextNode(POLICY_LABEL[c.policy] || '확인 필요'));
      tdP.appendChild(bP);
      tr.appendChild(tdP);

      // 공급자
      tr.appendChild(td(safe(c.supplier, '—')));

      // 주문 상태
      const tdS = document.createElement('td');
      tdS.appendChild(statusBadge(c.orderStatus));
      tr.appendChild(tdS);

      // 우선도
      const tdPr = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = 'pri-pill ' + c.prio;
      pill.textContent = c.prio === 'high' ? '높음' : c.prio === 'mid' ? '중간' : '낮음';
      tdPr.appendChild(pill);
      tr.appendChild(tdPr);

      tr.addEventListener('click', () => selectCase(c.id));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCase(c.id); }
      });
      tb.appendChild(tr);
    });

    if (state.selectedCaseId) {
      renderCaseDetail(SYN.cases.find((x) => x.id === state.selectedCaseId) || null);
    }
  }
  function mapOrderToFilter(orderStatus, policy) {
    if (policy === 'hold') return 'hold';
    if (orderStatus === 'done') return 'done';
    if (orderStatus === 'delivering') return 'delivering';
    if (orderStatus === 'new' || orderStatus === 'processing') return 'processing';
    return 'hold';
  }
  function td(t) { const el = document.createElement('td'); el.textContent = t; return el; }
  function statusBadge(s) {
    const b = document.createElement('span');
    b.className = 'badge b-st-' + (s || 'new');
    const dot = document.createElement('span'); dot.className = 'badge-dot';
    b.appendChild(dot);
    b.appendChild(document.createTextNode(STATUS_LABEL[s] || '확인 필요'));
    return b;
  }
  function selectCase(id) {
    state.selectedCaseId = id;
    $$('#cases-tbody tr').forEach((tr) => {
      const cell = tr.children[1];
      tr.setAttribute('aria-selected', String(cell && cell.textContent === id));
    });
    renderCaseDetail(SYN.cases.find((x) => x.id === id) || null);
  }
  function renderCaseDetail(c) {
    const box = $('#case-detail'); if (!box) return;
    box.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = '사건 상세';
    box.appendChild(h);

    if (!c) {
      const p = document.createElement('p'); p.className = 'muted';
      p.textContent = '좌측 표에서 사건을 선택하세요.';
      box.appendChild(p); return;
    }

    // 메타
    const meta = document.createElement('dl');
    meta.className = 'detail-meta';
    [
      ['사건 ID', c.id],
      ['접수 시각', c.at],
      ['요청 품목', c.item],
      ['공급자', safe(c.supplier, '—')],
      ['주문', safe(c.order, '—')],
    ].forEach(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      meta.append(dt, dd);
    });
    box.appendChild(meta);

    // 타임라인
    const ul = document.createElement('ol');
    ul.className = 'timeline';
    (c.timeline || []).forEach((step) => {
      const li = document.createElement('li');
      li.className = 'step-' + (step.s || 'pending');
      const t = document.createElement('p'); t.className = 'tl-title'; t.textContent = step.title;
      const d = document.createElement('p'); d.className = 'tl-desc';  d.textContent = step.desc || '';
      li.append(t, d);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /* =========================================================
   * 공급자 표
   * ========================================================= */
  function renderSuppliers() {
    const tb = $('#supp-tbody'); if (!tb) return;
    tb.innerHTML = '';
    SYN.suppliers.forEach((s) => {
      const tr = document.createElement('tr');

      // 공급자
      const t1 = document.createElement('td');
      const strong = document.createElement('div');
      strong.style.fontWeight = '700';
      strong.textContent = s.name;
      const sub = document.createElement('div');
      sub.className = 'muted'; sub.style.fontSize = '0.78rem';
      sub.textContent = s.id;
      t1.append(strong, sub);
      tr.appendChild(t1);

      // 권역
      tr.appendChild(td(s.region));

      // 정책 적합
      const t3 = document.createElement('td');
      const b = document.createElement('span');
      b.className = 'badge ' + (s.policyOk ? 'b-live' : 'b-warn');
      const dot = document.createElement('span'); dot.className = 'badge-dot';
      b.appendChild(dot);
      b.appendChild(document.createTextNode(s.policyOk ? '적합' : '확인 필요'));
      t3.appendChild(b);
      tr.appendChild(t3);

      // 활성 주문
      const t4 = document.createElement('td'); t4.className = 'num';
      t4.textContent = fmtNum(s.activeOrders) + '건';
      tr.appendChild(t4);

      // 처리 금액
      const t5 = document.createElement('td'); t5.className = 'num';
      t5.textContent = fmtKRW(s.processing);
      tr.appendChild(t5);

      // 평균 처리
      const t6 = document.createElement('td'); t6.className = 'num';
      t6.textContent = s.avgHandle;
      tr.appendChild(t6);

      // 지연
      const t7 = document.createElement('td'); t7.className = 'num';
      t7.textContent = s.delays === 0 ? '—' : fmtNum(s.delays) + '건';
      if (s.delays > 0) t7.style.color = 'var(--warn-700)';
      tr.appendChild(t7);

      // 증거 누락
      const t8 = document.createElement('td'); t8.className = 'num';
      t8.textContent = s.missingProof === 0 ? '—' : fmtNum(s.missingProof) + '건';
      if (s.missingProof > 0) t8.style.color = 'var(--danger-700)';
      tr.appendChild(t8);
      // 상태
      const t9 = document.createElement('td');
      const cls = s.status === '정상' ? 'b-live'
                : s.status === '주의' ? 'b-warn' : 'b-danger';
      const b9 = document.createElement('span');
      b9.className = 'badge ' + cls;
      const dot9 = document.createElement('span'); dot9.className = 'badge-dot';
      b9.appendChild(dot9);
      b9.appendChild(document.createTextNode(s.status));
      t9.appendChild(b9);
      tr.appendChild(t9);

      tb.appendChild(tr);
    });
  }

  /* =========================================================
   * API 로딩
   * ========================================================= */
  async function loadAll(userTriggered = false) {
    if (loading) return;
    loading = true;
    $('#btn-refresh').disabled = true;
    showLoading(true);
    try {
      await Promise.all([loadProgram(), loadProof()]);
      renderContextFromProgram();
      renderProof();
      updateStamp();
      renderAlerts();
      if (userTriggered) toast(state.programSrc === 'live' && state.proofSrc === 'live'
        ? '정책과 주문 증거를 갱신했습니다.' : '조회 완료 · 일부 데이터는 연결을 확인해 주세요.');
    } catch (e) {
      console.error(e);
      toast('데이터 로딩 중 오류가 발생했습니다.', true);
    } finally {
      showLoading(false);
      loading = false;
      $('#btn-refresh').disabled = false;
    }
  }

  async function loadProgram() {
    try {
      const r = await fetch('/api/food-support/program', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || typeof j.officialName !== 'string' || !Array.isArray(j.allowedCategories)
          || !Array.isArray(j.prohibitedCategories)
          || ![...j.allowedCategories, ...j.prohibitedCategories].every(x => typeof x === 'string')) throw new Error('invalid policy payload');
      // 참고본에 명시된 필드만 취급
      state.program = {
        programName:       j.officialName,
        integrationStatus: j.integrationStatus,
        categories: {
          allowed:    j.allowedCategories.map(x => CATEGORY_LABEL[x] || x),
          prohibited: j.prohibitedCategories.map(x => CATEGORY_LABEL[x] || x),
        },
      };
      state.programSrc = 'live';
    } catch (e) {
      console.warn('[program] fallback', e);
      state.program = null;
      state.programSrc = 'unavailable';
    }
  }

  async function loadProof() {
    try {
      const r = await fetch('/api/demo/food-order-proof', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || typeof j.externalOrderId !== 'string' || !j.externalOrderId
          || typeof j.goodsName !== 'string' || !j.goodsName
          || !Number.isFinite(j.totalPriceKrw) || j.totalPriceKrw < 0
          || typeof j.deliveryState !== 'string' || j.source !== 'SPECIAL_OFFER_LIVE'
          || !Number.isFinite(j.refreshedAt) || !Number.isFinite(new Date(j.refreshedAt).getTime())) throw new Error('invalid proof payload');
      state.proof = j;
      state.proofSrc = 'live';
    } catch (e) {
      console.warn('[proof] fallback', e);
      state.proof = null;
      state.proofSrc = 'unavailable';
    }
  }

  /* =========================================================
   * 정산 증거 렌더
   * ========================================================= */
  function renderProof() {
    const badge = $('#proof-badge');
    const grid  = $('#proof-grid');
    const raw   = $('#proof-raw');
    const netEl = $('#alert-net');
    if (!grid || !raw || !badge) return;

    const setBadge = (cls, text) => {
      badge.className = 'badge ' + cls;
      badge.innerHTML = '';
      const dot = document.createElement('span'); dot.className = 'badge-dot';
      badge.appendChild(dot);
      badge.appendChild(document.createTextNode(text));
    };

    if (state.proofSrc !== 'live' || !state.proof) {
      setBadge('b-warn', '주문 증거 연결 불가');
      grid.innerHTML = '';
      appendKV(grid, '상태', '증거 API 응답 없음');
      appendKV(grid, '안내', '공급자 조회 연결을 확인한 뒤 새로고침해 주세요. 주문이 없다는 뜻은 아닙니다.');
      raw.textContent = '—';
      if (netEl) netEl.textContent = '확인 필요';
      return;
    }

    setBadge('b-live', '공급자 조회 확인 · 과거 주문');
    const p = state.proof;

    // 참고본에서 확인된 필드만 우선 사용, 그 외는 안전한 후보로 매핑
    const orderId   = p.externalOrderId;
    const itemName  = p.goodsName;
    const amount    = p.totalPriceKrw;
    const orderStat = DELIVERY_LABEL[p.deliveryState] || p.deliveryState;
    const ts        = new Date(p.refreshedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

    grid.innerHTML = '';
    appendKV(grid, '주문 ID',    safe(orderId));
    appendKV(grid, '품목',       safe(itemName));
    appendKV(grid, '금액',       typeof amount === 'number' ? fmtKRW(amount) : '확인 필요');
    appendKV(grid, '주문 상태',  safe(orderStat));
    appendKV(grid, '조회 시각 (한국)', ts);
    appendKV(grid, '출처', '외부 공급자 주문 조회');
    appendKV(grid, '출처 종류',  '과거 고정 증거 · 현재 진행 사건 아님');
    appendKV(grid, '레일 구분',  '외부 공급자 주문과 Devnet 기술증명은 분리된 레일');

    try { raw.textContent = JSON.stringify(p, null, 2); }
    catch { raw.textContent = '표시 불가'; }

    if (netEl) netEl.textContent = '외부 공급자';
  }

  function appendKV(root, k, v) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    root.append(dt, dd);
  }

  /* =========================================================
   * 테스트 훅 (외부에서 검증 가능하도록 최소 노출)
   * ========================================================= */
  if (typeof window !== 'undefined') {
    window.__malgyeol = {
      state: () => JSON.parse(JSON.stringify({
        view: state.view,
        programSrc: state.programSrc,
        proofSrc: state.proofSrc,
        caseFilter: state.caseFilter,
        selectedCaseId: state.selectedCaseId,
      })),
      switchView,
      fmtKRW,
      fmtPct,
      SYN,
    };
  }
})();
