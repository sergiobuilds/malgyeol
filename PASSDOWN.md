---
handoff_schema: project-handoff/v1
project_mode: observe-only
verified_at: 2026-09-18T04:43:09.539440+00:00
canonical_ref: refs/heads/master
verified_commit: 034f31d8a983e9b7bae46d0aa0752782cae074b7
---

## Next

- 세 번째 전화의 반복 본인확인 제거: 운영자 승인+등록된 목업 시민+요청 소유자 대조에 한해 confirm_recipient(demo, 빈발화)로 연결한다. 실제 본인확인 발화를 만들지 않으며 일반 신규 시민 경로는 유지. 등록 회신은 이름 인사→실제 기관 답변→필요 선택→종료. Python84 통과. 전체 시연60초 제한, 통화50초 목표의 실제 음성 검증은 남아 있다.

- 사용자 실제 음성 지적: 식사 준비가 필요하다고 들었다는 불필요한 표현. 고정 문구는 발견되지 않았고, 과거 history를 현재 요청으로 쓰지 않으며 음식 전달 요청의 의미를 보존하도록 지침 보강. Python83 통과. 운영 반영 전 진행 중 전화 1건이 있어 종료 대기.
- 2026-09-18 대표이미지: artifacts/hackathon/malgyeol-submission-cover-v1.png 및 .prompt.txt. 내장 image_gen 생성, 전화 이용 시민과 실제 담당자 대시보드 참조. Milgram 말결 제출 폼의 첫 번째 이미지 CDN 반영 확인. 본 세션은 Submit again 미클릭.

- 실제 기관 발신은 04:29:17 UTC에 시작해 약 26초 후 무응답으로 끝났고, 시민 회신은 04:29:43 UTC에 발신되어 19초 통화 후 종료됐다. 기관의 음식·배달 답변은 없었다. 전체 50초 성공 증거가 아니다. 사용자 지적으로 전화의 내부 업무 용어를 생활 언어로 바꾸는 지침을 추가했다. Python83 통과, 반영 전 활성 통화 0건 확인.

- 실제 첫 통화 접수는 저장·종료됐으나 35초였고 B 발신은 CALL_ACTIVE로 막혔다. 원인은 명시된 발표용 시드의 started attempt. synthetic/live 구분 및 확정 실패 dispatch claim 복구를 수정, Node207/Python83 통과. provenance의 realCalls=false인 5개 요청·7개 attempt만 synthetic 표시 대상으로 확인했다. 실제 전화 완료/전체50초는 아직 미달이다.
- 사용자 추가 승인: 정미경 목업 시연은 이름주소 공유 동의를 재질문하지 않는다. private demoAuthorization=true를 등록 mock 번호·승인 기관 경로에만 적용하고 운영자 사전승인 출처를 남긴다. 주소는 짧게 말하고 현재 거동 상태를 확인한다. 일반 신규 시민의 동의 절차는 유지한다.

- 최신 필수 제약: 등록 대표 시연의 시민 접수→기관 문의→시민 회신 전체 50초(발표 1분). 반복 발화를 줄이고 통화마다 중복되던 2초 대기를 제거했다. SDK 재생완료 확인은 유지한다. 전체 50초는 실제 전화망에서 아직 측정하지 않았으며 완료로 주장하지 않는다.

- 2026-09-18 전화 이중 경로 수정본: 기존 정미경 demoCallers 2개와 publicIntake, 통화별 회신 경로, native 객체 도구, 필드 동의·주소 추가·동일기관 재문의, 기관/회신 저장 멱등 복구. [검증 기록](dev/active/phone-dual-track-plan.md). 팀원의 로그인 제거 커밋 cac18af까지 통합. 통합본 Node206/Python79, typecheck, dependency audit 통과. 격리 Live 모델에서 접수·기관답변·시민회신 업무를 실행했으나 실제 전화망/사람 왕복 증거는 아직 없음.
- 2026-09-18 13:20 KST경 사용자 명시 승인 후 b3facce 운영 반영: 기존 API·voice 재시작, 정미경 demoCallers 2개/publicIntake/23:00 시연 설정 적용. SQLite·routing 비공개 백업 및 무결성 검사 완료. API의 presentation-ledger/preview-origin/vercel-origin drop-in 보존, 기존 웹 Vercel 배포 변경도 8a9e52f까지 통합. API health/voice ready 및 provider active calls=0 확인 후 사용자에게 실제 전화 요청. 실제 왕복 및 전체50초는 아직 검증 전. API는 transient unit이라 stop 후 사라져 같은 launcher로 systemd-run 재생성했다. 이후에는 restart를 사용한다.

- 2026-09-18 사용자 승인으로 Vercel 공개 배포: https://malgyeol-vert.vercel.app (요청 화면 /ops). 배포 dpl_7dRYY2rfRoDkmAMLhu35DjGWMMp8, 소스 f86b667. 프론트 Vercel / API·SQLite·전화 Campbell. 203개 테스트와 실제 공개 브라우저·API 검증 통과. 터널 주소 변경 시 vercel.json 목적지 갱신 필요. 웹 Origin은 API unit vercel-origin.conf에 등록. 재배포 절차 README 참조.

- 2026-09-18 사용자 명시 요청으로 웹앱 담당자 인증·로그아웃·세션 확인 제거. 로그인 없이 요청 조회·변경, 동일 Origin 변경 검사 유지. 실행 API 반영 및 새 브라우저 /ops 요청 6건 확인. 타입 검사·202개 테스트·Codex 리뷰 통과. 내부 전화 Bearer 인증 유지.

- 사용자 최신 정정: 랜딩 KRDS 제외, 문장형 카피 금지, 네 사업 실제 시각 레퍼런스 기반·짧은 히어로. 현재 프론트 작업 중단 요청, 전화 검증 최우선. Figma 생성은 기존 웹앱에 적용하지 않음.

- 최신 사용자 정정 반영: 고정 화면 문구 명사형, 모노그램·상단설명·장문바닥글 제거, 이름·주소·품목수량·일정·수령방법·동일인 이력. Claude 프론트 전담, Node202 검사.
- [현재 웹앱](https://malgyeol-vert.vercel.app/ops): 5명·6개 요청의 발표용 별도 SQLite. 원래 전화용 ledger와 분리. 2026-09-18 사용자 승인 후 새 음성도 해당 API·coordination 원장에 연결. 기존 화면 사례는 voice journal에 없으므로 자동 발신 제외. 웹앱 로그인 제거, PUBLIC_BASE_URL 일치 설정. 외부 주소·저장소 전환 상세는 README의 웹 접속 절.

- [실행계획](dev/active/malgyeol-product-completion/plan.md) · [체크리스트](dev/active/malgyeol-product-completion/tasks.md) · [실행기록](dev/active/malgyeol-product-completion/context.md). looprun-auto 섹션5, supervisor 게이트 승인.
- 섹션1~4 완료. 실제 공개65목록행·37기관 및3보완창구, 복수필요 API/SQLite, 역할별전화코드, Claude KRDS프론트, 정책제안서6쪽·3분6장덱과편집원본/LaTeX. Node198/Python32, 브라우저검사23+24 및root실제API조작.
- [제출물·재생성](artifacts/hackathon/README.md) · [정책 원문](docs/AI_FOR_GOOD_SUBMISSION.md) · [정책 근거](POLICY_BASIS.md).
- 13+12+24 합의추적/Future와현행문서정리완료. 최종자체검사통과. 외부Codex리뷰1회는bwrap환경오류로소스미열람종료, 통과아님. [통합검증기록](dev/active/malgyeol-product-completion/verification.md). A/B설정완료, 다음은실전화수용검사.
- 실제A→서비스→B→A 전화망왕복은아직수행하지않음. A/B비공개매핑설정완료. 2026-09-18 09:38 KST 사용자 명시 승인으로 기존18082음성중단, 새coordination브리지18083전환·health ready확인. SDK 환경 Python32개 전부통과. health/대역시험을실전화로집계하지않음.
- Manyfast말결PRD 정상저장/재조회: https://manyfast.io/editor/c5d1f6a7-896d-4524-96bd-f070fbe4a095 . 다른프로젝트PRD오변경원문복구미완료, 세부비공개증거는repo밖보존. 프론트작업자의기존API종료사고는동일launcher로복구·health200/auth403/SQLite무결성확인.

## Do Not Touch

- 타세션서비스종료·광범위pkill·실제공공기관시험발신·비밀값/개인번호출력금지.
- 프론트/UI/문서시각코드는Claude전담. 공공기관번호와허용A/B라우팅별도유지.
- 실전화와다른프로젝트복구가남아있으므로전체완료로표시하지않음.
