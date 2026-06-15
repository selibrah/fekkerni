import type { CreatorStore, IgGraphPort, MessageSender, SecretStorePort } from '../lib/ports';
import type { Logger } from '../lib/logger';
import { isAuthError } from '../lib/errors';

/**
 * Composes Creator + Secret + Graph into a MessageSender. Resolves the creator's token, sends, and
 * maps auth failures to Creator.status='needs_reauth' (so a lapsed token is observable, not a silent
 * retry). Keeps the worker free of token plumbing.
 */
export function createMessageSender(deps: {
  creators: CreatorStore;
  secrets: SecretStorePort;
  ig: IgGraphPort;
  logger: Logger;
}): MessageSender {
  return {
    async send(creatorId, recipientId, text) {
      const creator = await deps.creators.get(creatorId);
      if (!creator || creator.status !== 'active') {
        deps.logger.warn('send skipped: creator not active', { creatorId, status: creator?.status });
        return { ok: false };
      }
      try {
        const token = await deps.secrets.getCreatorToken(creator.tokenSecretRef);
        return await deps.ig.sendMessage(token, recipientId, text);
      } catch (e) {
        if (isAuthError(e)) {
          await deps.creators.setStatus(creatorId, 'needs_reauth');
          deps.logger.error('send failed: token invalid, marked needs_reauth', { creatorId });
          return { ok: false };
        }
        throw e;
      }
    },
  };
}
