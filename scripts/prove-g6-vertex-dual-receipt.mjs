import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DeliverySettlementService } from '../src/g6/deliverySettlement.ts';

const accessToken = process.env.VERTEX_ACCESS_TOKEN;
const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const outputPath = resolve(process.argv[2] ?? 'proof/g6-vertex-dual-receipt.json');
if (!accessToken || !project) throw new Error('VERTEX_ACCESS_TOKEN and GOOGLE_CLOUD_PROJECT are required');

const endpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
const deliveryBytes = await readFile(resolve('fixtures/g6/delivery-receipt.png'));
const beneficiaryBytes = await readFile(resolve('fixtures/g6/beneficiary-confirmation.txt'));
const metadata = [];

const interpreter = {
  async analyzeDeliveryReceipt(bytes, mimeType) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: '이 합성 배송 영수증을 구조화하세요. orderReference, sku, quantity, delivered, confidence, safeSummary만 출력하세요. 문서에 명시된 값만 쓰고 개인정보를 출력하지 마세요.' },
          { inlineData: { mimeType, data: Buffer.from(bytes).toString('base64') } }
        ] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              orderReference: { type: 'STRING' }, sku: { type: 'STRING' }, quantity: { type: 'INTEGER' },
              delivered: { type: 'BOOLEAN' }, confidence: { type: 'NUMBER' }, safeSummary: { type: 'STRING' }
            },
            required: ['orderReference', 'sku', 'quantity', 'delivered', 'confidence', 'safeSummary']
          }
        }
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Vertex delivery ${response.status}: ${JSON.stringify(body)}`);
    metadata.push({ kind: 'delivery', responseId: body.responseId ?? null, modelVersion: body.modelVersion ?? model, usageMetadata: body.usageMetadata ?? null });
    const text = body.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
    if (!text) throw new Error('Vertex delivery response has no text');
    return JSON.parse(text);
  },
  async analyzeBeneficiaryConfirmation(bytes, mimeType) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: `다음 비식별 수혜자 확인문을 구조화하세요. orderReference, received, confidence, safeSummary만 출력하세요. 이름, 주소, 건강정보를 추론하거나 출력하지 마세요.\n\n확인문:\n${Buffer.from(bytes).toString('utf8')}` }
        ] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              orderReference: { type: 'STRING' }, received: { type: 'BOOLEAN' },
              confidence: { type: 'NUMBER' }, safeSummary: { type: 'STRING' }
            },
            required: ['orderReference', 'received', 'confidence', 'safeSummary']
          }
        }
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`Vertex beneficiary ${response.status}: ${JSON.stringify(body)}`);
    metadata.push({ kind: 'beneficiary', responseId: body.responseId ?? null, modelVersion: body.modelVersion ?? model, usageMetadata: body.usageMetadata ?? null });
    const text = body.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text;
    if (!text) throw new Error('Vertex beneficiary response has no text');
    return JSON.parse(text);
  }
};

const deliveryAnalysis = await interpreter.analyzeDeliveryReceipt(deliveryBytes, 'image/png');
const beneficiaryAnalysis = await interpreter.analyzeBeneficiaryConfirmation(beneficiaryBytes, 'text/plain');
const result = await new DeliverySettlementService({
  async analyzeDeliveryReceipt() { return deliveryAnalysis; },
  async analyzeBeneficiaryConfirmation() { return beneficiaryAnalysis; }
}).verify({
  order: { orderReference: 'ORDER-42', sku: 'DEMO_MEAL_01', quantity: 1 },
  deliveryReceipt: { bytes: deliveryBytes, mimeType: 'image/png' },
  beneficiaryConfirmation: { bytes: beneficiaryBytes, mimeType: 'text/plain' }
});
if (result.status !== 'VERIFIED_FOR_RELEASE') throw new Error(`G6 verification blocked: ${JSON.stringify(result)}`);

const proof = {
  schema: 'benefit-settlement-g6-vertex-dual-receipt-proof-v1',
  generatedAt: new Date().toISOString(),
  provider: 'Vertex AI', project, location, model, endpoint,
  accessTokenPersisted: false,
  realPersonalDataUsed: false,
  privateEvidencePersistedOnchain: false,
  inputs: {
    deliveryReceipt: { mimeType: 'image/png', sha256: createHash('sha256').update(deliveryBytes).digest('hex') },
    beneficiaryConfirmation: { mimeType: 'text/plain', sha256: createHash('sha256').update(beneficiaryBytes).digest('hex') }
  },
  metadata,
  result,
  pass: result.status === 'VERIFIED_FOR_RELEASE' && metadata.length === 2
};
await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, responseIds: metadata.map((item) => item.responseId), status: result.status, pass: proof.pass })}\n`);
