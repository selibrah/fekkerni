import type { InboundMessage } from '../types';

/**
 * Tolerant parser for Meta Instagram messaging webhook payloads. Never throws on unexpected
 * shapes — it extracts the text messages it understands and counts everything else as dropped.
 *
 * Shape (abridged):
 *   { object, entry: [ { id, time, messaging: [ { sender:{id}, recipient:{id}, timestamp,
 *       message: { mid, text, is_echo } } ] } ] }
 *
 * Dropped: echoes (is_echo), reactions/reads/deletes, attachment-only or empty-text messages.
 */
export interface ParseResult {
  messages: InboundMessage[];
  dropped: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function parseWebhook(body: unknown): ParseResult {
  const messages: InboundMessage[] = [];
  let dropped = 0;

  const root = asRecord(body);
  const entries = root && Array.isArray(root.entry) ? root.entry : [];

  for (const entryRaw of entries) {
    const entry = asRecord(entryRaw);
    if (!entry) continue;
    const entryId = asString(entry.id);
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];

    for (const eventRaw of events) {
      const event = asRecord(eventRaw);
      if (!event) {
        dropped++;
        continue;
      }
      const message = asRecord(event.message);
      // Not a message event (reaction/read/postback) -> drop.
      if (!message) {
        dropped++;
        continue;
      }
      // Echo of our own outbound message -> drop.
      if (message.is_echo === true) {
        dropped++;
        continue;
      }
      const text = asString(message.text);
      const mid = asString(message.mid);
      const sender = asRecord(event.sender);
      const recipient = asRecord(event.recipient);
      const senderId = sender ? asString(sender.id) : null;
      const recipientId = (recipient ? asString(recipient.id) : null) ?? entryId;

      // Text required and non-empty; ids and mid required.
      if (!text || text.trim() === '' || !mid || !senderId || !recipientId) {
        dropped++;
        continue;
      }

      const tsRaw = event.timestamp;
      // Fall back to receipt time (now) for a missing/unparseable timestamp so a valid in-window
      // message isn't dropped as "outside the window" (webhook latency is only seconds).
      const timestampMs = typeof tsRaw === 'number' ? tsRaw : Date.parse(asString(tsRaw) ?? '') || Date.now();

      messages.push({ creatorId: recipientId, senderId, mid, text, timestampMs });
    }
  }

  return { messages, dropped };
}
