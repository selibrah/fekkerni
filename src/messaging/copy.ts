/** User-facing copy. Configurable per-creator later; defaults here. */

export interface BotCopy {
  /** One-time automation disclosure, prepended to the first reply in a conversation. */
  disclosure: string;
  /** Sent (once, on transition) when a follower texts STOP. */
  stopConfirm: string;
  /** Sent (once, on transition) when a follower texts START. */
  startConfirm: string;
  /** Sent when retrieval finds nothing above the threshold. */
  fallback: string;
}

export const defaultCopy: BotCopy = {
  disclosure:
    "👋 You're chatting with an automated assistant trained on this creator's posts. Reply STOP to opt out.",
  stopConfirm: "Got it — you won't get automated replies here anymore. Reply START to turn them back on.",
  startConfirm: "You're back on — ask me anything about the creator's posts.",
  fallback: "I couldn't find that one in the posts — try rephrasing? (Reply STOP to opt out.)",
};
