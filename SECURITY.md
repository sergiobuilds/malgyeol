# 보안 정책

## 비공개 제보

취약점은 공개 Issue에 쓰지 말고 저장소 소유자 `sergiobuilds`에게 비공개 채널로 전달합니다. 재현 조건, 영향 범위, 관련 파일과 안전한 재현 절차를 포함합니다.

## 공개하면 안 되는 자료

- API 키, OAuth 토큰, 서비스계정 JSON, 서명키, seed phrase
- 실제 수령인 이름, 전화번호, 주소, 주문 인증정보
- 실제 통화 녹음과 공급자 자격정보
- 운영용 `.env`, Secret Manager 값, Firestore 원자료

커밋 전 Gitleaks와 GitHub secret scanning을 확인합니다. 비밀정보가 커밋되면 파일 삭제만으로 끝내지 않고 자격정보를 먼저 폐기한 뒤 Git 이력을 처리합니다.

## 신뢰 경계

- Gemini는 자연어를 구조화하며 정책 승인이나 결제 권한을 갖지 않습니다.
- 실제 주문과 결제는 명시적 확인, 결정론적 정책, 범위 제한 자격정보를 통과해야 합니다.
- 공개 증거는 개인정보가 제거된 projection만 노출합니다.
- Solana 증거는 Devnet이며 Mainnet 실가치 결제가 아닙니다.

## 의존성 경계

현재 Solana v1 호환 계층에는 패치 버전이 없는 `bigint-buffer`와 구형 RPC 계층의 간접 경고가 남아 있습니다. 외부 입력을 임의 Buffer나 깊은 JSON 필터로 넘기지 않으며, Devnet mint·destination·amount는 고정된 검증을 통과합니다. 패치 가능한 upstream이 나오면 Dependabot PR에서 전체 검증 후 반영합니다.

CI는 critical 등급을 즉시 차단합니다. high·moderate 경고도 PR에서 새로 늘어나면 병합하지 않습니다.
