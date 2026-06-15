import type { Config } from '../lib/config';
import type { Logger } from '../lib/logger';
import type { CreatorStore, IgGraphPort, QueuePort, SecretStorePort } from '../lib/ports';
import { isAuthError } from '../lib/errors';

export interface PollDeps {
  creators: CreatorStore;
  secrets: SecretStorePort;
  ig: IgGraphPort;
  queue: QueuePort;
  cfg: Config;
  logger: Logger;
}

/**
 * Incremental poll for one creator: fetch media newer than the high-water mark and enqueue one
 * index_media job each. Advances the high-water mark. Indexing is idempotent, so a job retry is safe.
 */
export function createPollCreator(deps: PollDeps) {
  return async function pollCreator(creatorId: string): Promise<void> {
    const log = deps.logger.child({ creatorId });
    const creator = await deps.creators.get(creatorId);
    if (!creator || creator.status !== 'active') {
      log.warn('poll: creator not active', { status: creator?.status ?? 'absent' });
      return;
    }

    let token: string;
    try {
      token = await deps.secrets.getCreatorToken(creator.tokenSecretRef);
    } catch (e) {
      log.error('poll: token resolution failed', { error: String(e) });
      return;
    }

    let media;
    try {
      media = await deps.ig.listMedia(token, creator.pollHighWaterMark ? { since: creator.pollHighWaterMark } : {});
    } catch (e) {
      if (isAuthError(e)) {
        await deps.creators.setStatus(creatorId, 'needs_reauth');
        log.error('poll: token invalid, marked needs_reauth');
        return;
      }
      throw e;
    }

    let newest = creator.pollHighWaterMark?.getTime() ?? 0;
    for (const m of media) {
      await deps.queue.enqueue({ kind: 'index_media', creatorId, media: m });
      newest = Math.max(newest, Date.parse(m.timestamp) || 0);
    }
    if (media.length > 0 && newest > 0) {
      await deps.creators.setPollHighWaterMark(creatorId, new Date(newest));
    }
    log.info('poll: enqueued', { count: media.length });
  };
}
