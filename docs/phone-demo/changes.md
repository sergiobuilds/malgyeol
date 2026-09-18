# 말결 전화 시연: 기존 코드와 변경된 코드

## 현재 결론

최신 요청의 **인터뷰 → Seed 검토·수정·승인 → 통화 종료 → 빠른 모의 처리 → AI가 고객에게 다시 전화해 결과 안내** 코드는 로컬에 작성됐습니다. 기관 문의·신청은 시뮬레이션이며 실제 기관 전화·상품 주문·음식 배송을 실행하지 않습니다.

**운영 전화번호에는 아직 반영하지 않았습니다.** 사용자가 070-5276-7277에서 AI 서버 연결 오류를 확인했습니다. 개발 코드 완성과 운영 연결 복구는 별개입니다.

## 비교 기준

- 원본: PR #14 `feat/ai-for-good-product`, `000a08c2ab5bb5d3f6affd7dc717fb0a11622756`.
- 변경: 로컬 브랜치 `work/pr14-phone-demo-20260918`.
- 코드 위치: `<checkout>`.
- master 기반으로 앞서 만든 별도 `support-connection` 구현 전체를 복제하지 않고, PR #14의 전화·인증·라우팅·SQLite 기반 위에 작은 시연 경로를 추가했습니다.
- 미커밋·미푸시·미배포 상태입니다. 이 문서의 검증은 로컬 검증입니다.

## 기존과 무엇이 달라졌나

| 구간 | PR #14 원본 | 새 시연 코드 |
|---|---|---|
| 전화 시작 | 일반 기관 조정 프롬프트·도구 | Seed 필수 항목 기반 인터뷰. 한 답에서 여러 조건 저장, 미확인 항목만 질문 |
| 요청 확인 | 기관 문의 범위·정보공유 동의 | 조건 전체 readback, 수정 시 승인 무효화, Seed hash·nonce·기한·실제 DTMF로 승인 |
| 기관 문의 | 승인된 기관 역할 번호로 실제 SDK 발신, 순차 처리 | 모의 기관 어댑터에 병렬 문의. 실제 기관 발신 없음 |
| 우선순위 | 기관 답과 추가 고객 선택 중심 | 승인된 주품목·대안 순서·조건으로 계획 선택 |
| 실행 전 검사 | Seed 전체와 비교하는 독립 EV1 없음 | 요구조건·계획 식별자·품목·수량·비용·수령·제약·기한 비교 |
| 실행 | 기관 답의 available/connected와 일정 조정 | EV1 이후 모의 신청 단 한 건. 접수 결과를 별도로 기록 |
| 증거 기록 | 기존 coordination 원장·음성 journal | 별도 SQLite에 Seed·모든 실행 단계·문의 응답·계획·EV1·접수·EV2·회신 증거 |
| 실행 후 검사 | available와 별도 신청 영수증 대조 구분 약함 | plan과 receipt가 맞아야 성공 안내. 모호하거나 불일치면 UNKNOWN |
| 고객 회신 | 기관 응답 후 고객 회신·추가 선택 가능 | 통화 종료 직후 모의 처리 결과로 콜백. 처음부터 인터뷰 반복하지 않음 |
| 못 구한 경우 | 문의 답에 따라 설명 | 불가와 미응답 구분, 과거 일정 차단, 다음 기회·재연락 동의 기록 |
| 기존 상품 주문 | 호환 코드가 저장소에 남아 있음 | **새 시연 경로에서 기존 상품 주문 코드 호출하지 않음** |

## 무엇을 재사용했나

- ClawOps SDK 0.56.0, Gemini 실시간 음성, 기존 전화번호·서버 구동 구조.
- PR #14의 `HttpAPI`, 비공개 시민 번호 `Routing`, 음성 SQLite `Journal`.
- `careApp.ts`의 Node HTTP 서버와 내부 인증 방식.
- 기존 기관망·대시보드·일반 coordination 모드는 보존. 새 모드는 명시적으로 켰을 때만 선택됩니다.

## 변경 크기

수정 3개 파일, 신규 12개 파일. 총 +1147 / -4줄이며 테스트·통합 증명 스크립트를 포함합니다. 비교는 이 문서 생성 시점의 로컬 파일 기준입니다.

| 파일 | 구분 | 추가 줄 | 삭제 줄 |
|---|---|---:|---:|
| `.env.example` | 수정 | 7 | 0 |
| `scripts/coordination_voice.py` | 수정 | 15 | 3 |
| `src/careApp.ts` | 수정 | 25 | 1 |
| `scripts/demo_voice.py` | 추가 | 293 | 0 |
| `scripts/prove-demo-flow-local.py` | 추가 | 162 | 0 |
| `src/demo-workflow/contracts.ts` | 추가 | 50 | 0 |
| `src/demo-workflow/mockProvider.ts` | 추가 | 16 | 0 |
| `src/demo-workflow/routes.ts` | 추가 | 42 | 0 |
| `src/demo-workflow/service.ts` | 추가 | 165 | 0 |
| `src/demo-workflow/store.ts` | 추가 | 25 | 0 |
| `src/demo-workflow/types.ts` | 추가 | 33 | 0 |
| `tests/demoAcceptance.test.ts` | 추가 | 65 | 0 |
| `tests/demoAcceptanceServer.ts` | 추가 | 10 | 0 |
| `tests/demoWorkflow.test.ts` | 추가 | 85 | 0 |
| `tests/python/test_demo_voice.py` | 추가 | 154 | 0 |

## 어떤 코드가 무슨 일을 하나

| 코드 | 입력 → 처리 → 출력 | 개념 |
|---|---|---|
| `scripts/demo_voice.py` | 고객 음성 → Gemini가 조건 추출·질문, 실제 통화에 도구 결박 → HTTP 요청 | Interview와 고객 접점 |
| `src/careApp.ts` | HTTP → 내부 시연 경로로 전달 → JSON 응답 | 통신 입구; I/S/R/E 중 한 단계가 아님 |
| `src/demo-workflow/routes.ts` | URL·인증·본문 → 허용된 서비스 함수 호출 | 통신·권한 경계 |
| `service.ts: update/prepareSeed/approve` | 누적 답 → 필수 조건 검사·확인문·승인 → 고정 Seed | Interview → Seed |
| `service.ts: inquire/run` | Seed → 병렬 모의 문의·우선계획·신청 → 결과 | Run 1~4 |
| `contracts.ts: evaluate` | Seed+계획(+접수증) → 조건 대조 → 판정·이유 | Evaluate 1·2 |
| `mockProvider.ts` | 문의·신청 → 준비된 모의 응답 | 이번 시연에서 실제 기관을 대신하는 코드 |
| `store.ts` | 상태 변경·증거 → SQLite 트랜잭션 저장 | 모든 단계의 기록 |
| `demo_voice.py: dispatch/dtmf/ended` | 검증 결과 → 고객 발신·안내·응답 기록 | 최종 결과 회신 |

HTTP는 Python이 TypeScript 서버에 내용을 전달하는 방법입니다. Node는 서버의 실행 환경입니다. Gemini는 언어를 해석하지만, 미승인 실행 차단·상태 전이·조건 대조는 일반 코드가 담당합니다.

## 시연에서 무엇이 생략되는가

사용자는 긴 Run 과정을 기다리지 않습니다. 실제 기관 문의와 실제 신청 대신 빠른 모의 응답으로 실행합니다. 다만 코드의 Seed·EV1·EV2·기록은 그대로 작동하므로 “검증했다”는 말만 하는 시연이 되지 않습니다. 고객 안내에 모의 결과라는 표시를 유지합니다.

확인되지 않은 실제 지원이나 배송을 완료했다고 주장하지 않습니다. 다음 기회 재연락은 동의와 시연 예약을 저장합니다. **예약 시각에 실제로 자동 재발신하는 장기 scheduler는 아직 구현되지 않았습니다.**

## 로컬 검증

- Node 22 전체 `npm run verify`: **219/219 PASS**, TypeScript 검사 PASS, 의존성 알려진 취약점 0.
- 설치된 ClawOps 0.56.0을 사용하는 Python 전체: **38/38 PASS**.
- 독립 새 흐름 검사: **9/9 PASS** (위 Node 테스트에 포함되므로 중복 합산하지 않음).
- 실제 로컬 HTTP ↔ Python ↔ SQLite 통합: 성공·지원 불가 **2/2 PASS**. 전화 전송은 fake이며 실제 전화 0회.
- 발견 후 수정: 실행 설정 예제 누락, 과거 다음 접수시간 안내, 2번 수정 후 새 승인 전 종료 차단.
- 통화 종료 뒤 콜백, 한 번만 신청/콜백, 재시작 후 상태 보존을 로컬 검증했습니다. 실제 음성 재생·전화망 콜백은 사용자 검증이 남습니다.

## 전화에 연결하려면

기존 운영 서버에서 같은 API/voice 쌍에 다음 설정을 적용해야 합니다. 값은 기존 비공개 인증·고객 라우팅을 그대로 사용하며 이 문서는 비밀값을 포함하지 않습니다.

```dotenv
# API
DEMO_WORKFLOW_ENABLED=true
DEMO_WORKFLOW_LEDGER_PATH=.private/phone-demo-workflow.sqlite
DEMO_WORKFLOW_SCENARIO=success
# Voice
COORDINATION_DEMO_MODE=1
```

실패 시연은 scenario를 `unavailable`, 미응답 시연은 `no-answer`로 선택합니다. 원격 배포·재시작은 아직 실행하지 않았습니다. 같은 번호에 두 음성 프로세스를 경쟁 연결하면 안 됩니다.

## 저장소를 전부 조사한 운영 단서

원격 브랜치와 PR 16개의 head를 가져오고 shallow clone을 해제했습니다. 전체 49개 커밋, 운영 단서가 있을 수 있는 텍스트 파일 버전 431개, PR 본문 16개를 검색했습니다. GitHub issue/PR 일반 댓글·리뷰 댓글에는 추가 내용이 없었습니다.

- 실행 위치: `/home/campbell/projects/personal/products/malgyeol`.
- 서비스: `malgyeol-care-api`, `malgyeol-care-voice`.
- 전화 실행: `scripts/run-care-runtime.py coordination`.
- API health: Campbell 내부 `127.0.0.1:18081/health`.
- 음성 health: Campbell 내부 `127.0.0.1:18083/health`.
- 비공개 설정 파일의 위치와 systemd voice 서비스 템플릿은 저장소에 있습니다.
- **외부에서 Campbell로 접속할 SSH 주소/IP/설정은 조사 범위에서 찾지 못했습니다.** 공개 웹 터널은 웹 API 주소이며 SSH나 음성 상태 포트에 대한 접근 수단이 아닙니다.
- 이전 이력에는 transient 서비스가 재부팅 뒤 다시 시작되어야 한다는 미완료 항목이 있습니다. 현재 장애가 재부팅 때문이라는 증거는 아닙니다.
- 사용자가 들은 “서버에 연결할 수 없습니다. 관리자에게 문의해주세요” 문구는 저장소·보유 SDK 소스에 없습니다. ClawOps 인계 실패 가능성이 있지만 현재 원인 확정은 못 했습니다.

## 산출물

- [현재 상태와 실행 설정](README.md)
- [전체 코드 묶음](code-bundle.md)
- [변경 소스 SHA256](source-sha256.json)
- [로컬 HTTP/Python 검증 결과](http-python-proof.json)

전체 세션 조사·이전 실패 원문은 별도 바탕화면 인계 폴더에 있습니다.
