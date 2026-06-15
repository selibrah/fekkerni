/**
 * L2 normalization. REQUIRED for gemini-embedding-001 at output dimensionality != 3072:
 * the API/SDK return NON-normalized vectors at 768 dims, and COSINE distance (plus the
 * threshold gate) is only reliable on unit vectors. Apply to BOTH indexed and query vectors.
 */

export function l2norm(vec: readonly number[]): number {
  let sum = 0;
  for (const v of vec) sum += v * v;
  return Math.sqrt(sum);
}

export interface NormalizedVector {
  vector: number[];
  norm: number; // the ORIGINAL L2 norm (stored for an assertion/test; result norm ≈ 1)
}

export function l2normalize(vec: readonly number[]): NormalizedVector {
  const norm = l2norm(vec);
  if (norm === 0 || !Number.isFinite(norm)) {
    throw new Error(`Cannot normalize a zero or non-finite vector (norm=${norm}).`);
  }
  return { vector: vec.map((v) => v / norm), norm };
}
