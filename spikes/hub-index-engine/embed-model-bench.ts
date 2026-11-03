// Times one local embedding model through LM Studio's OpenAI-compatible route.
const texts = (await Bun.file(process.argv[2]!).json()) as string[];
const url = 'http://localhost:1234/v1/embeddings';
const model = process.argv[3] ?? 'bench-embed';

async function embed(input: string | string[]): Promise<number[][]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return body.data.map((d) => d.embedding);
}
const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

await embed(`search_document: ${texts[0]}`); // warm up
const single: number[] = [];
const start = performance.now();
let dims = 0;
for (const text of texts) {
  const t0 = performance.now();
  const v = await embed(`search_query: ${text.slice(0, 120)}`);
  single.push(performance.now() - t0);
  dims = v[0]!.length;
}
const docs: number[] = [];
for (const text of texts) {
  const t0 = performance.now();
  await embed(`search_document: ${text}`);
  docs.push(performance.now() - t0);
}
const batchStart = performance.now();
for (let i = 0; i < texts.length; i += 16) await embed(texts.slice(i, i + 16).map((t) => `search_document: ${t}`));
const batchMs = performance.now() - batchStart;
console.log(JSON.stringify({
  dims,
  query120chars: { p50: pct(single, 0.5), p95: pct(single, 0.95) },
  doc332chars: { p50: pct(docs, 0.5), p95: pct(docs, 0.95) },
  batch16: { docsPerSecond: texts.length / (batchMs / 1000) },
  totalSeconds: (performance.now() - start) / 1000,
}));
