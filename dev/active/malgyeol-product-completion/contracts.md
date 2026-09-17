# 말결 공통 구현 계약

섹션 2 병렬 작업자의 타입·파일 소유권·API 결합 기준.

## 파일 소유권

| 담당 | 파일 |
|---|---|
| 데이터 작업자 | `src/coordination/catalog.ts`, `data/support-network.json`, `scripts/collect-support-network.py`, `tests/coordination/catalog.test.ts` |
| 도메인 작업자 | `src/coordination/engine.ts`, `src/coordination/store.ts`, `tests/coordination/engine.test.ts` |
| supervisor | `src/coordination/types.ts`, `src/coordination/routes.ts`, `src/careApp.ts`, HTTP tests |
| 전화 작업자 | 섹션 3의 `scripts/coordination_voice.py`, 역할 도구·실행 연결 및 Python tests |
| Claude | 섹션 4의 `public/` 및 디자인 산출물 |

## 데이터 계약

ProgramId: `foodbank-market | mobile-market | just-dream | care-sos`.
Institution: id/name/address/district/roles/contacts/programs/sources.
ProgramOffering: programId/categories/eligibility/steps/access/hours/sources.
Source: url/title/checkedAt. Contact: purpose/phone. 공개 연락처와 개인/시험 라우팅 분리.
catalog.ts: `listInstitutions(filters?: {programId?: ProgramId; district?: string; query?: string}): Institution[]`; `getInstitution(id: string): Institution | undefined`; `listPrograms(): {id:ProgramId; name:string}[]`.

## 업무 계약

`CoordinationEngine(store: CoordinationStore)`는 동기 SQLite transaction 기반.
`createRequest(input: CreateRequestInput): SupportRequest`; `listRequests(): SupportRequest[]`; `getRequest(id:string): SupportRequest | undefined`.
`recordConsent(requestId:string,input: ConsentInput): SupportRequest`.
`addInquiry(requestId:string,input: InquiryInput): Inquiry`.
`startAttempt(requestId:string,inquiryId:string,idempotencyKey:string): CallAttempt`.
`finishAttempt(requestId:string,attemptId:string,input: AttemptResult): SupportRequest`.
`recordAnswer(requestId:string,inquiryId:string,input: AnswerInput): SupportRequest`.
`recordChoice(requestId:string,needId:string,choice:string): SupportRequest`.
`reviseRequest(requestId:string,input:{summary?:string; constraints?:string[]; district?:string}): SupportRequest`.
`stopNeed(requestId:string,needId:string): SupportRequest`.
`recordCallback(requestId:string,input:{status:'completed'|'no-answer'|'failed';summary:string}): SupportRequest`.
`events(requestId:string): CoordinationEvent[]`.
store.ts exports `CoordinationStore(path: string = ':memory:')`, close(). Store implementation may expose internal transaction helpers but no test-only APIs.

## HTTP 계약

GET `/api/support/programs`, `/api/support/institutions?programId=&district=&query=`, `/api/support/institutions/:id`: 공개기관 정보.
`/api/coordination/requests` GET/POST 및 `/:id` GET/PATCH: 담당자 토큰 또는 내부 agent 토큰 필요.
POST `/:id/consent`, `/:id/inquiries`, `/:id/inquiries/:inquiryId/attempts`, `/:id/attempts/:attemptId/result`, `/:id/inquiries/:inquiryId/answer`, `/:id/needs/:needId/choice`, `/:id/needs/:needId/stop`, `/:id/callback`.
GET `/:id/events`. 성공 응답 `{request}` / `{requests}` / `{inquiry}` / `{attempt}` / `{events}`. 오류 `{error:{code,message}}`, 입력400/권한403/없음404/상태409.
개인 전화번호는 API/공개 데이터에 저장하지 않음. 런타임 routing key만 결박. 역할별 통화 실행은 서버가 허용번호로 해석.

## 상태 및 완료 기준

필요별 `open | contacting | awaiting-choice | connected | needs-attention | stopped`. connected는 이용 경로/기관 조건 연결이며 실제 제공 완료 아님.
문의별 `prepared | calling | answered | no-answer | failed | unknown | cancelled`.
통화시도 `started | completed | no-answer | failed | unknown`.
한 active attempt만, 동의 범위 확인, 요청 revision 바뀌면 prepared inquiry stale 실행 차단, 결과불명 attempt 자동 반복 차단. 기관 거절은 해당 need만 변경. 비용/일정/방식 중요변경 requiresChoice이면 시민 choice 전 connected 금지.

## 명시 재시도

POST `/:id/inquiries/:inquiryId/retry`는 확정 부재/실패만 prepared로 되돌림. worker는 prepared만 실행하며 failed/no-answer 자동재발신 금지. 결과불명/중단/오래된 revision은 재시도 금지. engine.retryInquiry(requestId,inquiryId):SupportRequest.
