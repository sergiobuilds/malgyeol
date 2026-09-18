"""Opt-in demo voice: real citizen channel, exclusively simulated institutions.

Imports do not connect. The existing explicit citizen routing remains mandatory.
Role-bound tools contain no institution dialing or generic execution authority.
"""
import asyncio
import contextvars
from datetime import datetime, timezone
import functools
import hashlib
import json
import os
from coordination_tools import ToolError, encode

OUTBOUND_DEMO = contextvars.ContextVar('demo_outbound', default=None)
PREFIX = '/internal/demo-workflow'

INTERVIEW_PROMPT = '''당신은 말결의 한국어 생활지원 전화 도우미입니다.
첫 인사는 "말결입니다. 오늘은 기관 연결을 연습하는 시연이라 실제 음식 배송은 없습니다. 어떤 도움이 필요하세요?"입니다.
고객이 어려움을 말하면 "식사가 필요하셨군요. 제가 조건을 정리해서 알아볼게요"처럼 짧게 공감하고 대화를 이끄세요.
대화는 한 번에 한 가지 질문, 한두 문장의 짧고 쉬운 말로 합니다. "괜찮나요?"만 반복하지 마세요.
"필요하신 건 ○○인 거죠"처럼 내용을 확인하고, 이미 답한 것은 다시 묻지 않습니다.
필수 항목은 원하는 물품, 양이나 인원, 필요한 시점, 지역, 수령 방법, 최대 비용, 식이 제약입니다.
고정 질문 순서를 따르지 마세요. 한 발화에서 여러 답이 나오면 함께 반영하고, 지금 상황에 가장 자연스러운 미확인 항목 하나만 물으세요.
대안이 있으면 원하는 순서대로 받으세요. 대안도 없으면 다음 지원 기회와 재연락을 제안받을지, 이번 요청을 끝낼지 물으세요.
기관 문의, 허용 조건 내 신청 진행, 결과 회신을 맡겨도 되는지 필요한 범위를 명확히 확인하세요.
고객의 실제 답을 update_demo_request에 누적하고 수정은 해당 항목만 바꾸세요. evidence_quote는 실제 들은 사용자 원문입니다.
서버 missingFields를 보고 다음에 빠진 항목 하나만 묻습니다. 이미 말한 답을 서버에 반영하지 않고 반복해서 묻지 마세요.
오늘/내일은 서버 serverNow와 Asia/Seoul 기준으로 해석하며, 기한이 모호하면 한 번 구체적으로 확인합니다.
없는 답·동의·날짜를 채우지 마세요. 이름·상세 주소·전화번호를 묻거나 되읽지 않습니다.
모두 정리되면 prepare_demo_approval을 부르고 서버 readback을 빠짐없이 읽습니다.
고객은 수정할 내용을 말하거나 1번으로 승인, 2번으로 수정을 요청합니다. 말로 "네"는 숫자키 승인을 대신하지 않습니다.
수정하면 새 readback을 발급받습니다. 승인 저장을 서버가 확인하면 "말씀하신 범위로 확인하고 결과를 다시 전화드릴게요"라고 마칩니다.
승인 결과 안내를 마쳤으면 finish_demo_conversation으로 통화를 마칩니다. 승인 전에는 이 도구로 조기 종료하지 마세요.
승인 전에는 기관 연결·접수·배송을 완료했다고 말하지 마세요. 대화 중 계속 후보 선택을 고객에게 떠넘기지 마세요.
도구 오류이면 아직 확인하지 못했다고 짧게 알리고 완료·확정 사실을 만들지 마세요.
'''


def callback_prompt(job):
    question = ('안내한 다음 기회에 맞춰 다시 연락받으려면 1번, 원하지 않으면 2번을 누르도록 물으세요. '
                '실제 숫자키 뒤 서버가 예약 기록을 확인한 경우에만 기록됐다고 말하세요.'
                if job.get('nextOpportunity') else '안내를 들으셨으면 1번을 누르도록 안내하세요.')
    return ('''말결 시연 결과를 알려드리는 전화입니다. 기관 응답과 배송은 모의이며 실제 음식 배송은 없습니다.
첫 인사는 "말결 시연 결과를 알려드리려고 전화드렸습니다"입니다.
아래 서버 결과를 짧고 쉬운 한국어로 읽으세요. 새 인터뷰나 후보 선택을 다시 시작하지 마세요.
지원 가능·신청 접수·배송 예정·실제 출발은 구분하고, 서버가 확정하지 않은 내용을 만들지 마세요.
지원 불가라면 왜 지금 안 되는지와 다음 실제 시연 기회의 조건·시간을 빠뜨리지 마세요.
''' + question + ' 답변 저장 결과를 안내한 뒤 finish_demo_conversation으로 통화를 마치세요.\n서버 확인 결과:\n' + job['message'])


class DemoVoiceRuntime:
    def __init__(self, api, journal, routing):
        self.api, self.journal, self.routing = api, journal, routing
        self.agent = None
        self.active = None
        self.dispatching = False
        self.wake = asyncio.Event()

    async def send(self, operation, fields):
        return await self.api.send('POST', PREFIX + '/' + operation, fields)

    async def bind(self, call):
        if self.active and self.active != call.call_id:
            raise ToolError('다른 통화가 진행 중입니다.')
        if call.direction == 'outbound':
            outbound = OUTBOUND_DEMO.get()
            if not outbound or outbound.get('role') != 'demo_callback':
                raise ToolError('시연 고객 회신 맥락이 없습니다.')
            ctx = {**outbound, 'callId': call.call_id}
        else:
            citizen = self.routing.citizen(call.from_number)
            if not citizen:
                raise ToolError('등록된 회신 경로가 필요합니다.')
            result = await self.send('begin', {'callId': call.call_id, 'citizenRef': citizen})
            ctx = {'role': 'demo_citizen', 'callId': call.call_id, 'citizenRef': citizen,
                   'serverNow': result.get('serverNow'), 'timezone': result.get('timezone', 'Asia/Seoul')}
        self.active = call.call_id
        self.journal.put('demo:call:' + call.call_id, ctx)
        return ctx

    def tools(self, ctx):
        async def finish_demo_conversation() -> str:
            """서버가 승인 또는 콜백 답변을 확인한 뒤 인사를 마치고 통화를 종료합니다."""
            key = ('demo:decision:' if ctx['role'] == 'demo_citizen' else 'demo:ack:') + ctx['callId']
            decision = self.journal.get(key) or {}
            if not decision or (ctx['role'] == 'demo_citizen' and decision.get('approved') is not True):
                raise ToolError('먼저 실제 숫자키 답변 결과를 확인해 주세요.')
            self.journal.put('demo:finish:' + ctx['callId'], {'ready': True})
            return encode({'message': '짧게 인사하면 통화를 마칩니다.'})
        if ctx['role'] != 'demo_citizen': return [finish_demo_conversation]

        async def update_demo_request(patch_json: str, evidence_quote: str) -> str:
            """이번 답을 누적/수정합니다. JSON keys: item,quantity,region,neededBy(ISO timezone),
            dietaryRestrictions[],alternatives[](우선순위),maxCostKrw,receivingMethod(delivery/pickup),
            noMatchPreference(offer_callback/stop),consent:{contact,submit,callback}. 실제 답만 넣으세요."""
            try: patch = json.loads(patch_json)
            except ValueError: raise ToolError('답변 항목을 다시 정리해 주세요.')
            if not isinstance(patch, dict) or not patch:
                raise ToolError('답변 항목이 필요합니다.')
            if not evidence_quote.strip() or evidence_quote not in '\n'.join(ctx.get('_heard_turns', []) + [ctx.get('_heard', '')]):
                raise ToolError('이번 통화에서 실제로 들은 답변 원문이 필요합니다.')
            self.journal.put('demo:challenge:' + ctx['callId'], {})
            self.journal.put('demo:approved:' + ctx['callId'], {})
            self.journal.put('demo:decision:' + ctx['callId'], {})
            self.journal.put('demo:finish:' + ctx['callId'], {})
            return encode(await self.send('interview', {'callId': ctx['callId'], 'patch': patch, 'evidenceQuote': evidence_quote}))

        async def prepare_demo_approval() -> str:
            """서버의 정확한 readback을 읽고 수정 또는 실제 숫자키1 승인/2 수정를 받습니다."""
            result = await self.send('seed', {'callId': ctx['callId']})
            if all(result.get(k) for k in ('nonce', 'seedHash')):
                self.journal.put('demo:challenge:' + ctx['callId'], {k: result[k] for k in ('nonce', 'seedHash')})
            return encode(result)

        async def get_demo_status() -> str:
            """현재 통화의 누적 답·누락 항목·확인 상태만 읽습니다."""
            from urllib.parse import quote
            return encode(await self.api.send('GET', PREFIX + '/status?callId=' + quote(ctx['callId'], safe='')))

        return [update_demo_request, prepare_demo_approval, get_demo_status, finish_demo_conversation]

    async def dtmf(self, call, digit):
        ctx = self.journal.get('demo:call:' + call.call_id)
        if not ctx or digit not in {'1', '2'}: return
        # SDK passive digits must not independently trigger a second interpretation.
        call._passive_dtmf_buffer.clear()
        call._passive_dtmf_task = None
        try:
            if ctx['role'] == 'demo_citizen':
                challenge = self.journal.get('demo:challenge:' + call.call_id) or {}
                if not challenge: return
                result = await self.send('approve', {'callId': call.call_id, **challenge, 'digit': digit})
                self.journal.put('demo:challenge:' + call.call_id, {})
                accepted = digit == '1' and result.get('approved') is True
                self.journal.put('demo:decision:' + call.call_id, {'digit': digit, 'approved': True} if accepted else {})
                self.journal.put('demo:approved:' + call.call_id, {'citizenRef': ctx['citizenRef']} if accepted else {})
                self.journal.put('demo:finish:' + call.call_id, {})
                if digit == '2':
                    message = '수정할 부분을 말씀해 주세요. 수정 후 다시 읽어드리겠습니다.'
                else:
                    message = result.get('message', '승인 결과를 기록했습니다.' if accepted else '승인이 확인되지 않았습니다. 내용을 다시 확인해 주세요.')
            else:
                job = ctx['job']
                result = await self.send('callback/answer', {'callId': job['callId'], 'jobId': job['id'], 'digit': digit})
                self.journal.put('demo:ack:' + call.call_id, {'digit': digit, 'at': datetime.now(timezone.utc).isoformat()})
                message = result.get('message', '답변을 기록했습니다.')
        except Exception:
            message = '저장 결과를 확인하지 못했습니다. 완료나 예약이 확정된 것으로 안내하지 않겠습니다.'
        session = self.agent._call_sessions.get(call.call_id)
        if session: await session.feed_dtmf('server_result=' + encode({'message': message}))

    async def ended(self, call, reason=None):
        ctx = self.journal.get('demo:call:' + call.call_id)
        if not ctx: return
        if not self.journal.claim('demo:ended:' + call.call_id, {'at': datetime.now(timezone.utc).isoformat()}): return
        try:
            if ctx['role'] == 'demo_citizen':
                approved = self.journal.get('demo:approved:' + call.call_id)
                if approved:
                    self.journal.put('demo:pending:' + call.call_id, {'citizenRef': approved['citizenRef'], 'status': 'pending'})
            else:
                job = ctx['job']
                transcript = self.journal.get('demo:transcript:' + call.call_id) or {'events': []}
                ack = self.journal.get('demo:ack:' + call.call_id)
                receipt_id = 'demo:receipt:' + call.call_id
                receipt = {'sourceCallId': job['callId'], 'jobId': job['id'], 'providerCallId': call.call_id,
                           'answered': bool(ctx.get('_answered')), 'acknowledged': bool(ack),
                           'completed': reason is None and getattr(call, 'ended_status', None) == 'completed',
                           'events': transcript['events'], 'at': datetime.now(timezone.utc).isoformat()}
                self.journal.put(receipt_id, receipt)
                await self.send('callback/receipt', {k: receipt[k] for k in ('jobId', 'answered', 'acknowledged', 'completed')} |
                                {'callId': job['callId'], 'receiptRef': receipt_id})
        finally:
            if self.active == call.call_id: self.active = None
            self.wake.set()

    async def started(self, call):
        ctx = self.journal.get('demo:call:' + call.call_id)
        if ctx:
            ctx['_answered'] = True
            self.journal.put('demo:call:' + call.call_id, ctx)

    async def transcript(self, call, role, text):
        ctx = self.journal.get('demo:call:' + call.call_id)
        if not ctx: return
        key = 'demo:transcript:' + call.call_id
        receipt = self.journal.get(key) or {'events': []}
        if len(receipt['events']) < 500:
            receipt['events'].append({'at': datetime.now(timezone.utc).isoformat(), 'role': role, 'text': text[:4000]})
            self.journal.put(key, receipt)

    async def dispatch(self, source_call_id):
        if self.active: raise ToolError('다른 통화가 진행 중입니다.')
        await self.send('run', {'callId': source_call_id})
        result = await self.send('callback/claim', {'callId': source_call_id})
        job = result.get('job')
        if not job: return
        if job.get('mode') != 'SIMULATION' or job.get('callId') != source_call_id:
            raise ToolError('시연 회신 범위가 일치하지 않습니다.')
        citizen = job.get('citizenRef', job.get('callerRef'))
        original = self.journal.get('demo:approved:' + source_call_id) or {}
        if citizen != original.get('citizenRef'): raise ToolError('회신 대상이 일치하지 않습니다.')
        # The only dial target is the existing private citizen mapping. Never institutions.
        number = self.routing.destination('callback', citizen)
        context = {'role': 'demo_callback', 'job': job, 'citizenRef': citizen}
        token = OUTBOUND_DEMO.set(context)
        call = None
        try:
            call = await self.agent.call(number, timeout=25, machine_detection='Hangup')
            await asyncio.wait_for(call.wait(), 180)
            await self.ended(call)
        except Exception:
            if call:
                try: await call.hangup()
                except Exception: pass
                await self.ended(call, 'unknown')
            raise ToolError('회신 결과를 확인해야 합니다. 자동 재발신하지 않습니다.') from None
        finally: OUTBOUND_DEMO.reset(token)

    async def worker(self):
        while True:
            await self.wake.wait(); self.wake.clear()
            if self.active or self.dispatching: continue
            for key, row in self.journal.entries('demo:pending:'):
                if row.get('status') != 'pending': continue
                self.dispatching = True
                self.journal.put(key, {**row, 'status': 'claimed'})
                try:
                    await self.dispatch(key.removeprefix('demo:pending:'))
                    self.journal.put(key, {**row, 'status': 'finished'})
                except Exception:
                    self.journal.put(key, {**row, 'status': 'needs-reconciliation'})
                finally: self.dispatching = False


def make_demo_agent_class(base, gemini, registry_type):
    class BoundGemini(gemini):
        async def _handle_response(self, response):
            content = getattr(response, 'server_content', None)
            transcript = getattr(content, 'input_transcription', None) if content else None
            if transcript and getattr(transcript, 'text', ''):
                if self.context.pop('_heard_complete', False):
                    self.context.setdefault('_heard_turns', []).append(self.context.get('_heard', ''))
                    self.context['_heard_turns'] = self.context['_heard_turns'][-40:]
                    self.context['_heard'] = ''
                self.context['_heard'] = (self.context.get('_heard', '') + transcript.text)[-2000:]
            await super()._handle_response(response)
            if content and getattr(content, 'turn_complete', False):
                self.context['_heard_complete'] = True
                if self.runtime.journal.get('demo:finish:' + self.context['callId']) and not getattr(self, '_ending', False):
                    self._ending = True
                    async def close_after_audio():
                        await asyncio.sleep(2)
                        if not self.runtime.journal.get('demo:finish:' + self.context['callId']):
                            self._ending = False
                            return
                        try: await self._call.hangup()
                        except Exception: pass
                    asyncio.create_task(close_after_audio())

    class DemoAgent(base):
        def __init__(self, runtime, **kwargs):
            self.runtime = runtime
            super().__init__(session_factory=lambda: None, builtin_tools=[], recording=False, **kwargs)

        async def _handle_incoming(self, data):
            if self.runtime.active or self.runtime.dispatching or not self.runtime.routing.citizen(data.get('from', '')):
                if self._control_ws:
                    await self._control_ws.send({'event': 'call.session_failed', 'callId': data['callId'], 'reason': 'RoutingUnavailable', 'message': '등록된 통화 경로 또는 통화 순서 확인 필요'})
                return
            await super()._handle_incoming(data)

        async def _open_session(self, call_id):
            if call_id in self._call_sessions: return self._call_sessions[call_id]
            ctx = await self.runtime.bind(self._active_sessions[call_id])
            registry = registry_type()
            for handler in self.runtime.tools(ctx):
                @functools.wraps(handler)
                async def guarded(*args, _handler=handler, **kwargs):
                    try: return await _handler(*args, **kwargs)
                    except ToolError as error: return encode({'error': str(error)})
                    except Exception: return encode({'error': '현재 처리 상태를 확인하지 못했습니다. 완료로 안내하지 마세요.'})
                registry.register(guarded)
            prompt = callback_prompt(ctx['job']) if ctx['role'] == 'demo_callback' else INTERVIEW_PROMPT + '\n서버 시각: ' + encode({'serverNow': ctx.get('serverNow'), 'timezone': ctx.get('timezone')})
            session = BoundGemini(system_prompt=prompt, model=os.environ['GEMINI_LIVE_MODEL'], language='ko', greeting=True)
            session.bound_registry = registry; session.context = ctx; session.runtime = self.runtime
            self._call_sessions[call_id] = session
            return session

        def _inject_session_deps(self, session, tools, *, recorder=None):
            return super()._inject_session_deps(session, session.bound_registry, recorder=recorder)
    return DemoAgent
