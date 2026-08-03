import { createHash } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import type { ConversationSession } from './types.ts';

export interface ConversationRepository {
  get(caseId: string): Promise<ConversationSession | undefined>;
  save(session: ConversationSession): Promise<void>;
}

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly sessions = new Map<string, ConversationSession>();

  async get(caseId: string): Promise<ConversationSession | undefined> {
    const value = this.sessions.get(caseId);
    return value ? structuredClone(value) : undefined;
  }

  async save(session: ConversationSession): Promise<void> {
    const current = this.sessions.get(session.caseId);
    if (current && current.sessionId !== session.sessionId) throw new Error('Conversation session identity conflict');
    if (current && session.revision !== current.revision + 1) throw new Error('Conversation revision conflict');
    if (!current && session.revision !== 1) throw new Error('Conversation revision conflict');
    this.sessions.set(session.caseId, structuredClone(session));
  }
}

export class FirestoreConversationRepository implements ConversationRepository {
  constructor(private readonly db = new Firestore()) {}

  async get(caseId: string): Promise<ConversationSession | undefined> {
    const snapshot = await this.db.collection('foodConversationSessions').doc(caseId).get();
    return snapshot.exists ? sanitizeStoredSession(snapshot.data() as ConversationSession) : undefined;
  }

  async save(session: ConversationSession): Promise<void> {
    const ref = this.db.collection('foodConversationSessions').doc(session.caseId);
    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const current = snapshot.data() as ConversationSession;
        if (current.sessionId !== session.sessionId) throw new Error('Conversation session identity conflict');
        const currentRevision = current.revision ?? current.turns.length;
        if (session.revision !== currentRevision + 1) throw new Error('Conversation revision conflict');
      } else if (session.revision !== 1) {
        throw new Error('Conversation revision conflict');
      }
      transaction.set(ref, session);
    });
  }
}

function sanitizeStoredSession(value: ConversationSession): ConversationSession {
  return {
    ...value,
    revision: value.revision ?? value.turns.length,
    turns: value.turns.map(turn => ({
      ...turn,
      query: {
        ...turn.query,
        text: /^sha256:[a-f0-9]{64}$/.test(turn.query.text)
          ? turn.query.text
          : `sha256:${createHash('sha256').update(turn.query.text).digest('hex')}`
      }
    }))
  };
}
