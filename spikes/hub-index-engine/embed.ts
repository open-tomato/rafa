/**
 * Deterministic pseudo-embeddings, so no model call is needed.
 *
 * Each alphanumeric token gets a fixed vector drawn from a PRNG seeded by
 * the token's FNV-1a hash; a text's vector is the normalised sum of its
 * tokens' vectors (a random-projection bag of words). Texts sharing many
 * tokens land close together, which is the one property the KNN and
 * hubness measurements need. The numbers these vectors give are index
 * costs, not retrieval quality.
 *
 * The width is a parameter, because the record's open question is what a
 * wider vector costs: `createEmbedder(n)` builds one of n dimensions with
 * its own token cache, and `embed` is the 384-dimension default the two
 * SQLite-side engines use.
 */
export const DIMS = 384;

const ALNUM = /[\p{L}\p{N}]+/gu;

/** One width's embedder: its own token cache, its own vector length. */
export interface Embedder {
  dims: number;
  embed: (text: string) => Float32Array;
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

export function tokensOf(text: string): string[] {
  return text.toLowerCase().match(ALNUM) ?? [];
}

/** Builds an embedder of one width. Two of different widths share nothing. */
export function createEmbedder(dims: number): Embedder {
  const tokenVectors = new Map<string, Float32Array>();

  const tokenVector = (token: string): Float32Array => {
    const hit = tokenVectors.get(token);
    if (hit) return hit;
    let state = fnv1a(token);
    const vector = new Float32Array(dims);
    for (let i = 0; i < dims; i++) {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      vector[i] = state / 2147483648 - 1;
    }
    tokenVectors.set(token, vector);
    return vector;
  };

  const embed = (text: string): Float32Array => {
    const sum = new Float32Array(dims);
    for (const token of tokensOf(text)) {
      const v = tokenVector(token);
      for (let i = 0; i < dims; i++) sum[i] += v[i]!;
    }
    let norm = 0;
    for (let i = 0; i < dims; i++) norm += sum[i]! * sum[i]!;
    norm = Math.sqrt(norm);
    if (norm === 0) {
      sum[0] = 1;
      return sum;
    }
    for (let i = 0; i < dims; i++) sum[i] = sum[i]! / norm;
    return sum;
  };

  return { dims, embed };
}

const defaultEmbedder = createEmbedder(DIMS);

/** The 384-dimension default, unchanged for the engines that measured at it. */
export const embed = defaultEmbedder.embed;
