# 정책 제안서 및 발표 덱 제작 계약

## 책임 및 입력

Claude가 시각 디자인과 실제 산출물 생성을 전담. Codex가 확정한 내용 입력 artifacts/hackathon/policy-content.json, deck-content.json 및 docs/AI_FOR_GOOD_SUBMISSION.md, POLICY_BASIS.md를 읽고 사용. 독립 병렬작업 중이므로 public/·src/·다른 에이전트 파일 수정금지. 소유 artifacts/hackathon/의 생성스크립트·TeX·DOCX·PPTX·PDF와 검수자료. 두 content.json은 읽기전용.

## 필수 산출물

- malgyeol-policy-proposal.tex, malgyeol-policy-proposal.pdf, malgyeol-policy-proposal.docx.
- malgyeol-3min-deck.tex, malgyeol-3min-deck.pdf, malgyeol-3min-deck.pptx.
- 재생성 가능한 Python generator와 README.md 제작근거·명령·서체·원본·검증.
- 본편6장 180초(25/25/45/35/30/20). 별도표지나부록슬라이드 추가금지. 발표대본/내레이션/발표자노트 금지.
- LaTeX는 실제 xelatex로 컴파일한 PDF, PDF를 다른 파일로 갈아끼우기 금지. PPTX는 편집가능한 텍스트·도형·표, 통째페이지이미지 금지. DOCX도 편집가능 문단·표.

## 디자인 근거

- 디자인 시스템 KRDS 엄격 적용. pack /mnt/data/work/malgyeol-reference/packs/krds-design-system의 BRAND/token/components 실제읽기. upstream 공식 commit d6bb184c823e4757f05807ea4646a23e3133b6e6.
- KRDS MCP 실제 도구호출로 typography·component·accessibility조회. 값상충시공식저장소토큰우선. 호출/적용 기록.
- 지정 참고PDF /mnt/data/work/malgyeol-reference/모두의창업_발표덱.pdf 실제열람. 보기편한 landscape-01~18.png 같은폴더. 전체구조/도표/여백/밀도 참고하되 옛사업내용·브라우저인쇄헤더 복사금지.
- KRDS색상/타이포/간격/정보위계의 슬라이드·문서적용을 기록. 정부마크/공식정부사이트주장/존재하지않는KRDS PPT인증 금지.
- 공식PretendardGOV 폰트 WOFF를 필요시fonttools로 TTF변환, 권리출처기록. 확인없이 다른폰트로대체금지.
- 사용자공공기관형 명사구 제목·소제목과 보수적간결체 우선. 모든자료한국어. 이미제공콘텐츠줄이는경우 핵심근거/4사업/업무조율/시민회신/4정책요청 유지.

## 내용 및 근거

정책내용11장·정책근거대응표·참고자료를 누락없이 수록. 표가페이지밖넘치지않도록분할, 단독제목페이지금지. 본문가까운출처를 짧은기관명/번호+하이퍼링크로읽기좋게표현. 긴URL은 본문폭 파괴하지않도록 처리.
덱은6장핵심내용+출처. 실제화면은 frontend진행중이므로 현재없으면 화면완성후 동일생성기로 삽입가능한 선택적 screenshot 인자 제공, 빈placeholder그림노출금지. 현재가능한 처리흐름도는 실제구조에근거. 완료하지않은통화를 성공실적으로 주장금지. 제품설명에 미검증/목업/시연용 배지금지.

## 제작 및 검수

xelatex·kotex·beamer·fontspec·LibreOffice·python-pptx·python-docx·PyMuPDF 설치됨. 도구먼저확인. 편집원본과TeX PDF 내용일치검사. 실제 PDF 전페이지 렌더→이미지열람→잘림/겹침/한글폰트/표/출처/페이지흐름수정 최소3회. PPTX도 LibreOffice로 별도임시PDF 변환해6장/잘림 확인 (최종PDF는TeX산출물 유지). 이미지 기반 검수 반드시 수행. 재생성후헤더/푸터/출처 일치.
중간 aux/log/render는 /mnt/data/work/malgyeol-reference/submission/에 두고 repo에대량파일추가금지. 완성원본/최종PDF/생성기/필요폰트만artifacts/hackathon/보존. secret/개인전화번호/원음출력금지. 외부전송·commit·push금지. 게이트승인질문없이완성까지진행.
