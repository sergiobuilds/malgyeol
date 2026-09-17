# 말결

말결은 서울형 통합돌봄의 개인별지원계획을 재가 어르신이 일반 전화로 실행할 수 있게 하는 음성 기반 서비스 이행 채널입니다.

어르신이 승인된 식사·식품·생필품 지원을 전화로 요청하면 수행기관에 전달하고, 수락·제공·수령 결과를 같은 사건으로 기록합니다. AI는 말을 구조화할 뿐 신규 자격, 급여 또는 개인별지원계획을 결정하지 않습니다. 정상 요청은 수행기관으로 보내고 계획 밖 요청과 위험 신호만 담당자에게 이관합니다.

> 현재 저장소는 합성 개인별지원계획과 시연 데이터를 사용하는 제품 후보입니다. 서울시·자치구 시스템, 실제 푸드마켓 재고, 실제 수혜자 개인정보와 연결되어 있지 않습니다.

## 정본

- 방향·범위·상태: [MASTER-MAP](docs/MASTER-MAP.md)
- 법·정책·공급망·실증 근거: [정책·실증 근거](POLICY_BASIS.md)
- 구현 구조: [아키텍처](docs/ARCHITECTURE.md)
- 해커톤 제출 자료: [AI for Good 제출 자료](docs/AI_FOR_GOOD_SUBMISSION.md)

현재 브랜치는 `observe-only`입니다. 위 지도는 사용자 승인 방향의 작업 문서이며 canonical master의 managed 완료를 의미하지 않습니다. 권위 판정은 프로젝트 라우터 결과를 따릅니다.

## 실행

Node.js 22와 npm 10이 필요합니다.

```bash
npm ci
npm run check
npm start
```

- 소개: `http://localhost:8080/`
- 어르신 요청: `http://localhost:8080/?v=request`
- 수행기관 업무함: `http://localhost:8080/?v=provider`
- 담당자 예외·감사 화면: `http://localhost:8080/?v=ops`
- 3분 발표 흐름: `http://localhost:8080/?v=demo`
- 기술 경계: `http://localhost:8080/tech`
- 상태 확인: `http://localhost:8080/health`

## 현재 제품 흐름

```text
전화·웹 요청 → 개인별지원계획 범위 확인 → 이용자 재확인
             → 수행기관 전달 → 수락·제공 → 수령 확인
             → 정상 종결 또는 담당자 예외 이관
```

- 첫 실증에는 이용자 결제 기능을 포함하지 않습니다.
- 수행기관은 찾아가는 푸드마켓, 돌봄SOS 또는 자치구가 승인한 협약기관을 가정합니다.
- 민간 공급자는 공공 공급이 불가능하고 자치구가 승인한 경우에만 교체 가능한 어댑터로 둡니다.
- 모든 화면과 API의 시연 데이터는 `SYNTHETIC_DEMO`로 구분합니다.

## 과거 기술검증

저장소에는 전화 입력, 상품 공급자, 주문·배송·수령을 검증했던 이전 모듈이 남아 있습니다. 이는 기술 증거와 호환 계층으로만 보존하며 현행 제품의 정책 방향이나 기본 실행 경로가 아닙니다. 현행 전환 상태는 MASTER-MAP의 Work Tree에서 관리합니다.

## 전화 운영과 복구

2026-09-17 발급 번호는 **070-5276-7277**입니다. ClawOps SDK 역방향 연결로 Campbell의 Gemini 음성 브리지가 받습니다. 번호 발급·제어 연결 준비 상태와 실제 통화 성공은 별개입니다. 실제 수신·배송 완료 증거는 아직 없습니다. 음성에서는 연습용임을 먼저 알립니다.

- API: `scripts/run-care-runtime.py api`, Campbell `127.0.0.1:18081`.
- 음성: `scripts/run-care-runtime.py voice`, SDK health `127.0.0.1:18082/healthz`.
- 실행 중인 user transient unit: `malgyeol-care-api`, `malgyeol-care-voice`. 재부팅 자동 시작 등록은 아직 하지 않았습니다.
- 비밀 입력: `CARE_SECRET_DIR`(기본 인접 `benefit-settlement-rail/.secrets`)의 `clawops.env`, `bridge.env`. 역할별 토큰은 이 저장소의 `.secrets/care.env`입니다. 값은 로그·명령행·Git에 넣지 않습니다.
- 기존 입력 이름: `CLAWOPS_API_KEY`, `CLAWOPS_ACCOUNT_ID`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_GENAI_USE_VERTEXAI`, `GEMINI_LIVE_MODEL`, `AGENT_TOOL_SECRET`. 승인된 기존 모델을 그대로 사용합니다.
- 운영 override: `CARE_PHONE_NUMBER`, `CARE_API_BASE_URL`, `CARE_PORT`, `CARE_SECRET_DIR`. 런타임 원장은 `.private/care-ledger.sqlite`입니다.
- 역할 입력: `CARE_PROVIDER_TOKEN`, `CARE_RECIPIENT_TOKEN`, `CARE_OPERATOR_TOKEN`은 서로 다른 32자 이상 비밀입니다. 현재는 합성 이용자 1명과 설정된 기관에만 결박한 실증 전 API이며 실제 기관 사용자 인증은 미연결입니다.

```bash
systemctl --user status malgyeol-care-api malgyeol-care-voice
curl -fsS http://127.0.0.1:18081/health
curl -fsS http://127.0.0.1:18082/healthz
journalctl --user -u malgyeol-care-api -u malgyeol-care-voice --since '10 minutes ago'
systemctl --user restart malgyeol-care-api malgyeol-care-voice
```

재부팅 후에는 위 Python 실행 명령을 각각 관리 터미널에서 시작하거나 `systemd-run --user --unit=malgyeol-care-api --property=Restart=on-failure /usr/bin/python3 "$PWD/scripts/run-care-runtime.py" api`와 대응하는 voice 명령으로 transient unit을 다시 만듭니다. 기존 18080 컨테이너는 별도 실행이므로 중지하지 않습니다.

장애 시에는 이 운영자가 소유한 voice unit만 중지해 자동 접수를 차단하고, `/api/care/inbox`의 예외를 담당자가 확인합니다. `SENDING`·`UNKNOWN`은 전송 여부가 불명확하므로 다시 submit하지 않고 readback 또는 수행기관 수동 확인으로 처리합니다. 담당자가 올린 예외는 늦은 응답으로 자동 해제되지 않습니다. 실제 담당자 연락처·통화 전환 회선은 아직 연결되지 않았으므로 시스템은 연결 완료를 안내하지 않습니다.

SQLite는 트랜잭션 안에서 통화 확인·누적 수량·사건·이력을 함께 저장합니다. 프로세스가 멈춰도 같은 callId 확인은 다시 접수되지 않습니다. 운영 중 백업은 SQLite backup API로 일관된 snapshot을 만들고 별도 접근제한 저장소에 보관해야 합니다. WAL 파일을 제외한 실행 중 DB 단순 복사는 금지합니다. 자동 백업과 장기 보존·삭제 정책은 실증 전 미완료입니다.

공개 `/api/demo/care/`는 별도 인메모리 합성 데이터만 사용합니다. 전화 사건은 인증된 `/internal/care-agent/`와 `/api/care/`에만 있습니다. production에서 `CARE_LEDGER_PATH`가 없으면 운영 API는 503으로 닫히며 공개 데모만 제공합니다. Cloud Run의 임시 파일시스템을 영속 원장으로 간주하지 않습니다.

검증: `npm run verify`, `~/.config/agents/scripts/project-doctor "$PWD"`. 항목별 실제 증거와 미완료 사유는 [TODO](TODO.md), 섹션별 리뷰는 [실행 기록](dev/active/care-phone-recovery/care-phone-recovery-context.md)에 있습니다.

## 권리와 기여

이 저장소는 공개 소프트웨어 사용권을 부여하지 않습니다. 열람이나 포크 가능 여부가 복제, 배포 또는 상업 이용 권한을 뜻하지 않습니다. 모든 권리는 [LICENSE](LICENSE)에 따라 유보됩니다.

외부 기여는 사전 승인과 별도의 서면 기여 계약이 있어야 받습니다. 저장소 접근은 저작권, 지분, 수익분배, 고용 또는 파트너십을 만들지 않습니다. 자세한 절차는 [기여 안내](CONTRIBUTING.md)를 따릅니다.
