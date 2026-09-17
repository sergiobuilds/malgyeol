---
doc_kind: project-map
status: working
version: 2026-09-18_v6
---

# 말결 작업 지도

## 권위 및 실행 기준

현재 브랜치는 `observe-only`입니다. 이 지도는 사용자 지시와 현재 실행의 작업 연결·관찰 상태를 기록하며 canonical master의 방향 권한이나 managed 완료를 주장하지 않습니다. 권위 판정은 프로젝트 라우터 결과를 따릅니다.

이전 MVP 계획의 삭제·거절은 이력으로 보존합니다. 현재 실행은 최신 사용자의 looprun-auto·supervisor 게이트 승인·활성 섹션 내 병렬 TDD·최종 Codex 리뷰 총1회 계약을 따릅니다. 구현 전 상태로 되돌아가거나 완료된 인터뷰를 반복하지 않습니다.

## 제품 범위

- 네 사업: 푸드뱅크·푸드마켓, 찾아가는 푸드마켓, 그냥드림, 돌봄SOS.
- 공통 데이터: 기관·역할·관할·이용절차·문의 창구·출처. 화면과 AI의 동일 API 사용.
- 전화 업무: 생활 필요·제약·동의 → 기관 문의·조건 조율·허용된 신청 의사 전달 → 기관 답변 → 시민 회신·중요 조건 재선택·후속 연락.
- 복수 필요: 일부 경로 연결 유지와 남은 필요의 대안 처리. 대표 사례로 품목·지역·대상을 제한하지 않음.
- 담당자: 진행 조회·정정·중단·수동 재시도. 시민 앱·기관 포털 가입을 필수화하지 않음.
- 판단 경계: 자격·선정·행정 승인은 기관 권한. 경로 연결과 실제 제공 완료 구별.
- 최우선 산출물: 정책 근거 기반 제안서, 대본 없는3분 KRDS 덱, 확실한 실제 전화, 아름다운 실제 업무 화면.
- 디자인: Claude 전담 프론트, design-forge·KRDS MCP·공식 KRDS 토큰. Codex 프론트 대체 금지.
- 표현: 내부 개발 배지를 전면에 노출하지 않되 실제 하지 않은 연락·접수·제공을 완료로 표시하지 않음.

## 구현 및 검증 현황

| 영역 | 현재 관찰 | 남은 수용조건 |
|---|---|---|
| 데이터·도메인 | 공식65목록행→37기관·보완3창구=40, 네 사업/API/복수 필요/동의/SQLite 구현 | 수집 범위 밖 상세 경로는 향후 보강 |
| 전화 구현 | 역할별 브리지·조건 조율·선택·회신·허용 라우팅·수동 재시도 구현, SDK/HTTP 결합 검사 | A/B 라우팅, 새 브리지 전환, 실제 전화망 왕복·오디오 |
| 프론트 | Claude KRDS 화면·HttpOnly 접속·업무 API·부분 해결·키보드/반응형 검사 | 최종 코드와 수용 증거 대조 |
| 정책 제안서 | 정책 원문·LaTeX·6쪽 PDF·편집 DOCX, 출처·표 검수 | 제출 전 현행 근거와 최종 검증 결과 확인 |
| 발표 덱 | 6장180초·LaTeX·PDF·편집 PPTX·실제 화면·노트 없음 | 실제 발표 환경 리허설 |
| PRD | 말결 프로젝트 저장·웹 재조회 | 타 프로젝트 오수정 원문 복구는 별도 사고 후속 |
| 운영 서비스 | 기존 API18081 복구·기존 음성18082 유지 | 기존 음성은 새 coordination 브리지가 아님 |
| 전체 완료 | 섹션1~4 완료, 섹션5 실행 중 | 실제 전화 대기·외부1회 리뷰 환경 차단·자체 통합 검사 통과 |

검사 건수는 섹션4 시점 Node198·Python23·브라우저23+24입니다. 후속 코드 검사와 실전화 수용 여부는 [실행 기록](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/context.md)을 따릅니다. 대역·로컬 검사를 전화망 성공이나 공공기관 실적으로 계산하지 않습니다.

## 실행 문서

| 문서 | 역할 |
|---|---|
| [실행계획](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/plan.md) | 다섯 실행 섹션·소유권·수용조건 |
| [작업 체크](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/tasks.md) | 섹션별 진행·미완료 |
| [실행 근거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/context.md) | 게이트·실측·사고·복구·검사 |
| [공통 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/contracts.md) | 데이터·엔진·API·파일 책임 |
| [사용자 합의 인계](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/planning-handoff.md) | 승인13·운영권고12·암묵지24·정정 |
| [전화 상세](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/phone-goal-prompt.md) | 전화 업무 동작 및 완료 경계 |
| [통합 계약 원문](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/full-product-goal-prompt.md) | 기존 합의와 최신 지시의 비교 입력 |
| [정책 근거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/POLICY_BASIS.md) | 법·서울시 계획·사업·실증 요청 |
| [정책 제안서](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/AI_FOR_GOOD_SUBMISSION.md) | 현행 정책 제안 원문 |
| [제출물 상세](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/artifacts/hackathon/README.md) | LaTeX·PDF·편집본·재생성·KRDS 근거 |
| [아키텍처](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/ARCHITECTURE.md) | 현행 coordination과 과거 care 경계 |
| [Future Plan](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/implementation-plan.md) | 후속 기능·미결정 운영값 보존 |
| [결정 이력](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/CHRONICLE.md) | 과거 거절과 변경 근거 |
| [인계](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/PASSDOWN.md) | 다음 실행 진입점 |

## 외부 조건 및 후속 범위

번호 A/B의 사용자·팀원 역할극은 승인된 방식입니다. 실제 비공개 번호 설정·서비스 번호 관계·발신 경로·시험을 아직 완료한 것으로 쓰지 않습니다. 임의 공공기관 연락·추가 번호 구매·다른 서비스 종료는 실행 범위가 아닙니다.

본인 확인·보호자 대리권·장기 기억·자동 재연락·담당자 인수·다기관 병렬·행정시스템 연계·개인정보 보존삭제·운영 경제성은 Future에 보존합니다. 수요·구매의사·기관 협조 조사와 전 기관 재고 API를 해커톤의 선행조건으로 두지 않습니다.

## 변경 이력

- 2026-09-18 v6 — 실제 구현 및 섹션4 산출물 반영. 오래된 계획 전용 상태·고정 품목 정의·대본 요구 제거. 섹션5의 실전화·최종 검증 미완료 유지. 권위 observe-only 유지.
### 과거 변경

- 2026-09-18 v5 — 전화 확정과 전체 직렬 실행 goal 프롬프트 등록. 실제 KRDS MCP·Manyfast PRD·취침 중 무인 검증 계약 반영. 구현 시작 없음.

- 2026-09-18 v4 — 사용자 지시로 세션 합의와 정정을 단일 인계문에 정리. 반복 인터뷰 금지, 삭제된 계획과 에이전트 해석의 재사용 금지 명시.

- 2026-09-18 v3 — 사용자가 안내 서비스로 축소된 MVP 계획을 거절해 삭제. 실행 기준에서 철회하고 Superpowers 설치·재계획으로 전환.

- 2026-09-18 v2 — 13개 설계·경계·운영 권고·암묵지를 Future로 보존. 해커톤은 발표 덱/정책 제안서·확실한 전화·아름다운 프론트 중심으로 분리. 두 번호 역할극 승인, KRDS 필수와 Claude 프론트 전담 반영.
- 2026-09-18 v1 — 실제 사업·기관 데이터망 우선순위 저장.
- 2026-09-17 v2 — 전화 대리인·부분 재협의 방향 채택.
- 2026-09-17 v1 — 결제 중심에서 생활지원 연결로 전환.
