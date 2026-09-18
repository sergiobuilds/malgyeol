"""A lost HTTP response must not strand a completed institution conversation."""
import copy
import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from coordination_tools import Journal, Routing, ToolError
from coordination_voice import VoiceRuntime


class FinalizationAPI:
    def __init__(self, failure):
        self.failure = failure
        self.failed = False
        self.answer_writes = 0
        self.request = {
            'id': 'r', 'citizenRef': 'c',
            'attempts': [{'id': 'a', 'inquiryId': 'q', 'status': 'started',
                          'idempotencyKey': 'dispatch:q:0'}],
            'inquiries': [{'id': 'q', 'status': 'calling'}],
        }

    async def send(self, method, path, body=None):
        if method == 'GET':
            return {'requests': [copy.deepcopy(self.request)],
                    'request': copy.deepcopy(self.request)}
        attempt = self.request['attempts'][0]
        inquiry = self.request['inquiries'][0]
        if path.endswith('/result'):
            if attempt['status'] != 'started':
                if attempt['status'] != body['status'] or attempt.get('providerCallId') != body.get('providerCallId'):
                    raise ToolError('ATTEMPT_FINAL')
            else:
                attempt.update(body)
                inquiry['status'] = 'calling' if body['status'] == 'completed' else body['status']
            if self.failure == 'result-response' and not self.failed:
                self.failed = True
                raise ToolError('TRANSPORT_UNKNOWN')
        elif path.endswith('/answer'):
            if self.failure == 'answer-before' and not self.failed:
                self.failed = True
                raise ToolError('TRANSPORT_UNKNOWN')
            if attempt['status'] != 'completed':
                raise ToolError('CALL_NOT_COMPLETED')
            if 'answer' not in inquiry:
                self.answer_writes += 1
                inquiry['answer'] = copy.deepcopy(body)
                inquiry['status'] = 'answered'
            elif inquiry['answer'] != body:
                raise ToolError('ANSWER_FINAL')
            if self.failure == 'answer-response' and not self.failed:
                self.failed = True
                raise ToolError('TRANSPORT_UNKNOWN')
        else:
            raise AssertionError(path)
        return {'request': copy.deepcopy(self.request)}


class FinalizationRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_conflicting_or_transient_finalization_does_not_starve_other_work(self):
        from unittest.mock import AsyncMock
        for code in ['HTTP_409', 'TRANSPORT_UNKNOWN']:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as directory:
                class API(FinalizationAPI):
                    async def send(self, method, path, body=None):
                        if path.endswith('/answer'):
                            raise ToolError('private provider details', code=code)
                        return await super().send(method, path, body)
                journal = Journal(Path(directory) / 'voice.sqlite')
                api = API(None)
                runtime = VoiceRuntime(api, journal, Routing({'allowedNumbers': [], 'citizenNumbers': {}, 'institutionNumbers': {}}))
                ctx = {'role': 'institution', 'callId': 'b', 'requestId': 'r', 'inquiryId': 'q', 'attemptId': 'a'}
                journal.put('call:b', ctx)
                journal.put('call:intake', {'role': 'citizen', 'callId': 'intake', 'requestId': 'r', 'citizenRef': 'c'})
                journal.put('answer:b', {'outcome': 'available', 'summary': 'recorded answer'})
                journal.put('final:b', {'status': 'completed', 'state': 'needs-reconciliation'})
                try:
                    with self.assertLogs('coordination', level='WARNING') as logs:
                        await runtime.recover()
                    self.assertNotIn('private provider details', str(logs.output))
                    expected = 'manual-reconciliation' if code == 'HTTP_409' else 'needs-reconciliation'
                    self.assertEqual(journal.get('final:b')['state'], expected)
                    runtime.dispatch_request = AsyncMock(side_effect=asyncio.CancelledError)
                    runtime.wake.set()
                    with self.assertRaises(asyncio.CancelledError):
                        await runtime.worker()
                    runtime.dispatch_request.assert_awaited_once()
                finally:
                    journal.close()

    async def test_callback_http_failure_reconciles_once_without_repeating_phone_call(self):
        from unittest.mock import AsyncMock
        for failure in ['before', 'response']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                class API:
                    failed = False
                    callbacks = []
                    async def send(self, method, path, body=None):
                        if method == 'GET':return {'requests': []}
                        if failure == 'before' and not self.failed:
                            self.failed = True
                            raise ToolError('TRANSPORT_UNKNOWN')
                        key = body.get('idempotencyKey')
                        if not key or not any(item.get('idempotencyKey') == key for item in self.callbacks):
                            self.callbacks.append(copy.deepcopy(body))
                        if failure == 'response' and not self.failed:
                            self.failed = True
                            raise ToolError('TRANSPORT_UNKNOWN')
                        return {'request': {}}
                journal = Journal(Path(directory) / 'voice.sqlite')
                api = API()
                runtime = VoiceRuntime(api, journal, Routing({'allowedNumbers': [], 'citizenNumbers': {}, 'institutionNumbers': {}}))
                context = {'role': 'callback', 'callId': 'cb', 'requestId': 'r', 'citizenRef': 'c'}
                journal.put('call:cb', context)
                journal.put('recipient:cb', {'status': 'confirmed', 'requestId': 'r'})
                journal.put('finish:cb', {'summary': '45분 뒤 무료 전달 조건 안내'})
                runtime.dial = AsyncMock()
                try:
                    with self.assertRaises(ToolError):await runtime.finalize(context, 'completed')
                    await runtime.recover()
                    await runtime.recover()
                    self.assertEqual(len(api.callbacks), 1)
                    self.assertEqual(api.callbacks[0]['status'], 'completed')
                    self.assertTrue(api.callbacks[0].get('idempotencyKey'))
                    self.assertEqual(journal.get('final:cb')['state'], 'applied')
                    runtime.dial.assert_not_awaited()
                finally:
                    journal.close()

    async def test_legacy_callback_without_idempotency_evidence_is_not_replayed(self):
        from unittest.mock import AsyncMock
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(Path(directory) / 'voice.sqlite')
            api = AsyncMock()
            api.send.return_value = {'requests': []}
            runtime = VoiceRuntime(api, journal, Routing({'allowedNumbers': [], 'citizenNumbers': {}, 'institutionNumbers': {}}))
            journal.put('call:cb', {'role': 'callback', 'callId': 'cb', 'requestId': 'r'})
            journal.put('final:cb', {'status': 'completed', 'state': 'needs-reconciliation'})
            try:
                await runtime.recover()
                self.assertTrue(all(call.args[0] == 'GET' for call in api.send.await_args_list))
                self.assertEqual(journal.get('final:cb')['state'], 'needs-reconciliation')
            finally:
                journal.close()

    async def test_idle_worker_reconciles_before_followup_without_redial(self):
        from unittest.mock import AsyncMock
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(Path(directory) / 'voice.sqlite')
            api = FinalizationAPI(None)
            routing = Routing({'allowedNumbers': [], 'citizenNumbers': {}, 'institutionNumbers': {}})
            context = {'role': 'institution', 'requestId': 'r', 'inquiryId': 'q',
                       'attemptId': 'a', 'callId': 'b'}
            journal.put('call:b', context)
            journal.put('call:intake', {'role': 'citizen', 'requestId': 'r', 'callId': 'intake'})
            journal.put('answer:b', {'outcome': 'available', 'summary': '식사 가능'})
            journal.put('final:b', {'status': 'completed', 'state': 'needs-reconciliation'})
            runtime = VoiceRuntime(api, journal, routing)
            runtime.dial = AsyncMock()
            runtime.dispatch_request = AsyncMock(side_effect=asyncio.CancelledError)
            runtime.wake.set()
            try:
                with self.assertRaises(asyncio.CancelledError):
                    await runtime.worker()
                self.assertEqual(api.request['inquiries'][0]['status'], 'answered')
                self.assertEqual(journal.get('final:b')['state'], 'applied')
                runtime.dial.assert_not_awaited()
            finally:
                journal.close()

    async def test_completed_institution_answer_recovers_after_http_failure(self):
        for failure in ['result-response', 'answer-before', 'answer-response']:
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                journal = Journal(Path(directory) / 'voice.sqlite')
                api = FinalizationAPI(failure)
                routing = Routing({'allowedNumbers': [], 'citizenNumbers': {}, 'institutionNumbers': {}})
                runtime = VoiceRuntime(api, journal, routing)
                context = {'role': 'institution', 'requestId': 'r', 'inquiryId': 'q',
                           'attemptId': 'a', 'callId': 'b'}
                answer = {'outcome': 'available', 'summary': '식사 1개, 45분 뒤 무료 전달 가능',
                          'conditions': ['45분', '무료'], 'nextAction': '시민 선택 확인',
                          'requiresChoice': True}
                journal.put('call:b', context)
                journal.put('answer:b', answer)
                journal.put('dispatch:q:0', {'state': 'dispatching'})
                try:
                    with self.assertRaises(ToolError):
                        await runtime.finalize(context, 'completed')
                    self.assertEqual(journal.get('final:b')['state'], 'needs-reconciliation')
                    restored = VoiceRuntime(api, journal, routing)
                    await restored.recover()
                    self.assertEqual(api.request['inquiries'][0].get('answer'), answer)
                    self.assertEqual(journal.get('final:b')['state'], 'applied')
                    await restored.recover()
                    self.assertEqual(api.answer_writes, 1)
                    self.assertEqual(api.request['attempts'][0]['status'], 'completed')
                finally:
                    journal.close()

    async def test_crash_after_final_claim_replays_recorded_completion_not_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(Path(directory) / 'voice.sqlite')
            api = FinalizationAPI(None)
            routing = Routing({'allowedNumbers': [], 'citizenNumbers': {}, 'institutionNumbers': {}})
            context = {'role': 'institution', 'requestId': 'r', 'inquiryId': 'q',
                       'attemptId': 'a', 'callId': 'b'}
            journal.put('call:b', context)
            journal.put('answer:b', {'outcome': 'available', 'summary': '식사 가능'})
            journal.put('dispatch:q:0', {'state': 'dispatching'})
            journal.put('final:b', {'status': 'completed', 'state': 'applying'})
            try:
                await VoiceRuntime(api, journal, routing).recover()
                self.assertEqual(api.request['attempts'][0]['status'], 'completed')
                self.assertEqual(api.request['inquiries'][0]['status'], 'answered')
                self.assertEqual(journal.get('final:b')['state'], 'applied')
            finally:
                journal.close()
