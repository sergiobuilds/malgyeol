import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from coordination_tools import Journal, Routing, ToolError
from demo_voice import DemoVoiceRuntime, make_demo_agent_class, OUTBOUND_DEMO


class API:
    def __init__(self): self.calls = []
    async def send(self, method, path, body=None):
        self.calls.append((method, path, body))
        if path.endswith('/begin'): return {'serverNow': '2026-09-18T01:00:00Z', 'timezone': 'Asia/Seoul'}
        if path.endswith('/seed'): return {'seedHash': 'hash', 'nonce': 'nonce', 'expiresAt': 9999999999, 'readback': '쌀 한 개. 승인1 수정2'}
        if path.endswith('/approve'): return {'approved': body['digit'] == '1', 'message': '승인 기록'}
        if path.endswith('/callback/claim'): return {'job': {'id': 'job', 'callId': body['callId'], 'citizenRef': 'citizen-A', 'message': '[시연] 식사 지원이 확정되었습니다.', 'mode': 'SIMULATION'}}
        return {'message': '기록했습니다.'}


def call(id='incoming', number='+821000000001', direction='inbound'):
    return types.SimpleNamespace(call_id=id, from_number=number, direction=direction, ended_status='completed',
                                 _passive_dtmf_buffer=[], _passive_dtmf_task=None)


class DemoTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.journal = Journal(Path(self.tmp.name) / 'voice.sqlite')
        self.api = API()
        self.routing = Routing({'allowedNumbers': ['+821000000001', '+821000000002'], 'citizenNumbers': {'citizen-A': '+821000000001'}, 'institutionNumbers': {'institution-B': '+821000000002'}})
        self.runtime = DemoVoiceRuntime(self.api, self.journal, self.routing)
        self.runtime.agent = types.SimpleNamespace(_call_sessions={})

    async def asyncTearDown(self):
        self.journal.close(); self.tmp.cleanup()

    async def test_routing_is_preserved_and_no_institution_tools_exist(self):
        with self.assertRaises(ToolError): await self.runtime.bind(call(number='+821000000099'))
        with self.assertRaises(ToolError): await self.runtime.bind(call(direction='outbound'))
        self.assertEqual(self.api.calls, [])
        ctx = await self.runtime.bind(call())
        self.assertEqual([f.__name__ for f in self.runtime.tools(ctx)], ['update_demo_request', 'prepare_demo_approval', 'get_demo_status', 'finish_demo_conversation'])

    async def test_explicit_digit_approval_and_mutation_invalidates_local_challenge(self):
        c = call(); ctx = await self.runtime.bind(c); ctx['_heard'] = '쌀 한 개가 필요합니다'
        update, prepare, _, finish = self.runtime.tools(ctx)
        with self.assertRaises(ToolError): await finish()
        await update('{"item":"쌀","quantity":1}', '쌀 한 개가 필요합니다')
        self.assertEqual(self.api.calls[-1][2]['callId'], 'incoming')
        await prepare()
        self.assertFalse(any(p.endswith('/approve') for _, p, _ in self.api.calls))
        await self.runtime.dtmf(c, '1')
        self.assertEqual(self.journal.get('demo:approved:incoming')['citizenRef'], 'citizen-A')
        await finish()
        await update('{"quantity":2}', '쌀 한 개가 필요합니다')
        with self.assertRaises(ToolError): await finish()
        self.assertEqual(self.journal.get('demo:finish:incoming'), {})
        self.assertEqual(self.journal.get('demo:approved:incoming'), {})
        count = len(self.api.calls)
        await self.runtime.dtmf(c, '1')
        self.assertEqual(len(self.api.calls), count)

    async def test_digit_two_returns_to_edit_and_requires_fresh_approval(self):
        c = call(); ctx = await self.runtime.bind(c); ctx['_heard'] = '두 개로 바꿔 주세요'
        update, prepare, _, finish = self.runtime.tools(ctx)
        await prepare()
        await self.runtime.dtmf(c, '2')
        self.assertEqual(self.journal.get('demo:approved:incoming'), {})
        with self.assertRaises(ToolError): await finish()
        await update('{"quantity":2}', '두 개로 바꿔 주세요')
        await prepare()
        await self.runtime.dtmf(c, '1')
        await finish()
        self.assertTrue(self.journal.get('demo:finish:incoming')['ready'])

    async def test_spurious_quote_is_rejected_before_api(self):
        ctx = await self.runtime.bind(call()); ctx['_heard'] = '쌀이요'
        update = self.runtime.tools(ctx)[0]
        count = len(self.api.calls)
        with self.assertRaises(ToolError): await update('{"item":"쌀"}', '전부 동의합니다')
        self.assertEqual(len(self.api.calls), count)

    async def test_same_agent_customer_callback_and_receipt_no_institution_call(self):
        incoming = call(); ctx = await self.runtime.bind(incoming)
        await self.runtime.tools(ctx)[1]()
        await self.runtime.dtmf(incoming, '1')
        await self.runtime.ended(incoming)
        self.assertEqual(self.journal.get('demo:pending:incoming')['status'], 'pending')
        runtime = self.runtime
        destinations = []
        class FakeAgent:
            _call_sessions = {}
            async def call(self, number, **options):
                destinations.append(number)
                c = call(id='outgoing', direction='outbound')
                bound = await runtime.bind(c)
                assert bound['role'] == 'demo_callback'
                assert [f.__name__ for f in runtime.tools(bound)] == ['finish_demo_conversation']
                await runtime.started(c)
                await runtime.transcript(c, 'assistant', bound['job']['message'])
                await runtime.dtmf(c, '1')
                async def wait(): await runtime.ended(c)
                c.wait = wait
                return c
        runtime.agent = FakeAgent()
        await runtime.dispatch('incoming')
        self.assertEqual(destinations, ['+821000000001'])
        receipts = [b for _, p, b in self.api.calls if p.endswith('/callback/receipt')]
        self.assertEqual(len(receipts), 1)
        self.assertTrue(receipts[0]['answered'] and receipts[0]['completed'] and receipts[0]['acknowledged'])
        self.assertTrue(self.journal.get(receipts[0]['receiptRef'])['events'])

    async def test_actual_sdk_role_bound_session_creation_zero_network(self):
        try:
            from clawops.agent import ClawOpsAgent, GeminiRealtime
            from clawops.agent._session import CallSession
            from clawops.agent._tool import ToolRegistry
        except ImportError: self.skipTest('Pinned phone SDK environment required')
        with patch.dict(os.environ, {'GEMINI_LIVE_MODEL': 'gemini-live-2.5-flash-native-audio', 'GOOGLE_API_KEY': 'test-not-real'}):
            Agent = make_demo_agent_class(ClawOpsAgent, GeminiRealtime, ToolRegistry)
            agent = Agent(self.runtime, api_key='test', account_id='test', from_='+8200000000')
            self.runtime.agent = agent
            c = CallSession(call_id='sdk-call', from_number='+821000000001', to_number='+8200000000', account_id='test')
            agent._active_sessions[c.call_id] = c
            session = await agent._open_session(c.call_id)
            self.assertEqual(session.context['callId'], 'sdk-call')
            session.context['_heard'] = '쌀 한 개'
            result = await session.bound_registry.call('update_demo_request', {'patch_json': '{"item":"쌀"}', 'evidence_quote': '쌀 한 개'})
            self.assertIn('기록', result)
            self.assertEqual(self.api.calls[-1][2]['callId'], 'sdk-call')
            # A completed model turn is necessary; local finish alone does not hang up.
            c.hangup = AsyncMock()
            await session.attach(c)
            await session.bound_registry.call('prepare_demo_approval', {})
            await self.runtime.dtmf(c, '1')
            await session.bound_registry.call('finish_demo_conversation', {})
            c.hangup.assert_not_awaited()
            with patch.object(GeminiRealtime, '_handle_response', new=AsyncMock()), patch('demo_voice.asyncio.sleep', new=AsyncMock()) as delay:
                await session._handle_response(types.SimpleNamespace(server_content=types.SimpleNamespace(turn_complete=False)))
                c.hangup.assert_not_awaited()
                await session._handle_response(types.SimpleNamespace(server_content=types.SimpleNamespace(turn_complete=True)))
                await asyncio.sleep(0)
                # asyncio.sleep is patched; yield using a future instead.
                loop = asyncio.get_running_loop(); yielded = loop.create_future()
                loop.call_soon(yielded.set_result, None); await yielded
                c.hangup.assert_awaited_once()
                self.assertTrue(any(args.args == (2,) for args in delay.await_args_list))
            # No connect, start, serve or call transport method was invoked.
