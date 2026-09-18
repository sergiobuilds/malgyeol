"""Private, explicit role routing. Public institution contacts remain untouched."""
import json
import os
from pathlib import Path
import re
import stat


def normalize_number(value):
    if not isinstance(value, str) or not re.fullmatch(r'[+0-9 ()-]{8,24}', value):
        raise ValueError('ROUTING_NUMBER')
    number = re.sub(r'[ ()-]', '', value)
    if number.startswith('0'):
        number = '+82' + number[1:]
    if not re.fullmatch(r'\+[1-9][0-9]{7,14}', number):
        raise ValueError('ROUTING_NUMBER')
    return number


def load_routing(path):
    file = Path(path)
    if file.is_symlink():
        raise ValueError('ROUTING_PERMISSIONS')
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
    try:
        descriptor = os.open(file, flags)
    except OSError:
        raise ValueError('ROUTING_FILE_REQUIRED') from None
    with os.fdopen(descriptor, 'r', encoding='utf-8') as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) & 0o077:
            raise ValueError('ROUTING_PERMISSIONS')
        try:
            value = json.load(stream)
        except (ValueError, UnicodeError):
            raise ValueError('ROUTING_SCHEMA') from None
    required={'allowedNumbers','citizenNumbers','institutionNumbers'}
    if not isinstance(value, dict) or not required<=set(value) or set(value)-required-{'demoCallers','publicIntake','demoTime'}:
        raise ValueError('ROUTING_SCHEMA')
    if not isinstance(value['allowedNumbers'], list) or not value['allowedNumbers']:
        raise ValueError('ROUTING_SCHEMA')
    allowed = list(dict.fromkeys(normalize_number(n) for n in value['allowedNumbers']))
    result = {'allowedNumbers': allowed}
    for role in ('citizenNumbers', 'institutionNumbers'):
        if not isinstance(value[role], dict):
            raise ValueError('ROUTING_SCHEMA')
        targets = {}
        for key, number in value[role].items():
            if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', key):
                raise ValueError('ROUTING_SCHEMA')
            normalized = normalize_number(number)
            if normalized not in allowed:
                raise ValueError('ROUTING_DESTINATION_NOT_ALLOWED')
            targets[key] = normalized
        result[role] = targets
    if 'publicIntake' in value:
        if type(value['publicIntake']) is not bool:raise ValueError('ROUTING_SCHEMA')
        result['publicIntake']=value['publicIntake']
    if 'demoCallers' in value:
        if not isinstance(value['demoCallers'],dict):raise ValueError('ROUTING_SCHEMA')
        demo={}
        for number,ref in value['demoCallers'].items():
            normalized=normalize_number(number)
            if normalized not in allowed:raise ValueError('ROUTING_DESTINATION_NOT_ALLOWED')
            if not isinstance(ref,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}',ref):raise ValueError('ROUTING_SCHEMA')
            if normalized in demo and demo[normalized]!=ref:raise ValueError('ROUTING_SCHEMA')
            demo[normalized]=ref
        result['demoCallers']=demo
    if 'demoTime' in value:
        if not isinstance(value['demoTime'],str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',value['demoTime']):raise ValueError('ROUTING_SCHEMA')
        if not result.get('demoCallers'):raise ValueError('ROUTING_SCHEMA')
        result['demoTime']=value['demoTime']
    return result
