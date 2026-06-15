import { describe, it, expect } from 'vitest';
import { createRefreshTokens } from './refreshTokens';
import { FakeCreators, FakeSecrets, FakeIg, silentLogger } from '../testing/fakes';
import { AuthError } from '../lib/errors';
import type { Creator } from '../types';

const base: Creator = {
  creatorId: 'C',
  tokenSecretRef: 'local:C',
  tokenExpiresAt: null,
  status: 'active',
  pollHighWaterMark: null,
};

describe('refreshTokens', () => {
  it('refreshes only tokens expiring within the window and updates expiry', async () => {
    const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000); // 2 days
    const later = new Date(Date.now() + 40 * 24 * 3600 * 1000); // 40 days
    const creators = new FakeCreators()
      .seed({ ...base, creatorId: 'SOON', tokenExpiresAt: soon })
      .seed({ ...base, creatorId: 'LATER', tokenExpiresAt: later });
    const ig = new FakeIg();
    const deps = { creators, secrets: new FakeSecrets(), ig, logger: silentLogger() };

    const res = await createRefreshTokens(deps)(7);
    expect(res).toEqual({ refreshed: 1, failed: 0 });
    const soonCreator = await creators.get('SOON');
    expect(soonCreator?.tokenExpiresAt?.getTime()).toBeGreaterThan(soon.getTime());
  });

  it('marks a creator needs_reauth when refresh hits an auth error', async () => {
    const soon = new Date(Date.now() + 1 * 24 * 3600 * 1000);
    const creators = new FakeCreators().seed({ ...base, tokenExpiresAt: soon });
    const ig = new FakeIg();
    ig.refreshLongLivedToken = async () => {
      throw new AuthError('token expired');
    };
    const res = await createRefreshTokens({ creators, secrets: new FakeSecrets(), ig, logger: silentLogger() })(7);
    expect(res).toEqual({ refreshed: 0, failed: 1 });
    expect((await creators.get('C'))?.status).toBe('needs_reauth');
  });
});
