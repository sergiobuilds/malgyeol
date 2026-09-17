# 말결 정책 제안서 · 3분 발표 덱

이 디렉토리의 산출물과 그 제작 근거. 모든 파일은 `build.py` 하나로 다시 만든다.

## 1. 산출물

| 파일 | 내용 |
|---|---|
| `malgyeol-policy-proposal.tex` | 정책 제안서 조판 원본 (xelatex) |
| `malgyeol-policy-proposal.pdf` | 위 원본을 xelatex 으로 컴파일한 결과 (6쪽, 표 10개) |
| `malgyeol-policy-proposal.docx` | 같은 내용의 편집 가능한 Word 문서 (문단·표 모두 텍스트) |
| `malgyeol-3min-deck.tex` | 발표 덱 조판 원본 (beamer, 16:9) |
| `malgyeol-3min-deck.pdf` | 위 원본을 xelatex 으로 컴파일한 결과 (본편 6장) |
| `malgyeol-3min-deck.pptx` | 같은 내용의 편집 가능한 PowerPoint (텍스트·도형·연결선) |
| `build.py` | 위 여섯 파일의 생성기 |
| `fonts/` | 조판에 쓰는 Pretendard GOV TTF 와 글꼴 라이선스 원문 |
| `policy-content.json`·`deck-content.json` | 확정된 내용 입력. 이 디렉토리에서는 읽기 전용 |

두 PDF 는 각각의 `.tex` 를 실제로 컴파일한 산출물이다. 다른 경로에서 만든 PDF 로
갈아끼우지 않았다. PPTX·DOCX 도 통짜 페이지 이미지가 아니라 편집 가능한
텍스트 상자·도형·표로 구성했다.

## 2. 명령

```bash
# 준비: fonttools 가 필요해 별도 가상환경을 쓴다(시스템 python 은 PEP 668 로 설치 차단)
python3 -m venv --system-site-packages /mnt/data/work/malgyeol-reference/submission/venv
/mnt/data/work/malgyeol-reference/submission/venv/bin/pip install fonttools brotli

cd artifacts/hackathon
VENV=/mnt/data/work/malgyeol-reference/submission/venv/bin/python
$VENV build.py all          # tex → pdf → docx → pptx → 검수
$VENV build.py tex          # 조판 원본만
$VENV build.py pdf          # xelatex 3회 컴파일
$VENV build.py verify       # 내용 일치·쪽수·변환 검사와 검수용 이미지 렌더
```

### 2.1 실제 화면 반영

3·4번 슬라이드에는 실제 담당자 화면이 들어간다.

- 원본: `assets/frontend-request-partial.png` (1440x3534).
  저장소 안에 두었고 `DEFAULT_SHOT` 이 이 디렉토리 기준 상대 경로를 가리키므로,
  clone 뒤 이 디렉토리 자료만으로 그대로 빌드된다. 외부 경로 입력이 필요 없다.
  sha256 `d9895a5dc77f90f420c1ae970b21b369f4d777b2214eef6fcce7bd3727bbcfff`.
- 전체 화면을 줄여 넣지 않는다. `SHOT_CROPS` 에 적은 영역만 잘라 슬라이드에서
  글씨가 읽히는 크기로 넣는다. 잘라낸 자산도 `assets/crops/` 에 함께 보존한다.
  생성되는 `.tex` 도 절대 경로가 아니라 `assets/crops/…` 상대 경로를 적는다.

| 슬라이드 | 자르는 영역 (left, top, right, bottom) | 크기 | 담긴 내용 |
|---|---|---|---|
| 3 | `(505, 1042, 990, 1244)` | 485x202 | 기관 문의 카드 — 기관명 · 문의 목적 · 문의한 내용 3건 |
| 4 | `(95, 828, 458, 1004)` | 363x176 | 성동구 상태 카드 — 복수 필요 요청의 진행 상태 배지 |

프런트엔드가 다시 갱신되면 `assets/frontend-request-partial.png` 를 새 캡처로
바꾸고 아래 한 줄을 돌린다. 영역이 달라지면 `SHOT_CROPS` 좌표만 고친다.

```bash
$VENV build.py all                                   # 저장소 안 기본 자산 사용
$VENV build.py all --screenshot /다른/경로/shot.png   # 다른 원본을 쓸 때
$VENV build.py all --no-screenshot                   # 화면 없이(빈 자리 없이) 만들 때
```

화면이 없을 때(`--no-screenshot`)는 오른쪽 자리를 비워 두지 않고 왼쪽 내용이
그대로 남으며, 빈 placeholder 그림은 어느 경우에도 그리지 않는다. 같은 생성기로
덱 PDF 와 PPTX 가 동시에 갱신되고 두 형식 모두 같은 위치·같은 크기로 화면을
넣는다. 실제로 컴파일해 확인했다(덱 PDF 6장 · PPTX 6장 · LibreOffice 변환 6쪽).

#### 캡처의 성격

이 캡처는 **격리된 QA 환경의 HTTP 서비스와 SQLite 에 구성한 기관 응답으로
실제 프런트엔드를 실행해 찍은 화면**이다. 화면에 보이는 기관명·답변·상태는
그 QA 구성에서 나온 것이며, **실제 통화가 이루어졌다는 증거가 아니다.**
실제 전화망 왕복은 제안서 6장에 `운영 전 수용검사 계획` 으로 적혀 있고 완료
실적으로 쓰지 않았다. 이 구분은 이 문서에만 적고, 슬라이드 위에 `목업`·`시연용`
같은 배지를 얹지 않는다(대외 자료에 내부 분류를 노출하지 않는다는 원칙).

중간 산출물(aux·log·렌더 이미지·LibreOffice 변환본·가상환경)은
`/mnt/data/work/malgyeol-reference/submission/` 에 둔다. 저장소에는 넣지 않는다.

## 3. 디자인 근거 — KRDS

### 3.1 원본

- 공식 저장소 `https://github.com/KRDS-uiux/krds-uiux`, 기준 커밋
  `d6bb184c823e4757f05807ea4646a23e3133b6e6` (로컬 pack 의 `git log` 로 확인).
- 로컬 pack `/mnt/data/work/malgyeol-reference/packs/krds-design-system`.
  `BRAND.md`·`FONT-SOURCES.md`·`source-manifest.json`·`forge-pack.json` 과
  토큰 정본 `resources/css/token/krds_tokens.css` 를 실제로 읽었다.
- 이 산출물은 KRDS 토큰을 적용한 문서일 뿐이다. 공식 KRDS 인증이나 정부 승인,
  존재하지 않는 "KRDS PPT 인증" 을 주장하지 않는다. 정부 마크·태극기·공식
  정부 사이트 표어를 쓰지 않았다.

### 3.2 색 — `krds_tokens.css` 원값

| 쓰임 | KRDS 토큰 | 값 |
|---|---|---|
| 문서·슬라이드 본문 글자 | `--krds-color-light-gray-90` | `#1e2124` |
| 표 본문·카드 본문 글자 | `--krds-color-light-gray-80` | `#33363d` |
| 보조 설명·출처 줄 | `--krds-color-light-gray-60`, `-50`, `-40` | `#58616a`, `#6d7882`, `#8a949e` |
| 하이퍼링크·근거 표식 | `--krds-color-light-primary-60` | `#0b50d0` |
| 표제부 구분선·카드 강조 막대 | `--krds-color-light-primary-50` | `#256ef4` |
| 처리 단계 상자 테두리 | `--krds-color-light-primary-20` | `#b1cefb` |
| 카드 라벨 | `--krds-color-light-primary-70` | `#083891` |
| 4장 갈래 표시(유지·재선택·인계) | `success-60`·`primary-60`·`warning-60` | `#267337`·`#0b50d0`·`#8a5c00` |
| 표 머리행 바탕 | `--krds-color-light-secondary-70` | `#063a74` |
| 카드 바탕·표 줄무늬 | `--krds-color-light-gray-5` | `#f4f5f6` |
| 처리 단계 묶음 바탕 | `--krds-color-light-graphic-10` | `#e5ecf9` |
| 4장 사례 머리 바탕 | `--krds-color-light-secondary-5` | `#eef2f7` |
| 머리말 밑줄·표 경계·하단 띠 | `--krds-color-light-gray-20` | `#cdd1d5` |
| 문서 바탕 | `--krds-color-light-gray-0` | `#ffffff` |

색만으로 상태를 구별하는 표현은 쓰지 않았다. 4장의 세 갈래도 색과 함께
`유지`·`재선택`·`인계` 라는 이름을 적는다. 표의 줄무늬는 장식이 아니라
행 구분 보조이며, 머리행은 배경색과 함께 굵기·대비로도 구별된다.

### 3.3 타이포그래피

`--krds-typo-font-type: Pretendard GOV`. PC 토큰 rem 값을 인쇄 pt 로 환산했다
(CSS 기준 1px = 0.75pt, KRDS 는 1rem = 10px).

| 쓰임 | KRDS 토큰 | rem → pt | 행간 |
|---|---|---|---|
| 제안서 제목 | `heading-large` | 3.2rem → 24pt | 1.2 |
| 절 제목 | `heading-small` | 1.9rem → 14.25pt | 1.4 |
| 표제부 부제 | `body-medium` | 1.7rem → 12.75pt | 1.6 |
| 본문 | `body-small` | 1.5rem → 11.25pt | 1.6 |
| 표 본문·근거 줄 | `body-xsmall` | 1.3rem → 9.75pt | 1.6 |

행간 1.6(본문)·1.2~1.4(제목)은 KRDS MCP 의 typography 응답과 일치한다.

### 3.4 간격 — `--krds-number-*`

여백과 간격은 `--krds-number-*` (0.8·1.0·1.2·1.6·2.0·2.4·3.2·4.0·6.4·7.2rem …)
스케일에서 골랐다. 제안서 좌우 여백 19mm 는 `--krds-number-19`(7.2rem = 72px =
54pt ≈ 19.05mm), 절 간 간격 24pt 는 `--krds-number-12`(3.2rem = 32px = 24pt),
문단 간격 6pt 는 `--krds-number-4`(0.6rem)에서 나온 값이다.
덱의 카드 간격 6mm·안쪽 여백 4mm 도 같은 스케일의 근사값이다.

### 3.5 정보 위계

- 제안서: 표제부(분류 라벨 → 제목 → 부제 → 확인일 → 주색 구분선) → 절 제목 →
  본문 → 표 → 근거 줄. 별도 표지 없이 1쪽 상단에 표제부를 두고 같은 쪽에서
  1장이 시작한다. 단독 제목 페이지를 만들지 않았다.
- 덱: 공통 상단 제품 표기(말결) → 작은 주색 라벨(번호 + 슬라이드명) → 큰 굵은
  제목 → 본문(번호 줄·카드·처리 단계·분기·실제 화면) → 하단 구분선 → 출처 →
  쪽 표시. 모든 슬라이드가 같은 골격을 쓴다.
- 표: `caption` 역할의 표 제목 → 머리행 → 본문. 쪽을 넘길 때 머리행을 반복한다
  (LaTeX `\endhead`, DOCX `w:tblHeader`). 표가 쪽 밖으로 넘치지 않도록
  `xltabular`(LaTeX)과 고정 레이아웃(DOCX)으로 분할하고, §11 두 표는 고립행을
  막기 위해 쪽을 쪼개지 않는 `tabularx` 로 통째 배치한다.

### 3.6 참고 덱 열람

지정 참고 자료 `/mnt/data/work/malgyeol-reference/모두의창업_발표덱.pdf` 와 같은
폴더의 `landscape-01~18.png` 를 실제로 열어 보았다(3·6·12번 등).
가져온 것은 구조뿐이다 — 작은 주색 eyebrow 라벨, 큰 굵은 제목, 회색 카드 묶음,
테두리 있는 우측 패널, 넉넉한 여백과 낮은 밀도. 옛 사업 내용(국고보조금 회계검증),
어두운 슬라이드, 브라우저 인쇄 머리말·꼬리말(`26. 9. 18. 오전 3:14`, claude.ai URL,
`3/18`)은 복사하지 않았다.

### 3.7 KRDS MCP 호출

`krds-mcp` 서버 도구를 실제로 호출했다. 호출 목록·응답 요약·값 상충 해결은
`/mnt/data/work/malgyeol-reference/submission/mcp-records/calls.md` 에 있다.
요약하면 typography(heading·body), design_tokens(spacing·typography),
colors(전체), components(table), validate_accessibility 를 호출했고,
접근성 검증은 이 제안서 4장 구조를 옮긴 HTML 조각으로 100/100 · WCAG AA 를 받았다.

**값 상충.** MCP 는 주색 Government Blue `#0F4C8C`, Gray 900 `#212529`, 4px 배수
간격, 본문 16px 를 돌려준다. 공식 저장소 토큰은 각각 `primary-50 #256ef4`,
`gray-90 #1e2124`, `--krds-number-*` rem 스케일, `body-small` 1.5rem 이다.
제작 계약에 따라 **공식 저장소 토큰을 채택**했다. MCP 값은 위계·행간·표
가이드라인의 교차 확인 용도로만 썼다.

## 4. 서체

- 사용 자산: KRDS 지정 커밋 `resources/fonts/PretendardGOV-{Regular,Bold}.subset.woff`.
- 제작자 원문 `https://github.com/orioncactus/pretendard`, 라이선스 SIL Open Font
  License 1.1. 원문은 `fonts/OFL-1.1-Pretendard.txt` 로 보존했다.
- WOFF → TTF 변환은 fonttools 로 했다(`TTFont(...); flavor=None; save(...)`).
  변환은 컨테이너만 벗기며 글리프·메트릭을 바꾸지 않는다.

| 파일 | 원본 WOFF sha256 | 변환 TTF sha256 |
|---|---|---|
| Regular | `c0e2be45…5533d` | `2970ef04…3105` |
| Bold | `6f2e1b83…04dca` | `12f2efcd…23e4` |

원본 WOFF 해시는 pack 의 `FONT-SOURCES.md` 기록과 일치함을 `sha256sum` 으로
확인했다. Medium 은 이번 조판에서 쓰지 않아 보존하지 않았다.

**한 글자 예외.** KRDS subset 은 3,728자를 담고 있으며, 입력 내용 중 `ㆍ`
(U+318D, 아래아) 하나만 빠져 있다. 이 글자는 공식 법령명
`「의료ㆍ요양 등 지역 돌봄의 통합지원에 관한 법률」` 에 실제로 들어 있어
다른 글자로 바꾸지 않았다. 그 한 코드포인트만 시스템의 Noto Sans CJK KR
(U+318D 포함 확인)로 그린다. 다른 글꼴로의 전면 대체가 아니라 단일 코드포인트
대체이며, LaTeX·DOCX·PPTX 모두 같은 규칙을 쓴다.

생성기는 출력에 닿는 **모든** 문자열(입력 JSON 뿐 아니라 표 머리행·표 제목·
`출처`·쪽 표시처럼 생성기가 직접 쓰는 문자열까지)에 대해 글리프 포함 여부를
검사하고, 위 예외 밖의 누락이 하나라도 있으면 빌드를 중단한다.

## 5. 내용 근거

- 제안서 본문 11개 절·문단·절별 근거는 `policy-content.json` 을 그대로 쓴다.
  요약하거나 줄이지 않았다.
- **`section.table` 전체 수록.** 2·3·4·5·6·8·9장의 `table` 을 헤더·셀 그대로
  표 1~5·7·8 로 싣는다. 재량 축약은 없다. 4장은 같은 정보를 표 하나로 합치되
  `POLICY_BASIS.md` 4.1~4.4 의 기관별 유의사항을 열 하나로 덧붙여 개별 셀 내용을
  보존한다.
- 표 6(정책 협력 요청별 세부 항목)은 7장 문단의 `구분: 항목—내용` 구조를
  생성기가 기계적으로 분해한 것이다. 항목 구성이 `필요성·주체·협력·제품 반영·측정`
  다섯 개와 다르면 빌드가 중단된다. 문구를 새로 쓰지 않는다.
- 표 9(정책 근거 대응)는 `basisMapping` 11행 전부, 표 10(참고자료 목록)은
  `references` 17건 전부를 담는다. 두 표는 쪽을 쪼개지 않는 `tabularx` 로 짜
  마지막 한 행만 다음 쪽에 남는 고립행이 생기지 않게 했다. 글자 크기는 줄이지 않았다.
- 출처 표기: 본문과 표 셀 안의 `[S1]`·`[F1]` 표식과 절 끝 `근거: P0 · E2` 줄은
  짧은 번호에 하이퍼링크를 건다. 긴 URL 을 본문에 늘어놓지 않아 본문 폭이 깨지지
  않는다. 표 10에서만 자료명에 링크를 걸고 제공처를 도메인으로 짧게 표시한다.
  링크 대상은 퍼센트 인코딩하고 남은 TeX 특수문자(`%`·`&`·`#`·`_`)를 보호한다.

### 5.1 발표 덱

- 본편 6장. 표지·부록·목차 슬라이드를 추가하지 않았다.
- 제품명은 모든 슬라이드 공통 상단에 둔다(`말결` + `전화 기반 생활지원 연계`).
  별도 표지를 만들지 않고 머리 영역에서 제품이 식별된다.
- 시간 배분(총 180초): 1장 25초 · 2장 25초 · 3장 45초 · 4장 35초 · 5장 30초 ·
  6장 20초. **슬라이드에는 찍지 않는다.** 발표 대본·내레이션·발표자 노트도 없다.
- 슬라이드마다 출처를 하단에 짧은 자료명 + 하이퍼링크로 싣는다.
- 1장은 번호가 붙은 가로 줄 세 개로 반복 업무가 쌓이는 모습을 보인다.
  큰 빈 회색 상자에 짧은 문장 하나를 놓지 않는다.
- 3장 왼쪽은 `deck-content.json` 의 `steps` 6단계를 순서대로 싣고, 오른쪽은
  실제 담당자 화면의 기관 문의 항목이다. 없는 기능을 그리지 않는다.
- 4장은 기관 답변 하나가 **유지·재선택·인계** 세 갈래로 나뉘는 구조를 그린다.
  갈래 이름은 각 글머리에 실제로 쓰인 낱말에서 가져왔고, 같은 회색 카드 네 개를
  복제하지 않는다. 색만으로 구분하지 않고 갈래 이름을 함께 적는다.
- 한글 줄바꿈: 어절 단위로 끊어 `연속 처리`의 `리`, `시민 회신`의 `신` 처럼
  한 글자만 다음 줄에 남는 현상을 없앴다. 줄 폭보다 긴 어절은 묶지 않아
  overfull 을 만들지 않는다(생성기의 `tex_nb`).
- `deck-content.json` 의 `verification` 은 `renderOnSlides: false` 이므로
  슬라이드에 넣지 않았다. 기록은 아래 6절에 둔다.

### 5.2 하지 않은 주장

- 완료하지 않은 통화를 성공 실적으로 적지 않았다. 제안서 6장은 기관 문의·신청
  의사 전달·접수·일정 확정·실제 제공을 단계별로 구분해 표기한다.
- 공공기관 참여 확약·지원 승인·물품 제공·실제 전화망 왕복 성공을 주장하지 않는다.
- 제품 설명에 미검증·목업·시연용 같은 내부 배지를 넣지 않았다.
- 절감률·지원 성공률·경제성의 선확정 수치를 넣지 않았다.

## 6. 검수

도구는 먼저 확인했다 — `xelatex`·`lualatex`·`libreoffice`(soffice)는 시스템에,
`kotex`·`xetexko`·`beamer`·`fontspec`·`xltabular`·`titlesec`·`fancyhdr`·`multirow`·
`tikz` 는 `kpsewhich` 로, `python-pptx 1.0.2`·`python-docx`·`PyMuPDF 1.28.2` 는
import 로 확인했다. `fontTools` 만 없어 가상환경에 설치했다(4.65.0).

### 6.1 기계 검사 (`build.py verify`)

- 쪽수: 제안서 5쪽, 덱 6장. 덱이 6장이 아니면 실패로 처리한다.
- 내용 일치: `policy-content.json` 의 모든 절 제목·문단, `basisMapping` 전 행,
  참고자료 제목, 표 1의 모든 문구를 **PDF 와 DOCX 양쪽**에서 대조(121건 + 표제 2건).
  `deck-content.json` 의 모든 슬라이드 제목·헤드라인·글머리와 흐름도 라벨을
  **덱 PDF 와 PPTX 양쪽**에서 대조(59건). 쪽 넘김 때 끼어드는 머리말·쪽 표시는
  대조 전에 걷어낸다.
- 조판 경고: xelatex 로그의 `Overfull \hbox`/`\vbox` 를 세어 보고한다. 현재 0건.
- 편집 원본 변환: PPTX 와 DOCX 를 LibreOffice 로 별도 임시 PDF 로 바꿔
  PPTX 가 6장인지 확인한다. 최종 PDF 는 xelatex 산출물을 그대로 둔다.
  LibreOffice 가 Pretendard GOV 를 찾도록 `submission/fonts.conf` 로
  `FONTCONFIG_FILE` 을 지정한다(홈에 글꼴을 설치하지 않는다).

- 링크 실재: DOCX 의 `w:hyperlink` 요소 수와 그 안의 run 수, 외부 관계 수를 세고,
  PPTX run 의 `hyperlink.address` 를 세고, PDF 의 실제 링크 주석을 뽑아
  퍼센트 인코딩 상태까지 본다. "파랗고 밑줄만 그어진 글자" 를 링크로 착각하지
  않기 위한 검사다.

마지막 실행 결과: 제안서 5쪽·덱 6장, 내용 대조 121 + 2 + 59 + 59건 전부 일치,
Overfull 0건, PPTX→PDF 6쪽·DOCX→PDF 7쪽, DOCX 링크 94개(내부 run 94개·외부 관계
17개)·PPTX 링크 17개·PDF 링크 94개, 법령명 링크의 아래아가 `%E3%86%8D` 로
정상 인코딩. 전부 통과.

### 6.2 이미지 기반 검수

PDF 전 쪽을 PyMuPDF 로 이미지(110dpi)로 렌더해 실제로 열어 보았다. 마지막에는
두 PDF 의 모든 쪽(제안서 5쪽·덱 6장)을 최종 상태로 다시 확인했다. 다섯 차례
돌면서 고친 것:

| 회차 | 발견 | 처리 |
|---|---|---|
| 1 | `ㆍ` 가 엉뚱한 글자로 나옴. 대체 글꼴이 PDF 에 아예 박히지 않음 | 원인은 xetexko 가 한글류 문자를 한글 폰트로 돌리는 것. `\newfontfamily` 대신 `\newhangulfontfamily` 로 교정. 임베드 확인 |
| 1 | 덱 3번 흐름도의 설명 글이 상자 밖으로 흘러나옴 | 고정 크기 사각형 위에 글을 얹던 방식을 버리고 TikZ 노드가 내용에 맞게 커지도록 재작성 |
| 1 | 덱 1번 카드가 지나치게 비어 보임 | 한 줄 배치일 때 카드 높이를 내용에 맞추고 본문 영역 안에서 세로 가운데 정렬 |
| 1 | 본문 `[S1]` 표식이 지나치게 큼 | 7pt `\raisebox` 로 축소 |
| 2 | 덱 2번 하단 출처가 두 줄로 넘쳐 쪽 밖까지 내려감 | 하단 띠 위치와 글자 크기 조정, 본문 영역 하한 상향 |
| 2 | 흐름도 설명이 낱말 중간에서 잘려 한 글자만 다음 줄로 감 | 설명 글자 크기와 상자 폭 조정 |
| 3 | 표의 한 줄짜리 셀과 여러 줄짜리 셀의 첫 줄이 어긋남 | 최소 재현으로 원인 확인 — 셀 앞머리의 `\color` 가 수직 목록에 whatsit 을 넣어 첫 기준선을 한 줄 밀어냄. 모든 셀을 `\leavevmode` 로 시작하게 통일 |
| 3 | 참고자료 표의 제공처가 두 줄로 접힘 | 열 폭 확대, `www.` 제거 |
| 4 | 참고자료 표의 마지막 한 행만 다음 쪽으로 넘어감 | 표 행간을 1.35 → 1.22 로 줄여 5쪽으로 정리 |
| 4 | 표 2의 줄무늬 그룹에서 묶음 라벨(`데이터`·`지원`)이 사라짐 | colortbl 의 `\rowcolor` 가 `\multirow` 글자를 덧칠하는 문제. 마지막 행에 음수 span(`\multirow{-5}`)으로 배치 |
| 4 | DOCX 표의 열 폭이 무시되고 절 제목이 쪽 끝에 홀로 남음 | `w:tblLayout=fixed` + `w:tblGrid` 직접 지정, 제목에 `keep_with_next`, 표 머리행 반복 |
| 5 | DOCX 하이퍼링크 94개가 전부 빈 요소였음. 글자는 파란 밑줄로 보이지만 실제로는 링크가 아님 | 원인은 python-docx 의 `Paragraph.runs` 가 접근할 때마다 새 래퍼를 만들어, 표시해 둔 run 을 되찾지 못한 것. run 요소 자체를 들고 있다가 `w:hyperlink` 로 감싸도록 수정하고 같은 실수를 막는 검사를 추가 |
| 5 | `--screenshot` 으로 실제 컴파일해 보니 3번 슬라이드 흐름도가 좁아져 글이 상자 밖으로 넘침 | 도식과 화면을 나란히 두는 배치를 버리고, 화면이 들어오면 화면이 그 자리를 쓰도록 변경. PPTX 쪽 화면 가운데 정렬도 TeX 과 맞춤 |

| 6 | 감독자 검수: `section.table` 7개가 PDF/DOCX 양쪽에서 통째로 빠짐(셀 대조 누락 194건) | JSON `section.table` 을 그대로 싣는 일반 렌더러를 넣고 4장은 POLICY_BASIS 유의사항 열을 덧붙여 통합. 누락 0 |
| 6 | 4쪽 이후 본문·표 글자가 주색으로 이어지는 색상 누출(5쪽 본문 1007자 오염) | 셀 앞머리의 `{\color{}...}` 가 p-열에서 그룹을 벗어나는 문제. 본문·표·머리글의 모든 인라인 색을 `\textcolor{}{}` 로 교체. 전 쪽 본문색이 gray-90 지배로 복귀 |
| 6 | 마지막 쪽에 참고자료 표의 `E4` 한 행만 남는 고립행 | 글자 축소 없이 §11 두 표를 쪽을 쪼개지 않는 `tabularx` 로 전환. 7쪽 → 6쪽, 빈 쪽 없음 |
| 6 | 덱 1·4장이 큰 빈 회색 상자에 짧은 문장뿐 | 1장은 번호 붙은 가로 줄, 4장은 기관 답변 → 유지·재선택·인계 분기 구조로 재구성 |
| 6 | 제품명 `말결` 이 본문 머리에 없고 하단 출처에만 있음 | 별도 표지 없이 모든 슬라이드 공통 상단에 제품 표기를 넣음 |
| 6 | 3·4장에 실제 화면 미반영 | 실제 캡처에서 필요한 영역만 잘라 읽히는 크기로 삽입. 전체 화면 축소·placeholder 없음 |
| 6 | 4장 갈래 글이 상자를 넘고 캡처 위에 이전 카드 조각이 걸림 | 사례를 한 줄 머리로 줄여 세로 여유 확보, 갈래 글자 8.2pt, 캡처 상단 경계 재조정 |

PPTX 는 LibreOffice 변환본을 따로 렌더해 6장·잘림 없음·Pretendard 임베드를
확인했다. DOCX 변환본(7쪽)도 같은 방식으로 표·머리말·꼬리말·링크를 확인했다.
검수용 이미지는 `/mnt/data/work/malgyeol-reference/submission/render/` 에 있다.

재생성 후에도 머리말·꼬리말·출처 표기는 같다. 마지막으로 산출물을 모두 지우고
`build.py all` 로 처음부터 다시 만들어 위 검사를 통과시켰다.

### 6.3 `deck-content.json` 의 검증 기록

입력이 `renderOnSlides: false` 로 지정해 슬라이드에 넣지 않은 내용이다.
근거 문서는 `dev/active/malgyeol-product-completion/context.md`, 확인 지점은
"섹션 4 중간 통합검증". 아래 값은 현재 입력 기준이며, 원문 JSON 이 갱신되면 같은 명령으로
문서·덱이 함께 다시 만들어진다.

- 확인됨: Node 198개 검사·타입 검사·의존성 검사 통과 기록, 설치 SDK 기반 Python 23개 검사 통과 기록, 실제 Node HTTP·SQLite와 Python 음성도구의 결합 검증 기록, 식사 경로 유지·생필품 재선택·시민 회신 기록의 로컬 통합 확인.
- 미확인(남음): A/B 전화 자원 연결 및 실제 전화망 왕복, 실제 양방향 오디오·사람 청취 검증, 발표 화면 캡처의 최종 상태 대조.
- 주장 경계: 슬라이드 3·4는 제품 처리구조와 사례 설명. 실제 공공기관 참여·지원 승인·물품 제공·실전화 왕복 성공의 성과 주장 제외. 역할극 결과와 공공기관 실적의 구분.

문서 본문의 검사 건수(Node 198건·Python 23건)는 현재 입력 기준이다. 실제 전화망
왕복은 `운영 전 수용검사 계획` 으로 적었고 완료 실적으로 쓰지 않았다.

## 7. 남은 것

- 프런트엔드 화면이 완성되면 `build.py all --screenshot <경로>` 로 3번 슬라이드에
  실제 화면을 넣는다. 그 전까지 흐름도가 전체 폭을 쓰며 빈 자리는 없다.
- 표 1의 근거가 되는 사업 안내는 운영조건이 바뀌는 동적 문서다. 제출 직전
  F1~F5·S2~S4 원문을 한 번 더 대조하는 것이 안전하다.
