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
    async def test_intake_requires_current_inquiry_for_each_active_need(self):
        api=FakeAPI()
        api.request['needs'] += [
            {'id':'n2','description':'비누','status':'open','constraints':[]},
            {'id':'n3','description':'취소된 요청','status':'stopped','constraints':[]}]
        api.request['inquiries']=[
            {'id':'q1','needId':'n','institutionId':'i','status':'prepared','revision':1},
            {'id':'q2-old','needId':'n2','institutionId':'i','status':'prepared','revision':0}]
        api.request['consent']={'institutionIds':['i']}
        tools=VoiceTools(api,self.j,{'role':'citizen','requestId':'r','citizenRef':'c','callId':'multi'})
        with self.assertRaises(ToolError) as caught:await tools.finish_conversation('모두 문의하겠습니다')
        self.assertEqual(caught.exception.code,'INQUIRY_REQUIRED')
        self.assertIn('need_index=[1]',str(caught.exception))
        self.assertIsNone(self.j.get('finish:multi'))
        api.request['inquiries'].append({'id':'q2','needId':'n2','institutionId':'i','status':'prepared','revision':1})
        await tools.finish_conversation('모두 문의하겠습니다')
        self.assertIsNotNone(self.j.get('finish:multi'))

    async def test_verified_callback_reuses_validated_prior_institution_without_search(self):
        import json
        self.api.request['inquiries']=[{'id':'q','needId':'n','institutionId':'i','programId':'care-sos','contactPurpose':'신청'},
                                      {'id':'bad','needId':'n','institutionId':'invented','programId':'care-sos','contactPurpose':'신청'}]
        tools=VoiceTools(self.api,self.j,{'role':'callback','requestId':'r','citizenRef':'c','callId':'cb','_heard':'네'})
        result=json.loads(await tools.confirm_recipient('self','네'))
        self.assertEqual(result['followupTargets'],[{'need_index':0,'institution_id':'i','program_id':'care-sos','contact_purpose':'신청'}])
        self.assertEqual(set(tools.catalog),{'i'})
        self.assertNotIn('secret',json.dumps(result))
        await tools.prepare_inquiry(0,'i','care-sos','신청','["시민 선택 전달"]')
        with self.assertRaises(ToolError):await tools.prepare_inquiry(0,'invented','care-sos','신청','["질문"]')

    async def test_citizen_can_end_without_intake_only_on_explicit_whole_spoken_intent(self):
        tools=VoiceTools(self.api,self.j,{'role':'citizen','citizenRef':'c','callId':'info'})
        self.assertIn('end_without_request',[fn.__name__ for fn in tools.handlers()])
        for heard,quote in [('', ''),('배고파요','배고파요'),('통화 끊지 마세요','통화 끊지 마세요'),('접수 안 할게요 대신 안내는 더 해주세요','접수 안 할게요')]:
            tools.context['_heard']=heard
            with self.assertRaises(ToolError):await tools.end_without_request(quote)
            self.assertIsNone(self.j.get('end:info'))
        tools.context['_heard']='네, 안내만 받을게요.'
        await tools.end_without_request(tools.context['_heard'])
        self.assertEqual(self.j.get('end:info')['reason'],'citizen-no-request')
        self.assertIsNone(self.j.get('finish:info'))
        self.assertEqual(self.api.calls,[])
        tools.context['requestId']='r'
        with self.assertRaises(ToolError):await tools.end_without_request(tools.context['_heard'])
        tools.context.pop('requestId');tools.context['role']='institution'
        with self.assertRaises(ToolError):await tools.end_without_request(tools.context['_heard'])

    async def test_demo_operator_authorization_only_for_mapped_mock_and_institution(self):
        self.tools.context['demoAuthorization']=True
        self.tools.routing=Routing({'allowedNumbers':['+821000000001','+821000000002'],'citizenNumbers':{},'institutionNumbers':{'i':'+821000000002'},'demoCallers':{'+821000000001':'c'},'demoAuthorization':True})
        await self.tools.search_institutions('care-sos','강남구','')
        await self.tools.prepare_inquiry(0,'i','care-sos','신청','["재고 전달 조건"]')
        scope=self.j.get('consent:call')
        self.assertEqual(scope['source'],'demo-operator-authorization')
        self.assertNotIn('utterance',scope)
        self.assertIn('citizenProfile.address',scope['scope']['sharedFields'])
        self.assertTrue(any(path.endswith('/consent') for _,path,_ in self.api.calls))
        self.api.calls.clear();self.tools.context['demoAuthorization']=False
        await self.tools.prepare_inquiry(0,'i','care-sos','신청','["재고 전달 조건"]')
        self.assertFalse(any(path.endswith('/consent') for _,path,_ in self.api.calls))
        self.tools.context['demoAuthorization']=True
        self.tools.routing.demo_callers={'+821000000001':'other'}
        self.api.calls.clear()
        await self.tools.prepare_inquiry(0,'i','care-sos','신청','["재고 전달 조건"]')
        self.assertFalse(any(path.endswith('/consent') for _,path,_ in self.api.calls))

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
    async def test_consent_rejects_affirmative_fragment_of_negative_or_limited_reply(self):
        self.tools.catalog['i']={}
        import json
        for heard,quote in [('네, 동의 안 해요','네'),('네. 주소는 말하지 마세요','네'),('네, 이름만 알려 주세요','네'),('네 동의합니다','동의합니다')]:
            self.tools.context['_heard']=heard
            with self.subTest(heard=heard), self.assertRaises(ToolError):
                await self.tools.record_consent(json.dumps({'purpose':'문의','institutionIds':['i'],'sharedFields':['needs'],'allowCoordination':True,'utterance':quote}))
        self.assertEqual(self.api.calls,[])

    async def test_verified_callback_can_save_profile_without_changing_consent(self):
        import json
        tools=VoiceTools(self.api,self.j,{'role':'callback','requestId':'r','citizenRef':'c','callId':'cb','_heard':'네'})
        patch={'citizenProfile':{'name':'시험 시민','address':'서대문구 시험로 1'}}
        with self.assertRaises(ToolError):await tools.revise_request(json.dumps(patch))
        self.assertEqual(self.api.calls,[])
        await tools.confirm_recipient('self','네')
        await tools.revise_request(json.dumps(patch))
        self.assertEqual(self.api.calls[-1],('PATCH','/api/coordination/requests/r',patch))
        self.assertFalse(any(path.endswith('/consent') for _,path,_ in self.api.calls))

    async def test_answer_is_durable_draft_not_sent_before_call_end(self):
        tools=VoiceTools(self.api,self.j,{'role':'institution','requestId':'r','callId':'b','inquiryId':'q'})
        await tools.record_answer('{"outcome":"available","summary":"접수 가능","conditions":[],"nextAction":"상담","requiresChoice":false}')
        self.assertEqual(self.api.calls,[])
        self.assertEqual(self.j.get('answer:b')['summary'],'접수 가능')
    async def test_institution_must_record_its_own_answer_before_finish(self):
        tools=VoiceTools(self.api,self.j,{'role':'institution','requestId':'r','callId':'b','inquiryId':'q'})
        self.j.put('answer:another-call',{'summary':'다른 기관 답변'})
        with self.assertRaises(ToolError) as caught:
            await tools.finish_conversation('답변 감사합니다')
        self.assertEqual(caught.exception.code,'ANSWER_REQUIRED')
        self.assertIn('record_answer',str(caught.exception))
        self.assertIsNone(self.j.get('finish:b'))
        self.assertEqual(self.api.calls,[])
        await tools.record_answer('{"outcome":"available","summary":"식품 재고 있음","conditions":["즉석밥 두 개"],"nextAction":"시민에게 조건 안내","requiresChoice":true}')
        await tools.finish_conversation()
        self.assertEqual(self.j.get('finish:b')['summary'],'식품 재고 있음')

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

class IntakeFailureTests(unittest.IsolatedAsyncioTestCase):
    async def test_definitively_rejected_create_can_be_corrected(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite')
            class RejectOnce:
                count=0
                async def send(self,method,path,body=None):
                    self.count+=1
                    if self.count==1:raise ToolError('입력 수정',code='HTTP_400',definitive=True)
                    return {'request':{'id':'r',**body}}
            api=RejectOnce();tools=VoiceTools(api,journal,{'role':'citizen','citizenRef':'c','callId':'a'})
            payload=json.dumps({'summary':'식사','district':'서대문구','constraints':[],'needs':[{'description':'식사','category':'식사'}]})
            try:
                with self.assertRaises(ToolError):await tools.create_request(payload)
                self.assertEqual(json.loads(await tools.create_request(payload))['request']['id'],'r')
                self.assertEqual(api.count,2)
            finally:journal.close()

    async def test_unknown_create_response_is_reconciled_not_posted_twice(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite')
            class LostResponse:
                posts=0
                async def send(self,method,path,body=None):
                    if method=='GET':return {'requests':[]}
                    self.posts+=1;raise ToolError('응답 유실',code='TRANSPORT_UNKNOWN')
            api=LostResponse();tools=VoiceTools(api,journal,{'role':'citizen','citizenRef':'c','callId':'a'})
            payload=json.dumps({'summary':'식사','district':'서대문구','constraints':[],'needs':[{'description':'식사','category':'식사'}]})
            try:
                for _ in range(2):
                    with self.assertRaises(ToolError):await tools.create_request(payload)
                self.assertEqual(api.posts,1)
            finally:journal.close()

    async def test_lost_create_response_recovers_exact_request_and_callback_without_reposting(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite')
            class LostAfterSave:
                posts=0
                saved=None
                async def send(self,method,path,body=None):
                    if method=='GET':return {'requests':[self.saved]}
                    self.posts+=1;self.saved={'id':'saved',**body};raise ToolError('응답 유실',code='TRANSPORT_UNKNOWN')
            api=LostAfterSave();ctx={'role':'citizen','citizenRef':'c','callId':'a'}
            tools=VoiceTools(api,journal,ctx)
            journal.put('return:a',{'number':'+821000000001','source':'inbound'})
            payload=json.dumps({'summary':'식사','district':'서대문구','constraints':[],'needs':[{'description':'식사','category':'식사'}]})
            try:
                with self.assertRaises(ToolError):await tools.create_request(payload)
                result=json.loads(await tools.create_request(payload))
                self.assertEqual(result['request']['id'],'saved')
                self.assertEqual(api.posts,1)
                self.assertEqual(journal.get('request-return:saved')['number'],'+821000000001')
            finally:journal.close()

    async def test_intake_consent_waits_for_callback_route(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite');api=FakeAPI()
            ctx={'role':'citizen','citizenRef':'c','requestId':'r','callId':'a','callbackAvailable':False,'_heard':'네 동의합니다'}
            tools=VoiceTools(api,journal,ctx);tools.catalog['i']={}
            try:
                with self.assertRaises(ToolError):
                    await tools.record_consent('{"purpose":"문의","institutionIds":["i"],"sharedFields":["needs"],"allowCoordination":true,"utterance":"네 동의합니다"}')
                self.assertEqual(api.calls,[])
            finally:journal.close()

    async def test_unmapped_institution_is_reported_before_preparing_work(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite');api=FakeAPI()
            tools=VoiceTools(api,journal,{'role':'citizen','citizenRef':'c','requestId':'r','callId':'a'})
            tools.routing=Routing({'allowedNumbers':[],'citizenNumbers':{},'institutionNumbers':{}})
            try:
                await tools.search_institutions('care-sos','강남구','')
                with self.assertRaises(ToolError):await tools.prepare_inquiry(0,'i','care-sos','신청','["절차"]')
                self.assertTrue(all(method=='GET' for method,_,_ in api.calls))
            finally:journal.close()

    async def test_intake_cannot_finish_with_prepared_inquiry_but_no_consent(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite');api=FakeAPI()
            api.request['inquiries']=[{'id':'q','needId':'n','institutionId':'i','status':'prepared','revision':1}]
            tools=VoiceTools(api,journal,{'role':'citizen','citizenRef':'c','requestId':'r','callId':'a'})
            try:
                with self.assertRaises(ToolError) as caught:await tools.finish_conversation('기관에 확인 후 회신')
                self.assertEqual(caught.exception.code,'CONSENT_REQUIRED')
                self.assertIsNone(journal.get('finish:a'))
            finally:journal.close()

    async def test_intake_cannot_finish_before_preparing_any_inquiry(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite');api=FakeAPI()
            tools=VoiceTools(api,journal,{'role':'citizen','citizenRef':'c','requestId':'r','callId':'a'})
            try:
                with self.assertRaises(ToolError) as caught:await tools.finish_conversation('기관에 확인 후 회신')
                self.assertEqual(caught.exception.code,'INQUIRY_REQUIRED')
                self.assertIsNone(journal.get('finish:a'))
            finally:journal.close()

    async def test_callback_cannot_end_before_recorded_choice_has_followup(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite');api=FakeAPI()
            api.request['needs'][0]['choice']='30분 후 수령'
            tools=VoiceTools(api,journal,{'role':'callback','citizenRef':'c','requestId':'r','callId':'cb'})
            journal.put('recipient:cb',{'status':'confirmed','requestId':'r'})
            try:
                with self.assertRaises(ToolError) as caught:await tools.finish_conversation('기관에 선택 전달 예정')
                self.assertEqual(caught.exception.code,'FOLLOWUP_REQUIRED')
                self.assertIsNone(journal.get('finish:cb'))
            finally:journal.close()

    async def test_callback_followup_needs_institution_consent_before_finish(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite');api=FakeAPI()
            api.request['needs'][0]['choice']='다른 기관 문의'
            api.request['inquiries']=[{'id':'q','needId':'n','institutionId':'new-institution','status':'prepared','revision':1}]
            api.request['consent']={'institutionIds':['old-institution']}
            tools=VoiceTools(api,journal,{'role':'callback','citizenRef':'c','requestId':'r','callId':'cb'})
            journal.put('recipient:cb',{'status':'confirmed','requestId':'r'})
            try:
                with self.assertRaises(ToolError) as caught:await tools.finish_conversation('다른 기관 문의 예정')
                self.assertEqual(caught.exception.code,'CONSENT_REQUIRED')
            finally:journal.close()
