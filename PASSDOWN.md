---
handoff_schema: project-handoff/v1
project_mode: observe-only
verified_at: 2026-09-18T05:43:17.000000+00:00
canonical_ref: refs/heads/master
verified_commit: d87f5bce68111da2f6b25f97970c7e0c9b50167f
---

## Next

- 2026-09-18 웹 시각 전환(HTML 불변, public/styles.css만): 사용자 지정 레퍼런스 서울복지포털 복지서비스 찾기(wis.seoul.go.kr/sec/ctg/categorySearch.do) 100% 기준. claude.ai/design 프로젝트 f9eeebac(랜딩·지원망·요청진행 3파일)을 생성해 그 값을 CSS로 이식. 서체 S-CoreDream(jsdelivr noonnu, CSP 허용). 랜딩은 유지하고 서울복지포털 메인 어법으로 첫 화면화. 남색·올리브(59a49652)와 크림·주황 시안은 사용자가 거부했으므로 되살리지 않는다. verify(typecheck·207 tests·audit) 통과. 사용자 지시로 production 반영.

- 2026-09-18 정책·기술 발표 8장 PPTX: artifacts/hackathon/말결_정책기술발표_8장.pptx(+pdf·미리보기). 비보북 양식(말결 (+3)의 사본.pptx) 기반, 생성기 build_8slides_from_template.py. 양식 DEMO장은 8장 제약으로 제외.

- 운영 반영 완료: demoCallbackOnly=true, API/voice health 정상. 실제 두 통화의 음성·60초 검증은 아직 미완료. 과거 3통화 검사에서는 첫 접수35초, 기관무응답26초, 회신19초여서 목표미달이었다. synthetic/live 시드 구분 수정·적용 완료. 상세 이력은 [전화 검증 기록](dev/active/phone-dual-track-plan.md)과 Git. API transient unit은 stop 대신 restart 사용.

- 최신 사용자 승인으로 등록 시연은 2통화로 변경: 기본 프로필만 알고 첫 인사→현재 증상/요청 수신→기관에 알아보고 회신하겠다는 시연 대사→실제 기관 발신 없이 operator-demo-fixture 응답→시민 콜백. 식사 fixture는 도시락1개/무료/등록주소 전달/20분. demoCallbackOnly 명시 설정과 신규 marker/등록번호 검증 필수, 과거요청 자동재발신 없음. 실제기관 attempt/answer를 만들지 않으며 회신 기록에 시연 출처를 남긴다. 일반 신규 시민은 기존 경로 유지. Python93 통과(기관발신0/콜백1/반복0/과거0/공개경로/프롬프트/목업답변 경계). 실제 두 통화 전체60초 검증은 남아 있다.

- 2026-09-18 대표이미지: artifacts/hackathon/malgyeol-submission-cover-v1.png 및 .prompt.txt. 내장 image_gen 생성, 전화 이용 시민과 실제 담당자 대시보드 참조. Milgram 말결 제출 폼의 첫 번째 이미지 CDN 반영 확인. 본 세션은 Submit again 미클릭.

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
