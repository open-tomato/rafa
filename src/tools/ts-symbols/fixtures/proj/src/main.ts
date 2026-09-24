import { makeChunk, type Chunk } from './util';

export const first: Chunk = makeChunk('hello');
export { makeChunk as reChunk } from './util';
export type MaybeChunk = Chunk | null;
export const maybe: MaybeChunk = null;
