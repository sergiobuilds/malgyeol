"""Load approved credentials without echoing values, then exec one runtime component."""
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
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
    raise SystemExit('Usage: run-care-runtime.py api|voice')
os.execvpe(command[0], command, env)
