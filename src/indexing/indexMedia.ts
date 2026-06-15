import type { Config } from '../lib/config';
import type { Logger } from '../lib/logger';
import type { GenAiClients } from '../lib/adapters/genai';
import type {
  ChunkStore,
  CreatorStore,
  IgGraphPort,
  MediaIndexStore,
  SecretStorePort,
} from '../lib/ports';
import type { ChunkInput, MediaItem, Segment } from '../types';
import { buildChunkDrafts, computeContentHash, type ChunkInputs } from './chunking';

export interface IndexMediaDeps {
  creators: CreatorStore;
  secrets: SecretStorePort;
  ig: IgGraphPort;
  genai: GenAiClients;
  chunks: ChunkStore;
  mediaIndex: MediaIndexStore;
  cfg: Config;
  logger: Logger;
}

/** Index one media into its chunk set. Idempotent + repairable (ADR 004). */
export function createIndexMedia(deps: IndexMediaDeps) {
  return async function indexMedia(creatorId: string, media: MediaItem): Promise<void> {
    const log = deps.logger.child({ creatorId, mediaId: media.id });
    const setStatus = (
      status: 'partial' | 'complete' | 'skipped' | 'failed',
      extra: { segmentCount?: number | null; contentHash?: string; lastError?: string } = {},
    ) =>
      deps.mediaIndex.set({
        creatorId,
        mediaId: media.id,
        status,
        segmentCount: extra.segmentCount ?? null,
        contentHash: extra.contentHash ?? '',
        updatedAt: new Date(),
        ...(extra.lastError ? { lastError: extra.lastError } : {}),
      });

    try {
      const segments = await collectSegments(creatorId, media, deps, log);
      const imageDescription =
        deps.cfg.indexImageDescriptions && media.mediaType === 'IMAGE' && media.mediaUrl
          ? await deps.genai.llm.describeImage({ url: media.mediaUrl })
          : null;

      const inputs: ChunkInputs = {
        mediaType: media.mediaType,
        caption: media.caption,
        segments,
        imageDescription,
      };
      const contentHash = computeContentHash(inputs);

      const existing = await deps.mediaIndex.get(creatorId, media.id);
      if (existing && existing.status === 'complete' && existing.contentHash === contentHash) {
        log.debug('index: unchanged, skip');
        return;
      }

      const drafts = buildChunkDrafts(inputs);
      if (drafts.length === 0) {
        await deps.chunks.replaceChunksForMedia(creatorId, media.id, []); // clear any stale chunks
        await setStatus('skipped', { contentHash, segmentCount: segments.length });
        log.info('index: no text, skipped');
        return;
      }

      await setStatus('partial', { contentHash, segmentCount: segments.length });

      const postedAt = media.timestamp ? new Date(media.timestamp) : new Date();
      const chunkInputs: ChunkInput[] = [];
      for (const draft of drafts) {
        const { vector, norm } = await deps.genai.embedding.embed(draft.text, 'RETRIEVAL_DOCUMENT');
        chunkInputs.push({
          chunkId: `${media.id}_${draft.index}`,
          creatorId,
          mediaId: media.id,
          permalink: media.permalink,
          mediaType: media.mediaType,
          mediaProductType: media.mediaProductType,
          text: draft.text,
          startSec: draft.startSec,
          endSec: draft.endSec,
          embedding: vector,
          embeddingNorm: norm,
          postedAt,
        });
      }

      await deps.chunks.replaceChunksForMedia(creatorId, media.id, chunkInputs);
      await setStatus('complete', { contentHash, segmentCount: segments.length });
      log.info('index: complete', { chunks: chunkInputs.length });
    } catch (e) {
      await setStatus('failed', { lastError: String(e) }).catch(() => undefined);
      log.error('index: failed', { error: String(e) });
      throw e; // let the queue retry; status='failed' allows repair
    }
  };
}

async function collectSegments(
  creatorId: string,
  media: MediaItem,
  deps: IndexMediaDeps,
  log: Logger,
): Promise<Segment[]> {
  if (media.mediaType === 'VIDEO') {
    if (!media.mediaUrl) {
      log.warn('index: VIDEO has no media_url (copyright-flagged?), no transcript');
      return [];
    }
    return deps.genai.llm.transcribeVideo({ url: media.mediaUrl });
  }
  if (media.mediaType === 'CAROUSEL_ALBUM') {
    const creator = await deps.creators.get(creatorId);
    if (!creator) return [];
    const token = await deps.secrets.getCreatorToken(creator.tokenSecretRef);
    const children = await deps.ig.getChildren(token, media.id);
    const segments: Segment[] = [];
    for (const child of children) {
      if (child.mediaType === 'VIDEO' && child.mediaUrl) {
        segments.push(...(await deps.genai.llm.transcribeVideo({ url: child.mediaUrl })));
      }
    }
    return segments;
  }
  return [];
}
