/**
 * Deterministic pseudo-embeddings, so no model call is needed.
 *
 * Each alphanumeric token gets a fixed 384-dimensional vector drawn from
 * a PRNG seeded by the token's FNV-1a hash; a text's vector is the
 * normalised sum of its tokens' vectors (a random-projection bag of
 * words). Texts sharing many tokens land close together, which is the
 * one property the KNN and hubness measurements need. The numbers these
 * vectors give are index costs, not retrieval quality.
 */
export const DIMS = 384;

const tokenVectors = new Map<string, Float32Array>();
const ALNUM = /[\p{L}\p{N}]+/gu;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

function tokenVector(token: string): Float32Array {
  const hit = tokenVectors.get(token);
  if (hit) return hit;
  let state = fnv1a(token);
  const vector = new Float32Array(DIMS);
  for (let i = 0; i < DIMS; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    vector[i] = state / 2147483648 - 1;
  }
  tokenVectors.set(token, vector);
  return vector;
}

export function tokensOf(text: string): string[] {
  return (text.toLowerCase().match(ALNUM) ?? []);
}

export function embed(text: string): Float32Array {
  const sum = new Float32Array(DIMS);
  const tokens = tokensOf(text);
  for (const token of tokens) {
    const v = tokenVector(token);
    for (let i = 0; i < DIMS; i++) sum[i] += v[i]!;
  }
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += sum[i]! * sum[i]!;
  norm = Math.sqrt(norm);
  if (norm === 0) {
    sum[0] = 1;
    return sum;
  }
  for (let i = 0; i < DIMS; i++) sum[i] = sum[i]! / norm;
  return sum;
}
