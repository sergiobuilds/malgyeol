import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryConversationRepository } from '../../src/food-support/conversationRepository.ts';
import { createFoodSupportHandlers } from '../../src/http/foodSupportRoutes.ts';
import type { SpecialOfferCatalogAdapter } from '../../src/food-support/specialOffer.ts';

const gatedCatalog = {
  async search() { return { status: 'CREDENTIAL_GATED', provider: 'SPECIAL_OFFER', products: [] }; }
} as unknown as SpecialOfferCatalogAdapter;

test('conversation repository preserves one session and caseId across handler restart', async () => {
  const repository = new InMemoryConversationRepository();
  const firstHandler = createFoodSupportHandlers(gatedCatalog, undefined, repository);
  const first = await firstHandler({
    method: 'POST', pathname: '/api/food-support/interpret', searchParams: new URLSearchParams(),
    body: { caseId: 'web_persistent_food', text: '잡곡 찾아줘' }
  });
  assert.equal(first.status, 200);
  const firstBody = first.body as { caseId: string; sessionId: string; turnCount: number };
  assert.equal(firstBody.turnCount, 1);

  const restartedHandler = createFoodSupportHandlers(gatedCatalog, undefined, repository);
  const second = await restartedHandler({
    method: 'POST', pathname: '/api/food-support/interpret', searchParams: new URLSearchParams(),
    body: { caseId: 'web_persistent_food', text: '제일 싼 걸로' }
  });
  const secondBody = second.body as { caseId: string; sessionId: string; turnCount: number };
  assert.equal(secondBody.caseId, firstBody.caseId);
  assert.equal(secondBody.sessionId, firstBody.sessionId);
  assert.equal(secondBody.turnCount, 2);
});

test('conversation repository rejects another session identity for the same case', async () => {
  const repository = new InMemoryConversationRepository();
  const base = { caseId: 'web_identity', revision: 1, turns: [], createdAt: 1, updatedAt: 1 };
  await repository.save({ ...base, sessionId: 'session_one' });
  await assert.rejects(repository.save({ ...base, sessionId: 'session_two', revision: 2, updatedAt: 2 }), /identity conflict/);
});

test('conversation repository rejects concurrent writes from the same revision', async () => {
  const repository = new InMemoryConversationRepository();
  const base = { caseId: 'web_concurrent', sessionId: 'session_one', revision: 1, turns: [], createdAt: 1, updatedAt: 1 };
  await repository.save(base);
  await repository.save({ ...base, revision: 2, updatedAt: 2 });
  await assert.rejects(repository.save({ ...base, revision: 2, updatedAt: 3 }), /revision conflict/);
});
