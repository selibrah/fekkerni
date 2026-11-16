/**
 * Per-creator usage counters for cost attribution and caps.
 *
 * The spec requires: "per-creator usage counters (videos transcribed, tokens, embeddings)
 * persisted for attribution and caps."
 *
 * This module provides a port + Firestore implementation to atomically increment counters
 * on a per-creator daily document (creators_usage/{creatorId}_{YYYY-MM-DD}).
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export interface UsageCounters {
  videosTranscribed: number;
  embeddingsGenerated: number;
  llmCallsMade: number;
}

export interface UsagePort {
  /** Atomically increment one or more counters for a creator. */
  increment(creatorId: string, deltas: Partial<UsageCounters>): Promise<void>;
  /** Read the current day's counters for a creator (returns zeros if no record). */
  getToday(creatorId: string): Promise<UsageCounters>;
}

const ZERO: UsageCounters = { videosTranscribed: 0, embeddingsGenerated: 0, llmCallsMade: 0 };
const COL = 'creators_usage';

function todayKey(creatorId: string): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${creatorId}_${yyyy}-${mm}-${dd}`;
}

export function firestoreUsage(db: Firestore): UsagePort {
  return {
    async increment(creatorId, deltas) {
      const ref = db.collection(COL).doc(todayKey(creatorId));
      const updates: Record<string, unknown> = {};
      if (deltas.videosTranscribed) updates.videosTranscribed = FieldValue.increment(deltas.videosTranscribed);
      if (deltas.embeddingsGenerated) updates.embeddingsGenerated = FieldValue.increment(deltas.embeddingsGenerated);
      if (deltas.llmCallsMade) updates.llmCallsMade = FieldValue.increment(deltas.llmCallsMade);
      if (Object.keys(updates).length > 0) {
        await ref.set({ creatorId, ...updates }, { merge: true });
      }
    },
    async getToday(creatorId) {
      const snap = await db.collection(COL).doc(todayKey(creatorId)).get();
      if (!snap.exists) return { ...ZERO };
      const d = snap.data() ?? {};
      return {
        videosTranscribed: typeof d.videosTranscribed === 'number' ? d.videosTranscribed : 0,
        embeddingsGenerated: typeof d.embeddingsGenerated === 'number' ? d.embeddingsGenerated : 0,
        llmCallsMade: typeof d.llmCallsMade === 'number' ? d.llmCallsMade : 0,
      };
    },
  };
}

/** In-memory fake for tests. */
export class FakeUsage implements UsagePort {
  readonly counters = new Map<string, UsageCounters>();

  async increment(creatorId: string, deltas: Partial<UsageCounters>): Promise<void> {
    const key = todayKey(creatorId);
    const current = this.counters.get(key) ?? { ...ZERO };
    if (deltas.videosTranscribed) current.videosTranscribed += deltas.videosTranscribed;
    if (deltas.embeddingsGenerated) current.embeddingsGenerated += deltas.embeddingsGenerated;
    if (deltas.llmCallsMade) current.llmCallsMade += deltas.llmCallsMade;
    this.counters.set(key, current);
  }

  async getToday(creatorId: string): Promise<UsageCounters> {
    return this.counters.get(todayKey(creatorId)) ?? { ...ZERO };
  }
}
