---
doc_kind: project-material
status: working
version: 2026-09-17_v2
canonical_path: /home/campbell/projects/personal/products/malgyeol/docs/ARCHITECTURE.md
---

# 말결 아키텍처

> 방향·범위·상태는 [`docs/MASTER-MAP.md`](MASTER-MAP.md)를 따른다. 이 문서는 구현 구조와 전환 경계를 설명한다.

## 현행 제품 흐름

```text
전화·웹 요청
→ 자연어를 서비스 요청으로 구조화
→ 기존 개인별지원계획 범위 확인
→ 이용자가 품목·수량·제공일 재확인
→ 승인된 수행기관 업무함으로 전달
→ 수행기관 수락·제공
→ 이용자 수령 확인
→ 정상 종결 또는 담당자 예외 이관
```

## 권한 분리

- **AI 해석기:** 이용자의 말을 서비스 종류·품목·수량·희망일로 구조화한다. 신규 자격과 급여를 결정하지 않는다.
- **계획 규칙:** 승인된 서비스·횟수·기간·수행기관인지 결정형 규칙으로 확인한다.
- **이용자 확인:** 실제 전달 전에 품목·수량·제공일을 다시 듣고 확인한다.
- **수행기관:** 요청을 수락하고 제공 결과를 기록한다.
- **담당자:** 계획 변경, 위험 신호, 품절 대체, 미수령과 분쟁 같은 예외만 처리한다.
- **사건 원장:** 요청·수락·제공·수령·예외를 덮어쓰지 않고 순서대로 기록한다.

## 현행 모듈

| 경로 | 책임 | 상태 |
|---|---|---|
| `src/care-support/` | 결제 없는 통합돌봄 요청·계획 확인·상태 전이 | active |
| `src/http/careRequestRoutes.ts` | 합성 시연용 돌봄 요청 API | active |
| `public/` | 어르신·수행기관·담당자·발표 화면 | active |
| `src/care-support/sqliteRepository.ts` | 통화·누적 한도·사건·순서 이력의 SQLite 원자적 저장 | active, Campbell |
| `src/voice/careVoiceRoutes.ts` | 통화별 확인 토큰·재전송·취소 검증 | active, Twilio 호환 |
| `scripts/clawops-care-agent.py` | ClawOps SDK와 기존 Gemini 실시간 음성 연결 | active, 실제 수신 미확인 |
| `src/care-support/provider.ts` | 승인 기관 범위·전송 예약·timeout·readback | active, SANDBOX |
| `src/case-ledger/`, `src/delivery/` | 이전 제품 원장·배송 증빙 | legacy, 기본 서버 미연결 |
| `src/food-support/` | 과거 식품 주문·지원금 실험 | deprecated |
| `src/merchant/` | 과거 공급자 주문 샌드박스 | deprecated |
| `src/e2e/` 결제·상품 주문 경로 | 과거 공급자 연동 기술검증 | deprecated |
| `src/legacy/` | 과거 기관 내보내기 호환 | legacy |

## 기본 런타임 경계

- 프로덕션 진입점 `src/server.ts`는 결제·상점 모듈을 불러오지 않는 `src/careApp.ts`만 실행한다.
- 공개 제품 화면은 `/api/demo/care/` 경로만 사용한다.
- 합성 시연 사건은 `SYNTHETIC_DEMO`로 표시한다.
- 현행 제품 흐름은 이용자 결제, 잔액 차감 또는 유료 주문을 호출하지 않는다.
- 과거 `src/app.ts`, `src/e2e/`, `src/food-support/`, `src/merchant/`는 기술검증 재현용 비활성 레거시다. 기본 서버에 마운트되지 않는다.

## 전화 전환

전화사업자 웹훅은 다음 흐름으로 전환한다.

```text
통화 수신 → 서비스 필요 발화 → 계획 범위 확인 → 음성 재확인
→ 수행기관 요청 생성 → 사건 번호 안내
```

전화에서는 주소·자격·계획 변경을 처리하지 않는다. 건강 이상·학대·자해 위험, 계획 밖 요청과 반복 무응답은 담당자에게 이관한다.

## 실증 전 보강

- Campbell SQLite의 자동 백업·복구 운영 검증과 배포용 공유 영속 저장소
- 현재 합성 역할 토큰을 실제 기관·이용자 인증에 연결
- 개인별지원계획 최소 데이터 어댑터
- 수행기관 품목·제공 가능 상태 어댑터
- 전화번호와 배송정보의 분리 암호화·보존기간·삭제
- 실제 수행기관의 멱등키·readback 계약 확인
- 백업·복구와 운영자 감사 내보내기

## 주장 경계

현재 자동 테스트와 로컬 합성 시연으로 확인할 수 있는 것은 요청 생성, 계획 범위 차단, 수행기관 수락, 제공, 수령, 예외 이력이다. 실제 서울시·자치구 시스템, 푸드마켓 재고, 실제 개인별지원계획과 수혜자 개인정보는 연결되어 있지 않다.
