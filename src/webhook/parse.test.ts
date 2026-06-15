import { describe, it, expect } from 'vitest';
import { parseWebhook } from './parse';

const textEvent = (over: Record<string, unknown> = {}) => ({
  sender: { id: 'IGSID_1' },
  recipient: { id: 'CREATOR_1' },
  timestamp: 1700000000000,
  message: { mid: 'mid_1', text: 'how do I deglaze a pan?' },
  ...over,
});

const wrap = (events: unknown[]) => ({
  object: 'instagram',
  entry: [{ id: 'CREATOR_1', time: 1, messaging: events }],
});

describe('parseWebhook', () => {
  it('extracts a text message into an InboundMessage', () => {
    const { messages, dropped } = parseWebhook(wrap([textEvent()]));
    expect(dropped).toBe(0);
    expect(messages).toEqual([
      {
        creatorId: 'CREATOR_1',
        senderId: 'IGSID_1',
        mid: 'mid_1',
        text: 'how do I deglaze a pan?',
        timestampMs: 1700000000000,
      },
    ]);
  });

  it('drops echoes (is_echo)', () => {
    const e = textEvent({ message: { mid: 'm', text: 'hi', is_echo: true } });
    const { messages, dropped } = parseWebhook(wrap([e]));
    expect(messages).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('drops non-text events: reactions, reads, attachment-only, empty text', () => {
    const events = [
      { sender: { id: 's' }, recipient: { id: 'CREATOR_1' }, reaction: { action: 'react' } },
      { sender: { id: 's' }, recipient: { id: 'CREATOR_1' }, read: { mid: 'x' } },
      textEvent({ message: { mid: 'm2', attachments: [{ type: 'image' }] } }), // no text
      textEvent({ message: { mid: 'm3', text: '   ' } }), // whitespace only
    ];
    const { messages, dropped } = parseWebhook(wrap(events));
    expect(messages).toHaveLength(0);
    expect(dropped).toBe(4);
  });

  it('falls back to entry.id for the creator when recipient is missing', () => {
    const e = textEvent({ recipient: undefined });
    const { messages } = parseWebhook(wrap([e]));
    expect(messages[0]?.creatorId).toBe('CREATOR_1');
  });

  it('never throws on malformed / empty / non-object input', () => {
    expect(parseWebhook(null)).toEqual({ messages: [], dropped: 0 });
    expect(parseWebhook({})).toEqual({ messages: [], dropped: 0 });
    expect(parseWebhook({ entry: 'nope' })).toEqual({ messages: [], dropped: 0 });
    expect(parseWebhook({ entry: [{ messaging: [42, null] }] }).dropped).toBe(2);
  });
});
