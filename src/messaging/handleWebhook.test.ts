import { describe, it, expect } from 'vitest';
import { handleInbound } from './handleWebhook';
import { FakeDedupe, FakeCreators, FakeQueue, silentLogger } from '../testing/fakes';
import type { InboundMessage } from '../types';
import type { Creator } from '../types';

const activeCreator: Creator = {
  creatorId: 'CREATOR_1',
  tokenSecretRef: 'ref',
  tokenExpiresAt: null,
  status: 'active',
  pollHighWaterMark: null,
};

const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  creatorId: 'CREATOR_1',
  senderId: 'IGSID_1',
  mid: 'mid_1',
  text: 'hello',
  timestampMs: 1700000000000,
  ...over,
});

function deps() {
  return {
    dedupe: new FakeDedupe(),
    creators: new FakeCreators().seed(activeCreator),
    queue: new FakeQueue(),
    logger: silentLogger(),
  };
}

describe('handleInbound (ack-then-process front half)', () => {
  it('enqueues a process_message job for an active creator', async () => {
    const d = deps();
    await handleInbound([msg()], d);
    expect(d.queue.jobs).toEqual([{ kind: 'process_message', message: msg() }]);
  });

  it('dedupes by mid (a repeated delivery is not enqueued twice)', async () => {
    const d = deps();
    await handleInbound([msg()], d);
    await handleInbound([msg()], d); // Meta retry, same mid
    expect(d.queue.jobs).toHaveLength(1);
  });

  it('drops messages for an unknown creator', async () => {
    const d = deps();
    await handleInbound([msg({ creatorId: 'NOT_ONBOARDED' })], d);
    expect(d.queue.jobs).toHaveLength(0);
  });

  it('drops messages for an inactive (uninstalled / needs_reauth) creator', async () => {
    const d = deps();
    d.creators.seed({ ...activeCreator, creatorId: 'C2', status: 'uninstalled' });
    await handleInbound([msg({ creatorId: 'C2', mid: 'm2' })], d);
    expect(d.queue.jobs).toHaveLength(0);
  });
});
