# 말결 통합 검증 기록

## 1. 판정 범위

검증 기준: [실행계획](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/plan.md), [전화 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/phone-goal-prompt.md), [전체 실행계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/full-product-goal-prompt.md).

환경: Campbell, Node.js 22·TypeScript·SQLite·Python, 설치된 ClawOps SDK 0.56.0. 브랜치 `feat/ai-for-good-product`, 라우터 `observe-only`. 현행 작업 지도를 프로젝트 방향 권위로 확대하지 않음.

섹션 1~4 저장 커밋: `1514c93`. 아래 자동 검사와 화면 검증은 실제 전화망 왕복의 증거를 대신하지 않음. 전체 완료 판정은 실통화 수용검사와 별도 구분.

## 2. 자동 검사

| 검사 | 섹션 4 결과 | 주요 확인사항 |
|---|---|---|
| `npm run verify` | 198건 통과, 실패·건너뜀 0 | TypeScript, 실제 HTTP, SQLite, 권한, 요청 처리, dependency audit |
| 설치 SDK Python 검사 | 23건 통과 | 역할 결박, 동의, 문의·답변·회신, 복구, 등록 외 발신 차단 |
| Claude 브라우저 회귀 | 24건 통과 | 로그인, 정정, 중단, 수동 재시도, 오류, 요청별 이력 |
| Claude 보완 브라우저 검사 | 23건 통과 | 내부 식별자 비노출, 명사형 제목, 결과불명 후속 행동, 키보드 탭 |
| 공개 데이터 | 65개 목록 원천행, 40개 기관·창구 | 목록 정규화 37개 및 운영·접수창구 보완 3개 |

코드 근거: [요청 처리 검사](https://github.com/sergiobuilds/malgyeol/tree/feat/ai-for-good-product/tests/coordination), [음성 검사](https://github.com/sergiobuilds/malgyeol/tree/feat/ai-for-good-product/tests/python), [공개 데이터 수집기](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/scripts/collect-support-network.py).

섹션 5 수신자 보호 보완 후 설치 SDK Python 32건을 supervisor가 재실행하여 통과. 기존 23건에 수신자 확인·정보 공개 차단·부정 응답 9건 추가. 섹션 4 시점의 검사 수와 구분.

## 3. 업무 및 저장 일치

- 실제 Node HTTP 서버와 임시 SQLite를 사용한 생성·조회·정정·필요별 중단·재시도 검사.
- 서버 재시작 이후 요청 복원, 복수 필요의 독립 진행, 서로 다른 요청의 정보 분리.
- 동의 이전 기관 문의 실행 차단, revision 변경 후 이전 동의·문의의 재사용 차단.
- 요청 요약만 바뀐 경우 기존 기관 답변 보존, 실제 조건이 바뀐 경우 영향받는 문의 재검토.
- 한 통화 제약과 중복 실행 방지. 전달 결과가 불명확한 문의의 자동 재발신 차단.
- 기관 역할의 비공개 수신 경로가 없더라도 다른 필요의 이미 확보된 결과 회신은 유지.
- 시민 선택을 필요로 하는 결과를 기관의 긍정 답변만으로 확정하지 않음.

계약: [API·상태 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/contracts.md).

## 4. 프론트 검증

Claude가 design-forge와 실제 KRDS MCP 호출을 통해 구현. 공식 KRDS 커밋 `d6bb184c823e4757f05807ea4646a23e3133b6e6`의 토큰과 Pretendard GOV 적용. MCP 응답과 공식 토큰의 차이는 공식 토큰을 기준으로 처리. MCP 접근성 점수는 해당 입력 HTML의 검사 결과이며 제품 전체의 공식 인증을 뜻하지 않음.

Supervisor의 실제 브라우저 확인:

- 서울 기관 목록, 성동구 검색 및 기관 상세·사업별 이용절차.
- HttpOnly 담당자 접속, 비인증 요청 차단, 브라우저 저장소의 접속 토큰 비보존.
- 요청 내용 정정 후 HTTP 조회 및 SQLite 반영.
- 기관 부재 후 수동 재시도와 다른 필요의 상태 유지.
- 식사 경로 연결·생필품 시민 선택·돌봄 기관 부재의 요청별 표시.
- 내부 시민 참조값 비노출, 키보드 End 이동 및 단일 선택 탭.
- 1440·768·390 화면에서 가로 넘침 없음. 브라우저 오류 없음.

전화 응답별 화면 검증에는 격리된 QA 서버에서 API로 구성한 요청을 사용. 실제 프론트와 저장 구조를 검증한 자료이며, 공공기관 참여나 실제 전화 성공의 증거로 집계하지 않음.

근거: [프론트 기능 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/frontend-functional-spec.md), [보존 캡처](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/artifacts/hackathon/assets/frontend-request-partial.png).

## 5. 제출물 검증

| 산출물 | 확인 결과 |
|---|---|
| 정책 제안서 | 6쪽 PDF, 편집 가능한 DOCX, LaTeX 원본 |
| 발표 덱 | 본편 6장, 180초 구성, PPTX·PDF·LaTeX |
| 내용 일치 | 제안서 본문·표 대조 225건, 원문 표 셀 누락 0 |
| 시각 검사 | 전 페이지 렌더, 본문 색상 누출·고립된 표 행·글 넘침 수정 |
| 서체 | Pretendard GOV, 법령명 `ㆍ` 한 글자만 Noto 대체 |
| 편집성 | PPTX 텍스트·도형 편집 가능, 페이지 전체 이미지 대체 없음 |
| 제외 항목 | 발표 대본·내레이션·발표자 노트 없음 |
| 재생성 | 저장소 내 캡처·서체 보존, 별도 복사본에서 생성물 삭제 후 재생성 |

실측 과정에서 발견한 표 셀 누락 194건은 생성기의 일반 표 렌더를 추가하여 수정. 검사 기대값을 삭제하거나 누락된 원문을 축약하여 통과시키지 않음.

근거: [제작·재생성 기록](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/artifacts/hackathon/README.md), [정책 원문](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/AI_FOR_GOOD_SUBMISSION.md), [정책 근거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/POLICY_BASIS.md).

## 6. 실제 전화 수용검사

| 시나리오 | 현재 판정 | 필요한 증거 |
|---|---|---|
| A 수신 → 서비스 → B 기관 역할 → A 회신 | 대기 | 실제 첫 인사·양방향 음성·기관 응답·시민 회신 |
| 복수 필요의 부분 해결 | 대기 | 연결된 필요 유지와 남은 필요의 실제 후속 통화 |
| 중요 조건 변경·재선택 | 대기 | 시민 선택 후 기관 재연락과 동일 요청의 기록 |
| 기관 부재·수동 재시도 | 대기 | 실제 부재 사건, 수동 재시도 1회, 중복 발신 없음 |

2026-09-18 섹션 5 진입 후 `python3 scripts/run-care-runtime.py coordination-check` 실행 결과: `ROUTING_FILE_REQUIRED`. A/B 허용 번호와 역할별 매핑을 담은 비공개 설정이 없음. 공개 기관 번호를 시험 번호로 사용하지 않음.

기존 18082 음성 서비스는 이전 `clawops-care-agent.py` 런타임. 새로운 `coordination_voice.py`로 전환하지 않았음. 다른 세션 서비스의 종료 금지 계약을 유지하며, 실제 전환과 역할 수신 자원을 확보한 후 위 시나리오를 수행. 등록 자원 조사·SDK 시험·health 응답을 실통화 완료로 표시하지 않음.

## 7. 사고 및 조치

- Manyfast 프로젝트 선택 오류로 말결 외 프로젝트의 PRD 5개 섹션이 잘못 변경됨. 추가 쓰기를 중지하고 원문 복구를 조사했으나 직전 원문 확보에 이르지 못함. 다른 데이터까지 되돌리는 전체 버전 복원은 수행하지 않음. 원문 복구는 남은 사고 조치이며, 말결 PRD의 정상 저장과 구분.
- 프론트 작업자의 광범위한 프로세스 종료 명령으로 기존 18081 API가 중지됨. Supervisor가 기존 launcher와 unit 설정으로 복구. health 200, 비인증 접근 403, API·음성 active, SQLite `integrity_check=ok` 확인. 이후 임시 프로세스 정리는 직접 시작한 개별 PID로 한정.
- 사용자에게 두 사고를 보고. 다른 프로젝트의 원문·개인번호·인증값·복구 자료는 공개 저장소에 포함하지 않음.

## 8. 최종 리뷰 및 잔여 조건

외부 Codex 리뷰 1회를 실행했으나 sandbox의 `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` 오류로 소스 열람 전에 종료. 리뷰 통과 또는 결함 0건으로 판정하지 않음. 총 1회 계약에 따라 추가 호출하지 않음. Supervisor 최종 자체 검사: Node 198건·Python 32건, typecheck·dependency audit, 산출물 6쪽/6장·표 셀 누락 0·페이지 밖 텍스트 0 통과. 실통화 수용검사와 별도 프로젝트 원문 복구는 잔여 조건으로 유지.
