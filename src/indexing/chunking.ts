import { createHash } from 'node:crypto';
import type { MediaType, Segment } from '../types';

/** A unit of searchable text before embedding. */
export interface ChunkDraft {
  index: number;
  text: string;
  startSec: number | null;
  endSec: number | null;
}

export interface ChunkInputs {
  mediaType: MediaType;
  caption: string | null;
  /** Transcript segments — the media's own (VIDEO) or its video children (CAROUSEL_ALBUM). */
  segments: Segment[];
  /** Optional one-line image description (IMAGE only, when enrichment is enabled). */
  imageDescription?: string | null;
}

const clean = (s: string | null | undefined): string => (s ?? '').trim();

/**
 * Decide the chunk text units for a media. Deterministic and pure.
 *  - IMAGE: caption (+ optional description).
 *  - CAROUSEL_ALBUM: caption + each video-child segment.
 *  - VIDEO: each transcript segment; if none (silent/visual), fall back to the caption.
 * Empty-text units are skipped. Indices are assigned sequentially → chunkId = `${mediaId}_${index}`.
 */
export function buildChunkDrafts(inputs: ChunkInputs): ChunkDraft[] {
  const units: { text: string; startSec: number | null; endSec: number | null }[] = [];
  const caption = clean(inputs.caption);
  const description = clean(inputs.imageDescription);

  if (inputs.mediaType === 'IMAGE') {
    if (caption) units.push({ text: caption, startSec: null, endSec: null });
    if (description) units.push({ text: description, startSec: null, endSec: null });
  } else if (inputs.mediaType === 'CAROUSEL_ALBUM') {
    if (caption) units.push({ text: caption, startSec: null, endSec: null });
    for (const s of inputs.segments) {
      const t = clean(s.text);
      if (t) units.push({ text: t, startSec: s.startSec, endSec: s.endSec });
    }
  } else {
    // VIDEO (incl. reels)
    if (inputs.segments.length > 0) {
      for (const s of inputs.segments) {
        const t = clean(s.text);
        if (t) units.push({ text: t, startSec: s.startSec, endSec: s.endSec });
      }
    } else if (caption) {
      units.push({ text: caption, startSec: null, endSec: null });
    }
  }

  return units.map((u, index) => ({ index, ...u }));
}

/**
 * A stable hash of everything that determines the chunk set. When it changes, re-index;
 * when it matches the stored value, skip. Drives idempotency (ADR 004).
 */
export function computeContentHash(inputs: ChunkInputs): string {
  const drafts = buildChunkDrafts(inputs);
  const basis = JSON.stringify({ mediaType: inputs.mediaType, drafts });
  return createHash('sha256').update(basis).digest('hex');
}
