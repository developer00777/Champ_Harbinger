/**
 * Local embedding service.
 *
 * Uses Xenova/all-MiniLM-L6-v2 (384 dims, ~90 MB) via @huggingface/transformers
 * to produce text embeddings entirely in-process — no network round-trip,
 * no per-query LLM cost. The model is downloaded and cached on first use,
 * then served from disk on subsequent runs.
 *
 * Output vectors are mean-pooled + L2-normalized so cosine distance over
 * pgvector's `<=>` operator behaves the way you'd expect.
 *
 * Cost profile: zero per-query (CPU only). First call loads the model
 * (~30s cold-start, depending on disk + network for first download).
 */

import "server-only";

import type {
  FeatureExtractionPipeline,
  PipelineType,
} from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    return (await pipeline(
      "feature-extraction" as PipelineType,
      MODEL_ID,
    )) as FeatureExtractionPipeline;
  })();
  return pipelinePromise;
}

function toNumberArray(data: ArrayLike<number>): number[] {
  const out = new Array<number>(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i];
  return out;
}

/**
 * Embed a single text string into a 384-dim float vector suitable for
 * pgvector cosine search.
 */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  // tensor.data is a Float32Array for this model
  return toNumberArray(output.data as Float32Array);
}

/**
 * Embed a batch of texts. Returns one 384-dim vector per input, in order.
 *
 * @huggingface/transformers' feature-extraction pipeline accepts an array
 * and returns a [batch, dim] tensor when pooling: 'mean' is set.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  // output.dims === [texts.length, 384] for a batched call.
  const dims = output.dims as readonly number[];
  if (dims.length !== 2 || dims[0] !== texts.length) {
    // Fall back to sequential for safety if shape isn't as expected.
    const results: number[][] = [];
    for (const t of texts) results.push(await embedText(t));
    return results;
  }
  const dim = dims[1];
  const flat = output.data as Float32Array;
  const out: number[][] = new Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    out[i] = toNumberArray(flat.subarray(i * dim, (i + 1) * dim));
  }
  return out;
}

/**
 * The embedding dimension this service produces. Must match the
 * `vector(N)` column type in db/schema.ts.
 */
export const EMBEDDING_DIMENSIONS = 384;
