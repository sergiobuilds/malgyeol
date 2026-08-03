# 말결 공개 증거

이 폴더는 제출 시점에 공개 검증할 수 있는 세 사건과 각 사건의 범위를 구분합니다.

**목차** — 1 증거 목록 · 2 해석 경계 · 3 이력

## 1 증거 목록

| 사건 | 증거 | 확인 범위 | 분류 |
|---|---|---|---|
| Vertex 음성 해석 | [g2-vertex-audio.json](g2-vertex-audio.json) | Google Cloud Vertex Gemini가 저장된 음성을 해석한 실행 기록 | 실제 클라우드 실행 |
| 제한 결제 기술 사건 | [u8-cloud-live-devnet-case.json](u8-cloud-live-devnet-case.json) | 합성 에이전트 입력, 정책, 동의, x402, Solana Devnet, 자체 샌드박스 주문 | 합성 입력 기반 기술 실증 |
| 070 전화 기술 사건 | [u9-real-phone-success.json](u9-real-phone-success.json) | 실제 070 수신, Vertex 해석, DTMF, Solana Devnet, 자체 샌드박스 주문 | 실제 통화 기반 기술 실증 |
| 식품 공급자 주문 | [공개 주문 상태 API](https://benefit-settlement-rail-tbauoylpra-uc.a.run.app/api/demo/food-order-proof) | 국내 공급자의 실제 상품 주문과 현재 배송 상태 | 실제 공급망 주문 |
| 브라우저·XLSX 결합 | [u5-live-stage-xlsx-browser.json](u5-live-stage-xlsx-browser.json) | 합성 사건의 화면·공개 투영·XLSX 결합 | 과거 합성 회귀 고정값 |
| 로컬 컨테이너 회귀 | [u6-cloud-run-evidence.json](u6-cloud-run-evidence.json) | 2026-07-31 로컬 컨테이너의 정상·차단·재생 해시 | 과거 합성 회귀 고정값 |

## 2 해석 경계

070 전화 기술 사건은 이전 보조기기 흐름입니다. 식품 공급자 주문과 다른 `caseId`를 사용합니다.

Solana 증거는 Devnet 거래입니다. Mainnet 결제나 정부자금 집행 기록이 아닙니다.

현재 공개 증거는 각 구성요소의 실행을 검증합니다. 전화부터 식품 공급자 주문과 Devnet 결제까지 이어지는 단일 사건은 후속 통합 범위입니다.

`u5`와 `u6`은 테스트가 읽는 과거 합성 고정값입니다. 현재 Cloud Run 배포 상태를 나타내지 않습니다.

## 3 이력

- 2026-08-03 v1. 공개 제출에 필요한 현행 증거만 분류했습니다.
- 2026-08-03 v1.1. 테스트용 과거 합성 고정값을 별도 분류했습니다.
