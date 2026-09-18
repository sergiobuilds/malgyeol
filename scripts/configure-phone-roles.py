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
    parser.add_argument('--routing-file',type=Path)
    parser.add_argument('--reuse-existing',action='store_true')
    parser.add_argument('--demo-citizen-ref')
    parser.add_argument('--demo-time')
    parser.add_argument('--public-intake',action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    destination=args.routing_file or root/'.private/coordination-routing.json'
    if args.reuse_existing:
        value=load_routing(destination)
        citizens=set(value['citizenNumbers'].values());institutions=set(value['institutionNumbers'].values())
        if len(citizens)!=1 or len(institutions)!=1:raise SystemExit('EXPLICIT_AB_ROUTING_REQUIRED')
        citizen=next(iter(citizens));institution=next(iter(institutions))
    else:
        citizen = normalize_number(getpass.getpass('Citizen A number (hidden): '))
        institution = normalize_number(getpass.getpass('Institution B number (hidden): '))
        catalog = json.loads((root / 'data/support-network.json').read_text())
        value = {'allowedNumbers': [citizen, institution],
                 'citizenNumbers': {args.citizen_ref: citizen},
                 'institutionNumbers': {row['id']: institution for row in catalog['institutions']}}
    if citizen == institution:
        raise SystemExit('ROUTING_ROLES_MUST_BE_DISTINCT')
    service = normalize_number(os.environ.get('CARE_PHONE_NUMBER', '07052767277'))
    if service in (citizen, institution):
        raise SystemExit('ROUTING_SELF_CALL_FORBIDDEN')
    if args.demo_citizen_ref:value['demoCallers']={citizen:args.demo_citizen_ref,institution:args.demo_citizen_ref}
    if args.demo_time:value['demoTime']=args.demo_time
    if args.public_intake:value['publicIntake']=True
    directory = destination.parent
    directory.mkdir(mode=0o700, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.routing-', suffix='.json', dir=directory)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        load_routing(temporary)
        os.replace(temporary, destination)
    finally:
        if Path(temporary).exists():
            Path(temporary).unlink()
    print('Private A/B routing saved; catalog unchanged; no calls placed.')
    print('Run coordination-check before starting the voice runtime. Restart a running coordination runtime only after its current call ends.')


if __name__ == '__main__':
    main()
