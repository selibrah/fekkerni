import { describe, it, expect } from 'vitest';
import { processMessage, type ProcessMessageDeps } from './processMessage';
import { defaultCopy } from './copy';
import {
  FakeOptOut,
  FakeConversations,
  FakeSender,
  FakeRetrieve,
  FakeSentReplies,
  fixedClock,
  silentLogger,
} from '../testing/fakes';
import type { InboundMessage } from '../types';
import type { ReplyPlan } from '../retrieval/types';

const NOW = '2026-06-15T12:00:00.000Z';
const inWindowTs = new Date('2026-06-15T11:59:00.000Z').getTime();

const matchPlan: ReplyPlan = {
  answer: 'Deglaze with wine.',
  permalink: 'https://instagram.com/p/ABC',
  isVideo: false,
  citedStartSec: null,
};

function makeDeps(over: Partial<ProcessMessageDeps> = {}): {
  deps: ProcessMessageDeps;
  optout: FakeOptOut;
  conversations: FakeConversations;
  sentReplies: FakeSentReplies;
  sender: FakeSender;
} {
  const optout = new FakeOptOut();
  const conversations = new FakeConversations();
  const sentReplies = new FakeSentReplies();
  const sender = new FakeSender();
  const deps: ProcessMessageDeps = {
    optout,
    conversations,
    sentReplies,
    sender,
    retrieve: new FakeRetrieve(() => matchPlan),
    clock: fixedClock(NOW),
    copy: defaultCopy,
    windowHours: 24,
    maxReplyBytes: 1000,
    logger: silentLogger(),
    ...over,
  };
  return { deps, optout, conversations, sentReplies, sender };
}

const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  creatorId: 'C',
  senderId: 'U',
  mid: 'm',
  text: 'how do I deglaze a pan?',
  timestampMs: inWindowTs,
  ...over,
});

describe('processMessage', () => {
  it('replies with the answer + permalink and discloses on first contact only', async () => {
    const { deps, sender } = makeDeps();
    await processMessage(msg({ mid: 'm1' }), deps);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.text.startsWith(defaultCopy.disclosure)).toBe(true);
    expect(sender.sent[0]?.text).toContain('https://instagram.com/p/ABC');

    await processMessage(msg({ mid: 'm2' }), deps); // same conversation, second message
    expect(sender.sent[1]?.text.startsWith(defaultCopy.disclosure)).toBe(false);
  });

  it('does NOT mark disclosure delivered when the send fails; a later attempt still discloses', async () => {
    const conversations = new FakeConversations();
    const failing = new FakeSender(false);
    const { deps } = makeDeps({ sender: failing, conversations });
    await processMessage(msg({ mid: 'f1' }), deps);
    expect(failing.sent[0]?.text.startsWith(defaultCopy.disclosure)).toBe(true); // attempted with disclosure
    expect(await conversations.wasDisclosed('C', 'U')).toBe(false); // but NOT committed

    const working = new FakeSender(true);
    const { deps: deps2 } = makeDeps({ sender: working, conversations });
    await processMessage(msg({ mid: 'f2' }), deps2);
    expect(working.sent[0]?.text.startsWith(defaultCopy.disclosure)).toBe(true); // re-disclosed
    expect(await conversations.wasDisclosed('C', 'U')).toBe(true); // now committed
  });

  it('sends the fallback when retrieval finds nothing', async () => {
    const { deps, sender } = makeDeps({ retrieve: new FakeRetrieve(() => null) });
    await processMessage(msg(), deps);
    expect(sender.sent[0]?.text).toContain(defaultCopy.fallback);
  });

  it('STOP sets opt-out and confirms once; a second STOP does not re-confirm', async () => {
    const { deps, sender, optout } = makeDeps();
    await processMessage(msg({ text: 'STOP', mid: 's1' }), deps);
    expect(await optout.isOptedOut('C', 'U')).toBe(true);
    expect(sender.sent).toEqual([{ creatorId: 'C', recipientId: 'U', text: defaultCopy.stopConfirm }]);

    await processMessage(msg({ text: 'stop', mid: 's2' }), deps);
    expect(sender.sent).toHaveLength(1); // idempotent: no second confirmation
  });

  it('START clears opt-out and confirms on transition', async () => {
    const { deps, sender, optout } = makeDeps();
    await optout.setOptOut('C', 'U');
    await processMessage(msg({ text: 'START', mid: 'r1' }), deps);
    expect(await optout.isOptedOut('C', 'U')).toBe(false);
    expect(sender.sent[0]?.text).toBe(defaultCopy.startConfirm);
  });

  it('never sends a retrieval reply to an opted-out user', async () => {
    let retrieveCalled = false;
    const { deps, sender, optout } = makeDeps({
      retrieve: new FakeRetrieve(() => {
        retrieveCalled = true;
        return matchPlan;
      }),
    });
    await optout.setOptOut('C', 'U');
    await processMessage(msg(), deps);
    expect(sender.sent).toHaveLength(0);
    expect(retrieveCalled).toBe(false);
  });

  it('does not send outside the 24h window', async () => {
    const { deps, sender } = makeDeps();
    const stale = new Date('2026-06-14T10:00:00.000Z').getTime(); // >24h before NOW
    await processMessage(msg({ timestampMs: stale }), deps);
    expect(sender.sent).toHaveLength(0);
  });

  it('strips a foreign URL injected into the model answer', async () => {
    const evil: ReplyPlan = { ...matchPlan, answer: 'Sure! visit http://phish.example/login now' };
    const { deps, sender } = makeDeps({ retrieve: new FakeRetrieve(() => evil) });
    await processMessage(msg(), deps);
    const text = sender.sent[0]?.text ?? '';
    expect(text).not.toContain('phish.example');
    expect(text).toContain('https://instagram.com/p/ABC'); // only the permalink survives
  });

  it('does not double-send when the same mid is processed twice (send idempotency)', async () => {
    const { deps, sender, sentReplies } = makeDeps();
    await processMessage(msg({ mid: 'dup' }), deps);
    expect(sender.sent).toHaveLength(1);
    expect(sentReplies.sent.has('dup')).toBe(true);

    // Simulate a task retry with the same mid
    await processMessage(msg({ mid: 'dup' }), deps);
    expect(sender.sent).toHaveLength(1); // NOT 2 — idempotent
  });
});
