import copy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from coordination_tools import Journal, Routing
from coordination_voice import VoiceRuntime, build_prompt


class SimpleCallbackTests(unittest.IsolatedAsyncioTestCase):
    def test_registered_mock_intake_prompt_uses_basic_profile_without_past_needs(self):
        prompt=build_prompt({'role':'citizen','demoAuthorization':True,'demoCallbackOnly':True,
            'citizenProfile':{'name':'정미경','address':'등록된 시험 주소'},'district':'서대문구',
            'history':[{'summary':'과거의_미해결_식사준비_문구','needs':[{'description':'과거증상_주입금지'}]}]})
        self.assertIn('정미경',prompt)
        self.assertIn('등록된 시험 주소',prompt)
        self.assertNotIn('과거의_미해결_식사준비_문구',prompt)
        self.assertNotIn('과거증상_주입금지',prompt)
        self.assertIn('이번 증상이나 요청은 아직 모릅니다',prompt)
        self.assertIn('어떤 도움이 필요하세요?',prompt)
        self.assertIn('이번 발화를 기다립니다',prompt)

    def test_mock_offer_instructions_are_limited_to_authorized_demo_callback(self):
        demo=build_prompt({'role':'callback','demoAuthorization':True,'demoCallbackOnly':True})
        self.assertIn('simulatedOffer',demo)
        self.assertIn('실제 기관 발신은 하지 않습니다',demo)
        self.assertIn('simulatedOffer가 없으면',demo)
        for role in ['citizen','callback']:
            public=build_prompt({'role':role})
            self.assertNotIn('simulatedOffer',public)
            self.assertNotIn('목업 응답',public)
            self.assertNotIn('도시락 한 개',public)
            self.assertNotIn('정미경',public)

    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.journal=Journal(Path(self.temp.name)/'voice.sqlite')
        self.a='+821000000001';self.b='+821000000002';self.public='+821000000003'
        self.routing=Routing({'allowedNumbers':[self.a,self.b],'citizenNumbers':{},
            'institutionNumbers':{'institution':self.b},'demoCallers':{self.a:'demo'},
            'demoAuthorization':True,'demoCallbackOnly':True,'publicIntake':True})
        self.request={'id':'request','citizenRef':'demo','revision':1,'district':'서대문구',
            'summary':'음식 전달','constraints':[],
            'needs':[{'id':'need','description':'음식 전달','status':'open'}],
            'consent':{'institutionIds':['institution'],'sharedFields':['needs'],'allowCoordination':True},
            'inquiries':[{'id':'inquiry','needId':'need','institutionId':'institution','status':'prepared',
                          'revision':1,'programId':'just-dream','contactPurpose':'문의'}],
            'attempts':[],'callbacks':[]}
        self.api=AsyncMock()
        self.runtime=VoiceRuntime(self.api,self.journal,self.routing)
        self.runtime.dial=AsyncMock()
        self.journal.put('request-return:request',{'number':self.a,'source':'inbound','citizenRef':'demo'})

    async def asyncTearDown(self):
        self.journal.close();self.temp.cleanup()

    async def test_new_authorized_demo_dials_callback_once_without_institution_work(self):
        self.journal.put('demo-callback-only:request',{'citizenRef':'demo','source':'operator-demo-callback-only'})
        await self.runtime.dispatch_request(self.request)
        await self.runtime.dispatch_request(self.request)
        self.runtime.dial.assert_awaited_once()
        context,number=self.runtime.dial.await_args.args
        self.assertEqual((context['role'],number),('callback',self.a))
        self.assertIs(context['demoCallbackOnly'],True)
        self.assertIs(context['demoAuthorization'],True)
        self.assertEqual(self.journal.get('demo-simple-callback:request')['state'],'finished')
        self.api.send.assert_not_awaited()

    async def test_old_demo_without_new_marker_never_originates_old_work(self):
        await self.runtime.dispatch_request(self.request)
        self.runtime.dial.assert_not_awaited()
        self.api.send.assert_not_awaited()

    async def test_other_recipient_or_wrong_marker_cannot_receive_demo_bypass(self):
        for wrong_marker in [True,False]:
            with self.subTest(wrong_marker=wrong_marker):
                self.journal.put('demo-callback-only:request',{'citizenRef':'other' if wrong_marker else 'demo','source':'operator-demo-callback-only'})
                self.journal.put('request-return:request',{'number':self.a if wrong_marker else self.public,
                                                         'source':'inbound','citizenRef':'demo'})
                await self.runtime.dispatch_request(self.request)
        self.runtime.dial.assert_not_awaited()
        self.api.send.assert_not_awaited()

    async def test_public_request_still_dials_institution_then_its_own_callback(self):
        request=copy.deepcopy(self.request);request['citizenRef']='public'
        self.journal.put('request-return:request',{'number':self.public,'source':'inbound','citizenRef':'public'})
        async def api_send(method,path,body=None):
            if path.endswith('/attempts'):
                request['attempts'].append({'id':'attempt','inquiryId':'inquiry','status':'started'})
                return {'attempt':{'id':'attempt'}}
            return {'request':request}
        async def dial(context,number):
            if context['role']=='institution':
                request['inquiries'][0]['status']='answered'
                request['inquiries'][0]['answer']={'summary':'실제로 들은 조건'}
        self.api.send.side_effect=api_send
        self.runtime.dial.side_effect=dial
        await self.runtime.dispatch_request(request)
        self.assertEqual([(call.args[0]['role'],call.args[1]) for call in self.runtime.dial.await_args_list],
                         [('institution',self.b),('callback',self.public)])
        self.assertTrue(all(not call.args[0].get('demoAuthorization') for call in self.runtime.dial.await_args_list))
        self.assertIsNone(self.journal.get('demo-simple-callback:request'))
