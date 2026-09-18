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
    def __init__(self, ledger: Path, scenario="success", extra_env=None):
        self.ledger = ledger
        self.scenario = scenario
        self.extra_env = dict(extra_env or {})
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
        env.update(self.extra_env)
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

async def proof_scenario(directory: Path, scenario: str, experience="standard"):
    from unittest.mock import patch as patch_env
    import asyncio
    from datetime import datetime, timedelta, timezone
    import aiohttp
    from coordination_tools import Journal, Routing
    from coordination_voice import HttpAPI
    from demo_voice import DemoVoiceRuntime
    identity = experience + '-' + scenario
    ledger = directory / (identity + '.sqlite')
    server = LocalServer(ledger, scenario).start()
    journal = Journal(directory / (identity + '-voice.sqlite'))
    calls = []
    try:
        server.call('begin', {'callId': 'unauthorized', 'citizenRef': 'test-citizen'}, expected=403, authorized=False)
        async with aiohttp.ClientSession(headers={'Authorization': 'Bearer ' + TOKEN}) as session:
            with patch_env.dict(os.environ, {'COORDINATION_DEMO_EXPERIENCE': experience, 'COORDINATION_DEMO_ALLOW_AUDIENCE': '1'}):
                runtime = DemoVoiceRuntime(HttpAPI(session, server.base), journal, Routing({
                    'allowedNumbers': [] if experience == 'audience' else ['+820000000001'],
                    'citizenNumbers': {} if experience == 'audience' else {'test-citizen': '+820000000001'},
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
                    from coordination_tools import ToolError
                    callback_ctx = journal.get('demo:call:' + self.call_id)
                    finish = runtime.tools(callback_ctx)[0]
                    try:
                        await finish()
                        raise AssertionError('callback must not finish before actual digit ack')
                    except ToolError:
                        pass
                    await runtime.dtmf(self, '1')
                    await finish()
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
            ctx['_heard'] = '식사 한 개가 필요해요. 배달로 부탁드리고 말씀드린 범위의 문의와 신청, 결과 회신에 동의합니다.'
            patch = {'item': '한 끼 식사', 'quantity': 1, 'region': '서초구',
                     'neededBy': (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
                     'maxCostKrw': 0, 'dietaryRestrictions': [], 'alternatives': ['빵'],
                     'receivingMethod': 'delivery', 'noMatchPreference': 'offer_callback',
                     'consent': {'contact': True, 'submit': True, 'callback': True}}
            initial = server.call('status?callId=' + citizen.call_id)
            assert initial['requirements'] == {} and initial['approved'] is False
            if experience == 'audience':
                patch.pop('consent')
            tools = {tool.__name__: tool for tool in runtime.tools(ctx)}
            await tools['update_demo_request'](json.dumps(patch), ctx['_heard'])
            prepared = json.loads(await tools['prepare_demo_approval']())
            assert 'readback' in prepared and prepared['seedHash']
            await runtime.transcript(citizen, 'user', '네')
            assert server.call('status?callId=' + citizen.call_id)['approved'] is False
            if experience == 'audience':
                old_hash = prepared['seedHash']
                await runtime.dtmf(citizen, '2')
                assert server.call('status?callId=' + citizen.call_id)['approved'] is False
                ctx['_heard'] = '기한을 다섯 시간 뒤까지로 고쳐 주세요'
                await tools['update_demo_request'](json.dumps({'neededBy': (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()}), ctx['_heard'])
                prepared = json.loads(await tools['prepare_demo_approval']())
                assert prepared['seedHash'] != old_hash
            await runtime.dtmf(citizen, '1')
            assert server.call('status?callId=' + citizen.call_id)['approved'] is True
            if experience == 'audience':
                worker = asyncio.create_task(runtime.worker())
                try:
                    await runtime.ended(citizen)
                    deadline = asyncio.get_running_loop().time() + 3
                    while asyncio.get_running_loop().time() < deadline:
                        status = server.call('status?callId=' + citizen.call_id)
                        if status.get('callbackStatus') == 'DELIVERED':
                            break
                        await asyncio.sleep(0.01)
                finally:
                    worker.cancel()
                    await asyncio.gather(worker, return_exceptions=True)
            else:
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
            if experience == 'standard':
                assert saved['reservation']['status'] == 'SCHEDULED'
            else:
                assert saved.get('reservation') is None
            assert saved['ev1']['reasons'] == ['NO_MATCH']
        else:
            assert saved['receipt']['proof']['mode'] == 'SIMULATION'
            assert saved['ev1']['pass'] and saved['ev2']['pass']
        latency = journal.get('demo:callback-latency:' + citizen.call_id)
        assert latency and latency['seconds'] < 3, latency
        return {'experience': experience, 'scenario': scenario, 'passed': True,
                'fakeEndToDialSeconds': latency['seconds'], 'pstnRingVerified': False, 'runtimeWorkerExercised': experience == 'audience', 'fakeCustomerCalls': len(calls),
                'realCalls': 0, 'restartedCallbackStatus': restored['callbackStatus'],
                'reservation': saved.get('reservation', {}).get('status'), 'seedHash': prepared['seedHash']}
    finally:
        journal.close()
        server.stop()

async def main():
    import asyncio
    with tempfile.TemporaryDirectory(prefix='malgyeol-independent-http-') as directory:
        results = []
        for experience in ['standard', 'audience']:
            for scenario in ['success', 'unavailable']:
                results.append(await proof_scenario(Path(directory), scenario, experience))
        print(json.dumps({'localOnly': True, 'realTelephoneActions': 0, 'results': results}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    import asyncio
    asyncio.run(main())
