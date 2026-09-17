---
handoff_schema: project-handoff/v1
project_mode: observe-only
verified_at: 2026-09-18T02:00:08.785719+09:00
canonical_ref: refs/heads/master
verified_commit: 45337d8f4f88995ff31aa9549a134835ad158bc3
---

## Next

- 이번 작업은 문서만 작성했다. 코드·프론트·통화·서비스·배포 변경 없음. 구현은 다음 실행 요청 후 착수한다.
- 전체 합의는 [Future Plan](dev/active/care-coordination/implementation-plan.md), 이번 실행 범위는 [해커톤 MVP 계획](dev/active/care-coordination/hackathon-mvp-plan.md). Future 운영 항목을 MVP 선행조건으로 가져오지 않는다.
- 최우선 산출물은 발표 덱·정책 제안서. 실제 반복 전화와 아름다운 프론트가 증거다. 공식 제출 시간/형식은 M0에서 확인한다.
- 두 번호 역할극은 승인됨: A 시민이 말결에 전화하고 회신 수신, B는 푸드뱅크 등 기관 역할로 AI 발신에 답변. 실제 공공기관 연결은 불필요. 구체 번호/연결 유형/서비스 번호 관계는 실행 전 등록한다.
- 프론트는 Claude 전담. KRDS https://github.com/KRDS-uiux/krds-uiux 필수. Codex는 와이어프레임·화면·디자인·UI·KRDS pack 작업 금지. API/데이터/통화 이벤트 계약만 제공한다. Claude에게 자동 메시지를 보내지 않았다.
- M0 전화 기능 계약·제출 논지 → M1 공통 schema/API → 데이터·요청/전화·Claude 프론트·덱/제안서 병렬 → 실제 통합/반복 통화 → 제출물 검수. TDD는 백엔드 핵심 계약, 전화는 역할극 실통화, 프론트는 Claude 시각 검수.
- 현재 코드는 수신 브리지·단일 품목/고정 시민·SQLite 기반. 이번에 실제 발신/회신을 시험하지 않았다. 이전 테스트 통과는 새 기능 증거가 아니다.

## Do Not Touch

- 현재 요청으로 구현/발신/배포를 시작하지 않는다. 기존 서비스·번호·비밀값·실행 중 세션을 변경하지 않는다.
- 네 사업을 두 사업/두 품목으로 축소하거나 수요/구매의사/기관 협조 조사를 선행조건으로 되살리지 않는다.
- 화면·음성·발표에 미확인·미검증·목업·시연용·연습용 배지를 넣지 않는다. 실제 행동 없이 완료/승인/공공기관 협약을 주장하지 않는다.
- 저장소는 observe-only. 이 브랜치 지도가 canonical master의 방향 정본이라고 주장하지 않는다.
