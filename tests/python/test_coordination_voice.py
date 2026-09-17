import asyncio
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from coordination_voice import build_prompt, institutional_context, completion_status, VoiceRuntime
from coordination_tools import Journal, Routing

class VoiceTests(unittest.IsolatedAsyncioTestCase):
    def test_institution_context_only_consented_fields(self):
        request={'summary':'private','district':'강남구','constraints':['private'],'needs':[{'id':'n','description':'식사','status':'open'}],'consent':{'sharedFields':['district'],'allowCoordination':False}}
        c=institutional_context(request,{'needId':'n','programId':'care-sos','questions':['절차'],'institutionId':'i','contactPurpose':'신청'})
        self.assertNotIn('private',str(c));self.assertNotIn('needs',c);self.assertFalse(c['allowCoordination'])
    def test_roles_have_distinct_first_greetings(self):
        self.assertNotEqual(build_prompt({'role':'citizen'}),build_prompt({'role':'institution','disclosure':{}}))
        self.assertIn('기관',build_prompt({'role':'institution','disclosure':{}}))
    def test_completed_is_not_assumed_for_unknown_provider_status(self):
        self.assertEqual(completion_status(None),'unknown');self.assertEqual(completion_status('busy'),'no-answer')
    async def test_draft_answer_applied_only_after_completed_attempt(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite');calls=[]
            class API:
                async def send(self,method,path,body=None):calls.append((path,body));return {'request':{}}
            rt=VoiceRuntime(API(),journal,Routing({'allowedNumbers':[],'citizenNumbers':{},'institutionNumbers':{}}))
            ctx={'role':'institution','requestId':'r','inquiryId':'q','attemptId':'a','callId':'b'}
            journal.put('answer:b',{'outcome':'available','summary':'가능','conditions':[],'nextAction':'신청','requiresChoice':False})
            await rt.finalize(ctx,'completed')
            self.assertTrue(calls[0][0].endswith('/attempts/a/result'));self.assertTrue(calls[1][0].endswith('/inquiries/q/answer'))
            await rt.finalize(ctx,'completed');self.assertEqual(len(calls),2)
            journal.close()
    async def test_failed_call_does_not_apply_answer(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite');calls=[]
            class API:
                async def send(self,method,path,body=None):calls.append(path);return {'request':{}}
            rt=VoiceRuntime(API(),journal,Routing({'allowedNumbers':[],'citizenNumbers':{},'institutionNumbers':{}}))
            ctx={'role':'institution','requestId':'r','inquiryId':'q','attemptId':'a','callId':'b'}
            journal.put('answer:b',{'outcome':'available'})
            await rt.finalize(ctx,'no-answer');self.assertEqual(len(calls),1)
            journal.close()

class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_role_and_tools_bound_before_prewarm_in_real_sdk(self):
        try:
            from clawops.agent import ClawOpsAgent, GeminiRealtime
            from clawops.agent._tool import ToolRegistry
            from clawops.agent._session import CallSession
        except ImportError:self.skipTest('Run with the installed ClawOps environment for SDK contract verification')
        from coordination_voice import make_agent_class, OUTBOUND
        import os
        os.environ['GEMINI_LIVE_MODEL']='test-model'
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite')
            rt=VoiceRuntime(None,journal,Routing({'allowedNumbers':[],'citizenNumbers':{},'institutionNumbers':{}}))
            cls=make_agent_class(ClawOpsAgent,GeminiRealtime,ToolRegistry)
            agent=cls(rt,api_key='not-a-real-key',account_id='test-account',from_='test-number')
            agent._active_sessions['x']=CallSession(call_id='x',from_number='test-number',to_number='test-target',account_id='test-account',direction='outbound')
            tok=OUTBOUND.set({'role':'institution','requestId':'r','inquiryId':'q','attemptId':'a','disclosure':{}})
            try:
                from unittest.mock import patch
                with patch('google.genai.Client'):
                    session=await agent._open_session('x')
                agent._inject_session_deps(session,ToolRegistry())
                names=[t['name'] for t in session._tools.to_openai_tools()]
                self.assertIn('record_answer',names);self.assertNotIn('create_request',names)
                self.assertEqual(session.context['role'],'institution')
                self.assertEqual(session._builtin_tools,set())
                self.assertEqual(session._tools.to_openai_tools()[0]['parameters']['properties']['summary']['type'],'string')
                from types import SimpleNamespace
                async def observe_response(response):
                    self.assertEqual(session.context['_heard'],'네 동의합니다')
                with patch.object(GeminiRealtime,'_handle_response',side_effect=observe_response):
                    await session._handle_response(SimpleNamespace(server_content=SimpleNamespace(input_transcription=SimpleNamespace(text='네 동의합니다'),turn_complete=False)))
            finally:OUTBOUND.reset(tok);journal.close()
