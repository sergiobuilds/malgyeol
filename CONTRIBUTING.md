# 기여 안내

## 개발 환경

- Node.js 22
- npm 10.9.8
- Rust 1.98.1

```bash
npm ci
npm run check
```

`npm run check`는 TypeScript 검사, 전체 Node 테스트, Rust workspace 테스트를 실행합니다. Rust 형식과 lint는 CI에서 별도로 검사합니다.

애플리케이션 설정은 `.env.example`, 외부 증거 생성 스크립트 설정은 `.env.proof.example`을 기준으로 합니다. 두 파일의 이름은 자동 테스트가 실제 코드의 `process.env` 참조와 대조합니다.

## 작업 방식

1. `master`에서 작업 브랜치를 만듭니다.
2. 한 PR에는 한 목적만 담습니다.
3. 동작 변경에는 실패 재현 또는 회귀 테스트를 포함합니다.
4. PR 본문의 검증 항목을 실제로 실행하고 결과를 기록합니다.
5. `master`는 CI와 코드 소유자 승인을 통과한 PR로만 변경합니다.

이 저장소는 공개 열람이 가능하지만 공개 소프트웨어 사용권을 부여하지 않습니다. 참여자는 저장소 소유자와 합의한 범위에서만 코드를 사용하고 기여합니다. 제3자 코드는 `THIRD_PARTY_NOTICES`와 각 의존성의 사용권을 따릅니다.

## 실행 권한 경계

아래 명령은 코드 검토만으로 실행하지 않습니다.

- `proof:*:devnet`, `setup:*`, `proof:cloud-live-case`
- 실제 공급자 주문을 만드는 경로
- 실제 전화 발신·수신 경로
- Cloud Build 또는 Cloud Run 배포
- Devnet 서명키나 기관 키를 읽는 경로

이 작업들은 Sergio의 명시적 승인과 별도 자격정보가 있어야 합니다. PR과 Issue에 자격정보, 실제 수령인 정보, 녹음, 배송주소를 붙이지 않습니다.

## 배포 경계

`cloudbuild.yaml`은 컨테이너 이미지를 빌드하고 Artifact Registry에 올릴 뿐 Cloud Run 리비전을 전환하지 않습니다. Write 권한은 배포 권한이 아닙니다. 배포는 저장소 소유자가 CI 통과 commit을 지정해 수행하고, `/health`, `/tech`, 제품 화면, 공개 주문 증거를 확인한 뒤 트래픽을 전환합니다. 문제가 있으면 직전 정상 리비전으로 트래픽을 되돌립니다.

## 현재 구조

전체 구조와 제출 당시 증거 단위는 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)를 따릅니다. `G2`~`G6`, `U3`~`U9`는 안정적인 증거 ID이며 개발 우선순위를 뜻하지 않습니다.

## 의존성

Solana v1 호환 계층에는 upstream에서 패치 버전을 제공하지 않은 간접 의존성 경고가 남아 있습니다. 관련 패키지를 바꾸는 PR은 `npm audit` 결과, 전체 Node 테스트, Devnet 경계 테스트를 함께 제시해야 합니다. 강제 하향 설치로 경고 수만 줄이지 않습니다.
