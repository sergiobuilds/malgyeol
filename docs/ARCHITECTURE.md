---
doc_kind: project-material
status: working
version: 2026-09-18_v3
---

# 말결 아키텍처

## 실행 경계

현재 브랜치는 observe-only입니다. 이 문서는 코드와 검증의 관찰 기록이며 프로젝트 방향 권위를 자칭하지 않습니다. [작업 지도](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/MASTER-MAP.md), [실행계획](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/plan.md), [계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/contracts.md)을 함께 참조합니다.

## 처리 구조

시민 생활 상황 → 필요·제약 분리 → 네 사업 이용 경로 조회 → 음성 동의 → 기관 문의·조건 조율 → 기관 답변 저장 → 시민 회신·중요 조건 재선택 → 필요한 기관 재연락·담당자 개입의 구조입니다.

기관 문의·신청 의사 전달·접수·일정 확정·실제 제공은 구별합니다. 엔진의 `connected`는 경로·조건 연결이며 지원 제공 완료가 아닙니다. AI는 기관의 선정·행정 권한을 대체하지 않습니다.

## 모듈 책임

| 경로 | 책임 |
|---|---|
| `src/server.ts`, `src/careApp.ts` | HTTP 진입점·인증·라우트 결합·정적 파일 제공 |
| `src/coordination/catalog.ts`, `data/support-network.json` | 네 사업·공식 기관·관할·접수/제공 역할·절차·출처 |
| `scripts/collect-support-network.py` | 공식 원천 목록 수집·정규화 재현 |
| `src/coordination/types.ts`, `engine.ts` | 요청·복수 필요·동의·문의·시도·답변·선택·회신 |
| `src/coordination/store.ts` | SQLite `coordination_ledger`·동기 트랜잭션·복원 |
| `src/coordination/routes.ts` | 공통 조회·업무 HTTP 계약·입력과 기관 창구 검증 |
| `src/coordination/operatorSession.ts` | 담당자 HttpOnly 세션·만료·Origin·토큰 비교 |
| `scripts/coordination_voice.py` | 수신·기관 발신·시민 회신의 역할별 음성 세션 |
| `scripts/coordination_tools.py` | 역할별 도구·전사·동의·허용 전달 필드·통화 작업 기록 |
| `scripts/coordination_config.py` | 비공개 A/B 번호·허용 목록·파일 권한 검사 |
| `scripts/run-care-runtime.py` | 기존 비밀 로딩·API/구·신 음성 실행·백업 |
| `public/` | Claude 구현 KRDS 지원망·담당자 요청 화면 |
| `artifacts/hackathon/` | 정책·3분 덱 내용·LaTeX·PDF·편집본·생성기 |

## 데이터 구조

사업 ↔ 기관·사업장 ↔ 관할·목적별 연락처 ↔ 사업별 대상·이용절차를 연결합니다. 공개 원천 65행은 37개 기관으로 정규화하고 3개 보완 창구를 더한 40개 기관입니다. 전체 동주민센터 상세 확보를 주장하지 않습니다.

시민 요청 아래 여러 필요를 둡니다. 문의는 필요·기관·사업·목적·질문·요청 revision에 연결됩니다. 통화 시도는 요청·문의·멱등키·사업자 식별자·종료 결과, 답변은 조건·다음 행동·시민 선택 필요 여부를 보존합니다. 개인 통화 답변을 기관의 보편적 안내로 자동 반영하지 않습니다.

## 상태 및 동시성

- 필요: `open`, `contacting`, `awaiting-choice`, `connected`, `needs-attention`, `stopped`.
- 문의: `prepared`, `calling`, `answered`, `no-answer`, `failed`, `unknown`, `cancelled`.
- 동일 저장소 전체에서 활성 기관 통화 시도 하나. SQLite `BEGIN IMMEDIATE`로 연결 간 경쟁 통제.
- 동일 멱등키 재요청은 기존 시도 반환, 다른 요청·문의 재사용은 충돌.
- 요약 정정은 연결된 필요 보존. 실제 관할·공통 제약 변경은 revision 증가와 영향 경로 재검토.
- 중단·오래된 revision의 문의 실행·답변 반영 차단. 통화 종료 기록 자체는 보존.
- 결과 불명은 자동 재시도 차단. 담당자 `retry`는 확정된 부재·실패만 준비 상태로 전환.
- 시민 선택 저장 후 기관 후속 확인이 필요하며 선택만으로 기관 수락을 생성하지 않음.

## HTTP 및 권한

| 경로 | 기능 |
|---|---|
| `GET /api/support/programs` | 사업 목록 |
| `GET /api/support/institutions` | 사업·구·검색어 필터 |
| `GET /api/support/institutions/:id` | 기관·창구·절차·출처 |
| `/api/coordination/session` | GET 세션 조회·POST 접속·DELETE 종료 |
| `/api/coordination/requests` | GET 목록·POST 생성 |
| `/api/coordination/requests/:id` | GET 상세·PATCH 정정 |
| `/:id/consent`, `/:id/inquiries` | 동의·기관 문의 준비 |
| `/:id/inquiries/:inquiryId/attempts`, `/retry`, `/answer` | 시도 시작·수동 재시도·기관 답변 |
| `/:id/attempts/:attemptId/result` | 통화 종료 결과 |
| `/:id/needs/:needId/choice`, `/stop` | 시민 선택·필요 중단 |
| `/:id/callback`, `/:id/events` | 회신 기록·사건 조회 |

표의 `/:id`는 `/api/coordination/requests/:id` 접두부입니다. 공개 기관 조회를 제외한 업무 API는 운영자 또는 내부 agent 권한이 필요합니다.

담당자는 기존 `CARE_OPERATOR_TOKEN`으로 로그인합니다. 서버 내 무작위 세션·8시간 만료·최대128개·HttpOnly·SameSite=Strict를 사용하고 HTTPS에서는 Secure를 추가합니다. 원토큰은 브라우저 저장소·응답에 남기지 않습니다. 변경 요청의 Origin은 서버 기준과 일치해야 합니다. 기존 Bearer agent 경로는 유지합니다.

## 저장 및 복원

`COORDINATION_LEDGER_PATH` 우선, 없으면 `CARE_LEDGER_PATH`를 사용합니다. 기존 care 테이블과 신규 coordination 테이블은 분리되어 같은 DB에 공존할 수 있습니다. WAL·FULL 동기화와 원자적 스냅샷을 사용합니다. 새 음성 작업 journal은 `.private/coordination-voice.sqlite`이며 발신 맥락과 중복·결과 불명 처리를 담당합니다.

운영 환경에서 영속 경로가 없으면 업무 API를 503으로 닫습니다. 개발 인메모리는 복원 검증을 대체하지 않습니다. 자동 백업·외부 재해복구·보존삭제 운영은 후속 범위입니다.

## 음성 역할 및 실행 상태

설치 ClawOps SDK 0.56.0에서 `_open_session`이 prewarm보다 먼저 역할·허용 도구를 결박하도록 구성했습니다. 시민 접수, 기관 문의, 시민 회신은 별도 맥락을 사용합니다. 기관 응답은 통화 종료 후 결과를 대조하여 원장에 반영합니다.

회신 시작 prompt에는 요청 상세를 싣지 않습니다. 최근 실제 음성에 따른 `confirm_recipient` 확인과 시민 참조 일치 후에만 상세 조회·선택·정정·동의·완료 도구를 허용합니다. 타인·자동응답·부정 응답은 상세 공개 없이 종료하며 완료로 세지 않습니다. 이는 대화상 수신자 확인이며 OTP·공적 신원인증을 대신하지 않습니다. 해당 보완은 supervisor의 설치 SDK Python 32개 검사 재실행으로 확인했습니다.

새 런타임은 `run-care-runtime.py coordination-check`와 `coordination`입니다. 기존 18082 서비스는 `voice`의 `clawops-care-agent.py`이며 새 브리지로 전환하지 않았습니다. A/B 비공개 라우팅과 실제 양방향 전화 왕복은 아직 검증 대상입니다. SDK·대역·HTTP 통합 성공을 실통화 성공으로 계산하지 않습니다.

## 호환 모듈

`src/care-support/`, `/api/care/`, `/api/demo/care/`, `scripts/clawops-care-agent.py`는 기존 고정 시민·품목·계획 검사 흐름입니다. 회귀와 운영 복구를 위해 보존하지만 최신 MVP의 제품 정의가 아닙니다. 과거 `src/food-support/`, `src/merchant/`, `src/case-ledger/`, `src/delivery/`는 이전 기술검증입니다. 결제·배송을 새 제품에 추가하지 않습니다.

## 검증 및 후속

[실행 근거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/context.md)의 섹션4 기준 Node198·Python23·UI23+24, 실제 HTTP·SQLite·화면 동작 검증이 있습니다. 실제 전화망·기관 지원 제공은 별도 수용조건입니다.

[Future Plan](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/implementation-plan.md)에 본인 확인·대리권·장기 기억·자동 연락·담당자 인수·행정시스템 연계를 보존합니다. [정책 근거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/POLICY_BASIS.md)와 [제출물 재생성](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/artifacts/hackathon/README.md)은 별도 상세 문서입니다.
