# 말결 해커톤 MVP 실행계획

실제 전화·네 사업 데이터·Claude KRDS 프론트·LaTeX 정책 제안서 및 3분 덱의 구현 작업.

## 목표 및 기준

첨부 실행 명세 전체를 수행. 기능 축소·대본 작성·전면 개발 배지 금지. 정책 근거는 POLICY_BASIS.md 중심, 최신 법령 공식 원문 확인. 제목·소제목·제출물 본문은 간결한 공공기관형 표현. 대표 시연으로 네 사업 범위를 축소하지 않음.

## 실행 계약

looprun-auto, supervisor 게이트 승인. 활성 섹션 1개, 해당 섹션의 독립 파일 작업은 병렬 TDD. 외부 Codex 리뷰는 최종 통합 시 전체 1회로 사용자 지시 적용; 섹션별 중복 리뷰는 하지 않으며 이를 수행했다고 기록하지 않음. executor/self-check/CHRONICLE 확인은 매 섹션 수행. 원격 push 전 secret 검사. 타 서비스 중지·임의 공공기관 발신·구매·외부 제출 제외.

## 근거

- [사용자 합의](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/planning-handoff.md)
- [전화 상세](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/phone-goal-prompt.md)
- [통합 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/full-product-goal-prompt.md)
- [정책 근거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/POLICY_BASIS.md)
- [구조](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/ARCHITECTURE.md)
- [기존 실행 증거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-phone-recovery/care-phone-recovery-context.md)

## 파일 책임 및 구조

기존 care-support/phone.ts의 고정 품목 흐름과 새 복수 필요 업무 흐름을 구분하고 서버에서 새 API를 실제 연결한다. 기존 SQLite 데이터 보존. 신규 도메인은 src/coordination/ 아래 사업·기관·요청·필요·동의·통화·답변·회신을 책임별 분리. tests/coordination/는 독립 node:test 검사. src/careApp.ts는 공통 API 마운트, scripts/coordination_voice.py와 scripts/coordination_tools.py는 역할별 음성 및 업무 도구. public/은 Claude만 수정. 제출물 원본과 생성기는 artifacts/hackathon/에 보존, docs/AI_FOR_GOOD_SUBMISSION.md는 정책 원문, POLICY_BASIS.md는 근거. 상세 타입·SDK 호출은 섹션 1 조사 결과로 확정 후 구현 전 계약 기록.

## 섹션 1: 근거·도구·공통 계약

근거: [합의·금지사항](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/planning-handoff.md) · [통합 실행계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/full-product-goal-prompt.md)

- 목적: 자료·SDK·디자인·발표참조 확인, 공통 API 및 데이터 인터페이스 확정.
- 병렬: SDK 조사, 지정 PDF 조사; supervisor는 요구 추적·현재 코드·실행 문서.
- 완료: 3종 문서, 근거별 요구사항, 파일 소유권, 실제 도구 연결 결과, 공통 타입 계약.
- 검증: 문서 존재·상태 일치·링크/코드 경로·SDK signature·지정 PDF 실제 열람.
- 위험: Manyfast/KRDS 인증, 외부 번호. 정상 인증 경로 조사, 외부 의존을 명시하고 독립 작업 지속.

## 섹션 2: 데이터·요청 처리

근거: [사업별 정책 근거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/POLICY_BASIS.md) · [공통 API 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/contracts.md)

- 목적: 서울 네 사업 실제 데이터 수집, 공통 요청·복수 필요·동의·저장·API.
- 병렬: 데이터 수집/정규화(독립 catalog), 도메인/저장(독립 engine), 정책 공식 근거 조사. API 통합은 supervisor.
- TDD: 관할/역할 혼동 차단, 복수 필요, 동의 전 실행0, 취소 후 실행0, 중복1, restart 복원, 요청 격리.
- 완료: 실제 조회·요청 생성·정정·중단·기관 문의 준비 API.
- 검증: node --import tsx --test tests/coordination/*.test.ts; npm run typecheck; 실제 HTTP 호출.
- 위험: 공개 목록 누락·자격 가정. 출처/관할/사업 운영 분리, 개인 답변 일반화 금지.

## 섹션 3: 전화·회신

근거: [전화 동작 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/phone-goal-prompt.md) · [기존 전화 조사](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-phone-recovery/care-phone-recovery-context.md)

- 목적: 실제 기관 발신·질문·조율·답변·시민 회신·재선택·재연락.
- 병렬: 역할별 음성 브리지와 도메인 후속 행동 검사, 파일 소유권 분리.
- 완료: A→서비스→B→A를 수행하는 역할별 런타임과 실제 API 결합, 부분 해결·조건 변경·부재 수동 재시도, 한 통화·멱등성.
- 검증: 설치된 SDK의 prewarm 이전 역할·도구 결박, 실제 HTTP/SQLite를 경유한 음성 도구 및 사건 변화. 실제 전화망의 첫 인사·양방향 오디오·왕복 검증은 A/B 자원 연결 후 섹션5에서 별도 필수 통과. health나 네트워크 대역을 실통화 증거로 세지 않음.
- 위험: 계정 발신/번호 제약. 기존 승인 자원 조사 및 자동 역할극 가능성 실측; 임의 제3자 발신 금지.

## 섹션 4: KRDS 프론트·제출물 제작

근거: [프론트 기능 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/frontend-functional-spec.md) · [제출물 제작 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/submission-production-spec.md) · [정책 제안서 원문](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/AI_FOR_GOOD_SUBMISSION.md)

- 목적: 실제 업무 화면, 정책·3분 덱 편집원본/PDF, LaTeX 제작.
- 병렬: Claude 프론트/디자인 전담; 정책 내용·LaTeX 제작은 분리된 산출물 파일. 디자인은 design-forge+KRDS MCP 실제 근거 사용.
- 완료: 모든 동작 API 연결, 실제 KRDS 조회, Manyfast PRD 저장/재조회, 정책 PDF/DOCX/TeX 및 6장 180초 PPTX/PDF/TeX.
- 검증: 실제 브라우저·반응형·키보드·상태 재현; PDF 전 페이지 렌더/폰트/잘림/출처; PPTX 편집성·대본 없음.
- 위험: 문서의 오래된 제품 가정. POLICY_BASIS 제도 근거와 최신 기능 경계 분리. 정책 효과 미측정 수치 생성 금지.

## 섹션 5: 통합·Future·최종 검증

근거: [후속 개발계획](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/implementation-plan.md) · [보안 정책](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/SECURITY.md) · [최신 실행 인계](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/PASSDOWN.md)

- 목적: 정상/부분 거절/중요 변경/부재 실통화, 화면/저장 일치, 13+12+24 요구 추적과 Future.
- 완료: 첨부 모든 필수 산출물 및 실제 증거, 외부 Codex 리뷰 1회, 수정 후 검사, commit/push와 상세 GitHub 링크.
- 검증: npm run verify; actual HTTP/browser/phone; PDF/PPTX/DOCX; secret 검사; 링크 확인.
- 위험: 외부 계정/번호/사람 제약. 사실과 미완료 분리, 필수 수용조건 삭제 금지. 자동 음성 시험과 사람 청취 검증 구별.
