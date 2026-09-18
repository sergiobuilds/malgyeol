# 말결 구현 체크리스트

2026-09-18 섹션5 실행 중 기준입니다. 현재 브랜치는 observe-only이며 아래 체크는 구현·검사 범위를 구분합니다. 전체 완료나 canonical master 상태를 대신하지 않습니다.

## 실행 근거

- [현행 실행계획](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/plan.md)
- [실행 체크리스트](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/tasks.md)
- [검사·사고·복구 기록](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/context.md)
- [전화 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/phone-goal-prompt.md)

## 데이터 및 업무

- [x] 네 사업·공식65목록행·37기관 정규화·보완3창구·총40기관.
- [x] 기관 역할·사업별 이용절차·출처·관할·문의 창구 분리.
- [x] 공통 지원망 조회 및 인증된 요청 API.
- [x] 복수 필요·동의·부분 해결·중요 조건 선택·기관 후속 처리.
- [x] 요약 정정의 연결 결과 보존·실질 조건 변경의 경로 재검토.
- [x] 필요 중단·수동 재시도·결과 불명 차단·멱등성·요청 격리.
- [x] SQLite 영속성·두 연결 동시성·재시작 복원.

## 전화 구현 및 실제 수용검사

- [x] 시민 접수·기관 발신·시민 회신의 역할과 도구 분리.
- [x] prewarm 이전 맥락 결박·전사 기반 동의·허용 전달 정보 통제.
- [x] 허용 번호·서비스 자기발신 차단·통화 작업 기록.
- [x] 기관 답변 반영·시민 재선택·일부 결과 선회신의 로컬 통합.
- [x] `coordination-check`·`coordination` 신규 실행 경로.
- [ ] 승인된 A/B 비공개 라우팅 구성 및 기존 음성 서비스의 명시적 전환.
- [ ] 실제 A 접수→B 문의·양방향 응답→A 회신.
- [ ] 실제 전화망의 정상·부분 해결·조건 변경·부재 시나리오.
- [ ] 양방향 청취·첫 인사·말 끊기·침묵·종료·맥락 격리 검사.
- [x] 회신 상세의 초기 prompt 제외·실제 음성 수신자 확인 게이트 구현.
- [x] 수신자 확인 보완을 포함한 Python32 검사 최종 재확인. OTP·정식 신원인증과 구별.

현재 18082는 이전 `clawops-care-agent.py`입니다. API/음성 서비스 실행과 health 응답을 새 브리지의 실제 왕복 증거로 사용하지 않습니다. 공식기관 협약·응답 확보는 팀원 A/B 역할극의 선행조건이 아닙니다.

## 프론트 및 제출물

- [x] Claude의 design-forge·실제 KRDS MCP 기반 지원망·요청 진행 화면.
- [x] 담당자 HttpOnly 접속·정정·중단·수동 재시도와 실제 API 연결.
- [x] 부분 해결·결과 불명·로딩·부재 상태와 다음 행동 표시.
- [x] 1440·768·390 너비, 키보드 사업 선택, 가로 넘침 검사.
- [x] Manyfast 말결 PRD 저장·웹 재조회. 다른 프로젝트의 복구 미완료 사고와 별도 관리.
- [x] POLICY_BASIS 중심 정책 원문·LaTeX·6쪽 PDF·편집 DOCX.
- [x] 6장·180초 KRDS 덱·LaTeX·PDF·편집 PPTX. 대본·노트 제외.
- [x] 제목·소제목의 명사형, 보수적 표현, 실제 화면 발췌.
- [x] 표 원문·글꼴·색·링크·페이지 범위·편집성·복사본 재생성 검사.

[제출물 상세 및 재생성 절차](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/artifacts/hackathon/README.md)를 참조합니다.

## 최종 통합

- [x] 섹션4 시점 Node198·Python23·브라우저23+24·타입·의존성 검사.
- [x] 실제 HTTP·SQLite·브라우저 결합 검사. 실전화 증거와 구분.
- [x] 최종 변경 반영 전체 자체 검사 및 외부 Codex 리뷰 총1회 호출.
- [ ] 외부 코드 검토 완료: bwrap 환경 오류로 미열람 종료. 추가 호출 없음.
- [ ] 13개 승인 설계·12개 운영 권고·24개 암묵지 추적의 최종 대조.
- [ ] Future·실행 인계·완료 증거·문서 링크의 최종 대조.
- [ ] 비밀·개인정보·출처 검사, commit·push 및 원격 확인.
- [ ] 모든 필수 수용조건 충족 이후 전체 완료 판정.

## 후속 운영

본인 확인·대리권·장기 기억·자동 재연락·다기관 병렬 통화·담당자 자동 배정·보존삭제·재해복구·행정시스템 연계·실증·경제성은 [Future Plan](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/implementation-plan.md)에 보존합니다. 이 항목을 이번 MVP 착수 조건으로 되돌리지 않습니다.

## 과거 검증

2026-09-17의 171개 검사·고정 쌀4kg·고정 시민·기관 샌드박스·과거 배포 기록은 [전화 복구 기록](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-phone-recovery/care-phone-recovery-context.md)에 보존합니다. 최신 네 사업·기관 조율·회신 완료의 근거로 재사용하지 않습니다.
