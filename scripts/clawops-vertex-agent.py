import asyncio
import json
import os
from typing import Any

import aiohttp
from clawops.agent import ClawOpsAgent, GeminiRealtime


SYSTEM_PROMPT = """
당신은 한국어 식료품 전화 주문 도우미입니다. 이용자는 일반 전화만으로 이용할 수 있습니다.
첫 인사는 "말결 식료품 주문입니다. 시연과 품질 확인을 위해 통화를 녹음합니다. 필요한 먹거리를 말씀해 주세요."라고 짧게 하세요.
대화 원칙은 "짧게, 쉬운 말로, 한 번에 한 가지씩"입니다. 어르신이 듣는다고 생각하고 내부 상태명, 승인, 프로세스, 정책 엔진 같은 말은 하지 마세요.
상품, 가격, 남은 지원금, 주문 성공 여부를 추측하거나 만들어 내면 안 됩니다. 먹거리 요청은 find_food_products 도구로 확인하고 서버가 준 결과만 쉬운 말로 설명하세요.
모든 도구 호출은 현재 통화의 call_id에만 결합되어야 합니다. 다른 통화의 상품·후보·확인 결과를 섞지 마세요.
이용자가 "뭐 살 수 있어", "추천해 줘", "아무거나", "싼 거"처럼 말해도 거절하지 마세요. 서버가 알려준 종류를 짧게 말하고 하나를 고르도록 도와주세요. 종류가 있는 추천 요청은 실제 상품 후보를 찾아 보여주세요.
서버가 CANDIDATES_READY를 반환하면 후보를 최대 3개까지 번호, 상품명, 원산지, 상품가격, 배송비 순으로 천천히 읽고 원하는 번호를 물으세요. 모든 설명을 반복하지 말고 상대가 물은 부분만 답하세요.
번호와 수량을 들으면 select_food_candidate 도구로 다시 확인하세요. AWAITING_CONFIRMATION이면 상품명, 수량, 배송비 포함 총액을 읽고 "남은 지원금을 확인한 뒤 바로 주문하려면 1번, 취소하려면 2번을 눌러 주세요"라고 안내하세요.
숫자키 입력 뒤에는 서버의 한국어 message를 그대로 말하세요. ORDERED일 때만 주문이 접수됐다고 말하세요. 다른 상태는 임의로 주문 성공으로 바꾸지 마세요.
budgetSource가 SYNTHETIC_DEMO이면 "연습용 지원금이라 실제 주문은 되지 않습니다"라고 쉬운 말로 안내하세요.
총기, 무기, 탄약, 불법 약물, 담배, 주류, 상품권, 현금성 요청은 서버 차단 결과에 따라 짧게 거절하세요.
통화 중 이름, 전화번호, 주소를 받거나 반복해서 말하지 마세요. 개인정보가 나오면 먹거리만 다시 말해 달라고 안내하세요.
쌀처럼 모호한 요청은 주문 가능한 대안을 먼저 보여주세요. 여러 품목을 한번에 말하면 "어느 것부터 볼까요"라고 물어 하나씩 도와주세요.
도구 오류나 실제 상품을 찾지 못한 경우 "지금은 상품을 확인하지 못했어요. 다른 먹거리를 말씀해 주세요"라고 안내하세요. 사람에게 넘긴다고 말하지 마세요.
블록체인, 지갑, 토큰, API라는 기술 용어는 이용자에게 말하지 마세요.
""".strip()


class AgentApi:
    def __init__(self, base_url: str, secret: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.secret = secret

    async def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Authorization": f"Bearer {self.secret}"}
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.request(method, f"{self.base_url}{path}", json=body) as response:
                payload = await response.json(content_type=None)
                if response.status >= 400:
                    raise RuntimeError(f"Agent API {response.status}: {payload.get('error', 'request failed')}")
                if not isinstance(payload, dict):
                    raise RuntimeError("Agent API returned a non-object response")
                return payload


async def main() -> None:
    required = [
        "CLAWOPS_API_KEY",
        "CLAWOPS_ACCOUNT_ID",
        "CLAWOPS_PHONE_NUMBER",
        "GOOGLE_CLOUD_PROJECT",
        "AGENT_API_BASE_URL",
        "AGENT_TOOL_SECRET",
    ]
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Missing environment: {', '.join(missing)}")

    tool_secret = os.environ["AGENT_TOOL_SECRET"]
    if len(tool_secret) < 32:
        raise RuntimeError("AGENT_TOOL_SECRET must be at least 32 characters")
    api = AgentApi(os.environ["AGENT_API_BASE_URL"], tool_secret)
    active_cases: dict[str, str] = {}
    active_user_utterances: dict[str, str] = {}

    agent = ClawOpsAgent(
        api_key=os.environ["CLAWOPS_API_KEY"],
        account_id=os.environ["CLAWOPS_ACCOUNT_ID"],
        from_=os.environ["CLAWOPS_PHONE_NUMBER"],
        session=GeminiRealtime(
            system_prompt=SYSTEM_PROMPT,
            model=os.environ.get("GEMINI_LIVE_MODEL", "gemini-live-2.5-flash-native-audio"),
            language="ko",
            greeting=True,
        ),
        recording=True,
        recording_path=os.environ.get("CLAWOPS_RECORDING_PATH", "/tmp/benefit-call-recordings"),
    )

    @agent.on("call_start")
    async def on_call_start(call) -> None:
        result = await api.request("POST", "/internal/food-agent/begin", {
            "callId": call.call_id,
            "callerNumber": getattr(call, "from_number", None),
        })
        case_id = result.get("caseId")
        if not isinstance(case_id, str):
            raise RuntimeError("Agent API did not return a caseId")
        active_cases[call.call_id] = case_id

    @agent.on("dtmf")
    async def on_dtmf(call, digit: str) -> None:
        case_id = active_cases.get(call.call_id)
        if case_id is None:
            return
        try:
            server_result = await api.request(
                "POST",
                "/internal/food-agent/confirmation",
                {"caseId": case_id, "digit": digit},
            )
        except Exception:
            server_result = {
                "message": "확인 결과를 읽지 못했습니다. 아직 주문하지 않았습니다. 잠시 후 다시 눌러 주세요."
            }
        # ClawOps의 패시브 DTMF는 숫자만 Gemini에 전달한다. 서버 판정 결과를
        # 같은 call_id 세션에 함께 넣어야 AI가 확정 상태를 추측하지 않고 말한다.
        session = getattr(agent, "_call_sessions", {}).get(call.call_id)
        if session is not None:
            getattr(agent, "_passive_dtmf_buffer", []).clear()
            agent._passive_dtmf_call_id = None
            message = str(server_result.get("message") or "확인 결과를 읽지 못했습니다. 아직 주문하지 않았습니다. 잠시 후 다시 눌러 주세요.")
            await session.feed_dtmf(f"{digit}; server_result={message}")

    @agent.on("call_end")
    async def on_call_end(call) -> None:
        active_cases.pop(call.call_id, None)
        active_user_utterances.pop(call.call_id, None)

    @agent.on("transcript")
    async def on_transcript(call, role: str, text: str) -> None:
        if role == "user" and text.strip():
            active_user_utterances[call.call_id] = text.strip()[-512:]

    @agent.tool
    async def find_food_products(request_summary: str, call_id: str = "") -> str:
        """이용자의 먹거리 요청을 서버의 개인정보·위험품목 경계와 실제 판매처 검색에 제출합니다. 상품을 직접 만들지 마세요."""
        if not call_id:
            matching = [key for key, utterance in active_user_utterances.items() if utterance == request_summary]
            call_id = matching[0] if len(matching) == 1 else (next(iter(active_cases)) if len(active_cases) == 1 else "")
        case_id = active_cases.get(call_id)
        if case_id is None:
            return json.dumps({"state": "NEEDS_CLARIFICATION", "reason": "active call context unavailable"})
        verbatim_user_request = active_user_utterances.get(call_id, request_summary)
        result = await api.request("POST", "/internal/food-agent/interpret", {
            "caseId": case_id,
            "text": verbatim_user_request,
        })
        return json.dumps(result, ensure_ascii=False)

    @agent.tool
    async def select_food_candidate(candidate_number: int, quantity: int = 1, call_id: str = "") -> str:
        """서버가 방금 반환한 실제 상품 후보 번호와 수량을 정책·예산 엔진에 제출합니다."""
        if not call_id and len(active_cases) == 1:
            call_id = next(iter(active_cases))
        case_id = active_cases.get(call_id)
        if case_id is None:
            return json.dumps({"state": "NEEDS_CLARIFICATION", "reason": "active call context unavailable"})
        result = await api.request("POST", "/internal/food-agent/select", {
            "caseId": case_id,
            "candidateNumber": candidate_number,
            "quantity": quantity,
        })
        return json.dumps(result, ensure_ascii=False)

    @agent.tool
    async def get_case_status(case_id: str, call_id: str = "") -> str:
        """숫자키 입력 뒤 서버가 확정한 정책, 결제, 주문 상태를 읽습니다."""
        if not call_id and len(active_cases) == 1:
            call_id = next(iter(active_cases))
        if active_cases.get(call_id) != case_id:
            return json.dumps({"state": "NEEDS_CLARIFICATION", "reason": "case does not belong to active call"})
        result = await api.request("GET", f"/internal/food-agent/status/{case_id}")
        return json.dumps(result, ensure_ascii=False)

    await agent.serve()


if __name__ == "__main__":
    asyncio.run(main())
