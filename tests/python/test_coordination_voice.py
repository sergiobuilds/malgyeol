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


    async def test_missing_route_preserves_partial_result_and_sends_one_callback(self):
        from unittest.mock import AsyncMock
        request={'id':'r','citizenRef':'citizen','revision':1,'consent':{'institutionIds':['unmapped']},
                 'inquiries':[{'id':'done','status':'answered','answer':{'summary':'식사 연결'}},
                              {'id':'pending','status':'prepared','revision':1,'institutionId':'unmapped'}],
                 'attempts':[]}
        calls=[]
        class API:
            async def send(self,method,path,body=None):
                calls.append((method,path,body))
                return {'request':request}
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite')
            routing=Routing({'allowedNumbers':['+820000000001'],'citizenNumbers':{'citizen':'+820000000001'},'institutionNumbers':{}})
            runtime=VoiceRuntime(API(),journal,routing)
            runtime.dial=AsyncMock()
            try:
                await runtime.dispatch_request(request)
                await runtime.dispatch_request(request)
                self.assertEqual(runtime.dial.await_count,1)
                context=runtime.dial.await_args.args[0]
                self.assertEqual(context['role'],'callback')
                self.assertNotIn('request',context)
                self.assertEqual(request['inquiries'][0]['status'],'answered')
                self.assertEqual(request['inquiries'][1]['status'],'prepared')
                self.assertTrue(all(method=='GET' for method,_,_ in calls))
                self.assertIsNone(journal.get('dispatch:pending:0'))
            finally:journal.close()


    def test_callback_prompt_excludes_individual_request_before_confirmation(self):
        prompt=build_prompt({'role':'callback','request':{'summary':'특정시민비공개지원내용','needs':[{'description':'개인병력비공개'}]}})
        self.assertNotIn('특정시민비공개지원내용',prompt)
        self.assertNotIn('개인병력비공개',prompt)
        self.assertIn('confirm_recipient',prompt)

    async def test_callback_transport_completion_without_role_confirmation_is_not_delivery(self):
        with tempfile.TemporaryDirectory() as d:
            journal=Journal(Path(d)/'s.sqlite');calls=[]
            class API:
                async def send(self,method,path,body=None):calls.append(body);return {'request':{}}
            rt=VoiceRuntime(API(),journal,Routing({'allowedNumbers':[],'citizenNumbers':{},'institutionNumbers':{}}))
            journal.put('finish:cb',{'summary':'모델이 주장한 안내 완료'})
            await rt.finalize({'role':'callback','requestId':'r','callId':'cb'},'completed')
            self.assertEqual(calls[0]['status'],'failed')
            self.assertNotIn('모델이 주장한',calls[0]['summary'])
            journal.close()

class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_final_speech_waits_for_full_audio_and_interruption_cancels_close(self):
        try:
            from clawops.agent import ClawOpsAgent, GeminiRealtime
            from clawops.agent._tool import ToolRegistry
            from clawops.agent._session import CallSession
        except ImportError:self.skipTest('Installed SDK required')
        from coordination_voice import make_agent_class, OUTBOUND
        from unittest.mock import patch, AsyncMock
        from types import SimpleNamespace
        import os
        os.environ['GEMINI_LIVE_MODEL']='test-model'
        with tempfile.TemporaryDirectory() as directory:
            journal=Journal(Path(directory)/'voice.sqlite')
            runtime=VoiceRuntime(None,journal,Routing({'allowedNumbers':[],'citizenNumbers':{},'institutionNumbers':{}}))
            cls=make_agent_class(ClawOpsAgent,GeminiRealtime,ToolRegistry)
            agent=cls(runtime,api_key='test-only',account_id='test',from_='test')
            call=CallSession(call_id='audio',from_number='test',to_number='test',account_id='test',direction='outbound')
            agent._active_sessions['audio']=call
            token=OUTBOUND.set({'role':'institution','requestId':'r','inquiryId':'q','attemptId':'a','disclosure':{}})
            try:
                with patch('google.genai.Client'):
                    session=await agent._open_session('audio')
                session._call=call
                clock=[100.0];hangup_times=[];delays=[]
                original_sleep=asyncio.sleep
                async def hangup():hangup_times.append(clock[0])
                call.bind_transport(send_audio=AsyncMock(),send_clear=AsyncMock(),hangup=hangup)
                def audio(seconds,complete=False):
                    return SimpleNamespace(server_content=SimpleNamespace(turn_complete=complete,
                        model_turn=SimpleNamespace(parts=[SimpleNamespace(inline_data=SimpleNamespace(
                            mime_type='audio/pcm;rate=24000',data=b'\0'*int(48000*seconds)))])))
                async def advance(delay):
                    delays.append(delay);clock[0]+=delay+0.000001;await original_sleep(0)
                with patch.object(GeminiRealtime,'_handle_response'), \
                     patch('coordination_voice.asyncio.get_running_loop',return_value=SimpleNamespace(time=lambda:clock[0])), \
                     patch('coordination_voice.asyncio.sleep',side_effect=advance):
                    # Four seconds already queued, then eight seconds of final
                    # speech generated immediately: SDK's five-second limit is insufficient.
                    await session._handle_response(audio(4))
                    journal.put('finish:audio',{'summary':'완료'})
                    await session._handle_response(audio(8,True))
                    self.assertEqual(hangup_times,[])
                    await session._close_task
                    self.assertGreaterEqual(hangup_times[0],112.2)
                    self.assertGreaterEqual(delays[0],12.2-0.00001)

                    # A user interruption clears queued speech and cancels the
                    # scheduled hangup, so a new reply can finish normally.
                    session._ending=False;hangup_times.clear()
                    await session._handle_response(audio(8,True))
                    pending=session._close_task
                    await session._handle_response(SimpleNamespace(server_content=SimpleNamespace(interrupted=True,turn_complete=False)))
                    await asyncio.gather(pending,return_exceptions=True)
                    self.assertTrue(pending.cancelled())
                    self.assertFalse(session._ending)
                    self.assertFalse(session._finish_audio_seen)
                    self.assertEqual(hangup_times,[])

                    # Complete callback speech may be generated while ringing.
                    # None of that buffered audio has played before attach.
                    from clawops.agent.pipeline._buffering_call import _BufferingCall
                    buffering=_BufferingCall()
                    await buffering.send_audio(b'\xff'*(8000*9))
                    session._call=buffering
                    clock[0]=200.0
                    await session._handle_response(audio(9,True))
                    self.assertTrue(session._final_turn_complete)
                    self.assertFalse(session._ending,'Prewarm stub cannot hang up a real call')
                    clock[0]=220.0  # Twenty seconds ringing is not audio playback.
                    await session.attach(call)
                    self.assertAlmostEqual(session._audio_playout_until,229.0)
                    self.assertEqual(buffering._buffer,[])
                    await session._close_task
                    self.assertGreaterEqual(hangup_times[0],229.2)
            finally:
                OUTBOUND.reset(token);journal.close()

    async def test_native_intake_schema_and_sdk_dispatch_preserve_request(self):
        from unittest.mock import AsyncMock
        try:
            from clawops.agent._tool import ToolRegistry
        except ImportError:self.skipTest('Run with the installed ClawOps environment for SDK contract verification')
        from coordination_voice import configure_intake_schema
        import json
        registry=ToolRegistry()
        received=AsyncMock(return_value='{"request":{"id":"saved"}}')
        async def create_request(input_json:str):
            return await received(input_json)
        registry.register(create_request)
        configure_intake_schema(registry)
        tool=registry['create_request']
        self.assertEqual(tool.required,['request_data'])
        schema=tool.parameters['request_data']
        self.assertEqual(schema['type'],'object')
        self.assertEqual(schema['properties']['needs']['type'],'array')
        self.assertNotIn('citizenRef',schema['properties'])
        payload={'summary':'식사와 물품','district':'서대문구','needs':[
            {'description':'저녁 식사','category':'식사'},
            {'description':'비누','category':'생필품'}]}
        result=await registry.call('create_request',{'request_data':payload})
        self.assertEqual(json.loads(received.await_args.args[0]),payload)
        self.assertEqual(json.loads(result)['request']['id'],'saved')

    async def test_native_consent_answer_and_profile_changes_reach_validated_handlers(self):
        try:
            from clawops.agent._tool import ToolRegistry
        except ImportError:self.skipTest('Run with the installed ClawOps environment for SDK contract verification')
        from coordination_voice import configure_intake_schema
        import json
        for name,parameter,payload in [
            ('record_consent','consent_data',{'purpose':'문의','institutionIds':['i'],'sharedFields':['needs'],'allowCoordination':False,'utterance':'네'}),
            ('record_answer','answer_data',{'outcome':'available','summary':'죽 2개','conditions':['45분','무료'],'nextAction':'선택 확인','requiresChoice':True}),
            ('revise_request','changes',{'citizenProfile':{'name':'김서연','address':'서대문구 연희로 32'}}),
        ]:
            with self.subTest(tool=name):
                received=[]
                async def handler(input_json:str):
                    received.append(json.loads(input_json));return '{}'
                handler.__name__=name
                registry=ToolRegistry();registry.register(handler)
                configure_intake_schema(registry)
                self.assertEqual(registry[name].parameters[parameter]['type'],'object')
                await registry.call(name,{parameter:payload})
                self.assertEqual(received,[payload])
                # Observed Live output adds status outside the declared object.
                # Never use it as consent/answer evidence; validate payload only.
                await registry.call(name,{parameter:payload,'status':'approved'})
                self.assertEqual(received,[payload,payload])

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
                # Provider-side generation failures never reach a tool handler.
                # Record their reason without retaining input/audio/provider text.
                failure=SimpleNamespace(server_content=SimpleNamespace(
                    input_transcription=None,turn_complete=True,
                    turn_complete_reason='MALFORMED_FUNCTION_CALL'))
                with patch.object(GeminiRealtime,'_handle_response'), self.assertLogs('coordination',level='WARNING') as logs:
                    await session._handle_response(failure)
                self.assertIn('code=MALFORMED_FUNCTION_CALL',logs.output[0])
                self.assertIn('stage=model_generation',logs.output[0])
                self.assertNotIn('네 동의합니다',str(logs.output))
                self.assertIsNone(journal.get('finish:x'))
                # Finishing must await final speech and the SDK's playout mark,
                # without adding an arbitrary two-second sleep before hangup.
                from clawops.agent._media_ws import MediaWebSocket
                from unittest.mock import AsyncMock
                media=object.__new__(MediaWebSocket)
                media.flush=AsyncMock()
                media.send_mark=AsyncMock()
                played=asyncio.Event();waiting=asyncio.Event()
                async def playback_mark(*args,**kwargs):
                    waiting.set();await played.wait()
                media.wait_for_mark=playback_mark
                media.close=AsyncMock()
                call=agent._active_sessions['x']
                call.bind_transport(send_audio=AsyncMock(),send_clear=AsyncMock(),hangup=media.graceful_close)
                session._call=call
                journal.put('finish:x',{'summary':'안내 완료'})
                completed=SimpleNamespace(server_content=SimpleNamespace(turn_complete=True))
                with patch.object(GeminiRealtime,'_handle_response'):
                    await session._handle_response(completed)
                    self.assertFalse(getattr(session,'_ending',False),'Tool completion alone is not final speech')
                    speech=SimpleNamespace(server_content=SimpleNamespace(turn_complete=True,model_turn=SimpleNamespace(parts=[SimpleNamespace(inline_data=SimpleNamespace(mime_type='audio/pcm',data=b'00'))])))
                    await session._handle_response(speech)
                    await asyncio.wait_for(waiting.wait(),timeout=0.5)
                    media.flush.assert_awaited_once();media.send_mark.assert_awaited_once()
                    media.close.assert_not_awaited()
                    played.set()
                    await asyncio.sleep(0)
                    media.close.assert_awaited_once()
            finally:OUTBOUND.reset(tok);journal.close()
