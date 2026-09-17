(function () {
  'use strict';

  var view = document.getElementById('view');
  var state = { catalog: null, selected: null, requests: [], message: '', error: '' };
  var labels = {
    FOOD_PACKAGE: '식품 꾸러미', DAILY_NECESSITIES: '생활용품', MEAL_DELIVERY: '식사 지원',
    REQUESTED: '수행기관 확인 중', PROVIDER_ACCEPTED: '제공 준비 중', PROVIDED: '제공 완료',
    RECIPIENT_CONFIRMED: '수령 확인', EXCEPTION: '담당자 확인 필요'
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char];
    });
  }

  async function api(path, options) {
    var response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}));
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(body.message || body.error || '요청을 처리하지 못했습니다.');
      error.code = body.error;
      throw error;
    }
    return body;
  }

  function route() {
    return new URLSearchParams(location.search).get('v') || 'home';
  }

  function setNav(current) {
    document.querySelectorAll('[data-nav]').forEach(function (link) {
      if (link.getAttribute('data-nav') === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function tomorrow() {
    var date = new Date(Date.now() + 86_400_000);
    return date.toISOString().slice(0, 10);
  }

  function status(value) {
    var kind = value === 'RECIPIENT_CONFIRMED' ? ' status--done' : value === 'EXCEPTION' ? ' status--exception' : '';
    return '<span class="status' + kind + '">' + esc(labels[value] || value) + '</span>';
  }

  function home() {
    view.innerHTML = '<div class="page">' +
      '<section class="hero"><div><p class="eyebrow">Seoul integrated care · voice access</p>' +
      '<h1>말 한마디가<br>돌봄의 마지막<br>1미터를 잇습니다.</h1>' +
      '<p class="lede">앱을 배우거나 주민센터를 여러 번 오갈 필요 없이, 이미 승인된 식사·식품·생활용품 지원을 전화로 요청하고 실제로 받았는지까지 확인합니다.</p>' +
      '<div class="actions"><a class="btn btn--primary" href="/?v=request">요청 흐름 체험하기</a>' +
      '<a class="btn btn--line" href="/?v=demo">3분 발표 흐름 보기</a></div></div>' +
      '<aside class="hero__note"><strong>예외만</strong><p>정상 요청은 수행기관으로 바로 전달하고, 계획 밖 요청이나 위험 신호만 담당자에게 넘깁니다.</p></aside></section>' +
      '<section class="three" aria-label="말결의 세 원칙">' +
      principle('1', '전화로 시작', '스마트폰과 앱 없이 평소 쓰던 일반 전화로 말합니다.') +
      principle('2', '계획 안에서만', 'AI가 자격을 정하지 않고 승인된 개인별지원계획만 실행합니다.') +
      principle('3', '수령까지 기록', '요청·수락·제공·수령을 사건 하나로 남겨 감사할 수 있습니다.') +
      '</section></div>';
  }

  function principle(number, title, body) {
    return '<article class="principle"><b>' + number + '</b><h3>' + title + '</h3><p>' + body + '</p></article>';
  }

  async function requestView() {
    view.innerHTML = '<div class="page"><div class="loading">승인된 지원계획을 확인하고 있습니다.</div></div>';
    try {
      if (!state.catalog) state.catalog = await api('/api/demo/care/catalog');
      renderRequest();
    } catch (error) {
      view.innerHTML = '<div class="page"><div class="notice notice--error">' + esc(error.message) + '</div></div>';
    }
  }

  function renderRequest() {
    var enrollment = state.catalog.enrollment;
    var items = state.catalog.items;
    var selected = items.find(function (item) { return item.itemCode === state.selected; });
    view.innerHTML = '<div class="page"><div class="section-head"><div><p class="eyebrow">Recipient request</p><h1>무엇이 필요하세요?</h1></div>' +
      '<p>아래 품목은 합성 개인별지원계획과 수행기관 제공 가능 상태를 함께 확인한 결과입니다.</p></div>' +
      (state.error ? '<div class="notice notice--error">' + esc(state.error) + '</div>' : '') +
      '<div class="request-layout"><section><div class="catalog">' + items.map(function (item) {
        return '<button class="choice" type="button" data-item="' + esc(item.itemCode) + '" aria-pressed="' + (state.selected === item.itemCode) + '">' +
          '<span>' + esc(labels[item.serviceCode]) + '</span><strong>' + esc(item.name) + '</strong><small>' + esc(item.providerName) + ' · ' + (item.availability === 'LIMITED' ? '수량 확인 필요' : '제공 가능') + '</small></button>';
      }).join('') + '</div>' +
      '<form id="care-form" class="panel" style="margin-top:16px">' +
      '<div class="field"><label for="preferred-date">언제 받으시겠어요?</label><input id="preferred-date" name="preferredDate" type="date" min="2026-09-18" value="' + tomorrow() + '" required></div>' +
      '<div class="confirm"><input id="confirm" name="confirmed" type="checkbox" required><label for="confirm">' + (selected ? '<strong>' + esc(selected.name) + ' 1' + esc(selected.unit) + '</strong>을 요청하고, ' + esc(selected.providerName) + '에 전달하는 것에 동의합니다.' : '품목을 선택한 뒤 요청 내용을 확인해 주세요.') + '</label></div>' +
      '<button class="btn btn--primary" type="submit" ' + (selected ? '' : 'disabled') + '>수행기관에 요청하기</button></form></section>' +
      '<aside class="panel plan"><div class="plan__person"><div class="avatar">김</div><div><small>합성 시연 대상자</small><h3>' + esc(enrollment.displayName) + '</h3></div></div>' +
      '<dl><div><dt>식품 꾸러미</dt><dd>2회 남음</dd></div><div><dt>생활용품</dt><dd>1회 남음</dd></div><div><dt>식사 지원</dt><dd>10회 남음</dd></div><div><dt>계획 유효기간</dt><dd>' + esc(enrollment.activeUntil) + '</dd></div></dl>' +
      '<p style="margin:22px 0 0;color:rgba(255,255,255,.7);line-height:1.6">말결은 이 계획을 바꾸지 않습니다. 계획 밖 요청은 담당자에게 연결합니다.</p></aside></div></div>';

    document.querySelectorAll('[data-item]').forEach(function (button) {
      button.addEventListener('click', function () { state.selected = button.getAttribute('data-item'); state.error = ''; renderRequest(); });
    });
    document.getElementById('care-form').addEventListener('submit', submitRequest);
  }

  async function submitRequest(event) {
    event.preventDefault();
    var item = state.catalog.items.find(function (value) { return value.itemCode === state.selected; });
    if (!item) return;
    var form = new FormData(event.currentTarget);
    try {
      var result = await api('/api/demo/care/requests', { method: 'POST', body: JSON.stringify({
        beneficiaryRef: state.catalog.enrollment.beneficiaryRef,
        serviceCode: item.serviceCode,
        itemCode: item.itemCode,
        quantity: 1,
        preferredDate: form.get('preferredDate'),
        confirmed: form.get('confirmed') === 'on'
      }) });
      state.message = result.request.itemName + ' 요청이 ' + result.request.providerName + '에 전달되었습니다.';
      history.replaceState(null, '', '/?v=success&caseId=' + encodeURIComponent(result.request.caseId));
      render();
    } catch (error) {
      state.error = error.message;
      renderRequest();
    }
  }

  function success() {
    var caseId = new URLSearchParams(location.search).get('caseId') || '';
    view.innerHTML = '<div class="page"><section class="panel" style="max-width:760px;margin:20px auto;text-align:center;padding:55px">' +
      '<p class="eyebrow">Request received</p><h1 style="font-size:clamp(40px,6vw,70px)">요청을<br>전달했습니다.</h1>' +
      '<p class="lede" style="margin-left:auto;margin-right:auto">' + esc(state.message || '수행기관이 제공 가능 여부를 확인합니다.') + '</p>' +
      '<div class="notice">정상 요청은 담당 공무원이 다시 입력하지 않아도 수행기관 업무함으로 바로 전달됩니다.</div>' +
      '<p class="case-id">사건 번호 ' + esc(caseId) + ' · 합성 시연</p>' +
      '<div class="actions" style="justify-content:center"><a class="btn btn--primary" href="/?v=provider">수행기관 화면 보기</a><a class="btn btn--line" href="/?v=request">다른 요청 체험</a></div></section></div>';
  }

  async function loadRequests(next) {
    view.innerHTML = '<div class="page"><div class="loading">요청 이력을 불러오고 있습니다.</div></div>';
    try {
      var result = await api('/api/demo/care/requests');
      state.requests = result.requests;
      next();
    } catch (error) {
      view.innerHTML = '<div class="page"><div class="notice notice--error">' + esc(error.message) + '</div></div>';
    }
  }

  function provider() {
    loadRequests(renderProvider);
  }

  function renderProvider() {
    view.innerHTML = '<div class="page"><div class="section-head"><div><p class="eyebrow">Provider workbench</p><h1>오늘 제공할 요청</h1></div>' +
      '<p>수행기관은 승인된 요청만 받고, 수락과 실제 제공 결과를 같은 사건에 기록합니다.</p></div>' +
      '<div class="notice">합성 시연 업무함입니다. 실제 푸드마켓·돌봄SOS 시스템과 연결되어 있지 않습니다.</div>' + requestTable('provider') + '</div>';
    bindActions();
  }

  function ops() {
    loadRequests(renderOps);
  }

  function renderOps() {
    var exceptions = state.requests.filter(function (item) { return item.status === 'EXCEPTION'; }).length;
    var confirmed = state.requests.filter(function (item) { return item.status === 'RECIPIENT_CONFIRMED'; }).length;
    view.innerHTML = '<div class="page"><div class="section-head"><div><p class="eyebrow">Public operator</p><h1>정상 건은 줄이고<br>예외만 봅니다.</h1></div>' +
      '<p>담당자는 모든 요청을 다시 전달하지 않고, 계획 밖 요청·위험 신호·미수령 같은 예외와 감사 이력을 확인합니다.</p></div>' +
      '<section class="metrics"><article class="metric metric--green"><span>전체 요청</span><strong>' + state.requests.length + '</strong></article>' +
      '<article class="metric"><span>사람 확인 필요</span><strong>' + exceptions + '</strong></article>' +
      '<article class="metric"><span>수령 확인</span><strong>' + confirmed + '</strong></article>' +
      '<article class="metric"><span>승인 밖 실행</span><strong>0</strong></article></section>' + requestTable('ops') + '</div>';
    bindActions();
  }

  function requestTable(mode) {
    if (!state.requests.length) return '<div class="panel empty"><h2>아직 요청이 없습니다.</h2><p>어르신 화면에서 첫 요청을 만들어 보세요.</p><a class="btn btn--primary" href="/?v=request">요청 만들기</a></div>';
    return '<div class="table-wrap"><table><thead><tr><th>접수</th><th>이용자 요청</th><th>수행기관</th><th>상태</th><th>처리</th></tr></thead><tbody>' +
      state.requests.map(function (item) {
        return '<tr><td><span class="case-id">' + esc(item.caseId.slice(0, 18)) + '…</span><br><small>' + esc(item.preferredDate) + '</small></td>' +
          '<td><strong>' + esc(item.itemName) + '</strong><br><small>' + esc(labels[item.serviceCode]) + ' · 수량 ' + item.quantity + '</small></td>' +
          '<td>' + esc(item.providerName) + '</td><td>' + status(item.status) + '</td><td><div class="row-actions">' + actionsFor(item, mode) + '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function actionsFor(item, mode) {
    if (mode === 'provider' && item.status === 'REQUESTED') return actionButton(item.caseId, 'PROVIDER_ACCEPT', '요청 수락', 'btn--primary');
    if (mode === 'provider' && item.status === 'PROVIDER_ACCEPTED') return actionButton(item.caseId, 'MARK_PROVIDED', '제공 완료', 'btn--primary');
    if (mode === 'provider' && item.status === 'PROVIDED') return actionButton(item.caseId, 'CONFIRM_RECEIPT', '수령 확인', 'btn--accent');
    if (mode === 'ops' && !['EXCEPTION', 'RECIPIENT_CONFIRMED'].includes(item.status)) return actionButton(item.caseId, 'RAISE_EXCEPTION', '예외 이관', 'btn--danger');
    return '<span class="case-id">추가 처리 없음</span>';
  }

  function actionButton(caseId, action, label, kind) {
    return '<button type="button" class="btn ' + kind + '" data-case="' + esc(caseId) + '" data-action="' + action + '">' + label + '</button>';
  }

  function bindActions() {
    document.querySelectorAll('[data-action]').forEach(function (button) {
      button.addEventListener('click', async function () {
        button.disabled = true;
        try {
          await api('/api/demo/care/requests/' + encodeURIComponent(button.dataset.case) + '/actions', {
            method: 'POST', body: JSON.stringify({ action: button.dataset.action, reason: '담당자 검토가 필요한 합성 시연 예외' })
          });
          if (route() === 'provider') provider(); else ops();
        } catch (error) {
          alert(error.message);
          button.disabled = false;
        }
      });
    });
  }

  function demo() {
    view.innerHTML = '<div class="page"><div class="section-head"><div><p class="eyebrow">Three-minute narrative</p><h1>제도가 있어도<br>마지막 1미터가<br>남아 있습니다.</h1></div>' +
      '<p>말결은 새로운 복지제도가 아니라, 막 시행된 서울형 통합돌봄의 개인별지원계획이 어르신의 일상에서 실제 서비스로 이어지게 하는 실행 계층입니다.</p></div>' +
      '<section class="timeline">' +
      step('1', '전화 요청', '“집에 쌀이 떨어졌어요.” 앱 없이 평소 쓰던 전화로 시작합니다.') +
      step('2', '계획 확인', 'AI가 자격을 만들지 않고 승인된 서비스·횟수·수행기관만 확인합니다.') +
      step('3', '기관 전달', '정상 요청은 담당자 재입력 없이 찾아가는 푸드마켓 업무함으로 갑니다.') +
      step('4', '제공 확인', '수행기관이 수락하고 실제 제공 결과를 같은 사건 번호에 남깁니다.') +
      step('5', '수령·감사', '어르신의 수령 확인까지 남기고, 예외만 담당자에게 이관합니다.') +
      '</section><section class="demo-callout"><article><p class="eyebrow" style="color:var(--lime)">Policy ask</p><h2>서울시에 필요한 것</h2><p>전화 대리선택 실증지침, 개인별지원계획·품목 상태의 최소 데이터, 자치구 1곳의 4~8주 실증, 개인정보·성과측정 지원.</p></article>' +
      '<article><p class="eyebrow">Evidence</p><h2>무엇으로 증명하나</h2><p>공무원 개입 횟수와 처리시간, 수행기관 수락 시간, 정상 건 무개입 종결률, 실제 수령률, 승인·제공·수령 기록 일치율.</p></article></section></div>';
  }

  function step(number, title, body) {
    return '<article data-step="' + number + '"><h3>' + title + '</h3><p>' + body + '</p></article>';
  }

  function render() {
    var current = route();
    setNav(current === 'request' || current === 'success' ? 'home' : current);
    if (current === 'request') return requestView();
    if (current === 'success') return success();
    if (current === 'provider') return provider();
    if (current === 'ops') return ops();
    if (current === 'demo') return demo();
    home();
  }

  window.addEventListener('popstate', render);
  render();
}());
