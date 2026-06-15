import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Config } from '../config';
import type {
  ChunkStore,
  ConversationStore,
  CreatorStore,
  DedupeStore,
  MediaIndexStore,
  OptOutStore,
} from '../ports';
import type {
  ChunkInput,
  Creator,
  CreatorStatus,
  MediaIndexRecord,
  MediaType,
  MediaProductType,
  RetrievedChunk,
} from '../../types';

const COL = {
  chunks: 'chunks',
  creators: 'creators',
  mediaIndex: 'media_index',
  optouts: 'optouts',
  seenMids: 'seen_mids',
  conversations: 'conversations',
} as const;

const DISTANCE_FIELD = 'vector_distance';

let dbSingleton: Firestore | null = null;

export function getDb(cfg: Config): Firestore {
  if (dbSingleton) return dbSingleton;
  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      ...(cfg.googleCloudProject ? { projectId: cfg.googleCloudProject } : {}),
    });
  }
  dbSingleton =
    cfg.firestoreDatabaseId && cfg.firestoreDatabaseId !== '(default)'
      ? getFirestore(cfg.firestoreDatabaseId)
      : getFirestore();
  return dbSingleton;
}

function alreadyExists(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 6; // ALREADY_EXISTS
}

const key = (a: string, b: string): string => `${a}_${b}`;

// ── Dedupe ────────────────────────────────────────────────────────────────────
export function firestoreDedupe(db: Firestore): DedupeStore {
  return {
    async markSeen(mid) {
      try {
        await db.collection(COL.seenMids).doc(mid).create({ at: FieldValue.serverTimestamp() });
        return true;
      } catch (e) {
        if (alreadyExists(e)) return false;
        throw e;
      }
    },
  };
}

// ── Creators ──────────────────────────────────────────────────────────────────
export function firestoreCreators(db: Firestore): CreatorStore {
  const col = () => db.collection(COL.creators);
  return {
    async get(creatorId) {
      const snap = await col().doc(creatorId).get();
      if (!snap.exists) return null;
      const d = snap.data() ?? {};
      const creator: Creator = {
        creatorId,
        tokenSecretRef: String(d.tokenSecretRef ?? ''),
        tokenExpiresAt: d.tokenExpiresAt instanceof Timestamp ? d.tokenExpiresAt.toDate() : null,
        status: (d.status as CreatorStatus) ?? 'active',
        pollHighWaterMark:
          d.pollHighWaterMark instanceof Timestamp ? d.pollHighWaterMark.toDate() : null,
      };
      return creator;
    },
    async setStatus(creatorId, status) {
      await col().doc(creatorId).set({ status }, { merge: true });
    },
    async setPollHighWaterMark(creatorId, at) {
      await col().doc(creatorId).set({ pollHighWaterMark: Timestamp.fromDate(at) }, { merge: true });
    },
  };
}

// ── Opt-out ───────────────────────────────────────────────────────────────────
export function firestoreOptOut(db: Firestore): OptOutStore {
  const ref = (c: string, u: string) => db.collection(COL.optouts).doc(key(c, u));
  return {
    async isOptedOut(c, u) {
      return (await ref(c, u).get()).exists;
    },
    async setOptOut(c, u) {
      try {
        await ref(c, u).create({ at: FieldValue.serverTimestamp() });
        return { transitioned: true };
      } catch (e) {
        if (alreadyExists(e)) return { transitioned: false };
        throw e;
      }
    },
    async clearOptOut(c, u) {
      return db.runTransaction(async (t) => {
        const snap = await t.get(ref(c, u));
        if (!snap.exists) return { transitioned: false };
        t.delete(ref(c, u));
        return { transitioned: true };
      });
    },
  };
}

// ── Conversations (disclosure) ──────────────────────────────────────────────────
export function firestoreConversations(db: Firestore): ConversationStore {
  const ref = (c: string, u: string) => db.collection(COL.conversations).doc(key(c, u));
  return {
    async markDisclosedIfFirst(c, u) {
      try {
        await ref(c, u).create({ disclosedAt: FieldValue.serverTimestamp() });
        return true;
      } catch (e) {
        if (alreadyExists(e)) return false;
        throw e;
      }
    },
  };
}

// ── Media index ─────────────────────────────────────────────────────────────────
export function firestoreMediaIndex(db: Firestore): MediaIndexStore {
  const ref = (c: string, m: string) => db.collection(COL.mediaIndex).doc(key(c, m));
  return {
    async get(creatorId, mediaId) {
      const snap = await ref(creatorId, mediaId).get();
      if (!snap.exists) return null;
      const d = snap.data() ?? {};
      return {
        creatorId,
        mediaId,
        status: d.status as MediaIndexRecord['status'],
        segmentCount: typeof d.segmentCount === 'number' ? d.segmentCount : null,
        contentHash: String(d.contentHash ?? ''),
        updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt.toDate() : new Date(0),
        ...(d.lastError ? { lastError: String(d.lastError) } : {}),
      };
    },
    async set(record) {
      await ref(record.creatorId, record.mediaId).set({
        status: record.status,
        segmentCount: record.segmentCount,
        contentHash: record.contentHash,
        updatedAt: Timestamp.fromDate(record.updatedAt),
        ...(record.lastError ? { lastError: record.lastError } : {}),
      });
    },
  };
}

// ── Chunks ────────────────────────────────────────────────────────────────────
export function firestoreChunks(db: Firestore): ChunkStore {
  const col = () => db.collection(COL.chunks);
  return {
    async replaceChunksForMedia(creatorId, mediaId, next) {
      const existing = await col().where('creatorId', '==', creatorId).where('mediaId', '==', mediaId).get();
      const nextIds = new Set(next.map((c) => c.chunkId));
      const batch = db.batch();
      for (const doc of existing.docs) {
        if (!nextIds.has(doc.id)) batch.delete(doc.ref);
      }
      for (const c of next) {
        batch.set(col().doc(c.chunkId), chunkToDoc(c));
      }
      await batch.commit();
    },
    async deleteChunksForMedia(creatorId, mediaId) {
      const existing = await col().where('creatorId', '==', creatorId).where('mediaId', '==', mediaId).get();
      const batch = db.batch();
      for (const doc of existing.docs) batch.delete(doc.ref);
      await batch.commit();
    },
    async findNearest(creatorId, queryVector, limit) {
      const vq = col()
        .where('creatorId', '==', creatorId)
        .findNearest({
          vectorField: 'embedding',
          queryVector: FieldValue.vector(queryVector),
          limit,
          distanceMeasure: 'COSINE',
          distanceResultField: DISTANCE_FIELD,
        });
      const snap = await vq.get();
      return snap.docs.map((doc): RetrievedChunk => {
        const d = doc.data();
        return {
          chunkId: doc.id,
          mediaId: String(d.mediaId),
          permalink: String(d.permalink),
          mediaType: d.mediaType as MediaType,
          text: String(d.text),
          startSec: typeof d.startSec === 'number' ? d.startSec : null,
          endSec: typeof d.endSec === 'number' ? d.endSec : null,
          distance: typeof d[DISTANCE_FIELD] === 'number' ? d[DISTANCE_FIELD] : Number.POSITIVE_INFINITY,
        };
      });
    },
    async listIndexedMediaIds(creatorId) {
      const snap = await col().where('creatorId', '==', creatorId).select('mediaId').get();
      const set = new Set<string>();
      for (const doc of snap.docs) set.add(String(doc.get('mediaId')));
      return [...set];
    },
  };
}

function chunkToDoc(c: ChunkInput): Record<string, unknown> {
  return {
    creatorId: c.creatorId,
    mediaId: c.mediaId,
    permalink: c.permalink,
    mediaType: c.mediaType,
    mediaProductType: c.mediaProductType as MediaProductType | null,
    text: c.text,
    startSec: c.startSec,
    endSec: c.endSec,
    embedding: FieldValue.vector(c.embedding),
    embeddingNorm: c.embeddingNorm,
    postedAt: Timestamp.fromDate(c.postedAt),
    createdAt: FieldValue.serverTimestamp(),
  };
}
