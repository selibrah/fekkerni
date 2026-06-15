import type { Config } from '../lib/config';
import type { Logger } from '../lib/logger';
import type {
  ChunkStore,
  CreatorStore,
  IgGraphPort,
  QueuePort,
  SecretStorePort,
} from '../lib/ports';
import type { MediaItem } from '../types';

export interface BackfillDeps {
  creators: CreatorStore;
  secrets: SecretStorePort;
  ig: IgGraphPort;
  chunks: ChunkStore;
  queue: QueuePort;
  cfg: Config;
  logger: Logger;
}

/** Very rough per-video Gemini cost estimate (assumes ~45s avg reel at the documented token rate). */
const EST_USD_PER_VIDEO = 0.03;

const isVideo = (m: MediaItem): boolean => m.mediaType === 'VIDEO' || m.mediaType === 'CAROUSEL_ALBUM';

/**
 * Backfill a creator's whole archive: list all media, cost-cap the number of videos (newest first),
 * enqueue per-media index jobs, and reconcile (delete chunks for posts that no longer exist).
 */
export function createBackfill(deps: BackfillDeps) {
  return async function backfill(creatorId: string): Promise<{ enqueued: number; deferredVideos: number }> {
    const log = deps.logger.child({ creatorId, op: 'backfill' });
    const creator = await deps.creators.get(creatorId);
    if (!creator || creator.status !== 'active') {
      log.warn('backfill: creator not active', { status: creator?.status ?? 'absent' });
      return { enqueued: 0, deferredVideos: 0 };
    }
    const token = await deps.secrets.getCreatorToken(creator.tokenSecretRef);
    const all = await deps.ig.listMedia(token, {});
    all.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0)); // newest first

    // Cost cap: keep all cheap (image) media + the newest N videos.
    const videos = all.filter(isVideo);
    const nonVideos = all.filter((m) => !isVideo(m));
    const keptVideos = videos.slice(0, deps.cfg.maxBackfillVideos);
    const deferredVideos = videos.length - keptVideos.length;
    const estUsd = keptVideos.length * EST_USD_PER_VIDEO;
    if (estUsd > deps.cfg.backfillCostCeilingUsd) {
      log.warn('backfill: estimated cost exceeds ceiling — proceeding up to the video cap only', {
        estUsd,
        ceiling: deps.cfg.backfillCostCeilingUsd,
        keptVideos: keptVideos.length,
      });
    }
    if (deferredVideos > 0) {
      log.warn('backfill: deferring oldest videos beyond MAX_BACKFILL_VIDEOS', {
        deferredVideos,
        cap: deps.cfg.maxBackfillVideos,
      });
    }

    const toIndex = [...nonVideos, ...keptVideos];
    for (const m of toIndex) {
      await deps.queue.enqueue({ kind: 'index_media', creatorId, media: m });
    }

    // Reconcile: delete chunks for media that no longer exist in the archive.
    const liveIds = new Set(all.map((m) => m.id));
    const indexed = await deps.chunks.listIndexedMediaIds(creatorId);
    let deleted = 0;
    for (const mediaId of indexed) {
      if (!liveIds.has(mediaId)) {
        await deps.chunks.deleteChunksForMedia(creatorId, mediaId);
        deleted++;
      }
    }

    // Advance the high-water mark so the hourly poll only picks up genuinely new media.
    const newest = all.reduce((acc, m) => Math.max(acc, Date.parse(m.timestamp) || 0), 0);
    if (newest > 0) await deps.creators.setPollHighWaterMark(creatorId, new Date(newest));

    log.info('backfill: enqueued', {
      enqueued: toIndex.length,
      deferredVideos,
      reconciledDeletes: deleted,
      estUsd: Number(estUsd.toFixed(2)),
    });
    return { enqueued: toIndex.length, deferredVideos };
  };
}
