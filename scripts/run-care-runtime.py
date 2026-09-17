"""Load approved credentials without echoing values, then exec one runtime component."""
import os
from pathlib import Path
import sys
import sqlite3
from datetime import datetime, timezone

root = Path(__file__).resolve().parent.parent
if sys.argv[1:] == ['backup']:
    source = root / '.private/care-ledger.sqlite'
    if not source.is_file():
        raise SystemExit('Care ledger does not exist; no empty backup created')
    directory = root / '.private/backups'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = directory / ('care-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.sqlite')
    with destination.open('xb'):
        os.chmod(destination, 0o600)
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as src, sqlite3.connect(destination) as dst:
        src.backup(dst)
        if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('Backup integrity failed')
    print('Care ledger backup integrity PASS; private local snapshot created')
    raise SystemExit(0)
secrets = Path(os.environ.get('CARE_SECRET_DIR', str(root.parent / 'benefit-settlement-rail/.secrets')))
env = dict(os.environ)
for name in ('clawops', 'bridge'):
    for line in (secrets / (name + '.env')).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.removeprefix('export ').split('=', 1)
            env.setdefault(key.strip(), value.strip().strip('\"\''))
care_secrets = root / '.secrets/care.env'
if care_secrets.exists():
    for line in care_secrets.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            env.setdefault(key, value)
env['CLAWOPS_PHONE_NUMBER'] = os.environ.get('CARE_PHONE_NUMBER', '07052767277')
env['AGENT_API_BASE_URL'] = os.environ.get('CARE_API_BASE_URL', 'http://127.0.0.1:18081')
env['PORT'] = os.environ.get('CARE_PORT', '18081')
env['HOST'] = '127.0.0.1'
env['CARE_LEDGER_PATH'] = str(root / '.private/care-ledger.sqlite')
env['CLAWOPS_READY_FILE'] = str(root / '.private/clawops-ready')
(root / '.private').mkdir(mode=0o700, exist_ok=True)
os.chdir(root)
if sys.argv[1:] == ['api']:
    command = ['node', '--import', 'tsx', 'src/server.ts']
elif sys.argv[1:] == ['voice']:
    command = [str(Path.home() / '.local/bin/uv'), 'run', '--with', 'clawops[agent,gemini]==0.56.0', 'python', 'scripts/clawops-care-agent.py']
else:
    raise SystemExit('Usage: run-care-runtime.py api|voice|backup')
os.execvpe(command[0], command, env)
