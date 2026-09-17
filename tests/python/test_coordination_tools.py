import asyncio
import importlib.util
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from coordination_tools import Routing, Journal, VoiceTools, ToolError

class FakeAPI:
    def __init__(self): self.calls=[]; self.request={'id':'r','citizenRef':'c','summary':'식사','district':'강남구','needs':[{'id':'n','description':'식사','constraints':[],'status':'open'}], 'constraints':[], 'inquiries':[], 'revision':1}
    async def send(self,method,path,body=None):
        self.calls.append((method,path,body))
        if 'institutions' in path: return {'institutions':[{'id':'i','name':'기관','programs':[{'programId':'care-sos'}],'contacts':[{'purpose':'신청','phone':'secret'}]}]}
        if path.endswith('/inquiries'): return {'inquiry':{'id':'q',**body}}
        return {'request':self.request}

class ToolsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.j=Journal(Path(self.tmp.name)/'state.sqlite'); self.api=FakeAPI()
        self.tools=VoiceTools(self.api,self.j,{'role':'citizen','citizenRef':'c','requestId':'r','callId':'call'})
    async def asyncTearDown(self): self.j.close();self.tmp.cleanup()
    async def test_role_blocks_answer(self):
        with self.assertRaises(ToolError): await self.tools.record_answer('{"outcome":"available"}')
        self.assertEqual(self.api.calls,[])
    async def test_unknown_institution_cannot_prepare(self):
        with self.assertRaises(ToolError): await self.tools.prepare_inquiry(0,'invented','care-sos','신청','["절차"]')
    async def test_search_removes_phones_and_binds_selection(self):
        result=await self.tools.search_institutions('care-sos','강남구','')
        self.assertNotIn('secret',result)
        await self.tools.prepare_inquiry(0,'i','care-sos','신청','["절차"]')
        self.assertTrue(self.api.calls[-1][1].endswith('/inquiries'))
    async def test_consent_requires_explicit_spoken_evidence(self):
        with self.assertRaises(ToolError): await self.tools.record_consent('{"purpose":"문의","institutionIds":["i"],"sharedFields":["needs"],"allowCoordination":true,"utterance":""}')
    async def test_answer_is_durable_draft_not_sent_before_call_end(self):
        tools=VoiceTools(self.api,self.j,{'role':'institution','requestId':'r','callId':'b','inquiryId':'q'})
        await tools.record_answer('{"outcome":"available","summary":"접수 가능","conditions":[],"nextAction":"상담","requiresChoice":false}')
        self.assertEqual(self.api.calls,[])
        self.assertEqual(self.j.get('answer:b')['summary'],'접수 가능')
    async def test_journal_claim_is_persistent_and_unique(self):
        self.assertTrue(self.j.claim('attempt:q',{'state':'dispatching'}))
        self.assertFalse(self.j.claim('attempt:q',{'state':'dispatching'}))
        other=Journal(self.j.path);self.assertFalse(other.claim('attempt:q',{}));other.close()
    async def test_routing_rejects_unlisted_destination(self):
        with self.assertRaises(ToolError): Routing({'allowedNumbers':['+820000000001'],'citizenNumbers':{'c':'+820000000002'},'institutionNumbers':{}})

    async def test_consent_rejects_model_invented_quote(self):
        self.tools.context['_heard']='식사가 필요해요'
        with self.assertRaises(ToolError):
            await self.tools.record_consent('{"purpose":"문의","institutionIds":["i"],"sharedFields":["needs"],"allowCoordination":true,"utterance":"동의합니다"}')
    async def test_consent_rejects_explicit_negative_even_when_heard(self):
        self.tools.context['_heard']='동의 안 합니다'
        with self.assertRaises(ToolError):
            await self.tools.record_consent('{"purpose":"문의","institutionIds":["i"],"sharedFields":["needs"],"allowCoordination":true,"utterance":"동의 안 합니다"}')
    async def test_consent_saves_actual_spoken_quote(self):
        self.tools.context['_heard']='네 동의합니다'
        self.tools.catalog['i']={}
        await self.tools.record_consent('{"purpose":"문의","institutionIds":["i"],"sharedFields":["needs"],"allowCoordination":true,"utterance":"네 동의합니다"}')
        self.assertEqual(self.j.get('consent:call')['utterance'],'네 동의합니다')

    async def test_callback_cannot_read_choose_or_finish_before_recipient_confirmation(self):
        tools=VoiceTools(self.api,self.j,{'role':'callback','requestId':'r','citizenRef':'c','callId':'cb'})
        for action in [lambda:tools.current(),lambda:tools.record_choice(0,'금요일'),lambda:tools.finish_conversation('안내 완료'),lambda:tools.revise_request('{"summary":"변경"}')]:
            with self.assertRaises(ToolError):await action()
        self.assertEqual(self.api.calls,[])
        self.assertIsNone(self.j.get('finish:cb'))
    async def test_callback_confirmation_requires_real_whole_utterance(self):
        ctx={'role':'callback','requestId':'r','citizenRef':'c','callId':'cb','_heard':'아니요 저는 다른 사람입니다'}
        tools=VoiceTools(self.api,self.j,ctx)
        with self.assertRaises(ToolError):await tools.confirm_recipient('self','제가 요청한 본인입니다')
        with self.assertRaises(ToolError):await tools.confirm_recipient('self',ctx['_heard'])
        self.assertEqual(self.api.calls,[])
    async def test_callback_verified_self_can_receive_request(self):
        ctx={'role':'callback','requestId':'r','citizenRef':'c','callId':'cb','_heard':'네 제가 요청한 본인입니다'}
        tools=VoiceTools(self.api,self.j,ctx)
        result=await tools.confirm_recipient('self',ctx['_heard'])
        self.assertIn('식사',result)
        await tools.finish_conversation('결과 안내')
        self.assertEqual(self.j.get('recipient:cb')['status'],'confirmed')
        self.assertIsNone(self.j.get('recipient:different-call'))
    async def test_machine_or_unapproved_delegate_never_receives_request(self):
        for role,heard in [('machine','소리샘입니다 음성을 남겨 주세요'),('delegate','제가 가족입니다 대신 받을게요')]:
            ctx={'role':'callback','requestId':'r','citizenRef':'c','callId':'cb','_heard':heard}
            tools=VoiceTools(self.api,self.j,ctx)
            with self.assertRaises(ToolError):await tools.confirm_recipient(role,heard)
        self.assertEqual(self.api.calls,[])
    async def test_unverified_recipient_can_end_without_success_summary(self):
        tools=VoiceTools(self.api,self.j,{'role':'callback','requestId':'r','citizenRef':'c','callId':'cb'})
        await tools.end_without_disclosure()
        self.assertIsNone(self.j.get('finish:cb'))
        self.assertTrue(self.j.get('end:cb'))

    async def test_callback_rejects_denial_of_previous_call(self):
        ctx={'role':'callback','requestId':'r','citizenRef':'c','callId':'cb','_heard':'제가 전화 안 했는데요'}
        tools=VoiceTools(self.api,self.j,ctx)
        with self.assertRaises(ToolError):await tools.confirm_recipient('self',ctx['_heard'])
        self.assertEqual(self.api.calls,[])

    async def test_callback_rejects_denial_of_previous_request(self):
        ctx={'role':'callback','requestId':'r','citizenRef':'c','callId':'cb','_heard':'제가 요청한 적 없어요'}
        tools=VoiceTools(self.api,self.j,ctx)
        with self.assertRaises(ToolError):await tools.confirm_recipient('self',ctx['_heard'])
        self.assertEqual(self.api.calls,[])
