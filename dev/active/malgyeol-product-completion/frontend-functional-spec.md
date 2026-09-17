# 말결 담당자 화면 제작 계약

## 담당 및 범위

Claude 전담 제작. public/ 안의 기존 landing.html/index.html/tech.html/landing.js/tech.js/app.js/styles.css/tokens.css/icons.js 및 assets/만 수정. 새 프레임워크 없이 실제 Node careApp에 연결. 코드 commit·push·타서비스 중지·외부 발신 금지. 최종 산출물은 기존 / 및 /app, /ops 경로에서 실제 동작하는 화면. 본 계약은 기능 요구이며 배치·와이어프레임·시각 설계는 Claude의 책임.

## 필수 근거

- https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/planning-handoff.md
- https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/contracts.md
- https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/POLICY_BASIS.md
- 실제로 위 로컬 파일과 src/coordination/types.ts/routes.ts/catalog.ts 읽기.
- 공식 KRDS clone /mnt/data/work/malgyeol-reference/krds-uiux. 디자인 근거는 공식 저장소 commit d6bb184c823e4757f05807ea4646a23e3133b6e6.
- KRDS MCP 실제 호출 필수. Claude의 krds-mcp 도구로 디자인 원칙/컴포넌트/접근성 조회. MCP값과 공식토큰 상충시 공식토큰 우선. 확인 기록 작성.

## 제품 내용

말결의 핵심은 지원사업·기관·이용방법을 연결한 데이터망을 기반으로 시민의 생활 필요에 맞는 기관에 AI가 전화하여 가능한 조건을 알아보고 조율한 뒤 시민에게 회신하고 후속 처리하는 일. 디렉터리/추천만으로 축소 금지. 담당자 화면은 지원망과 실제 요청 진행의 두 기능. 전화가 시민의 주된 입구.

네 사업 고정: 푸드뱅크·푸드마켓 / 찾아가는 푸드마켓 / 그냥드림 / 돌봄SOS. 공통 API 데이터만 사용. 가공된 성공실적·임의 시민요청 삽입 금지. 지원망은 API에 실제 40기관 및 사업별 상세 존재. 빈 요청은 적절한 안내와 실제 조회 상태로 표시.

## 지원망 기능

- 네 사업별 조회, 지역/기관 검색과 실제 결과수.
- 기관 상세: 주소·관할·사업·지원 범주·접수/제공/물류 역할·대상·준비물·절차·접근방법·운영시간·목적별 연락처·공식 출처.
- 같은시설 여러사업의 절차/시간 분리. 서울전체 안내창구의 빈주소는 방문처로 표시하지 않음.
- 데이터에 없는 지도좌표/실시간재고를 생성하지 않음. 실제 지도보다 기관 탐색/이용절차를 먼저 완성.

## 요청 진행 기능

- 담당자 접속 전에는 개인 요청 조회 금지. 접속 화면은 accessCode를 password로 입력, POST /api/coordination/session {accessCode}; success {authenticated:true}, HttpOnly cookie. 토큰 저장/localStorage/콘솔출력 금지. GET session으로 확인, DELETE session 로그아웃. root가 서버 구현중.
- GET /api/coordination/requests 목록, /:id 상세, /:id/events 이력. fetch same-origin cookie사용. 약3초 polling·탭hidden일때중단·에러와빈결과구분.
- 필요별 연결/기관연락/시민선택/다음행동을 표시. connected는 지원완료가 아니라 이용경로 연결.
- 문의별 기관명·사업명·질문·실제답변·조건·다음행동·시각·시민회신 상태.
- PATCH /:id로 요약/지역/제약 정정; 필요별 POST needs/:nid/stop; 확정 no-answer/failed만 POST inquiries/:qid/retry. 결과unknown은 자동재시도 버튼 금지.
- 중요한 선택은 시민이 결정. 담당자가 시민선택을 꾸며 입력하거나 통화완료를 만드는 버튼 금지.
- 현재API 범위외 제어 버튼/작동하지않는메뉴 생성금지. 별도 시민 앱/기관포털 금지.

## 표현 및 품질

- 모든 제목·소제목 공공기관형 명사구, 모든 UI 한국어.
- 전면 금지: 미확인/미검증/목업/시연용/연습용/합성/더미/placeholder/내부모델명·도구명·원장ID.
- 사실에 맞는 현재행동과 다음행동 표현. 개발용 경고 제거가 허위연락완료 허용을 뜻하지 않음.
- 개인정보 없는 공식출처만 외부링크; 새창은 rel noopener.
- KRDS 자체정부마크/공식정부누리집 문구 복제금지. 말결 제품표기.
- 접근성: keyboard/dialog focus/escape/명시label/status aria-live/색상외상태표현.
- 1440/768/390 가로넘침0, 상태/hover/focus/오류/빈결과/느린응답 완성. 임의 AI장식·비실행버튼·템플릿문구 제거.

## 검증 및 인계

자신이 띄운 임시 Node서버만 사용/종료, 기존18081·18082서비스는 건드리지 않음. 실제API서버 실행시 임시 SQLite와 임의 개발용 accessCode(실제토큰 금지). npm run start는 cwd repo, PORT지정. build-with-ds의 3회 실제렌더/열람/수정 준수. 반응형뿐 아니라 기관상세/검색/로그인/실제요청/정정/중단/재시도 상태 검증. 임의 API 응답대체 금지.
검증 기록은 /mnt/data/work/malgyeol-reference/frontend/에, 최종 요약에는 수정파일·KRDS MCP실호출·공식컴포넌트적용·시각검수회차·스크린샷경로·남은결함. root 최종통합검수 예정.
