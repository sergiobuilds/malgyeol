# 전화 시연 구현 인계

## 구현 상태

이 PR은 **모의 기관을 사용하는 전화 시연 구현**입니다. 실서비스 전체 완료가 아닙니다. 실제 운영 번호에 배포하지 않았으며, 사용자가 기존 번호에서 AI 서버 연결 오류를 관찰했습니다.

고객 전화 → 인터뷰 → 요구조건 Seed 확인·수정·DTMF 승인 → 통화 종료 → 빠른 모의 기관 문의·계획·검증·신청·기록 → AI 고객 콜백을 구현했습니다. 기존 상품 주문 경로를 호출하지 않습니다. 기관 문의·신청 결과는 SIMULATION입니다.

## 실서비스에 남은 부분

- 실제 기관 통화 응답을 새 실행·검증 데이터 계약으로 변환하는 어댑터.
- 실제 기관 신청·접수 증거의 수집과 검증 연동.
- 운영 음성 서버 연결 복구와 새 코드 반영, 고객 실제 통화·콜백 검증.
- 미래 예약 시각의 자동 재발신 scheduler. 현재는 고객 동의와 시연 예약만 저장합니다.

PR #14의 기존 실제 기관 전화 코드는 보존하지만 새 Seed/EV 흐름에 연결한 것은 아닙니다.

## 기준과 코드

기준은 PR #14 `feat/ai-for-good-product`의 `000a08c2ab5bb5d3f6affd7dc717fb0a11622756`입니다. master에 바로 적용하는 변경이 아닙니다.

- `src/demo-workflow/`: 명세·승인·병렬 모의 문의·계획·EV1·모의 신청·SQLite 기록·EV2·회신 상태.
- `scripts/demo_voice.py`: 기존 SDK/등록 고객 라우팅을 재사용하는 인터뷰·승인·종료·콜백.
- `src/careApp.ts`: 인증된 내부 HTTP 경로, 명시적 시연 활성화.
- `scripts/coordination_voice.py`: 기존 모드와 시연 모드 선택.
- [변경 내역](changes.md), [코드 원문 묶음](code-bundle.md), [코드 해시](source-sha256.json).

## 설정

기존 비공개 인증·고객 번호 라우팅·Gemini 환경을 사용합니다. 비밀값을 이 PR에 포함하지 않습니다.

```dotenv
# API process
DEMO_WORKFLOW_ENABLED=true
DEMO_WORKFLOW_LEDGER_PATH=.private/phone-demo-workflow.sqlite
DEMO_WORKFLOW_SCENARIO=success
# Voice process
COORDINATION_DEMO_MODE=1
```

`unavailable`은 지원 불가, `no-answer`는 미응답 시연입니다. 기본값은 시연 비활성으로 기존 모드를 유지합니다. 기존 실행 명령은 `python3 scripts/run-care-runtime.py api`와 `python3 scripts/run-care-runtime.py coordination`입니다. 동일 번호에 음성 프로세스를 중복 실행하지 마세요. launcher는 기존 A/B 라우팅 사전 검사를 유지하나, 새 시연 코드는 실제 기관 역할 B로 발신하지 않습니다.

## 검증 결과와 한계

- Node 22 `npm run verify`: 219/219 PASS, typecheck PASS, 알려진 의존성 취약점 0.
- Python + ClawOps 0.56.0: 38/38 PASS.
- 독립 새 흐름 검사 9/9 PASS(Node 전체에 포함).
- 실제 로컬 HTTP ↔ Python ↔ SQLite 성공/불가 2/2 PASS. 전화 전송만 fake, 실제 통화 0회.
- 새 체크아웃에 patch를 적용한 뒤 변경 소스 15개 SHA256이 검증된 로컬 코드와 일치함을 확인.

검증은 실제 기관 제공, 실제 전화망 성공, 실제 배송을 증명하지 않습니다. 운영 접속 경로가 아직 확보되지 않았습니다. 자동 회신 실패·모호한 접수는 무작정 재발신/재신청하지 않고 확인이 필요한 상태로 보존합니다.

## 운영 위치 단서

저장소와 PR/이력 조사에서 Campbell의 `~/projects/personal/products/malgyeol`, `malgyeol-care-api`, `malgyeol-care-voice`, 내부 API18081/음성health18083을 확인했습니다. SSH 주소/IP는 조사 범위에서 찾지 못했습니다. 기존 비공개 설정 위치는 루트 README에 있으나 인증값은 Git에 없습니다.
