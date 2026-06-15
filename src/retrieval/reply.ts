import { truncateToBytes, utf8ByteLength } from '../lib/bytes';
import type { ReplyPlan } from './types';

const VIDEO_CUE_PAD_SEC = 4;

/** Guardrail: the answer must contain NO URLs — the permalink is appended by us, never by the model. */
export function sanitizeAnswer(answer: string): string {
  return answer
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();
}

/**
 * Build the reply body. Posts: answer + permalink. Video: answer + "Watch from ~Xs" + permalink,
 * where X = max(0, citedStartSec - 4) (pad 4s early; Gemini timestamps are ~1s-granular).
 * Always preserves the cue + permalink; truncates only the answer to fit `maxBytes`.
 */
export function buildReply(plan: ReplyPlan, maxBytes: number): string {
  const cue =
    plan.isVideo && plan.citedStartSec != null
      ? `Watch from ~${Math.max(0, Math.round(plan.citedStartSec) - VIDEO_CUE_PAD_SEC)}s`
      : null;
  const suffixLines = [cue, plan.permalink].filter((s): s is string => !!s);
  const suffix = suffixLines.join('\n');
  // Reserve bytes for the suffix plus the newline that joins the answer to it.
  const reserved = suffix.length > 0 ? utf8ByteLength(suffix) + 1 : 0;
  const answerBudget = Math.max(0, maxBytes - reserved);
  const answer = truncateToBytes(sanitizeAnswer(plan.answer), answerBudget).trim();
  return [answer, suffix].filter((s) => s.length > 0).join('\n');
}

/**
 * Assemble the final outbound text: optional one-time disclosure prefix + reply body (or fallback),
 * guaranteed within `maxBytes` UTF-8.
 */
export function assembleOutbound(opts: {
  plan: ReplyPlan | null;
  fallback: string;
  disclosure: string | null;
  maxBytes: number;
}): string {
  const disclosureReserve = opts.disclosure ? utf8ByteLength(opts.disclosure) + 2 : 0; // + "\n\n"
  const bodyBudget = Math.max(0, opts.maxBytes - disclosureReserve);
  const body = opts.plan
    ? buildReply(opts.plan, bodyBudget)
    : truncateToBytes(opts.fallback, bodyBudget);
  const composed = opts.disclosure ? `${opts.disclosure}\n\n${body}` : body;
  // Backstop: buildReply never truncates the cue+permalink suffix, so a very long permalink under a
  // tight maxBytes could overflow. Guarantee the hard cap (Meta rejects over-length sends).
  return truncateToBytes(composed, opts.maxBytes);
}
