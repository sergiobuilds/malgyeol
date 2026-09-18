"""Approved ClawOps/Gemini inbound bridge. No purchase tools or generated approval."""
import asyncio
import json
import logging
import os

import aiohttp
from clawops.agent import ClawOpsAgent, GeminiRealtime

PROMPT = """말결의 한국어 지원 요청 연습 전화입니다.
첫 인사는 '말결입니다. 지금은 연습용으로 실제 배송은 되지 않습니다. 필요한 식품이나 생필품, 식사 지원을 말씀해 주세요.'입니다.
짧고 쉬운 말로 한 번에 한 가지씩 안내하세요. 이용자 발화는 서버가 검사합니다.
server_result로 받은 message만 접수와 확인의 근거로 삼으세요. 요청 내용을 읽은 뒤 숫자키 1번 확인, 2번 취소를 안내하세요.
말로 한 승인이나 당신의 판단으로 접수하지 않습니다. 상품, 지원계획, 수행기관 전달, 배송 성공을 만들지 마세요.
이름·주소·전화번호를 묻거나 반복하지 마세요. 자격·급여·계획을 판단하지 않습니다.
위험 신호는 자동 접수하지 않으며 담당자 확인을 안내하고 긴급 건강 위험은 119를 안내하세요.
이용자 결제, 지원금 잔액, 구매나 민간 쇼핑은 지원하지 않습니다.
"""


class CareGeminiRealtime(GeminiRealtime):
    """Pinned SDK hook: transcript events are fragments, turn_complete closes one utterance."""
    async def _handle_response(self, response):
        await super()._handle_response(response)
        content = getattr(response, 'server_content', None)
        if self._call and content and getattr(content, 'turn_complete', False):
            await self._call._emit('care_user_turn_complete')


async def main():
    required = ['CLAWOPS_API_KEY', 'CLAWOPS_ACCOUNT_ID', 'CLAWOPS_PHONE_NUMBER',
                'GOOGLE_CLOUD_PROJECT', 'GEMINI_LIVE_MODEL', 'AGENT_API_BASE_URL', 'AGENT_TOOL_SECRET']
    if any(not os.environ.get(key) for key in required):
        raise RuntimeError('Required runtime environment is incomplete')
    if len(os.environ['AGENT_TOOL_SECRET']) < 32:
        raise RuntimeError('Agent tool credential is too short')
    # SDK logs can include caller numbers; operational output deliberately excludes them.
    logging.getLogger('clawops').setLevel(logging.CRITICAL)
    agent = ClawOpsAgent(
        api_key=os.environ['CLAWOPS_API_KEY'], account_id=os.environ['CLAWOPS_ACCOUNT_ID'],
        from_=os.environ['CLAWOPS_PHONE_NUMBER'],
        session_factory=lambda: CareGeminiRealtime(system_prompt=PROMPT,
            model=os.environ['GEMINI_LIVE_MODEL'], language='ko', greeting=True),
        builtin_tools=[], recording=False,
    )
    tokens = {}
    locks = {}
    utterances = {}
    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout, headers={
        'Authorization': 'Bearer ' + os.environ['AGENT_TOOL_SECRET']
    }) as client:
        async def api(operation, call_id, **fields):
            async with client.post(os.environ['AGENT_API_BASE_URL'].rstrip('/') + '/internal/care-agent/' + operation,
                                   json={'callId': call_id, **fields}) as response:
                if response.status != 200:
                    raise RuntimeError('Care API request failed')
                return await response.json()

        async def say_result(call_id, result):
            session = agent._call_sessions.get(call_id)
            if session:
                await session.feed_dtmf('server_result=' + json.dumps({'message': result['message']}, ensure_ascii=False))

        @agent.on('call_start')
        async def begin(call):
            locks[call.call_id] = asyncio.Lock()
            utterances[call.call_id] = ''
            await api('begin', call.call_id)

        @agent.on('transcript')
        async def transcript(call, role, text):
            if role != 'user' or not text.strip() or call.call_id not in locks:
                return
            current = utterances.get(call.call_id, '')
            utterances[call.call_id] = (current + text) if len(current) <= 512 else current

        @agent.on('care_user_turn_complete')
        async def completed_turn(call):
            if call.call_id not in locks or not utterances.get(call.call_id):
                return
            async with locks[call.call_id]:
                text = utterances.pop(call.call_id, '')
                result = await api('select', call.call_id, text=text if len(text) <= 512 else '길이 초과로 담당자 확인 필요')
                tokens[call.call_id] = result.get('token', '')
                await say_result(call.call_id, result)

        @agent.on('dtmf')
        async def dtmf(call, digit):
            if call.call_id not in locks:
                return
            call._passive_dtmf_buffer.clear()
            call._passive_dtmf_task = None
            async with locks[call.call_id]:
                if utterances.get(call.call_id):
                    await say_result(call.call_id, {'message': '말씀을 확인 중입니다. 요청 내용을 다시 들으신 뒤 눌러 주세요.'})
                    return
                try:
                    result = await api('confirm', call.call_id, token=tokens.get(call.call_id, ''), digit=digit)
                except Exception:
                    result = {'message': '접수 결과를 확인하지 못했습니다. 다시 요청하지 말고 담당자 확인을 받아 주세요.'}
                await say_result(call.call_id, result)

        @agent.on('call_end')
        async def end(call):
            try:
                await api('end', call.call_id)
            finally:
                tokens.pop(call.call_id, None)
                locks.pop(call.call_id, None)
                utterances.pop(call.call_id, None)

        print('Starting care inbound bridge; real-call evidence pending', flush=True)
        await agent.connect()
        print('ClawOps control WebSocket connected; audio call unverified', flush=True)
        await agent.serve(health_port=18082)


if __name__ == '__main__':
    asyncio.run(main())
