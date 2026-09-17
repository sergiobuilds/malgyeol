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
