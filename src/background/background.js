/**
 * background.js — SavedIn Service Worker
 *
 * Message types handled:
 *   SYNC_POSTS                      — legacy single-pass sync (kept for backwards compat)
 *   SYNC_POSTS_PARTIAL              — one batch from the auto-scroll loop; partial: true
 *   SYNC_COMPLETE                   — scroll loop finished; partial: false, final count
 *   SEMANTIC_SEARCH                 — embed a query and rank stored posts by cosine similarity
 *   GENERATE_EMBEDDINGS_FOR_EXISTING — backfill embeddings for posts synced before this feature
 */

import { pipeline, env } from '@xenova/transformers';

// Tell onnxruntime-web where to find its WASM files inside the extension bundle.
// The files are copied to the dist root by vite.config.js's closeBundle hook.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('/');
// Disable the WASM proxy worker — we are already inside a service worker.
env.backends.onnx.wasm.proxy = false;
// Service workers forbid Atomics.wait (it blocks the event loop).
// Single-threaded mode avoids SharedArrayBuffer + Atomics entirely.
env.backends.onnx.wasm.numThreads = 1;

// ===========================================================================
// Embedder singleton
// Lazy-loaded on first use. Survives for the lifetime of the service worker
// instance; reloads automatically when Chrome restarts the worker.
// ===========================================================================

let embedder = null;

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

/**
 * Generate a normalised 384-dim embedding for `text`.
 * Input is truncated to 512 chars to stay within the model's token budget.
 * Returns a plain JS number array (not a TypedArray) so it serialises cleanly
 * to chrome.storage.local via JSON.
 */
async function generateEmbedding(text) {
  const fn     = await getEmbedder();
  const output = await fn(text.slice(0, 512), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// ===========================================================================
// Cosine similarity
// Since we normalise embeddings (||v|| = 1), this equals the dot product —
// but we keep the full formula for robustness.
// ===========================================================================

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ===========================================================================
// Message router
// ===========================================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {

    case 'SYNC_POSTS':
      handleLegacySync(message.posts, message.warning)
        .then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SYNC_POSTS_PARTIAL':
      handlePartial(message.posts, message.totalThisSession)
        .then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SYNC_COMPLETE':
      handleComplete(message.totalThisSession)
        .then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SEMANTIC_SEARCH':
      handleSemanticSearch(message.query)
        .then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GENERATE_EMBEDDINGS_FOR_EXISTING':
      // Keep the channel open (return true) so the service worker stays alive
      // for the full duration of the backfill.
      runBackfill()
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
      return true;

    default:
      return false;
  }
});

// ===========================================================================
// Storage helpers
// ===========================================================================

/**
 * Merge incomingPosts into storage, deduplicating by post ID.
 * Returns { newCount, totalCount, newPosts } so callers can embed only the
 * posts that are genuinely new.
 */
async function mergePosts(incomingPosts) {
  const stored      = await chrome.storage.local.get('posts');
  const existing    = stored.posts ?? [];
  const existingIds = new Set(existing.map(p => p.id));
  const newPosts    = incomingPosts.filter(p => !existingIds.has(p.id));
  const merged      = [...newPosts, ...existing];
  await chrome.storage.local.set({ posts: merged });
  return { newCount: newPosts.length, totalCount: merged.length, newPosts };
}

/**
 * After syncing, generate embeddings for newly added posts without blocking
 * the sync confirmation that the popup is waiting for.
 *
 * We reload `posts` from storage, mutate the matching objects in-place,
 * and write back — so any embeddings generated between the original merge
 * and now (e.g. from a concurrent partial) are preserved.
 */
async function generateAndStoreEmbeddings(posts) {
  if (posts.length === 0) return;

  const stored  = await chrome.storage.local.get('posts');
  const all     = stored.posts ?? [];
  const byId    = new Map(all.map(p => [p.id, p]));

  for (const post of posts) {
    const stored = byId.get(post.id);
    if (!stored) continue;
    try {
      stored.embedding = await generateEmbedding(post.postText);
      console.log(`[SavedIn] Embedding ready for post ${post.id}`);
    } catch (err) {
      console.warn(`[SavedIn] Could not embed post ${post.id}:`, err.message);
      // Post is already in storage without embedding — text search still works.
    }
  }

  await chrome.storage.local.set({ posts: all });
}

// ===========================================================================
// Sync handlers
// ===========================================================================

async function handleLegacySync(incomingPosts, warning) {
  const { newCount, totalCount, newPosts } = await mergePosts(incomingPosts);

  await chrome.storage.local.set({
    lastSyncResult: {
      partial: false, newCount, totalThisSession: newCount, totalCount,
      at: Date.now(),
      ...(warning ? { warning } : {}),
    },
  });

  // Embed new posts without blocking the response
  generateAndStoreEmbeddings(newPosts).catch(err =>
    console.warn('[SavedIn] Post-sync embedding error:', err.message));

  return { success: true, newCount, totalCount };
}

async function handlePartial(incomingPosts, totalThisSession) {
  const { newCount, totalCount, newPosts } = await mergePosts(incomingPosts);

  await chrome.storage.local.set({
    lastSyncResult: {
      partial: true, newCount, totalThisSession, totalCount, at: Date.now(),
    },
  });

  generateAndStoreEmbeddings(newPosts).catch(err =>
    console.warn('[SavedIn] Partial embedding error:', err.message));

  return { success: true };
}

async function handleComplete(totalThisSession) {
  const stored     = await chrome.storage.local.get('posts');
  const totalCount = (stored.posts ?? []).length;

  await chrome.storage.local.set({
    lastSyncResult: {
      partial: false, totalThisSession, totalCount, at: Date.now(),
    },
  });

  return { success: true };
}

// ===========================================================================
// Semantic search
// ===========================================================================

const SIMILARITY_THRESHOLD = 0.25;
const MAX_RESULTS          = 20;

async function handleSemanticSearch(query) {
  const queryEmbedding = await generateEmbedding(query);

  const stored = await chrome.storage.local.get('posts');
  const posts  = stored.posts ?? [];

  const results = posts
    .filter(p => Array.isArray(p.embedding) && p.embedding.length > 0)
    .map(p => ({ ...p, score: cosineSimilarity(queryEmbedding, p.embedding) }))
    .filter(p => p.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);

  return { success: true, results };
}

// ===========================================================================
// Embedding backfill
// Runs on posts that were synced before this feature existed.
// Processes in batches of 5 with a 200ms pause to avoid blocking the worker.
// ===========================================================================

const BACKFILL_BATCH   = 5;
const BACKFILL_PAUSE   = 200; // ms between batches

async function runBackfill() {
  const stored     = await chrome.storage.local.get('posts');
  const posts      = stored.posts ?? [];
  const unembedded = posts.filter(p => !p.embedding);

  if (unembedded.length === 0) return;

  let count = 0;

  for (let i = 0; i < unembedded.length; i += BACKFILL_BATCH) {
    const batch = unembedded.slice(i, i + BACKFILL_BATCH);

    for (const post of batch) {
      try {
        post.embedding = await generateEmbedding(post.postText);
        console.log(`[SavedIn] Backfill: embedded post ${post.id}`);
        count++;
      } catch (err) {
        console.warn(`[SavedIn] Backfill: failed on post ${post.id}:`, err.message);
      }
    }

    // Persist each batch so progress survives a service worker restart
    await chrome.storage.local.set({ posts });

    const done = (i + BACKFILL_BATCH) >= unembedded.length;
    // Notify popup — fire and forget, popup may not be open
    chrome.runtime.sendMessage({
      type: 'BACKFILL_PROGRESS', count, total: unembedded.length, done,
    }).catch(() => {});

    if (!done) await new Promise(r => setTimeout(r, BACKFILL_PAUSE));
  }
}
