"""Real Node HTTP/SQLite boundary; telephone transport is not exercised."""
import asyncio
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from coordination_tools import Journal,Routing,VoiceTools
from coordination_voice import HttpAPI,VoiceRuntime,institutional_context
try:
    import aiohttp
except ImportError:
    aiohttp=None

@unittest.skipIf(aiohttp is None,'Run with the installed ClawOps environment (aiohttp required)')
class RealHttpVoiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_intake_consent_partial_answer_and_citizen_choice(self):
        root=Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temporary:
            # Deliberately do not inherit real credentials or live ledger paths.
            env={'PATH':os.environ['PATH'],'HOME':os.environ['HOME'],'NODE_ENV':'test',
                 'AGENT_TOOL_SECRET':'local-test-agent-token-'+'x'*32,
                 'COORDINATION_LEDGER_PATH':str(Path(temporary)/'ledger.sqlite')}
            server=subprocess.Popen(['node','--import','tsx','tests/coordination/voice-http-fixture.ts'],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
            journal=Journal(Path(temporary)/'voice.sqlite')
            try:
                ready=select.select([server.stdout],[],[],10)[0]
                self.assertTrue(ready,'Temporary HTTP fixture did not start')
                port=json.loads(server.stdout.readline())['port']
                async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+env['AGENT_TOOL_SECRET']}) as client:
                    api=HttpAPI(client,f'http://127.0.0.1:{port}')
                    candidates=(await api.send('GET','/api/support/institutions?programId=just-dream'))['institutions']
                    institution=candidates[0]
                    tools=VoiceTools(api,journal,{'role':'citizen','citizenRef':'citizen-fixture','callId':'intake-fixture'})
                    initial=json.loads(await tools.create_request(json.dumps({'summary':'식사와 생필품 필요','district':institution['district'],'constraints':['방문 어려움'],'needs':[{'description':'식사 지원','category':'식사'},{'description':'생활용품','category':'생필품'}]})))['request']
                    await tools.search_institutions('just-dream',institution['district'],'')
                    queries=[]
                    for index in range(2):
                        queries.append(json.loads(await tools.prepare_inquiry(index,institution['id'],'just-dream',institution['contacts'][0]['purpose'],json.dumps(['방문 외 이용방법'])))['inquiry'])
                    tools.context['_heard']='네 두 가지 모두 알아봐 주세요. 동의합니다.'
                    await tools.record_consent(json.dumps({'purpose':'식사와 생필품 이용방법 문의','institutionIds':[institution['id']],'sharedFields':['needs','constraints'],'allowCoordination':True,'utterance':tools.context['_heard']}))
                    runtime=VoiceRuntime(api,journal,Routing({'allowedNumbers':[],'citizenNumbers':{},'institutionNumbers':{}}))
                    request_id=initial['id']
                    for index,query in enumerate(queries):
                        prefix='/api/coordination/requests/'+request_id
                        attempt=(await api.send('POST',prefix+'/inquiries/'+query['id']+'/attempts',{'idempotencyKey':'http-fixture-'+str(index)}))['attempt']
                        ctx={'role':'institution','requestId':request_id,'inquiryId':query['id'],'attemptId':attempt['id'],'callId':'institution-fixture-'+str(index)}
                        institution_tools=VoiceTools(api,journal,ctx)
                        await institution_tools.record_answer(json.dumps({'outcome':'available' if index==0 else 'alternative','summary':'식사 연결' if index==0 else '다른 일정 가능','conditions':[] if index==0 else ['금요일 방문'],'nextAction':'상담 준비' if index==0 else '시민 일정 선택','requiresChoice':index==1}))
                        before=(await api.send('GET',prefix))['request']
                        self.assertEqual(before['needs'][index]['status'],'contacting')
                        await runtime.finalize(ctx,'completed')
                    state=(await api.send('GET',prefix))['request']
                    self.assertEqual([n['status'] for n in state['needs']],['connected','awaiting-choice'])
                    callback=VoiceTools(api,journal,{'role':'callback','requestId':request_id,'citizenRef':'citizen-fixture','callId':'callback-fixture'})
                    callback.context['_heard']='네 제가 요청한 본인입니다'
                    await callback.confirm_recipient('self',callback.context['_heard'])
                    profile={'name':'시험 시민','address':'서대문구 시험로 1'}
                    updated=json.loads(await callback.revise_request(json.dumps({'citizenProfile':profile})))['request']
                    self.assertEqual(updated['id'],request_id)
                    self.assertEqual((await api.send('GET',prefix))['request']['citizenRef'],'citizen-fixture')
                    self.assertEqual(updated['citizenProfile'],profile)
                    self.assertNotIn('citizenProfile',institutional_context(updated,queries[1]))
                    callback.context['_heard']='네 이름과 주소 전달에 동의합니다'
                    await callback.record_consent(json.dumps({'purpose':'전달 장소 조율','institutionIds':[institution['id']],'sharedFields':['needs','constraints','citizenProfile.name','citizenProfile.address'],'allowCoordination':True,'utterance':callback.context['_heard']}))
                    updated=(await api.send('GET',prefix))['request']
                    self.assertEqual(institutional_context(updated,queries[1])['citizenProfile'],profile)
                    await callback.record_choice(1,'금요일 방문은 어렵고 대리수령을 원합니다')
                    await callback.search_institutions('just-dream',institution['district'],'')
                    await callback.prepare_inquiry(1,institution['id'],'just-dream',institution['contacts'][0]['purpose'],json.dumps(['시민의 대리수령 선택으로 진행 가능한가요?']))
                    await callback.finish_conversation('식사는 연결, 생필품은 대리수령 가능 여부 추가 문의')
                    await runtime.finalize(callback.context,'completed')
                    state=(await api.send('GET',prefix))['request']
                    self.assertEqual(state['needs'][0]['status'],'connected')
                    self.assertEqual(state['needs'][1]['status'],'open')
                    self.assertIn('대리수령',state['needs'][1]['choice'])
                    self.assertEqual(state['callbacks'][0]['status'],'completed')
                    self.assertEqual(len(state['attempts']),2)
                    self.assertTrue((Path(temporary)/'ledger.sqlite').is_file())
            finally:
                journal.close()
                server.terminate()
                try:server.wait(timeout=5)
                except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
                server.stdout.close()

    async def test_registered_and_public_intake_share_real_http_workflow(self):
        from types import SimpleNamespace
        from coordination_voice import build_prompt
        root=Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temporary:
            env={'PATH':os.environ['PATH'],'HOME':os.environ['HOME'],'NODE_ENV':'test',
                 'AGENT_TOOL_SECRET':'isolated-dual-track-token-'+'x'*32,
                 'COORDINATION_LEDGER_PATH':str(Path(temporary)/'ledger.sqlite')}
            server=subprocess.Popen(['node','--import','tsx','tests/coordination/voice-http-fixture.ts'],cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
            journal=Journal(Path(temporary)/'voice.sqlite')
            try:
                self.assertTrue(select.select([server.stdout],[],[],10)[0])
                port=json.loads(server.stdout.readline())['port']
                async with aiohttp.ClientSession(headers={'Authorization':'Bearer '+env['AGENT_TOOL_SECRET']}) as client:
                    api=HttpAPI(client,f'http://127.0.0.1:{port}')
                    profile={'name':'정미경','address':'서대문구 시험주소','age':69,'household':'1인 가구'}
                    seed=(await api.send('POST','/api/coordination/requests',{'citizenRef':'demo-existing','citizenProfile':profile,
                        'summary':'기존 방문 수령','district':'서대문구','constraints':[],
                        'needs':[{'description':'간편식','category':'식사','requestDetails':{'deliveryMethod':'방문 수령'}}]}))['request']
                    institution=(await api.send('GET','/api/support/institutions?programId=just-dream&district='+__import__('urllib.parse',fromlist=['quote']).quote('서대문구')))['institutions'][0]
                    a='+821000000001';b='+821000000002';new='+821000000003'
                    routing=Routing({'allowedNumbers':[a,b],'citizenNumbers':{},'institutionNumbers':{institution['id']:b},
                                     'demoCallers':{a:'demo-existing',b:'demo-existing'},'publicIntake':True,'demoTime':'23:00'})
                    runtime=VoiceRuntime(api,journal,routing)
                    requests=[]
                    for index,number in enumerate([a,new]):
                        runtime.active=None
                        ctx=await runtime.bind(SimpleNamespace(call_id='intake-'+str(index),from_number=number,direction='inbound'))
                        if index==0:
                            self.assertIn('정미경',build_prompt(ctx));self.assertEqual(ctx['citizenProfile'],profile)
                        else:
                            self.assertNotIn('정미경',build_prompt(ctx));self.assertNotIn('scenarioTime',ctx)
                        tools=VoiceTools(api,journal,ctx)
                        payload={'summary':'오늘 밤 바로 먹을 음식 배달 필요','district':'서대문구','constraints':['기력이 없어 외출 어려움'],
                                 'needs':[{'description':'바로 먹을 음식 전달','category':'식사','requestDetails':{'quantity':'1식','deliveryMethod':'집까지 전달','requestedDate':'오늘 밤'}}]}
                        r=json.loads(await tools.create_request(json.dumps(payload)))['request']
                        requests.append((await api.send('GET','/api/coordination/requests/'+r['id']))['request'])
                        self.assertEqual(r['needs'][0]['requestDetails']['deliveryMethod'],'집까지 전달')
                        if index==0:self.assertEqual(r['citizenProfile'],profile)
                        else:self.assertNotIn('citizenProfile',r)
                        await tools.search_institutions('just-dream','서대문구','')
                        inquiry=json.loads(await tools.prepare_inquiry(0,institution['id'],'just-dream',institution['contacts'][0]['purpose'],json.dumps(['재고·오늘 전달·시간·비용·절차는?'])))['inquiry']
                        ctx['_heard']='네 기관에 알아보고 다시 전화 주세요. 동의합니다.'
                        await tools.record_consent(json.dumps({'purpose':'오늘 식사 전달 문의','institutionIds':[institution['id']],
                             'sharedFields':['district','needs','constraints'],'allowCoordination':True,'utterance':ctx['_heard']}))
                        await runtime.finalize(ctx,'completed');runtime.active=None
                        dialed=[]
                        # Telephone boundary is a test double; all business writes
                        # and state transitions below use the real Node HTTP server.
                        async def dial(context,destination):
                            dialed.append((context['role'],destination))
                            followup=len(dialed)>2
                            callctx={**context,'callId':'out-'+str(index)+'-'+str(len(dialed))+'-'+context['role']}
                            voice=VoiceTools(api,journal,callctx)
                            if context['role']=='institution':
                                await voice.record_answer(json.dumps({'outcome':'available','summary':'죽 1개와 간편식 2개',
                                    'conditions':['무료',('30분' if index==0 else '45분')+' 뒤 집까지 전달'],
                                    'nextAction':'전달 일정 조율됨, 실제 제공은 별도 확인' if followup else '시민 수령 의사 확인','requiresChoice':not followup}))
                            else:
                                callctx['_heard']='네 제가 요청한 본인입니다'
                                result=json.loads(await voice.confirm_recipient('self',callctx['_heard']))
                                self.assertIn(('30분' if index==0 else '45분'),str(result))
                                if followup:
                                    await voice.finish_conversation('기관이 전달 일정을 조율했습니다. 실제 제공 완료는 아직 아닙니다.')
                                    await runtime.finalize(callctx,'completed')
                                    return
                                await voice.record_choice(0,'안내한 시간에 집에서 받겠습니다')
                                await voice.search_institutions('just-dream','서대문구','')
                                await voice.prepare_inquiry(0,institution['id'],'just-dream',institution['contacts'][0]['purpose'],json.dumps(['시민이 안내 시간에 수령을 선택했습니다. 최종 조율할 사항은?']))
                                await voice.finish_conversation('수령 의사 확인, 기관에 최종 전달 필요')
                            await runtime.finalize(callctx,'completed')
                        runtime.dial=dial
                        current=(await api.send('GET','/api/coordination/requests/'+r['id']))['request']
                        await runtime.dispatch_request(current)
                        self.assertEqual(dialed,[('institution',b),('callback',number)])
                        final=(await api.send('GET','/api/coordination/requests/'+r['id']))['request']
                        self.assertEqual(final['callbacks'][0]['status'],'completed')
                        self.assertEqual(final['needs'][0]['choice'],'안내한 시간에 집에서 받겠습니다')
                        self.assertEqual(final['needs'][0]['status'],'open')
                        await runtime.dispatch_request(final)
                        settled=(await api.send('GET','/api/coordination/requests/'+r['id']))['request']
                        self.assertEqual(dialed,[('institution',b),('callback',number),('institution',b),('callback',number)])
                        self.assertEqual(len(settled['attempts']),2)
                        self.assertEqual(len(settled['callbacks']),2)
                        self.assertEqual(settled['needs'][0]['status'],'connected')
                        self.assertIn('실제 제공은 별도 확인',settled['inquiries'][-1]['answer']['nextAction'])
                        await runtime.dispatch_request(settled)
                        self.assertEqual(len(dialed),4,'Completed followup must not produce duplicate calls')
                    self.assertNotEqual(requests[0]['citizenRef'],requests[1]['citizenRef'])
                    original=(await api.send('GET','/api/coordination/requests/'+seed['id']))['request']
                    self.assertEqual(original['needs'][0]['requestDetails']['deliveryMethod'],'방문 수령')
                    self.assertEqual(len((await api.send('GET','/api/coordination/requests'))['requests']),3)
            finally:
                journal.close();server.terminate()
                try:server.wait(timeout=5)
                except subprocess.TimeoutExpired:server.kill();server.wait(timeout=5)
                server.stdout.close()
