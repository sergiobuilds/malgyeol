/* =========================================================================
   말결 — 표면 세 개를 한 벌의 디자인 토큰 위에 올린 실제 앱.
   원칙
   1) 확인되지 않은 값은 만들어 내지 않는다 → "확인 필요"로 표기한다.
   2) 예시 상품·예시 주문·예시 대기열·예시 알림·예시 사진을 두지 않는다.
      값이 없으면 비어 있음·자격 증명 필요·만료·오류를 그대로 말한다.
   3) 공개 화면에서는 결제·주문 실행이 끝까지 진행되지 않는다.
      order-submit은 운영자 bearer 경계 뒤에 있고 이 파일은 호출하지 않는다.
   4) sessionStorage에는 비개인정보 상품·세션 토큰만 둔다. 받는이 정보와
      미리보기 증표는 메모리에만 두고 10분·pagehide·완료 시 지운다.
   표면
      ben  이용자 모바일 (390px 기준)  — 차분한 소비자 서비스
      ops  기관 담당자 PC (1440px 기준) — 처리할 일이 먼저 보이는 업무함
      demo 심사 데모 (1440px 기준)      — 기준 네 축, 시나리오 셋, 검증된 레일 둘
   ====================================================================== */
(function () {
  'use strict';

  document.body.insertAdjacentHTML('afterbegin', window.__SPRITE__ || '');

  var SUPPORT_PHONE = '070-5275-3884';
  var SUPPORT_TEL = 'tel:07052753884';

  /* ---------------- 유틸 ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function ico(n, cls) { return '<svg class="ico ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + n + '"></use></svg>'; }
  function say(msg, assertive) { var el = $(assertive ? '#live-alert' : '#live-status'); if (el) { el.textContent = ''; setTimeout(function () { el.textContent = msg; }, 30); } }
  var UNKNOWN = '<span class="unknown">확인 필요</span>';
  var LIVE = {
    program: null, programError: '', productChecking: false, productCheckError: '', catalogStatus: '', products: [], query: '', searched: false,
    interpretation: null, loading: false, voiceError: '', continuationError: '', orderIntentNotice: '', institutionInviteError: '',
    demo: null, demoError: '', demoLoading: false, demoRequestedId: '',
    demoBlocked: null, demoBlockedError: '', demoBlockedLoading: false, demoBlockedRequestedId: '',
    foodOrder: null, foodOrderError: '', foodOrderStatus: '', foodOrderLoading: false, foodOrderRequested: false,
    ops: null, opsError: '', opsLoading: false, opsRequested: false, opsConnectError: ''
  };
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  async function apiJson(path, options) {
    var response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}));
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) { var error = new Error(body.error || body.status || '요청 실패'); error.status = response.status; error.body = body; throw error; }
    return body;
  }
  function webCaseId() {
    var id = sessionStorage.getItem('malgyeol-case-id');
    if (!id) { id = 'web_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('malgyeol-case-id', id); }
    return id;
  }

  /* =======================================================================
     주문 상태 — 두 겹으로 나눈다.
     ORDER   : 비개인정보. 상품·수량·caseId·세션 토큰. sessionStorage 허용.
     SECURE  : 받는이 정보와 서버 미리보기 증표. 메모리 전용, 10분 뒤 소멸.
     ==================================================================== */
  var SESSION_KEY = 'malgyeol-order-session';
  var SESSION_FIELDS = ['caseId', 'sessionId', 'sessionAccessToken', 'sessionAccessExpiresAt', 'utterance', 'product', 'quantity', 'substitution'];
  var PRODUCT_FIELDS = ['goodsNo', 'goodsCode', 'sellerCode', 'name', 'category', 'origin', 'originStatus',
    'unitPriceKrw', 'shippingFeeKrw', 'inStock', 'selling', 'deliveryAvailable', 'refundable',
    'nonRefundableConditions', 'orderCutoff', 'detailUrl', 'source'];
  var ORDER = { caseId: '', sessionId: '', sessionAccessToken: '', sessionAccessExpiresAt: 0, utterance: '', product: null, quantity: 1, substitution: 'ask' };
  var PRODUCT_VERIFIED = false;
  (function restoreOrder() {
    var raw;
    try { raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { raw = null; }
    if (!raw || typeof raw !== 'object') return;
    SESSION_FIELDS.forEach(function (key) { if (raw[key] !== undefined && raw[key] !== null) ORDER[key] = raw[key]; });
    ORDER.product = pickProduct(ORDER.product);
    ORDER.quantity = clampQuantity(ORDER.quantity);
    if (ORDER.product && !ORDER.caseId) ORDER.caseId = webCaseId();
  })();
  /* 허용 키만 골라 담는다. 뒤에 받는이 필드가 생겨도 구조적으로 새어 나가지 못한다. */
  function pickProduct(value) {
    if (!value || typeof value !== 'object') return null;
    var product = {};
    PRODUCT_FIELDS.forEach(function (key) { if (value[key] !== undefined) product[key] = value[key]; });
    return product.goodsNo ? product : null;
  }
  function clampQuantity(value) {
    var number = Math.floor(Number(value));
    return Number.isFinite(number) && number >= 1 && number <= 100 ? number : 1;
  }
  function persistOrder() {
    var safe = {};
    SESSION_FIELDS.forEach(function (key) { safe[key] = key === 'product' ? pickProduct(ORDER[key]) : ORDER[key]; });
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(safe)); } catch {}
  }
  function clearOrder() {
    ORDER.product = null; ORDER.quantity = 1; ORDER.substitution = 'ask';
    PRODUCT_VERIFIED = false; LIVE.productCheckError = '';
    persistOrder();
  }

  var SECURE_TTL = 10 * 60 * 1000;
  var SECURE = { recipient: null, draft: null, preview: null, previewProof: '', consentExpiresAt: 0, fingerprint: '', expiresAt: 0, readiness: null, error: null, loading: false, notice: '', attemptedFor: '', previewRequest: null };
  var secureTimer = null;
  function touchSecure() {
    SECURE.expiresAt = Date.now() + SECURE_TTL;
    if (secureTimer) clearTimeout(secureTimer);
    secureTimer = setTimeout(function () { dropSecure('보안을 위해 입력하신 배송 정보를 지웠습니다. 다시 입력해 주세요.'); }, SECURE_TTL);
  }
  function dropSecure(notice) {
    SECURE.recipient = null; SECURE.draft = null; SECURE.preview = null; SECURE.previewProof = '';
    SECURE.previewRequest = null;
    SECURE.consentExpiresAt = 0; SECURE.fingerprint = ''; SECURE.expiresAt = 0;
    SECURE.readiness = null; SECURE.error = null; SECURE.loading = false; SECURE.attemptedFor = '';
    SECURE.notice = notice || '';
    if (secureTimer) { clearTimeout(secureTimer); secureTimer = null; }
    if (notice) { try { render(); } catch {} say(notice, true); }
  }
  /* 조건이 하나라도 바뀌면 서버 미리보기와 증표를 즉시 버린다. */
  function termsFingerprint() {
    var r = SECURE.recipient || {};
    return [ORDER.caseId, ORDER.product && ORDER.product.goodsNo, ORDER.product && ORDER.product.unitPriceKrw,
      ORDER.product && ORDER.product.shippingFeeKrw, ORDER.quantity,
      r.name, r.cellphone, r.zip, r.address, r.memo || ''].join('|');
  }
  function invalidatePreview() {
    SECURE.preview = null; SECURE.previewProof = ''; SECURE.consentExpiresAt = 0; SECURE.fingerprint = '';
    SECURE.previewRequest = null;
  }
  function previewUsable() {
    return Boolean(SECURE.preview) && SECURE.fingerprint === termsFingerprint()
      && SECURE.consentExpiresAt > Date.now();
  }
  window.addEventListener('pagehide', function () { dropSecure(''); });

  /* ---------------- 표기 헬퍼 ---------------- */
  function won(value) {
    return Number.isFinite(Number(value)) && value !== null && value !== ''
      ? '<span class="num">' + Number(value).toLocaleString('ko-KR') + '원</span>'
      : UNKNOWN;
  }
  function when(value) {
    var time = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(time) ? esc(new Date(time).toLocaleString('ko-KR')) : '확인 필요';
  }
  function shortTime(value) {
    var time = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(time)) return '';
    var d = new Date(time);
    return esc(String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + ' '
      + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  }
  function prov(text, iconName) {
    return '<p class="prov">' + ico(iconName || 'clock', 'ico--sm') + '<span>' + text + '</span></p>';
  }
  function masked(value) {
    return value ? '<span class="masked">' + ico('eye', 'ico--sm') + esc(value) + '</span>' : UNKNOWN;
  }
  function card(inner, cls) { return '<div class="card ' + (cls || '') + '">' + inner + '</div>'; }
  function badge(kind, text, iconName) {
    return '<span class="badge badge--' + kind + '">' + (iconName ? ico(iconName) : '') + text + '</span>';
  }
  function notice(kind, title, body, iconName) {
    return '<div class="notice notice--' + kind + '">' + ico(iconName || 'circle-info-fill') +
      '<div><p>' + (title ? '<strong>' + title + '</strong>' : '') + body + '</p></div></div>';
  }
  function tag(kind) {
    var map = {
      gated: ['tagline--gated', '자격 증명 필요'],
      paid: ['tagline--paid', '유료 실행 승인 필요'],
      real: ['tagline--real', '실제'],
      sandbox: ['tagline--sandbox', '샌드박스']
    };
    var m = map[kind] || map.real;
    return '<span class="tagline ' + m[0] + '">' + m[1] + '</span>';
  }
  /* 같은 뜻을 보통 말과 쉬운 말 두 벌로 둔다 — "쉬운 말로 보기"가 실제로 바꾸는 문장들 */
  function dual(plain, easy) {
    return '<span class="plain">' + plain + '</span><span class="easy">' + easy + '</span>';
  }
  /* 다음 행동의 주체를 한 줄에 드러낸다. 누가 멈춰 세웠는지 숨기지 않는다. */
  function spine(steps) {
    return '<ol class="spine">' + steps.map(function (step) {
      return '<li class="spine__i spine__i--' + step.state + '">' +
        '<span class="spine__t">' + step.title +
        '<span class="spine__owner">' + step.owner + '</span>' +
        (step.time ? '<span class="spine__time">' + step.time + '</span>' : '') + '</span>' +
        '<span class="spine__d wrap-any">' + step.desc + '</span>' +
        (step.evidence || '') + '</li>';
    }).join('') + '</ol>';
  }
  function proofRow(key, value) {
    return '<div class="proof__row"><span class="proof__k">' + esc(key) + '</span>' +
      (value ? '<span class="proof__v">' + esc(value) + '</span>'
        : '<span class="proof__v proof__v--none">없음 — 생성되지 않음</span>') + '</div>';
  }
  function evidence(rows, label) {
    return '<details class="disc disc--inline"><summary>' + (label || '기술 증적 열기') + ico('chevron-down') + '</summary>' +
      '<div class="disc__body proof">' + rows.map(function (row) { return proofRow(row[0], row[1]); }).join('') + '</div></details>';
  }

  var CATEGORY_LABEL = {
    DOMESTIC_FRUIT: '국산 과일', DOMESTIC_VEGETABLE: '국산 채소', WHITE_MILK: '흰우유',
    FRESH_EGGS: '신선 알', MEAT: '육류', MIXED_GRAINS: '잡곡', TOFU: '두부', FOREST_NUTS: '임산물 수실류',
    WHITE_RICE: '백미', INSTANT_NOODLES: '라면', PROCESSED_FOOD: '가공식품', FOREIGN_FOOD: '외국산',
    SEAFOOD: '수산물', ALCOHOL: '주류', TOBACCO: '담배', GIFT_CARD: '상품권', CASH_EQUIVALENT: '현금성',
    FIREARM: '총기', AMMUNITION: '탄약', ILLEGAL_DRUG: '불법약물', HIGH_RISK_UNKNOWN: '고위험 미상',
    OUT_OF_POLICY: '기준 밖'
  };
  var HIGH_RISK = ['FIREARM', 'AMMUNITION', 'ILLEGAL_DRUG', 'TOBACCO', 'ALCOHOL', 'GIFT_CARD', 'CASH_EQUIVALENT', 'HIGH_RISK_UNKNOWN'];
  function categoryLabel(key) { return CATEGORY_LABEL[key] || key; }

  function eligibility(product) {
    if (!product || !LIVE.program || !Array.isArray(LIVE.program.allowedCategories)) return 'UNKNOWN';
    return LIVE.program.allowedCategories.indexOf(product.category) >= 0 ? 'ALLOWED' : 'BLOCKED';
  }
  function isOrderableProduct(product) {
    return eligibility(product) === 'ALLOWED' && product.originStatus === 'DOMESTIC' &&
      product.inStock === true && product.selling === true && product.deliveryAvailable === true;
  }
  function eligibilityBadge(product) {
    var state = eligibility(product);
    if (state === 'ALLOWED') return badge('ok', '지원 가능', 'circle-check-fill');
    if (state === 'BLOCKED') return badge('no', '지원 불가', 'circle-block');
    return badge('outline', '기준 확인 중');
  }
  function stockBadge(product) {
    if (!product) return '';
    if (product.inStock === false || product.selling === false) return badge('neutral', '판매처 품절');
    if (product.deliveryAvailable === false) return badge('warn', '배송 불가', 'circle-exclamation-fill');
    return badge('info', '재고 있음');
  }
  function returnNotice(product) {
    if (!product) return UNKNOWN;
    if (product.refundable === false) return esc(product.nonRefundableConditions || '반품이 제한되는 상품입니다.');
    if (product.refundable === 'CONDITIONAL') return esc(product.nonRefundableConditions || '조건에 따라 반품이 제한될 수 있습니다.');
    return '상품 상태와 판매자 조건에 따라 반품할 수 있습니다.';
  }
  function orderTotals() {
    var product = ORDER.product;
    if (!product) return null;
    var goods = product.unitPriceKrw * ORDER.quantity;
    return { goods: goods, shipping: product.shippingFeeKrw, total: goods + product.shippingFeeKrw };
  }
  function apiFailure(error) {
    if (!error) return { title: '요청을 마치지 못했어요', body: '잠시 뒤 다시 시도해 주세요.' };
    if (error.status === 403) return { title: '세션이 만료됐어요', body: '보안을 위해 짧은 시간만 유효합니다. 필요한 먹거리를 다시 말씀해 주시면 새 세션을 발급합니다.' };
    if (error.status === 404) return { title: '이 서버에는 주문 미리보기가 열려 있지 않아요', body: '유료 행동 승인 키가 연결된 배포에서만 미리보기가 열립니다. 값을 만들어 보여드리지 않습니다.' };
    if (error.status === 503) return {
      title: '자격 증명이 아직 연결되지 않았어요',
      body: '판매처 또는 지원금 조회 자격 증명이 없어 실제 값을 읽지 못했습니다.',
      code: error.body && error.body.status || ''
    };
    if (error.status === 400) return { title: '입력값을 다시 확인해 주세요', body: '서버가 받은 값 중 형식에 맞지 않는 항목이 있습니다.' };
    return { title: '서버에 연결하지 못했어요', body: '저장된 예시로 대신 채우지 않습니다. 잠시 뒤 다시 시도해 주세요.' };
  }

  /* ---------------- 진입 토큰 ---------------- */
  /* 전화에서 웹으로 잇는 연속 링크는 명시적으로 링크를 받은 사건에서만 살아난다.
     기본 홈은 여전히 독립적인 이용자 모바일웹이다. */
  function hydratePhoneContinuation() {
    var params = new URLSearchParams(location.search);
    var fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
    var caseId = params.get('caseId');
    var token = fragment.get('continuation') || params.get('continuation');
    if (caseId && token) sessionStorage.setItem('malgyeol-phone-context', JSON.stringify({ caseId: caseId, token: token }));
    if (token) {
      params.delete('continuation');
      history.replaceState({}, '', location.pathname + (params.toString() ? '?' + params.toString() : ''));
    }
  }
  function phoneContext() {
    try { return JSON.parse(sessionStorage.getItem('malgyeol-phone-context') || 'null'); }
    catch { return null; }
  }
  function hydrateRoleAccess() {
    if (location.pathname.replace(/^\//, '') !== 'ops') return;
    var fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
    var token = fragment.get('access');
    if (token) {
      sessionStorage.setItem('malgyeol-role-ops', token);
      history.replaceState({}, '', location.pathname + location.search);
    }
  }
  function hydrateOrderAccess() {
    var fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
    var orderId = fragment.get('order');
    var token = fragment.get('access');
    if (orderId && token && /^[A-Za-z0-9_-]{1,128}$/.test(orderId)) {
      sessionStorage.setItem('malgyeol-order-access', JSON.stringify({ orderId: orderId, token: token }));
      history.replaceState({}, '', location.pathname + location.search);
    }
  }
  function orderAccess() {
    try { return JSON.parse(sessionStorage.getItem('malgyeol-order-access') || 'null'); } catch { return null; }
  }
  async function sha256Hex(value) {
    var bytes = new TextEncoder().encode(value);
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  }

  /* =======================================================================
     실제 API 호출
     ==================================================================== */
  async function loadProgram() {
    try {
      LIVE.program = await apiJson('/api/food-support/program'); LIVE.programError = '';
      if (ORDER.product) {
        if (!isOrderableProduct(ORDER.product)) clearOrder();
        else await validateRestoredProduct();
      }
    }
    catch (error) { LIVE.programError = error.message; }
    render();
  }

  async function validateRestoredProduct() {
    if (!ORDER.product || LIVE.productChecking) return;
    LIVE.productChecking = true; LIVE.productCheckError = ''; render();
    try {
      var body = await apiJson('/api/food-support/catalog-item?goodsNo=' + encodeURIComponent(ORDER.product.goodsNo));
      if (!body.product || !isOrderableProduct(body.product)) clearOrder();
      else {
        ORDER.product = pickProduct(body.product); PRODUCT_VERIFIED = true; persistOrder();
      }
    } catch (error) {
      if (error.status === 404) clearOrder();
      else LIVE.productCheckError = '판매처에서 고르던 상품의 최신 상태를 확인하지 못했습니다.';
    }
    LIVE.productChecking = false; render();
  }

  /* stay=true면 화면을 옮기지 않고 결과만 채운다. 해석 결과를 먼저 읽게 하기 위함이다. */
  async function runSearch(overrideQuery, stay, originalUtterance, exactName) {
    var query = (overrideQuery || '').trim();
    if (!query) { say('찾으실 먹거리를 적어 주세요.', true); var field = $('#ask'); if (field) field.focus(); return; }
    LIVE.query = query;
    /* 이용자가 실제로 적은 문장을 그대로 originalUtterance로 쓴다.
       고위험 표현 탐지가 이 문장 위에서 돌기 때문에 문장을 지어내지 않는다. */
    ORDER.utterance = (originalUtterance || query).trim();
    if (!ORDER.caseId) ORDER.caseId = webCaseId();
    persistOrder();
    LIVE.loading = true; LIVE.searched = true; LIVE.catalogStatus = ''; LIVE.products = [];
    if (!stay && route().v !== 'search') go('search'); else render();
    try {
      /* 품목 기준보다 검색이 먼저 끝나면 정상 상품까지 UNKNOWN으로 숨겨지는 경쟁 상태가 생긴다.
         기준을 확인하지 못한 상태에서는 상품을 노출하지도, 거짓 빈 결과를 만들지도 않는다. */
      if (!LIVE.program) {
        LIVE.program = await apiJson('/api/food-support/program');
        LIVE.programError = '';
      }
      var path = '/api/food-support/catalog?query=' + encodeURIComponent(query)
        + (exactName ? '&exactName=' + encodeURIComponent(exactName) : '');
      var result = await apiJson(path);
      LIVE.catalogStatus = result.status;
      LIVE.products = (Array.isArray(result.products) ? result.products : []).filter(isOrderableProduct);
    } catch (error) {
      LIVE.catalogStatus = error.body && error.body.status === 'CREDENTIAL_GATED' ? 'CREDENTIAL_GATED' : 'ERROR';
    }
    LIVE.loading = false; render();
    say(LIVE.catalogStatus === 'CREDENTIAL_GATED'
      ? '판매처 자격 증명이 필요합니다. 상품을 만들어 보여드리지 않습니다.'
      : LIVE.products.length + '개의 실제 상품을 찾았습니다.', true);
  }

  /* 검색부터 시작한 이용자는 세션 토큰이 없다. readiness·preview 앞에서
     실제로 입력한 문장을 그대로 originalUtterance로 보내 세션을 발급받는다. */
  async function ensureFoodSession(utterance) {
    var context = phoneContext();
    if (context) {
      ORDER.caseId = context.caseId;
      if (!ORDER.utterance) ORDER.utterance = utterance || LIVE.query || '';
      persistOrder();
      return true;
    }
    var valid = ORDER.sessionAccessToken && ORDER.caseId
      && (!ORDER.sessionAccessExpiresAt || ORDER.sessionAccessExpiresAt > Date.now() + 5000);
    if (valid) {
      if (utterance) { ORDER.utterance = utterance; persistOrder(); }
      return true;
    }
    var text = (utterance || ORDER.utterance || LIVE.query || '').trim();
    if (!text) return false;
    var body = await apiJson('/api/food-support/interpret', {
      method: 'POST', body: JSON.stringify({ caseId: ORDER.caseId || webCaseId(), text: text })
    });
    ORDER.caseId = body.caseId; ORDER.sessionId = body.sessionId || '';
    ORDER.sessionAccessToken = body.sessionAccessToken || '';
    ORDER.sessionAccessExpiresAt = body.sessionAccessExpiresAt || 0;
    ORDER.utterance = text;
    LIVE.interpretation = body;
    persistOrder();
    return true;
  }
  function sessionCredential() {
    var context = phoneContext();
    return context ? { continuationToken: context.token } : { sessionAccessToken: ORDER.sessionAccessToken };
  }

  function highRiskRequest(parsed) {
    if (!parsed) return false;
    if (parsed.interpretation && parsed.interpretation.engine === 'SKIPPED_POLICY_BOUNDARY') return true;
    return (parsed.requestedCategories || []).some(function (key) { return HIGH_RISK.indexOf(key) >= 0; });
  }
  function piiBlocked(parsed) {
    return Boolean(parsed && parsed.interpretation && parsed.interpretation.engine === 'SKIPPED_PII_BOUNDARY');
  }

  /* 요청 한 문장을 서버 해석 엔진으로 보낸다. 위험 품목·개인정보 경계에서
     끝난 요청은 카탈로그를 조회하지 않는다. 화면에서도 거기서 멈춘다. */
  async function submitUtterance(overrideText) {
    var input = $('#ask');
    var text = (overrideText || (input && input.value.trim()) || '').trim();
    if (!text) { say('필요한 먹거리를 적어 주세요.', true); if (input) input.focus(); return; }
    LIVE.loading = true; LIVE.searched = false; LIVE.products = []; LIVE.catalogStatus = '';
    if (route().v !== 'search') go('search'); else render();
    try {
      var context = phoneContext();
      var payload = { caseId: context ? context.caseId : (ORDER.caseId || webCaseId()), text: text };
      if (context) payload.continuationToken = context.token;
      var body = await apiJson('/api/food-support/interpret', { method: 'POST', body: JSON.stringify(payload) });
      LIVE.interpretation = body;
      ORDER.caseId = body.caseId; ORDER.sessionId = body.sessionId || '';
      ORDER.sessionAccessToken = body.sessionAccessToken || '';
      ORDER.sessionAccessExpiresAt = body.sessionAccessExpiresAt || 0;
      ORDER.utterance = text;
      persistOrder();
      LIVE.continuationError = '';
      if (highRiskRequest(body) || piiBlocked(body)) {
        LIVE.loading = false; render();
        say(body.response || '요청을 진행할 수 없습니다.', true);
        return;
      }
      if (body.intent === 'TRACK_ORDER') {
        LIVE.loading = false;
        LIVE.orderIntentNotice = '주문 조회 링크가 있으면 아래에서 실제 배송 상태를 확인할 수 있어요.';
        go('orders');
        say('주문 내역으로 이동했습니다.', true);
        return;
      }
      if (body.intent === 'CANCEL_ORDER') {
        LIVE.loading = false;
        LIVE.orderIntentNotice = '주문 취소는 현재 배송 상태를 확인한 뒤 담당 기관에 요청해야 해요.';
        go('orders');
        say('취소할 주문을 확인할 수 있는 주문 내역으로 이동했습니다.', true);
        return;
      }
      if (body.intent === 'REQUEST_HELP') {
        LIVE.loading = false;
        go('help');
        return;
      }
      LIVE.loading = false; render();
      var query = body.interpretation && body.interpretation.engine === 'CONFIGURED_AI_PROVIDER' && body.interpretation.normalizedQuery
        ? body.interpretation.normalizedQuery
        : (body.query && body.query.category ? categorySearchTerm(body.query.category) : text);
      runSearch(query, true, text, body.query && body.query.exactName);
    } catch (error) {
      LIVE.loading = false;
      if (error.status === 403 && phoneContext()) {
        sessionStorage.removeItem('malgyeol-phone-context');
        LIVE.continuationError = '전화에서 이어하는 시간이 지났어요. 상담원에게 새 연결을 요청해 주세요.';
      }
      render();
      say('요청을 해석하지 못했습니다. 다시 시도해 주세요.', true);
    }
  }
  /* 판매처 카탈로그가 실제로 알아듣는 검색어로 옮긴다. 품목 분류 코드를
     그대로 넣으면 조회는 성공하지만 결과가 비어 화면이 사실과 어긋나 보인다. */
  var CATEGORY_TERM = {
    MIXED_GRAINS: '잡곡', DOMESTIC_FRUIT: '과일', DOMESTIC_VEGETABLE: '채소', WHITE_MILK: '우유',
    FRESH_EGGS: '계란', MEAT: '돼지고기', TOFU: '두부', FOREST_NUTS: '밤'
  };
  function categorySearchTerm(key) { return CATEGORY_TERM[key] || categoryLabel(key); }

  /* 지원 조건 확인 → 가려진 미리보기. 조건이 서면 미리보기를 부르지 않는다. */
  async function loadReview() {
    if (!ORDER.product) return;
    SECURE.loading = true; SECURE.error = null; render();
    try {
      if (!await ensureFoodSession()) throw Object.assign(new Error('no-session'), { status: 403 });
      var base = Object.assign({
        caseId: ORDER.caseId, goodsNo: ORDER.product.goodsNo,
        quantity: ORDER.quantity, originalUtterance: ORDER.utterance
      }, sessionCredential());
      SECURE.readiness = await apiJson('/api/food-support/order-readiness', { method: 'POST', body: JSON.stringify(base) });
      if (SECURE.readiness.status === 'PAID_ACTION_REQUIRED' && SECURE.recipient) {
        /* 승인 요청은 이 미리보기와 글자 하나까지 같은 요청 본문을 보내야 한다.
           그래야 서버가 다시 계산한 동의 증표가 어긋나지 않는다. */
        var previewRequest = Object.assign({}, base, { recipient: SECURE.recipient });
        var body = await apiJson('/api/food-support/order-preview', {
          method: 'POST', body: JSON.stringify(previewRequest)
        });
        SECURE.previewRequest = previewRequest;
        SECURE.preview = body.preview || null;
        SECURE.previewProof = body.previewProof || '';
        SECURE.consentExpiresAt = body.consentExpiresAt || 0;
        SECURE.fingerprint = termsFingerprint();
        touchSecure();
      } else {
        invalidatePreview();
      }
      SECURE.error = null;
    } catch (error) {
      invalidatePreview();
      SECURE.error = apiFailure(error);
      if (error.status === 403) { ORDER.sessionAccessToken = ''; ORDER.sessionAccessExpiresAt = 0; persistOrder(); }
    }
    SECURE.loading = false; render();
    say(previewUsable() ? '결제 없는 가려진 미리보기를 준비했습니다.' : '지원 조건 확인 결과를 표시했습니다.', true);
  }

  var voiceRecognition = null;
  function startVoiceRecognition() {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      LIVE.voiceError = '이 브라우저에서 받아쓰기를 지원하지 않아요. 글로 적어 주시면 똑같이 진행됩니다.';
      window.__listening = false; render(); return;
    }
    if (voiceRecognition) { try { voiceRecognition.stop(); } catch {} }
    var recognition = new Recognition(); voiceRecognition = recognition;
    recognition.lang = 'ko-KR'; recognition.interimResults = false; recognition.continuous = false;
    recognition.onstart = function () { LIVE.voiceError = ''; window.__listening = true; render(); say('듣고 있습니다. 말씀해 주세요.', true); };
    recognition.onresult = function (event) {
      var transcript = event.results && event.results[0] && event.results[0][0] ? event.results[0][0].transcript.trim() : '';
      window.__listening = false;
      if (transcript) {
        var field = $('#ask');
        if (field) field.value = transcript;
        render();
        submitUtterance(transcript);
      } else { LIVE.voiceError = '말씀하신 내용을 알아듣지 못했어요. 다시 말하거나 글로 적어 주세요.'; render(); }
    };
    recognition.onerror = function (event) {
      window.__listening = false;
      LIVE.voiceError = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? '마이크 권한이 필요해요. 브라우저 주소창 옆의 마이크 권한을 확인해 주세요.'
        : '음성을 인식하지 못했어요. 다시 말하거나 글로 적어 주세요.';
      render();
    };
    recognition.onend = function () { if (voiceRecognition === recognition) voiceRecognition = null; window.__listening = false; };
    try { recognition.start(); } catch { LIVE.voiceError = '받아쓰기를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.'; render(); }
  }
  function stopVoiceRecognition() {
    if (voiceRecognition) { try { voiceRecognition.stop(); } catch {} }
    voiceRecognition = null; window.__listening = false; render(); say('듣기를 멈췄습니다.');
  }

  /* ---------------- 라우팅 ---------------- */
  function route() {
    var p = new URLSearchParams(location.search);
    var pathView = location.pathname.replace(/^\//, '');
    var pathMap = { ops: 'ops', verify: 'demo' };
    var v = p.get('v') || pathMap[pathView] || 'hub';
    if (v === 'verify') v = 'demo';
    return { v: v, s: p.get('s') || '', id: p.get('id') || p.get('caseId') || '', compare: p.get('compare') || '' };
  }
  function go(v, s, replace) {
    var url = '?v=' + v + (s ? '&s=' + s : '');
    if (replace) history.replaceState({}, '', url); else history.pushState({}, '', url);
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    var main = $('#main');
    if (main) main.focus({ preventScroll: true });
  }

  /* ---------------- 접근성 상태 ---------------- */
  var A11Y = (function () {
    var defaults = { scale: 0, contrast: 'normal', easy: 'off', motion: 'auto' };
    try {
      var saved = JSON.parse(localStorage.getItem('malgyeol-a11y') || 'null');
      return saved && typeof saved === 'object' ? Object.assign(defaults, saved) : defaults;
    } catch { return defaults; }
  })();
  function applyA11y() {
    var r = document.documentElement;
    r.setAttribute('data-type-scale', String(A11Y.scale));
    r.setAttribute('data-contrast', A11Y.contrast);
    r.setAttribute('data-easy', A11Y.easy);
    if (A11Y.motion === 'reduced') r.setAttribute('data-motion', 'reduced'); else r.removeAttribute('data-motion');
    try { localStorage.setItem('malgyeol-a11y', JSON.stringify(A11Y)); } catch {}
  }
  function a11yControls() {
    return '<div class="stack gap-16">' +
      '<div class="stack gap-8"><span class="t-body1 w-bold" id="lbl-scale">글자 크기</span>' +
      '<div class="seg" role="group" aria-labelledby="lbl-scale">' +
      [['0', '보통'], ['1', '크게'], ['2', '아주 크게']].map(function (x) {
        return '<button type="button" data-scale="' + x[0] + '" aria-pressed="' + (String(A11Y.scale) === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div></div>' +

      '<div class="toggle-row"><div class="stack gap-4"><span class="t-body1 w-bold" id="lbl-contrast">진하게 보기</span>' +
      '<span class="t-body2 muted">글자와 선을 더 진하게 해요</span></div>' +
      '<button type="button" class="switch" role="switch" data-toggle="contrast" aria-checked="' + (A11Y.contrast === 'high') + '" aria-labelledby="lbl-contrast"></button></div>' +

      '<div class="toggle-row"><div class="stack gap-4"><span class="t-body1 w-bold" id="lbl-easy">쉬운 말로 보기</span>' +
      '<span class="t-body2 muted">짧고 쉬운 문장으로 바꿔요</span></div>' +
      '<button type="button" class="switch" role="switch" data-toggle="easy" aria-checked="' + (A11Y.easy === 'on') + '" aria-labelledby="lbl-easy"></button></div>' +

      '<div class="toggle-row"><div class="stack gap-4"><span class="t-body1 w-bold" id="lbl-motion">움직임 줄이기</span>' +
      '<span class="t-body2 muted">화면 움직임을 멈춰요</span></div>' +
      '<button type="button" class="switch" role="switch" data-toggle="motion" aria-checked="' + (A11Y.motion === 'reduced') + '" aria-labelledby="lbl-motion"></button></div>' +
      '</div>';
  }

  /* =======================================================================
     표면 B — 이용자 모바일
     ==================================================================== */

  var EXAMPLES = ['납작보리쌀 한 봉지 보내줘', '살 수 있는 잡곡이 뭐야', '계란이랑 두부 보내줘'];

  /* 다시 그릴 때 이용자가 적던 문장을 잃지 않는다 */
  function askValue(fallback) {
    var field = $('#ask');
    return field && field.value ? field.value : (fallback || '');
  }
  function askForm(value, big) {
    var listening = window.__listening === true;
    return '<form id="ask-form" novalidate>' +
      '<label class="sr-only" for="ask">필요한 먹거리</label>' +
      '<div class="tf' + (big ? ' tf--lg' : '') + '">' +
      '<input id="ask" name="ask" type="text" autocomplete="off" enterkeyhint="search"' +
      ' placeholder="예: 납작보리쌀 한 봉지 보내줘" value="' + esc(value || '') + '">' +
      '<button type="button" class="iconbtn' + (listening ? ' iconbtn--live' : '') + '" id="dictate"' +
      ' aria-pressed="' + listening + '" aria-label="' + (listening ? '받아쓰기 멈추기' : '말로 입력하기') + '">' +
      ico(listening ? 'microphone-fill' : 'microphone') + '</button>' +
      '</div>' +
      '<button type="submit" class="btn btn--solid-primary btn--block btn--lg" style="margin-top:12px">상품 찾기</button>' +
      '</form>' +
      (listening ? '<p class="t-body2 c-primary" role="status" style="margin-top:8px">지금 듣고 있어요. 다 말씀하시면 마이크를 다시 눌러 주세요.</p>' : '') +
      (LIVE.voiceError ? '<div role="alert" style="margin-top:10px">' + notice('warn', '', esc(LIVE.voiceError), 'circle-exclamation-fill') + '</div>' : '');
  }

  function viewHome() {
    var access = orderAccess();
    return '<section>' +
      '<h1 class="ask">' + dual('무엇이 필요하세요?', '무엇을 드시고 싶으세요?') + '</h1>' +
      '<p class="lede">' + dual('먹거리 이름을 그대로 말하거나 적어 주세요.', '먹고 싶은 것을 말해 주세요.') + '</p>' +
      '</section>' +

      '<section>' + askForm(askValue('')) + '</section>' +

      (LIVE.continuationError
        ? '<div role="alert">' + notice('warn', '전화 연결을 다시 받아야 해요 · ', esc(LIVE.continuationError), 'circle-exclamation-fill') + '</div>'
        : '') +

      '<section class="stack gap-8">' + EXAMPLES.map(function (text) {
        return '<button type="button" class="example-btn" data-act="example" data-query="' + esc(text) + '">' +
          esc(text) + ico('arrow-right') + '</button>';
      }).join('') + '</section>' +

      /* 이어서 하기 — 이 브라우저 세션에 실제로 담긴 선택만 보여준다 */
      (PRODUCT_VERIFIED && isOrderableProduct(ORDER.product)
        ? '<section class="sec"><p class="sec__t">고르던 상품</p>' +
        card('<div class="stack gap-12">' +
          '<p class="t-headline1 w-bold wrap-any">' + esc(ORDER.product.name) + '</p>' +
          '<p class="t-body2 muted">수량 ' + ORDER.quantity + '개 · 합계 ' + won(orderTotals().total) + '</p>' +
          '<div class="btn-row btn-row--2">' +
          '<a class="btn btn--solid-primary btn--md" href="?v=cart">이어서 진행</a>' +
          '<button type="button" class="btn btn--outlined-assistive btn--md" data-act="clear-order">지우기</button>' +
          '</div></div>', 'card--pad-sm') + '</section>'
        : '') +

      /* 진행 중인 주문 — 범위가 지정된 주문 조회 권한이 있을 때만 열린다 */
      (access
        ? '<section class="sec"><p class="sec__t">진행 중인 주문</p>' + ordersBlock(true) + '</section>'
        : '') +

      '<section>' +
      '<button type="button" class="link-row" data-go="help">' + ico('circle-question') +
      '<span>도움이 필요해요</span>' + ico('chevron-right', 'link-row__chev') + '</button>' +
      '<a class="phone-note" href="' + SUPPORT_TEL + '">' + ico('phone-fill') +
      '<span>전화로 바로 주문하기 <b>' + SUPPORT_PHONE + '</b></span></a>' +
      '</section>';
  }

  /* ---------------- 되묻기 · 상품 찾기 ----------------
     되묻기 문장과 분기는 모두 서버 해석 결과(clarificationCode·requestedCategories·
     response)에서 나온다. 화면이 지어낸 되묻기는 없다. */
  function clarifyBlock() {
    var parsed = LIVE.interpretation;
    if (!parsed) return '';
    var code = parsed.clarificationCode;
    var risky = highRiskRequest(parsed);
    var pii = piiBlocked(parsed);
    var multi = (parsed.requestedCategories || []).length > 1;

    var mine = '<div class="turn turn--me"><p class="turn__who">내가 말한 것</p>' +
      '<p class="turn__body wrap-any">' + esc(ORDER.utterance || LIVE.query) + '</p></div>';

    function reply(body, extra) {
      return '<div class="turn turn--sys"><p class="turn__who">말결</p>' +
        '<p class="turn__body wrap-any">' + body + '</p>' + (extra || '') + '</div>';
    }
    function categoryChoices(keys, label) {
      var allowed = LIVE.program && Array.isArray(LIVE.program.allowedCategories)
        ? LIVE.program.allowedCategories : [];
      keys = keys.filter(function (key) { return allowed.indexOf(key) >= 0; });
      if (!keys.length) return '';
      return '<div class="stack gap-8" style="margin-top:14px">' +
        (label ? '<p class="t-label1 w-bold">' + label + '</p>' : '') +
        keys.map(function (key) {
          return '<button type="button" class="example-btn" data-act="example" data-query="' +
            esc(categorySearchTerm(key)) + '">' + esc(categoryLabel(key)) + ico('arrow-right') + '</button>';
        }).join('') + '</div>';
    }

    if (pii) {
      return '<div class="talk">' + mine + reply(
        '연락처나 주소가 함께 적혀 있어서 여기서 멈췄어요. 개인정보는 배송 단계에서만 따로 받습니다.',
        notice('warn', '', '먹거리 이름만 다시 적어 주세요. 이 요청은 해석 엔진으로 넘어가지 않았습니다.', 'lock-fill')
      ) + '</div>';
    }
    if (risky) {
      return '<div class="talk">' + mine + reply(
        esc(parsed.response || '안전상 이 요청은 진행할 수 없어요.'),
        notice('negative', '', '상품을 찾지 않았고, 결제나 주문도 시작되지 않았습니다. 먹거리로 다시 말씀해 주세요.', 'circle-block') +
        categoryChoices((LIVE.program && LIVE.program.allowedCategories || []).slice(0, 4), '살 수 있는 먹거리로 바꿔 보기')
      ) + '</div>';
    }
    if (code === 'AMBIGUOUS_RICE') {
      return '<div class="talk">' + mine + reply(
        '백미는 이 지원으로 살 수 없어요. 백미는 따로 양곡 지원으로 받으시고, 여기서는 <b>잡곡</b>을 사실 수 있어요.',
        '<p class="t-body2 muted" style="margin-top:8px">아래에 잡곡 후보를 찾아 두었어요.</p>'
      ) + '</div>';
    }
    if (code === 'UNBOUNDED_SUBSTITUTION') {
      return '<div class="talk">' + mine + reply(
        esc(parsed.response || '아무 상품이나 대신 고르지는 않아요. 원하시는 종류를 알려 주세요.'),
        categoryChoices(LIVE.program && LIVE.program.allowedCategories || [], '이 중에서 골라 주세요')
      ) + '</div>';
    }
    if (code === 'MALFORMED_MULTI_ITEM') {
      return '<div class="talk">' + mine + reply(
        esc(parsed.response || '말씀하신 내용이 두 가지로 읽혀요. 어떤 것인지 하나만 알려 주세요.'),
        '<div class="stack gap-8" style="margin-top:14px">' +
        ['쌀', '라면'].map(function (word) {
          return '<button type="button" class="example-btn" data-act="example" data-query="' + esc(word) + '">' +
            esc(word) + '을(를) 말한 거예요' + ico('arrow-right') + '</button>';
        }).join('') + '</div>'
      ) + '</div>';
    }
    if (code === 'MISSING_CONTEXT') {
      return '<div class="talk">' + mine + reply(esc(parsed.response || '필요한 상품을 다시 말씀해 주세요.')) + '</div>';
    }
    if (multi) {
      return '<div class="talk">' + mine + reply(
        '여러 가지를 말씀하셨어요. 한 번에 하나씩 골라야 금액과 배송비를 정확히 확인할 수 있어요.',
        categoryChoices(parsed.requestedCategories, '먼저 고를 것을 눌러 주세요')
      ) + '</div>';
    }
    return '<div class="talk">' + mine + reply(esc(parsed.response || '실제 상품을 찾아볼게요.')) + '</div>';
  }

  /* 판매처 응답에서 읽은 값만 채운다. 이미지·후기 수·별점은 만들지 않는다. */
  function productCard(p) {
    var unit = Number(p.unitPriceKrw), ship = Number(p.shippingFeeKrw);
    var total = Number.isFinite(unit) && Number.isFinite(ship) ? unit + ship : null;
    return '<div class="pcard">' +
      '<p class="pcard__name">' + esc(p.name) + '</p>' +
      '<p class="pcard__meta">' + [p.origin, p.sellerCode ? '판매처 ' + p.sellerCode : '', categoryLabel(p.category)]
        .filter(Boolean).map(esc).join(' · ') + '</p>' +
      '<div class="pcard__price"><span class="pcard__total">' + won(total) + '</span>' +
      '<span class="pcard__break">상품 ' + won(unit) + ' + 배송비 ' + won(ship) + '</span></div>' +
      '<div class="pcard__foot">' + eligibilityBadge(p) + stockBadge(p) + '</div>' +
      '<div style="margin-top:14px">' +
      '<button type="button" class="btn btn--outlined-primary btn--block" data-act="select-product" data-goods-no="' + esc(p.goodsNo) + '">' +
      '이 상품으로 계속하기</button>' +
      '</div></div>';
  }

  function searchResultBlock() {
    if (LIVE.loading) {
      return '<div class="stack gap-12" role="status" aria-live="polite" aria-busy="true">' +
        '<div class="row gap-12"><div class="spinner" aria-hidden="true"></div><p class="t-body1">판매처에서 상품을 불러오는 중이에요…</p></div>' +
        [0, 1].map(function () {
          return '<div class="pcard"><div class="stack gap-10">' +
            '<div class="skel" style="width:80%"></div><div class="skel" style="width:55%"></div><div class="skel" style="width:40%"></div>' +
            '</div></div>';
        }).join('') + '</div>';
    }
    if (!LIVE.searched) {
      return '<div class="empty">' + ico('search', 'empty__ico') +
        '<p class="t-headline1 w-bold">아직 찾아보지 않았어요</p>' +
        '<p class="t-body2-reading muted wrap-any">찾으실 먹거리를 적어 주세요. 검색 전에는 상품을 만들어 보여드리지 않습니다.</p></div>';
    }
    if (LIVE.catalogStatus === 'CREDENTIAL_GATED') {
      return '<div class="gate">' + ico('lock', 'gate__ico') +
        '<p class="t-body1 w-bold">판매처 연결에 자격 증명이 필요해요</p>' +
        '<p class="t-body2-reading muted wrap-any">검색 API는 정상 응답했지만 판매처 키가 없어 재고·가격을 읽지 못했습니다. 값을 만들어 채우지 않습니다.</p>' +
        tag('gated') + '</div>';
    }
    if (LIVE.catalogStatus === 'ERROR') {
      return '<div role="alert" class="stack gap-12">' +
        notice('negative', '상품 정보를 불러오지 못했어요 · ', '판매처 연결이 끊겼습니다. 결제나 주문은 진행되지 않았어요.', 'triangle-exclamation-fill') +
        '<button type="button" class="btn btn--solid-primary btn--block" data-act="retry-search">' + ico('refresh') + '다시 시도하기</button>' +
        '</div>';
    }
    if (!LIVE.products.length) {
      return '<div class="empty">' + ico('search', 'empty__ico') +
        '<p class="t-headline1 w-bold">“' + esc(LIVE.query) + '”에 맞는 상품이 없어요</p>' +
        '<p class="t-body2-reading muted wrap-any">지금 지원으로 주문할 수 있는 상품이 없습니다. 다른 먹거리로 찾아 보시겠어요?</p>' +
        '<button type="button" class="btn btn--outlined-assistive btn--md" data-act="retry-search" style="margin-top:8px">' +
        ico('refresh') + '다시 시도</button></div>';
    }
    return '<div class="stack gap-12">' +
      '<p class="compare-note">' + ico('circle-info-fill') + '배송비까지 더한 최종 금액으로 비교했어요.</p>' +
      '<div class="plist">' + LIVE.products.map(productCard).join('') + '</div>' +
      prov('판매처 API에서 방금 확인한 ' + LIVE.products.length + '개입니다. 재고와 가격을 저장된 값으로 대신하지 않습니다.', 'verified-check-fill') +
      '</div>';
  }

  function viewSearch() {
    return '<section>' +
      '<h1 class="ask ask--sm">' + dual('무엇을 찾을까요?', '무엇을 살까요?') + '</h1>' +
      '</section>' +
      '<section>' + askForm(askValue(ORDER.utterance || LIVE.query || '')) + '</section>' +
      (LIVE.interpretation ? '<section>' + clarifyBlock() + '</section>' : '') +
      '<section class="sec" aria-labelledby="h-res">' +
      '<div class="sec__h"><h2 id="h-res">찾은 상품</h2>' +
      (LIVE.searched && !LIVE.loading ? '<span class="t-caption1 muted">' + LIVE.products.length + '개</span>' : '') + '</div>' +
      searchResultBlock() +
      '</section>';
  }

  /* ---------------- 상품 상세 ---------------- */
  var SUBS = [
    ['none', '대체하지 않기', '없으면 그냥 빼 주세요'],
    ['size', '같은 상품, 다른 용량', '용량만 달라도 괜찮아요'],
    ['cheaper', '더 싼 지원 가능 상품', '비슷하고 더 싼 것으로 괜찮아요'],
    ['ask', '먼저 물어봐 주세요', '바꾸기 전에 전화나 알림으로 확인해 주세요']
  ];

  function needProduct(title) {
    return '<div class="empty">' + ico('business-bag', 'empty__ico') +
      '<p class="t-headline1 w-bold">' + title + '</p>' +
      '<p class="t-body2-reading muted wrap-any">판매처에서 확인된 실제 상품을 먼저 고르셔야 다음 단계가 열립니다.</p>' +
      '<a class="btn btn--solid-primary btn--md" href="?v=search" style="margin-top:8px">상품 찾기</a></div>';
  }

  function orderProductGate(title) {
    if (!ORDER.product) return needProduct(title);
    if (LIVE.programError) {
      return '<div role="alert" class="stack gap-12">' +
        notice('negative', '지원 품목 기준을 불러오지 못했어요 · ', '기준을 확인하기 전에는 고르던 상품을 표시하거나 주문을 진행하지 않습니다.', 'triangle-exclamation-fill') +
        '<button type="button" class="btn btn--solid-primary btn--block" data-act="retry-program">' + ico('refresh') + '품목 기준 다시 확인</button></div>';
    }
    if (LIVE.productCheckError) {
      return '<div role="alert" class="stack gap-12">' +
        notice('negative', '상품 상태를 다시 확인해야 해요 · ', esc(LIVE.productCheckError), 'triangle-exclamation-fill') +
        '<button type="button" class="btn btn--solid-primary btn--block" data-act="retry-product-check">' + ico('refresh') + '상품 상태 다시 확인</button></div>';
    }
    if (!PRODUCT_VERIFIED || LIVE.productChecking) {
      return card('<div class="row gap-12" role="status" aria-live="polite" aria-busy="true">' +
        '<div class="spinner" aria-hidden="true"></div><p class="t-body1">판매처에서 상품의 최신 상태를 확인하고 있어요…</p></div>', 'card--flat');
    }
    if (!LIVE.program) {
      return card('<div class="row gap-12" role="status" aria-live="polite" aria-busy="true">' +
        '<div class="spinner" aria-hidden="true"></div><p class="t-body1">지원 가능한 상품인지 확인하고 있어요…</p></div>', 'card--flat');
    }
    if (!isOrderableProduct(ORDER.product)) {
      clearOrder();
      return needProduct(title);
    }
    return '';
  }

  function viewProduct() {
    var gate = orderProductGate('고른 상품이 없어요');
    if (gate) return gate;
    var p = ORDER.product;
    var totals = orderTotals();
    return '<section class="stack gap-10">' +
      '<div class="row row--wrap gap-6">' + eligibilityBadge(p) + stockBadge(p) + '</div>' +
      '<h1 class="ask ask--sm wrap-any">' + esc(p.name) + '</h1>' +
      '<p class="pcard__price"><span class="pcard__total">' + won(totals.total) + '</span>' +
      '<span class="pcard__break">수량 ' + ORDER.quantity + '개 기준 · 배송비 포함</span></p>' +
      '</section>' +

      card('<div class="kv">' +
        kvRow('상품 번호', '<span class="mono">' + esc(p.goodsNo) + '</span>') +
        kvRow('원산지', (p.origin ? esc(p.origin) : UNKNOWN) + ' · ' + esc(p.originStatus === 'DOMESTIC' ? '국내산' : p.originStatus === 'FOREIGN' ? '외국산' : '확인 필요')) +
        kvRow('판매처 코드', '<span class="mono">' + (p.sellerCode ? esc(p.sellerCode) : '확인 필요') + '</span>') +
        kvRow('품목 분류', esc(categoryLabel(p.category) || '확인 필요')) +
        kvRow('단가', won(p.unitPriceKrw)) +
        kvRow('배송비', won(p.shippingFeeKrw)) +
        kvRow('주문 마감', p.orderCutoff ? esc(p.orderCutoff) : UNKNOWN) +
        kvRow('반품 조건', returnNotice(p)) +
        '</div>' +
        '<div style="margin-top:14px">' + prov('판매처 응답에서 읽은 값입니다. 출처 ' +
          esc(p.source === 'SPECIAL_OFFER_LIVE' ? 'SpecialOffer 실시간' : p.source || '확인 필요'), 'verified-check-fill') + '</div>', 'card--pad-sm') +

      '<section class="sec" aria-labelledby="h-qty">' +
      '<div class="sec__h"><h2 id="h-qty">몇 개 필요하세요?</h2></div>' +
      '<div class="row row--between row--wrap gap-12">' +
      '<div class="stepper" data-stepper="quantity">' +
      '<button type="button" data-step="-1" aria-label="수량 줄이기">' + ico('minus') + '</button>' +
      '<output id="qty" aria-live="polite" aria-label="수량">' + ORDER.quantity + '</output>' +
      '<button type="button" data-step="1" aria-label="수량 늘리기">' + ico('plus') + '</button>' +
      '</div>' +
      '<p class="t-body1 w-bold">합계 ' + (totals ? won(totals.total) : UNKNOWN) + '</p>' +
      '</div></section>' +

      '<section class="sec" aria-labelledby="h-sub">' +
      '<div class="sec__h"><h2 id="h-sub">없을 때는 어떻게 할까요?</h2></div>' +
      '<div class="stack gap-8" role="radiogroup" aria-labelledby="h-sub">' +
      SUBS.map(function (x) {
        return '<button type="button" class="choice" role="radio" data-sub="' + x[0] + '" aria-checked="' + (ORDER.substitution === x[0]) + '">' +
          '<span class="choice__dot" aria-hidden="true"></span>' +
          '<span class="stack gap-4"><span class="t-body1 w-bold">' + x[1] + '</span>' +
          '<span class="t-body2 muted">' + x[2] + '</span></span></button>';
      }).join('') +
      '</div>' +
      '<p class="t-caption1 muted wrap-any">상품이 바뀌면 동의를 다시 받아야 하므로 자동으로 바꾸지 않습니다.</p>' +
      '</section>' +

      '<div class="actionbar">' +
      '<a class="btn btn--solid-primary btn--block btn--lg" href="?v=cart">주문서 만들기</a>' +
      '<a class="btn btn--outlined-assistive btn--block" href="?v=search">다른 상품 보기</a>' +
      '</div>';
  }

  function kvRow(key, value, total) {
    return '<div class="kv__row' + (total ? ' kv__row--total' : '') + '">' +
      '<span class="kv__k">' + key + '</span><span class="kv__v">' + value + '</span></div>';
  }

  /* ---------------- 주문서 ---------------- */
  function viewCart() {
    var gate = orderProductGate('만든 주문서가 없어요');
    if (gate) return gate;
    var p = ORDER.product;
    var totals = orderTotals();
    var subLabel = (SUBS.filter(function (x) { return x[0] === ORDER.substitution; })[0] || SUBS[3])[1];
    return '<section>' +
      '<h1 class="ask ask--sm">주문서</h1>' +
      '<p class="lede">' + dual('고르신 상품 그대로 다음 단계까지 이어집니다.', '고른 것을 그대로 가져가요.') + '</p>' +
      '</section>' +

      card('<div class="stack gap-12">' +
        '<div class="row row--between gap-12" style="align-items:flex-start">' +
        '<p class="t-headline1 w-bold wrap-any grow">' + esc(p.name) + '</p>' + eligibilityBadge(p) + '</div>' +
        '<div class="kv">' +
        kvRow('원산지', p.origin ? esc(p.origin) : UNKNOWN) +
        kvRow('단가', won(p.unitPriceKrw)) +
        kvRow('품절일 때', esc(subLabel)) +
        '</div>' +
        '<div class="row row--between row--wrap gap-10">' +
        '<div class="stepper" data-stepper="quantity">' +
        '<button type="button" data-step="-1" aria-label="수량 줄이기">' + ico('minus') + '</button>' +
        '<output aria-live="polite" aria-label="수량">' + ORDER.quantity + '</output>' +
        '<button type="button" data-step="1" aria-label="수량 늘리기">' + ico('plus') + '</button></div>' +
        '<button type="button" class="btn btn--outlined-assistive btn--md" data-act="clear-order">' + ico('trash') + '빼기</button>' +
        '</div></div>', 'card--pad-sm') +

      card('<div class="kv">' +
        kvRow('상품 금액', won(totals.goods)) +
        kvRow('배송비', won(totals.shipping)) +
        kvRow('합계', won(totals.total), true) +
        '</div>' +
        '<div style="margin-top:14px" class="stack gap-12">' +
        prov('판매처 단가 × 수량 + 배송비로 계산한 금액입니다. 아직 청구되지 않았습니다.', 'coins') +
        notice('info', '지원금 부담과 본인 부담은 아직 나누지 않았어요 · ', '지원금 조회가 연결된 사건에서만 실제 잔액으로 나눕니다.', 'circle-info-fill') +
        '</div>') +

      '<div class="actionbar">' +
      '<a class="btn btn--solid-primary btn--block btn--lg" href="?v=delivery">받는 곳 입력하기</a>' +
      '</div>';
  }

  /* ---------------- 받는 곳 정보 (메모리 전용) ---------------- */
  var RECIPIENT_FIELDS = [
    { key: 'name', label: '받는 분 이름', type: 'text', autocomplete: 'name', placeholder: '한글 이름', required: true, max: 100,
      test: function (v) { return /^[가-힣]{2,30}$/.test(v); }, error: '한글 이름을 2자 이상 30자 이하로 적어 주세요.' },
    { key: 'cellphone', label: '휴대전화 번호', type: 'tel', autocomplete: 'tel', placeholder: '010-0000-0000', required: true, max: 30,
      test: function (v) { return /^01[016789]-?\d{3,4}-?\d{4}$/.test(v.replace(/\s/g, '')); }, error: '010-0000-0000 형식의 휴대전화 번호를 적어 주세요.' },
    { key: 'zip', label: '우편번호', type: 'text', autocomplete: 'postal-code', placeholder: '5자리 숫자', required: true, max: 20,
      test: function (v) { return /^\d{5}$/.test(v); }, error: '우편번호 5자리를 숫자로 적어 주세요.' },
    { key: 'address', label: '주소', type: 'text', autocomplete: 'street-address', placeholder: '도로명 주소와 상세 주소', required: true, max: 300,
      test: function (v) { return v.length >= 5 && v.length <= 300; }, error: '받으실 주소를 5자 이상 300자 이하로 적어 주세요.' },
    { key: 'memo', label: '배송 요청 사항', type: 'text', autocomplete: 'off', placeholder: '예: 부재 시 경비실에 맡겨 주세요', required: false, max: 200,
      test: function (v) { return v.length <= 200; }, error: '요청 사항은 200자까지 적을 수 있어요.' }
  ];
  var deliveryErrors = {};

  function formField(spec, value, error) {
    var id = 'rc-' + spec.key;
    return '<div class="field">' +
      '<label class="field__label" for="' + id + '">' + esc(spec.label) +
      (spec.required ? '<span class="field__req" aria-hidden="true">*</span><span class="sr-only">필수</span>'
        : '<span class="field__opt">(선택)</span>') + '</label>' +
      '<div class="tf' + (error ? ' tf--invalid' : '') + '">' +
      '<input id="' + id + '" name="' + spec.key + '" type="' + spec.type + '"' +
      ' inputmode="' + (spec.key === 'zip' ? 'numeric' : spec.type === 'tel' ? 'tel' : 'text') + '"' +
      ' maxlength="' + spec.max + '" autocomplete="' + spec.autocomplete + '"' +
      ' placeholder="' + esc(spec.placeholder) + '" value="' + esc(value || '') + '"' +
      (spec.required ? ' required' : '') +
      (error ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : '') + '></div>' +
      (error ? '<p class="field__error" id="' + id + '-err">' + ico('circle-exclamation-fill', 'ico--sm') + esc(error) + '</p>' : '') +
      '</div>';
  }

  function viewDelivery() {
    var gate = orderProductGate('만든 주문서가 없어요');
    if (gate) return gate;
    var current = SECURE.recipient || SECURE.draft || {};
    var errorCount = Object.keys(deliveryErrors).length;
    return '<section>' +
      '<h1 class="ask ask--sm">어디로 보낼까요?</h1>' +
      '<p class="lede">' + dual('배송에 꼭 필요한 것만 여쭤봅니다.', '보내드릴 곳만 알려 주세요.') + '</p>' +
      '</section>' +

      notice('info', '입력하신 정보는 저장하지 않아요 · ', '이름·연락처·우편번호·주소는 이 기기 메모리에만 두고 10분이 지나거나 화면을 닫으면 지웁니다.', 'lock-fill') +
      (SECURE.notice ? '<div role="status">' + notice('warn', '', esc(SECURE.notice), 'clock') + '</div>' : '') +

      '<form id="delivery-form" class="stack gap-16" novalidate>' +
      '<div id="delivery-summary" role="alert" aria-live="assertive">' +
      (errorCount
        ? notice('negative', esc(errorCount) + '개 항목을 다시 확인해 주세요 · ', '빨간 표시가 있는 칸을 채우면 다음으로 넘어갈 수 있어요.', 'triangle-exclamation-fill')
        : '') + '</div>' +
      RECIPIENT_FIELDS.map(function (spec) {
        return formField(spec, current[spec.key], deliveryErrors[spec.key]);
      }).join('') +
      '<button type="submit" class="btn btn--solid-primary btn--block btn--lg">주문 내용 확인</button>' +
      '</form>';
  }

  /* ---------------- 주문 전 확인 ---------------- */
  function readinessBlock() {
    var readiness = SECURE.readiness;
    if (!readiness) return '';
    var product = readiness.product || {};
    var decision = readiness.policyDecision || {};
    var ready = readiness.status === 'PAID_ACTION_REQUIRED';
    var budgetOk = readiness.budgetCheck && readiness.budgetCheck.sufficient;
    var failed = (decision.lines || []).reduce(function (all, line) {
      return all.concat(line.failedRules || []);
    }, []);
    return card('<div class="stack gap-12">' +
      '<h2 class="t-heading2 w-bold">지원 조건 확인</h2>' +
      '<div class="row row--wrap gap-6">' +
      badge(ready ? 'ok' : 'no', ready ? '정책 판정 통과' : '정책 판정 ' + esc(readiness.status || decision.decision || '확인 필요'), ready ? 'circle-check-fill' : 'circle-block') +
      badge(budgetOk ? 'ok' : 'warn', budgetOk ? '예산 한도 충족' : '예산 한도 확인 필요', budgetOk ? 'circle-check-fill' : 'circle-exclamation-fill') +
      '</div>' +
      '<div class="kv">' +
      kvRow('상품', esc(product.name || '확인 필요')) +
      kvRow('수량', esc(String(product.quantity == null ? ORDER.quantity : product.quantity)) + '개') +
      kvRow('단가', won(product.unitPriceKrw)) +
      kvRow('배송비', won(product.shippingFeeKrw)) +
      kvRow('합계', won(product.totalPriceKrw), true) +
      '</div>' +
      (failed.length ? notice('warn', '막힌 규칙이 있어요 · ', esc(failed.join(', ')), 'circle-exclamation-fill') : '') +
      evidence([
        ['policy snapshot', decision.policySnapshotHash],
        ['policy version', decision.policyVersion],
        ['supplier POST calls', String(readiness.supplierPostCalls == null ? 0 : readiness.supplierPostCalls)],
        ['recipient status', readiness.recipientStatus]
      ]) +
      '</div>');
  }

  function previewBlock() {
    var preview = SECURE.preview;
    if (!preview) return '';
    var expired = SECURE.consentExpiresAt <= Date.now();
    var stale = SECURE.fingerprint !== termsFingerprint();
    if (expired || stale) {
      return '<div role="status" class="stack gap-12">' + notice('warn',
        stale ? '조건이 바뀌어 미리보기를 버렸어요 · ' : '미리보기 유효시간이 지났어요 · ',
        '상품·수량·받는 곳이 달라지면 이전 미리보기는 더 이상 쓰지 않습니다.', 'clock') +
        '<button type="button" class="btn btn--solid-primary btn--block" data-act="run-review">' + ico('refresh') + '미리보기 다시 받기</button></div>';
    }
    return card('<div class="stack gap-14">' +
      '<div class="row row--between gap-8"><h2 class="t-heading2 w-bold">가려진 미리보기</h2>' +
      badge('outline', '결제 없음', 'lock-fill') + '</div>' +
      '<div class="kv">' +
      kvRow('상품', esc(preview.productName || '확인 필요')) +
      kvRow('수량', esc(String(preview.quantity == null ? ORDER.quantity : preview.quantity)) + '개') +
      kvRow('상품 금액', won(preview.goodsPriceKrw)) +
      kvRow('배송비', won(preview.shippingFeeKrw)) +
      kvRow('합계', won(preview.totalPriceKrw), true) +
      '</div>' +
      '<div class="stack gap-8">' +
      '<div class="row row--between gap-8"><h3 class="t-headline2 w-bold">받는 곳</h3>' + badge('neutral', '가려서 표시') + '</div>' +
      '<div class="kv">' +
      kvRow('받는 분', masked(preview.maskedRecipient)) +
      kvRow('연락처', masked(preview.maskedPhone)) +
      kvRow('주소', masked(preview.maskedAddress)) +
      '</div>' +
      prov('가려지지 않은 배송 정보는 주문 실행 순간에만 사용됩니다.', 'lock-fill') +
      '</div>' +
      '<div class="kv">' +
      kvRow('반품 조건', esc(preview.returnNotice || '확인 필요')) +
      kvRow('동의 만료', when(SECURE.consentExpiresAt)) +
      '</div>' +
      notice('info', '이 화면에서는 결제가 일어나지 않았어요 · ', '미리보기는 판매처에 주문을 넣지 않습니다.', 'circle-info-fill') +
      evidence([
        ['consent commitment', (preview.consentCommitment || '').slice(0, 32)],
        ['preview status', preview.status],
        ['goodsNo', preview.goodsNo]
      ]) +
      '</div>');
  }

  function viewReview() {
    var gate = orderProductGate('확인할 상품이 없어요');
    if (gate) return gate;
    if (!SECURE.recipient) {
      return '<div class="empty">' + ico('clock', 'empty__ico') +
        '<p class="t-headline1 w-bold">받는 곳 정보가 없거나 지워졌어요</p>' +
        '<p class="t-body2-reading muted wrap-any">' + esc(SECURE.notice || '개인정보 보호를 위해 배송 정보는 메모리에만 두고 10분 뒤 지웁니다. 다시 입력해 주세요.') + '</p>' +
        '<a class="btn btn--solid-primary btn--md" href="?v=delivery" style="margin-top:8px">배송 정보 입력하기</a></div>';
    }
    var ready = SECURE.readiness && SECURE.readiness.status === 'PAID_ACTION_REQUIRED';
    return '<section>' +
      '<h1 class="ask ask--sm">이대로 요청할까요?</h1>' +
      '<p class="lede">' + dual('지원 조건을 먼저 확인하고, 결제 없는 미리보기를 보여드려요.', '살 수 있는지 먼저 봐요. 돈은 아직 안 나가요.') + '</p>' +
      '</section>' +

      (SECURE.loading
        ? card('<div class="row gap-12" role="status" aria-live="polite" aria-busy="true">' +
          '<div class="spinner" aria-hidden="true"></div><p class="t-body1">지원 조건과 미리보기를 확인하는 중이에요…</p></div>', 'card--flat')
        : '') +

      (SECURE.error
        ? '<div role="alert" class="stack gap-12">' +
        notice('negative', esc(SECURE.error.title) + ' · ', esc(SECURE.error.body), 'triangle-exclamation-fill') +
        (SECURE.error.code === 'BUDGET_CREDENTIAL_GATED'
          ? institutionInviteForm()
          : '<button type="button" class="btn btn--solid-primary btn--block" data-act="run-review">' + ico('refresh') + '다시 확인하기</button>') + '</div>'
        : '') +

      readinessBlock() +
      previewBlock() +

      ((!SECURE.loading && !SECURE.error && !SECURE.readiness)
        ? card('<div class="stack gap-12">' +
          '<p class="t-body1-reading wrap-any">서버에 지원 조건 확인을 요청하면 정책 판정과 예산 한도를 그대로 보여드립니다.</p>' +
          '<button type="button" class="btn btn--solid-primary btn--block btn--lg" data-act="run-review">지원 조건 확인하기</button>' +
          '</div>')
        : '') +

      '<section class="sec"><p class="sec__t">다음은 누가 하나요</p>' +
      card(spine([
        { state: 'done', owner: '이용자', title: '상품 선택', desc: '판매처에서 확인된 실제 상품과 금액을 골랐습니다.' },
        { state: previewUsable() ? 'done' : 'current', owner: '이용자', title: '가려진 미리보기', desc: '결제 없이 내용만 확인하는 단계입니다.' },
        { state: previewUsable() ? 'current' : 'blocked', owner: '이용자', title: '전화 주문', desc: '070-5275-3884에서 상품명과 배송비 포함 총액을 들은 뒤 1번으로 직접 확인합니다.' }
      ]), 'card--flat') + '</section>' +
      '<div class="actionbar">' +
      (previewUsable()
        ? '<a class="btn btn--solid-primary btn--block btn--lg" href="' + SUPPORT_TEL + '">' +
          ico('phone-fill') + '전화로 바로 주문하기</a>'
        : '<button type="button" class="btn btn--solid-primary btn--block btn--lg" disabled aria-disabled="true">' +
        (ready ? '미리보기를 먼저 받아 주세요' : '지원 조건 확인 후 진행할 수 있어요') + '</button>') +
      '<div class="btn-row btn-row--2">' +
      '<a class="btn btn--outlined-assistive" href="?v=product">상품 고치기</a>' +
      '<a class="btn btn--outlined-assistive" href="?v=delivery">받는 곳 고치기</a>' +
      '</div></div>';
  }

  function institutionInviteForm() {
    return '<form id="institution-invite-form" class="stack gap-10" novalidate>' +
      '<label class="field__label" for="institution-invite">기관이 보낸 초대 링크 또는 코드</label>' +
      '<div class="tf"><input id="institution-invite" name="invite" type="text" autocomplete="off"' +
      ' placeholder="초대 링크 또는 caseId::코드" required></div>' +
      '<p class="t-label2 muted wrap-any">기관에서 지원 대상과 예산을 먼저 등록한 뒤 발급한 값만 사용할 수 있습니다. 입력한 값은 서버 검증을 통과해야 연결됩니다.</p>' +
      (LIVE.institutionInviteError ? '<p class="field__error" role="alert">' + ico('circle-exclamation-fill', 'ico--sm') + esc(LIVE.institutionInviteError) + '</p>' : '') +
      '<button type="submit" class="btn btn--solid-primary btn--block">기관 지원 연결 후 다시 확인</button>' +
      '<a class="btn btn--outlined-primary btn--block" href="' + SUPPORT_TEL + '">' + ico('phone-fill') + '기관 연결 도움 요청</a>' +
      '</form>';
  }

  /* ---------------- 승인 요청 (공개 화면의 끝) ----------------
     서버가 돌려준 안전 메타데이터만 메모리에 둔다. sessionStorage에 넣지 않는다. */
  var APPROVAL = { request: null, loading: false, error: null };

  /* 받는이 정보와 미리보기 증표가 아직 살아 있을 때 실제로 접수한다.
     201을 받은 뒤에만 SECURE를 지우고 화면을 옮긴다. */
  async function requestApproval() {
    if (APPROVAL.loading) return;
    if (!previewUsable() || !SECURE.previewRequest || !SECURE.preview) {
      APPROVAL.error = { title: '미리보기를 먼저 확인해 주세요', body: '상품·수량·받는 곳이 바뀌면 이전 미리보기로는 승인을 요청할 수 없습니다.' };
      render(); say('미리보기를 먼저 확인해 주세요.', true); return;
    }
    APPROVAL.loading = true; APPROVAL.error = null; render();
    say('승인 요청을 보내는 중입니다.');
    try {
      var body = await apiJson('/api/food-support/approval-request', {
        method: 'POST',
        body: JSON.stringify(Object.assign({}, SECURE.previewRequest, {
          expectedConsentCommitment: SECURE.preview.consentCommitment,
          expectedConsentExpiresAt: SECURE.consentExpiresAt,
          expectedTotalKrw: SECURE.preview.totalPriceKrw,
          previewProof: SECURE.previewProof
        }))
      });
      APPROVAL.request = body;
      APPROVAL.loading = false;
      /* 접수가 확인된 다음에만 이 기기의 받는이 정보를 지운다. */
      dropSecure('');
      say('담당자 승인함에 접수했습니다. 결제와 판매처 주문은 아직 실행되지 않았습니다.', true);
      go('approval');
    } catch (error) {
      APPROVAL.loading = false;
      APPROVAL.error = error.status === 409
        ? { title: '주문 조건이 바뀌어 접수하지 못했어요', body: '가격이나 받는 곳이 달라졌습니다. 미리보기를 다시 받은 뒤 요청해 주세요.' }
        : error.status === 503
          ? { title: '이 배포에는 승인함이 열려 있지 않아요', body: '기관 승인함이 연결된 배포에서만 요청이 접수됩니다. 접수한 척하지 않습니다.' }
          : apiFailure(error);
      render();
      say('승인 요청을 접수하지 못했습니다. 받는 곳 정보는 아직 지우지 않았습니다.', true);
    }
  }

  function viewApproval() {
    var handoff = APPROVAL.request;
    if (!handoff) {
      return '<div class="empty">' + ico('circle-info-fill', 'empty__ico') +
        '<p class="t-headline1 w-bold">아직 요청한 내용이 없어요</p>' +
        '<p class="t-body2-reading muted wrap-any">가려진 미리보기를 확인하신 뒤에 승인 요청을 보낼 수 있어요.</p>' +
        '<a class="btn btn--solid-primary btn--md" href="?v=review" style="margin-top:8px">확인 화면으로</a></div>';
    }
    return '<section>' +
      '<h1 class="ask ask--sm">담당자 승인을<br>기다리는 단계예요</h1>' +
      '</section>' +

      card('<div class="stack gap-12">' +
        '<div class="row row--wrap gap-6">' +
        badge(handoff.status === 'PENDING' ? 'info' : 'neutral', handoff.status === 'PENDING' ? '담당자 확인 대기' : esc(String(handoff.status || '확인 필요')), 'clock') +
        badge('outline', '결제 없음', 'lock-fill') + '</div>' +
        '<div class="kv">' +
        kvRow('상품', esc(handoff.productName || '확인 필요')) +
        kvRow('수량', esc(String(handoff.quantity == null ? '확인 필요' : handoff.quantity)) + '개') +
        kvRow('합계', won(handoff.totalPriceKrw), true) +
        '</div>' +
        '<div class="stack gap-8">' +
        '<div class="row row--between gap-8"><h2 class="t-headline2 w-bold">담당자에게 넘어간 받는 곳</h2>' + badge('neutral', '가려서 표시') + '</div>' +
        '<div class="kv">' +
        kvRow('받는 분', masked(handoff.maskedRecipient)) +
        kvRow('연락처', masked(handoff.maskedPhone)) +
        kvRow('주소', masked(handoff.maskedAddress)) +
        '</div></div>' +
        prov('서버가 접수한 요청 번호와 가려진 값만 이 화면에 남습니다. 판매처에 들어간 주문은 아직 없습니다.', 'lock-fill') +
        evidence([
          ['request id', handoff.requestId],
          ['caseId', handoff.caseId],
          ['goodsNo', handoff.goodsNo],
          ['consent commitment', (handoff.consentCommitment || '').slice(0, 32)],
          ['consent expires', handoff.consentExpiresAt ? new Date(handoff.consentExpiresAt).toISOString() : '']
        ]) +
        '</div>') +

      card(spine([
        { state: 'done', owner: '이용자', title: '내용 확인', desc: '상품·금액·가려진 배송 정보를 확인했습니다.' },
        { state: 'current', owner: '담당자', title: '정책과 동의 검토', desc: '기관 담당자가 지원 한도와 동의 상태를 확인하는 단계입니다.' },
        { state: 'blocked', owner: '담당자', title: '결제 집행', desc: '별도 자격 증명이 있는 담당자만 집행합니다. 집행되면 주문 번호가 발급됩니다.' }
      ]) +
        '<div style="margin-top:14px">' +
        notice('info', '배송 정보는 이 기기에서 지웠어요 · ', '요청을 보낸 뒤 이름·연락처·주소를 메모리에서 삭제했습니다.', 'lock-fill') + '</div>', 'card--flat') +

      '<div class="actionbar">' +
      '<a class="btn btn--solid-primary btn--block btn--lg" href="?v=orders">주문 상태 보기</a>' +
      '<a class="btn btn--outlined-assistive btn--block" href="?v=home">홈으로</a>' +
      '</div>';
  }

  /* ---------------- 주문 내역 ---------------- */
  var ORDER_READBACK = { authenticated: false, loading: false, requested: false, error: '', readAt: 0, orders: [], caseId: '' };

  async function loadOrderReadback() {
    var access = orderAccess();
    if (!access || !access.orderId || !access.token || ORDER_READBACK.loading) return;
    ORDER_READBACK.loading = true; ORDER_READBACK.requested = true; ORDER_READBACK.error = ''; render();
    try {
      var result = await apiJson('/api/food-support/order-status', {
        method: 'POST', body: JSON.stringify({ orderId: access.orderId, orderAccessToken: access.token })
      });
      ORDER_READBACK.authenticated = true;
      ORDER_READBACK.orders = result && result.order ? [result.order] : [];
      /* 증빙 API가 대조하는 사건 번호는 주문 조회 응답이 돌려준 값뿐이다.
         웹 세션이 스스로 만든 caseId를 쓰면 권한 검사에서 조용히 막힌다. */
      ORDER_READBACK.caseId = result && typeof result.caseId === 'string' ? result.caseId : '';
      ORDER_READBACK.readAt = Date.now();
    } catch (error) {
      ORDER_READBACK.authenticated = false; ORDER_READBACK.orders = []; ORDER_READBACK.caseId = '';
      ORDER_READBACK.error = error.status === 401
        ? '주문 조회 링크가 만료됐거나 올바르지 않습니다. 담당 기관에 새 링크를 요청해 주세요.'
        : '판매처에서 주문 상태를 읽지 못했습니다. 잠시 뒤 다시 확인해 주세요.';
      if (error.status === 401) sessionStorage.removeItem('malgyeol-order-access');
    }
    ORDER_READBACK.loading = false; render();
  }

  var DELIVERY_LABEL = {
    ORDER_ACCEPTED: '주문 접수', PREPARING: '상품 준비', SHIPPED: '발송',
    CARRIER_DELIVERED: '택배사 배송 완료', RECIPIENT_CONFIRMED: '내가 받았다고 확인',
    DELIVERY_DISPUTED: '배송 분쟁', CANCELLED: '취소', REFUND_PENDING: '환불 대기', REFUNDED: '환불 완료'
  };
  /* 택배사 배송 완료와 이용자 수령 확인은 끝까지 다른 줄로 남는다. */
  var DELIVERY_STEPS = ['ORDER_ACCEPTED', 'PREPARING', 'SHIPPED', 'CARRIER_DELIVERED', 'RECIPIENT_CONFIRMED'];

  function deliveryTimeline(order) {
    var reached = DELIVERY_STEPS.indexOf(order.deliveryState);
    return '<div class="timeline" role="list">' + DELIVERY_STEPS.map(function (step, index) {
      var last = index === DELIVERY_STEPS.length - 1;
      var done = reached >= 0 && index <= reached;
      var detail = step === 'CARRIER_DELIVERED'
        ? '택배사가 배송을 마쳤다고 알린 상태입니다.'
        : step === 'RECIPIENT_CONFIRMED'
          ? '이용자가 직접 확인해야 기록되며, 택배사 배송 완료와 별개입니다.'
          : step === 'SHIPPED'
            ? '택배사에 넘긴 상태입니다. 시각 ' + (order.shippedAt ? when(order.shippedAt) : '확인 필요')
            : '판매처 readback 기준 상태입니다.';
      return '<div class="tl tl--' + (done ? 'done' : 'pending') + '" role="listitem">' +
        '<div class="tl__rail"><span class="tl__dot">' + (done ? ico('check-thick') : '') + '</span>' +
        (last ? '' : '<span class="tl__line"></span>') + '</div>' +
        '<div class="tl__body"><p class="tl__t">' + esc(DELIVERY_LABEL[step]) +
        (done ? '' : badge('outline', '확인 전')) + '</p>' +
        '<p class="tl__d wrap-any">' + detail + '</p></div></div>';
    }).join('') + '</div>';
  }

  function orderReadbackCard(order, compact) {
    return card('<div class="stack gap-12">' +
      '<div class="row row--between row--wrap gap-8">' +
      '<p class="t-headline1 w-bold wrap-any grow">' + esc(order.goodsName || '확인 필요') + '</p>' +
      badge('info', esc(DELIVERY_LABEL[order.deliveryState] || order.deliveryState || '확인 필요')) + '</div>' +
      (compact
        ? '<a class="btn btn--outlined-primary btn--md btn--block" href="?v=orderdetail">배송 상태 보기</a>'
        : '<div class="kv">' +
        kvRow('주문 번호', '<span class="mono">' + esc(order.externalOrderNo || order.externalOrderId || '확인 필요') + '</span>') +
        kvRow('판매처 코드', '<span class="mono">' + esc(order.sellerCode || '확인 필요') + '</span>') +
        kvRow('수량', esc(String(order.quantity == null ? '확인 필요' : order.quantity)) + '개') +
        kvRow('상품 금액', won(order.goodsPriceKrw)) +
        kvRow('배송비', won(order.shippingFeeKrw)) +
        kvRow('합계', won(order.totalPriceKrw), true) +
        kvRow('택배사·송장', (order.deliveryCompany || order.trackingNumber
          ? esc([order.deliveryCompany, order.trackingNumber].filter(Boolean).join(' · '))
          : '<span class="unknown">아직 인계 기록 없음</span>')) +
        '</div>' +
        '<div style="margin-top:4px">' + deliveryTimeline(order) + '</div>' +
        prov('공급자 readback 응답 · 판매처 상태코드 ' + esc(String(order.providerOrderState == null ? '확인 필요' : order.providerOrderState)), 'verified-check-fill')) +
      '</div>');
  }

  function ordersBlock(compact) {
    if (ORDER_READBACK.loading) {
      return card('<div class="row gap-12" role="status" aria-busy="true"><div class="spinner" aria-hidden="true"></div>' +
        '<p class="t-body1">판매처 주문 상태를 확인하고 있어요</p></div>', 'card--flat');
    }
    if (ORDER_READBACK.error) {
      return '<div role="alert" class="stack gap-12">' +
        notice('negative', '주문 상태를 읽지 못했어요 · ', esc(ORDER_READBACK.error), 'triangle-exclamation-fill') +
        (orderAccess() ? '<button type="button" class="btn btn--solid-primary btn--block" data-act="retry-order-status">' + ico('refresh') + '주문 상태 다시 확인</button>' : '') +
        '</div>';
    }
    if (!ORDER_READBACK.authenticated) {
      return '<div class="gate">' + ico('lock', 'gate__ico') +
        '<p class="t-body1 w-bold">주문을 읽을 권한이 아직 없어요</p>' +
        '<p class="t-body2-reading muted wrap-any">담당 기관이 보내 준 주문 조회 링크로 들어오시면 실제 주문 상태가 열립니다. 인증된 서버 응답 없이는 주문 번호나 금액을 만들어 보여드리지 않습니다.</p>' +
        tag('gated') + '</div>';
    }
    if (!ORDER_READBACK.orders.length) {
      return '<div class="empty">' + ico('inbox', 'empty__ico') +
        '<p class="t-headline1 w-bold">표시할 주문이 없어요</p>' +
        '<p class="t-body2-reading muted">승인된 주문이 생기면 여기에서 진행 상태를 확인하실 수 있어요.</p></div>';
    }
    return '<div class="stack gap-12">' +
      ORDER_READBACK.orders.map(function (order) { return orderReadbackCard(order, compact); }).join('') +
      (compact ? '' : prov('인증된 서버 조회 · ' + when(ORDER_READBACK.readAt) + ' 기준', 'clock')) + '</div>';
  }

  function viewOrders() {
    return '<section>' +
      '<h1 class="ask ask--sm">주문 내역</h1>' +
      '<p class="lede">' + dual('택배사 배송 완료와 내가 받은 것은 서로 다른 상태로 둡니다.', '택배가 왔다고 해도, 받으셨는지 다시 여쭤봐요.') + '</p>' +
      '</section>' +
      (LIVE.orderIntentNotice
        ? '<div style="margin-bottom:12px">' + notice('info', '', esc(LIVE.orderIntentNotice), 'circle-info-fill') + '</div>'
        : '') +
      ordersBlock(false);
  }

  /* =======================================================================
     수령 확인과 배송 증빙
     사진은 실제 업로드 API로만 접수한다. 올린 척하지 않는다.
     ==================================================================== */
  var MAX_EVIDENCE_BYTES = 600000;
  var ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var ISSUE_LABEL = { RECEIVED_OK: '잘 받았어요', DAMAGED: '파손됐어요', WRONG_ITEM: '다른 상품이 왔어요', NOT_RECEIVED: '아직 못 받았어요' };
  var REVIEW_LABEL = { PENDING: '기관 검토 대기', ACCEPTED: '기관이 인정함', REJECTED: '기관이 반려함' };
  /* 사진을 함께 올릴 수 있는 상태. NOT_RECEIVED는 업로드 API가 사진을 요구하므로 제외한다. */
  var PHOTO_ISSUES = ['RECEIVED_OK', 'DAMAGED', 'WRONG_ITEM'];

  /* 화면은 매번 다시 그려지므로 고른 상태와 사진은 모듈 상태에 둔다. */
  var RECEIPT = { open: false, issueType: '', fileName: '', image: null, busy: false, error: '', done: null };
  var EVIDENCE = { requested: false, loading: false, error: '', unavailable: false, items: [] };
  var SYNTH = { requested: false, loading: false, error: '', items: [] };

  function resetReceipt() {
    RECEIPT.open = false; RECEIPT.issueType = ''; RECEIPT.fileName = '';
    RECEIPT.image = null; RECEIPT.busy = false; RECEIPT.error = ''; RECEIPT.done = null;
  }
  function clearReceiptPhoto() {
    RECEIPT.image = null; RECEIPT.fileName = ''; RECEIPT.error = ''; render();
    say('고른 사진을 지웠습니다.');
  }
  function chooseReceiptIssue(issueType) {
    if (!ISSUE_LABEL[issueType]) return;
    RECEIPT.issueType = issueType; RECEIPT.error = ''; RECEIPT.done = null;
    if (issueType === 'NOT_RECEIVED') { RECEIPT.image = null; RECEIPT.fileName = ''; }
    render();
    say(ISSUE_LABEL[issueType] + '을(를) 골랐습니다.');
  }

  function readBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
      reader.onerror = function () { reject(new Error('사진을 읽지 못했어요.')); };
      reader.readAsDataURL(blob);
    });
  }
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      /* 휴대전화 사진의 회전 정보를 살린다. 그렇지 않으면 옆으로 누운 사진이 올라간다. */
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return loadImageElement(file); });
    }
    return loadImageElement(file);
  }
  function loadImageElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('사진을 열지 못했어요.')); };
      image.src = url;
    });
  }
  function encodeJpeg(source, maxSide, quality) {
    var width = source.width, height = source.height;
    var scale = Math.min(1, maxSide / Math.max(width, height));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    var context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', quality); });
  }
  /* 600000바이트를 넘으면 캔버스로 줄여서 다시 굽는다. 끝내 못 줄이면 정직하게 거절한다. */
  async function prepareEvidenceImage(file) {
    if (ALLOWED_IMAGE_TYPES.indexOf(file.type) < 0) {
      throw new Error('JPG, PNG, WebP 사진만 올릴 수 있어요. 고르신 파일은 ' + (file.type || '형식을 알 수 없는 파일') + '입니다.');
    }
    if (file.size <= MAX_EVIDENCE_BYTES) {
      var raw = await readBase64(file);
      return { mimeType: file.type, dataBase64: raw, dataUrl: 'data:' + file.type + ';base64,' + raw, bytes: file.size, resized: false };
    }
    var source = await loadBitmap(file);
    var sides = [1600, 1200, 900, 640];
    var qualities = [0.85, 0.7, 0.55, 0.4];
    for (var i = 0; i < sides.length; i += 1) {
      for (var j = 0; j < qualities.length; j += 1) {
        var blob = await encodeJpeg(source, sides[i], qualities[j]);
        if (blob && blob.size <= MAX_EVIDENCE_BYTES) {
          var encoded = await readBase64(blob);
          return { mimeType: 'image/jpeg', dataBase64: encoded, dataUrl: 'data:image/jpeg;base64,' + encoded, bytes: blob.size, resized: true };
        }
      }
    }
    throw new Error('사진을 600KB 아래로 줄이지 못했어요. 더 작게 찍은 사진으로 다시 올려 주세요.');
  }

  async function pickReceiptPhoto(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    RECEIPT.busy = true; RECEIPT.error = ''; render();
    try {
      RECEIPT.image = await prepareEvidenceImage(file);
      RECEIPT.fileName = file.name || '사진';
      RECEIPT.busy = false; render();
      say('사진을 준비했습니다. 아직 보내지 않았습니다.', true);
    } catch (error) {
      RECEIPT.image = null; RECEIPT.fileName = '';
      RECEIPT.busy = false; RECEIPT.error = error.message || '사진을 준비하지 못했어요.';
      render();
      say(RECEIPT.error, true);
    }
  }

  function evidenceScope() {
    var access = orderAccess();
    if (!access || !access.orderId || !access.token) return null;
    if (!ORDER_READBACK.caseId) return null;
    return { caseId: ORDER_READBACK.caseId, orderId: access.orderId, token: access.token };
  }

  async function submitReceipt() {
    var scope = evidenceScope();
    if (!scope || RECEIPT.busy) return;
    if (PHOTO_ISSUES.indexOf(RECEIPT.issueType) < 0) return;
    if (!RECEIPT.image) {
      RECEIPT.error = '이 배포의 증빙 접수 API는 사진을 함께 받아야 기록합니다. 사진을 먼저 골라 주세요.';
      render(); say(RECEIPT.error, true); return;
    }
    RECEIPT.busy = true; RECEIPT.error = ''; render();
    try {
      var body = await apiJson('/api/delivery-evidence/upload', {
        method: 'POST',
        body: JSON.stringify({
          caseId: scope.caseId, orderId: scope.orderId, orderAccessToken: scope.token,
          issueType: RECEIPT.issueType, mimeType: RECEIPT.image.mimeType, dataBase64: RECEIPT.image.dataBase64
        })
      });
      RECEIPT.busy = false; RECEIPT.done = body; RECEIPT.image = null; RECEIPT.fileName = '';
      EVIDENCE.requested = false;
      render();
      say('증빙을 접수했습니다. 기관 검토를 기다리는 상태입니다.', true);
      loadEvidenceList();
    } catch (error) {
      RECEIPT.busy = false;
      RECEIPT.error = error.status === 401
        ? '주문 조회 링크가 만료됐습니다. 담당 기관에 새 링크를 요청해 주세요.'
        : error.status === 400
          ? '서버가 사진을 받아들이지 않았습니다. JPG·PNG·WebP 사진으로 다시 시도해 주세요.'
          : error.status === 413
            ? '사진 용량이 서버 한도를 넘었습니다. 더 작게 찍은 사진으로 다시 올려 주세요.'
            : error.status === 503
            ? '이 배포에는 증빙 접수가 연결되어 있지 않습니다. ' + SUPPORT_PHONE + '로 알려 주세요.'
            : '증빙을 접수하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
      render();
      say(RECEIPT.error, true);
    }
  }

  async function loadEvidenceList() {
    var scope = evidenceScope();
    if (!scope || EVIDENCE.loading) return;
    EVIDENCE.requested = true; EVIDENCE.loading = true; EVIDENCE.error = ''; EVIDENCE.unavailable = false; render();
    try {
      var body = await apiJson('/api/delivery-evidence/list?caseId=' + encodeURIComponent(scope.caseId) +
        '&orderId=' + encodeURIComponent(scope.orderId) + '&orderAccessToken=' + encodeURIComponent(scope.token));
      EVIDENCE.items = Array.isArray(body.evidence) ? body.evidence : [];
    } catch (error) {
      EVIDENCE.items = [];
      EVIDENCE.unavailable = error.status === 503;
      EVIDENCE.error = error.status === 503
        ? '이 배포에는 증빙 보관이 연결되어 있지 않습니다.'
        : error.status === 401
          ? '주문 조회 링크가 만료됐습니다. 담당 기관에 새 링크를 요청해 주세요.'
          : '보낸 증빙을 불러오지 못했습니다.';
    }
    EVIDENCE.loading = false; render();
  }

  async function loadSyntheticEvidence() {
    if (SYNTH.loading) return;
    SYNTH.requested = true; SYNTH.loading = true; SYNTH.error = ''; render();
    try {
      var body = await apiJson('/api/delivery-evidence/demo');
      SYNTH.items = Array.isArray(body.evidence) ? body.evidence : [];
    } catch (error) {
      SYNTH.items = [];
      SYNTH.error = error.status === 503
        ? '이 배포에는 합성 시연 자료가 연결되어 있지 않습니다.'
        : '합성 시연 자료를 불러오지 못했습니다.';
    }
    SYNTH.loading = false; render();
  }

  /* 실제 공급자 주문 회신. 이 레일은 샌드박스 기술 증명과 다른 사건이므로 따로 부른다. */
  async function loadFoodOrderProof() {
    if (LIVE.foodOrderLoading) return;
    LIVE.foodOrderRequested = true; LIVE.foodOrderLoading = true; LIVE.foodOrderError = ''; render();
    try {
      LIVE.foodOrder = await apiJson('/api/demo/food-order-proof');
      LIVE.foodOrderStatus = '';
    } catch (error) {
      LIVE.foodOrder = null;
      /* 이 경계의 오류 본문은 { "error": CODE } 한 줄이다. 코드가 있으면 코드로 문구를 정한다. */
      var code = (error.body && typeof error.body.error === 'string') ? error.body.error : '';
      LIVE.foodOrderStatus = /^[A-Z0-9_]+$/.test(code) ? code : '';
      LIVE.foodOrderError = LIVE.foodOrderStatus === 'SUPPLIER_READBACK_UNAVAILABLE'
        ? '공급자 주문 회신을 지금 읽을 수 없습니다.'
        : LIVE.foodOrderStatus === 'SUPPLIER_READBACK_MISMATCH'
          ? '공급자가 회신한 주문이 이 조회 대상과 일치하지 않습니다.'
          : error.status === 404
            ? '이 배포에는 공급자 주문 회신 경로가 열려 있지 않습니다.'
            : '공급자 주문 회신을 불러오지 못했습니다.';
    }
    LIVE.foodOrderLoading = false; render();
    say(LIVE.foodOrderError || '공급자 주문 회신을 불러왔습니다.', Boolean(LIVE.foodOrderError));
  }

  function shortHash(value) {
    var text = String(value || '');
    return text ? text.slice(0, 12) : '';
  }
  function reviewBadge(state) {
    if (state === 'ACCEPTED') return badge('ok', REVIEW_LABEL.ACCEPTED, 'circle-check-fill');
    if (state === 'REJECTED') return badge('no', REVIEW_LABEL.REJECTED, 'circle-block');
    return badge('warn', REVIEW_LABEL.PENDING, 'clock');
  }
  function evidenceFigure(source, alt, caption) {
    return '<figure class="ev__fig">' +
      (source
        ? '<img class="ev__img" src="' + esc(source) + '" alt="' + esc(alt) + '" loading="lazy">'
        : '<div class="ev__img ev__img--none">' + ico('circle-block') + '</div>') +
      (caption ? '<figcaption class="ev__cap">' + caption + '</figcaption>' : '') +
      '</figure>';
  }

  function evidenceCard(item) {
    return '<div class="ev">' +
      evidenceFigure(item.imageDataUrl, (ISSUE_LABEL[item.issueType] || '배송') + ' 증빙 사진', '') +
      '<div class="ev__body">' +
      '<p class="ev__t">' + esc(ISSUE_LABEL[item.issueType] || item.issueType || '확인 필요') + '</p>' +
      '<div class="row row--wrap gap-6">' + reviewBadge(item.reviewState) + '</div>' +
      '<p class="ev__meta">보낸 시각 ' + (item.createdAt ? when(item.createdAt) : '확인 필요') + '</p>' +
      (shortHash(item.sha256) ? '<p class="ev__meta mono">sha256 ' + esc(shortHash(item.sha256)) + '…</p>' : '') +
      '</div></div>';
  }

  function syntheticCard(item) {
    return '<div class="ev ev--synth">' +
      evidenceFigure(item.imageUrl, '합성 시연 이미지 · ' + (ISSUE_LABEL[item.issueType] || item.issueType),
        '<span class="synth-tag">합성 시연</span>실제 이용자 사진이 아닙니다') +
      '<div class="ev__body">' +
      '<p class="ev__t">' + esc(ISSUE_LABEL[item.issueType] || item.issueType || '확인 필요') +
      '<span class="synth-tag">합성 시연</span></p>' +
      '<p class="ev__meta">' + esc(item.reviewState === 'ACCEPTED' ? REVIEW_LABEL.ACCEPTED : REVIEW_LABEL.PENDING) + ' · 예시 상태</p>' +
      '</div></div>';
  }

  function syntheticSection(compact) {
    return '<div class="stack gap-12">' +
      '<p class="t-body2-reading muted wrap-any">아래 세 장은 화면 설명을 위한 합성 이미지입니다. 실제 배송 증빙과 같은 목록에 섞지 않습니다.</p>' +
      (SYNTH.loading
        ? '<div class="row gap-12" role="status" aria-busy="true"><div class="spinner" aria-hidden="true"></div><p class="t-body2">합성 시연 자료를 불러오는 중이에요…</p></div>'
        : SYNTH.error
          ? notice('warn', '', esc(SYNTH.error), 'circle-exclamation-fill')
          : !SYNTH.requested
            ? '<button type="button" class="btn btn--outlined-assistive btn--md" data-act="load-synthetic">합성 시연 열기</button>'
            : !SYNTH.items.length
              ? '<p class="t-body2 muted">합성 시연 자료가 없습니다.</p>'
              : '<div class="ev-list' + (compact ? ' ev-list--compact' : '') + '">' + SYNTH.items.map(syntheticCard).join('') + '</div>') +
      '</div>';
  }

  function receiptPanel() {
    var scope = evidenceScope();
    if (!scope) return '';
    if (RECEIPT.done) {
      return card('<div class="stack gap-12">' +
        '<h2 class="t-heading2 w-bold">물건을 받으셨나요?</h2>' +
        '<div role="status">' + notice('positive', '증빙을 접수했어요 · ',
          esc(ISSUE_LABEL[RECEIPT.done.issueType] || '') + ' · 기관 담당자가 검토하면 결과가 아래 목록에 표시됩니다.', 'circle-check-fill') + '</div>' +
        '<div class="kv">' +
        kvRow('접수 상태', reviewBadge(RECEIPT.done.reviewState)) +
        kvRow('보낸 시각', RECEIPT.done.createdAt ? when(RECEIPT.done.createdAt) : '확인 필요') +
        '</div>' +
        '<button type="button" class="btn btn--outlined-assistive btn--md" data-act="receipt-reset">다른 상태 알리기</button>' +
        '</div>');
    }
    var issue = RECEIPT.issueType;
    var photoIssue = PHOTO_ISSUES.indexOf(issue) >= 0;
    var problemOpen = RECEIPT.open || (issue && issue !== 'RECEIVED_OK');
    return card('<div class="stack gap-14">' +
      '<div class="stack gap-4">' +
      '<h2 class="t-heading2 w-bold" id="h-receipt">물건을 받으셨나요?</h2>' +
      '<p class="t-body2-reading muted wrap-any">택배사 배송 완료와 별개로, 직접 확인하신 내용을 기관에 알립니다.</p>' +
      '</div>' +

      '<div class="stack gap-8" role="radiogroup" aria-labelledby="h-receipt">' +
      '<button type="button" class="choice" role="radio" data-act="receipt-issue" data-issue="RECEIVED_OK" aria-checked="' + (issue === 'RECEIVED_OK') + '">' +
      '<span class="choice__dot" aria-hidden="true"></span>' +
      '<span class="stack gap-4"><span class="t-body1 w-bold">잘 받았어요</span>' +
      '<span class="t-body2 muted">받은 물건 사진을 한 장 함께 보냅니다</span></span></button>' +
      (problemOpen
        ? ['DAMAGED', 'WRONG_ITEM', 'NOT_RECEIVED'].map(function (key) {
          return '<button type="button" class="choice" role="radio" data-act="receipt-issue" data-issue="' + key + '" aria-checked="' + (issue === key) + '">' +
            '<span class="choice__dot" aria-hidden="true"></span>' +
            '<span class="stack gap-4"><span class="t-body1 w-bold">' + esc(ISSUE_LABEL[key]) + '</span>' +
            '<span class="t-body2 muted">' + (key === 'NOT_RECEIVED' ? '사진 없이 담당 기관에 전화로 알립니다' : '문제가 보이는 사진을 한 장 함께 보냅니다') + '</span></span></button>';
        }).join('')
        : '') +
      '</div>' +
      (problemOpen
        ? ''
        : '<button type="button" class="choice" data-act="receipt-open" aria-expanded="false">' +
        '<span class="choice__dot choice__dot--plain" aria-hidden="true">' + ico('plus', 'ico--sm') + '</span>' +
        '<span class="stack gap-4"><span class="t-body1 w-bold">문제가 있어요</span>' +
        '<span class="t-body2 muted">파손·다른 상품·못 받음 중에서 고릅니다</span></span></button>') +

      (issue === 'NOT_RECEIVED'
        ? '<div class="stack gap-12">' +
        notice('warn', '담당 기관에 전화해 주세요 · ',
          '아직 못 받으신 건은 사진 없이 접수할 수 있는 경로가 이 배포에 없습니다. 접수한 척하지 않기 위해 기록을 남기지 않았습니다.', 'phone-fill') +
        '<a class="btn btn--solid-primary btn--block btn--lg" href="' + SUPPORT_TEL + '">' + ico('phone-fill') + SUPPORT_PHONE + ' 전화하기</a>' +
        '</div>'
        : photoIssue
          ? '<div class="stack gap-12">' +
          '<div class="stack gap-8">' +
          '<label class="field__label" for="receipt-photo">사진 한 장' +
          '<span class="field__req" aria-hidden="true">*</span><span class="sr-only">필수</span></label>' +
          '<p class="t-caption1 muted wrap-any">JPG·PNG·WebP만 받습니다. 큰 사진은 이 기기에서 600KB 아래로 줄여서 보냅니다.</p>' +
          '<input class="filefield" id="receipt-photo" type="file" accept="image/jpeg,image/png,image/webp" data-receipt-photo>' +
          '</div>' +
          (RECEIPT.image
            ? '<div class="ev ev--picked">' +
            evidenceFigure(RECEIPT.image.dataUrl, '보내려고 고른 사진 미리보기', '') +
            '<div class="ev__body">' +
            '<p class="ev__t wrap-any">' + esc(RECEIPT.fileName) + '</p>' +
            '<p class="ev__meta">' + Math.round(RECEIPT.image.bytes / 1024) + 'KB' +
            (RECEIPT.image.resized ? ' · 이 기기에서 줄였습니다' : '') + ' · 아직 보내지 않았습니다</p>' +
            '<button type="button" class="btn btn--outlined-assistive btn--md" data-act="receipt-clear-photo">사진 지우기</button>' +
            '</div></div>'
            : '') +
          (RECEIPT.error ? '<div role="alert">' + notice('negative', '', esc(RECEIPT.error), 'triangle-exclamation-fill') + '</div>' : '') +
          '<button type="button" class="btn btn--solid-primary btn--block btn--lg" data-act="receipt-submit"' +
          (RECEIPT.busy || !RECEIPT.image ? ' disabled aria-disabled="true"' : '') +
          (RECEIPT.busy ? ' aria-busy="true"' : '') + '>' +
          (RECEIPT.busy
            ? '<span class="spinner spinner--on-solid" aria-hidden="true"></span>보내는 중이에요…'
            : ico('check-thick') + esc(ISSUE_LABEL[issue]) + ' 보내기') + '</button>' +
          '</div>'
          : RECEIPT.error
            ? '<div role="alert">' + notice('negative', '', esc(RECEIPT.error), 'triangle-exclamation-fill') + '</div>'
            : '') +
      '</div>');
  }

  function evidenceListBlock() {
    if (EVIDENCE.loading) {
      return '<div class="row gap-12" role="status" aria-busy="true"><div class="spinner" aria-hidden="true"></div>' +
        '<p class="t-body2">보낸 증빙을 불러오는 중이에요…</p></div>';
    }
    if (EVIDENCE.error) {
      return notice(EVIDENCE.unavailable ? 'warn' : 'negative', '', esc(EVIDENCE.error),
        EVIDENCE.unavailable ? 'circle-exclamation-fill' : 'triangle-exclamation-fill');
    }
    if (!EVIDENCE.items.length) {
      return '<p class="t-body2 muted wrap-any">아직 보내신 증빙이 없습니다.</p>';
    }
    return '<div class="ev-list">' + EVIDENCE.items.map(evidenceCard).join('') + '</div>';
  }

  function viewOrderDetail() {
    if (!ORDER_READBACK.authenticated || !ORDER_READBACK.orders.length) {
      return viewOrders() +
        '<section class="sec" aria-labelledby="h-synth-gated">' +
        '<div class="sec__h"><h2 id="h-synth-gated">합성 증빙 시연</h2>' +
        '<span class="synth-tag">합성 시연</span></div>' +
        syntheticSection(true) + '</section>';
    }
    var scope = evidenceScope();
    return '<section>' +
      '<h1 class="ask ask--sm">배송은 어디까지 왔나요?</h1>' +
      '</section>' +
      orderReadbackCard(ORDER_READBACK.orders[0], false) +

      (scope
        ? receiptPanel() +
        '<section class="sec" aria-labelledby="h-ev"><div class="sec__h"><h2 id="h-ev">보낸 증빙</h2></div>' +
        evidenceListBlock() + '</section>'
        : card('<div class="stack gap-12">' +
          '<h2 class="t-heading2 w-bold">물건을 받으셨나요?</h2>' +
          notice('warn', '증빙을 보낼 권한이 아직 없어요 · ',
            '담당 기관이 보내 준 주문 조회 링크로 들어오셔야 수령 확인과 사진 접수가 열립니다. 지금은 ' + SUPPORT_PHONE + '로 알려 주세요.', 'lock-fill') +
          '<a class="btn btn--outlined-primary btn--block" href="' + SUPPORT_TEL + '">' + ico('phone-fill') + SUPPORT_PHONE + ' 전화하기</a>' +
          '</div>')) +

      '<section class="sec" aria-labelledby="h-synth">' +
      '<div class="sec__h"><h2 id="h-synth">합성 증빙 시연</h2>' +
      '<span class="synth-tag">합성 시연</span></div>' +
      syntheticSection(true) + '</section>';
  }

  /* ---------------- 도움 ---------------- */
  function viewHelp() {
    var program = LIVE.program;
    return '<section>' +
      '<h1 class="ask ask--sm">도움</h1>' +
      '<p class="lede">' + dual('전화로 이야기하는 편이 빠를 때가 많아요.', '전화로 말해도 괜찮아요.') + '</p>' +
      '</section>' +

      '<section class="stack gap-10">' +
      '<a class="btn btn--solid-primary btn--block btn--lg" href="' + SUPPORT_TEL + '">' +
      ico('phone-fill') + SUPPORT_PHONE + ' 전화하기</a>' +
      '<p class="t-body2 muted">일반 전화로 걸어도 처음부터 끝까지 통화만으로 주문할 수 있어요. 앱이나 화면이 필요하지 않습니다.</p>' +
      '</section>' +

      '<section class="sec"><p class="sec__t">글자와 화면 설정</p>' +
      card(a11yControls(), 'card--pad-sm') + '</section>' +

      '<section class="sec"><p class="sec__t">살 수 있는 먹거리</p>' +
      (program
        ? card('<div class="kv">' +
          (program.allowedCategories || []).map(function (key) {
            return kvRow(esc(categoryLabel(key)), '<span class="c-pos">살 수 있어요</span>');
          }).join('') +
          (program.prohibitedCategories || []).map(function (key) {
            return kvRow(esc(categoryLabel(key)), '<span class="c-neg">살 수 없어요</span>');
          }).join('') +
          '</div>' +
          '<p class="t-label1-reading muted" style="margin-top:12px">백미는 별도 양곡 지원으로 따로 받습니다. 그래서 이 지원금으로는 잡곡을 살 수 있어요.</p>' +
          '<div style="margin-top:12px">' + prov('정책 엔진이 그대로 돌려준 기준입니다. 버전 ' +
            esc(program.policyVersion || '확인 필요') + ' · ' + esc(program.officialName || ''), 'verified-check-fill') + '</div>', 'card--pad-sm')
        : LIVE.programError
          ? '<div role="alert" class="stack gap-12">' +
            notice('warn', '품목 기준을 불러오지 못했어요 · ', '기준을 추측해서 적지 않습니다.', 'circle-exclamation-fill') +
            '<button type="button" class="btn btn--solid-primary btn--block" data-act="retry-program">' + ico('refresh') + '품목 기준 다시 확인</button></div>'
          : card('<div class="row gap-12" role="status" aria-busy="true"><div class="spinner" aria-hidden="true"></div>' +
            '<p class="t-body1">품목 기준을 불러오는 중이에요…</p></div>', 'card--flat')) +
      '</section>';
  }

  /* =======================================================================
     표면 C — 기관 담당자 PC 업무함
     ==================================================================== */
  var OPS = { tab: 'action', filter: 'all', caseId: '' };

  async function loadOpsOverview() {
    var token = sessionStorage.getItem('malgyeol-role-ops');
    if (!token) return;
    LIVE.opsRequested = true; LIVE.opsLoading = true; LIVE.opsError = ''; render();
    try {
      LIVE.ops = await apiJson('/api/roles/ops/overview', { headers: { authorization: 'Bearer ' + token } });
    } catch (error) {
      LIVE.ops = null;
      LIVE.opsError = error.status === 401
        ? '역할 권한이 만료됐습니다. 새 기관 접속 링크를 요청해 주세요.'
        : '권한 범위의 사건을 불러오지 못했습니다.';
      if (error.status === 401) sessionStorage.removeItem('malgyeol-role-ops');
    }
    LIVE.opsLoading = false; render();
  }

  function opsCases() { return LIVE.ops && Array.isArray(LIVE.ops.cases) ? LIVE.ops.cases : []; }
  function opsCase(caseId) {
    return opsCases().filter(function (value) { return value.caseId === caseId; })[0] || null;
  }
  function channelOf(value) { return String(value.caseId || '').indexOf('web_') === 0 ? 'WEB' : 'PHONE'; }
  function chanTag(channel) {
    return '<span class="chan' + (channel === 'PHONE' ? ' chan--phone' : '') + '">' +
      ico(channel === 'PHONE' ? 'phone-fill' : 'utility') + channel + '</span>';
  }
  function opsState(value) { return (value.workflow && value.workflow.ops) || {}; }
  function consentState(value) { return (value.workflow && value.workflow.consent) || {}; }
  /* 다음 할 일은 실제 workflow 상태에서만 나온다. 우선순위는 결정 순서와 같다. */
  function nextTask(value) {
    var w = value.workflow || {};
    var ops = w.ops || {}; var consent = w.consent || {}; var merchant = w.merchant || {};
    if (value.state === 'POLICY_BLOCKED') return '차단 사유 통지';
    if (ops.exception === 'OPEN') return '예외 재처리';
    if (ops.policyReview !== 'REVIEWED') return '정책 검토 기록';
    if (consent.status !== 'RECORDED') return '동의 기록';
    if (!value.providerOrderId) return '유료 주문 실행';
    if (merchant.fulfillment === 'SHIPPED') return '수령 확인 대기';
    if (['CANCELLED', 'REFUNDED'].indexOf(merchant.fulfillment) >= 0) return '정산 마감';
    return '공급사 준비 확인';
  }
  function needsAction(value) {
    var w = value.workflow || {}; var ops = w.ops || {}; var consent = w.consent || {};
    if (value.state === 'POLICY_BLOCKED') return false;
    return ops.exception === 'OPEN' || ops.policyReview !== 'REVIEWED' || consent.status !== 'RECORDED';
  }
  var OPS_TABS = [
    { id: 'action', label: '처리 필요', icon: 'inbox', match: needsAction },
    { id: 'orders', label: '주문·배송', icon: 'document-text', match: function (v) { return Boolean(v.providerOrderId); } },
    { id: 'exception', label: '예외', icon: 'triangle-exclamation-fill', match: function (v) { return opsState(v).exception === 'OPEN'; } },
    { id: 'blocked', label: '차단', icon: 'circle-block', match: function (v) { return v.state === 'POLICY_BLOCKED'; } },
    { id: 'all', label: '전체', icon: 'list', match: function () { return true; } }
  ];
  function tabCases(id) {
    var tab = OPS_TABS.filter(function (t) { return t.id === id; })[0] || OPS_TABS[0];
    return opsCases().filter(tab.match);
  }

  function consentLabel(value) {
    var status = consentState(value).status || 'NONE';
    if (status === 'RECORDED') return '<span class="c-pos w-bold">기록됨</span>';
    if (status === 'INVALIDATED') return '<span class="c-neg w-bold">무효</span>';
    return '<span class="assist">없음</span>';
  }
  function policyBadge(value) {
    if (value.state === 'POLICY_BLOCKED') return badge('no', '차단', 'circle-block');
    if (opsState(value).policyReview === 'REVIEWED') return badge('ok', '검토됨', 'check-thick');
    return badge('warn', '검토 전');
  }
  var FULFILLMENT_LABEL = {
    NEW: '신규', ACKNOWLEDGED: '접수', OUT_OF_STOCK: '품절', PREPARING: '준비',
    SHIPPED: '배송', CANCELLED: '취소', REFUNDED: '환불'
  };

  /* =======================================================================
     기관 승인함과 배송 증빙 — 사건 작업면을 열 때만 사건별로 부른다.
     목록 화면에서 전체 사건에 대해 미리 부르지 않는다. 업무함은 업무함으로 둔다.
     ==================================================================== */
  var OPS_APPROVALS = {};
  var OPS_EVIDENCE = {};
  var OPS_EXEC = { requestId: '', confirming: false, running: false, error: '', result: null };
  var OPS_ORDER_LINKS = {};
  var OPS_REVIEW = { evidenceId: '', busy: false, error: '' };
  var OPS_SYNTH_OPEN = false;

  function opsToken() { return sessionStorage.getItem('malgyeol-role-ops') || ''; }
  function resetOpsCaseState() {
    OPS_EXEC = { requestId: '', confirming: false, running: false, error: '', result: null };
    OPS_REVIEW = { evidenceId: '', busy: false, error: '' };
  }
  function opsCanAct() { return Boolean(LIVE.ops) && LIVE.ops.readOnly === false; }
  function emptySlot() { return { requested: false, loading: false, error: '', unavailable: false, retryable: false, items: [] }; }

  async function loadOpsApprovals(caseId) {
    var token = opsToken();
    if (!token || !caseId) return;
    var slot = OPS_APPROVALS[caseId] || (OPS_APPROVALS[caseId] = emptySlot());
    if (slot.loading) return;
    slot.requested = true; slot.loading = true; slot.error = ''; slot.unavailable = false; slot.retryable = false; render();
    try {
      var body = await apiJson('/api/food-support/approval-list', {
        method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ caseId: caseId })
      });
      slot.items = Array.isArray(body.requests) ? body.requests : [];
    } catch (error) {
      slot.items = [];
      slot.unavailable = error.status === 503;
      slot.retryable = ![401, 403, 503].includes(error.status);
      slot.error = error.status === 503
        ? '이 배포에는 승인함이 연결되어 있지 않습니다.'
        : error.status === 401
          ? '역할 권한이 만료됐거나 이 사건 범위를 벗어났습니다.'
          : '승인 요청을 불러오지 못했습니다.';
    }
    slot.loading = false; render();
  }

  async function loadOpsEvidence(caseId) {
    var token = opsToken();
    if (!token || !caseId) return;
    var slot = OPS_EVIDENCE[caseId] || (OPS_EVIDENCE[caseId] = emptySlot());
    if (slot.loading) return;
    slot.requested = true; slot.loading = true; slot.error = ''; slot.unavailable = false; slot.retryable = false; render();
    try {
      var body = await apiJson('/api/delivery-evidence/list?caseId=' + encodeURIComponent(caseId), {
        headers: { authorization: 'Bearer ' + token }
      });
      slot.items = Array.isArray(body.evidence) ? body.evidence : [];
    } catch (error) {
      slot.items = [];
      slot.unavailable = error.status === 503;
      slot.retryable = ![401, 403, 503].includes(error.status);
      slot.error = error.status === 503
        ? '이 배포에는 배송 증빙 보관이 연결되어 있지 않습니다.'
        : error.status === 401 || error.status === 403
          ? '역할 권한이 만료됐거나 이 사건 범위를 벗어났습니다.'
          : '배송 증빙을 불러오지 못했습니다.';
    }
    slot.loading = false; render();
  }

  /* 유료 실행은 두 걸음으로만 진행한다. 먼저 무엇이 일어나는지 화면에서 읽어 주고,
     확인을 받은 뒤에야 승인함 실행 API를 부른다. order-submit은 부르지 않는다. */
  async function executeApproval(caseId, requestId) {
    var token = opsToken();
    if (!token || OPS_EXEC.running) return;
    OPS_EXEC.running = true; OPS_EXEC.error = ''; render();
    try {
      var body = await apiJson('/api/food-support/approval-execute', {
        method: 'POST', headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify({ caseId: caseId, requestId: requestId })
      });
      OPS_EXEC.result = body;
      rememberOrderAccess(caseId, body && body.result);
      OPS_EXEC.confirming = false;
      say('실행 결과를 서버 응답 그대로 표시했습니다.', true);
    } catch (error) {
      OPS_EXEC.result = error.body && error.body.request ? error.body : null;
      OPS_EXEC.error = error.status === 401
        ? '실제 주문을 실행할 행동 권한이 없습니다.'
        : error.status === 409
          ? '이미 처리된 요청이거나 조건이 바뀌었습니다.'
          : error.status === 404
            ? '해당 승인 요청을 찾지 못했습니다.'
            : error.status === 503
              ? '이 배포에는 승인함이 연결되어 있지 않습니다.'
              : '주문 실행 요청을 마치지 못했습니다.';
      say(OPS_EXEC.error, true);
    }
    OPS_EXEC.running = false;
    OPS_APPROVALS[caseId] = emptySlot();
    render();
    loadOpsApprovals(caseId);
  }

  function orderAccessLink(orderId, access) {
    if (!orderId || !access || !access.token) return null;
    var url = location.origin + '/?v=orders#order=' + encodeURIComponent(orderId) + '&access=' + encodeURIComponent(access.token);
    return { url: url, orderId: orderId, expiresAt: access.expiresAt || 0 };
  }

  function rememberOrderAccess(caseId, result) {
    var orderId = result && result.order && result.order.externalOrderId;
    var link = orderAccessLink(orderId, result && result.orderAccess);
    if (link) OPS_ORDER_LINKS[caseId] = link;
  }

  async function issueOrderAccessLink(caseId, orderId, button) {
    var token = opsToken();
    if (!token || !caseId || !orderId) return;
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    try {
      var body = await apiJson('/api/food-support/order-access', {
        method: 'POST', headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify({ caseId: caseId, orderId: orderId })
      });
      OPS_ORDER_LINKS[caseId] = orderAccessLink(orderId, body.orderAccess);
      render();
      say('이용자에게 보낼 30일 주문 조회 링크를 발급했습니다.', true);
    } catch (error) {
      alertLine(button, error.status === 401
        ? '주문 조회 링크를 발급할 행동 권한이 없습니다.'
        : '주문 조회 링크를 발급하지 못했습니다. 주문번호와 권한을 다시 확인해 주세요.');
    } finally {
      button.disabled = false; button.removeAttribute('aria-busy');
    }
  }

  async function copyOrderAccessLink(caseId, button) {
    var value = OPS_ORDER_LINKS[caseId];
    if (!value || !value.url) return;
    try {
      await navigator.clipboard.writeText(value.url);
      alertLine(button, '30일 주문 조회 링크를 복사했습니다. 이용자에게 안전한 기관 채널로 전달해 주세요.');
    } catch {
      var input = document.querySelector('[data-order-access-value="' + caseId + '"]');
      if (input) { input.focus(); input.select(); }
      alertLine(button, '자동 복사가 막혔습니다. 위 링크를 직접 선택해 복사해 주세요.');
    }
  }

  async function reviewEvidence(caseId, evidenceId, reviewState) {
    var token = opsToken();
    if (!token || OPS_REVIEW.busy) return;
    OPS_REVIEW.evidenceId = evidenceId; OPS_REVIEW.busy = true; OPS_REVIEW.error = ''; render();
    try {
      await apiJson('/api/delivery-evidence/review', {
        method: 'POST', headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify({ caseId: caseId, evidenceId: evidenceId, reviewState: reviewState })
      });
      OPS_REVIEW.busy = false; OPS_REVIEW.evidenceId = '';
      OPS_EVIDENCE[caseId] = emptySlot();
      render();
      say(reviewState === 'ACCEPTED' ? '증빙을 인정으로 기록했습니다.' : '증빙을 반려로 기록했습니다.', true);
      loadOpsEvidence(caseId);
    } catch (error) {
      OPS_REVIEW.busy = false;
      OPS_REVIEW.error = error.status === 401 || error.status === 403
        ? '증빙을 판정할 행동 권한이 없습니다.'
        : error.status === 404
          ? '해당 증빙을 찾지 못했습니다.'
          : '증빙 판정을 기록하지 못했습니다.';
      render();
      say(OPS_REVIEW.error, true);
    }
  }

  var APPROVAL_STATUS_LABEL = {
    PENDING: '실행 대기', SUBMITTED: '공급사 주문 완료',
    RECONCILIATION_REQUIRED: '대사 필요', FAILED: '실행 실패'
  };
  function approvalStatusBadge(status) {
    if (status === 'SUBMITTED') return badge('ok', APPROVAL_STATUS_LABEL.SUBMITTED, 'circle-check-fill');
    if (status === 'FAILED') return badge('no', APPROVAL_STATUS_LABEL.FAILED, 'circle-block');
    if (status === 'RECONCILIATION_REQUIRED') return badge('warn', APPROVAL_STATUS_LABEL.RECONCILIATION_REQUIRED, 'triangle-exclamation-fill');
    return badge('info', APPROVAL_STATUS_LABEL.PENDING, 'clock');
  }

  function opsSlotState(slot, emptyText, retryKind, caseId) {
    /* 토큰이 사라진 뒤라면 영원히 도는 spinner를 보여 주지 않는다. */
    if (!opsToken()) {
      return notice('warn', '', '역할 권한이 연결되어 있지 않습니다. 새 기관 접속 링크를 요청해 주세요.', 'lock-fill');
    }
    if (!slot || !slot.requested) {
      return '<div class="row gap-12" role="status" aria-busy="true"><div class="spinner" aria-hidden="true"></div>' +
        '<p class="t-body2">불러오는 중입니다.</p></div>';
    }
    if (slot.loading) {
      return '<div class="row gap-12" role="status" aria-busy="true"><div class="spinner" aria-hidden="true"></div>' +
        '<p class="t-body2">불러오는 중입니다.</p></div>';
    }
    if (slot.error) {
      return '<div role="alert" class="stack gap-10">' +
        notice(slot.unavailable ? 'warn' : 'negative', '', esc(slot.error),
          slot.unavailable ? 'circle-exclamation-fill' : 'triangle-exclamation-fill') +
        (slot.retryable && opsToken()
          ? '<button type="button" class="btn btn--outlined-primary btn--md" data-act="' + retryKind + '" data-case-id="' + esc(caseId) + '">' + ico('refresh') + '다시 불러오기</button>'
          : '') + '</div>';
    }
    if (!slot.items.length) return '<p class="t-body2 muted">' + esc(emptyText) + '</p>';
    return '';
  }

  function approvalRequestCard(caseId, request) {
    var pending = request.status === 'PENDING';
    var confirming = OPS_EXEC.confirming && OPS_EXEC.requestId === request.requestId;
    var running = OPS_EXEC.running && OPS_EXEC.requestId === request.requestId;
    var resultFor = OPS_EXEC.result && OPS_EXEC.result.request && OPS_EXEC.result.request.requestId === request.requestId
      ? OPS_EXEC.result : null;
    var errorFor = OPS_EXEC.error && OPS_EXEC.requestId === request.requestId ? OPS_EXEC.error : '';
    var shown = resultFor ? resultFor.request : request;
    var accessLink = OPS_ORDER_LINKS[caseId];
    return '<div class="card card--flat card--pad-sm">' +
      '<div class="stack gap-12">' +
      '<div class="row row--between row--wrap gap-8">' +
      '<p class="t-headline2 w-bold wrap-any grow">' + esc(shown.productName || '확인 필요') + '</p>' +
      approvalStatusBadge(shown.status) + '</div>' +
      '<div class="kv">' +
      kvRow('요청 번호', '<span class="mono">' + esc(shown.requestId || '') + '</span>') +
      kvRow('상품 번호', '<span class="mono">' + esc(shown.goodsNo || '확인 필요') + '</span>') +
      kvRow('수량', esc(String(shown.quantity == null ? '확인 필요' : shown.quantity)) + '개') +
      kvRow('합계', won(shown.totalPriceKrw), true) +
      kvRow('받는 분', masked(shown.maskedRecipient)) +
      kvRow('연락처', masked(shown.maskedPhone)) +
      kvRow('주소', masked(shown.maskedAddress)) +
      kvRow('동의 만료', shown.consentExpiresAt ? when(shown.consentExpiresAt) : '확인 필요') +
      (shown.externalOrderId ? kvRow('공급사 주문번호', '<span class="mono">' + esc(shown.externalOrderId) + '</span>') : '') +
      '</div>' +

      (resultFor
        ? '<div role="status">' +
        (shown.status === 'SUBMITTED'
          ? notice('positive', '공급사에 실제 주문이 들어갔습니다 · ', '이 요청은 더 이상 실행할 수 없습니다.', 'circle-check-fill')
          : shown.status === 'RECONCILIATION_REQUIRED'
            ? notice('warn', '대사가 필요합니다 · ', '공급사 응답이 확정되지 않았습니다. 주문 존재 여부를 확인한 뒤 처리하십시오.', 'triangle-exclamation-fill')
            : notice('negative', '실행에 실패했습니다 · ', '공급사 주문이 생성되지 않았습니다. 응답을 확인한 뒤 다시 접수하십시오.', 'circle-block')) +
        '</div>'
        : '') +
      (shown.status === 'SUBMITTED' && shown.externalOrderId
        ? '<div class="stack gap-10">' +
          '<p class="t-label1 w-bold">이용자 주문 조회</p>' +
          (accessLink
            ? '<div class="tf"><input type="text" readonly aria-label="이용자 30일 주문 조회 링크" data-order-access-value="' + esc(caseId) + '" value="' + esc(accessLink.url) + '"></div>' +
              '<p class="t-label2 muted">발급 시점부터 30일 동안 이 주문 한 건의 상태와 배송 증빙만 열립니다.</p>' +
              '<button type="button" class="btn btn--outlined-primary btn--md btn--block" data-copy-order-access data-case-id="' + esc(caseId) + '">링크 복사</button>'
            : '<button type="button" class="btn btn--outlined-primary btn--md btn--block" data-issue-order-access' +
              ' data-case-id="' + esc(caseId) + '" data-order-id="' + esc(shown.externalOrderId) + '">이용자 30일 조회 링크 발급</button>') +
          '</div>'
        : '') +
      (errorFor ? '<div role="alert">' + notice('negative', '', esc(errorFor), 'triangle-exclamation-fill') + '</div>' : '') +

      (!opsCanAct()
        ? '<p class="t-label2 muted">읽기 전용 권한입니다. 상태만 확인할 수 있고 실행 버튼은 열리지 않습니다.</p>'
        : !pending
          ? '<p class="t-label2 muted">실행이 끝난 요청입니다. 같은 요청을 다시 실행할 수 없습니다.</p>'
          : confirming
            ? '<div class="confirm" role="group" aria-label="실제 주문 실행 확인">' +
            '<p class="confirm__t">' + ico('triangle-exclamation-fill') + '실제 공급사 주문을 지금 한 번 생성합니다</p>' +
            '<div class="kv">' +
            kvRow('상품', esc(shown.productName || '확인 필요')) +
            kvRow('수량', esc(String(shown.quantity == null ? '확인 필요' : shown.quantity)) + '개') +
            kvRow('청구 합계', won(shown.totalPriceKrw), true) +
            '</div>' +
            '<p class="confirm__d">이용자가 승인 요청 시점에 저장한 미리보기 그대로 주문합니다. 실행 후에는 취소·환불 절차로만 되돌릴 수 있습니다.</p>' +
            '<div class="btn-row btn-row--2">' +
            '<button type="button" class="btn btn--outlined-assistive btn--md" data-ops-exec-cancel>돌아가기</button>' +
            '<button type="button" class="btn btn--solid-primary btn--md" data-ops-exec-confirm' +
            ' data-case-id="' + esc(caseId) + '" data-request-id="' + esc(shown.requestId) + '"' +
            (running ? ' disabled aria-disabled="true" aria-busy="true"' : '') + '>' +
            (running ? '실행 중…' : '실행합니다') + '</button>' +
            '</div></div>'
            : '<button type="button" class="btn btn--solid-primary btn--md btn--block" data-ops-exec-open' +
            ' data-request-id="' + esc(shown.requestId) + '">' + ico('verified-check-fill') + '검토 후 실제 주문 실행</button>') +
      '</div></div>';
  }

  function opsEvidenceCard(caseId, item) {
    var busy = OPS_REVIEW.busy && OPS_REVIEW.evidenceId === item.evidenceId;
    return '<div class="ev">' +
      evidenceFigure(item.imageDataUrl, (ISSUE_LABEL[item.issueType] || '배송') + ' 증빙 사진', '') +
      '<div class="ev__body">' +
      '<p class="ev__t">' + esc(ISSUE_LABEL[item.issueType] || item.issueType || '확인 필요') + '</p>' +
      '<div class="row row--wrap gap-6">' + reviewBadge(item.reviewState) + '</div>' +
      '<p class="ev__meta">제출 ' + (item.createdAt ? when(item.createdAt) : '확인 필요') +
      (item.reviewedAt ? ' · 판정 ' + when(item.reviewedAt) : '') + '</p>' +
      (shortHash(item.sha256) ? '<p class="ev__meta mono">sha256 ' + esc(shortHash(item.sha256)) + '…</p>' : '') +
      (opsCanAct()
        ? '<div class="btn-row" style="margin-top:8px">' +
        '<button type="button" class="btn btn--outlined-primary btn--md" data-ops-review="ACCEPTED"' +
        ' data-case-id="' + esc(caseId) + '" data-evidence-id="' + esc(item.evidenceId) + '"' +
        (busy ? ' disabled aria-disabled="true"' : '') + '>인정</button>' +
        '<button type="button" class="btn btn--outlined-assistive btn--md" data-ops-review="REJECTED"' +
        ' data-case-id="' + esc(caseId) + '" data-evidence-id="' + esc(item.evidenceId) + '"' +
        (busy ? ' disabled aria-disabled="true"' : '') + '>반려</button>' +
        '</div>'
        : '') +
      '</div></div>';
  }

  function opsApprovalSection(caseId) {
    var slot = OPS_APPROVALS[caseId];
    var state = opsSlotState(slot, '이 사건에는 접수된 승인 요청이 없습니다.', 'retry-ops-approvals', caseId);
    return '<div class="case__sec">' + sech('7 승인 요청과 유료 실행') +
      (state || '<div class="stack gap-12">' + slot.items.map(function (request) {
        return approvalRequestCard(caseId, request);
      }).join('') + '</div>') +
      '<p class="t-label2 muted" style="margin-top:10px">받는 분 정보는 서버에 암호화되어 있고 이 화면에는 가려진 값만 옵니다. 실행은 저장된 미리보기 그대로 한 번만 이루어집니다.</p>' +
      '</div>';
  }

  function opsEvidenceSection(caseId) {
    var slot = OPS_EVIDENCE[caseId];
    var state = opsSlotState(slot, '제출된 배송 증빙이 없습니다.', 'retry-ops-evidence', caseId);
    return '<div class="case__sec">' + sech('8 배송 증빙') +
      (OPS_REVIEW.error ? '<div role="alert" style="margin-bottom:12px">' + notice('negative', '', esc(OPS_REVIEW.error), 'triangle-exclamation-fill') + '</div>' : '') +
      (state || '<div class="ev-list">' + slot.items.map(function (item) {
        return opsEvidenceCard(caseId, item);
      }).join('') + '</div>') +
      /* 접힘 상태는 DOM이 아니라 모듈 상태에 둔다. 다시 그릴 때 접혀 버리면
         담당자가 눌러도 아무 일이 없었던 것처럼 보인다. */
      '<div class="disc disc--manual">' +
      '<button type="button" class="disc__btn" data-ops-synth-toggle aria-expanded="' + OPS_SYNTH_OPEN + '">' +
      '합성 증빙 예시' + (OPS_SYNTH_OPEN ? ' 접기' : ' 열기') + ico('chevron-down') + '</button>' +
      (OPS_SYNTH_OPEN ? '<div class="disc__body">' + syntheticSection(true) + '</div>' : '') +
      '</div></div>';
  }

  function opsGate(message, gated) {
    return '<div class="gate" style="max-width:640px">' + ico('lock', 'gate__ico') +
      '<p class="t-body1 w-bold">' + esc(message) + '</p>' +
      '<p class="t-body2-reading muted wrap-any">기관 계정으로 연결하면 실제 처리 업무가 열립니다. 연결 전에는 임의의 요청을 만들어 보여드리지 않습니다.</p>' +
      (gated ? tag('gated') : '') +
      '<form id="ops-access-form" class="stack gap-10" style="margin-top:18px" novalidate>' +
      '<label class="field__label" for="ops-access-url">새 기관 접속 링크</label>' +
      '<div class="tf"><input id="ops-access-url" name="accessUrl" type="url" autocomplete="off" placeholder="기관 시스템 담당자가 발급한 링크를 붙여 넣으세요" required></div>' +
      '<p class="t-label2 muted">기관 시스템 담당자가 발급한 이 서비스의 접속 링크만 사용할 수 있습니다.</p>' +
      (LIVE.opsConnectError ? '<p class="field__error" role="alert">' + ico('circle-exclamation-fill', 'ico--sm') + esc(LIVE.opsConnectError) + '</p>' : '') +
      '<button type="submit" class="btn btn--solid-primary btn--block">기관 업무함 다시 연결</button>' +
      '</form></div>';
  }

  function viewOps() {
    if (LIVE.opsLoading) {
      return '<div class="row gap-12" role="status" aria-busy="true"><div class="spinner" aria-hidden="true"></div>' +
        '<p class="t-body1">권한 범위의 사건을 불러오는 중입니다.</p></div>';
    }
    if (LIVE.opsError) return '<div role="alert" class="stack gap-12">' +
      notice('negative', '역할 연결 실패 · ', esc(LIVE.opsError), 'triangle-exclamation-fill') +
      (opsToken()
        ? '<button type="button" class="btn btn--solid-primary" data-act="retry-ops-overview">' + ico('refresh') + '업무함 다시 불러오기</button>'
        : opsGate('새 기관 접속 링크가 필요합니다', true)) + '</div>';
    if (!LIVE.ops) {
      return opsGate('기관 역할 권한이 연결되지 않았습니다', true) +
        '<section class="sec ops-synth-gated" aria-labelledby="h-ops-synth-gated">' +
        '<div class="sec__h"><h2 id="h-ops-synth-gated">합성 증빙 시연</h2>' +
        '<span class="synth-tag">합성 시연</span></div>' +
        syntheticSection(true) + '</section>';
    }
    if (OPS.caseId && opsCase(OPS.caseId)) return viewOpsCase(opsCase(OPS.caseId));

    var tab = OPS_TABS.filter(function (t) { return t.id === OPS.tab; })[0] || OPS_TABS[0];
    var rows = tabCases(OPS.tab);
    if (OPS.tab === 'action' && OPS.filter === 'policy') rows = rows.filter(function (v) { return opsState(v).policyReview !== 'REVIEWED'; });
    if (OPS.tab === 'action' && OPS.filter === 'consent') rows = rows.filter(function (v) { return consentState(v).status !== 'RECORDED'; });

    var filters = OPS.tab !== 'action' ? '' : ['all:전체', 'policy:정책 검토 필요', 'consent:동의 필요'].map(function (f) {
      var parts = f.split(':');
      return '<button type="button" class="chip" data-ops-filter="' + parts[0] + '" aria-pressed="' + (OPS.filter === parts[0]) + '">' + parts[1] + '</button>';
    }).join('');

    return '<div class="ops__head">' +
      '<div><h1 class="ops__title">' + tab.label + '</h1>' +
      '<p class="t-body2 muted" style="margin-top:6px">권한 범위 ' + opsCases().length + '건 중 ' + rows.length + '건 표시 · ' +
      (LIVE.ops.readOnly ? '읽기 전용 권한' : '행동 권한') + '</p></div>' +
      '<div class="ops__filters">' + filters + '</div></div>' +

      (LIVE.ops.readOnly
        ? '<div style="margin-bottom:16px;max-width:720px">' + notice('warn', '보기 권한 · ', '이 링크로는 사건을 변경하거나 기록을 남길 수 없습니다.', 'lock-fill') + '</div>'
        : '') +

      (rows.length === 0
        ? '<div class="empty" style="max-width:560px"><p class="t-body1 w-bold">지금 처리할 건이 없습니다</p>' +
        '<p class="t-body2 muted">새 요청이 들어오면 이 목록 맨 위에 쌓입니다.</p></div>'
        : '<div class="tbl-wrap"><table class="tbl"><caption class="sr-only">' + tab.label + ' 목록</caption>' +
        '<thead><tr>' +
        '<th scope="col">접수</th><th scope="col">경로</th><th scope="col">요청·상품</th>' +
        '<th scope="col" class="th-num">합계</th><th scope="col">동의</th><th scope="col">정책</th>' +
        '<th scope="col">공급사</th><th scope="col">다음 할 일</th>' +
        '</tr></thead><tbody>' +
        rows.map(function (value) {
          var merchant = (value.workflow && value.workflow.merchant) || {};
          return '<tr tabindex="0" role="link" data-ops-case="' + esc(value.caseId) + '">' +
            '<td class="td-time">' + shortTime(value.createdAt) + '</td>' +
            '<td>' + chanTag(channelOf(value)) + '</td>' +
            '<td class="td-item">' + (value.productName ? esc(value.productName) : '<span class="assist">상품 선택 전</span>') + '</td>' +
            '<td class="td-num">' + (value.programAmountKrw == null ? '<span class="assist">없음</span>' : won(value.programAmountKrw)) + '</td>' +
            '<td>' + consentLabel(value) + '</td>' +
            '<td>' + policyBadge(value) + '</td>' +
            '<td>' + (value.providerOrderId
              ? esc(FULFILLMENT_LABEL[merchant.fulfillment] || merchant.fulfillment || '접수')
              : '<span class="assist">없음</span>') + '</td>' +
            '<td class="td-next">' + esc(nextTask(value)) + '</td>' +
            '</tr>';
        }).join('') + '</tbody></table></div>');
  }

  function sech(title) { return '<div class="case__sech"><h3>' + title + '</h3><i aria-hidden="true"></i></div>'; }
  function opsKv(rows) {
    return '<div class="kv">' + rows.map(function (row) {
      return kvRow(esc(row[0]), row[1] == null || row[1] === ''
        ? '<span class="assist">없음</span>' : (row[2] ? row[1] : esc(row[1])));
    }).join('') + '</div>';
  }

  /* 사건 작업면은 결정 순서를 그대로 따른다.
     요청 → 실제 상품·공급사 → 정책·예산 → 동의 → 가려진 배송 → 공급사 준비. */
  function viewOpsCase(value) {
    var w = value.workflow || {};
    var ops = w.ops || {}; var consent = w.consent || {}; var merchant = w.merchant || {};
    var readOnly = LIVE.ops.readOnly;
    var actions = [];
    if (!readOnly) {
      if (ops.policyReview !== 'REVIEWED') actions.push(['REVIEW_POLICY', '정책 검토 기록', 'btn--solid-primary', '']);
      if (consent.status !== 'RECORDED' && ['SHIPPED', 'CANCELLED', 'REFUNDED'].indexOf(merchant.fulfillment) < 0) {
        actions.push(['RECORD_CONSENT', '현재 조건으로 동의 기록', ops.policyReview === 'REVIEWED' ? 'btn--solid-primary' : 'btn--outlined-primary', '']);
      }
      if (ops.exception === 'OPEN') actions.push(['RESOLVE_EXCEPTION', '예외 재처리', 'btn--solid-primary', 'data-resolution-code="RETRY_REQUIRED"']);
      else actions.push(['QUEUE_EXCEPTION', '예외 큐에 올리기', 'btn--outlined-assistive', 'data-reason-code="POLICY_AMBIGUITY"']);
    }

    return '<button type="button" class="case__back" data-ops-back>' + ico('chevron-left') + '목록으로</button>' +
      '<div class="case">' +
      '<div>' +
      '<div class="row row--wrap gap-8">' + chanTag(channelOf(value)) + policyBadge(value) +
      '<span class="t-label2 muted mono">' + esc(value.caseId) + '</span></div>' +
      '<h1 class="ops__title" style="margin-top:12px">' +
      (value.productName ? esc(value.productName) : '상품 선택 전 사건') + '</h1>' +
      '<p class="t-body2 muted" style="margin-top:6px">' + when(value.createdAt) + ' 접수 · ' +
      (channelOf(value) === 'PHONE' ? '전화 통화로 접수' : '이용자 모바일웹에서 접수') + ' · ' + esc(value.programName || '') + '</p>' +

      '<div class="case__sec">' + sech('1 요청') +
      opsKv([
        ['사건 상태', value.state],
        ['접수 경로', channelOf(value) === 'PHONE' ? '전화 통화' : '모바일 웹'],
        ['요청 확인 문장', value.productName],
        ['수량', value.quantity == null ? null : value.quantity + '개']
      ]) +
      '<p class="t-label2 muted" style="margin-top:10px">원본 음성과 발화 전문은 이 화면에 열지 않습니다. 구조화된 결과만 표시합니다.</p>' +
      '</div>' +

      '<div class="case__sec">' + sech('2 실제 상품과 공급사') +
      (value.providerOrderId
        ? opsKv([
          ['공급사 주문번호', value.providerOrderId],
          ['공급사 처리 상태', FULFILLMENT_LABEL[merchant.fulfillment] || merchant.fulfillment],
          ['택배사', merchant.carrierCode],
          ['송장번호', merchant.trackingNumber],
          ['대체 제안 상품번호', merchant.substitutionGoodsNo]
        ])
        : '<p class="t-body2 muted">공급사에 들어간 주문이 없습니다. 상품·재고·가격은 유료 실행 시점에 판매처 응답으로 확정됩니다.</p>') +
      '</div>' +

      '<div class="case__sec">' + sech('3 정책과 예산') +
      '<div class="notice ' + (value.state === 'POLICY_BLOCKED' ? 'notice--negative' : ops.policyReview === 'REVIEWED' ? 'notice--positive' : 'notice--warn') + '">' +
      ico(value.state === 'POLICY_BLOCKED' ? 'circle-block' : ops.policyReview === 'REVIEWED' ? 'circle-check-fill' : 'triangle-exclamation-fill') +
      '<span>' + (value.state === 'POLICY_BLOCKED'
        ? '결정형 정책 판정에서 차단된 사건입니다. 카탈로그 조회와 유료 실행이 시작되지 않았습니다.'
        : ops.policyReview === 'REVIEWED'
          ? '담당자 정책 검토가 기록되었습니다.'
          : '담당자 정책 검토가 아직 기록되지 않았습니다.') + '</span></div>' +
      '<div style="margin-top:14px">' + opsKv([
        ['지원 금액', value.programAmountKrw == null ? null : value.programAmountKrw.toLocaleString('ko-KR') + '원'],
        ['예외 상태', ops.exception === 'OPEN' ? '열림 · ' + (ops.exceptionReason || '사유 미기재') : ops.exception === 'RESOLVED' ? '해소됨' : null],
        ['프로그램', value.currentProductProgram]
      ]) + '</div></div>' +

      '<div class="case__sec">' + sech('4 이용자 확인') +
      opsKv([
        ['동의 상태', consent.status === 'RECORDED' ? '기록됨' : consent.status === 'INVALIDATED' ? '무효' : null],
        ['기록 시각', consent.recordedAt ? when(consent.recordedAt) : null],
        ['무효 사유', consent.invalidatedBy]
      ]) +
      '<p class="t-label2 muted" style="margin-top:10px">상품·가격·배송비가 바뀌면 기존 동의는 즉시 무효가 되고 다시 받아야 합니다.</p>' +
      '</div>' +

      '<div class="case__sec">' + sech('5 배송지 (가림)') +
      '<p class="t-body2 muted">받는 분 이름·연락처·주소 원문은 이 화면과 사건 원장에 남지 않습니다. 가려진 값은 유료 실행 경로에서만 확인합니다.</p>' +
      '</div>' +

      '<div class="case__sec">' + sech('6 공급사 상태와 수령') +
      (value.providerOrderId
        ? opsKv([
          ['공급사 상태', FULFILLMENT_LABEL[merchant.fulfillment] || merchant.fulfillment],
          ['택배사', merchant.carrierCode],
          ['송장번호', merchant.trackingNumber]
        ]) + '<p class="t-label2 muted" style="margin-top:10px">택배사 배송 완료와 이용자 수령 확인은 끝까지 별도 상태로 관리합니다.</p>'
        : '<p class="t-body2 muted">공급사 요청 전입니다.</p>') +
      '</div>' +

      opsApprovalSection(value.caseId) +
      opsEvidenceSection(value.caseId) +

      '<details class="disc"><summary>기술 증적 열기' + ico('chevron-down') + '</summary>' +
      '<div class="disc__body proof">' +
      proofRow('caseId', value.caseId) +
      proofRow('workflow revision', String(w.revision == null ? '' : w.revision)) +
      proofRow('consent fingerprint', consent.fingerprint) +
      proofRow('supplier order id', value.providerOrderId) +
      proofRow('external readback immutable', w.externalReadbackImmutable ? 'true' : '') +
      proofRow('last workflow event', (w.events && w.events.length ? w.events[w.events.length - 1].action : '')) +
      '</div></details>' +
      '</div>' +

      '<aside><div class="actcard">' +
      '<p class="actcard__t">지금 할 수 있는 일</p>' +
      '<div class="kv">' +
      kvRow('지원 금액', value.programAmountKrw == null ? '<span class="assist">없음</span>' : won(value.programAmountKrw)) +
      kvRow('동의', consentLabel(value)) +
      kvRow('공급사 주문', value.providerOrderId ? '<span class="mono">' + esc(value.providerOrderId) + '</span>' : '<span class="assist">없음</span>') +
      '</div><hr>' +
      (actions.length
        ? actions.map(function (a) {
          return '<button type="button" class="btn ' + a[2] + ' btn--md btn--block" data-ops-action="' + a[0] + '"' +
            ' data-case-id="' + esc(value.caseId) + '" ' + a[3] + '>' + a[1] + '</button>';
        }).join('')
        : '<p class="t-body2 muted">이 권한으로 지금 남길 수 있는 기록이 없습니다.</p>') +
      '<hr>' +
      '<p class="actcard__t">유료 주문 실행</p>' +
      (readOnly
        ? notice('warn', '읽기 전용 권한입니다 · ', '실제 공급사 주문 실행은 행동 권한이 있는 담당자에게만 열립니다.', 'lock-fill')
        : notice('info', '아래 7번 항목에서 실행합니다 · ', '이용자가 접수한 승인 요청을 확인한 뒤, 확인 창을 거쳐 한 번만 실행됩니다.', 'circle-info-fill')) +
      '<hr>' +
      '<button type="button" class="btn btn--outlined-assistive btn--md btn--block" data-ops-export>' +
      ico('download') + '권한 범위 XLSX' + '</button>' +
      '</div></aside>' +
      '</div>';
  }

  async function runOpsAction(button) {
    var caseId = button.dataset.caseId;
    var action = button.dataset.opsAction;
    var token = sessionStorage.getItem('malgyeol-role-ops');
    var value = opsCase(caseId);
    if (!token || !value || !value.workflow) { alertLine(button, '역할 권한이나 사건 상태를 다시 불러와 주세요.'); return; }
    var data = {};
    if (action === 'QUEUE_EXCEPTION') data.reasonCode = button.dataset.reasonCode || 'POLICY_AMBIGUITY';
    if (action === 'RESOLVE_EXCEPTION') data.resolutionCode = button.dataset.resolutionCode || 'RETRY_REQUIRED';
    if (action === 'RECORD_CONSENT') {
      data.fingerprint = await sha256Hex([caseId, value.state, value.providerOrderId || '', value.workflow.revision].join('|'));
    }
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    try {
      await apiJson('/api/roles/ops/actions', {
        method: 'POST', headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify({ caseId: caseId, action: action, expectedRevision: value.workflow.revision, data: data })
      });
      await loadOpsOverview();
      say('사건 ' + caseId + '에 ' + action + ' 기록을 남겼습니다.', true);
    } catch (error) {
      alertLine(button, error.status === 409
        ? '다른 담당자가 먼저 변경했습니다. 최신 상태를 다시 불러왔습니다.'
        : '처리하지 못했습니다. 권한과 입력값을 확인해 주세요.');
      if (error.status === 409) await loadOpsOverview();
    } finally { button.disabled = false; button.removeAttribute('aria-busy'); }
  }

  async function downloadOpsExport(button) {
    var token = sessionStorage.getItem('malgyeol-role-ops');
    if (!token) { alertLine(button, '기관 역할 권한이 필요합니다.'); return; }
    var response = await fetch('/api/roles/ops/export.xlsx', { headers: { authorization: 'Bearer ' + token } });
    if (!response.ok) { alertLine(button, 'XLSX를 만들지 못했습니다. 역할 권한을 다시 확인해 주세요.'); return; }
    var url = URL.createObjectURL(await response.blob());
    var link = document.createElement('a'); link.href = url; link.download = 'malgyeol-role-scope.xlsx'; link.click(); URL.revokeObjectURL(url);
    say('권한 범위의 XLSX를 내려받았습니다.');
  }

  function renderOpsRail() {
    var rail = $('#ops-nav');
    if (!rail) return;
    if (!LIVE.ops) {
      rail.innerHTML = '<p class="t-body2 muted" style="padding:0 12px">권한 연결 전</p>';
      $('#ops-scope').innerHTML = '';
      return;
    }
    rail.innerHTML = OPS_TABS.map(function (tab) {
      return '<button type="button" class="railnav__item" data-ops-tab="' + tab.id + '" aria-current="' + (OPS.tab === tab.id) + '">' +
        ico(tab.icon) + tab.label + '<span class="railnav__count">' + tabCases(tab.id).length + '</span></button>';
    }).join('');
    $('#ops-scope').innerHTML =
      '<p class="t-caption1 assist">권한 범위</p>' +
      '<p class="t-label1 w-bold">' + (LIVE.ops.readOnly ? '읽기 전용' : '행동 권한') + ' · 사건 ' + opsCases().length + '건</p>' +
      '<p class="t-caption1 muted">만료 ' + (LIVE.ops.expiresAt ? when(LIVE.ops.expiresAt) : '확인 필요') + '</p>';
  }

  /* =======================================================================
     표면 D — 심사 데모
     ==================================================================== */
  var DEMO_DEFAULT = 'case_3f561b18f138a1c737893401';
  var DEMO_BLOCKED_DEFAULT = 'case_e5d2bd2c407050b604c6d364';
  var DEMO = { story: 'phone' };

  /* 사건 번호는 세 갈래로 완전히 분리한다. 하나로 이어졌다고 말하지 않는다.
     DEMO_CASE_ID          전화 직접주문 흐름의 합성 시연 사건
     DEMO_DELIVERY_CASE_ID 배송 시나리오의 별도 합성 사건 (위 사건과 무관)
     LEGACY_PROOF_CASE_ID  과거 기술 검증 사건 (샌드박스 · 결제 승인)
     그리고 실제 공급자 주문 회신은 사건 번호가 아니라 공급자 주문번호로만 존재한다. */
  var DEMO_CASE_ID = 'food_ae6d8ee9a951a2557abeb942';
  var DEMO_DELIVERY_CASE_ID = 'deliv_1c74ab90e5f2d38607b1aa42';
  var LEGACY_PROOF_CASE_ID = DEMO_DEFAULT;

  var DEMO_TABS = [['phone', '전화 주문'], ['risk', '위험 요청 차단'], ['delivery', '배송 문제']];
  var DEMO_STEP_META = [
    ['전화', 'phone-fill'], ['AI 해석기 해석', 'sparkle'], ['정책 판정', 'verified-check-fill'],
    ['이용자 최종 확인', 'person'], ['판매처 주문', 'inbox']
  ];

  /* -----------------------------------------------------------------------
     심사 기준 네 축. 각 축은 주장 한 줄과 검증값 세 줄, 그리고 확인할 자리를 가리킨다.
     -------------------------------------------------------------------- */
  var JUDGE_AXES = [
    ['ux', 'phone-fill', '혁신성 및 UX', '',
      '전화 접수 경로 하나로 끝나도록 설계했습니다. 앱 설치도, 스마트폰도, 회원가입도 요구하지 않습니다.',
      [['입구', '전화 접수 경로 · 실통화 재검증 필요'], ['이용자 설치물', ''], ['모바일웹', '통화 뒤 선택 사항']],
      '전화 주문 시나리오', 'story:phone'],
    ['ai', 'sparkle', 'AI 활용도', 'AI 해석기 / 운영 인프라 AI',
      'AI 해석기는 말을 구조화된 요청으로 옮기기만 합니다. 허용·차단을 결정할 권한은 갖지 않습니다.',
      [['해석 모델', 'AI 해석기'], ['해석의 권한', '품목 후보 제시까지'], ['허용·차단 결정', '결정형 규칙 엔진']],
      '차단 시나리오', 'story:risk'],
    ['tech', 'certificate', '기술 완성도 및 블록체인·인프라 연동', '',
      '결제 승인 결제 요구와 세션 범위 제한 권한을 거쳐야만 자금이 움직입니다.',
      [['결제 프로토콜', '결제 승인'], ['정산 네트워크', '결제 샌드박스'], ['권한 범위', '단일 사건 · 1회 소진']],
      '기술 증명 레일', 'anchor:rail-legacy'],
    ['live', 'verified-check-fill', '실제 구동 여부', '로컬넷 / 테스트넷 / 데브넷 라이브',
      '데브넷 정산 거래와 실제 공급자 주문 회신을 각각 확인할 수 있습니다. 다만 둘은 같은 사건이 아니며, 전화 접수 경로는 실통화 재검증 필요 상태입니다.',
      [['데브넷 정산', '라이브 · 조회 가능'], ['공급자 주문', '실제 API 회신'], ['두 레일의 사건 번호', '']],
      '검증된 레일 둘', 'anchor:rails']
  ];

  /* -----------------------------------------------------------------------
     시나리오. 근거 카드까지 시나리오마다 따로 둔다.
     차단 시나리오는 카탈로그·최종 확인·결제·판매처 주문이 전부 없는 상태를 그대로 적는다.
     배송 시나리오는 먹거리 사건을 다시 쓰지 않고 별도 합성 사건을 쓴다.
     -------------------------------------------------------------------- */
  var DEMO_SCENES = {
    phone: {
      title: '전화에서 주문 접수까지',
      meta: '합성 시연 · 사건 ' + DEMO_CASE_ID.slice(0, 12) + '…',
      steps: [
        ['done', '전화 접수 경로로 요청이 들어옵니다.', '합성 시연 · 실통화 재검증 필요'],
        ['done', '“잡곡 좀 보내줘”를 잡곡 선물세트 주문으로 정리합니다.', '음성 → 품목 후보'],
        ['done', '식품 항목이고 한도 안이라 허용으로 판정합니다.', '결정형 규칙 · 재현 가능'],
        ['done', '상품·수량·총액을 듣고 1번으로 최종 확인합니다.', '이용자 DTMF 확인'],
        ['idle', '남은 지원금을 다시 확인한 뒤 판매처에 바로 주문하는 경로는 운영 재검증 중입니다.', '실통화 직주문 재검증 필요']
      ],
      sum: {
        req: '잡곡 좀 보내줘', item: '잡곡선물세트 겨울(6종)', amt: '78,500원',
        state: '직접주문 재검증 필요', tone: 'warn', caseId: DEMO_CASE_ID,
        note: '이용자 최종 확인 후 즉시 주문하는 코드 경로는 갖춘 상태이지만, 이 합성 사건은 실제 판매처 주문 완료 증거가 아닙니다.'
      },
      proofs: [
        ['phone-fill', '전화 접수 경로로 시작', '국내 번호로 받은 통화의 음성을 그대로 받도록 설계한 입구입니다. 이용자에게 별도 기기나 앱 설치를 요구하지 않습니다. 이 먹거리 요청의 실통화는 아직 재검증되지 않았습니다.',
          [['수신 경로', '전화 접수 경로'], ['실통화 재검증', '필요'], ['이용자 설치물', '']]],
        ['verified-check-fill', '정책 판정과 이용자 확인', '같은 조건에는 같은 판정이 나오고, 상품·수량·총액을 들은 이용자가 직접 최종 확인합니다.',
          [['판정', '허용 · 식품'], ['최종 확인', 'DTMF 1번'], ['다른 사건 재사용', '']]],
        ['inbox', '최종 확인 후 직접주문', '판매처 상품과 가격, 남은 지원금을 다시 확인하고 같은 조건일 때만 주문합니다.',
          [['판매처', 'SpecialOffer'], ['주문 조건 변경', '재확인 필요'], ['실통화 직주문', '재검증 필요']]]
      ]
    },
    risk: {
      title: '지원 범위 밖 요청이 들어올 때',
      meta: '합성 시연 · 사건 번호 미생성',
      steps: [
        ['done', '지원 범위 밖 품목을 요청하는 통화가 들어옵니다.', '음성 그대로 수신'],
        ['done', '“총기 구입해줘”를 고위험 품목 요청으로 분류합니다.', '음성 → 품목 후보'],
        ['stop', '지원 범위 밖 품목이라 여기서 차단합니다.', '결정형 규칙 · 재현 가능'],
        ['idle', '상품과 총액을 확인하는 단계가 열리지 않습니다.', '이용자 최종 확인 없음'],
        ['idle', '공급자에게 아무것도 전송되지 않습니다.', '주문서 미생성']
      ],
      sum: {
        req: '총기 구입해줘', item: '', amt: '', state: '정책에서 차단', tone: 'no', caseId: '',
        note: '판정 기록만 남습니다. 카탈로그 조회, 최종 확인, 결제, 판매처 주문 어느 것도 만들어지지 않았습니다.'
      },
      proofs: [
        ['search', '카탈로그를 조회하지 않음', '차단은 판매처를 부르기 전에 일어납니다. 검색어로 옮기는 단계에 도달하지 않습니다.',
          [['카탈로그 질의', ''], ['조회된 상품', ''], ['판매처 호출', '']]],
        ['company', '주문 후보를 만들지 않음', '정책에서 차단되어 상품 조회와 주문 실행으로 이어지지 않습니다.',
          [['주문 후보', ''], ['사건 번호', ''], ['판매처 전송', '']]],
        ['coins', '결제와 공급자 주문 미발생', '결제 요구도, 정산 거래도, 공급자 주문번호도 생성되지 않았습니다.',
          [['결제 승인 결제 요구', ''], ['정산 거래', ''], ['공급자 주문번호', '']]]
      ]
    },
    delivery: {
      title: '배송 문제를 전화로 물어볼 때',
      meta: '별도 합성 배송 사건 ' + DEMO_DELIVERY_CASE_ID.slice(0, 12) + '…',
      steps: [
        ['done', '이미 배송이 끝난 별개 사건에 대해 통화가 들어옵니다.', '음성 그대로 수신'],
        ['done', '“백미가 젖어서 왔어”를 배송 문제 신고로 읽습니다.', '음성 → 사건 조회'],
        ['done', '조회·신고 요청이라 허용하고 품목과 금액은 바꾸지 않습니다.', '결정형 규칙 · 재현 가능'],
        ['done', '담당자에게 파손 확인 업무가 열립니다.', '후속 조치 · 재배송 검토'],
        ['idle', '재배송 주문은 담당자 확인 전까지 만들지 않습니다.', '아직 전송하지 않음']
      ],
      sum: {
        req: '백미가 젖어서 왔어', item: '백미 10kg 1포', amt: '32,900원',
        state: '파손 확인 대기', tone: 'warn', caseId: DEMO_DELIVERY_CASE_ID,
        note: '이 사건은 위 전화 주문 시나리오와 다른 사건입니다. 증빙 이미지도 별도 합성 자료입니다.'
      },
      proofs: [
        ['image', '별도 합성 배송 자료', '아래 도해는 배송 시나리오 전용 합성 자료입니다. 실제 이용자 사진도, 위 전화 먹거리 사건의 자료도 아닙니다.',
          [['자료 성격', '합성 도해'], ['실제 이용자 사진', ''], ['전화 주문 사건 재사용', '']]],
        ['change', '택배 완료와 수령 확인은 다른 상태', '택배사가 완료로 표시해도 이용자 수령 확인은 별개로 남습니다. 두 값을 하나로 합치지 않습니다.',
          [['택배사 상태', '배송 완료'], ['이용자 수령 확인', '문제 신고'], ['두 값 병합', '']]],
        ['refresh', '후속 조치는 사람이 연다', '재배송·환불은 담당자가 증빙을 확인한 뒤에 시작합니다. 자동으로 새 주문을 만들지 않습니다.',
          [['자동 재주문', ''], ['담당자 확인', '대기'], ['새 결제 요구', '']]]
      ]
    }
  };

  /* 배송 탭의 이미지는 /api/delivery-evidence/demo가 내려 준 합성 시연 자료만 쓴다. */
  function demoShots() {
    var fallback = [
      { issueType: 'RECEIVED_OK', imageUrl: '/assets/delivery-evidence/synthetic-received-ok.webp' },
      { issueType: 'DAMAGED', imageUrl: '/assets/delivery-evidence/synthetic-damaged-rice.webp' },
      { issueType: 'WRONG_ITEM', imageUrl: '/assets/delivery-evidence/synthetic-wrong-item.webp' }
    ];
    if (SYNTH.loading) {
      return '<div class="row gap-12" role="status" aria-busy="true"><div class="spinner" aria-hidden="true"></div>' +
        '<p class="t-body2">합성 시연 이미지를 불러오는 중입니다.</p></div>';
    }
    var items = SYNTH.items.length ? SYNTH.items : fallback;
    return '<div class="judge-shots">' + items.slice(0, 3).map(function (item) {
      var label = ISSUE_LABEL[item.issueType] || item.issueType || '배송 상태';
      return '<figure class="judge-shot">' +
        '<img class="judge-shot__img" src="' + esc(item.imageUrl) + '" alt="합성 시연 도해 · ' + esc(label) + '" loading="lazy">' +
        '<figcaption class="judge-shot__cap">' + esc(label) + ' · 합성 시연</figcaption></figure>';
    }).join('') + '</div>';
  }

  async function loadDemoCase(caseId, blocked) {
    var valueKey = blocked ? 'demoBlocked' : 'demo';
    var errorKey = valueKey + 'Error';
    var loadingKey = valueKey + 'Loading';
    var requestedKey = valueKey + 'RequestedId';
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(caseId || '')) { LIVE[errorKey] = '사례 번호 형식을 확인해 주세요.'; render(); return; }
    LIVE[requestedKey] = caseId; LIVE[loadingKey] = true; LIVE[errorKey] = ''; render();
    try {
      var values = await Promise.all([
        apiJson('/api/cases/' + encodeURIComponent(caseId) + '?technical=1'),
        apiJson('/api/cases/' + encodeURIComponent(caseId) + '/events')
      ]);
      LIVE[valueKey] = { caseValue: values[0], events: values[1] }; LIVE[errorKey] = '';
    } catch (error) {
      LIVE[valueKey] = null;
      LIVE[errorKey] = error.status === 404 ? '해당 사례를 찾지 못했습니다.'
        : error.status === 401 ? '이 사례는 공개 증거 목록에 없어 감사 권한이 필요합니다.'
          : '사례 기록을 불러오지 못했습니다.';
    }
    LIVE[loadingKey] = false; render();
  }

  /* 단계는 실제 사건 이벤트에서만 만든다. 이벤트가 없으면 "기록 없음"이다. */
  function demoSteps(bundle) {
    var value = bundle.caseValue || {};
    var events = Array.isArray(bundle.events) ? bundle.events : [];
    var proof = value.technicalProof || {};
    var byState = {};
    events.forEach(function (event) { if (!byState[event.state]) byState[event.state] = event; });
    function at(state) { return byState[state] ? shortTime(byState[state].at) : ''; }
    function has(state) { return Boolean(byState[state]); }
    var isPhone = Boolean(byState.CALL_CONNECTED || byState.AUDIO_CAPTURED);
    var steps = [];

    steps.push({
      state: has('CALL_CONNECTED') || has('INTERPRETED') ? 'done' : 'stopped',
      owner: isPhone ? '전화' : '모바일 웹',
      title: '요청 접수',
      time: at('CALL_CONNECTED') || at('AUDIO_CAPTURED'),
      desc: isPhone
        ? '전화 접수 경로(' + SUPPORT_PHONE + ')로 기록된 사건입니다. 이 먹거리 요청의 실통화는 재검증이 필요합니다.'
        : '이용자 모바일웹에서 직접 접수했습니다. 전화 경로와 독립된 입구입니다.',
      evidence: evidence([['caseId', value.caseId], ['event', has('CALL_CONNECTED') ? 'CALL_CONNECTED' : has('AUDIO_CAPTURED') ? 'AUDIO_CAPTURED' : '']], '증적 보기')
    });

    steps.push({
      state: has('INTERPRETED') ? 'done' : 'stopped',
      owner: '해석 엔진', title: '말을 구조화된 요청으로',
      time: at('INTERPRETED'),
      desc: value.productName ? '확인 문장 · ' + esc(value.productName) : '구조화된 품목 후보를 만들었습니다.',
      evidence: evidence([['event', has('INTERPRETED') ? 'INTERPRETED' : ''], ['policy authority', 'false — 해석은 허용 권한을 갖지 않음']], '증적 보기')
    });

    var blocked = has('POLICY_BLOCKED');
    steps.push({
      state: blocked ? 'blocked' : has('POLICY_CHECKING') ? 'done' : 'stopped',
      owner: '정책 엔진', title: '결정형 정책 판정',
      time: at('POLICY_BLOCKED') || at('POLICY_CHECKING'),
      desc: blocked
        ? '지원 기준 밖 품목으로 판정해 여기서 차단했습니다.'
        : '기관 자체 지원 품목 기준을 통과했습니다.',
      evidence: evidence([
        ['policy snapshot', proof.policySnapshotHash],
        ['failed rules', (events.filter(function (e) { return e.failedPolicyRules; })[0] || {}).failedPolicyRules ?
          (events.filter(function (e) { return e.failedPolicyRules; })[0].failedPolicyRules || []).join(', ') : '']
      ], '증적 보기')
    });

    if (blocked) {
      steps.push({
        state: 'stopped', owner: '—', title: '여기서 끝났습니다', time: '',
        desc: '카탈로그를 조회하지 않았고, 결제 요구가 만들어지지 않았으며, 공급사 주문번호도 생성되지 않았습니다.',
        evidence: evidence([['catalog query', ''], ['settlement transaction', ''], ['supplier order id', '']], '생성되지 않은 식별자')
      });
      return steps;
    }

    steps.push({
      state: has('CONFIRMED') ? 'done' : 'stopped',
      owner: '이용자', title: '읽어 준 내용에 확인',
      time: at('CONFIRMED'),
      desc: isPhone
        ? '품목·수량·배송비·합계를 다시 듣고 버튼 하나로 확정했습니다. 이 확정은 결제가 아닙니다.'
        : '가려진 미리보기를 보고 확정했습니다. 이 확정은 결제가 아닙니다.',
      evidence: evidence([['consent commitment', proof.confirmationCommitment], ['event', has('CONFIRMED') ? 'CONFIRMED' : '']], '증적 보기')
    });

    steps.push({
      state: has('PAYMENT_REQUIRED') || has('PAID') ? 'done' : 'stopped',
      owner: '기관', title: '제한 권한 결제 요구',
      time: at('PAYMENT_REQUIRED'),
      desc: '사건에 결박된 결제 승인으로만 다음 단계가 열립니다. 해석 엔진에는 이 권한이 없습니다.',
      evidence: evidence([
        ['결제 승인 ID', proof.paymentAuthorizationId],
        ['승인 금액', proof.authorizedAmountKrw == null ? '' : formatWon(proof.authorizedAmountKrw)],
        ['정책 snapshot', proof.policySnapshotHash]
      ], '증적 보기')
    });

    steps.push({
      state: proof.paymentReference ? 'done' : 'stopped',
      owner: '샌드박스', title: '결제 기록',
      time: at('PAID'),
      desc: proof.paymentReference
        ? '합성 데이터로 만든 결제 기록입니다. 실제 자금이 아닙니다.'
        : '결제 기록이 생성되지 않았습니다.',
      evidence: evidence([
        ['결제 참조', proof.paymentReference],
        ['안내', proof.disclaimer]
      ], '증적 보기')
    });

    steps.push({
      state: value.providerOrderId ? 'done' : 'stopped',
      owner: '공급사', title: '주문번호 생성',
      time: at('ORDERED'),
      desc: value.providerOrderId
        ? (value.sandbox
          ? '자체 샌드박스 주문번호만 생성됐습니다. 실제 식품 공급자 주문은 이 사건에 속하지 않습니다.'
          : '공급사에 접수된 주문번호가 있습니다.')
        : '이 사건에서는 주문번호가 생성되지 않았습니다.',
      evidence: evidence([
        ['자체 샌드박스 주문번호', value.sandbox ? value.providerOrderId : ''],
        ['실제 식품 공급자 주문번호', value.sandbox ? '' : value.providerOrderId],
        ['sandbox', value.sandbox ? 'true' : '']
      ], '증적 보기')
    });

    steps.push({
      state: 'stopped', owner: '이용자', title: '배송 완료와 수령 확인',
      time: '',
      desc: '택배사 배송 완료와 이용자 수령 확인은 같은 사건이 아닙니다. 이 사례에는 아직 수령 확인 기록이 없습니다.',
      evidence: evidence([['carrier', ''], ['tracking number', ''], ['recipient confirmed at', '']], '생성되지 않은 식별자')
    });

    return steps;
  }

  /* -----------------------------------------------------------------------
     레일 하나 — 실제 공급자 주문 회신. 대기·연결 없음·다시 시도를 모두 화면에 드러낸다.
     -------------------------------------------------------------------- */
  function railSupplier() {
    var body;
    if (LIVE.foodOrderLoading || (!LIVE.foodOrderRequested && !LIVE.foodOrder)) {
      body = '<div class="rail-state" role="status" aria-busy="true">' +
        '<span class="spinner" aria-hidden="true"></span>' +
        '<p class="rail-state__t">공급자에 접수된 주문을 조회하는 중입니다.</p>' +
        '<p class="rail-state__d">응답이 오기 전까지는 어떤 값도 채우지 않습니다.</p></div>';
    } else if (LIVE.foodOrderError) {
      body = '<div class="rail-state rail-state--off" role="alert">' +
        '<span class="rail-state__ico">' + ico('circle-exclamation-fill') + '</span>' +
        '<p class="rail-state__t">' + esc(LIVE.foodOrderError) + '</p>' +
        (LIVE.foodOrderStatus
          ? '<p class="rail-state__code"><span class="sr-only">공급자 응답 코드 </span>' + esc(LIVE.foodOrderStatus) + '</p>'
          : '') +
        '<p class="rail-state__d">저장된 예시로 대신 채우지 않습니다.</p>' +
        '<button type="button" class="btn btn--outlined-assistive btn--sm" data-act="retry-food-order">' +
        ico('refresh') + '다시 조회</button></div>';
    } else {
      /* 공급자 API가 회신한 아홉 개 필드만 쓴다. 없는 값은 비워 두고 지어내지 않는다. */
      var o = LIVE.foodOrder || {};
      var state = DELIVERY_STATE_LABEL[o.deliveryState];
      body = '<dl class="rail-dl">' +
        railRow('주문 ID', o.externalOrderId, 'rail-mono') +
        railRow('주문번호', o.externalOrderNo, 'rail-mono') +
        railRow('품목', o.goodsName) +
        railRow('수량', typeof o.quantity === 'number' && Number.isFinite(o.quantity)
          ? o.quantity.toLocaleString('ko-KR') + '개' : null) +
        railRow('결제 금액', typeof o.totalPriceKrw === 'number' && Number.isFinite(o.totalPriceKrw)
          ? o.totalPriceKrw.toLocaleString('ko-KR') + '원' : null, 'rail-amt') +
        '<div class="rail-row"><dt>배송 상태</dt><dd>' +
        (o.deliveryState == null || o.deliveryState === ''
          ? '<span class="judge-none">확인 필요</span>'
          : badge(state ? state[1] : 'neutral', state ? state[0] : '확인 필요') +
            '<span class="rail-code">' + esc(String(o.deliveryState)) + '</span>') +
        '</dd></div>' +
        '<div class="rail-row"><dt>송장 추적</dt><dd>' +
        (typeof o.hasTracking !== 'boolean'
          ? '<span class="judge-none">확인 필요</span>'
          : o.hasTracking
            ? badge('info', '가능')
            : '<span class="rail-off">' + ico('circle-block', 'ico--sm') + '없음' +
              '<span class="rail-code">hasTracking=false</span></span>') +
        '</dd></div>' +
        railRow('회신 출처', o.source, 'rail-mono') +
        railRow('회신 시각', seoulStamp(o.refreshedAt), 'rail-mono') +
        '</dl>' +
        '<p class="rail-note">' + ico('circle-info-fill') +
        '<span>공급자 주문 API가 회신한 아홉 개 값만 그대로 옮겨 적었습니다. 결제·정산 증명은 이 레일에 포함되지 않습니다.</span></p>' +
        '<button type="button" class="btn btn--outlined-assistive btn--sm" data-act="retry-food-order">' +
        ico('refresh') + '다시 조회</button>';
    }
    return '<article class="rail" id="rail-supplier">' +
      '<header class="rail__hd"><span class="rail__ico rail__ico--live">' + ico('inbox') + '</span>' +
      '<div><p class="rail__k">레일 하나</p><h3 class="rail__t">실제 공급자 주문 회신</h3></div>' +
      (LIVE.foodOrder ? badge('ok', 'API 회신 있음')
        : LIVE.foodOrderError ? badge('no', '연결 없음') : badge('neutral', '조회 중')) + '</header>' +
      '<p class="rail__d">공급자 주문 API를 그대로 다시 읽습니다. 사건 번호가 아니라 공급자 주문번호로만 식별됩니다.</p>' +
      '<div class="rail__body">' + body + '</div></article>';
  }

  /* 값이 없을 때만 "생성되지 않음"이다. 0이나 false를 없는 값으로 접지 않는다. */
  function railRow(label, value, cls, emptyText) {
    var empty = value == null || value === '';
    return '<div class="rail-row"><dt>' + label + '</dt><dd class="' + (cls || '') + '">' +
      (empty ? '<span class="judge-none">' + (emptyText || '생성되지 않음') + '</span>' : esc(String(value))) + '</dd></div>';
  }

  /* 공급자가 회신한 배송 상태 코드 → 한국어 표기. 모르는 코드는 임의로 번역하지 않는다. */
  var DELIVERY_STATE_LABEL = {
    PREPARING: ['상품 준비 중', 'neutral'],
    READY: ['출고 준비 완료', 'neutral'],
    SHIPPING: ['배송 중', 'info'],
    SHIPPED: ['공급자 발송 완료', 'info'],
    DELIVERED: ['배송 완료', 'info'],
    CANCELED: ['주문 취소', 'no'],
    FAILED: ['주문 실패', 'no']
  };

  /* 결제 승인Amount는 샌드박스 테스트 금액의 base unit(소수점 여섯 자리) 정수 문자열이다.
     사람이 읽는 금액으로 옮기되 원값을 지우지 않고 함께 남긴다. */
  function moneyBaseUnits(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!/^\d+$/.test(text)) return null;
    var padded = text.padStart(7, '0');
    var human = padded.slice(0, -6) + '.' + padded.slice(-6);
    return human + ' 샌드박스 테스트 금액 · raw ' + text;
  }

  /* epoch 밀리초를 한국 시간 표기로. 숫자가 아니면 값이 없는 것으로 둔다. */
  function seoulStamp(ms) {
    var n = Number(ms);
    if (ms == null || ms === '' || !Number.isFinite(n)) return null;
    var d = new Date(n);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(d).replace(/\s+/g, ' ').trim() + ' KST';
    } catch (error) { return d.toISOString(); }
  }

  /* -----------------------------------------------------------------------
     레일 둘 — 과거 기술 검증. 위 공급자 주문과 사건 번호를 공유하지 않는다.
     -------------------------------------------------------------------- */
  function railLegacy() {
    var body;
    if (LIVE.demoLoading || (!LIVE.demoRequestedId && !LIVE.demo)) {
      body = '<div class="rail-state" role="status" aria-busy="true">' +
        '<span class="spinner" aria-hidden="true"></span>' +
        '<p class="rail-state__t">사례 기록을 불러오는 중입니다.</p></div>';
    } else if (LIVE.demoError || !LIVE.demo) {
      body = '<div class="rail-state rail-state--off" role="alert">' +
        '<span class="rail-state__ico">' + ico('circle-exclamation-fill') + '</span>' +
        '<p class="rail-state__t">' + esc(LIVE.demoError || '사례 기록을 불러오지 못했습니다.') + '</p>' +
        '<button type="button" class="btn btn--outlined-assistive btn--sm" data-act="retry-legacy-proof">' +
        ico('refresh') + '다시 조회</button></div>';
    } else {
      var value = LIVE.demo.caseValue || {};
      var proof = value.technicalProof || {};
      body = '<dl class="rail-dl">' +
        railRow('사건 번호', value.caseId, 'rail-mono') +
        railRow('결제 승인 ID', proof.paymentAuthorizationId, 'rail-mono') +
        railRow('승인 금액', proof.authorizedAmountKrw == null ? '' : formatWon(proof.authorizedAmountKrw)) +
        railRow('결제 참조', proof.paymentReference, 'rail-mono') +
        railRow('자체 샌드박스 주문번호', value.providerOrderId, 'rail-mono') +
        railRow('sandbox', value.sandbox === true ? 'true' : value.sandbox === false ? 'false' : null, 'rail-mono') +
        '</dl>' +
        '<p class="rail-note">' + ico('circle-info-fill') + '<span>' + esc(proof.disclaimer || '합성 데이터로 실행한 샌드박스이며 실제 자금이 아닙니다.') + '</span></p>' +
        '<details class="disc disc--inline"><summary>이 사건의 전체 단계 보기' + ico('chevron-down') + '</summary>' +
        '<div class="disc__body">' + spine(demoSteps(LIVE.demo)) + '</div></details>';
    }
    return '<article class="rail" id="rail-legacy">' +
      '<header class="rail__hd"><span class="rail__ico rail__ico--chain">' + ico('certificate') + '</span>' +
      '<div><p class="rail__k">레일 둘</p><h3 class="rail__t">기술 증명 · 결제 샌드박스 · 결제 승인</h3></div>' +
      badge('outline', '샌드박스') + '</header>' +
      '<p class="rail__d">제한 권한 결제와 정산 기록이 실제로 남는지 확인한 과거 사건입니다. 주문번호는 자체 샌드박스 번호이며, 위 실제 공급자 주문과 이어진 사건이 아닙니다.</p>' +
      '<div class="rail__body">' + body + '</div></article>';
  }

  /* -----------------------------------------------------------------------
     AI 해석기·가드레일 실측. 심사위원이 버튼을 눌렀을 때만 호출한다.
     화면을 여는 것만으로는 어떤 요청도 나가지 않는다.

     저장하는 값은 아래 열거한 ai.* 필드와 requestedCategories뿐이다.
     응답 본문의 caseId·sessionId·세션 토큰은 보관하지 않으며, 이용자 주문
     상태(ORDER·LIVE.interpretation·sessionStorage)에도 손대지 않는다.
     -------------------------------------------------------------------- */
  var AI_PROBES = [
    { key: 'allow', text: '무슨 잡곡을 살 수 있어?', title: '지원 범위 안 질문', expect: 'CONFIGURED_AI_PROVIDER' },
    { key: 'block', text: '총기 구입해줘', title: '지원 범위 밖 요청', expect: 'SKIPPED_POLICY_BOUNDARY · FIREARM' }
  ];
  function emptyAiSlot() { return { caseId: '', values: null, error: '', code: '' }; }
  var AI_PROOF = { requested: false, loading: false, allow: emptyAiSlot(), block: emptyAiSlot() };

  /* 요청마다 새 web_ 사건 번호를 만든다. 이용자 주문 세션의 사건 번호는 건드리지 않는다. */
  var aiProbeSeq = 0;
  function freshWebCaseId() {
    aiProbeSeq += 1;
    return 'web_' + Date.now().toString(36) + aiProbeSeq.toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  async function runAiProof() {
    if (AI_PROOF.loading) return;
    AI_PROOF.requested = true;
    AI_PROOF.loading = true;
    AI_PROBES.forEach(function (probe) {
      AI_PROOF[probe.key] = emptyAiSlot();
      AI_PROOF[probe.key].caseId = freshWebCaseId();
    });
    render();
    say('AI 해석기 해석과 정책 경계를 실측하는 중입니다.');

    await Promise.all(AI_PROBES.map(function (probe) {
      var slot = AI_PROOF[probe.key];
      return apiJson('/api/food-support/interpret', {
        method: 'POST',
        body: JSON.stringify({ caseId: slot.caseId, text: probe.text })
      }).then(function (body) {
        var g = (body && body.interpretation) || {};
        var metadata = g.providerMetadata || {};
        /* 회신 본문에서 아래 값만 옮겨 담는다. 나머지는 보관하지 않는다. */
        slot.values = probe.key === 'allow'
          ? {
            engine: g.engine, modelVersion: metadata.modelId, responseId: metadata.responseId,
            normalizedQuery: g.normalizedQuery, needsClarification: g.needsClarification,
            policyAuthority: g.policyAuthority, inputHash: g.inputHash
          }
          : {
            engine: g.engine,
            requestedCategories: Array.isArray(body && body.requestedCategories)
              ? body.requestedCategories.map(String) : null
          };
      }).catch(function (error) {
        slot.values = null;
        /* 이 경계는 코드를 error에 담기도 하고 status에 담기도 한다. 코드 모양인 쪽을 쓴다. */
        slot.code = [error.body && error.body.error, error.body && error.body.status]
          .filter(function (raw) { return /^[A-Z0-9_]{3,64}$/.test(String(raw || '')); })[0] || '';
        slot.error = error.status === 503
          ? '이 배포에는 해석 경계의 자격 증명이 연결되어 있지 않습니다.'
          : error.status === 404
            ? '이 배포에는 해석 경로가 열려 있지 않습니다.'
            : '해석 요청이 실패했습니다.';
      });
    }));

    AI_PROOF.loading = false;
    render();
    var failed = AI_PROBES.filter(function (p) { return AI_PROOF[p.key].error; }).length;
    say(failed ? '실측 요청 ' + failed + '건이 실패했습니다. 값을 채우지 않고 실패로 남겼습니다.' : '두 요청의 회신값을 그대로 적었습니다.', Boolean(failed));
    var again = $('#ai-run');
    if (again) again.focus({ preventScroll: true });
  }

  /* 불리언은 true/false 그대로 적는다. 값이 없으면 지어내지 않는다. */
  function aiFlag(value) {
    return typeof value === 'boolean' ? String(value) : null;
  }

  function aiSlotBody(probe) {
    var slot = AI_PROOF[probe.key];
    if (AI_PROOF.loading) {
      return '<div class="rail-state" role="status" aria-busy="true">' +
        '<span class="spinner" aria-hidden="true"></span>' +
        '<p class="rail-state__t">회신을 기다리는 중입니다.</p>' +
        '<p class="rail-state__d">응답이 오기 전까지는 어떤 값도 채우지 않습니다.</p></div>';
    }
    if (slot.error) {
      return '<div class="rail-state rail-state--off">' +
        '<span class="rail-state__ico">' + ico('circle-exclamation-fill') + '</span>' +
        '<p class="rail-state__t">' + esc(slot.error) + '</p>' +
        (slot.code ? '<p class="rail-state__code"><span class="sr-only">응답 코드 </span>' + esc(slot.code) + '</p>' : '') +
        '<p class="rail-state__d">기대하던 값으로 대신 채우지 않습니다.</p>' +
        '<button type="button" class="btn btn--outlined-assistive btn--sm" data-act="run-ai-proof">' +
        ico('refresh') + '두 요청 다시 실측</button></div>';
    }
    var v = slot.values || {};
    if (probe.key === 'allow') {
      return '<dl class="rail-dl">' +
        railRow('ai.engine', v.engine, 'rail-mono') +
        railRow('ai.modelVersion', v.modelVersion, 'rail-mono') +
        railRow('ai.responseId', v.responseId, 'rail-mono') +
        railRow('ai.normalizedQuery', v.normalizedQuery) +
        railRow('ai.needsClarification', aiFlag(v.needsClarification), 'rail-mono') +
        railRow('ai.policyAuthority', aiFlag(v.policyAuthority), 'rail-mono') +
        railRow('ai.inputHash', v.inputHash, 'rail-mono') +
        '</dl>';
    }
    var cats = v.requestedCategories;
    return '<dl class="rail-dl">' +
      railRow('ai.engine', v.engine, 'rail-mono') +
      railRow('requestedCategories', Array.isArray(cats) ? (cats.length ? cats.join(' · ') : '빈 배열') : null, 'rail-mono') +
      '</dl>';
  }

  function aiSlotBadge(probe) {
    var slot = AI_PROOF[probe.key];
    if (AI_PROOF.loading) return badge('neutral', '조회 중');
    if (slot.error) return badge('no', '실측 실패');
    if (!slot.values) return badge('neutral', '실행 전');
    var v = slot.values;
    var ok = probe.key === 'allow'
      ? v.engine === 'CONFIGURED_AI_PROVIDER'
      : v.engine === 'SKIPPED_POLICY_BOUNDARY' && Array.isArray(v.requestedCategories) && v.requestedCategories.indexOf('FIREARM') >= 0;
    return ok ? badge('ok', '기대 패턴과 일치') : badge('warn', '회신값 그대로');
  }

  function aiProof() {
    var idle = !AI_PROOF.requested;
    var cards = AI_PROBES.map(function (probe) {
      var slot = AI_PROOF[probe.key];
      return '<article class="rail rail--probe">' +
        '<header class="rail__hd"><span class="rail__ico rail__ico--ai">' + ico('sparkle') + '</span>' +
        '<div><p class="rail__k">' + esc(probe.title) + '</p>' +
        '<h3 class="rail__t">“' + esc(probe.text) + '”</h3></div>' +
        aiSlotBadge(probe) + '</header>' +
        '<div class="rail__body">' +
        (idle
          ? '<div class="rail-state rail-state--idle">' +
            '<p class="rail-state__t">아직 호출하지 않았습니다.</p>' +
            '<p class="rail-state__d">위 버튼을 눌러야 요청이 나갑니다. 화면을 여는 것만으로는 호출하지 않습니다.</p>' +
            '<p class="rail-state__d">확인하려는 패턴 · <code>' + esc(probe.expect) + '</code></p></div>'
          : '<p class="probe-case"><span>이번 요청 사건 번호</span><code>' +
            esc(slot.caseId) + '</code></p>' + aiSlotBody(probe)) +
        '</div></article>';
    }).join('');

    return '<section class="ai-sec" id="ai-proof" aria-labelledby="ai-title">' +
      '<div class="sec-hd"><h2 class="sec-hd__t" id="ai-title">기준 2 실측 · AI 해석기와 정책 경계</h2>' +
      '<p class="sec-hd__d">버튼을 누르면 서로 다른 새 사건 번호로 두 번 요청합니다. ' +
      '회신에서 아래 값만 그대로 옮겨 적고, 실패하면 실패로 남깁니다.</p></div>' +
      '<div class="ai-run">' +
      '<button type="button" class="btn btn--solid-primary btn--md" id="ai-run" data-act="run-ai-proof"' +
      (AI_PROOF.loading ? ' disabled aria-busy="true"' : '') + '>' +
      ico(AI_PROOF.loading ? 'refresh' : 'sparkle') +
      (AI_PROOF.loading ? '실측하는 중' : AI_PROOF.requested ? 'AI 해석기·가드레일 실측 · 다시 실행' : 'AI 해석기·가드레일 실측') + '</button>' +
      '<p class="ai-run__d">POST /api/food-support/interpret · 요청 두 건 · 각각 새 web_ 사건 번호</p>' +
      '</div>' +
      '<div class="rails" role="status" aria-live="polite" aria-atomic="false">' + cards + '</div>' +
      '<p class="rails__split">' + ico('circle-info-fill') +
      '<span>이 실측은 해석 엔진의 회신값만 확인합니다. 결제·공급자 주문과는 다른 경계이며, 여기서 만든 사건 번호는 이용자 주문 세션과 무관합니다.</span></p>' +
      '</section>';
  }

  /* 아직 이어지지 않은 이음매를 그대로 그린다. 완성됐다고 말하지 않는다. */
  var GAP_CHAIN = [
    ['recheck', 'phone-fill', '전화 접수 경로'],
    ['done', 'sparkle', 'AI 해석기 해석'],
    ['done', 'verified-check-fill', '결정형 정책'],
    ['seam', 'coins', '제한 권한 결제'],
    ['seam', 'inbox', '실제 공급자 주문']
  ];

  function judgeGap() {
    return '<section class="judge-gap" aria-labelledby="gap-title">' +
      '<div class="judge-gap__hd">' +
      '<p class="eyebrow eyebrow--warn">지금 비어 있는 것</p>' +
      '<h2 class="judge-gap__t" id="gap-title">사건 번호 하나로 다섯 단계를 관통한 기록은 아직 없습니다.</h2>' +
      '<p class="judge-gap__d">전화 접수 경로 → AI 해석기 해석 → 결정형 정책 → 제한 권한 결제 → 실제 공급자 주문을 <strong>같은 caseId 하나로</strong> 이어 붙인 사건은 아직 만들어지지 않았습니다. ' +
      '먹거리 요청의 <strong>전화 접수 경로는 실통화 재검증 필요</strong> 상태이고, AI 해석기 해석과 결정형 정책은 각각 따로 실측할 수 있습니다. ' +
      '제한 권한 결제와 실제 공급자 주문은 여전히 서로 다른 두 레일로만 확인됩니다. 한 사건짜리 사슬은 아직 완결되지 않았습니다.</p></div>' +
      '<ol class="gapchain">' + GAP_CHAIN.map(function (g, i) {
        return '<li class="gapchain__i" data-state="' + g[0] + '">' +
          '<span class="gapchain__ico">' + ico(g[1]) + '</span>' +
          '<span class="gapchain__n">' + g[2] + '</span>' +
          (g[0] === 'recheck' ? '<span class="gapchain__seam gapchain__seam--recheck">재검증</span>' : '') +
          (i === 2 ? '<span class="gapchain__seam">이음매</span>' : '') + '</li>';
      }).join('') + '</ol>' +
      '<div class="judge-gap__legend">' +
      '<span><i class="dotmark dotmark--recheck"></i>열린 이음매 · 실통화 재검증 필요</span>' +
      '<span><i class="dotmark dotmark--done"></i>독립적으로 실측 가능</span>' +
      '<span><i class="dotmark dotmark--seam"></i>별도 레일로만 확인 · 같은 사건 아님</span>' +
      '</div></section>';
  }

  function viewDemo(st) {
    var key = DEMO_SCENES[st.s] ? st.s : (DEMO_SCENES[DEMO.story] ? DEMO.story : 'phone');
    var scene = DEMO_SCENES[key];
    var sum = scene.sum;

    var tabs = DEMO_TABS.map(function (t) {
      var on = t[0] === key;
      return '<button type="button" class="judge-tab" role="tab" id="judge-tab-' + t[0] + '"' +
        ' aria-controls="judge-panel" aria-selected="' + on + '" data-demo-story="' + t[0] + '">' + t[1] + '</button>';
    }).join('');

    var steps = '<ol class="judge-steps">' + scene.steps.map(function (s, i) {
      return '<li class="judge-step" data-state="' + s[0] + '">' +
        '<span class="judge-step__ico">' + ico(DEMO_STEP_META[i][1]) + '</span>' +
        '<p class="judge-step__name">' + DEMO_STEP_META[i][0] + '</p>' +
        '<p class="judge-step__desc">' + s[1] + '</p>' +
        '<p class="judge-step__note">' + s[2] + '</p></li>';
    }).join('') + '</ol>';

    function sumRow(label, value, cls) {
      return '<div class="judge-row"><dt>' + label + '</dt>' +
        '<dd class="' + (cls || '') + '">' + (value ? esc(value) : '<span class="judge-none">생성되지 않음</span>') + '</dd></div>';
    }

    var summary = '<aside class="judge-sum" aria-label="결과 요약">' +
      '<div class="judge-sum__hd"><h3 class="t-heading2 w-bold">결과 요약</h3>' + badge('neutral', '합성 시연') + '</div>' +
      '<dl class="judge-dl">' +
      sumRow('요청', sum.req) +
      sumRow('품목', sum.item) +
      sumRow('금액', sum.amt, 'judge-amt') +
      '<div class="judge-row"><dt>상태</dt><dd>' + badge(sum.tone, sum.state) + '</dd></div>' +
      sumRow('사건 번호', sum.caseId, 'judge-mono') +
      '</dl>' +
      '<p class="judge-sum__note">' + ico('circle-info-fill') + '<span>' + scene.sum.note + '</span></p>' +
      '</aside>';

    var proofs = '<div class="judge-cards">' + scene.proofs.map(function (p) {
      return '<article class="judge-card">' +
        '<span class="judge-card__ico">' + ico(p[0]) + '</span>' +
        '<h3 class="t-heading2 w-bold">' + p[1] + '</h3>' +
        '<p class="judge-card__d">' + p[2] + '</p>' +
        evidence(p[3], '검증값 보기') + '</article>';
    }).join('') + '</div>';

    var axes = '<ol class="axes">' + JUDGE_AXES.map(function (a, i) {
      var target = a[7].indexOf('story:') === 0
        ? '<button type="button" class="axis__go" data-demo-story="' + a[7].slice(6) + '">' + a[6] + ico('arrow-right') + '</button>'
        : '<a class="axis__go" href="#' + a[7].slice(7) + '">' + a[6] + ico('arrow-right') + '</a>';
      return '<li class="axis">' +
        '<p class="axis__n">기준 ' + (i + 1) + '</p>' +
        '<span class="axis__ico">' + ico(a[1]) + '</span>' +
        '<h3 class="axis__t">' + a[2] + (a[3] ? '<span class="axis__sub">' + a[3] + '</span>' : '') + '</h3>' +
        '<p class="axis__c">' + a[4] + '</p>' +
        '<dl class="axis__facts">' + a[5].map(function (f) {
          return '<div><dt>' + f[0] + '</dt><dd>' + (f[1] ? esc(f[1]) : '<span class="judge-none">아니오</span>') + '</dd></div>';
        }).join('') + '</dl>' + target + '</li>';
    }).join('') + '</ol>';

    /* 첫 화면에서 곧바로 읽히는 것: 무엇이 실측이고, 그 둘이 서로 다른 사건이라는 사실. */
    var heroProof = '<aside class="heroproof" aria-label="지금 확인 가능한 실측값">' +
      '<p class="heroproof__k">지금 이 화면에서 확인되는 회신값</p>' +
      '<ul class="heroproof__l">' +
      '<li><span class="heroproof__ico heroproof__ico--live">' + ico('inbox') + '</span>' +
      '<span class="heroproof__n">실제 공급자 주문 회신</span>' +
      (LIVE.foodOrder ? badge('ok', 'API 회신 있음')
        : LIVE.foodOrderError ? badge('no', '연결 없음') : badge('neutral', '조회 중')) + '</li>' +
      '<li><span class="heroproof__ico heroproof__ico--chain">' + ico('certificate') + '</span>' +
      '<span class="heroproof__n">샌드박스 정산 · 결제 승인 증명</span>' +
      (LIVE.demo ? badge('outline', '샌드박스')
        : LIVE.demoError ? badge('no', '연결 없음') : badge('neutral', '조회 중')) + '</li>' +
      '<li><span class="heroproof__ico heroproof__ico--seam">' + ico('phone-fill') + '</span>' +
      '<span class="heroproof__n">전화 접수 경로</span>' + badge('warn', '실통화 재검증 필요') + '</li>' +
      '</ul>' +
      '<p class="heroproof__d">' + ico('circle-info-fill') +
      '<span>두 회신값은 <strong>서로 다른 사건</strong>이며, 배포에 연결된 경계가 무엇인지는 각 레일의 회신 출처로 확인합니다. 나머지 화면은 합성 시연이며, 전화 접수 경로는 실통화 재검증 필요 상태입니다.</span></p>' +
      '<a class="heroproof__go" href="#rails">검증된 레일 둘 보기' + ico('arrow-right') + '</a></aside>';

    return '<div class="judge-hero">' +
      '<div class="judge-hero__main">' +
      '<p class="eyebrow">전화 기반 먹거리 지원 주문</p>' +
      '<h1 class="judge__title">전화 한 통을 지원 가능한 식품 주문으로 바꾸는 흐름입니다.</h1>' +
      '<p class="judge__lede">거동이 어려운 이용자가 전화로 요청하면, AI 해석기가 뜻을 해석하고 결정형 정책이 품목과 남은 지원금을 확인한 뒤 이용자의 최종 확인으로 판매처 주문을 실행하도록 설계한 흐름입니다. 한 사건이 이 흐름을 끝까지 통과한 실측 기록은 아직 재검증 중입니다.</p>' +
      '<div class="scopebar">' + ico('triangle-exclamation-fill') +
      '<div><p class="scopebar__t">정부 농식품바우처 공식 연동 아님 · 기관/재단/기업 자체 지원예산</p>' +
      '<p class="scopebar__d">공공 바우처 시스템과 연결되어 있지 않습니다. 품목 허용 기준만 호환되게 맞춘, 기관·재단·기업이 스스로 편성한 지원예산 위에서 동작합니다.</p></div></div>' +
      '</div>' + heroProof + '</div>' +

      '<section class="axes-sec" aria-labelledby="axes-title">' +
      '<div class="sec-hd"><h2 class="sec-hd__t" id="axes-title">심사 기준 네 축</h2>' +
      '<p class="sec-hd__d">축마다 주장 한 줄과 검증값 세 줄만 둡니다. 없는 값은 “아니오”로 적습니다. 기준 2는 바로 아래에서 직접 실행해 확인할 수 있습니다.</p></div>' +
      axes + '</section>' +

      aiProof() +

      '<section class="scen-sec" aria-labelledby="scen-title">' +
      '<div class="sec-hd"><h2 class="sec-hd__t" id="scen-title">시나리오 세 가지</h2>' +
      '<p class="sec-hd__d">전화가 주문으로 이어질 때, 범위 밖 요청이 막힐 때, 배송 문제가 들어올 때를 각각 봅니다.</p></div>' +
      '<div class="judge-switch">' +
      '<div class="judge-tabs" role="tablist" aria-label="시나리오 선택">' + tabs + '</div>' +
      '<p class="judge-hint">' + ico('circle-info-fill', 'ico--sm') +
      '<span>고른 시나리오에 따라 다섯 단계·결과 요약·근거 카드가 모두 함께 바뀝니다.</span></p></div>' +
      '</section>' +

      '<section class="judge-stage" id="judge-panel" role="tabpanel" aria-labelledby="judge-tab-' + key + '" tabindex="0">' +
      '<div class="judge-panel">' +
      '<div class="judge-panel__hd"><h2 class="t-heading1 w-bold">' + scene.title + '</h2>' +
      '<p class="judge-panel__meta">' + scene.meta + '</p></div>' + steps +
      (key === 'delivery' ? '<div class="judge-synth">' + demoShots() + '</div>' : '') +
      '</div>' + summary + '</section>' +

      '<section class="judge-proofs">' +
      '<div class="sec-hd"><h2 class="sec-hd__t">이 시나리오의 근거</h2>' +
      '<p class="sec-hd__d">지금 열려 있는 시나리오에서 실제로 만들어진 값과, 만들어지지 않은 값을 함께 적습니다.</p></div>' +
      proofs + '</section>' +

      '<section class="rails-sec" id="rails" aria-labelledby="rails-title">' +
      '<div class="sec-hd"><h2 class="sec-hd__t" id="rails-title">검증된 레일 둘</h2>' +
      '<p class="sec-hd__d">서로 다른 두 사건입니다. 사건 번호를 공유하지 않으며, 한쪽의 값이 다른 쪽을 증명하지 않습니다.</p></div>' +
      '<div class="rails">' + railSupplier() + railLegacy() + '</div>' +
      '<p class="rails__split">' + ico('circle-info-fill') +
      '<span>레일 하나는 공급자 주문번호로만, 레일 둘은 사건 번호 <code>' + esc(LEGACY_PROOF_CASE_ID) + '</code>로만 식별됩니다. 두 값을 같은 사건으로 읽지 마십시오.</span></p>' +
      '</section>' +

      judgeGap() +

      '<div class="judge-actions">' +
      '<p class="judge-actions__l">각 화면은 각자의 사건과 자료를 씁니다. 아래에서 표면별로 확인할 수 있습니다.</p>' +
      '<a class="btn btn--solid-primary btn--md" href="?v=home">이용자 화면 보기' + ico('arrow-right') + '</a>' +
      '<a class="btn btn--outlined-primary btn--md" href="?v=ops&s=demo">기관 담당자 화면 보기</a>' +
      '<details class="judge-tech"><summary class="btn btn--outlined-assistive btn--md">이 화면의 자료 출처' + ico('chevron-down') + '</summary>' +
      '<div class="judge-tech__body">' +
      proofRow('시나리오 단계·요약', '합성 시연 값') +
      proofRow('전화 시나리오 사건', DEMO_CASE_ID) +
      proofRow('배송 시나리오 사건', DEMO_DELIVERY_CASE_ID) +
      proofRow('기술 증명 사건', LEGACY_PROOF_CASE_ID) +
      proofRow('공급자 주문 회신', 'GET /api/demo/food-order-proof') +
      proofRow('AI 해석기 실측', 'POST /api/food-support/interpret · 버튼으로만 호출') +
      proofRow('전화 접수 경로 실통화', '재검증 필요') +
      proofRow('세 사건의 공통 번호', '') +
      '</div></details></div>';
  }

  function viewHub() {
    var scenes = [
      ['phone-fill', '장면 01', '편하게 말합니다', '일상적인 말로 먹거리를 묻고, 살 수 있는 종류나 실제 상품 후보를 안내받도록 설계했습니다. 전화 접수 경로는 운영 재검증 중입니다.'],
      ['verified-check-fill', '장면 02', '약속한 범위를 지킵니다', '품목과 원산지, 가격과 재고, 남은 지원금을 확인합니다. 전화 경로에서는 이용자가 상품과 총액을 최종 확인하면 판매처 주문으로 이어지도록 설계했습니다.'],
      ['inbox', '장면 03', '도착한 뒤까지 확인합니다', '배송 완료와 이용자의 실제 수령을 따로 확인합니다. 그 결과가 지급과 환불의 근거로 남습니다.']
    ];
    var checks = ['원산지와 품목', '재고와 배송 가능 여부', '주문 시점의 가격', '구매 한도와 남은 지원금', '중복 지원 여부', '상품·수량·총액에 대한 이용자 최종 확인'];
    var stack = [
      ['AI 해석기', '한국어 음성과 텍스트 요청을 구조화하고, 뜻이 모호하면 되묻습니다.', '품목 허용·예산 승인·주문 실행 권한은 갖지 않습니다.'],
      ['운영 인프라', 'Cloud Run이 실행 경로를 제공하고 Firestore가 하나의 사건 원장을 보관합니다.', '요청부터 확인까지의 기록을 역할별로 나눠 보여줍니다.'],
      ['결정론적 정책', '품목·원산지·가격·재고·예산·중복 여부를 규칙으로 확인합니다.', '이용자의 최종 확인은 별도 단계이며, 확인되지 않은 조건은 통과시키지 않습니다.'],
      ['결제 승인 · 결제 샌드박스 · 범위 제한 권한', '주문별로 자산·목적지·금액이 제한된 권한과 테스트 실행 영수증을 검증합니다.', '샌드박스 실행이며 실제 식품대금 결제가 아닙니다.'],
      ['SpecialOffer', '실제로 판매되는 상품과 원화 주문 회신을 제공합니다.', '상품·재고·주문번호는 공급자 회신으로만 표시합니다.']
    ];
    return '<div class="lp">' +
      '<section class="lp-hero" aria-labelledby="lp-hero-title"><div class="lp-hero__text"><div class="lp-hero__inner">' +
      '<p class="lp-hero__eyebrow">' + ico('phone-fill', 'ico--sm') + '말로 요청하는 지원</p>' +
      '<h1 class="lp-display lp-hero__title" id="lp-hero-title">말로 전한 필요가,<br><span class="lp-mark">제대로 닿을 때까지.</span></h1>' +
      '<p class="lp-lede lp-hero__lede">말결은 앱과 결제가 어려운 사람의 요청을 듣고, 지원 기준과 남은 지원금을 확인한 뒤 실제 전달과 정산으로 이어지도록 설계한 서비스입니다.</p>' +
      '<p class="lp-hero__guard">전화 경로는 상품·수량·총액을 이용자가 최종 확인해야 주문을 시작합니다.</p>' +
      '<div class="lp-actions"><a class="lp-btn lp-btn--primary" href="#lp-story">말결이 이어지는 과정 보기' + ico('arrow-right') + '</a>' +
      '<a class="lp-btn lp-btn--ghost" href="?v=home">이용자 화면 보기</a></div>' +
      '<p class="lp-hero__tel">전화 접수 경로 운영 재검증 중 · <a class="lp-tel" href="tel:07052753884">070-5275-3884</a></p>' +
      '</div></div><div class="lp-hero__figure"><picture><source type="image/webp" srcset="/assets/story/elder-voice-hero-480.webp 480w, /assets/story/elder-voice-hero-960.webp 960w, /assets/story/elder-voice-hero-1536.webp 1536w" sizes="(min-width: 900px) 50vw, 100vw"><img src="/assets/story/elder-voice-hero.png" alt="집 거실에서 전화기를 들고 이야기하는 어르신" width="1536" height="1024" fetchpriority="high"></picture></div></section>' +
      '<section class="lp-section" id="lp-story" aria-labelledby="lp-problem-title"><div class="lp-wrap"><p class="lp-index"><span>01</span> 지금의 지원</p>' +
      '<div class="lp-problem"><div><h2 class="lp-h2" id="lp-problem-title">지원은 정해지는 것만으로 끝나지 않습니다.</h2></div>' +
      '<div><p class="lp-lede">요청은 전화에, 정책은 문서에, 주문과 배송은 다른 시스템에 흩어져 있습니다.</p>' +
      '<p class="lp-body">이용자는 어디에 무엇을 말해야 할지 다시 배워야 하고, 담당자는 지원이 실제 생활에 닿았는지를 끝까지 확인하기 어렵습니다.</p>' +
      '<div class="lp-scatter"><p><strong>요청</strong><span>전화 통화로 오갑니다</span></p><p><strong>기준</strong><span>문서와 지침에 적혀 있습니다</span></p>' +
      '<p><strong>전달</strong><span>주문·배송 시스템에 따로 남습니다</span></p><p><strong>확인</strong><span>셋을 사람이 이어 맞춰야 합니다</span></p></div></div></div></div></section>' +
      '<section class="lp-section lp-section--dark" aria-labelledby="lp-scenes-title"><div class="lp-wrap"><p class="lp-index"><span>02</span> 말결이 하는 일</p>' +
      '<h2 class="lp-h2" id="lp-scenes-title">말결은 흩어진 세 자리를 하나로 잇습니다.</h2><div class="lp-scenes">' + scenes.map(function (s) {
        return '<article class="lp-scene"><p class="lp-scene__index">' + ico(s[0], 'ico--sm') + s[1] + '</p><h3>' + s[2] + '</h3><p>' + s[3] + '</p></article>';
      }).join('') + '</div></div></section>' +
      '<section class="lp-arrival" aria-labelledby="lp-arrival-title"><figure><picture><source type="image/webp" srcset="/assets/story/elder-support-arrival-480.webp 480w, /assets/story/elder-support-arrival-960.webp 960w, /assets/story/elder-support-arrival-1536.webp 1536w" sizes="100vw"><img src="/assets/story/elder-support-arrival.png" alt="현관 앞에서 지원 물품 상자를 함께 확인하는 어르신 부부와 지원 인력" width="1536" height="1024" loading="lazy"></picture></figure>' +
      '<div class="lp-wrap lp-arrival__copy"><h2 class="lp-h2" id="lp-arrival-title">지원이 실제 생활에 닿았는지, 마지막까지 확인합니다.</h2>' +
      '<div><p class="lp-body">택배가 도착한 시각과 사람이 물건을 받은 순간은 같지 않습니다. 두 상태를 따로 기록하고, 문제가 있으면 재전달이나 환불로 이어갑니다.</p>' +
      '<p class="lp-caption">캠페인용 합성 이미지이며 실제 이용자나 개인정보를 사용하지 않았습니다.</p></div></div></section>' +
      '<section class="lp-section" aria-labelledby="lp-case-title"><div class="lp-wrap"><p class="lp-index"><span>03</span> 첫 적용 사례</p>' +
      '<h2 class="lp-h2" id="lp-case-title">말결은 먼저 식품지원에서 시작했습니다.</h2><div class="lp-case"><div><p class="lp-lede">현재 적용 기준은 <span class="lp-mark">2026 농식품바우처 호환 식품지원</span>입니다.</p>' +
      '<p class="lp-body">정부 공식 카드나 지정몰 연동이 아니라 기관·재단·기업의 자체 지원예산입니다. 국내산 과일·채소, 흰우유, 계란, 고기, 잡곡, 두부, 밤·잣·호두를 대상으로 합니다.</p></div>' +
      '<div class="lp-checklist"><p class="lp-checklist__title">주문 전에 확인하는 것</p>' + checks.map(function (c) { return '<p>' + ico('verified-check-fill', 'ico--sm') + c + '</p>'; }).join('') +
      '<strong>하나라도 확인되지 않으면 주문을 만들지 않습니다.</strong></div></div></div></section>' +
      '<section class="lp-section lp-tech" aria-labelledby="lp-tech-title"><div class="lp-wrap"><p class="lp-index"><span>04</span> 작동 원리</p>' +
      '<h2 class="lp-h2" id="lp-tech-title">이 약속을 지키기 위해 쓰는 것들</h2><p class="lp-lede">각 기술은 하나의 역할만 맡습니다. 하지 않는 일도 함께 정했습니다.</p>' +
      '<div class="lp-stack">' + stack.map(function (s) { return '<article><h3>' + esc(s[0]) + '</h3><p>' + s[1] + '</p><small>' + s[2] + '</small></article>'; }).join('') + '</div></div></section>' +
      '<section class="lp-section lp-tech" aria-labelledby="lp-proof-title"><div class="lp-wrap"><p class="lp-index"><span>05</span> 확인한 것</p>' +
      '<h2 class="lp-h2" id="lp-proof-title">지금까지 확인된 것과, 아직 아닌 것</h2><div class="lp-facts">' +
      '<p><strong>실제 공급자 주문 <span class="lp-mono">585492</span></strong><span>PREPARING · 송장 대기</span></p>' +
      '<p><strong>원화 식품 주문과 샌드박스 기술 증거</strong><span>서로 다른 사건</span></p>' +
      '<p><strong>결제 샌드박스 실행</strong><span>실제 식품대금·정부자금 결제 아님</span></p>' +
      '<p><strong>같은 사건 번호의 전 단계 완료</strong><span>아직 미완</span></p></div>' +
      '<div class="lp-actions"><a class="lp-btn lp-btn--primary" href="?v=demo">기술과 검증 자세히 보기' + ico('arrow-right') + '</a></div></div></section>' +
      '<section class="lp-section lp-entries" aria-labelledby="lp-entry-title"><div class="lp-wrap"><p class="lp-index"><span>06</span> 화면 열기</p>' +
      '<h2 class="lp-h2" id="lp-entry-title">먼저 이용자 화면부터 보시길 권합니다.</h2><div class="lp-entry-grid">' +
      '<a class="lp-entry lp-entry--lead" href="?v=home"><span>' + ico('person') + '</span><span class="lp-entry__copy"><strong>이용자 화면 보기</strong><small>모바일웹의 별도 지원 요청 흐름</small></span>' + ico('arrow-right') + '</a>' +
      '<a class="lp-entry" href="?v=ops&s=demo"><span>' + ico('company') + '</span><span class="lp-entry__copy"><strong>기관 운영 화면</strong><small>요청·정책·지원금·배송 상태를 확인하는 업무함</small></span></a>' +
      '<a class="lp-entry" href="?v=demo"><span>' + ico('certificate') + '</span><span class="lp-entry__copy"><strong>기술과 검증</strong><small>실측 결과와 사실 경계</small></span></a>' +
      '<a class="lp-entry" href="tel:07052753884"><span>' + ico('phone-fill') + '</span><span class="lp-entry__copy"><strong>전화로 요청하기</strong><small>070-5275-3884 · 운영 재검증 중</small></span></a>' +
      '</div></div></section>' +
      '<footer class="lp-footer"><div class="lp-wrap"><p class="lp-footer__brand"><span></span>말결</p><p>말로 전한 필요가 제대로 닿을 때까지 잇는 지원 실행·정산 레일</p>' +
      '<nav aria-label="바로가기"><a href="?v=home">이용자 화면</a><a href="?v=ops&s=demo">기관 화면</a><a href="?v=demo">기술과 검증</a><a href="tel:07052753884">070-5275-3884</a></nav></div></footer></div>';
  }

  /* 기관 시연 표는 읽기 전용 기록이면서, 각 행이 대응하는 심사 시나리오로 이어진다. */
  var OPS_DEMO_ROWS = [
    ['방금', 'PHONE', '잡곡선물세트 겨울(6종)', '78,500원', ['warn', '직주문 재검증'], 'SpecialOffer', 'phone', '전화 주문'],
    ['6분 전', 'PHONE', '위험 품목 요청', '', ['no', '정책 차단'], '', 'risk', '위험 요청 차단'],
    ['어제', 'WEB', '백미 10kg 1포 · 파손 신고', '32,900원', ['outline', '파손 확인'], '합성 배송 증빙', 'delivery', '배송 문제']
  ];

  function viewOpsDemo() {
    var rows = OPS_DEMO_ROWS.map(function (r) {
      return '<tr>' +
        '<td class="td-time">' + r[0] + '</td>' +
        '<td>' + chanTag(r[1]) + '</td>' +
        '<td class="td-item">' + r[2] + '</td>' +
        '<td class="td-num">' + (r[3] ? r[3] : '<span class="assist">없음</span>') + '</td>' +
        '<td>' + badge(r[4][0], r[4][1]) + '</td>' +
        '<td>' + (r[5] ? esc(r[5]) : '<span class="assist">조회 안 함</span>') + '</td>' +
        '<td class="td-next"><a class="rowlink" href="?v=demo&s=' + r[6] + '">' +
        '<span class="rowlink__l">심사 화면에서 보기</span><span class="rowlink__s">' + r[7] + '</span>' +
        ico('arrow-right') + '</a></td></tr>';
    }).join('');

    return '<div class="ops-demo-head"><div><p class="eyebrow">기관 담당자 시연</p>' +
      '<h1 class="ops__title">오늘 처리할 주문</h1>' +
      '<p class="t-body2 muted" style="margin-top:6px">합성 시연 사건 3건 · 읽기 전용 기록 · 각 행은 대응하는 심사 시나리오로 이어집니다</p></div>' +
      '<a class="btn btn--outlined-primary btn--md" href="?v=hub">데모 입구로</a></div>' +
      '<div class="ops-demo-kpis"><div><span>직주문 재검증</span><strong>1</strong></div><div><span>정책 차단</span><strong>1</strong></div><div><span>배송 확인</span><strong>1</strong></div></div>' +
      '<div class="tbl-wrap"><table class="tbl tbl--demo"><caption class="sr-only">합성 시연 주문 목록. 각 행의 링크는 같은 상황을 다룬 심사 시나리오로 이동합니다.</caption><thead><tr>' +
      '<th>접수</th><th>경로</th><th>요청·상품</th><th class="th-num">합계</th><th>상태</th><th>공급자</th><th>심사 화면</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>' +
      '<section class="ops-demo-flow"><div><p class="actcard__t">주문 직전 자동 확인</p><h2>상품·금액·한도·이용자 확인·판매처</h2><p>다섯 조건이 모두 맞을 때만 판매처 주문을 실행합니다.</p></div>' +
      '<div><p class="actcard__t">배송 후 확인</p><h2>택배 완료와 이용자 수령은 별도 상태</h2><p>이용자가 올린 사진과 문제 유형을 확인해 재배송·환불 후속 조치로 이어집니다.</p></div></section>' +
      '<div class="ops-demo-actions"><a class="btn btn--solid-primary btn--md" href="?v=demo">심사 데모 전체 보기' + ico('arrow-right') + '</a>' +
      '<a class="btn btn--outlined-assistive btn--md" href="?v=ops">실제 기관 권한 연결</a></div>';
  }

  /* =======================================================================
     렌더
     ==================================================================== */
  var VIEWS = {
    hub: { t: '데모 입구', surface: 'hub', f: viewHub },
    home: { t: '홈', nav: 'home', surface: 'ben', f: viewHome },
    search: { t: '상품 찾기', nav: 'search', surface: 'ben', f: viewSearch, back: 'home' },
    product: { t: '상품 자세히', nav: 'search', surface: 'ben', f: viewProduct, back: 'search' },
    cart: { t: '주문서', nav: 'search', surface: 'ben', f: viewCart, back: 'product' },
    delivery: { t: '받는 곳', nav: 'search', surface: 'ben', f: viewDelivery, back: 'cart' },
    review: { t: '주문 전 확인', nav: 'search', surface: 'ben', f: viewReview, back: 'delivery' },
    orders: { t: '주문 내역', nav: 'orders', surface: 'ben', f: viewOrders },
    orderdetail: { t: '배송 확인', nav: 'orders', surface: 'ben', f: viewOrderDetail, back: 'orders' },
    help: { t: '도움', nav: 'help', surface: 'ben', f: viewHelp },
    ops: { t: '기관 업무함', surface: 'ops', f: function (st) { return st.s === 'demo' ? viewOpsDemo() : viewOps(); } },
    demo: { t: '심사 데모', surface: 'demo', f: viewDemo }
  };

  function render() {
    var st = route();
    var def = VIEWS[st.v] || VIEWS.hub;
    var app = $('#app'), main = $('#main');

    /* 배송 화면을 벗어나면 입력 오류 표시를 버린다. 다시 들어왔을 때 남아 있으면 거짓말이 된다. */
    if (st.v !== 'delivery') deliveryErrors = {};
    /* 배송 확인 화면을 벗어나면 고르던 사진과 상태를 버린다. */
    if (st.v !== 'orderdetail' && (RECEIPT.issueType || RECEIPT.image || RECEIPT.done)) resetReceipt();

    document.title = def.t + ' · 말결';
    app.setAttribute('data-surface', def.surface);
    main.className = 'view view--' + def.surface;
    main.innerHTML = def.f(st);

    $('#bhead').hidden = def.surface !== 'ben';
    $('#bnav').hidden = def.surface !== 'ben';
    $('#opsrail').hidden = def.surface !== 'ops' || st.s === 'demo';

    var back = $('#btn-back');
    back.hidden = def.surface !== 'ben' || !def.back;
    back.dataset.back = def.back || '';

    $$('.bnav__item').forEach(function (a) {
      if (a.dataset.nav === def.nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
      var use = a.querySelector('use');
      if (use && a.dataset.nav === 'home') use.setAttribute('href', def.nav === 'home' ? '#i-home-fill' : '#i-home');
    });

    if (def.surface === 'ops' && st.s !== 'demo') renderOpsRail();
    if ($('#a11y-sheet') && !$('#a11y-sheet').hidden) $('#a11y-body').innerHTML = a11yControls();

    /* 화면이 실제로 필요로 할 때만 서버를 부른다 */
    if (def.surface === 'ops' && st.s !== 'demo' && sessionStorage.getItem('malgyeol-role-ops') && !LIVE.opsRequested) {
      setTimeout(loadOpsOverview, 0);
    }
    /* 승인함과 증빙은 사건 작업면을 실제로 열었을 때만 부른다. */
    if (def.surface === 'ops' && OPS.caseId && opsCase(OPS.caseId) && opsToken()) {
      var openCase = OPS.caseId;
      if (!OPS_APPROVALS[openCase] || !OPS_APPROVALS[openCase].requested) setTimeout(function () { loadOpsApprovals(openCase); }, 0);
      if (!OPS_EVIDENCE[openCase] || !OPS_EVIDENCE[openCase].requested) setTimeout(function () { loadOpsEvidence(openCase); }, 0);
    }
    if ((st.v === 'orders' || st.v === 'orderdetail' || st.v === 'home') && orderAccess() && !ORDER_READBACK.requested) {
      setTimeout(loadOrderReadback, 0);
    }
    /* 배송 확인 화면에서만 증빙 목록을 부른다. 권한 범위가 확인된 뒤 한 번이다. */
    if (st.v === 'orderdetail' && evidenceScope() && !EVIDENCE.requested && !EVIDENCE.loading) {
      setTimeout(loadEvidenceList, 0);
    }
    if ((st.v === 'orderdetail' || def.surface === 'ops' || def.surface === 'demo') && !SYNTH.requested && !SYNTH.loading) {
      setTimeout(loadSyntheticEvidence, 0);
    }
    /* 심사 화면의 두 레일은 서로 다른 사건이므로 각각 한 번씩 부른다. */
    if (def.surface === 'demo') {
      if (!LIVE.foodOrderRequested && !LIVE.foodOrderLoading) setTimeout(loadFoodOrderProof, 0);
      if (!LIVE.demoRequestedId && !LIVE.demoLoading) setTimeout(function () { loadDemoCase(LEGACY_PROOF_CASE_ID, false); }, 0);
    }
    /* 확인 화면에 들어오면 조건 확인과 미리보기를 한 번만 자동으로 요청한다. */
    if (st.v === 'review' && ORDER.product && SECURE.recipient && !SECURE.loading
      && SECURE.attemptedFor !== termsFingerprint()) {
      SECURE.attemptedFor = termsFingerprint();
      setTimeout(loadReview, 0);
    }

    say(def.t + ' 화면입니다.');
  }

  /* ---------------- 시트 ---------------- */
  function openSheet(id) {
    var el = $('#' + id + '-sheet'); if (!el) return;
    window.__sheetOpener = document.activeElement;
    if (id === 'a11y') $('#a11y-body').innerHTML = a11yControls();
    el.hidden = false;
    document.body.style.overflow = 'hidden';
    var trigger = id === 'a11y' ? $('#btn-a11y') : null;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    var btn = el.querySelector('button'); if (btn) btn.focus();
    say('설정 창이 열렸습니다.');
  }
  function closeSheet(id) {
    var el = $('#' + id + '-sheet'); if (!el) return;
    el.hidden = true; document.body.style.overflow = '';
    var trigger = id === 'a11y' ? $('#btn-a11y') : null;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (window.__sheetOpener && document.contains(window.__sheetOpener)) window.__sheetOpener.focus();
    window.__sheetOpener = null;
  }
  function alertLine(node, msg) {
    var host = node.closest('.actcard') || node.closest('.card') || node.parentElement;
    var old = host.querySelector('[data-inline-msg]');
    if (old) old.remove();
    host.insertAdjacentHTML('beforeend',
      '<div data-inline-msg role="status" style="margin-top:12px">' + notice('info', '', esc(msg), 'circle-info-fill') + '</div>');
  }

  function selectProduct(goodsNo) {
    var found = LIVE.products.filter(function (p) { return String(p.goodsNo) === String(goodsNo); })[0];
    if (!found) { say('선택한 상품을 다시 찾지 못했어요. 검색을 다시 해 주세요.', true); return; }
    ORDER.product = pickProduct(found);
    PRODUCT_VERIFIED = true;
    ORDER.quantity = 1;
    if (!ORDER.caseId) ORDER.caseId = webCaseId();
    invalidatePreview(); SECURE.readiness = null; SECURE.attemptedFor = '';
    persistOrder();
    go('product');
  }

  /* ---------------- 이벤트 ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-open],[data-close],[data-go],[data-act],[data-back],[data-scale],[data-toggle],[data-step],[data-sub],' +
      '[data-ops-tab],[data-ops-filter],[data-ops-case],[data-ops-back],[data-ops-action],[data-ops-export],' +
      '[data-ops-exec-open],[data-ops-exec-cancel],[data-ops-exec-confirm],[data-ops-review],[data-ops-synth-toggle],' +
      '[data-issue-order-access],[data-copy-order-access],[data-demo-story],#dictate');
    if (!t) return;

    if (t.id === 'dictate') {
      if (window.__listening) stopVoiceRecognition(); else startVoiceRecognition();
      return;
    }
    if (t.dataset.open) { openSheet(t.dataset.open); return; }
    if (t.dataset.close) { closeSheet(t.dataset.close); return; }
    if (t.hasAttribute('data-back')) { go(t.dataset.back || 'home'); return; }
    if (t.dataset.go) { go(t.dataset.go); return; }

    if (t.hasAttribute('data-ops-tab')) { OPS.tab = t.dataset.opsTab; OPS.caseId = ''; OPS.filter = 'all'; resetOpsCaseState(); render(); return; }
    if (t.hasAttribute('data-ops-filter')) { OPS.filter = t.dataset.opsFilter; render(); return; }
    if (t.hasAttribute('data-ops-case')) { OPS.caseId = t.dataset.opsCase; resetOpsCaseState(); render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute('data-ops-back')) { OPS.caseId = ''; resetOpsCaseState(); render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute('data-ops-synth-toggle')) {
      OPS_SYNTH_OPEN = !OPS_SYNTH_OPEN;
      if (OPS_SYNTH_OPEN && !SYNTH.requested) loadSyntheticEvidence(); else render();
      say(OPS_SYNTH_OPEN ? '합성 증빙 예시를 열었습니다.' : '합성 증빙 예시를 접었습니다.'); return;
    }
    if (t.hasAttribute('data-ops-exec-open')) {
      OPS_EXEC.requestId = t.dataset.requestId || ''; OPS_EXEC.confirming = true;
      OPS_EXEC.error = ''; OPS_EXEC.result = null;
      render(); say('실제 주문 실행 전 확인 내용을 표시했습니다.', true); return;
    }
    if (t.hasAttribute('data-ops-exec-cancel')) {
      OPS_EXEC.confirming = false; OPS_EXEC.requestId = '';
      render(); say('실행을 취소했습니다. 주문은 생성되지 않았습니다.', true); return;
    }
    if (t.hasAttribute('data-ops-exec-confirm')) { executeApproval(t.dataset.caseId, t.dataset.requestId); return; }
    if (t.hasAttribute('data-ops-review')) { reviewEvidence(t.dataset.caseId, t.dataset.evidenceId, t.dataset.opsReview); return; }
    if (t.hasAttribute('data-ops-action')) { runOpsAction(t); return; }
    if (t.hasAttribute('data-ops-export')) { downloadOpsExport(t); return; }
    if (t.hasAttribute('data-issue-order-access')) { issueOrderAccessLink(t.dataset.caseId || '', t.dataset.orderId || '', t); return; }
    if (t.hasAttribute('data-copy-order-access')) { copyOrderAccessLink(t.dataset.caseId || '', t); return; }

    if (t.hasAttribute('data-demo-story')) {
      DEMO.story = t.dataset.demoStory;
      history.replaceState({}, '', '?v=demo&s=' + encodeURIComponent(DEMO.story));
      render();
      /* 다시 그리면 누른 버튼이 사라지므로 같은 탭으로 초점을 돌려준다. */
      var again = $('#judge-tab-' + DEMO.story);
      if (again) {
        again.scrollIntoView({ block: 'center', behavior: 'auto' });
        again.focus({ preventScroll: true });
        say(again.textContent + ' 시나리오를 열었습니다.');
      }
      return;
    }
    if (t.hasAttribute('data-scale')) {
      A11Y.scale = Number(t.dataset.scale); applyA11y();
      $$('[data-scale]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.scale === t.dataset.scale)); });
      say('글자 크기를 바꿨습니다.'); return;
    }
    if (t.hasAttribute('data-toggle')) {
      var k = t.dataset.toggle, on = t.getAttribute('aria-checked') === 'true';
      if (k === 'contrast') A11Y.contrast = on ? 'normal' : 'high';
      if (k === 'easy') A11Y.easy = on ? 'off' : 'on';
      if (k === 'motion') A11Y.motion = on ? 'auto' : 'reduced';
      applyA11y();
      $$('[data-toggle="' + k + '"]').forEach(function (b) { b.setAttribute('aria-checked', String(!on)); });
      say('설정을 바꿨습니다.'); return;
    }
    if (t.hasAttribute('data-step')) {
      var box = t.closest('.stepper'), out = box.querySelector('output');
      var n = Math.min(100, Math.max(1, Number(out.textContent) + Number(t.dataset.step)));
      out.textContent = String(n);
      if (box.dataset.stepper === 'quantity') {
        ORDER.quantity = n; persistOrder();
        invalidatePreview(); SECURE.readiness = null; SECURE.attemptedFor = '';
        render();
      }
      say('수량 ' + n + '개'); return;
    }
    if (t.hasAttribute('data-sub')) {
      ORDER.substitution = t.dataset.sub; persistOrder();
      $$('[data-sub]').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.sub === t.dataset.sub)); });
      say('대체 방법을 골랐습니다.'); return;
    }

    var act = t.dataset.act;
    if (!act) return;
    if (act === 'example') { submitUtterance(t.dataset.query || ''); return; }
    if (act === 'select-product') { selectProduct(t.dataset.goodsNo); return; }
    if (act === 'clear-order') {
      clearOrder(); dropSecure('');
      say('고른 상품을 지웠습니다.', true); go('search'); return;
    }
    if (act === 'run-review') { loadReview(); return; }
    if (act === 'receipt-open') { RECEIPT.open = true; RECEIPT.error = ''; render(); return; }
    if (act === 'receipt-issue') { chooseReceiptIssue(t.dataset.issue || ''); return; }
    if (act === 'receipt-clear-photo') { clearReceiptPhoto(); return; }
    if (act === 'receipt-submit') { submitReceipt(); return; }
    if (act === 'receipt-reset') { resetReceipt(); render(); return; }
    if (act === 'load-synthetic') { loadSyntheticEvidence(); return; }
    if (act === 'retry-program') { LIVE.programError = ''; loadProgram(); return; }
    if (act === 'retry-product-check') { LIVE.productCheckError = ''; validateRestoredProduct(); return; }
    if (act === 'retry-order-status') {
      ORDER_READBACK.requested = false; ORDER_READBACK.error = ''; loadOrderReadback(); return;
    }
    if (act === 'retry-ops-overview') {
      LIVE.opsRequested = false; LIVE.opsError = ''; loadOpsOverview(); return;
    }
    if (act === 'retry-ops-approvals') {
      OPS_APPROVALS[t.dataset.caseId] = emptySlot(); loadOpsApprovals(t.dataset.caseId); return;
    }
    if (act === 'retry-ops-evidence') {
      OPS_EVIDENCE[t.dataset.caseId] = emptySlot(); loadOpsEvidence(t.dataset.caseId); return;
    }
    if (act === 'retry-search') { runSearch(LIVE.query); return; }
    if (act === 'retry-food-order') { LIVE.foodOrderRequested = false; loadFoodOrderProof(); return; }
    /* 심사위원이 직접 눌렀을 때만 해석 경계를 호출한다. 자동 호출 경로는 두지 않는다. */
    if (act === 'run-ai-proof') { runAiProof(); return; }
    if (act === 'retry-legacy-proof') {
      LIVE.demoRequestedId = ''; LIVE.demoError = ''; loadDemoCase(LEGACY_PROOF_CASE_ID, false); return;
    }
    if (act === 'demo-load') {
      var input = $('#demo-id');
      var id = input && input.value.trim();
      if (!id) return;
      var params = new URLSearchParams(location.search);
      params.set('v', 'demo');
      params.set(DEMO.story === 'blocked' ? 'compare' : 'id', id);
      history.replaceState({}, '', '?' + params.toString());
      loadDemoCase(id, DEMO.story === 'blocked');
      return;
    }
  });

  /* 사진 고르기 — 고른 즉시 이 기기에서 형식을 확인하고 필요하면 줄인다 */
  document.addEventListener('change', function (e) {
    var input = e.target.closest && e.target.closest('[data-receipt-photo]');
    if (input) pickReceiptPhoto(input);
  });

  /* 요청 한 문장 제출 */
  document.addEventListener('submit', function (e) {
    if (e.target.closest('#ask-form')) { e.preventDefault(); submitUtterance(); return; }
    var inviteForm = e.target.closest('#institution-invite-form');
    if (inviteForm) {
      e.preventDefault();
      var inviteInput = inviteForm.querySelector('#institution-invite');
      var inviteValue = (inviteInput && inviteInput.value || '').trim();
      try {
        var inviteCaseId = '', inviteToken = '';
        if (/^https?:\/\//i.test(inviteValue)) {
          var inviteUrl = new URL(inviteValue);
          var inviteFragment = new URLSearchParams(inviteUrl.hash.replace(/^#/, ''));
          if (inviteUrl.origin !== location.origin) throw new Error('foreign invite');
          inviteCaseId = inviteUrl.searchParams.get('caseId') || '';
          inviteToken = inviteFragment.get('continuation') || inviteUrl.searchParams.get('continuation') || '';
        } else {
          var inviteParts = inviteValue.split('::');
          inviteCaseId = inviteParts.length === 2 ? inviteParts[0] : '';
          inviteToken = inviteParts.length === 2 ? inviteParts[1] : '';
        }
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(inviteCaseId) || inviteToken.length < 16 || inviteToken.length > 256) {
          throw new Error('invalid invite');
        }
        sessionStorage.setItem('malgyeol-phone-context', JSON.stringify({ caseId: inviteCaseId, token: inviteToken }));
        ORDER.caseId = inviteCaseId; ORDER.sessionId = ''; ORDER.sessionAccessToken = ''; ORDER.sessionAccessExpiresAt = 0;
        persistOrder();
        LIVE.institutionInviteError = '';
        SECURE.error = null; SECURE.readiness = null; SECURE.attemptedFor = '';
        render(); loadReview();
      } catch {
        LIVE.institutionInviteError = '올바른 기관 초대 링크나 코드가 아닙니다. 기관 담당자에게 새 값을 받아 주세요.';
        render();
        var refreshedInvite = $('#institution-invite'); if (refreshedInvite) refreshedInvite.focus();
        say(LIVE.institutionInviteError, true);
      }
      return;
    }
    var opsAccessForm = e.target.closest('#ops-access-form');
    if (opsAccessForm) {
      e.preventDefault();
      var accessInput = opsAccessForm.querySelector('#ops-access-url');
      var accessUrl = (accessInput && accessInput.value || '').trim();
      try {
        var parsedAccess = new URL(accessUrl);
        var accessFragment = new URLSearchParams(parsedAccess.hash.replace(/^#/, ''));
        var accessToken = accessFragment.get('access') || '';
        if (parsedAccess.origin !== location.origin || parsedAccess.pathname.replace(/\/$/, '') !== '/ops' || !accessToken || accessToken.length > 2048) {
          throw new Error('invalid access link');
        }
        sessionStorage.setItem('malgyeol-role-ops', accessToken);
        LIVE.ops = null; LIVE.opsError = ''; LIVE.opsRequested = false; LIVE.opsConnectError = '';
        history.replaceState({}, '', '?v=ops');
        render(); loadOpsOverview();
      } catch {
        LIVE.opsConnectError = '올바른 기관 접속 링크가 아닙니다. 기관 시스템 담당자에게 새 링크를 받아 다시 붙여 넣어 주세요.';
        render();
        var retryInput = $('#ops-access-url'); if (retryInput) retryInput.focus();
        say(LIVE.opsConnectError, true);
      }
      return;
    }
    var form = e.target.closest('#delivery-form');
    if (!form) return;
    e.preventDefault();
    var values = {};
    deliveryErrors = {};
    RECIPIENT_FIELDS.forEach(function (spec) {
      var input = form.querySelector('#rc-' + spec.key);
      var value = (input && input.value || '').trim();
      values[spec.key] = value;
      if (!value) { if (spec.required) deliveryErrors[spec.key] = spec.label + '을(를) 입력해 주세요.'; return; }
      if (value.length > spec.max) { deliveryErrors[spec.key] = spec.label + '은(는) ' + spec.max + '자까지 입력할 수 있어요.'; return; }
      if (!spec.test(value)) deliveryErrors[spec.key] = spec.error;
    });
    if (Object.keys(deliveryErrors).length) {
      SECURE.draft = values; touchSecure();
      render();
      var firstKey = RECIPIENT_FIELDS.filter(function (spec) { return deliveryErrors[spec.key]; })[0].key;
      var target = $('#rc-' + firstKey);
      if (target) target.focus();
      say(Object.keys(deliveryErrors).length + '개 항목을 다시 확인해 주세요.', true);
      return;
    }
    var recipient = { name: values.name, cellphone: values.cellphone, zip: values.zip, address: values.address };
    if (values.memo) recipient.memo = values.memo;
    SECURE.recipient = recipient;
    SECURE.draft = null;
    invalidatePreview();
    SECURE.readiness = null; SECURE.error = null; SECURE.notice = ''; SECURE.attemptedFor = '';
    touchSecure();
    say('받는 곳 정보를 이 기기 메모리에만 담았습니다. 이제 결제 없는 미리보기를 확인합니다.', true);
    go('review');
  });

  /* 내부 링크는 화면 전환으로 처리 */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="?"]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    history.pushState({}, '', a.getAttribute('href'));
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
    $('#main').focus({ preventScroll: true });
  });

  document.addEventListener('click', function (e) {
    if (e.target.closest('#btn-a11y')) openSheet('a11y');
  });

  /* 표 행은 키보드로도 열린다 */
  document.addEventListener('keydown', function (e) {
    var row = e.target.closest && e.target.closest('[data-ops-case]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); OPS.caseId = row.dataset.opsCase; render(); window.scrollTo(0, 0); return;
    }
    var sheet = $('.sheet-root:not([hidden])');
    if (e.key === 'Tab' && sheet) {
      var focusable = $$('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])', sheet);
      if (focusable.length) {
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    if (e.key === 'Escape' && sheet) closeSheet('a11y');
  });

  window.addEventListener('popstate', function () { OPS.caseId = ''; render(); });
  hydratePhoneContinuation();
  hydrateRoleAccess();
  hydrateOrderAccess();
  applyA11y();
  render();
  loadProgram();
})();
