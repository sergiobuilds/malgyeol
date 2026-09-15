# 말결 구조

## 제품 흐름

```text
전화·웹 입력
  → Gemini 의도 구조화
  → 결정론적 정책 검사
  → 사용자 확인
  → 범위 제한 결제
  → 공급자 주문
  → 증빙·대사
```

Gemini는 입력을 거래 의도로 바꿉니다. 품목 허용, 예산, 중복, 결제 권한과 주문 실행 여부는 코드와 사용자 확인이 결정합니다.

## 현행 모듈

| 경로 | 책임 |
|---|---|
| `src/food-support/` | 식품지원 대화, 정책, 예산, 실제 상품·주문 연결 |
| `src/case-ledger/` | 사건 상태, 불변 hash chain, 재생 방지 |
| `src/http/` | 공개·기관·운영자 API와 권한 경계 |
| `src/voice/` | ClawOps·Twilio 서명 검증과 전화 입력 |
| `src/merchant/` | 공급자 sandbox와 상태 저장 |
| `src/e2e/` | 현행 결합 흐름과 provider 계약 |
| `src/g4/`, `src/g5/`, `src/g6/` | x402·Swig·에스크로·배송 정산 기술 증명 |
| `src/legacy/` | 현행 API가 계속 사용하는 기관 XLSX 출력. 이름만 과거 표기이며 미사용 코드는 아님 |
| `programs/benefit-escrow/` | Anchor 기반 Devnet 에스크로 프로그램 |
| `public/` | 제품 소개, 기술 페이지, 사용자·심사 화면 |
| `proof/` | 공개 검증 사건과 주장 경계 |

## 증거 ID

`G2`~`G6`, `U3`~`U9`는 2026년 제출 과정에서 고정한 증거 ID입니다. 숫자가 최신 순서나 구현 우선순위를 뜻하지 않습니다. 기존 JSON, Explorer 링크와 검증 hash의 참조를 깨지 않기 위해 이름을 유지합니다.

| 묶음 | 의미 |
|---|---|
| `G2` | Vertex Gemini 음성 해석 |
| `G3`~`G5` | Swig, x402, Solana Devnet 제한권한과 에스크로 |
| `G6` | 이중 배송 증거와 release 경계 |
| `U5`~`U6` | 브라우저·XLSX, 컨테이너 회귀 고정값 |
| `U8` | 합성 입력 기반 Cloud Run·Devnet 결합 사건 |
| `U9` | 실제 070 입력 기반 Devnet 기술 사건 |

## 이름 경계

- 제품·저장소·npm 패키지: `malgyeol`
- `benefit-settlement-rail`: 기존 Cloud Run 서비스, 이전 공개 URL, protocol hash에 남는 호환 식별자
- Anchor crate `benefit-escrow`: 온체인 프로그램 identity

기존 배포명이나 protocol hash를 일괄 변경하지 않습니다. 새 코드와 새 빌드 산출물은 `malgyeol`을 사용하고, 이전 증거는 당시 이름을 그대로 보존합니다.

## 실제와 합성의 경계

- `proof/u8-cloud-live-devnet-case.json`: 합성 입력, Devnet, 자체 주문 sandbox
- `proof/u9-real-phone-success.json`: 실제 070 수신, Devnet, 자체 주문 sandbox
- `/api/demo/food-order-proof`: 실제 공급자 주문
- 전화, 실제 공급자 주문, Devnet 거래가 모두 같은 `caseId`로 이어진 사건은 아직 없음

상세 주장은 [`../README.md`](../README.md)와 [`../proof/README.md`](../proof/README.md)를 기준으로 확인합니다.
