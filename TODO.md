# 말결 구현 TODO

2026-09-17 실행 계약 기준입니다. 현재 브랜치는 observe-only이며 managed 완료로 판정하지 않습니다. 실제 수신·기관 제공 증거와 합성 검증은 별개입니다. 섹션별 Codex 리뷰와 self-check는 [실행 기록](dev/active/care-phone-recovery/care-phone-recovery-context.md)에 있습니다.

## P0. 전화 대화 복구

- [x] 기본 런타임은 `src/server.ts` → `careApp.ts`. ClawOps SDK → 인증된 care-agent API → 통화 coordinator에 연결. 레거시 구매 경로 제외.
- [x] 시나리오는 연습용 쌀 4kg 1포·선택 시 고정한 제공일·숫자키 1 확인. 위험·주소·계획 밖 요청은 자동 접수 차단. `tests/voice/carePhone.test.ts`.
- [x] 공식 번호 GET 빈 목록 → POST 201 → GET 1개 확인. 번호 07052767277. SDK 제어 연결과 health 준비 상태 확인. [운영 절차](README.md#전화-운영과-복구).
- [x] 통화별 토큰·명시 승인 전 0건·replay 1건·취소·만료·위험 혼합 발화 검증. `tests/voice/carePhone.test.ts`, `tests/http/careApp.test.ts`.
- [ ] 실제 수신 통화 1회, Call ID·비식별 대화·발화·승인·caseId 증거. 외부 전화 사건 미확보. 제어 연결 ready는 실제 통화 성공이 아님.
- [ ] 실제 등록 이용자의 계획 연결. 현재 모든 전화는 합성 계획이며 첫 안내에서 연습용임을 고지.

## P1. 정책 기반 수행기관 전달

기존 민간 로컬업체 구매 항목은 사용자 계약에 따라 승인 수행기관 요청·응답·readback으로 이행합니다. 공공 공급 불가와 자치구 승인 없는 민간 구매는 실행하지 않습니다.

- [x] 확인된 같은 caseId를 수행기관 어댑터에 전달. `src/care-support/provider.ts`, `careApp.ts`.
- [x] 합성 품목·수량·기관 범위 확인. `service.ts`의 명시적 SYNTHETIC 카탈로그.
- [x] 전달 예약 후 1회 submit, 응답 식별자·품목·수량·readback 기록. `tests/http/careProvider.test.ts`.
- [x] 동시 전달·실제 deadline·응답 소실 후 재전송 0·늦은 응답의 담당자 예외 보존 검증.
- [ ] 실제 협약기관 카탈로그·전달·수락·제공. 계약 기관 연결이 없어서 어댑터는 SANDBOX만 지원.
- [ ] 사용자 확인 납작보리쌀 실제 주문 원본. 기존 배포 readback은 모듬잡곡 700g 1개, SPECIAL_OFFER_LIVE, 준비 중, 송장 없음으로 품목이 다름. [비식별 기술 증거](dev/active/care-phone-recovery/evidence.json)에 별도 보존.

## P2. 하나의 사건 기록과 예외 이관

- [x] 같은 caseId로 REQUESTED → CONFIRMED → PROVIDER_SUBMITTED → PROVIDER_ACCEPTED → PROVIDED → RECIPIENT_CONFIRMED. 예외는 EXCEPTION. `tests/http/careAuthorization.test.ts`.
- [x] 요청 전 통화 예외와 요청 후 기관 timeout·안전 보류를 담당자 업무함 API로 조회. `/api/care/inbox`.
- [x] 정상 연습용 요청은 확인 후 샌드박스에 자동 전달. 제공·수령은 각 역할이 명시 기록하며 실제 결과를 생성하지 않음.
- [x] SQLite 원장·누적 수량 한도·멱등키·동시 연결·재시작·역할별 접근 검증. `tests/http/carePersistence.test.ts`.
- [x] 공개 데모 데이터와 전화 사건 분리. 인증 없는 요청·역할 오용 차단. `tests/http/careAuthorization.test.ts`.
- [ ] 실제 기관 사용자 인증·수혜자별 계획·수량/횟수/기간 복합 한도 연결, 개인정보 분리 암호화·보존 정책. 현재 합성 이용자 1명 범위.
- [ ] 실제 담당자 연락처·통화 전환. 현재 업무함 기록만 가능하며 자동 연락 완료로 안내하지 않음.

## P3. 운영·증거 패키지

- [x] 환경변수·비밀 경로·번호·시작·health·로그·재시작·수동 전환을 README와 `.env.example`에 기록. 비밀값 제외.
- [x] Campbell API/음성 user transient service 실행. 기존 18080 컨테이너 보존.
- [x] 실제 발급/제어 연결과 로컬 합성 검증을 증거 패키지에서 분리.
- [ ] 실제 전화·기관 제공·수령 증거를 패키지에 추가. 외부 사건 미확보.
- [ ] 자동 백업·재부팅 자동 시작·공유 영속 저장소 운영. 현재 Campbell SQLite이며 transient service는 재부팅 후 다시 시작 필요.
- [ ] P0~P3 실제 증거 후 방향 정본의 완료 상태 반영. 지금은 외부 blocked이고 observe-only라 완료 전이하지 않음.

## 후순위

- [ ] 이용자·수행기관·담당자 화면의 최종 design-forge 전환. 기존 dirty 화면은 보존·QA하며 새 화면 구현은 전화·기관 실증 선행조건이 남아 후순위.
- [ ] 3분 데모·발표 화면·접근성 최종 보정. 현재 화면은 합성 데모, 실제 현장 성과로 발표하지 않음.
- [x] 서울시 정책·데이터·실증환경·지원 제안은 `POLICY_BASIS.md`와 `docs/AI_FOR_GOOD_SUBMISSION.md`에 반영되어 있음.
- [ ] 실증 제안서·발표의 최종 리허설과 현장 승인. 자치구·협약기관 미확정.

## 최종 검증

- [x] `npm run verify`: 171 tests PASS, dependency audit 취약점 0. 인사·응답은 대화를 유지하지만 숫자키 승인 전 접수하지 않는 회귀 포함.
- [x] `project-doctor`: observe-only PASS, dirty 경고는 저장 전 상태.
- [ ] 실제 전화·제공·수령 1회 완료. 합성 테스트로 대체하지 않음.
- [x] 최종 독립 리뷰·비밀/PII 검사·commit 직후 push. 소스 d994650, Cloud Run 00063-x6z. 최종 기록은 실행 기록 참조.
