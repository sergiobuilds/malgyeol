"""Independent local HTTP/Python acceptance proof. Never constructs a telephone client."""
from __future__ import annotations
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TOKEN = 'independent-demo-proof-local-token-' + 'x' * 32

class LocalServer:
    def __init__(self, ledger: Path, scenario="success"):
        self.ledger = ledger
        self.scenario = scenario
        self.process = None
    def start(self):
        env = {
            'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'],
            'NODE_ENV': 'test', 'AGENT_TOOL_SECRET': TOKEN,
            'DEMO_WORKFLOW_LEDGER_PATH': str(self.ledger),
            'DEMO_WORKFLOW_ENABLED': 'true',
            'DEMO_WORKFLOW_SCENARIO': self.scenario,
            'COORDINATION_LEDGER_PATH': str(self.ledger.with_name('coordination.sqlite')),
        }
        self.process = subprocess.Popen(
            ['node', '--import', 'tsx', 'tests/demoAcceptanceServer.ts'], cwd=ROOT,
            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if not select.select([self.process.stdout], [], [], 15)[0]:
            self.stop()
            raise AssertionError('local fixture did not announce its port')
        line = self.process.stdout.readline()
        if not line:
            raise AssertionError('local fixture exited: ' + self.process.stderr.read()[:1000])
        self.base = 'http://127.0.0.1:' + str(json.loads(line)['port'])
        return self
    def call(self, action, body=None, expected=200, authorized=True):
        headers = {'Content-Type': 'application/json'}
        if authorized:
            headers['Authorization'] = 'Bearer ' + TOKEN
        request = urllib.request.Request(
            self.base + '/internal/demo-workflow/' + action,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers, method='POST' if body is not None else 'GET')
        try:
            response = urllib.request.urlopen(request, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        result = json.loads(response.read())
        assert response.status == expected, (action, response.status, result)
        return result
    def stop(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
            self.process.stdout.close()
            self.process.stderr.close()

async def proof_scenario(directory: Path, scenario: str):
    import asyncio
    from datetime import datetime, timedelta, timezone
    import aiohttp
    from coordination_tools import Journal, Routing
    from coordination_voice import HttpAPI
    from demo_voice import DemoVoiceRuntime
    ledger = directory / (scenario + '.sqlite')
    server = LocalServer(ledger, scenario).start()
    journal = Journal(directory / (scenario + '-voice.sqlite'))
    calls = []
    try:
        server.call('begin', {'callId': 'unauthorized', 'citizenRef': 'test-citizen'}, expected=403, authorized=False)
        async with aiohttp.ClientSession(headers={'Authorization': 'Bearer ' + TOKEN}) as session:
            runtime = DemoVoiceRuntime(HttpAPI(session, server.base), journal, Routing({
                'allowedNumbers': ['+820000000001'], 'citizenNumbers': {'test-citizen': '+820000000001'},
                'institutionNumbers': {}}))
            class FakeCall:
                def __init__(self, call_id, direction):
                    self.call_id, self.direction = call_id, direction
                    self.from_number = '+820000000001'
                    self.ended_status = 'completed'
                    self._passive_dtmf_buffer = []
                    self._passive_dtmf_task = None
                async def wait(self):
                    await runtime.transcript(self, 'assistant', 'local fake callback result delivered')
                    await runtime.dtmf(self, '1')
                async def hangup(self):
                    pass
            class FakeAgent:
                _call_sessions = {}
                async def call(self, number, **kwargs):
                    calls.append(number)
                    assert number == '+820000000001'
                    call = FakeCall('outbound-' + scenario, 'outbound')
                    await runtime.bind(call)
                    await runtime.started(call)
                    return call
            runtime.agent = FakeAgent()
            citizen = FakeCall('inbound-' + scenario, 'inbound')
            ctx = await runtime.bind(citizen)
            server.call('run', {'callId': citizen.call_id}, expected=409)
            assert not calls
            ctx['_heard'] = '식사 두 개가 필요해요. 배달로 부탁드리고 말씀드린 범위의 문의와 신청, 결과 회신에 동의합니다.'
            patch = {'item': '식사', 'quantity': 2, 'region': '서초구',
                     'neededBy': (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
                     'maxCostKrw': 0, 'dietaryRestrictions': [], 'alternatives': ['빵'],
                     'receivingMethod': 'delivery', 'noMatchPreference': 'offer_callback',
                     'consent': {'contact': True, 'submit': True, 'callback': True}}
            tools = {tool.__name__: tool for tool in runtime.tools(ctx)}
            await tools['update_demo_request'](json.dumps(patch), ctx['_heard'])
            prepared = json.loads(await tools['prepare_demo_approval']())
            assert 'readback' in prepared and prepared['seedHash']
            await runtime.dtmf(citizen, '1')
            assert server.call('status?callId=' + citizen.call_id)['approved'] is True
            await runtime.ended(citizen)
            await runtime.dispatch(citizen.call_id)
            status = server.call('status?callId=' + citizen.call_id)
            assert status['callbackStatus'] == 'DELIVERED', status
            assert calls == ['+820000000001'], calls
            receipt = journal.get('demo:receipt:outbound-' + scenario)
            assert receipt['answered'] and receipt['acknowledged'] and receipt['completed']
            assert receipt['events'], receipt
            await runtime.dispatch(citizen.call_id)
            assert len(calls) == 1
        server.stop()
        server = LocalServer(ledger, scenario).start()
        restored = server.call('status?callId=' + citizen.call_id)
        assert restored['callbackStatus'] == 'DELIVERED'
        assert restored['seedHash'] == prepared['seedHash']
        import sqlite3
        with sqlite3.connect(ledger) as connection:
            saved = json.loads(connection.execute('SELECT body FROM phone_demo_workflows WHERE call_id=?', (citizen.call_id,)).fetchone()[0])
        if scenario == 'unavailable':
            assert saved['reservation']['status'] == 'SCHEDULED'
            assert saved['ev1']['reasons'] == ['NO_MATCH']
        else:
            assert saved['receipt']['proof']['mode'] == 'SIMULATION'
            assert saved['ev1']['pass'] and saved['ev2']['pass']
        return {'scenario': scenario, 'passed': True, 'fakeCustomerCalls': len(calls),
                'realCalls': 0, 'restartedCallbackStatus': restored['callbackStatus'],
                'reservation': saved.get('reservation', {}).get('status'), 'seedHash': prepared['seedHash']}
    finally:
        journal.close()
        server.stop()

async def main():
    import asyncio
    with tempfile.TemporaryDirectory(prefix='malgyeol-independent-http-') as directory:
        results = []
        for scenario in ['success', 'unavailable']:
            results.append(await proof_scenario(Path(directory), scenario))
        print(json.dumps({'localOnly': True, 'realTelephoneActions': 0, 'results': results}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    import asyncio
    asyncio.run(main())
