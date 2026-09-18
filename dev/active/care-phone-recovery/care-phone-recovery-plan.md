# 말결 자율 실행 계약

2026-09-17 사용자 승인에 따른 전화 복구와 정책 기반 서비스 이행 구현 계획입니다.

## 목표와 승인

Campbell에서 2026-09-17 11:33:16~12:33:16 UTC 동안 질문 없이 자율 구현한다. 사용자 요청은 기존 goal을 이 계약으로 대체하여 resume하고, looprun auto 모드로 모든 TODO를 직렬 실행하는 것이다. 호스트 Goal 도구는 미완료 goal의 교체·재개를 지원하지 않으므로 완료로 위조하지 않는다. 이 파일은 실행 계약이며 프로젝트 방향 정본을 대체하지 않는다.

사용자는 ClawOps 구독을 결제했고 번호 발급·수신 복구·운영 설정·구현·검증·저장을 승인했다. 위 작업에 필요한 기존 ClawOps 인증과 배포 인증은 메모리 또는 비밀 저장소를 통해 사용하고 값을 출력하지 않는다. 자동 인터뷰의 보수적 기본값으로 이 명시 승인을 취소하지 않는다. 추가 사용자 확인 없이 가역적인 구현 선택을 진행한다.

## 정책

사용자가 확인한 docs/MASTER-MAP.md와 POLICY_BASIS.md 내용을 따른다. 돌봄통합지원법과 서울형 통합돌봄의 이미 승인된 개인별지원계획을 전화로 실행한다. 식품·생필품은 찾아가는 푸드마켓·가정배달 가능한 협약 수행기관, 긴급 식사는 돌봄SOS다. 공공 공급이 불가능하고 자치구가 승인했을 때만 민간 공급자를 연결한다. 첫 실증에서 이용자 결제, 바우처 잔액 소비, 블록체인은 제외한다. AI는 자격·급여·계획을 결정하지 않는다.

산출물은 전화 이용 흐름, 수행기관 업무함, 예외 이관, 감사 가능한 이행 원장과 서울시 정책·데이터·실증환경·지원 제안 1장이다. 라우터가 observe-only인 현재 상태를 managed 완료라고 표현하지 않는다.

## 직렬 실행

1. 전화: ClawOps 번호 목록과 발급 오류 확인 → 번호 확보 → 현재 정책 음성 수신 연결 → 발화·재확인·명시 승인 후 1회 접수. 통화별 토큰, 재전송·취소·위험·계획 밖 요청 검증. 실제 통화 증거와 로컬 합성 테스트를 구분한다.
2. 제공기관: TODO P1을 정책에 맞춰 수행기관 제공 요청·응답·readback으로 구현한다. 실제 승인된 기관 연결이 없는 경우 샌드박스 어댑터를 검증하고 실제 제공 완료는 미확보로 남긴다. 과거 납작보리쌀 실제 주문 증거는 개인정보 제거 후 기술 증거로만 보존한다.
3. 사건 원장: 동일 caseId의 요청·확인·기관 전달·수락·제공·수령·예외를 영속 저장한다. 누적 계획 한도, 역할 권한, 멱등성, 동시 실행, 재시작 복구, timeout 후 중복 전송 금지와 담당자 업무함을 구현한다.
4. 운영: 환경변수 이름·비밀 저장 경로 계약, 시작·상태확인·로그·재시작·수동 전환·증거 패키지. TODO 모든 항목에 실제 검증/미완료 근거를 연결한다.
5. 후순위: 이용자·수행기관·담당자 화면, 데모·접근성, 실증 제안·발표 자료. 화면 변경은 design-forge 경로와 브라우저 QA를 적용한다.
6. 마감: 섹션별 Codex 리뷰·self-check, 전체 verify·project-doctor·비밀/PII 점검·최종 독립 리뷰·commit 직후 push. 부족한 증거는 미완료로 유지한다.

각 섹션 종료 전 tasks.md, context.md와 .looprun-state를 갱신한다. 런타임이 Markdown을 요구하므로 HTML 대신 이 Markdown 파일을 사용한다. looprun-launch.sh로 guard를 실행한다. 구현 작업자는 한 명만 실행하고 다음 섹션은 이전 검증 뒤에 시작한다.

## 예상 문제와 해결

- 번호 만료·번호풀 부족: 번호 생성 응답 원인을 보존하고 공급자 복구 가능 여부를 확인한다. 번호만 발급하고 수신 완료로 표시하지 않는다.
- 실제 기관 연결 부재: 제공기관 어댑터와 샌드박스 검증은 진행할 수 있으나 공공서비스 제공을 주장할 수 없다.
- 기존 dirty 변경과 비정본 브랜치: 이전 변경을 보존하고 diff를 검토해 저장한다. master 강제 갱신이나 보호규칙 우회는 하지 않는다.
- 실제 수신은 외부 사건: 발신 전화/사용자 대체 인증을 꾸며내지 않고 API 통화 기록과 현재 라우팅으로 증거 수준을 나눈다.
- 자동 명세의 가짜 fixture·범위 축소: 실제 repo 계약으로 검증하며 acceptance-001 같은 임의 엔드포인트를 만들지 않는다.

## 검증

기본 검증은 npm run verify와 project-doctor다. 새 도메인 테스트는 미승인 실행 0, 누적 한도 초과 차단, 통화별 확인, replay 1회, timeout 중복 0, restart 복구, 역할별 접근을 검증한다. 실제 전화·제공 증거는 별도 사건으로 기록한다. 합성 테스트 성공은 실제 통화·배송 성공이 아니다.

## 실행 재개 지시

이 문서를 stdin으로 받은 구현자는 지금 구현을 시작한다. Auto는 이미 실행하여 A Seed를 생성했다. 다시 auto를 호출하거나 새 worktree/구현자를 만들지 않는다. 현재 looprun-launch.sh guard 아래 단일 작업자이며, 사용자 승인으로 mode=auto다. 동일 프로젝트 다른 worker는 종료되었다. 각 섹션을 직렬로 구현하고 검증한다. 2026-09-17T12:30:00Z까지 구현하고 이후 검증·저장한다. 질문하지 않는다. 계획만 제출하거나 이유 없이 조기 종료하지 않는다. TODO.md 전체를 읽고 위 정책에 맞춰 처리한다. 실제 외부 증거가 부족한 항목은 blocked 근거를 기록하고 다음 구현 가능한 항목으로 이동한다. Guard section_N_done은 실제 완료 항목만 허용하므로 외부 blocked가 남으면 section_N_done을 위조하지 않고 state=executing을 유지하며 context에 구현/검증/외부증거를 분리한다.

전화 우선: 기존 .secrets는 /home/campbell/projects/personal/products/benefit-settlement-rail/.secrets/{clawops,bridge}.env. 값 출력 금지. 공식 ClawOps API https://api.claw-ops.com/v1/accounts/{accountId}/numbers GET/POST, POST {} 번호 자동발급. 이미 구독결제 완료, Account ID AC9aFbGGnThxZlQvRa. 번호0개라 수신 불능. 기존 번호07052753884는 목록에서 사라짐. POST 전에 GET, 성공후 GET 재확인하여 중복발급 금지. 기존 scripts/clawops-vertex-agent.py는 SDK serve 연결 참고용이며 구매정책은 폐기한다. CDP9445 agent-browser --session malgyeol-recovery --cdp 9445, 로그인완료 platform.claw-ops.com/phone-numbers. agent-browser 스킬 읽고 사용한다. SDK/라우팅 공식 문서를 확인한다. 새로운 공급자 선택 없이 기존 승인된 실시간 음성 구성 복구한다.

배포: 기존 Cloud Run benefit-settlement-rail project-236b096e-5b41-4315-a01/us-central1, URL https://benefit-settlement-rail-164282963747.us-central1.run.app. gcloud CLI 없으나 ADC 존재, GoogleAuth는 ./node_modules/google-gax/node_modules/google-auth-library/build/src/index.js에서 가져올 수 있다. 현재 Docker18080 구버전 컨테이너는 이 세션 소유가 아니므로 임의 종료 금지. 기존 dirty 변경 전부 보존. 구현은 apply_patch. save/hygiene skill 읽고 최종 비밀검사, verify, doctor, commit/push 수행. source code 구현과 실제 결과가 우선이며 계획 문서를 늘리지 않는다.
