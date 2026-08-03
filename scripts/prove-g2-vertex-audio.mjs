import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OrderService } from '../src/g2/orderService.ts';
import { ALLOWED_DEMO_SKU, validateIntent } from '../src/g2/validator.ts';

const accessToken = process.env.VERTEX_ACCESS_TOKEN;
const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const outputPath = resolve(process.argv[2] ?? 'proof/g2-vertex-audio.json');

if (!accessToken || !project) throw new Error('VERTEX_ACCESS_TOKEN and GOOGLE_CLOUD_PROJECT are required');

const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
const schema = {
  type: 'OBJECT',
  properties: {
    sku: { type: 'STRING' },
    quantity: { type: 'INTEGER' },
    substitutionsAllowed: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    ambiguityReasons: { type: 'ARRAY', items: { type: 'STRING' } },
    readbackSentence: { type: 'STRING' }
  },
  required: ['sku', 'quantity', 'substitutionsAllowed', 'confidence', 'ambiguityReasons', 'readbackSentence']
};

const prompt = `다음 한국어 음성을 복지 식사 주문 후보로 구조화하세요.
승인 SKU는 ${ALLOWED_DEMO_SKU} 하나뿐입니다.
도시락 또는 식사 한 개를 명확히 요청하면 sku=${ALLOWED_DEMO_SKU}, quantity=1로 정리하세요.
"그거", "아무거나", 품목 미지정, 수량 미지정, 대체 의도 충돌이 있으면 confidence를 0.89 이하로 두고 ambiguityReasons에 한국어 이유를 넣으세요.
명확한 "바꾸지 말아 주세요"는 substitutionsAllowed=false입니다.
추측으로 빈 필드를 채우지 마세요.
readbackSentence는 이용자에게 다시 읽어줄 짧고 쉬운 한국어 질문입니다.
지갑, 결제, 거래, 서명, 개인정보, 건강정보나 최종 지급 판단을 출력하지 마세요.`;

async function analyzeAudio(path) {
  const bytes = await readFile(path);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'audio/mpeg', data: bytes.toString('base64') } }
        ]
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: schema
      }
    })
  });
  const responseJson = await response.json();
  if (!response.ok) throw new Error(`Vertex ${response.status}: ${JSON.stringify(responseJson)}`);
  const text = responseJson.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
  if (!text) throw new Error('Vertex response has no text');
  const intent = JSON.parse(text);
  return {
    bytes,
    intent,
    validation: validateIntent(intent),
    responseMetadata: {
      modelVersion: responseJson.modelVersion ?? model,
      responseId: responseJson.responseId ?? null,
      usageMetadata: responseJson.usageMetadata ?? null,
      finishReason: responseJson.candidates?.[0]?.finishReason ?? null
    }
  };
}

class FixedClock {
  now() { return 1785405000000; }
}

class FixedNonce {
  generate() { return 'g2-live-audio-proof-001'; }
}

async function runCase(id, file, expected) {
  const analyzed = await analyzeAudio(resolve(file));
  const interpreter = {
    async analyzeAudio() { return analyzed.intent; }
  };
  const service = new OrderService(interpreter, new FixedClock(), new FixedNonce());
  const first = await service.processAudio(analyzed.bytes, 'audio/mpeg');
  const confirmation = first.status === 'AWAITING_CONFIRMATION'
    ? service.confirmOrder(first.challenge, true)
    : null;
  const observed = confirmation?.status === 'COMMITTED' ? 'AWAITING_CONFIRMATION' : first.status;
  if (observed !== expected) throw new Error(`${id}: expected ${expected}, observed ${observed}`);
  return {
    id,
    input: {
      file,
      mimeType: 'audio/mpeg',
      bytes: analyzed.bytes.byteLength,
      sha256: createHash('sha256').update(analyzed.bytes).digest('hex')
    },
    gemini: {
      intent: analyzed.intent,
      validation: analyzed.validation,
      metadata: analyzed.responseMetadata
    },
    service: {
      first,
      confirmation
    },
    expected,
    observed,
    pass: true
  };
}

const cases = [
  await runCase('clear-korean-meal', 'fixtures/g2/clear-meal-order.mp3', 'AWAITING_CONFIRMATION'),
  await runCase('ambiguous-korean-order', 'fixtures/g2/ambiguous-order.mp3', 'NEEDS_CLARIFICATION')
];

const proof = {
  schema: 'benefit-settlement-g2-vertex-audio-proof-v1',
  generatedAt: new Date().toISOString(),
  provider: 'Vertex AI',
  project,
  location,
  model,
  endpoint,
  accessTokenPersisted: false,
  realPersonalDataUsed: false,
  cases,
  pass: cases.every((item) => item.pass)
};

await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, model, cases: cases.map(({ id, observed, pass }) => ({ id, observed, pass })), pass: proof.pass })}\n`);
