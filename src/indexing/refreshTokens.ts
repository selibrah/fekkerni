import type { Logger } from '../lib/logger';
import type { CreatorStore, IgGraphPort, SecretStorePort } from '../lib/ports';
import { isAuthError } from '../lib/errors';

export interface RefreshDeps {
  creators: CreatorStore;
  secrets: SecretStorePort;
  ig: IgGraphPort;
  logger: Logger;
}

const DEFAULT_WINDOW_DAYS = 7;

/**
 * Refresh long-lived IG tokens that expire within `windowDays` (default 7). A lapsed token would
 * silently break a creator's poll and sends (ADR 006), so we rotate ahead of expiry. On an auth
 * failure the creator is marked needs_reauth rather than retried.
 */
export function createRefreshTokens(deps: RefreshDeps) {
  return async function refreshTokens(windowDays = DEFAULT_WINDOW_DAYS): Promise<{ refreshed: number; failed: number }> {
    const before = new Date(Date.now() + windowDays * 24 * 3600 * 1000);
    const due = await deps.creators.listNeedingRefresh(before);
    let refreshed = 0;
    let failed = 0;
    for (const creator of due) {
      const log = deps.logger.child({ creatorId: creator.creatorId });
      try {
        const current = await deps.secrets.getCreatorToken(creator.tokenSecretRef);
        const { token, expiresAt } = await deps.ig.refreshLongLivedToken(current);
        const ref = await deps.secrets.setCreatorToken(creator.creatorId, token);
        await deps.creators.setTokenInfo(creator.creatorId, { tokenSecretRef: ref, tokenExpiresAt: expiresAt });
        refreshed++;
        log.info('token refreshed', { expiresAt: expiresAt.toISOString() });
      } catch (e) {
        failed++;
        if (isAuthError(e)) {
          await deps.creators.setStatus(creator.creatorId, 'needs_reauth');
          log.error('token refresh failed: marked needs_reauth');
        } else {
          log.error('token refresh failed', { error: String(e) });
        }
      }
    }
    deps.logger.info('refreshTokens complete', { due: due.length, refreshed, failed });
    return { refreshed, failed };
  };
}
