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
from coordination_voice import HttpAPI,VoiceRuntime
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
                    await callback.record_choice(1,'금요일 방문은 어렵고 대리수령을 원합니다')
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
