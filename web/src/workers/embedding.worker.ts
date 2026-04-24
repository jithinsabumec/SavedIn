/**
 * Web Worker: loads Xenova/all-MiniLM-L6-v2 once and embeds text on demand.
 * Bundled as a separate chunk by Vite (`new URL(..., import.meta.url)`).
 */
import { env, pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

// Use default CDN for model weights; WASM runs in worker context.
env.allowLocalModels = false;

type EmbedRequest = { id: number; type: "embed"; text: string };

let embedder: FeatureExtractionPipeline | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return embedder;
}

self.onmessage = async (event: MessageEvent<EmbedRequest>) => {
  const { id, type, text } = event.data;
  if (type !== "embed") return;

  try {
    const fn = await getEmbedder();
    const output = await fn(text.slice(0, 512), { pooling: "mean", normalize: true });
    const vector = Array.from(output.data as Float32Array);
    self.postMessage({ id, ok: true as const, vector });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, ok: false as const, error: message });
  }
};

export {};
