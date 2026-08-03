# 말결 · Bounded Agent Payments for Everyone

사람이 의사를 표현하면 Gemini가 실행 가능한 거래 의도로 바꾸고, 결정론적 정책과 Solana가 AI의 권한을 제한하며 구매·결제·증빙·정산까지 잇는 에이전트 결제 기반시설입니다. 디지털 약자를 첫 권리자로 삼고, 지원금은 가장 엄격한 테스트베드, 식품지원은 첫 실제 공급망 사례, 전화와 음성은 첫 인터페이스로 사용합니다.

현재 저장소에는 2026 농식품바우처 호환 품목 정책, Vertex Gemini 음성·웹 요청 해석, SpecialOffer 실상품·주문 어댑터, Firestore 사건·역할 원장, subject-bound read/act 권한, 이용자·기관 워크플로, x402·Solana Devnet 제한권한 증명, 모바일웹·PC 업무함·심사 데모가 있습니다. 195개 테스트와 typecheck를 통과한 최신 제품 프론트가 Cloud Run 리비전 `benefit-settlement-rail-00060-w98`에 배포됐습니다. 공개 루트는 5섹션 제품 스토리, `/tech`는 상세 구현과 증거, `/?v=home`과 `/?v=demo`는 실제 제품 화면을 제공합니다.

**목차** — 1 실행과 검증 · 2 실측 경계 · 3 이력

- 공개 서비스: https://benefit-settlement-rail-tbauoylpra-uc.a.run.app/
- 기술 구현: https://benefit-settlement-rail-tbauoylpra-uc.a.run.app/tech
- 제품 화면: https://benefit-settlement-rail-tbauoylpra-uc.a.run.app/?v=home
- 심사 데모: https://benefit-settlement-rail-tbauoylpra-uc.a.run.app/?v=demo
- 공개 상태 확인: https://benefit-settlement-rail-tbauoylpra-uc.a.run.app/health
- 최신 Cloud Run 리비전: `benefit-settlement-rail-00060-w98`
- 제출 발표자료: [말결 프로젝트 소개서 PDF](pitch/malgyeol-submission-deck.pdf)
- 실제 070·Devnet 기술 사건: [`proof/u9-real-phone-success.json`](proof/u9-real-phone-success.json)
- 실제 공급망 주문은 공개 서비스의 [`/api/demo/food-order-proof`](https://benefit-settlement-rail-tbauoylpra-uc.a.run.app/api/demo/food-order-proof)에서 최신 상태를 읽습니다.

## 1 실행과 검증

```bash
npm ci
npm test
npm run typecheck
npm start
```

공개 웹앱은 Vertex Gemini로 한국어 요청을 거래 의도로 구조화하고 식품지원 테스트베드의 정책 API를 읽습니다. Gemini는 정책 승인이나 결제 권한을 갖지 않습니다. 마지막 검증된 정상 탐색은 `VERTEX_GEMINI`와 `gemini-2.5-flash` provenance를 반환했고, 총기 요청은 `SKIPPED_POLICY_BOUNDARY`로 종료해 Gemini·상품 조회·결제에 도달하지 않았습니다.

화면의 공개 재생 결제는 `SIMULATED_NO_DEVNET_CREDENTIALS_*`로 표시됩니다. 인증된 전화 에이전트 브리지는 `LIVE_DEVNET_PAYMENT=1`일 때 주문별 에스크로에만 정확히 1 Circle Devnet USDC를 보낼 수 있는 Swig 제한권한 경로를 사용합니다. `GOOGLE_CLOUD_PROJECT`가 설정되면 Vertex AI Gemini 오디오 해석기를 사용하고, `CASE_REPOSITORY=firestore`이면 Firestore 사건 원장을 사용합니다. 이번 제출 경로에서 Twilio는 사용하지 않습니다.

`cloudbuild.yaml`은 검증된 이미지를 빌드·푸시합니다. Cloud Run 리비전 전환은 Secret Manager 환경을 유지할 수 있는 승인된 배포 주체가 수행합니다. 전화 HMAC, 감사 열람 토큰, Devnet 서명키는 이미지와 Git에 넣지 않습니다.

## 2 실측 경계

- [`proof/u8-cloud-live-devnet-case.json`](proof/u8-cloud-live-devnet-case.json)은 인증된 합성 에이전트 입력이 동일 `caseId`로 정책·동의·x402 Devnet 결제·자체 샌드박스 주문까지 이어졌음을 증명합니다. [Devnet Explorer](https://explorer.solana.com/tx/54qCy5me9uXHRY3QobrhFUPp6EiZ37dvUYXGw11KY4pKrmQF2Nff9dvfTHPE8vrNJtbDnaKFLFL2AynSVioNfMTQ?cluster=devnet)에서 거래를 확인할 수 있습니다.
- [`proof/u9-real-phone-success.json`](proof/u9-real-phone-success.json)은 한국 070 실전화가 동일 `caseId`로 Vertex 해석·DTMF·Devnet·자체 샌드박스 주문까지 이어진 기록입니다. [Devnet Explorer](https://explorer.solana.com/tx/52ythTGiyTLbsQVQRmHJmHtVVDzVW9UrPxvjcF1Mq3Sb9bGZD7gZyHsawr5RaY7PMfL5URdsSF2T6mBTejqUCXBX?cluster=devnet)에서 거래를 확인할 수 있습니다. 이 기록은 이전 보조기기 흐름이며 외부 식료품 공급사 주문 증거가 아닙니다.
- 식료품 실주문 `585492`는 `web_real_food_20260801_01`에서 국내산 모듬잡곡 700g 1개, 총 12,300원으로 접수됐습니다. 외부 주문번호는 `26080121204025`, 상태는 `PREPARING`입니다. 택배사와 송장번호는 아직 없습니다.
- 식료품 실주문과 위 Devnet 기술 사건은 서로 다른 `caseId`입니다. 전화부터 실제 식품 주문과 Devnet 거래까지 하나로 연결됐다고 주장하지 않습니다.
- 심사 화면은 공식 네 기준, 버튼으로 실행하는 Gemini·가드레일 실측, 합성 시나리오 세 개, 실주문·Devnet 분리 레일과 남은 동일 `caseId` 이음매를 표시합니다.
- Solana는 Devnet이며 Mainnet이나 실가치 정부자금 결제가 아닙니다.
- 현행 Solana 실증은 자산·목적지·누적 금액 제한입니다. 사용자·목적·품목·판매자·시간·횟수는 정책·동의·범위 토큰·사건 원장이 함께 제한하며 전부 온체인이라고 주장하지 않습니다.
- 배송 후 release/refund 모듈은 별도 기술증명이며 현재 전화 핵심 흐름의 완료 주장에 포함하지 않습니다.

품목 정책은 농식품바우처 공식 플랫폼의 공개 기준을 호환 규칙으로 사용합니다. 현 집행 자금은 정부 바우처가 아니라 기관·재단·기업의 자체 식품지원 예산을 가정하며, 공식 카드 결제나 지정몰 제휴로 표시하지 않습니다.

## 3 이력

- 2026-07-30 — 제한권한형 에이전트 결제 제품 구현을 시작했습니다.
- 2026-07-31 — 비제휴 합성 전화 구매 E2E 데모를 추가했습니다.
- 2026-08-01 — 농식품바우처 호환 식품지원 제품과 모바일웹으로 전환했습니다.
- 2026-08-01 — SpecialOffer 판매회원과 실상품 API를 연결했습니다.
- 2026-08-01 — 동일 caseId 유료행동 게이트로 실제 주문 `585492`를 접수하고 공급자 잔액과 주문 상태를 재검증했습니다.
- 2026-08-01 — Vertex Gemini 웹 해석과 Design Forge + WDS 실상품 모바일 주문·조회 흐름을 배포하고 개인정보·위험품목의 Gemini 사전 차단 경계를 검증했습니다.
- 2026-08-02 — Design Forge + WDS 심사 화면, Gemini·가드레일 실측, 분리된 실주문·Devnet 레일, 170개 테스트와 Cloud Run `00057-qqs`를 반영했습니다.
- 2026-08-03 — 제품 위계를 제한권한형 에이전트 결제 기반시설로 정리하고 195개 테스트를 통과했습니다.
- 2026-08-03 — 5섹션 메인과 별도 기술 페이지를 Cloud Run `00060-w98`에 배포하고 세 뷰포트 공개 readback을 통과했습니다.
- 2026-08-03 — 정부보조금 전문 회계사가 현장에서 이 문제를 시작한 창업자 원점을 제출 덱 전면부에 추가했습니다.
