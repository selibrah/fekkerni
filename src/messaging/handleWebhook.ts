import type { InboundMessage } from '../types';
import type { CreatorStore, DedupeStore, QueuePort } from '../lib/ports';
import type { Logger } from '../lib/logger';

export interface WebhookDeps {
  dedupe: DedupeStore;
  creators: CreatorStore;
  queue: QueuePort;
  logger: Logger;
}

/**
 * The ack-then-process front half (ADR 003). For each parsed message: dedupe on mid, gate on an
 * active creator, then enqueue a process_message job. Fast and side-effect-light so the webhook
 * can return 200 immediately. Heavy work (retrieval + send) happens in the worker.
 */
export async function handleInbound(messages: InboundMessage[], deps: WebhookDeps): Promise<void> {
  for (const message of messages) {
    const fresh = await deps.dedupe.markSeen(message.mid);
    if (!fresh) {
      deps.logger.debug('dedupe: already seen', { mid: message.mid });
      continue;
    }
    const creator = await deps.creators.get(message.creatorId);
    if (!creator || creator.status !== 'active') {
      deps.logger.warn('drop: unknown or inactive creator', {
        creatorId: message.creatorId,
        status: creator?.status ?? 'absent',
      });
      continue;
    }
    await deps.queue.enqueue({ kind: 'process_message', message });
    deps.logger.info('enqueued process_message', {
      mid: message.mid,
      creatorId: message.creatorId,
      senderId: message.senderId,
    });
  }
}
