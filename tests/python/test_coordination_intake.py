"""Intake identity and callback provenance, independent of telephone transport."""
import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from coordination_tools import Journal, Routing, VoiceTools, ToolError
from coordination_voice import VoiceRuntime, build_prompt

A='+821000000001'
B='+821000000002'
NEW='+821000000003'
PROFILE={'name':'정미경','address':'서대문구 시험주소','age':69,'household':'1인 가구'}

class API:
    def __init__(self):
        self.calls=[]
        self.history=[{'id':'old','citizenRef':'demo-person','citizenProfile':PROFILE,
                       'district':'서대문구','summary':'기존 간편식 요청','updatedAt':'2026-09-18T00:00:00Z',
                       'needs':[{'description':'간편식','requestDetails':{'deliveryMethod':'방문 수령'}}]}]
    async def send(self, method,path,body=None):
        self.calls.append((method,path,copy.deepcopy(body)))
        if method=='GET':return {'requests':copy.deepcopy(self.history)}
        return {'request':{'id':'new-'+str(len(self.calls)),**body}}

class IntakeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.j=Journal(Path(self.tmp.name)/'voice.sqlite');self.api=API()
        self.routing=Routing({'allowedNumbers':[A,B],'citizenNumbers':{'legacy-a':A},'institutionNumbers':{'i':B},
                              'demoCallers':{A:'demo-person',B:'demo-person'},'publicIntake':True,'demoTime':'23:00'})
        self.runtime=VoiceRuntime(self.api,self.j,self.routing)
    def tearDown(self):self.j.close();self.tmp.cleanup()
    async def bind(self,number,call_id='intake'):
        return await self.runtime.bind(SimpleNamespace(direction='inbound',from_number=number,call_id=call_id))
    async def test_both_registered_numbers_load_existing_profile_before_greeting(self):
        for number in [A,B]:
            self.runtime.active=None
            ctx=await self.bind(number,number[-1])
            self.assertEqual(ctx['citizenRef'],'demo-person')
            self.assertEqual(ctx.get('citizenProfile'),PROFILE)
            self.assertEqual(ctx.get('scenarioTime'),'23:00')
            self.assertIn('정미경',build_prompt(ctx))
            self.assertNotIn(number,build_prompt(ctx))
            self.assertIsNone(ctx.get('requestId'))
        self.assertTrue(all('citizenRef=demo-person' in p for _,p,_ in self.api.calls))
    async def test_unregistered_caller_has_no_demo_context_and_no_history_lookup(self):
        ctx=await self.bind(NEW)
        self.assertNotEqual(ctx['citizenRef'],'demo-person')
        self.assertNotIn('citizenProfile',ctx)
        self.assertNotIn('scenarioTime',ctx)
        self.assertEqual(self.api.calls,[])
        self.assertNotIn('정미경',build_prompt(ctx))
    async def test_anonymous_caller_can_intake_without_invented_callback(self):
        ctx=await self.bind('anonymous')
        self.assertTrue(ctx['citizenRef'])
        self.assertIsNone(self.j.get('return:intake'))
        self.assertFalse(ctx.get('callbackAvailable'))
    async def test_new_request_preserves_profile_but_not_old_pickup_conditions(self):
        ctx=await self.bind(A)
        tools=VoiceTools(self.api,self.j,ctx)
        result=json.loads(await tools.create_request(json.dumps({'summary':'지금 식사 배달 필요','constraints':['외출 어려움'],
                       'needs':[{'description':'바로 먹을 식사','category':'식사','requestDetails':{'deliveryMethod':'집까지 전달','requestedDate':'오늘 밤'}}]})))
        request=result['request']
        self.assertEqual(request['citizenProfile'],PROFILE)
        self.assertEqual(request['district'],'서대문구')
        self.assertEqual(request['needs'][0]['requestDetails']['deliveryMethod'],'집까지 전달')
        self.assertNotIn('방문 수령',json.dumps(request,ensure_ascii=False))
        self.assertEqual(self.j.get('request-return:'+request['id'])['number'],A)
    async def test_two_demo_calls_keep_separate_return_numbers_after_restart(self):
        saved=[]
        for idx,number in enumerate([A,B]):
            self.runtime.active=None
            ctx=await self.bind(number,str(idx))
            result=json.loads(await VoiceTools(self.api,self.j,ctx).create_request(json.dumps({'summary':'식사','district':'서대문구','constraints':[],
                             'needs':[{'description':'음식','category':'식사'}]})))
            saved.append(result['request']['id'])
        restored=Journal(self.j.path)
        try:
            self.assertEqual([restored.get('request-return:'+r)['number'] for r in saved],[A,B])
        finally:restored.close()
    async def test_second_concurrent_call_cannot_replace_first_context(self):
        first=await self.bind(A,'first')
        with self.assertRaises(ToolError):await self.bind(B,'second')
        self.assertEqual(self.j.get('call:first')['citizenRef'],first['citizenRef'])
        self.assertIsNone(self.j.get('call:second'))

    async def test_callback_dials_only_request_bound_inbound_number(self):
        from unittest.mock import AsyncMock
        request={'id':'req','citizenRef':'new-person','revision':1,'consent':{'institutionIds':[]},
                 'inquiries':[{'id':'q','status':'answered','answer':{'summary':'30분 후 전달'}}],'attempts':[]}
        class CurrentAPI:
            async def send(self,*args):return {'request':request}
        self.runtime.api=CurrentAPI()
        self.runtime.dial=AsyncMock()
        self.j.put('request-return:req',{'number':NEW,'source':'inbound','citizenRef':'new-person'})
        await self.runtime.dispatch_request(request)
        self.assertEqual(self.runtime.dial.await_args.args[1],NEW)
        self.assertEqual(self.runtime.dial.await_args.args[0]['citizenRef'],'new-person')

    async def test_callback_provenance_does_not_authorize_institution_dial(self):
        self.j.put('request-return:req',{'number':NEW,'source':'inbound','citizenRef':'new-person'})
        with self.assertRaises(ToolError):
            await self.runtime.dial({'role':'institution','requestId':'req'},NEW)
        with self.assertRaises(ToolError):
            await self.runtime.dial({'role':'callback','requestId':'req','citizenRef':'wrong-person'},NEW)

    async def test_public_callback_can_dial_with_request_provenance(self):
        from unittest.mock import AsyncMock
        self.j.put('request-return:req',{'number':NEW,'source':'inbound','citizenRef':'new-person'})
        self.runtime.agent=SimpleNamespace(call=AsyncMock(return_value=SimpleNamespace(wait=AsyncMock())))
        self.runtime.ended=AsyncMock()
        await self.runtime.dial({'role':'callback','requestId':'req','citizenRef':'new-person'},NEW)
        self.runtime.agent.call.assert_awaited_once_with(NEW,timeout=25)

    def test_institution_receives_only_explicit_profile_fields(self):
        from coordination_voice import institutional_context
        request={'summary':'식사 필요','district':'서대문구','constraints':[],
                 'citizenProfile':{**PROFILE,'contactPreference':'평일 오전'},
                 'needs':[{'id':'n','description':'식사','requestDetails':{'deliveryMethod':'배달','quantity':'1식'}}],
                 'consent':{'sharedFields':['needs','citizenProfile.address'],'allowCoordination':True}}
        result=institutional_context(request,{'needId':'n','programId':'just-dream','contactPurpose':'이용 문의','questions':['수량?']})
        self.assertEqual(result.get('citizenProfile'),{'address':PROFILE['address']})
        self.assertNotIn('정미경',str(result))
        self.assertEqual(result['needs'][0].get('requestDetails'),{'deliveryMethod':'배달','quantity':'1식'})

    async def test_anonymous_caller_can_supply_spoken_callback_without_model_invention(self):
        ctx=await self.bind('anonymous')
        tools=VoiceTools(self.api,self.j,ctx)
        ctx['_heard']='회신은 01000000003으로 해 주세요'
        with self.assertRaises(ToolError):await tools.set_callback_number(A,ctx['_heard'])
        await tools.set_callback_number(NEW,ctx['_heard'])
        self.assertEqual(self.j.get('return:intake')['number'],NEW)
        self.assertTrue(ctx['callbackAvailable'])

    async def test_spoken_callback_cannot_target_service_itself(self):
        ctx=await self.bind('anonymous')
        ctx['_serviceNumber']=A;ctx['_heard']='01000000001로 해 주세요'
        with self.assertRaises(ToolError):await VoiceTools(self.api,self.j,ctx).set_callback_number(A,ctx['_heard'])
        self.assertIsNone(self.j.get('return:intake'))

    def test_freeform_questions_cannot_bypass_profile_disclosure_consent(self):
        from coordination_voice import institutional_context
        request={'summary':'식사 필요','district':'서대문구','constraints':[],
                 'citizenProfile':PROFILE,'needs':[{'id':'n','description':'식사'}],
                 'consent':{'sharedFields':['summary','district','constraints','needs'],'allowCoordination':True}}
        result=institutional_context(request,{'needId':'n','programId':'just-dream','contactPurpose':'이용 문의',
                                             'questions':['정미경 씨 서대문구 시험주소로 배달 되나요?']})
        self.assertNotIn('정미경',str(result));self.assertNotIn('시험주소',str(result))

    async def test_preflight_rejects_missing_demo_profile_before_accepting_calls(self):
        self.api.history=[]
        with self.assertRaises(ToolError):await self.runtime.preflight()
        self.assertIsNone(self.runtime.active)
        self.assertEqual(self.j.entries('call:'),[])

    async def test_restart_reconciles_saved_intake_and_return_route(self):
        import hashlib
        ctx=await self.bind(NEW,'lost-response')
        self.j.put('create:lost-response',{'state':'needs-reconciliation'})
        saved={'id':'saved-request','citizenRef':ctx['citizenRef'],'intakeKey':'voice-'+hashlib.sha256(b'lost-response').hexdigest(),'attempts':[]}
        class SavedAPI:
            async def send(self,method,path,body=None):
                if method!='GET':raise AssertionError('recovery must not create requests')
                return {'requests':[saved]}
        restored=VoiceRuntime(SavedAPI(),self.j,self.routing)
        await restored.recover()
        self.assertEqual(self.j.get('call:lost-response').get('requestId'),'saved-request')
        self.assertEqual(self.j.get('request-return:saved-request')['number'],NEW)
        self.assertEqual(self.j.get('create:lost-response')['state'],'completed')
