#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""말결 정책 제안서 · 3분 발표 덱 생성기.

입력(읽기 전용): policy-content.json, deck-content.json
출력: malgyeol-policy-proposal.{tex,pdf,docx}, malgyeol-3min-deck.{tex,pdf,pptx}

디자인 근거: KRDS 공식 저장소 커밋 d6bb184c823e4757f05807ea4646a23e3133b6e6 의
resources/css/token/krds_tokens.css 원값과 resources/fonts 의 Pretendard GOV.
상세는 같은 디렉토리 README.md 참조.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
# 중간 산출물(aux·log·렌더) 자리. 이 기기의 작업 경로가 없으면 저장소 안 .build 로
# 떨어져, clone 뒤 저장소 자료만으로 빌드된다(입력은 모두 assets/ 안에 있다).
_WORK_DEFAULT = Path("/mnt/data/work/malgyeol-reference/submission")
WORK = _WORK_DEFAULT if _WORK_DEFAULT.parent.is_dir() else Path(__file__).resolve().parent / ".build"
# KRDS 공식 pack(커밋 d6bb184) 위치. 토큰·글꼴은 이미 이 디렉토리로 옮겨 왔으므로
# 빌드에는 쓰이지 않는다. 출처 확인용 참고 경로다.
PACK_REFERENCE = "/mnt/data/work/malgyeol-reference/packs/krds-design-system"
FONT_DIR = HERE / "fonts"

# ---------------------------------------------------------------------------
# 1. KRDS 토큰 (krds_tokens.css 원값. 근사·재조색 없음)
# ---------------------------------------------------------------------------
KRDS = {
    "primary-5": "ecf2fe", "primary-10": "d8e5fd", "primary-20": "b1cefb",
    "primary-30": "86aff9", "primary-40": "4c87f6", "primary-50": "256ef4",
    "primary-60": "0b50d0", "primary-70": "083891", "primary-80": "052561",
    "secondary-5": "eef2f7", "secondary-10": "d6e0eb", "secondary-70": "063a74",
    "gray-0": "ffffff", "gray-5": "f4f5f6", "gray-10": "e6e8ea",
    "gray-20": "cdd1d5", "gray-30": "b1b8be", "gray-40": "8a949e",
    "gray-50": "6d7882", "gray-60": "58616a", "gray-70": "464c53",
    "gray-80": "33363d", "gray-90": "1e2124", "gray-95": "131416",
    "graphic-10": "e5ecf9", "graphic-70": "39506c",
    "success-60": "267337", "warning-60": "8a5c00", "danger-60": "bd2c0f",
}
# krds-number-* 간격 스케일 (rem). 1rem = 10px 기준의 KRDS PC 토큰.
NUMBER = {5: 0.8, 6: 1.0, 7: 1.2, 8: 1.6, 9: 2.0, 10: 2.4, 11: 2.8,
          12: 3.2, 13: 3.6, 14: 4.0, 16: 4.8, 17: 5.6, 18: 6.4, 20: 8.0}
# --krds-pc-font-size-* (rem)
PC_FONT = {"display-small": 3.6, "heading-xlarge": 4.0, "heading-large": 3.2,
           "heading-medium": 2.4, "heading-small": 1.9, "heading-xsmall": 1.7,
           "heading-xxsmall": 1.5, "body-large": 1.9, "body-medium": 1.7,
           "body-small": 1.5, "body-xsmall": 1.3, "label-small": 1.5,
           "label-xsmall": 1.3}

FALLBACK_CODEPOINTS = {"ㆍ"}  # ㆍ: KRDS subset 미포함. 공식 법령명 원문 보존용.

# ---------------------------------------------------------------------------
# 2. 콘텐츠 적재
# ---------------------------------------------------------------------------
def load(name: str) -> dict:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def font_cmap() -> set[int]:
    from fontTools.ttLib import TTFont
    return set(TTFont(FONT_DIR / "PretendardGOV-Regular.ttf").getBestCmap().keys())


_CMAP: set[int] | None = None


def check_coverage(text: str, where: str) -> str:
    """출력에 도달하는 모든 문자열의 글리프 포함 여부를 강제 검사."""
    global _CMAP
    if _CMAP is None:
        _CMAP = font_cmap()
    bad = sorted({c for c in text
                  if ord(c) > 0x20 and ord(c) not in _CMAP and c not in FALLBACK_CODEPOINTS})
    if bad:
        raise SystemExit(f"[글리프 누락] {where}: {''.join(bad)} — {text[:60]!r}")
    return text


def enc_url(url: str) -> str:
    """하이퍼링크 대상만 퍼센트 인코딩. 화면 표시 문자열은 그대로 둔다."""
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(parts.path, safe="/%:@")
    query = urllib.parse.quote(parts.query, safe="=&%")
    frag = urllib.parse.quote(parts.fragment, safe="%")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, query, frag))


def domain(url: str) -> str:
    return urllib.parse.urlsplit(url).netloc


# ---------------------------------------------------------------------------
# 3. LaTeX 이스케이프
# ---------------------------------------------------------------------------
_TEX_MAP = {"\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "$": r"\$",
            "&": r"\&", "#": r"\#", "%": r"\%", "_": r"\_", "^": r"\textasciicircum{}",
            "~": r"\textasciitilde{}"}


def tex(text: str, where: str = "?") -> str:
    check_coverage(text, where)
    out = "".join(_TEX_MAP.get(c, c) for c in text)
    for cp in FALLBACK_CODEPOINTS:
        out = out.replace(cp, "{\\krdsfallback " + cp + "}")
    return out


_URL_SPECIAL = {"%": r"\%", "#": r"\#", "&": r"\&", "_": r"\_",
                "~": r"\~", "{": r"\{", "}": r"\}", "$": r"\$"}


def tex_url(url: str) -> str:
    """href 대상용. 퍼센트 인코딩 뒤 남은 TeX 특수문자만 보호한다."""
    return "".join(_URL_SPECIAL.get(c, c) for c in enc_url(url))


def href(url: str, label: str, where: str = "href") -> str:
    return "\\href{%s}{%s}" % (tex_url(url), tex(label, where))


# ---------------------------------------------------------------------------
# 4. 파생 콘텐츠
# ---------------------------------------------------------------------------
# 4-1. 정책 제안서 4장 "아래 이용경로와 기관별 안내"가 가리키는 표.
#      출처: POLICY_BASIS.md 4.1~4.4 (2026-09-18 확인본)를 요약 없이 축약 인용.
COOP_KEYS = ["필요성", "주체", "협력", "제품 반영", "측정"]


def parse_cooperation(paragraphs: list[str]) -> list[tuple[str, list[tuple[str, str]]]]:
    """7장 문단의 '구분: 항목—내용' 구조를 표로 분해한다. 문구를 새로 만들지 않는다."""
    rows = []
    pat = re.compile(r"(?=(?:%s)—)" % "|".join(re.escape(k) for k in COOP_KEYS))
    for para in paragraphs:
        if ":" not in para or "—" not in para:
            continue
        head, rest = para.split(":", 1)
        parts = [p.strip() for p in pat.split(rest.strip()) if p.strip()]
        items = []
        for p in parts:
            key, _, val = p.partition("—")
            key = key.strip()
            if key not in COOP_KEYS:
                raise SystemExit(f"[7장 파싱 실패] 알 수 없는 항목: {key!r}")
            items.append((key, val.strip().rstrip(".")))
        if [k for k, _ in items] != COOP_KEYS:
            raise SystemExit(f"[7장 파싱 실패] 항목 구성 불일치: {[k for k, _ in items]}")
        rows.append((head.strip(), items))
    return rows


def ref_index(policy: dict) -> dict[str, dict]:
    return {r["id"]: r for r in policy["references"]}


_MARK = re.compile(r"\[([A-Z]\d)\]")


def para_tex(text: str, refs: dict[str, dict], where: str) -> str:
    """문단 안의 [S1] 표식을 본문 가까운 하이퍼링크로 바꾼다."""
    out, last = [], 0
    for m in _MARK.finditer(text):
        out.append(tex(text[last:m.start()], where))
        rid = m.group(1)
        if rid in refs:
            out.append("\\refmark{%s}" % href(refs[rid]["url"], f"[{rid}]", where))
        else:
            out.append(tex(m.group(0), where))
        last = m.end()
    out.append(tex(text[last:], where))
    return "".join(out)


def source_line(ids: list[str], refs: dict[str, dict], where: str) -> str:
    if not ids:
        return ""
    links = [href(refs[i]["url"], i, where) for i in ids if i in refs]
    return "\\sourceline{근거: %s}" % " · ".join(links)


def deck_source_labels(slide: dict, deck_refs: list[dict]) -> list[tuple[str, str]]:
    """슬라이드 출처 URL을 덱 참고자료의 짧은 자료명으로 되돌린다. 중복 제거."""
    base = {r["url"].split("#")[0]: r for r in deck_refs}
    seen, out = set(), []
    for url in slide.get("sources", []):
        b = url.split("#")[0]
        r = base.get(b)
        if r is None:
            r = next((v for k, v in base.items() if b.startswith(k) or k.startswith(b)), None)
        if r is None:
            raise SystemExit(f"[덱 출처 매칭 실패] {url}")
        if r["title"] in seen:
            continue
        seen.add(r["title"])
        out.append((r["title"], r["url"]))
    return out


# ---------------------------------------------------------------------------
# 5. 정책 제안서 (LaTeX)
# ---------------------------------------------------------------------------
def color_defs() -> str:
    return "\n".join("\\definecolor{krds%s}{HTML}{%s}" % (k.replace("-", ""), v.upper())
                     for k, v in KRDS.items())


def font_block() -> str:
    p = str(FONT_DIR).replace("\\", "/")
    return r"""
\setmainfont{PretendardGOV-}[
  Path=%s/, Extension=.ttf,
  UprightFont=*Regular, BoldFont=*Bold, ItalicFont=*Regular, BoldItalicFont=*Bold]
\setmainhangulfont{PretendardGOV-}[
  Path=%s/, Extension=.ttf,
  UprightFont=*Regular, BoldFont=*Bold, ItalicFont=*Regular, BoldItalicFont=*Bold]
\setsansfont{PretendardGOV-}[
  Path=%s/, Extension=.ttf, UprightFont=*Regular, BoldFont=*Bold]
\setsanshangulfont{PretendardGOV-}[
  Path=%s/, Extension=.ttf, UprightFont=*Regular, BoldFont=*Bold]
\newhangulfontfamily\krdsfallback{Noto Sans CJK KR}
""" % (p, p, p, p)


POLICY_PREAMBLE = r"""%% 자동 생성. 편집하지 말 것. 생성기: build.py
\documentclass[10pt,a4paper]{article}
\usepackage{kotex}
\usepackage{fontspec}
\usepackage[a4paper,left=19mm,right=19mm,top=20mm,bottom=20mm,headsep=6mm,footskip=10mm]{geometry}
\usepackage{xcolor}
\usepackage{fancyhdr}
\setlength{\headheight}{16pt}
\usepackage{lastpage}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{array}
\usepackage{multirow}
\usepackage{booktabs}
\usepackage{colortbl}
\usepackage{xltabular}
\usepackage{needspace}
\usepackage{ragged2e}
\usepackage[unicode,hidelinks,pdfusetitle]{hyperref}
\usepackage{xurl}
__COLORS__
__FONTS__
%% KRDS PC 토큰(px)을 인쇄 pt로 환산: 1px = 0.75pt
\newcommand{\krdsbody}{\fontsize{11.25pt}{18pt}\selectfont}      %% body-small 1.5rem, 행간 1.6
\newcommand{\krdssmall}{\fontsize{9.75pt}{15.6pt}\selectfont}    %% body-xsmall 1.3rem
\newcommand{\krdslead}{\fontsize{12.75pt}{20.4pt}\selectfont}    %% body-medium 1.7rem
\newcommand{\krdshone}{\fontsize{24pt}{28.8pt}\selectfont}         %% heading-large 3.2rem
\newcommand{\krdshtwo}{\fontsize{14.25pt}{19.95pt}\selectfont}     %% heading-small 1.9rem
\newcommand{\krdshthree}{\fontsize{12.75pt}{17.85pt}\selectfont}     %% heading-xsmall 1.7rem
\krdsbody
\setlength{\parindent}{0pt}
\setlength{\parskip}{6pt}                                        %% krds-number-4 0.6rem
\linespread{1.0}
\color{krdsgray90}
\hypersetup{colorlinks=true, linkcolor=krdsprimary60, urlcolor=krdsprimary60,
  citecolor=krdsprimary60, pdfborder={0 0 0}}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0.4pt}
\renewcommand{\footrulewidth}{0pt}
\renewcommand{\headrule}{\color{krdsgray20}\hrule height 0.4pt}
\fancyhead[L]{\krdssmall\color{krdsgray60}__HEADL__}
\fancyhead[R]{\krdssmall\color{krdsgray60}__HEADR__}
\fancyfoot[C]{\krdssmall\color{krdsgray50}\thepage\ /\ \pageref{LastPage}}
\titleformat{\section}{\krdshtwo\bfseries\color{krdsgray90}}{}{0pt}{}
\titlespacing*{\section}{0pt}{24pt}{6pt}
\titleformat{\subsection}{\krdshthree\bfseries\color{krdssecondary70}}{}{0pt}{}
\titlespacing*{\subsection}{0pt}{16pt}{4pt}
\setlist[itemize]{leftmargin=12pt,itemsep=3pt,topsep=3pt,parsep=0pt,label=\textcolor{krdsprimary50}{\textbf{-}}}
\newcommand{\refmark}[1]{\,\raisebox{0.45ex}{\fontsize{7pt}{7pt}\selectfont #1}}
\newcommand{\sourceline}[1]{\par\vspace{2pt}{\krdssmall\textcolor{krdsgray60}{#1}}\par}
%% 셀 앞머리의 \color 는 수직 목록에 whatsit 을 넣어 첫 줄 기준선을 한 줄 밀어낸다.
%% \leavevmode 로 수평 모드를 먼저 열어 모든 셀의 첫 줄을 맞춘다.
\newcommand{\cell}[1]{\krdssmall\leavevmode #1}
\newcommand{\tblcap}[1]{\par\vspace{10pt}{\krdssmall\bfseries\textcolor{krdsgray70}{#1}}\par\vspace{3pt}}
\newcolumntype{H}{>{\krdssmall\bfseries\color{krdsgray0}\raggedright\arraybackslash}}
\newcolumntype{L}[1]{>{\krdssmall\raggedright\arraybackslash}p{#1}}
\newcolumntype{Y}{>{\krdssmall\RaggedRight\arraybackslash}X}
\newcommand{\thead}[1]{\cellcolor{krdssecondary70}\textcolor{krdsgray0}{\krdssmall\bfseries #1}}
\renewcommand{\arraystretch}{1.22}
\setlength{\tabcolsep}{5pt}
\arrayrulecolor{krdsgray20}
\begin{document}
"""


def policy_tex(policy: dict) -> str:
    refs = ref_index(policy)
    W = "정책"
    head_l = policy["title"]
    head_r = policy["subtitle"]
    pre = (POLICY_PREAMBLE
           .replace("__COLORS__", color_defs())
           .replace("__FONTS__", font_block())
           .replace("__HEADL__", tex(head_l, W))
           .replace("__HEADR__", tex(head_r, W)))
    b: list[str] = [pre]

    # 표제부 (별도 표지 없이 1쪽 본문과 같은 지면)
    b.append(r"\thispagestyle{fancy}")
    b.append("{\\krdssmall\\bfseries\\textcolor{krdsprimary60}{%s}}\\par\\vspace{4pt}"
             % tex("정책 제안서", W))
    b.append("{\\krdshone\\bfseries\\color{krdsgray90} %s}\\par\\vspace{6pt}" % tex(head_l, W))
    b.append("{\\krdslead\\textcolor{krdsgray70}{%s}}\\par\\vspace{4pt}" % tex(head_r, W))
    b.append("{\\krdssmall\\textcolor{krdsgray50}{%s}}\\par\\vspace{2pt}"
             % tex("작성일 %s · 근거 확인일 %s" % (policy["date"], policy["date"]), W))
    b.append(r"\vspace{4pt}{\color{krdsprimary50}\hrule height 2pt}\vspace{10pt}")

    tnum = 0
    for idx, sec in enumerate(policy["sections"], 1):
        b.append("\\section*{%s}" % tex(sec["title"], W))
        b.append("\\phantomsection\\addcontentsline{toc}{section}{%s}" % tex(sec["title"], W))
        for p in sec["paragraphs"]:
            b.append(para_tex(p, refs, W) + r"\par")
        if sec.get("table"):
            tnum += 1
            b.append(json_table(sec, idx, tnum, refs))
        if idx == 7:
            tnum += 1
            b.append(cooperation_table(sec["paragraphs"], tnum))
        if idx == 11:
            tnum += 1
            b.append(basis_table(policy, tnum))
            tnum += 1
            b.append(reference_table(policy, tnum))
        sl = source_line(sec.get("sources", []), refs, W)
        if sl:
            b.append(sl)
    b.append(r"\end{document}")
    return "\n".join(b) + "\n"


# JSON section.table 의 1열 고정 폭(mm). 나머지 열은 남는 폭을 나눠 쓴다.
FIRST_COL = {2: 34.0, 3: 20.0, 4: 26.0, 5: 32.0, 6: 28.0, 8: 22.0, 9: 36.0}
# 4장 표에 덧붙이는 열. POLICY_BASIS.md 4.1~4.4 의 기관별 유의사항을 같은 순서로 둔다.
# 같은 정보를 표 하나로 합치되 개별 셀 내용은 그대로 보존한다.
SECTION4_NOTES = [
    "이용시간·품목 수량이 기관마다 다름. 접수창구·제공장소·물류시설·기부 문의를 구분",
    "세 운영형태는 같은 사업의 운영정보. 배달활동을 모든 시민의 개별 가정 배송으로 확대하지 않음",
    "재방문은 이용이력 확인·기본 상담, 후속 방문은 행정복지센터 상담기록서와 사업장 연결",
    "기준 중위소득 100% 이하 비용 지원 안내. 선정·무료 제공 확정은 기관의 공식 판단",
]
SECTION4_EXTRA_HEADER = "기관별 안내 유의사항"


def json_table(sec: dict, idx: int, num: int, refs: dict) -> str:
    """policy-content.json 의 section.table 을 그대로 수록한다.
    헤더·셀을 임의로 줄이거나 합치지 않는다."""
    t = sec["table"]
    W = f"정책{idx}표"
    headers = list(t["headers"])
    rows = [list(r) for r in t["rows"]]
    if idx == 4:
        headers.append(SECTION4_EXTRA_HEADER)
        for r, note in zip(rows, SECTION4_NOTES):
            r.append(note)
    first = FIRST_COL.get(idx, 26.0)
    cols = "L{%.0fmm}" % first + "Y" * (len(headers) - 1)
    body = [[para_tex(c, refs, W) for c in r] for r in rows]
    for r in body:
        r[0] = "\\textcolor{krdssecondary70}{\\bfseries %s}" % r[0]
    return _xltab(cols, headers, body, "표 %d. %s" % (num, sec["title"].split(". ", 1)[-1]))


def _xltab(cols: str, header: list[str], rows: list[list[str]], caption: str,
           nobreak: bool = False) -> str:
    """nobreak=True 면 쪽을 넘기지 않는 tabularx 로 짠다. 한 쪽에 들어가는 표가
    마지막 한 행만 다음 쪽에 남는 고립행을 막는다. 글자 크기는 줄이지 않는다."""
    n = len(header)
    head = " & ".join("\\thead{%s}" % h for h in header) + r" \\"
    if nobreak:
        out = [r"\par\needspace{\baselineskip}",
               r"\tblcap{%s}" % caption,
               r"\begin{tabularx}{\textwidth}{%s}" % cols,
               r"\hline", head, r"\hline"]
    else:
        out = [r"\tblcap{%s}" % caption,
               r"\begin{xltabular}{\textwidth}{%s}" % cols,
               r"\hline", head, r"\hline", r"\endfirsthead",
               r"\hline", head, r"\hline", r"\endhead",
               r"\hline", r"\endfoot", r"\hline", r"\endlastfoot"]
    for i, r in enumerate(rows):
        if len(r) != n:
            raise SystemExit(f"[표 열 불일치] {caption}: {len(r)} != {n}")
        if i % 2 == 1:
            out.append(r"\rowcolor{krdsgray5}")
        out.append(" & ".join("\\cell{%s}" % c for c in r) + r" \\")
    out.append(r"\hline" if nobreak else "")
    out.append(r"\end{tabularx}" if nobreak else r"\end{xltabular}")
    return "\n".join(x for x in out if x)


def cooperation_table(paragraphs: list[str], num: int) -> str:
    W = "정책7표"
    rows = []
    for group, items in parse_cooperation(paragraphs):
        for j, (key, val) in enumerate(items):
            # colortbl 의 \rowcolor 는 뒤에 오는 행을 덧칠해 위에서 시작한 \multirow
            # 글자를 덮는다. 마지막 행에 음수 span 으로 놓는 것이 정석 해법이다.
            first = ("\\multirow{-5}{=}{\\krdssmall\\bfseries"
                     "\\textcolor{krdssecondary70}{%s}}" % tex(group, W)) if j == 4 else ""
            rows.append([first, "{\\bfseries %s}" % tex(key, W), tex(val, W)])
    n = len(rows)
    head = ["협력 요청", "항목", "내용"]
    out = [r"\tblcap{표 %d. 정책 협력 요청별 세부 항목}" % num,
           r"\begin{xltabular}{\textwidth}{L{22mm}L{20mm}Y}",
           r"\hline", " & ".join("\\thead{%s}" % h for h in head) + r" \\",
           r"\hline", r"\endfirsthead",
           r"\hline", " & ".join("\\thead{%s}" % h for h in head) + r" \\",
           r"\hline", r"\endhead", r"\hline", r"\endfoot", r"\hline", r"\endlastfoot"]
    for i, r in enumerate(rows):
        if i and i % 5 == 0:
            out.append(r"\hline")
        if (i // 5) % 2 == 1:
            out.append(r"\rowcolor{krdsgray5}")
        out.append(" & ".join("\\cell{%s}" % c for c in r) + r" \\")
    out.append(r"\end{xltabular}")
    assert n == 20, n
    return "\n".join(out)


def basis_table(policy: dict, num: int) -> str:
    W = "근거대응표"
    rows = []
    for m in policy["basisMapping"]:
        rows.append([tex(m["basisSection"], W), tex(m["proposalSection"], W),
                     tex(m["application"], W),
                     "{\\krdssmall %s}" % href(m["source"], "P0", W)])
    return _xltab("L{32mm}L{32mm}Y L{12mm}",
                  ["정책 근거 절", "본 제안서 절", "적용 내용", "출처"], rows,
                  "표 %d. 정책 근거 대응" % num, nobreak=True)


def reference_table(policy: dict, num: int) -> str:
    W = "참고자료표"
    rows = []
    for r in policy["references"]:
        rows.append(["\\textcolor{krdssecondary70}{\\bfseries %s}" % tex(r["id"], W),
                     href(r["url"], r["title"], W),
                     "{\\krdssmall\\textcolor{krdsgray50}{%s}}"
                     % tex(domain(r["url"]).removeprefix("www."), W)])
    return _xltab("L{10mm}Y L{40mm}",
                  ["번호", "자료명 (누르면 원문으로 연결)", "제공처"], rows,
                  "표 %d. 참고자료 목록" % num, nobreak=True)


# ---------------------------------------------------------------------------
# 6. 발표 덱 (mm 단위 160x90 캔버스. beamer와 pptx가 같은 수치를 쓴다)
# ---------------------------------------------------------------------------
CW, CH = 160.0, 90.0          # beamer aspectratio=169 본문 캔버스
MARGIN = 12.0
GAP = 6.0
Y_MARK = 85.0                 # 공통 상단 제품 표기(말결). 별도 표지 슬라이드는 없다.
Y_EYEBROW = 78.4
Y_HEAD = 72.6
Y_CONTENT_TOP = 62.0
Y_CONTENT_BOT = 17.0
Y_RULE = 13.4
Y_FOOT = 10.8
PAD = 4.2
ACCENT = 1.2                  # 카드 왼쪽 강조 막대 폭
FS = {"mark": 7.6, "marksub": 6.4, "eyebrow": 7.6, "head": 19.0,
      "lead": 7.4, "cardlabel": 10.0, "cardbody": 9.0, "big": 10.5,
      "num": 11.0, "step": 7.2, "tag": 7.0, "branch": 8.2,
      "foot": 5.6, "shotcap": 5.4}
PPTX_SCALE = 13.3333333 / (CW / 25.4)

# 실제 화면 캡처. 저장소 안에 두어 clone 뒤 이 디렉토리 자료만으로 빌드된다.
SHOT_DIR = HERE / "assets"
DEFAULT_SHOT = SHOT_DIR / "frontend-request-partial.png"
CROP_DIR = SHOT_DIR / "crops"
# 원본(1440x3534) 안에서 슬라이드에 실을 영역. 전체 화면을 줄이지 않고 필요한 부분만
# 잘라 슬라이드에서 글씨가 읽히는 크기로 넣는다. (left, top, right, bottom) 픽셀.
SHOT_CROPS = {
    3: (505, 1042, 990, 1244),    # 기관 문의 카드: 기관명·문의 목적·문의한 내용 3건
    4: (95, 828, 458, 1004),      # 성동구 상태 카드: 복수 필요 요청의 진행 상태 배지
}
SHOT_CAPTION = {
    3: "실제 담당자 화면 · 기관 문의 항목",
    4: "실제 담당자 화면 · 필요별 진행 상태",
}


def est_w(text: str, fs: float) -> float:
    """문자열의 대략 폭(mm). 줄바꿈 보호와 카드 높이 계산에 쓴다."""
    em = fs * 0.3528
    w = 0.0
    for c in text:
        o = ord(c)
        if c == " ":
            w += em * 0.30
        elif 0xAC00 <= o <= 0xD7A3 or 0x3130 <= o <= 0x318F or o > 0x4DFF:
            w += em
        elif c in "·.,()[]/-—~":
            w += em * 0.42
        else:
            w += em * 0.56
    return w


def est_lines(text: str, width_mm: float, fs: float) -> int:
    return max(1, math.ceil(est_w(text, fs) / max(width_mm, 1.0) - 1e-6))


def line_mm(fs: float) -> float:
    return fs * 1.45 * 0.3528


def tex_nb(text: str, width_mm: float, fs: float, where: str) -> str:
    """어절 단위로 줄을 바꾼다. 한글은 기본적으로 글자 단위로 끊겨
    '연속 처리'의 '리', '시민 회신'의 '신' 처럼 한 글자만 다음 줄로 남는다.
    줄 폭에 들어가는 어절만 \\mbox 로 묶어 그 현상을 막고,
    폭보다 긴 어절은 묶지 않아 overfull 을 만들지 않는다."""
    out = []
    for i, tok in enumerate(text.split(" ")):
        if not tok:
            continue
        if i:
            out.append(" ")
        t = tex(tok, where)
        out.append("\\mbox{%s}" % t if est_w(tok, fs) <= width_mm * 0.98 else t)
    return "".join(out)


DECK_PREAMBLE = r"""%% 자동 생성. 편집하지 말 것. 생성기: build.py
\PassOptionsToPackage{unicode,hidelinks}{hyperref}
\documentclass[aspectratio=169,10pt]{beamer}
\usepackage{kotex}
\usepackage{fontspec}
\usepackage{graphicx}
\usepackage{tikz}
\usetikzlibrary{positioning,arrows.meta,calc}
\usetheme{default}
\setbeamertemplate{navigation symbols}{}
\setbeamertemplate{footline}{}
\setbeamertemplate{headline}{}
\setbeamercolor{background canvas}{bg=krdsgray0}
__COLORS__
__FONTS__
\hypersetup{colorlinks=true, urlcolor=krdsgray50, pdfborder={0 0 0}}
\setlength{\parindent}{0pt}
\begin{document}
"""


def _node(x, y, w, h, fill, draw=None, radius=1.2):
    opt = "fill=%s, rounded corners=%.1fmm" % (fill, radius)
    if draw:
        opt += ", draw=%s, line width=0.2mm" % draw
    return (r"\path[%s] (%.2f,%.2f) rectangle (%.2f,%.2f);" % (opt, x, y - h, x + w, y))


def _bar(x, y, h, color="krdsprimary50", w=ACCENT):
    """카드 왼쪽 강조 막대. 색만으로 뜻을 나누지 않고 라벨과 함께 쓴다."""
    return r"\path[fill=%s] (%.2f,%.2f) rectangle (%.2f,%.2f);" % (color, x, y - h, x + w, y)


def _text(x, y, w, s, size, color, bold=False, align="left"):
    fam = r"\bfseries" if bold else ""
    return (r"\node[anchor=north west, text width=%.2fmm, align=%s, inner sep=0] "
            r"at (%.2f,%.2f) {\fontsize{%.1f}{%.1f}\selectfont%s\color{%s}%s};"
            % (w, align, x, y, size, size * 1.45, fam, color, s))


def split_bullet(text: str) -> tuple[str | None, str]:
    if ": " in text:
        label, _, body = text.partition(": ")
        if len(label) <= 14:
            return label, body
    return None, text


# 슬라이드 4의 기관 응답별 갈래. 각 글머리에서 실제로 쓰인 낱말만 뽑아 태그로 삼는다.
OUTCOME_TAGS = [("유지", "krdssuccess60"), ("재선택", "krdsprimary60"), ("인계", "krdswarning60")]


# ---------------------------------------------------------------------------
# 6-1. 화면 캡처 잘라내기
# ---------------------------------------------------------------------------
def make_crops(src: Path) -> dict[int, tuple[Path, float]]:
    """원본 캡처에서 슬라이드별 영역을 잘라 저장소 안(assets/crops)에 둔다.
    원본과 잘라낸 자산이 모두 저장소에 있어 clone 뒤 바로 빌드된다."""
    from PIL import Image
    outdir = CROP_DIR
    outdir.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    made = {}
    for n, box in SHOT_CROPS.items():
        if box[2] > im.width or box[3] > im.height:
            raise SystemExit(f"[캡처 영역 초과] 슬라이드 {n}: {box} vs {im.size}")
        crop = im.crop(box)
        out = outdir / f"slide{n}-crop.png"
        crop.save(out)
        made[n] = (out, crop.width / crop.height)
        print(f"  캡처 {n}번: {box} → {crop.width}x{crop.height} ({out.name})")
    return made


# ---------------------------------------------------------------------------
# 6-2. 슬라이드 구성
# ---------------------------------------------------------------------------
def deck_frame(i: int, slide: dict, deck: dict, crops: dict) -> str:
    W = f"덱{i}"
    mark, _, marksub = deck["title"].partition(" | ")
    b = [r"\begin{frame}[plain]",
         r"\begin{tikzpicture}[x=1mm,y=1mm,remember picture,overlay,"
         r"shift={($(current page.center)+(-%.2fmm,-%.2fmm)$)}]" % (CW / 2, CH / 2)]
    # 공통 상단 제품 표기
    b.append(_text(MARGIN, Y_MARK, 30, tex(mark, W), FS["mark"], "krdsprimary70", bold=True))
    b.append(_text(MARGIN + est_w(mark, FS["mark"]) + 2.0, Y_MARK - 0.35, 70,
                   tex(marksub, W), FS["marksub"], "krdsgray50"))
    b.append(_text(CW - MARGIN - 40, Y_MARK, 40,
                   tex("서울시 정책 협력 및 현장 실증 제안", W), FS["marksub"],
                   "krdsgray40", align="right"))
    b.append(r"\path[fill=krdsgray10] (%.2f,%.2f) rectangle (%.2f,%.2f);"
             % (MARGIN, Y_MARK - 3.2, CW - MARGIN, Y_MARK - 3.0))
    # 슬라이드 번호·제목·헤드라인
    b.append(_text(MARGIN, Y_EYEBROW, CW - 2 * MARGIN,
                   tex("%02d  %s" % (i, slide["title"]), W),
                   FS["eyebrow"], "krdsprimary60", bold=True))
    b.append(_text(MARGIN, Y_HEAD, CW - 2 * MARGIN,
                   tex_nb(slide["headline"], CW - 2 * MARGIN, FS["head"], W),
                   FS["head"], "krdsgray90", bold=True))
    # 본문
    if i == 1:
        b.append(numbered_rows(slide["bullets"], W))
    elif i == 3:
        b.append(slide3_body(slide, crops.get(3), W))
    elif i == 4:
        b.append(slide4_body(slide, crops.get(4), W))
    else:
        b.append(label_cards(slide["bullets"], W))
    # 하단 출처
    b.append(r"\path[fill=krdsgray20] (%.2f,%.2f) rectangle (%.2f,%.2f);"
             % (MARGIN, Y_RULE, CW - MARGIN, Y_RULE + 0.25))
    labels = deck_source_labels(slide, deck["references"])
    txt = "출처  " + "  ·  ".join(href(u, t, W) for t, u in labels)
    b.append(_text(MARGIN, Y_FOOT, CW - 2 * MARGIN - 14, txt, FS["foot"], "krdsgray50"))
    b.append(_text(CW - MARGIN - 12, Y_FOOT, 12, tex("%d / 6" % i, W),
                   FS["foot"], "krdsgray40", align="right"))
    b.append(r"\end{tikzpicture}")
    b.append(r"\end{frame}")
    return "\n".join(b)


def numbered_rows(bullets: list[str], W: str) -> str:
    """1번 슬라이드. 큰 회색 상자에 짧은 문장 하나가 아니라, 번호가 붙은 가로 줄로
    쌓아 반복 업무가 이어지는 모습을 읽히게 한다."""
    n = len(bullets)
    h = (Y_CONTENT_TOP - Y_CONTENT_BOT - GAP * 0.5 * (n - 1)) / n
    numw = 13.0
    out = []
    for i, text in enumerate(bullets):
        y = Y_CONTENT_TOP - i * (h + GAP * 0.5)
        out.append(_node(MARGIN, y, CW - 2 * MARGIN, h, "krdsgray5"))
        out.append(_bar(MARGIN, y, h))
        out.append(_text(MARGIN + ACCENT + 3.0, y - (h - line_mm(FS["num"])) / 2 + 0.4,
                         numw, tex("%02d" % (i + 1), W), FS["num"], "krdsprimary30", bold=True))
        tw = CW - 2 * MARGIN - numw - 8.0
        lines = est_lines(text, tw, FS["big"])
        ty = y - (h - lines * line_mm(FS["big"])) / 2 + 0.2
        out.append(_text(MARGIN + numw + 4.0, ty, tw,
                         tex_nb(text, tw, FS["big"], W), FS["big"], "krdsgray90"))
    return "\n".join(out)


def label_cards(bullets: list[str], W: str) -> str:
    """2·5·6번 슬라이드. 라벨과 본문을 가진 카드를 내용 높이에 맞춰 놓는다."""
    n = len(bullets)
    cols = 2 if n >= 4 else n
    rows = (n + cols - 1) // cols
    w = (CW - 2 * MARGIN - GAP * (cols - 1)) / cols
    tw = w - 2 * PAD - ACCENT
    need = 0.0
    for t in bullets:
        label, body = split_bullet(t)
        hh = 2 * PAD + est_lines(body, tw, FS["cardbody"]) * line_mm(FS["cardbody"])
        if label:
            hh += line_mm(FS["cardlabel"]) + 1.4
        need = max(need, hh)
    avail = (Y_CONTENT_TOP - Y_CONTENT_BOT - GAP * (rows - 1)) / rows
    h = min(avail, max(need, 16.0))
    top = Y_CONTENT_TOP - (Y_CONTENT_TOP - Y_CONTENT_BOT - (h * rows + GAP * (rows - 1))) / 2
    out = []
    for i, text in enumerate(bullets):
        r, c = divmod(i, cols)
        x = MARGIN + c * (w + GAP)
        y = top - r * (h + GAP)
        label, body = split_bullet(text)
        out.append(_node(x, y, w, h, "krdsgray5"))
        out.append(_bar(x, y, h))
        ty = y - PAD
        if label:
            out.append(_text(x + ACCENT + PAD, ty, tw, tex_nb(label, tw, FS["cardlabel"], W),
                             FS["cardlabel"], "krdsprimary70", bold=True))
            ty -= line_mm(FS["cardlabel"]) + 1.4
        out.append(_text(x + ACCENT + PAD, ty, tw, tex_nb(body, tw, FS["cardbody"], W),
                         FS["cardbody"], "krdsgray80"))
    return "\n".join(out)


def rel_asset(path: Path) -> str:
    """TeX 에는 이 디렉토리 기준 상대 경로를 적는다. xelatex 도 같은 디렉토리에서
    돌리므로 저장소를 어디에 clone 하든 그대로 컴파일된다."""
    try:
        return path.resolve().relative_to(HERE).as_posix()
    except ValueError:
        return str(path)


def _shot_block(crop, x, w, ytop, hmax, num, W) -> tuple[str, float]:
    """잘라낸 실제 화면을 넣는다. 그림이 없으면 아무것도 그리지 않는다
    (빈 자리·placeholder 를 만들지 않는다). 반환값은 실제로 쓴 높이."""
    if not crop:
        return "", 0.0
    path, ratio = crop
    cap = line_mm(FS["shotcap"]) + 1.0
    ih = min(hmax - cap - 2.4, w / ratio)
    iw = ih * ratio
    if iw > w:
        iw, ih = w, w / ratio
    bx = x + (w - iw) / 2
    out = [_node(bx - 1.2, ytop, iw + 2.4, ih + 2.4, "krdsgray5"),
           r"\node[anchor=north west, inner sep=0] at (%.2f,%.2f) "
           r"{\includegraphics[width=%.2fmm,height=%.2fmm]{%s}};"
           % (bx, ytop - 1.2, iw, ih, rel_asset(path)),
           _text(x, ytop - ih - 3.6, w, tex(SHOT_CAPTION[num], W),
                 FS["shotcap"], "krdsgray50")]
    return "\n".join(out), ih + 2.4 + cap


def slide3_body(slide: dict, crop, W: str) -> str:
    """3번 슬라이드. 왼쪽은 JSON steps 의 처리 순서, 오른쪽은 실제 담당자 화면."""
    right_w = 62.0
    left_w = CW - 2 * MARGIN - right_w - GAP
    out = []
    # 글머리 세 줄을 헤드라인 아래 요약 줄로 둔다(내용 보존, 자리 절약)
    lead = "  ·  ".join(slide["bullets"])
    lead_h = est_lines(lead, CW - 2 * MARGIN, FS["lead"]) * line_mm(FS["lead"])
    out.append(_text(MARGIN, Y_CONTENT_TOP, CW - 2 * MARGIN,
                     tex_nb(lead, CW - 2 * MARGIN, FS["lead"], W), FS["lead"], "krdsgray70"))
    top = Y_CONTENT_TOP - lead_h - 2.6
    steps = slide["steps"]
    n = len(steps)
    rh = (top - Y_CONTENT_BOT - 1.2 * (n - 1)) / n
    out.append(_node(MARGIN, top, left_w, top - Y_CONTENT_BOT, "krdsgraphic10"))
    for i, st in enumerate(steps):
        y = top - i * (rh + 1.2)
        out.append(_node(MARGIN + 2.0, y - 0.6, left_w - 4.0, rh - 1.2, "krdsgray0",
                         draw="krdsprimary20", radius=1.0))
        out.append(_text(MARGIN + 4.0, y - 0.6 - (rh - 1.2 - line_mm(FS["step"])) / 2,
                         6.0, tex("%d" % (i + 1), W), FS["step"], "krdsprimary50", bold=True))
        tw = left_w - 12.0
        out.append(_text(MARGIN + 9.0, y - 0.6 - (rh - 1.2 - line_mm(FS["step"])) / 2,
                         tw, tex_nb(st, tw, FS["step"], W), FS["step"], "krdsgray80"))
    blk, _ = _shot_block(crop, MARGIN + left_w + GAP, right_w, top,
                         top - Y_CONTENT_BOT, 3, W)
    out.append(blk)
    return "\n".join(out)


def slide4_body(slide: dict, crop, W: str) -> str:
    """4번 슬라이드. 기관 응답 하나가 유지·재선택·인계로 갈리는 구조를 그린다.
    같은 회색 카드 네 개를 복제하지 않는다. 사례는 한 줄 머리로 두어
    갈래 세 줄이 상자 안에서 다 읽히도록 세로 여유를 남긴다."""
    right_w = 56.0
    left_w = CW - 2 * MARGIN - right_w - GAP
    case, outcomes = slide["bullets"][0], slide["bullets"][1:]
    label, body = split_bullet(case)
    out = []
    # 입력: 사례 (한 줄)
    ch = line_mm(FS["cardbody"]) + 3.0
    y = Y_CONTENT_TOP
    out.append(_node(MARGIN, y, left_w, ch, "krdssecondary5"))
    out.append(_bar(MARGIN, y, ch, "krdssecondary70"))
    tx = MARGIN + ACCENT + 3.0
    out.append(_text(tx, y - 1.5, 12.0, tex(label or "사례", W),
                     FS["cardbody"], "krdssecondary70", bold=True))
    tw = left_w - (tx - MARGIN) - 14.0
    out.append(_text(tx + 12.0, y - 1.5, tw, tex_nb(body, tw, FS["cardbody"], W),
                     FS["cardbody"], "krdsgray80"))
    # 분기: 기관 답변 → 세 갈래
    bt = y - ch - 2.0
    out.append(_text(MARGIN, bt, left_w, tex("기관 답변에 따른 갈래", W),
                     FS["tag"], "krdsgray60", bold=True))
    bt -= line_mm(FS["tag"]) + 1.0
    spine = MARGIN + 3.0
    rows_h = (bt - Y_CONTENT_BOT - 1.8 * (len(outcomes) - 1)) / len(outcomes)
    for i, (text, (tag, color)) in enumerate(zip(outcomes, OUTCOME_TAGS)):
        ry = bt - i * (rows_h + 1.8)
        mid = ry - rows_h / 2
        out.append(r"\path[draw=krdsgray30, line width=0.2mm] (%.2f,%.2f) -- (%.2f,%.2f);"
                   % (spine, bt, spine, mid))
        out.append(r"\path[draw=krdsgray30, line width=0.2mm, -{Stealth[length=1.0mm]}] "
                   r"(%.2f,%.2f) -- (%.2f,%.2f);" % (spine, mid, spine + 3.4, mid))
        bx = spine + 4.2
        bw = MARGIN + left_w - bx
        out.append(_node(bx, ry, bw, rows_h, "krdsgray5"))
        out.append(_bar(bx, ry, rows_h, color))
        ttw = bw - ACCENT - 2.6 - 17.0
        lines = est_lines(text, ttw, FS["branch"])
        ty = ry - (rows_h - lines * line_mm(FS["branch"])) / 2 + 0.2
        out.append(_text(bx + ACCENT + 2.6, ty, 16.0, tex(tag, W),
                         FS["branch"], color, bold=True))
        out.append(_text(bx + ACCENT + 19.0, ty, ttw,
                         tex_nb(text, ttw, FS["branch"], W), FS["branch"], "krdsgray80"))
    blk, _ = _shot_block(crop, MARGIN + left_w + GAP, right_w, Y_CONTENT_TOP,
                         Y_CONTENT_TOP - Y_CONTENT_BOT, 4, W)
    out.append(blk)
    return "\n".join(out)


def deck_tex(deck: dict, crops: dict) -> str:
    pre = (DECK_PREAMBLE.replace("__COLORS__", color_defs())
           .replace("__FONTS__", font_block()))
    b = [pre]
    for i, s in enumerate(deck["slides"], 1):
        b.append(deck_frame(i, s, deck, crops))
    b.append(r"\end{document}")
    return "\n".join(b) + "\n"


# ---------------------------------------------------------------------------
# 7. 컴파일
# ---------------------------------------------------------------------------
def xelatex(tex_path: Path, out_pdf: Path, runs: int = 3) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    aux = WORK / "tex"
    aux.mkdir(exist_ok=True)
    for _ in range(runs):
        r = subprocess.run(
            ["xelatex", "-interaction=nonstopmode", "-halt-on-error",
             "-output-directory", str(aux), tex_path.name],
            cwd=str(HERE), capture_output=True, text=True)
        if r.returncode != 0:
            log = (aux / (tex_path.stem + ".log"))
            tail = log.read_text(errors="replace")[-4000:] if log.exists() else r.stdout[-4000:]
            raise SystemExit(f"[xelatex 실패] {tex_path.name}\n{tail}")
    shutil.copy(aux / (tex_path.stem + ".pdf"), out_pdf)
    log = (aux / (tex_path.stem + ".log")).read_text(errors="replace")
    over = [l for l in log.splitlines() if "Overfull \\hbox" in l or "Overfull \\vbox" in l]
    if over:
        print(f"  ! {tex_path.name}: Overfull {len(over)}건")
        for l in over[:12]:
            print("    ", l.strip())
    else:
        print(f"  {tex_path.name}: Overfull 없음")


# ---------------------------------------------------------------------------
# 8. PPTX (편집 가능한 텍스트·도형·표. 페이지 통이미지 없음)
# ---------------------------------------------------------------------------
FALLBACK_FONT = "Noto Sans CJK KR"
BASE_FONT = "Pretendard GOV"


def _rgb(tok: str):
    from pptx.dml.color import RGBColor
    return RGBColor.from_string(KRDS[tok].upper())


def _emu(mm: float):
    from pptx.util import Emu
    return Emu(int(round(mm * PPTX_SCALE * 36000)))


def _y(mm_top: float):
    return _emu(CH - mm_top)


def _pt(size: float):
    from pptx.util import Pt
    return Pt(round(size * PPTX_SCALE, 1))


def _set_run(run, size, color_tok, bold, text):
    """동아시아 글꼴을 함께 지정한다. run.font.name 은 latin 만 바꾼다."""
    import copy
    from pptx.oxml.ns import qn
    run.text = text
    run.font.size = _pt(size)
    run.font.bold = bold
    run.font.color.rgb = _rgb(color_tok)
    fam = FALLBACK_FONT if any(c in FALLBACK_CODEPOINTS for c in text) else BASE_FONT
    run.font.name = fam
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = rPr.makeelement(qn(tag), {})
            rPr.append(el)
        el.set("typeface", fam)


def _split_fallback(text: str) -> list[str]:
    """아래아처럼 KRDS subset 밖 글자만 별도 run 으로 떼어낸다."""
    out, buf = [], ""
    for ch in text:
        if ch in FALLBACK_CODEPOINTS:
            if buf:
                out.append(buf)
                buf = ""
            out.append(ch)
        else:
            buf += ch
    if buf:
        out.append(buf)
    return out or [""]


def _para_runs(para, text, size, color_tok, bold=False, link=None, where="pptx"):
    check_coverage(text, where)
    for chunk in _split_fallback(text):
        r = para.add_run()
        _set_run(r, size, color_tok, bold, chunk)
        if link:
            r.hyperlink.address = enc_url(link)


def _textbox(slide, x, y_top, w, h, align_right=False):
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    tb = slide.shapes.add_textbox(_emu(x), _y(y_top), _emu(w), _emu(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.TOP
    if align_right:
        tf.paragraphs[0].alignment = PP_ALIGN.RIGHT
    return tf


def _round_rect(slide, x, y_top, w, h, fill_tok, line_tok=None):
    from pptx.enum.shapes import MSO_SHAPE
    sh = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                _emu(x), _y(y_top), _emu(w), _emu(h))
    sh.adjustments[0] = 0.06
    sh.fill.solid()
    sh.fill.fore_color.rgb = _rgb(fill_tok)
    sh.shadow.inherit = False
    if line_tok:
        sh.line.color.rgb = _rgb(line_tok)
        sh.line.width = _emu(0.2)
    else:
        sh.line.fill.background()
    return sh


def _arrow_head(connector):
    """연결선 끝에 화살촉을 붙인다(python-pptx 기본 API에 없다)."""
    from pptx.oxml.ns import qn
    ln = connector.line._get_or_add_ln()
    tail = ln.makeelement(qn("a:tailEnd"),
                          {"type": "triangle", "w": "med", "len": "med"})
    ln.append(tail)


def build_pptx(deck: dict, out: Path, crops: dict) -> None:
    from pptx import Presentation
    from pptx.util import Emu
    prs = Presentation()
    prs.slide_width = Emu(int(13.3333333 * 914400))
    prs.slide_height = Emu(int(7.5 * 914400))
    blank = prs.slide_layouts[6]
    mark, _, marksub = deck["title"].partition(" | ")

    for i, sl in enumerate(deck["slides"], 1):
        W = f"pptx{i}"
        s = prs.slides.add_slide(blank)
        # 공통 상단 제품 표기
        tf = _textbox(s, MARGIN, Y_MARK, 40, 5)
        _para_runs(tf.paragraphs[0], mark, FS["mark"], "primary-70", bold=True, where=W)
        tf = _textbox(s, MARGIN + est_w(mark, FS["mark"]) + 2.0, Y_MARK - 0.35, 70, 5)
        _para_runs(tf.paragraphs[0], marksub, FS["marksub"], "gray-50", where=W)
        tf = _textbox(s, CW - MARGIN - 50, Y_MARK, 50, 5, align_right=True)
        _para_runs(tf.paragraphs[0], "서울시 정책 협력 및 현장 실증 제안",
                   FS["marksub"], "gray-40", where=W)
        _rule(s, MARGIN, Y_MARK - 3.0, CW - 2 * MARGIN, 0.2, "gray-10")

        tf = _textbox(s, MARGIN, Y_EYEBROW, CW - 2 * MARGIN, 5)
        _para_runs(tf.paragraphs[0], "%02d  %s" % (i, sl["title"]),
                   FS["eyebrow"], "primary-60", bold=True, where=W)
        tf = _textbox(s, MARGIN, Y_HEAD, CW - 2 * MARGIN, 10)
        _para_runs(tf.paragraphs[0], sl["headline"], FS["head"], "gray-90",
                   bold=True, where=W)

        if i == 1:
            _ppt_numbered(s, sl["bullets"], W)
        elif i == 3:
            _ppt_slide3(s, sl, crops.get(3), W)
        elif i == 4:
            _ppt_slide4(s, sl, crops.get(4), W)
        else:
            _ppt_cards(s, sl["bullets"], W)

        _rule(s, MARGIN, Y_RULE + 0.25, CW - 2 * MARGIN, 0.25, "gray-20")
        tf = _textbox(s, MARGIN, Y_FOOT, CW - 2 * MARGIN - 14, 8)
        para = tf.paragraphs[0]
        _para_runs(para, "출처  ", FS["foot"], "gray-50", where=W)
        for j, (title, url) in enumerate(deck_source_labels(sl, deck["references"])):
            if j:
                _para_runs(para, "  ·  ", FS["foot"], "gray-40", where=W)
            _para_runs(para, title, FS["foot"], "gray-50", link=url, where=W)
        tf = _textbox(s, CW - MARGIN - 14, Y_FOOT, 14, 5, align_right=True)
        _para_runs(tf.paragraphs[0], "%d / 6" % i, FS["foot"], "gray-40", where=W)

    if len(prs.slides._sldIdLst) != 6:
        raise SystemExit("[PPTX] 슬라이드 수가 6장이 아니다")
    prs.save(out)


def _rule(slide, x, y_top, w, h, tok):
    from pptx.enum.shapes import MSO_SHAPE
    sh = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, _emu(x), _y(y_top), _emu(w), _emu(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = _rgb(tok)
    sh.line.fill.background(); sh.shadow.inherit = False
    return sh


def _ppt_bar(slide, x, y_top, h, tok="primary-50"):
    return _rule(slide, x, y_top, ACCENT, h, tok)


def _ppt_numbered(slide, bullets, W):
    n = len(bullets)
    h = (Y_CONTENT_TOP - Y_CONTENT_BOT - GAP * 0.5 * (n - 1)) / n
    numw = 13.0
    for i, text in enumerate(bullets):
        y = Y_CONTENT_TOP - i * (h + GAP * 0.5)
        _round_rect(slide, MARGIN, y, CW - 2 * MARGIN, h, "gray-5")
        _ppt_bar(slide, MARGIN, y, h)
        tf = _textbox(slide, MARGIN + ACCENT + 3.0,
                      y - (h - line_mm(FS["num"])) / 2 + 0.4, numw, 8)
        _para_runs(tf.paragraphs[0], "%02d" % (i + 1), FS["num"], "primary-30",
                   bold=True, where=W)
        tw = CW - 2 * MARGIN - numw - 8.0
        lines = est_lines(text, tw, FS["big"])
        ty = y - (h - lines * line_mm(FS["big"])) / 2 + 0.2
        tf = _textbox(slide, MARGIN + numw + 4.0, ty, tw, lines * line_mm(FS["big"]) + 2)
        _para_runs(tf.paragraphs[0], text, FS["big"], "gray-90", where=W)
        tf.paragraphs[0].line_spacing = 1.45


def _ppt_cards(slide, bullets, W):
    n = len(bullets)
    cols = 2 if n >= 4 else n
    rows = (n + cols - 1) // cols
    w = (CW - 2 * MARGIN - GAP * (cols - 1)) / cols
    tw = w - 2 * PAD - ACCENT
    need = 0.0
    for t in bullets:
        label, body = split_bullet(t)
        hh = 2 * PAD + est_lines(body, tw, FS["cardbody"]) * line_mm(FS["cardbody"])
        if label:
            hh += line_mm(FS["cardlabel"]) + 1.4
        need = max(need, hh)
    avail = (Y_CONTENT_TOP - Y_CONTENT_BOT - GAP * (rows - 1)) / rows
    h = min(avail, max(need, 16.0))
    top = Y_CONTENT_TOP - (Y_CONTENT_TOP - Y_CONTENT_BOT - (h * rows + GAP * (rows - 1))) / 2
    for i, text in enumerate(bullets):
        r, c = divmod(i, cols)
        x = MARGIN + c * (w + GAP)
        y = top - r * (h + GAP)
        label, body = split_bullet(text)
        _round_rect(slide, x, y, w, h, "gray-5")
        _ppt_bar(slide, x, y, h)
        tf = _textbox(slide, x + ACCENT + PAD, y - PAD, tw, h - 2 * PAD)
        p0 = tf.paragraphs[0]
        if label:
            _para_runs(p0, label, FS["cardlabel"], "primary-70", bold=True, where=W)
            p0.space_after = _pt(1.4)
            p0 = tf.add_paragraph()
        _para_runs(p0, body, FS["cardbody"], "gray-80", where=W)
        for para in tf.paragraphs:
            para.line_spacing = 1.45


def _ppt_shot(slide, crop, x, w, ytop, hmax, num, W):
    if not crop:
        return
    path, ratio = crop
    cap = line_mm(FS["shotcap"]) + 1.0
    ih = min(hmax - cap - 2.4, w / ratio)
    iw = ih * ratio
    if iw > w:
        iw, ih = w, w / ratio
    bx = x + (w - iw) / 2
    _round_rect(slide, bx - 1.2, ytop, iw + 2.4, ih + 2.4, "gray-5")
    slide.shapes.add_picture(str(path), _emu(bx), _y(ytop - 1.2),
                             width=_emu(iw), height=_emu(ih))
    tf = _textbox(slide, x, ytop - ih - 3.6, w, 5)
    _para_runs(tf.paragraphs[0], SHOT_CAPTION[num], FS["shotcap"], "gray-50", where=W)


def _ppt_slide3(slide, sl, crop, W):
    right_w = 62.0
    left_w = CW - 2 * MARGIN - right_w - GAP
    lead = "  ·  ".join(sl["bullets"])
    lead_h = est_lines(lead, CW - 2 * MARGIN, FS["lead"]) * line_mm(FS["lead"])
    tf = _textbox(slide, MARGIN, Y_CONTENT_TOP, CW - 2 * MARGIN, lead_h + 2)
    _para_runs(tf.paragraphs[0], lead, FS["lead"], "gray-70", where=W)
    tf.paragraphs[0].line_spacing = 1.45
    top = Y_CONTENT_TOP - lead_h - 2.6
    steps = sl["steps"]
    n = len(steps)
    rh = (top - Y_CONTENT_BOT - 1.2 * (n - 1)) / n
    _round_rect(slide, MARGIN, top, left_w, top - Y_CONTENT_BOT, "graphic-10")
    for i, st in enumerate(steps):
        y = top - i * (rh + 1.2)
        _round_rect(slide, MARGIN + 2.0, y - 0.6, left_w - 4.0, rh - 1.2,
                    "gray-0", "primary-20")
        cy = y - 0.6 - (rh - 1.2 - line_mm(FS["step"])) / 2
        tf = _textbox(slide, MARGIN + 4.0, cy, 6.0, 5)
        _para_runs(tf.paragraphs[0], "%d" % (i + 1), FS["step"], "primary-50",
                   bold=True, where=W)
        tf = _textbox(slide, MARGIN + 9.0, cy, left_w - 12.0, 6)
        _para_runs(tf.paragraphs[0], st, FS["step"], "gray-80", where=W)
    _ppt_shot(slide, crop, MARGIN + left_w + GAP, right_w, top,
              top - Y_CONTENT_BOT, 3, W)


def _ppt_slide4(slide, sl, crop, W):
    from pptx.enum.shapes import MSO_CONNECTOR
    right_w = 56.0
    left_w = CW - 2 * MARGIN - right_w - GAP
    case, outcomes = sl["bullets"][0], sl["bullets"][1:]
    label, body = split_bullet(case)
    ch = line_mm(FS["cardbody"]) + 3.0
    y = Y_CONTENT_TOP
    _round_rect(slide, MARGIN, y, left_w, ch, "secondary-5")
    _ppt_bar(slide, MARGIN, y, ch, "secondary-70")
    tx = MARGIN + ACCENT + 3.0
    tf = _textbox(slide, tx, y - 1.5, 12.0, 5)
    _para_runs(tf.paragraphs[0], label or "사례", FS["cardbody"], "secondary-70",
               bold=True, where=W)
    tw = left_w - (tx - MARGIN) - 14.0
    tf = _textbox(slide, tx + 12.0, y - 1.5, tw, 6)
    _para_runs(tf.paragraphs[0], body, FS["cardbody"], "gray-80", where=W)

    bt = y - ch - 2.0
    tf = _textbox(slide, MARGIN, bt, left_w, 5)
    _para_runs(tf.paragraphs[0], "기관 답변에 따른 갈래", FS["tag"], "gray-60",
               bold=True, where=W)
    bt -= line_mm(FS["tag"]) + 1.0
    spine = MARGIN + 3.0
    rows_h = (bt - Y_CONTENT_BOT - 1.8 * (len(outcomes) - 1)) / len(outcomes)
    for i, (text, (tag, color)) in enumerate(zip(outcomes, OUTCOME_TAGS)):
        tok = {"krdssuccess60": "success-60", "krdsprimary60": "primary-60",
               "krdswarning60": "warning-60"}[color]
        ry = bt - i * (rows_h + 1.8)
        mid = ry - rows_h / 2
        _rule(slide, spine, bt, 0.2, bt - mid, "gray-30")
        cn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, _emu(spine), _y(mid),
                                        _emu(spine + 3.4), _y(mid))
        cn.line.color.rgb = _rgb("gray-30"); cn.line.width = _emu(0.2)
        _arrow_head(cn)
        bx = spine + 4.2
        bw = MARGIN + left_w - bx
        _round_rect(slide, bx, ry, bw, rows_h, "gray-5")
        _ppt_bar(slide, bx, ry, rows_h, tok)
        ttw = bw - ACCENT - 2.6 - 17.0
        lines = est_lines(text, ttw, FS["branch"])
        ty = ry - (rows_h - lines * line_mm(FS["branch"])) / 2 + 0.2
        tf = _textbox(slide, bx + ACCENT + 2.6, ty, 16.0, 5)
        _para_runs(tf.paragraphs[0], tag, FS["branch"], tok, bold=True, where=W)
        tf = _textbox(slide, bx + ACCENT + 19.0, ty, ttw, rows_h)
        _para_runs(tf.paragraphs[0], text, FS["branch"], "gray-80", where=W)
        tf.paragraphs[0].line_spacing = 1.2   # 두 줄이 상자 안에 들어오게
    _ppt_shot(slide, crop, MARGIN + left_w + GAP, right_w, Y_CONTENT_TOP,
              Y_CONTENT_TOP - Y_CONTENT_BOT, 4, W)



# ---------------------------------------------------------------------------
# 8-2. DOCX (편집 가능한 문단·표)
# ---------------------------------------------------------------------------
def _dx_color(tok: str):
    from docx.shared import RGBColor
    return RGBColor.from_string(KRDS[tok].upper())


def _dx_run(para, text, size, color_tok="gray-90", bold=False, link=None,
            where="docx"):
    """docx run. run.font.name 은 ascii/hAnsi 만 바꾸므로 eastAsia 도 지정한다."""
    from docx.shared import Pt
    from docx.oxml.ns import qn
    check_coverage(text, where)
    made = []
    for chunk in _split_fallback(text):
        fam = FALLBACK_FONT if chunk in FALLBACK_CODEPOINTS else BASE_FONT
        r = para.add_run(chunk)
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.color.rgb = _dx_color("primary-60" if link else color_tok)
        r.font.name = fam
        if link:
            r.font.underline = True
        rPr = r._element.get_or_add_rPr()
        rFonts = rPr.find(qn("w:rFonts"))
        if rFonts is None:
            rFonts = rPr.makeelement(qn("w:rFonts"), {})
            rPr.insert(0, rFonts)
        for a in ("w:ascii", "w:hAnsi", "w:eastAsia", "w:cs"):
            rFonts.set(qn(a), fam)
        made.append(r._element)   # Paragraph.runs 는 접근할 때마다 새 래퍼를 만든다.
                                  # 요소 자체를 들고 있어야 감쌀 수 있다.
    if link is not None:
        _dx_attach_link(para, link, made)


def _dx_attach_link(para, url, elements):
    """방금 만든 run 요소들을 w:hyperlink 로 감싼다."""
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    rid = para.part.relate_to(
        enc_url(url),
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True)
    hl = OxmlElement("w:hyperlink")
    hl.set(qn("r:id"), rid)
    for el in elements:
        para._p.remove(el)
        hl.append(el)
    para._p.append(hl)


def _dx_para(doc, space_before=0, space_after=6, align=None):
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.6
    if align == "right":
        pf.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    return p


def _dx_shade(cell, tok):
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:fill"), KRDS[tok].upper())
    cell._tc.get_or_add_tcPr().append(sh)


def _dx_marked(para, text, refs, size, where):
    """본문 안 [S1] 표식을 하이퍼링크 run 으로 바꾼다."""
    last = 0
    for m in _MARK.finditer(text):
        if text[last:m.start()]:
            _dx_run(para, text[last:m.start()], size, where=where)
        rid = m.group(1)
        if rid in refs:
            _dx_run(para, f"[{rid}]", size - 1.5, link=refs[rid]["url"], where=where)
        else:
            _dx_run(para, m.group(0), size, where=where)
        last = m.end()
    if text[last:]:
        _dx_run(para, text[last:], size, where=where)


def _dx_repeat_header(row):
    """표가 쪽을 넘어갈 때 머리행을 반복하고 행이 쪼개지지 않게 한다."""
    from docx.oxml import OxmlElement
    trPr = row._tr.get_or_add_trPr()
    for tag in ("w:tblHeader", "w:cantSplit"):
        trPr.append(OxmlElement(tag))


def _dx_no_split(row):
    from docx.oxml import OxmlElement
    row._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))


def _dx_fix_layout(table, widths_mm):
    """고정 레이아웃과 tblGrid 를 직접 지정하지 않으면 Word·LibreOffice 가
    셀 너비를 무시하고 내용에 맞춰 열을 다시 나눈다."""
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    tblPr = table._tbl.tblPr
    lay = OxmlElement("w:tblLayout")
    lay.set(qn("w:type"), "fixed")
    tblPr.append(lay)
    w = OxmlElement("w:tblW")
    w.set(qn("w:w"), str(int(sum(widths_mm) * 56.7)))   # mm -> twips
    w.set(qn("w:type"), "dxa")
    tblPr.append(w)
    grid = table._tbl.find(qn("w:tblGrid"))
    if grid is None:
        grid = OxmlElement("w:tblGrid")
        table._tbl.insert(1, grid)
    for g in list(grid):
        grid.remove(g)
    for mm in widths_mm:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(int(mm * 56.7)))
        grid.append(col)


def _dx_table(doc, widths_mm, header, rows, caption, body_size=8.5):
    from docx.shared import Mm, Pt
    cap = _dx_para(doc, space_before=10, space_after=3)
    _dx_run(cap, caption, 9, "gray-70", bold=True, where="표제")
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    t.autofit = False
    _dx_fix_layout(t, widths_mm)
    _dx_repeat_header(t.rows[0])
    for j, h in enumerate(header):
        c = t.rows[0].cells[j]
        c.width = Mm(widths_mm[j])
        _dx_shade(c, "secondary-70")
        pr = c.paragraphs[0]
        pr.paragraph_format.space_after = Pt(2)
        _dx_run(pr, h, body_size, "gray-0", bold=True, where="표머리")
    for i, row in enumerate(rows):
        r_ = t.add_row()
        _dx_no_split(r_)
        cells = r_.cells
        for j, spec in enumerate(row):
            cells[j].width = Mm(widths_mm[j])
            if i % 2 == 1:
                _dx_shade(cells[j], "gray-5")
            pr = cells[j].paragraphs[0]
            pr.paragraph_format.space_after = Pt(2)
            pr.paragraph_format.line_spacing = 1.3
            for txt, kw in spec:
                _dx_run(pr, txt, body_size, where="표본문", **kw)
    return t


def _dx_header_footer(doc, policy):
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    sec = doc.sections[0]
    hp = sec.header.paragraphs[0]
    hp.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
    _dx_run(hp, policy["title"], 8, "gray-60", where="머리말")
    _dx_run(hp, "\t\t", 8, "gray-60", where="머리말")
    _dx_run(hp, policy["subtitle"], 8, "gray-60", where="머리말")
    fp = sec.footer.paragraphs[0]
    fp.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for instr in ("PAGE", "NUMPAGES"):
        fld = OxmlElement("w:fldSimple")
        fld.set(qn("w:instr"), f" {instr} ")
        run = OxmlElement("w:r")
        rpr = OxmlElement("w:rPr")
        sz = OxmlElement("w:sz"); sz.set(qn("w:val"), "16"); rpr.append(sz)
        rpr.append(OxmlElement("w:noProof"))
        run.append(rpr)
        fld.append(run)
        fp._p.append(fld)
        if instr == "PAGE":
            sep = fp.add_run(" / ")
            sep.font.size = Pt(8)
            sep.font.color.rgb = _dx_color("gray-50")


def build_docx(policy: dict, out: Path) -> None:
    from docx import Document
    from docx.shared import Mm, Pt
    from docx.oxml.ns import qn
    refs = ref_index(policy)
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)      # A4 (기본 Letter 교정)
    sec.left_margin = sec.right_margin = Mm(19)
    sec.top_margin = sec.bottom_margin = Mm(20)
    st = doc.styles["Normal"]
    st.font.name = BASE_FONT
    st.font.size = Pt(11.25)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), BASE_FONT)
    _dx_header_footer(doc, policy)

    W = "docx"
    p = _dx_para(doc, space_after=3)
    _dx_run(p, "정책 제안서", 9, "primary-60", bold=True, where=W)
    p = _dx_para(doc, space_after=4)
    _dx_run(p, policy["title"], 24, "gray-90", bold=True, where=W)
    p = _dx_para(doc, space_after=2)
    _dx_run(p, policy["subtitle"], 12.75, "gray-70", where=W)
    p = _dx_para(doc, space_after=12)
    _dx_run(p, "작성일 %s · 근거 확인일 %s" % (policy["date"], policy["date"]),
            9.75, "gray-50", where=W)

    tnum = 0
    for idx, s_ in enumerate(policy["sections"], 1):
        h = _dx_para(doc, space_before=18, space_after=4)
        h.paragraph_format.keep_with_next = True
        _dx_run(h, s_["title"], 14.25, "gray-90", bold=True, where=W)
        for para in s_["paragraphs"]:
            _dx_marked(_dx_para(doc), para, refs, 11.25, W)
        if s_.get("table"):
            tnum += 1
            _dx_json_table(doc, s_, idx, tnum, refs)
        if idx == 7:
            tnum += 1
            _dx_coop_table(doc, s_["paragraphs"], tnum)
        if idx == 11:
            tnum += 1
            _dx_basis_table(doc, policy, tnum)
            tnum += 1
            _dx_reference_table(doc, policy, tnum)
        ids = s_.get("sources", [])
        if ids:
            sp = _dx_para(doc, space_before=2, space_after=4)
            _dx_run(sp, "근거: ", 9.75, "gray-60", where=W)
            for j, rid in enumerate(ids):
                if j:
                    _dx_run(sp, " · ", 9.75, "gray-40", where=W)
                _dx_run(sp, rid, 9.75, link=refs[rid]["url"], where=W)
    doc.save(out)


def _cell(text, **kw):
    return [(text, kw)]


def _cell_marked(text, refs, **kw):
    """표 셀 안의 [F1] 표식을 링크 run 으로 쪼갠다. 셀 원문은 그대로 남는다."""
    out, last = [], 0
    for m in _MARK.finditer(text):
        if text[last:m.start()]:
            out.append((text[last:m.start()], dict(kw)))
        rid = m.group(1)
        if rid in refs:
            out.append((f"[{rid}]", {"link": refs[rid]["url"]}))
        else:
            out.append((m.group(0), dict(kw)))
        last = m.end()
    if text[last:]:
        out.append((text[last:], dict(kw)))
    return out or [(text, dict(kw))]


def _dx_json_table(doc, sec, idx, num, refs):
    """policy-content.json 의 section.table 을 DOCX 에도 같은 구성으로 수록한다."""
    t = sec["table"]
    headers = list(t["headers"])
    rows = [list(r) for r in t["rows"]]
    if idx == 4:
        headers.append(SECTION4_EXTRA_HEADER)
        for r, note in zip(rows, SECTION4_NOTES):
            r.append(note)
    first = FIRST_COL.get(idx, 26.0)
    rest = (172.0 - first) / (len(headers) - 1)
    widths = [first] + [rest] * (len(headers) - 1)
    body = []
    for r in rows:
        spec = [_cell_marked(r[0], refs, color_tok="secondary-70", bold=True)]
        spec += [_cell_marked(c, refs) for c in r[1:]]
        body.append(spec)
    _dx_table(doc, widths, headers, body,
              "표 %d. %s" % (num, sec["title"].split(". ", 1)[-1]))


def _dx_coop_table(doc, paragraphs, num):
    rows = []
    for group, items in parse_cooperation(paragraphs):
        for j, (key, val) in enumerate(items):
            rows.append([_cell(group if j == 0 else "",
                               color_tok="secondary-70", bold=True),
                         _cell(key, bold=True), _cell(val)])
    _dx_table(doc, [23, 21, 128], ["협력 요청", "항목", "내용"], rows,
              "표 %d. 정책 협력 요청별 세부 항목" % num)


def _dx_basis_table(doc, policy, num):
    rows = [[_cell(m["basisSection"]), _cell(m["proposalSection"]),
             _cell(m["application"]), _cell("P0", link=m["source"])]
            for m in policy["basisMapping"]]
    _dx_table(doc, [34, 34, 91, 13],
              ["정책 근거 절", "본 제안서 절", "적용 내용", "출처"], rows,
              "표 %d. 정책 근거 대응" % num)


def _dx_reference_table(doc, policy, num):
    rows = [[_cell(r["id"], color_tok="secondary-70", bold=True),
             _cell(r["title"], link=r["url"]),
             _cell(domain(r["url"]).removeprefix("www."), color_tok="gray-50")]
            for r in policy["references"]]
    _dx_table(doc, [11, 119, 42],
              ["번호", "자료명 (누르면 원문으로 연결)", "제공처"], rows,
              "표 %d. 참고자료 목록" % num)


# ---------------------------------------------------------------------------
# 8-3. 검수
# ---------------------------------------------------------------------------
def _norm(t: str) -> str:
    return re.sub(r"\s+", "", t)


def _pdf_text(path: Path) -> tuple[str, int]:
    import pymupdf
    d = pymupdf.open(path)
    return "".join(pg.get_text() for pg in d), d.page_count


def _docx_text(path: Path) -> str:
    """Paragraph.text 는 python-docx 판에 따라 하이퍼링크 안의 run 을 빼먹는다.
    w:t 를 직접 훑어 실제 본문 전부를 모은다."""
    from docx import Document
    d = Document(path)

    def walk(container):
        return "".join(t.text or "" for t in container.xpath(".//w:t"))

    parts = [walk(p._p) for p in d.paragraphs]
    for t in d.tables:
        for row in t.rows:
            parts += [walk(c._tc) for c in row.cells]
    return "\n".join(parts)


def _pptx_text(path: Path) -> tuple[str, int]:
    from pptx import Presentation
    pr = Presentation(path)
    parts = []
    for sl in pr.slides:
        for sh in sl.shapes:
            if sh.has_text_frame:
                parts.append(sh.text_frame.text)
    return "\n".join(parts), len(pr.slides._sldIdLst)


def _expect_policy(policy: dict) -> list[str]:
    """표제부(제목·부제)는 머리말과 같은 문자열이라 따로 검사한다."""
    want = []
    for s_ in policy["sections"]:
        want.append(s_["title"])
        want += s_["paragraphs"]
    for m in policy["basisMapping"]:
        want += [m["basisSection"], m["proposalSection"], m["application"]]
    want += [r["title"] for r in policy["references"]]
    for i, s_ in enumerate(policy["sections"], 1):
        t = s_.get("table")
        if not t:
            continue
        want += list(t["headers"])
        for row in t["rows"]:
            want += list(row)
        if i == 4:
            want += [SECTION4_EXTRA_HEADER] + SECTION4_NOTES
    return want


def _expect_deck(deck: dict, with_flow: bool = True) -> list[str]:
    want = []
    for s_ in deck["slides"]:
        want += [s_["title"], s_["headline"]]
        for b in s_["bullets"]:
            # 카드에서는 "라벨: 본문" 의 콜론이 라벨 강조로 바뀐다. 두 조각을 각각 대조.
            label, body = split_bullet(b)
            want += ([label, body] if label else [b])
    for s_ in deck["slides"]:
        want += list(s_.get("steps", []))
    return want


def _check(label: str, haystack: str, wanted: list[str],
           chrome: tuple[str, ...] = ()) -> int:
    """쪽 넘김 때 머리말·꼬리말이 본문 사이에 끼어 들어가므로 먼저 걷어낸다."""
    hay = _norm(haystack)
    for c in chrome:
        hay = hay.replace(_norm(c), "")
    hay = re.sub(r"\d+/\d+", "", hay)
    missing = [w for w in wanted if _norm(w) and _norm(w) not in hay]
    if missing:
        print(f"  [{label}] 누락 {len(missing)}건")
        for m in missing[:8]:
            print("     -", m[:70])
        return len(missing)
    print(f"  [{label}] 대조 {len(wanted)}건 전부 일치")
    return 0


def _soffice_pdf(src: Path) -> Path:
    """PPTX·DOCX 를 LibreOffice 로 임시 PDF 변환(검수 전용).
    최종 PDF 는 xelatex 산출물을 그대로 둔다."""
    tmp = WORK / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    env = {"FONTCONFIG_FILE": str(WORK / "fonts.conf"), "HOME": str(WORK),
           "PATH": "/usr/bin:/bin"}
    r = subprocess.run(
        ["soffice", "--headless",
         "-env:UserInstallation=file://%s/lo-profile" % WORK,
         "--convert-to", "pdf", "--outdir", str(tmp), str(src)],
        capture_output=True, text=True, env=env)
    out = tmp / (src.stem + ".pdf")
    if not out.exists():
        raise SystemExit(f"[LibreOffice 변환 실패] {src.name}\n{r.stdout}{r.stderr}")
    return out


def _check_links(policy: dict, deck: dict) -> int:
    """링크가 '파랗고 밑줄 있는 글자'로만 보이고 실제로는 걸려 있지 않은 경우를 잡는다."""
    from docx import Document
    from pptx import Presentation
    import pymupdf
    bad = 0
    d = Document(HERE / "malgyeol-policy-proposal.docx")
    holders = list(d.paragraphs) + [pp for t in d.tables for r in t.rows
                                    for c in r.cells for pp in c.paragraphs]
    n_hl = sum(len(h._p.xpath(".//w:hyperlink")) for h in holders)
    n_run = sum(len(h._p.xpath(".//w:hyperlink//w:r")) for h in holders)
    n_rel = len([r for r in d.part.rels.values() if "hyperlink" in r.reltype])
    print(f"  DOCX 링크 — 요소 {n_hl}개, 내부 run {n_run}개, 외부 관계 {n_rel}개")
    if n_hl == 0 or n_run < n_hl or n_rel == 0:
        print("  [DOCX] 빈 하이퍼링크가 있다"); bad += 1

    pr = Presentation(HERE / "malgyeol-3min-deck.pptx")
    n_p = sum(1 for sl in pr.slides for sh in sl.shapes if sh.has_text_frame
              for pa in sh.text_frame.paragraphs for r in pa.runs
              if r.hyperlink.address)
    print(f"  PPTX 링크 — {n_p}개")
    if n_p == 0:
        print("  [PPTX] 출처 링크가 없다"); bad += 1

    doc = pymupdf.open(HERE / "malgyeol-policy-proposal.pdf")
    uris = [l["uri"] for pg in doc for l in pg.get_links() if l.get("uri")]
    print(f"  제안서 PDF 링크 — {len(uris)}개")
    raw = [u for u in uris if any(ord(c) > 127 for c in u) or "\\" in u]
    if raw:
        print(f"  [PDF] 인코딩되지 않은 링크 {len(raw)}건: {raw[0][:70]}"); bad += 1
    law = [u for u in uris if "law.go.kr" in u and "LsiJoLinkP" in u]
    if law and "%E3%86%8D" not in law[0]:
        print(f"  [PDF] 법령명 링크의 아래아 인코딩 이상: {law[0][:90]}"); bad += 1
    elif law:
        print("  법령명 링크 아래아 인코딩 정상 (%E3%86%8D)")
    if not uris:
        print("  [PDF] 링크가 하나도 없다"); bad += 1
    return bad


def verify(policy: dict, deck: dict, shot: str | None = None) -> None:
    print("검수 시작")
    fails = 0
    p_pdf, p_pages = _pdf_text(HERE / "malgyeol-policy-proposal.pdf")
    d_pdf, d_pages = _pdf_text(HERE / "malgyeol-3min-deck.pdf")
    print(f"  쪽수 — 제안서 {p_pages}쪽, 덱 {d_pages}장")
    if d_pages != 6:
        print("  [덱] 본편 6장이 아니다"); fails += 1

    want_p = _expect_policy(policy)
    want_d = _expect_deck(deck, with_flow=(shot is None))
    chrome_p = (policy["title"], policy["subtitle"])
    title_pair = [policy["title"], policy["subtitle"]]
    docx_txt = _docx_text(HERE / "malgyeol-policy-proposal.docx")
    fails += _check("제안서 PDF 표제", p_pdf, title_pair)
    fails += _check("제안서 DOCX 표제", docx_txt, title_pair)
    fails += _check("제안서 PDF", p_pdf, want_p, chrome_p)
    fails += _check("제안서 DOCX", docx_txt, want_p, chrome_p)
    fails += _check("덱 PDF", d_pdf, want_d)
    ppt_text, ppt_n = _pptx_text(HERE / "malgyeol-3min-deck.pptx")
    if ppt_n != 6:
        print(f"  [PPTX] 슬라이드 {ppt_n}장"); fails += 1
    fails += _check("덱 PPTX", ppt_text, want_d)

    # 편집 원본을 LibreOffice 로 변환해 잘림·쪽수 확인
    lo_ppt = _soffice_pdf(HERE / "malgyeol-3min-deck.pptx")
    _, n = _pdf_text(lo_ppt)
    print(f"  PPTX→PDF 변환 {n}쪽" + ("" if n == 6 else "  ← 6장 아님"))
    fails += (n != 6)
    lo_doc = _soffice_pdf(HERE / "malgyeol-policy-proposal.docx")
    _, n2 = _pdf_text(lo_doc)
    print(f"  DOCX→PDF 변환 {n2}쪽")

    for label, txt in (("제안서 PDF", p_pdf), ("덱 PDF", d_pdf)):
        if "출처" not in txt and "근거" not in txt:
            print(f"  [{label}] 출처 표기 없음"); fails += 1
    fails += _check_links(policy, deck)

    import pymupdf
    rd = WORK / "render" / "final"
    rd.mkdir(parents=True, exist_ok=True)
    for name in ("malgyeol-policy-proposal", "malgyeol-3min-deck"):
        doc = pymupdf.open(HERE / (name + ".pdf"))
        for i, pg in enumerate(doc, 1):
            pg.get_pixmap(dpi=110).save(rd / f"{name}-{i:02d}.png")
    for src, tag in ((lo_doc, "docx"), (lo_ppt, "pptx")):
        doc = pymupdf.open(src)
        for i, pg in enumerate(doc, 1):
            pg.get_pixmap(dpi=100).save(rd / f"{tag}-conv-{i:02d}.png")
    print(f"  렌더 이미지: {rd}")
    print("검수 실패 %d건" % fails if fails else "검수 통과")
    if fails:
        raise SystemExit(1)


# ---------------------------------------------------------------------------
# 9. 진입점
# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="말결 정책 제안서·발표 덱 생성기")
    ap.add_argument("target", choices=["tex", "pdf", "docx", "pptx", "verify", "all"])
    ap.add_argument("--screenshot", metavar="PATH", default=str(DEFAULT_SHOT),
                    help="3·4번 슬라이드에 실을 실제 담당자 화면 캡처 원본. "
                         "기본값은 프런트엔드 최종 산출 경로. SHOT_CROPS 의 영역만 잘라 "
                         "전체 화면을 줄이지 않고 읽히는 크기로 넣는다.")
    ap.add_argument("--no-screenshot", action="store_true",
                    help="화면 없이 만든다. 빈 자리나 placeholder 는 그리지 않고 "
                         "왼쪽 내용이 폭을 넓혀 쓴다.")
    a = ap.parse_args()

    shot = None
    if not a.no_screenshot:
        shot = str(Path(a.screenshot).resolve())
        if not Path(shot).is_file():
            raise SystemExit(f"[화면 캡처 없음] {shot}\n"
                             f"  화면 없이 만들려면 --no-screenshot 을 쓴다.")

    policy, deck = load("policy-content.json"), load("deck-content.json")
    crops = make_crops(Path(shot)) if shot else {}
    p_tex, d_tex = HERE / "malgyeol-policy-proposal.tex", HERE / "malgyeol-3min-deck.tex"

    if a.target in ("tex", "pdf", "all"):
        p_tex.write_text(policy_tex(policy), encoding="utf-8")
        d_tex.write_text(deck_tex(deck, crops), encoding="utf-8")
        print("TeX 원본 생성 완료")
    if a.target in ("pdf", "all"):
        xelatex(p_tex, HERE / "malgyeol-policy-proposal.pdf")
        xelatex(d_tex, HERE / "malgyeol-3min-deck.pdf")
        print("PDF 생성 완료")
    if a.target in ("docx", "all"):
        build_docx(policy, HERE / "malgyeol-policy-proposal.docx")
        print("DOCX 생성 완료")
    if a.target in ("pptx", "all"):
        build_pptx(deck, HERE / "malgyeol-3min-deck.pptx", crops)
        print("PPTX 생성 완료")
    if a.target in ("verify", "all"):
        verify(policy, deck, shot)


if __name__ == "__main__":
    main()
