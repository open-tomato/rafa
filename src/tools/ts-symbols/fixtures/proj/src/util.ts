/** A chunk of text with its measured size. */
export interface Chunk {
  text: string;
  size: number;
}

export function makeChunk(text: string): Chunk {
  return { text, size: text.length };
}

export class ChunkStore {
  private items: Chunk[] = [];

  add(chunk: Chunk): void {
    this.items = [...this.items, chunk];
  }
}

const HIDDEN_LIMIT = 42;
export default HIDDEN_LIMIT;
