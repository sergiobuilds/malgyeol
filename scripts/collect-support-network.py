#!/usr/bin/env python3
"""Normalize official Seoul foodbank directory captures, preserving source rows.

Collection input: UTF-8 browser-readable captures named market-1.txt through
market-4.txt and map-1.txt through map-3.txt. --snapshot-dir imports all seven
pages, rejecting partial batches. --rebuild reproduces normalized institutions
from the committed sourceRecords without pretending to refresh source dates.
Example: python3 scripts/collect-support-network.py --rebuild --output /tmp/network.json
Direct HTTP was refused (403) during collection; browser/web-tool captures were
used. No invented fallback data is generated on collection failure.
"""
import argparse
import copy
import hashlib
import json
import pathlib
import re
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'data/support-network.json'
FOOD_GUIDE = 'https://www.s-foodbank.or.kr/intro/intro03'
DREAM_GUIDE = 'https://s-foodbank.or.kr/justdream/guide'
MOBILE = 'https://news.seoul.go.kr/welfare/archives/1355'
MOBILE_OPERATOR = 'https://www.s-foodbank.or.kr/board/business/8'
SOS_GUIDE = 'https://wis.seoul.go.kr/wfs/sos/guide.do'
SOS_STAFF = 'https://www.sd.go.kr/seongsu1ga2/selectEmpList.do?deptCode=30300550000&key=2801'
SOS_ADDRESS = 'https://www.sd.go.kr/seongsu1ga2/contents.do?key=2803'


def source(url, title, checked):
    return {'url': url, 'title': title, 'checkedAt': checked}


def parse_page(text, kind, page, checked):
    clean = re.sub(r'\ue200.*?\ue201', '', text)
    clean = re.sub(r'L\d+: ?', '', clean)
    rows = []
    for block in re.split(r'\n  \* ', clean):
        if not re.match(r'[^\n]*푸드[^\n]*\n', block):
            continue
        address = re.search(r'(?:\(\d{5}\)\s*)?(서울(?:특별시)?\s+[^\n]+)', block)
        phones = re.findall(r'(?<!\d)02-\d{3,4}-\d{4}(?!\d)', block)
        hours = re.search(r'([월화수목금토일][^\n]*\d{1,2}:\d{2}[^\n]*)', block)
        if not address or not phones or not hours:
            continue
        name = block.splitlines()[0].strip()
        addr = address.group(1).strip()
        district = re.search(r'서울(?:특별시)?\s+([가-힣]+구)\b', addr)
        if not district:
            raise ValueError(f'No district: {name}')
        url = f'https://www.s-foodbank.or.kr/board/{kind}/{kind}List'
        if page != 1:
            url += f'?page={page}'
        rows.append({'name': name, 'address': addr, 'district': district.group(1),
                     'phone': phones[0], 'hours': hours.group(1).strip(),
                     'programId': 'foodbank-market' if kind == 'market' else 'just-dream',
                     'source': source(url, '서울잇다푸드뱅크 기관 목록' if kind == 'market' else '그냥드림 사업장 목록', checked)})
    expected = {('market', 4): 6, ('map', 3): 9}.get((kind, page), 10)
    if len(rows) != expected:
        raise ValueError(f'{kind}-{page}: expected {expected} rows, found {len(rows)}; inspect pagination before updating')
    return rows


def offering(row):
    checked = row['source']['checkedAt']
    if row['programId'] == 'foodbank-market':
        return {'programId': 'foodbank-market', 'categories': ['식품', '생필품'],
                'eligibility': ['경제적으로 어려운 개인 우선 지원', '긴급지원·차상위·지원 중단 등 가구별 선정 상담'],
                'steps': ['거주지 동주민센터 또는 해당 자치구 사업장에 이용 상담', '동주민센터·자치구 담당자의 이용자 선정', '기관 안내에 따른 신분증 준비 및 이용 등록', '선정된 제공처에서 물품 선택·수령'],
                'access': ['등록·선정 후 해당 제공처 이용', '방문이 어려운 경우 수령 방법을 기관에 알아보기'],
                'hours': row['hours'], 'sources': [row['source'], source(FOOD_GUIDE, '푸드뱅크·마켓 대상 및 이용절차', checked)]}
    return {'programId': 'just-dream', 'categories': ['식품', '생필품'],
            'eligibility': ['위기 상황 등으로 식료품 지원이 필요한 개인', '주소지 관할 사업장 이용 원칙, 긴급 상황은 지역 외 우선 지원 판단'],
            'steps': ['신분증 준비 및 거주지 관할 코너 방문', '자가 점검·사업 안내·지원 대상 상담', '이용 신청서 작성 및 패키지 수령', '재방문 시 생활 상황 상담, 필요한 경우 동주민센터 복지상담 연계'],
            'access': ['사업장 운영시간 내 방문', '방문이 어려운 경우 이용 방법을 기관에 알아보기'],
            'hours': row['hours'], 'sources': [row['source'], source(DREAM_GUIDE, '그냥드림 이용안내', checked)]}


def address_key(address):
    # Only exact normalized road/building matches; names alone never merge sites.
    value = re.sub(r'\s+', '', address).replace('서울특별시', '서울')
    match = re.match(r'(서울[가-힣]+구[가-힣0-9]+(?:로|길)\d+(?:-\d+)?)', value)
    return match.group(1) if match else value


def normalize(rows, extra):
    institutions = []
    for row in rows:
        matches = [x for x in institutions if x['district'] == row['district'] and
                   (any(c['phone'] == row['phone'] for c in x['contacts']) or
                    address_key(x['address']) == address_key(row['address']))]
        if len(matches) > 1:
            raise ValueError(f'Ambiguous facility merge: {row["name"]}')
        if matches:
            item = matches[0]
        else:
            key = row['district'] + ':' + row['phone']
            item = {'id': 'institution-' + hashlib.sha256(key.encode()).hexdigest()[:12],
                    'name': row['name'], 'address': row['address'], 'district': row['district'],
                    'roles': ['사업 운영·이용 문의'], 'contacts': [], 'programs': [], 'sources': []}
            institutions.append(item)
        if any(x['programId'] == row['programId'] for x in item['programs']):
            raise ValueError(f'Duplicate offering at facility: {row["name"]}')
        purpose = ('푸드뱅크·마켓 이용 문의' if row['programId'] == 'foodbank-market' else '그냥드림 이용 문의')
        item['contacts'].append({'purpose': purpose, 'phone': row['phone']})
        item['sources'].append(row['source'])
        item['programs'].append(offering(row))
        if row['programId'] == 'just-dream':
            item['roles'].append('그냥드림 제공처')
    institutions.extend(copy.deepcopy(extra))
    return sorted(institutions, key=lambda x: (x['district'], x['name']))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--snapshot-dir', type=pathlib.Path)
    mode.add_argument('--rebuild', action='store_true')
    parser.add_argument('--input', type=pathlib.Path, default=DEFAULT)
    parser.add_argument('--output', type=pathlib.Path, default=DEFAULT)
    parser.add_argument('--checked-at', help='Capture timestamp; never the business availability time')
    args = parser.parse_args()
    base = json.loads(args.input.read_text()) if args.input.exists() else {'supplementalInstitutions': []}
    if args.snapshot_dir:
        checked = args.checked_at or datetime.now(timezone.utc).isoformat()
        rows, captures = [], []
        for kind, count in [('market', 4), ('map', 3)]:
            for page in range(1, count + 1):
                path = args.snapshot_dir / f'{kind}-{page}.txt'
                content = path.read_text()
                found = parse_page(content, kind, page, checked)
                rows.extend(found)
                captures.append({'url': found[0]['source']['url'], 'checkedAt': checked,
                                 'sha256': hashlib.sha256(content.encode()).hexdigest(), 'rows': len(found)})
        base.update({'schemaVersion': 1, 'sourceRecords': rows, 'captures': captures})
    elif not base.get('sourceRecords'):
        raise ValueError('No captured source rows to rebuild')
    base['institutions'] = normalize(base['sourceRecords'], base['supplementalInstitutions'])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(base, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'institutions': len(base['institutions']), 'sourceRows': len(base['sourceRecords']),
                      'districts': len(set(x['district'] for x in base['sourceRecords']))}))


if __name__ == '__main__':
    main()
