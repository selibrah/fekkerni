import type { Segment } from '../types';

/** Thrown when no JSON array can be located at all (caller may retry the model once). */
export class UnparseableSegmentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnparseableSegmentsError';
  }
}

/** Convert a timestamp to seconds. Accepts numbers, "SS", "MM:SS", "H:MM:SS", and numeric strings. */
export function toSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map((p) => p.trim());
  if (parts.length >= 2 && parts.length <= 3 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  }
  return null;
}

function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, '').trim();
}

/** Find the outermost JSON array substring, tolerating prose around it. */
function extractArray(text: string): unknown {
  const cleaned = stripFences(text);
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray((parsed as { segments?: unknown }).segments)) {
      return (parsed as { segments: unknown }).segments;
    }
  } catch {
    /* fall through to substring scan */
  }
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* unparseable */
    }
  }
  throw new UnparseableSegmentsError('No JSON array found in model output.');
}

/**
 * Parse Gemini's transcript output into normalized Segments. Defensive: tolerates code fences,
 * surrounding prose, MM:SS timestamps, and key aliases (start/startSec/startTime). Drops segments
 * with empty text or an unreadable/invalid time range. Returns [] for a valid-but-empty array
 * (silent/visual video). Throws UnparseableSegmentsError only when no array can be found at all.
 */
export function parseSegments(modelText: string): Segment[] {
  const arr = extractArray(modelText) as unknown[];
  const out: Segment[] = [];
  for (const itemRaw of arr) {
    if (typeof itemRaw !== 'object' || itemRaw === null) continue;
    const item = itemRaw as Record<string, unknown>;
    const start = toSeconds(item.startSec ?? item.start ?? item.startTime ?? item.from);
    const end = toSeconds(item.endSec ?? item.end ?? item.endTime ?? item.to);
    const textRaw = item.text ?? item.transcript ?? item.caption;
    const text = typeof textRaw === 'string' ? textRaw.trim() : '';
    if (!text) continue;
    if (start === null) continue;
    const endSec = end !== null && end >= start ? end : start;
    out.push({ startSec: start, endSec, text });
  }
  return out;
}
