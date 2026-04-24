/**
 * Single shared worker + request/response routing for embedding calls from Search and Chat.
 */

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: number[]) => void; reject: (e: Error) => void }
>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/embedding.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent) => {
      const { id, ok, vector, error } = event.data as {
        id: number;
        ok: boolean;
        vector?: number[];
        error?: string;
      };
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok && vector) entry.resolve(vector);
      else entry.reject(new Error(error || "Embedding failed"));
    };
    worker.onerror = () => {
      for (const [, entry] of pending) {
        entry.reject(new Error("Embedding worker crashed"));
      }
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

/** Mean-pooled normalized embedding (384 dims) for `text`. */
export function embedText(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const w = ensureWorker();
    const id = nextId++;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type: "embed", text } satisfies { id: number; type: "embed"; text: string });
  });
}
