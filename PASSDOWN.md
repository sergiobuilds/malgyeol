---
handoff_schema: project-handoff/v1
project_mode: observe-only
verified_at: 2026-09-17T17:43:01.661435+00:00
canonical_ref: refs/heads/master
verified_commit: 8d402eb13016103c517d06c875e1561a64f056fb
---

## Next

- 최신 실행 입력은 [전체 goal 프롬프트](dev/active/care-coordination/full-product-goal-prompt.md)다. 사용자가 새 세션에 실행 지시로 전달하면 looprun --auto로 직렬 실행한다. 전화 원문은 [전화 goal 프롬프트](dev/active/care-coordination/phone-goal-prompt.md)에 보존했다. 이 세션은 프롬프트 작성만 완료했으며 실제 구현·Manyfast 복구·KRDS MCP 프론트·실통화는 실행하지 않았다.
- 사용자 최신 합의: 전화 1~7번 확정, Manyfast PRD와 실제 KRDS MCP 기반 Claude 프론트 포함 전체 수행. 취침 중에는 정상 인증 복구와 통제된 실제 전화망 자동 역할극까지 수행하며, 실제 사람 검증과 구별한다. 전체 프롬프트가 아래 종전 인계의 계획 전용 범위와 전화 원문보다 최신 실행 계약이다.

- Sergio가 MVP 계획을 거절해 삭제했다. 지원 경로/다음 행동 안내로 말결을 축소한 해석을 다시 사용하지 않는다.
- 다음 작업자는 [계획 작성용 세션 인계](dev/active/care-coordination/planning-handoff.md)를 먼저 전체 읽는다. 사용자 인터뷰는 끝났다. Superpowers writing-plans로 기존 합의를 구체적인 계획에 옮기고 재인터뷰하지 않는다. 거절된 계획으로 구현하지 않는다.
- Future Plan은 보존 자료이며 이번 MVP 범위의 승인 근거가 아니다. 대화의 합의와 최신 정정을 우선한다.
- 유지할 사용자 직접 지시: 덱·정책 제안서 최우선, 확실한 실제 전화, 두 번호 시민/기관 역할극 허용, KRDS 필수, 프론트는 Claude 전담. Codex는 프론트 설계/와이어프레임/구현을 하지 않는다.

## Do Not Touch

- 코드·운영·번호·비밀값·다른 세션·프론트. 이번 변경은 세션 인계 문서 작성이다.
- 새 제품 정의나 MVP 축소를 임의 확정하지 않는다. 기존 계획의 테스트/완료 기준을 승인된 실행 계약으로 되살리지 않는다.
