import type { InboundMessage } from '../types';
import type { ConversationStore, MessageSender, OptOutStore, Clock } from '../lib/ports';
import type { Logger } from '../lib/logger';
import type { RetrievePort } from '../retrieval/types';
import { assembleOutbound } from '../retrieval/reply';
import { classifyControl } from './control';
import { withinWindow } from './window';
import type { BotCopy } from './copy';

export interface ProcessMessageDeps {
  optout: OptOutStore;
  conversations: ConversationStore;
  sender: MessageSender;
  retrieve: RetrievePort;
  clock: Clock;
  copy: BotCopy;
  windowHours: number;
  maxReplyBytes: number;
  logger: Logger;
}

/**
 * The async worker for one inbound message. Handling order (messaging CONTEXT invariant):
 * STOP/START → opt-out → 24h window → retrieve → disclose → guardrail+cap → send.
 */
export async function processMessage(message: InboundMessage, deps: ProcessMessageDeps): Promise<void> {
  const { creatorId, senderId, text } = message;
  const log = deps.logger.child({ mid: message.mid, creatorId, senderId });

  const control = classifyControl(text);
  if (control === 'stop') {
    const { transitioned } = await deps.optout.setOptOut(creatorId, senderId);
    if (transitioned) await deps.sender.send(creatorId, senderId, deps.copy.stopConfirm);
    log.info('control: stop', { transitioned });
    return;
  }
  if (control === 'start') {
    const { transitioned } = await deps.optout.clearOptOut(creatorId, senderId);
    if (transitioned) await deps.sender.send(creatorId, senderId, deps.copy.startConfirm);
    log.info('control: start', { transitioned });
    return;
  }

  if (await deps.optout.isOptedOut(creatorId, senderId)) {
    log.info('suppressed: opted out');
    return;
  }

  if (!withinWindow(message.timestampMs, deps.clock.now(), deps.windowHours)) {
    log.warn('skip: outside messaging window', { inboundTsMs: message.timestampMs });
    return;
  }

  const plan = await deps.retrieve.retrieve(creatorId, text);
  const firstContact = await deps.conversations.markDisclosedIfFirst(creatorId, senderId);
  const outbound = assembleOutbound({
    plan,
    fallback: deps.copy.fallback,
    disclosure: firstContact ? deps.copy.disclosure : null,
    maxBytes: deps.maxReplyBytes,
  });
  await deps.sender.send(creatorId, senderId, outbound);
  log.info('replied', { matched: plan != null, firstContact });
}
