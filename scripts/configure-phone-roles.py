"""Configure private A/B roleplay routing without command-line phone values."""
import argparse
import getpass
import json
import os
from pathlib import Path
import tempfile

from coordination_config import normalize_number, load_routing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--citizen-ref', default='role-citizen-a')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    citizen = normalize_number(getpass.getpass('Citizen A number (hidden): '))
    institution = normalize_number(getpass.getpass('Institution B number (hidden): '))
    if citizen == institution:
        raise SystemExit('ROUTING_ROLES_MUST_BE_DISTINCT')
    service = normalize_number(os.environ.get('CARE_PHONE_NUMBER', '07052767277'))
    if service in (citizen, institution):
        raise SystemExit('ROUTING_SELF_CALL_FORBIDDEN')
    catalog = json.loads((root / 'data/support-network.json').read_text())
    value = {'allowedNumbers': [citizen, institution],
             'citizenNumbers': {args.citizen_ref: citizen},
             'institutionNumbers': {row['id']: institution for row in catalog['institutions']}}
    directory = root / '.private'
    directory.mkdir(mode=0o700, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.routing-', suffix='.json', dir=directory)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        load_routing(temporary)
        os.replace(temporary, directory / 'coordination-routing.json')
    finally:
        if Path(temporary).exists():
            Path(temporary).unlink()
    print('Private A/B routing saved; catalog unchanged; no calls placed.')
    print('Run coordination-check before starting the voice runtime. Restart a running coordination runtime only after its current call ends.')


if __name__ == '__main__':
    main()
