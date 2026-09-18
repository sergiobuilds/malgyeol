# 말결

전화 기반 생활지원 연계 서비스. 시민의 생활 상황과 제약을 듣고, 네 지원사업의 실제 기관·이용절차를 조회한 뒤 기관에 문의·조건 조율·허용된 신청 의사 전달을 수행하는 구조입니다. 기관 답변에 따른 시민 회신·재선택·후속 연락과 담당자 개입을 같은 요청에 기록합니다.

## 지원 범위

푸드뱅크·푸드마켓, 찾아가는 푸드마켓, 그냥드림, 돌봄SOS의 네 사업입니다. 특정 연령·고정 품목·개인별지원계획 보유를 모든 이용자의 공통 조건으로 강제하지 않습니다. 자격·선정·행정 승인은 기관의 권한입니다. 기관 답변이나 경로 연결을 실제 지원 제공 완료로 표시하지 않습니다.

한 요청의 식사·생필품 등 필요를 별도로 관리합니다. 식사 경로를 유지하면서 생필품만 다른 기관에 문의할 수 있으며, 중요 조건 변경은 시민 선택을 거칩니다. 결과 불명 통화는 자동 반복하지 않고 담당자 검토 대상으로 유지합니다.

## 웹 접속

공개 주소: [말결 웹앱](https://malgyeol-vert.vercel.app) · [지원망](https://malgyeol-vert.vercel.app/app) · [요청 진행](https://malgyeol-vert.vercel.app/ops).

Vercel 프로젝트 `malgyeol`이 `public/` 정적 프론트를 제공합니다. `vercel.json`은 지원망·요청 API만 Campbell의 기존 `malgyeol-web-preview` 터널로 전달하며 API 응답은 캐시하지 않습니다. 데이터와 전화 서비스는 Campbell에서 실행됩니다. 터널 주소가 바뀌면 `vercel.json`의 API 목적지도 갱신해야 합니다.

API user unit의 `vercel-origin.conf`에 `PUBLIC_WEB_ORIGINS`로 정확한 Vercel Origin을 허용합니다. 기존 전화용 `PUBLIC_BASE_URL`은 유지합니다. 새 도메인을 추가하면 허용 Origin에도 추가해야 합니다. 웹앱은 담당자 로그인 없이 사용합니다.

배포는 저장소 루트에서 `vercel pull --yes --environment=production`, `vercel build --prod`, `vercel deploy --prebuilt --prod --skip-domain`, 검증 후 `vercel promote <배포URL> --yes` 순서입니다. `.vercelignore`로 공개 파일만 업로드하며 Git 자동 배포는 비활성화했습니다. 2026-09-18 검증: 타입 검사·203개 테스트, 공개 4개 화면 HTTP 200, 브라우저 요청 6건 표시·인증창 없음, 동일 Origin 변경 요청의 입력 검증과 외부 Origin 403, 비공개 파일 경로 404.


현재 웹 요청 화면에는 사용자 요청에 따른 발표용 5명·6개 요청 사례를 연결합니다. `presentation-ledger.conf`의 `COORDINATION_LEDGER_PATH`가 `.private/coordination-presentation.sqlite`를 가리키며 기존 전화용 저장소와 분리합니다. 원본 생성 근거는 비공개 `presentation-provenance.json`에 보존합니다. 이 사례의 문의·답변은 실제 발신 실적으로 집계하지 않습니다. 실전화 검증 전에는 원래 coordination 저장소로 전환해야 합니다.

웹앱은 인증 코드 없이 요청 진행 화면에 바로 접속합니다. 변경 요청은 같은 Origin에서만 허용합니다.

## 문서 및 산출물

현재 브랜치는 `observe-only`입니다. 아래 지도는 실행 관찰과 작업 연결 문서이며 canonical master의 방향 권위나 전체 완료를 주장하지 않습니다. 권위 판정은 프로젝트 라우터 결과를 따릅니다.

- [작업 지도](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/MASTER-MAP.md)
- [실행계획](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/plan.md) · [작업 체크](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/tasks.md) · [실행 근거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/context.md)
- [전화 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/care-coordination/phone-goal-prompt.md) · [API 계약](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/dev/active/malgyeol-product-completion/contracts.md)
- [정책 근거](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/POLICY_BASIS.md) · [정책 제안서 원문](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/AI_FOR_GOOD_SUBMISSION.md)
- [정책 제안서·3분 덱 및 재생성 절차](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/artifacts/hackathon/README.md)
- [아키텍처](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/docs/ARCHITECTURE.md) · [남은 검사](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/TODO.md) · [인계](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/PASSDOWN.md)

정책 제안서는 LaTeX 원본·6쪽 PDF·편집 DOCX, 발표 덱은 LaTeX 원본·6장 PDF·편집 PPTX입니다. 덱 시간 배분은 총 180초이며 대본·발표자 노트는 없습니다. Claude가 design-forge·KRDS MCP 및 공식 KRDS 토큰을 적용한 프론트와 제출물입니다.

## 개발 실행

Node.js 22·npm 10 기준입니다.

```bash
npm ci
npm run verify
npm start
```

| 경로 | 기능 |
|---|---|
| `/` | 제품 소개 |
| `/app` | 네 사업 지원망·기관·이용절차 |
| `/ops` | 요청 진행·정정·중단·수동 재시도 |
| `/health` | HTTP 서비스 상태; 실통화 성공 판정용 아님 |

웹앱은 로그인·세션 만료 없이 사용합니다. `PUBLIC_BASE_URL`을 설정한 서비스는 해당 Origin에서 변경 요청을 보냅니다. 내부 음성 에이전트는 기존 Bearer 인증을 사용합니다.

## 데이터 및 저장

공식 푸드뱅크·그냥드림 목록 65행을 37개 기관으로 정규화하고 3개 보완 창구를 더해 40개 기관을 수록했습니다. 같은 기관의 복수 사업을 분리 보존합니다. 서울 25구의 기본 목록과 확보한 상세 경로를 구별하며, 모든 동주민센터·찾아가는 운영의 상세 구축 완료를 뜻하지 않습니다.

`/api/support/`는 공개 기관 조회, `/api/coordination/`는 시민 요청·동의·기관 문의·통화·답변·회신입니다. 화면과 음성은 이 공통 API를 사용합니다.

`COORDINATION_LEDGER_PATH` 또는 `CARE_LEDGER_PATH`가 SQLite 위치입니다. coordination 원장은 별도 테이블에 저장되어 기존 care 원장을 보존합니다. 운영 환경에서 영속 경로가 없으면 coordination 요청 API는 503으로 닫힙니다. 개발 환경의 경로 미설정 상태는 인메모리이며 재시작 보존을 보장하지 않습니다.

## 전화 실행 및 전환

2026-09-18 사용자 승인으로 `malgyeol-care-voice`를 새 `coordination_voice.py`로 전환했습니다. API는 18081, 새 음성 health는 18083입니다. 이전 `voice` 실행은 중단했습니다. 현재 서비스 ExecStart는 `run-care-runtime.py coordination`이며 시민 접수·기관 문의·시민 회신 도구를 사용합니다. health 준비 응답은 실제 전화 왕복 성공과 별개입니다.

```bash
python3 scripts/configure-phone-roles.py
python3 scripts/run-care-runtime.py coordination-check
python3 scripts/run-care-runtime.py coordination
```

첫 명령은 A/B 번호를 숨김 입력받아 비공개 라우팅을 교체합니다. 두 번째는 설정 검사만 수행하고 발신하지 않습니다. 세 번째는 새 음성 브리지 실행이며, 정상 라우팅과 기존 서비스 점유·전환 조건을 확인한 실행자만 사용합니다. 기존 서비스와 같은 번호를 경쟁 구독하도록 임의로 함께 띄우지 않습니다.

비공개 `.private/coordination-routing.json`의 최상위 필드는 `allowedNumbers`, `citizenNumbers`, `institutionNumbers`입니다. 시민 참조와 기관 ID를 승인된 A/B 번호에 결박하며 실제 번호는 Git에 넣지 않습니다. 파일은 일반 파일·0600 권한이어야 합니다. 시민·기관 역할의 번호 중복과 서비스 자기발신은 차단합니다. 공개 기관 연락처는 시험 번호로 덮어쓰지 않습니다.

- A: 시민 역할 접수와 결과 회신 수신.
- B: 기관 역할의 실제 음성 응답.
- 새 브리지 기본 health: 18083. 통화 작업 기록: `.private/coordination-voice.sqlite`.
- A/B 비공개 라우팅 설정·검사 완료. 팀원 번호 교체는 위 숨김 입력 명령 후 통화 종료 상태에서 음성 서비스 재시작. 실제 전화망 왕복·양방향 오디오 검증은 별도 수행.
- 현재 음성은 대시보드와 같은 API·coordination 원장을 사용합니다. 기존 화면 사례는 음성 journal의 수신 기록에 없으므로 자동 발신 대상이 아닙니다. 새 수신에서 생성한 요청만 자동 후속 처리합니다.
- 임의 공공기관 발신, 다른 세션 서비스 종료, 광범위한 `pkill`은 금지합니다.

비밀 입력은 기존 `CARE_SECRET_DIR`의 `clawops.env`, `bridge.env` 및 `.secrets/care.env`입니다. launcher가 읽으며 값은 명령행·로그·문서에 출력하지 않습니다. `CARE_PHONE_NUMBER`, `CARE_API_BASE_URL`, `CARE_PORT`는 기존 실행 override입니다. 새 브리지는 `COORDINATION_ROUTING_PATH`, `COORDINATION_VOICE_STATE_PATH`, `COORDINATION_HEALTH_PORT`를 사용합니다.

상태 확인은 읽기 전용 명령으로 수행합니다.

```bash
systemctl --user status malgyeol-care-api malgyeol-care-voice
curl -fsS http://127.0.0.1:18081/health
curl -fsS http://127.0.0.1:18083/health
```

`python3 scripts/run-care-runtime.py backup`은 기본 care DB의 SQLite backup API·integrity_check를 사용합니다. 기본 DB에 함께 저장된 coordination 테이블도 포함합니다. 별도 `COORDINATION_LEDGER_PATH` 사용 시 그 파일의 백업은 별도로 구성해야 합니다. 실행 중 DB를 WAL 없이 단순 복사하지 않습니다.

## 검증 범위

섹션 4 기록 기준 Node 198개·설치 SDK Python 23개, 프론트 브라우저 검사 23개와 회귀 24개, 타입·의존성 검사, 실제 HTTP·SQLite 복원·화면 동작을 확인했습니다. 최종 재검사 결과는 실행 기록에 갱신합니다. 해당 검사는 실제 전화망 왕복이나 기관 제공 실적이 아닙니다.

기존 `/api/care/`, `/api/demo/care/`, `src/care-support/`와 과거 상품·배송 모듈은 호환·회귀 근거로 보존합니다. 고정 이용자·쌀 4kg·숫자키 승인 흐름은 새 제품 정의가 아닙니다.

## 권리 및 기여

모든 권리는 [LICENSE](LICENSE)에 따라 유보됩니다. 저장소 열람·포크는 복제·배포·상업 이용 허락을 뜻하지 않습니다. 외부 기여는 사전 승인과 별도의 서면 계약이 필요하며 [CONTRIBUTING.md](https://github.com/sergiobuilds/malgyeol/blob/feat/ai-for-good-product/CONTRIBUTING.md)를 따릅니다.
