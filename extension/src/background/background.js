/**
 * background.js — SavedIn Service Worker
 *
 * Message types handled:
 *   SYNC_POSTS                        — legacy single-pass sync (kept for backwards compat)
 *   SYNC_POSTS_PARTIAL                — one batch from the auto-scroll loop; partial: true
 *   SYNC_COMPLETE                     — scroll loop finished; partial: false, final count
 *   OPEN_DASHBOARD                    — first-install setup: open the SavedIn web app
 *   SEMANTIC_SEARCH                   — embed a query and rank stored posts by cosine similarity
 *   GENERATE_EMBEDDINGS_FOR_EXISTING  — backfill embeddings for posts synced before this feature
 *
 * External messages (hosted web app origin via `externally_connectable` + VITE_WEB_APP_ORIGIN at build):
 *   AUTH_SUCCESS                      — Clerk Convex JWT + user info after web sign-in
 *
 * Port types handled:
 *   chat                              — streams chat completion chunks back to the app page
 */

import { pipeline, env } from '@xenova/transformers';

/** Convex deployment URL (injected at build time from extension/.env). */
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL ?? '';

/** Hosted web dashboard origin only, e.g. `https://your-project.pages.dev` (from `VITE_WEB_APP_ORIGIN` at build). */
const WEB_APP_ORIGIN = import.meta.env.VITE_WEB_APP_ORIGIN || '';

env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('/');
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = 1;

const DEFAULT_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const SIMILARITY_THRESHOLD = 0.25;
const MAX_SEMANTIC_RESULTS = 20;
const CHAT_TEXT_CANDIDATES = 30;
const CHAT_SEMANTIC_CANDIDATES = 30;
const CHAT_CONTEXT_POSTS = 8;
const CHAT_LIBRARY_CONTEXT_POSTS = 20;
const CHAT_MAX_CONTEXT_CHARS = 45000;
const CHAT_MIN_POST_SNIPPET = 40;
const CHAT_MAX_POST_SNIPPET = 180;
const BACKFILL_BATCH = 5;
const BACKFILL_PAUSE = 200;

let embedder = null;
let backfillPromise = null;

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;

  chrome.storage.local.set({ isFirstInstall: true });
  chrome.tabs.create({
    url: 'https://www.linkedin.com/my-items/saved-posts/?savedin_setup=true',
  });
});

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

/**
 * Generate a normalised 384-dim embedding for `text`.
 * Input is truncated to 512 chars to stay within the model's token budget.
 * Returns a plain JS number array so it can be stored in chrome.storage.local.
 */
async function generateEmbedding(text) {
  const fn = await getEmbedder();
  const output = await fn(text.slice(0, 512), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'SYNC_POSTS':
      handleLegacySync(message.posts, message.warning)
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;

    case 'SYNC_POSTS_PARTIAL':
      handlePartial(message.posts, message.totalThisSession)
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;

    case 'SYNC_COMPLETE':
      handleComplete(message.totalThisSession)
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;

    case 'OPEN_DASHBOARD':
      if (WEB_APP_ORIGIN) {
        chrome.tabs.create({ url: WEB_APP_ORIGIN });
      } else {
        console.warn('[SavedIn] OPEN_DASHBOARD skipped: set VITE_WEB_APP_ORIGIN when building the extension');
      }
      sendResponse({ success: true });
      return true;

    case 'SEMANTIC_SEARCH':
      handleSemanticSearch(message.query)
        .then(sendResponse)
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;

    case 'GENERATE_EMBEDDINGS_FOR_EXISTING':
      ensureBackfillRunning()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;

    default:
      return false;
  }
});

/**
 * Hosted web app sends auth after Clerk sign-in so the extension can call Convex.
 */
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!WEB_APP_ORIGIN) {
    sendResponse({ ok: false, error: 'extension_web_origin_not_configured' });
    return false;
  }

  if (sender.origin !== WEB_APP_ORIGIN) {
    sendResponse({ ok: false, error: 'invalid_origin' });
    return false;
  }

  if (message?.type !== 'AUTH_SUCCESS') {
    sendResponse({ ok: false, error: 'unknown_message' });
    return false;
  }

  const { token, email, userId, tokenExpiresAt } = message;

  if (typeof token !== 'string' || typeof userId !== 'string') {
    sendResponse({ ok: false, error: 'invalid_payload' });
    return false;
  }

  const toStore = {
    authToken: token,
    userEmail: typeof email === 'string' ? email : '',
    clerkUserId: userId,
  };

  if (typeof tokenExpiresAt === 'number' && Number.isFinite(tokenExpiresAt)) {
    toStore.authTokenExpiresAt = tokenExpiresAt;
  }

  chrome.storage.local
    .set(toStore)
    .then(() => {
      sendResponse({ ok: true });
      // Notify open extension UIs (e.g. popup) — internal message, not from the web.
      chrome.runtime
        .sendMessage({
          type: 'AUTH_SUCCESS',
          token,
          email: toStore.userEmail,
          userId,
          tokenExpiresAt: toStore.authTokenExpiresAt,
        })
        .catch(() => {});
    })
    .catch((err) => {
      sendResponse({ ok: false, error: err?.message ?? 'storage_failed' });
    });

  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'chat') return;
  handleChatPort(port);
});

async function getStoredPosts() {
  const stored = await chrome.storage.local.get('posts');
  return stored.posts ?? [];
}

async function getSettings() {
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings ?? {};
  return {
    apiKey: settings.apiKey ?? '',
    model: settings.model ?? DEFAULT_MODEL,
  };
}

/**
 * Merge incomingPosts into storage, deduplicating by post ID.
 * Returns { newCount, totalCount, newPosts } so callers can embed only the
 * posts that are genuinely new.
 */
async function mergePosts(incomingPosts) {
  const stored = await chrome.storage.local.get('posts');
  const existing = stored.posts ?? [];
  const existingIds = new Set(existing.map((post) => post.id));
  const newPosts = incomingPosts.filter((post) => !existingIds.has(post.id));
  const merged = [...newPosts, ...existing];
  await chrome.storage.local.set({ posts: merged });

  // Never block local sync — Convex runs in the background.
  pushToConvex(newPosts).catch((err) => {
    console.warn('[SavedIn] Convex push failed silently:', err?.message ?? err);
  });

  return { newCount: newPosts.length, totalCount: merged.length, newPosts };
}

/**
 * Read JWT `exp` (seconds since epoch) without verifying the signature — used only to skip
 * obviously expired tokens before calling Convex.
 */
function readJwtExpSeconds(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const json = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/**
 * Push newly merged posts to Convex so the web dashboard updates in real time.
 * Uses the Clerk-issued Convex JWT stored by the web app after sign-in.
 */
async function pushToConvex(newPosts) {
  if (!newPosts.length) return;

  if (!CONVEX_URL) {
    console.log('[SavedIn] VITE_CONVEX_URL not set, skipping Convex sync');
    return;
  }

  const stored = await chrome.storage.local.get(['clerkUserId', 'authToken', 'authTokenExpiresAt']);

  if (!stored.clerkUserId || !stored.authToken) {
    console.log('[SavedIn] Not signed in, skipping Convex sync');
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expFromJwt = readJwtExpSeconds(stored.authToken);
  const expSec = typeof stored.authTokenExpiresAt === 'number'
    ? Math.floor(stored.authTokenExpiresAt / 1000)
    : expFromJwt;

  // Refresh policy: if we cannot prove the token is still valid for ~2 minutes, skip the push.
  if (expSec !== null && nowSec >= expSec - 120) {
    console.log('[SavedIn] Convex auth token expired or near expiry; open SavedIn web to sign in again');
    return;
  }

  const base = CONVEX_URL.replace(/\/$/, '');
  const url = `${base}/api/mutation`;

  const args = {
    posts: newPosts.map((p) => ({
      id: p.id,
      postText: p.postText,
      authorName: p.authorName,
      authorHeadline: p.authorHeadline,
      postUrl: p.postUrl,
      savedDate: p.savedDate,
      syncedAt: p.syncedAt,
      embedding: p.embedding,
    })),
    userId: stored.clerkUserId,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${stored.authToken}`,
      },
      body: JSON.stringify({
        path: 'posts:upsertPosts',
        format: 'json',
        args,
      }),
    });

    if (response.status === 401) {
      console.warn('[SavedIn] Convex sync unauthorized (401); clearing stored auth');
      await chrome.storage.local.remove(['authToken', 'authTokenExpiresAt', 'clerkUserId', 'userEmail']);
      return;
    }

    if (!response.ok) {
      console.warn('[SavedIn] Convex sync failed:', response.status);
      return;
    }

    const result = await response.json();
    if (result.status === 'success') {
      console.log(`[SavedIn] Convex sync: ${result.value?.inserted ?? '?'} inserted`);
    } else {
      console.warn('[SavedIn] Convex sync error:', result.errorMessage ?? result);
    }
  } catch (err) {
    console.warn('[SavedIn] Convex sync error:', err?.message ?? err);
  }
}

/**
 * After syncing, generate embeddings for newly added posts without blocking
 * the sync confirmation that the popup is waiting for.
 */
async function generateAndStoreEmbeddings(posts) {
  if (posts.length === 0) return;

  const stored = await chrome.storage.local.get('posts');
  const all = stored.posts ?? [];
  const byId = new Map(all.map((post) => [post.id, post]));

  for (const post of posts) {
    const storedPost = byId.get(post.id);
    if (!storedPost) continue;

    try {
      storedPost.embedding = await generateEmbedding(post.postText);
    } catch (error) {
      console.warn(`[SavedIn] Could not embed post ${post.id}:`, error.message);
    }
  }

  await chrome.storage.local.set({ posts: all });
}

async function handleLegacySync(incomingPosts, warning) {
  const { newCount, totalCount, newPosts } = await mergePosts(incomingPosts);

  await chrome.storage.local.set({
    lastSyncResult: {
      partial: false,
      newCount,
      totalThisSession: newCount,
      totalCount,
      at: Date.now(),
      ...(warning ? { warning } : {}),
    },
  });

  generateAndStoreEmbeddings(newPosts).catch((error) => {
    console.warn('[SavedIn] Post-sync embedding error:', error.message);
  });

  return { success: true, newCount, totalCount };
}

async function handlePartial(incomingPosts, totalThisSession) {
  const { newCount, totalCount, newPosts } = await mergePosts(incomingPosts);

  await chrome.storage.local.set({
    lastSyncResult: {
      partial: true,
      newCount,
      totalThisSession,
      totalCount,
      at: Date.now(),
    },
  });

  generateAndStoreEmbeddings(newPosts).catch((error) => {
    console.warn('[SavedIn] Partial embedding error:', error.message);
  });

  return { success: true };
}

async function handleComplete(totalThisSession) {
  const stored = await chrome.storage.local.get('posts');
  const totalCount = (stored.posts ?? []).length;

  await chrome.storage.local.set({
    lastSyncResult: {
      partial: false,
      totalThisSession,
      totalCount,
      at: Date.now(),
    },
  });

  return { success: true };
}

async function handleSemanticSearch(query) {
  const posts = await getStoredPosts();
  const results = await semanticRankPosts(query, posts, {
    limit: MAX_SEMANTIC_RESULTS,
    threshold: SIMILARITY_THRESHOLD,
  });

  return { success: true, results };
}

function ensureBackfillRunning() {
  if (!backfillPromise) {
    backfillPromise = runBackfill().finally(() => {
      backfillPromise = null;
    });
  }

  return backfillPromise;
}

async function runBackfill() {
  const posts = await getStoredPosts();
  const unembedded = posts.filter((post) => !post.embedding);

  if (unembedded.length === 0) return;

  let done = 0;

  for (let i = 0; i < unembedded.length; i += BACKFILL_BATCH) {
    const batch = unembedded.slice(i, i + BACKFILL_BATCH);

    for (const post of batch) {
      try {
        post.embedding = await generateEmbedding(post.postText);
      } catch (error) {
        console.warn(`[SavedIn] Backfill failed for post ${post.id}:`, error.message);
      } finally {
        done += 1;
      }
    }

    await chrome.storage.local.set({ posts });

    chrome.runtime.sendMessage({
      type: 'BACKFILL_PROGRESS',
      done,
      total: unembedded.length,
    }).catch(() => {});

    if (done < unembedded.length) {
      await new Promise((resolve) => setTimeout(resolve, BACKFILL_PAUSE));
    }
  }
}

function handleChatPort(port) {
  let closed = false;
  let handled = false;
  const isClosed = () => closed;

  port.onDisconnect.addListener(() => {
    closed = true;
  });

  port.onMessage.addListener(async (message) => {
    if (handled || !message?.query) return;
    handled = true;

    try {
      const settings = await getSettings();

      if (!settings.apiKey) {
        throw new ChatError('Add your Google AI Studio API key in settings to use chat');
      }

      const posts = await getStoredPosts();
      const contextPosts = await buildChatContext(message.query, posts);
      const systemPrompt = buildSystemPrompt(contextPosts);
      const endpoint = `${GEMINI_API_BASE}/models/${encodeURIComponent(settings.model || DEFAULT_MODEL)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(settings.apiKey)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            ...normaliseHistory(message.history),
            {
              role: 'user',
              parts: [{ text: message.query }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 10000,
          },
        }),
      });

      if (!response.ok) {
        throw await toChatError(response);
      }

      if (!response.body) {
        throw new ChatError('Something went wrong. Please try again.');
      }

      const { fullText, citedIds, cleanedText } = await streamChatResponse(response.body, port, isClosed);

      if (!closed) {
        port.postMessage({ type: 'CHAT_DONE', citedIds, fullText: cleanedText || fullText });
      }
    } catch (error) {
      if (!closed) {
        port.postMessage({
          type: 'CHAT_ERROR',
          message: error instanceof ChatError ? error.message : 'Something went wrong. Please try again.',
        });
      }
    } finally {
      if (!closed) {
        port.disconnect();
      }
    }
  });
}

async function buildChatContext(query, posts) {
  const broadLibraryQuery = isBroadLibraryQuery(query);
  const textMatches = searchPosts(query, posts)
    .map(({ item }) => item)
    .slice(0, CHAT_TEXT_CANDIDATES);

  let semanticMatches = [];

  try {
    semanticMatches = await semanticRankPosts(query, posts, {
      limit: CHAT_SEMANTIC_CANDIDATES,
      threshold: broadLibraryQuery ? null : 0.12,
    });
  } catch (error) {
    console.warn('[SavedIn] Chat semantic retrieval fallback:', error.message);
  }

  const merged = mergeUniquePosts(textMatches, semanticMatches);

  const prioritized = broadLibraryQuery
    ? topUpWithRecentPosts(merged, posts, CHAT_LIBRARY_CONTEXT_POSTS)
    : (merged.length === 0 ? [] : merged.slice(0, CHAT_CONTEXT_POSTS));

  // The chat model now receives the full saved-post library as context.
  // We still order posts so the most relevant ones appear first.
  return topUpWithRecentPosts(prioritized, posts, posts.length);
}

function buildSystemPrompt(posts) {
  const intro = `You are a helpful assistant for a personal LinkedIn saved posts library.
Answer questions using only the saved posts provided as context. Be conversational and concise. If the answer is not in the posts, say so honestly.

CITATION RULES — follow exactly:
- When you reference a post, place its 8-character hex ID in parentheses immediately after the mention, like this: (a76958ef)
- If you reference multiple posts in one sentence, list them together: (a76958ef, 1e165b70)
- NEVER write "POST_ID:" anywhere in your response. NEVER list raw IDs as bullet points.
- At the very end of your response, on its own line, output: CITED_POSTS: ["id1","id2",...] with every ID you cited. This line will be hidden from the user.

STYLE RULES:
- Start your response with the actual answer immediately. Do NOT write "Let me scan", "Looking at the posts", "I notice", or any reasoning out loud.
- Use markdown formatting: **bold** for emphasis, bullet lists for multiple items.
- Describe posts by their content or author — do not expose raw IDs except in parenthetical citations.

Here is the saved-post library:`;

  if (posts.length === 0) {
    return `${intro}\n\nNo saved posts were found in the library.`;
  }

  const blocks = buildCompactPostBlocks(posts);

  return `${intro}\n\n${blocks.join('\n\n')}`;
}

function buildCompactPostBlocks(posts) {
  const templateLength = 60;
  const availableChars = Math.max(
    CHAT_MIN_POST_SNIPPET * posts.length,
    CHAT_MAX_CONTEXT_CHARS - (posts.length * templateLength),
  );
  const perPostBudget = clamp(
    Math.floor(availableChars / Math.max(posts.length, 1)),
    CHAT_MIN_POST_SNIPPET,
    CHAT_MAX_POST_SNIPPET,
  );

  return posts.map((post) => (
    `POST_ID: ${post.id}
AUTHOR: ${post.authorName}
HEADLINE: ${truncateText(post.authorHeadline || 'No headline', 80)}
CONTENT: ${truncateText(post.postText, perPostBudget)}
---`
  ));
}

async function streamChatResponse(body, port, closed) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data: ')) continue;

      const payload = line.slice(6);
      if (payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload);
        const chunk = extractGeminiChunkText(json);
        if (!chunk) continue;

        fullText += chunk;
        if (!closed()) port.postMessage({ type: 'CHAT_CHUNK', text: chunk });
      } catch {
        // Ignore malformed SSE chunks and keep streaming.
      }
    }
  }

  if (buffer.trim().startsWith('data: ')) {
    const payload = buffer.trim().slice(6);
    if (payload !== '[DONE]') {
      try {
        const json = JSON.parse(payload);
        const chunk = extractGeminiChunkText(json);
        if (chunk) {
          fullText += chunk;
          if (!closed()) port.postMessage({ type: 'CHAT_CHUNK', text: chunk });
        }
      } catch {
        // Ignore trailing malformed data.
      }
    }
  }

  let citedIds = [];
  try {
    const match = fullText.match(/CITED_POSTS:\s*(\[[\s\S]*?\])\s*$/i);
    if (match) {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        citedIds = [...new Set(parsed.filter((id) => typeof id === 'string'))];
      }
    }
  } catch {
    citedIds = [];
  }

  const cleanedText = stripCitedPostsLine(fullText);
  return { fullText, citedIds, cleanedText };
}

function normaliseHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((message) => (
      message
      && (message.role === 'user' || message.role === 'assistant')
      && typeof message.content === 'string'
      && message.content.trim()
    ))
    .slice(-6)
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
}

/**
 * Case-insensitive substring search across postText and authorName.
 * Returns results with the exact byte ranges of every match in postText,
 * so highlights are always the complete query phrase — never scattered tokens.
 */
function searchPosts(query, posts) {
  const q = query.trim();
  if (!q) return posts.map((post) => ({ item: post, ranges: [] }));

  const qLower = q.toLowerCase();
  const matched = [];

  for (const post of posts) {
    const textLower = post.postText.toLowerCase();
    const authorLower = post.authorName.toLowerCase();
    if (!textLower.includes(qLower) && !authorLower.includes(qLower)) continue;

    const ranges = [];
    let idx = 0;
    while ((idx = textLower.indexOf(qLower, idx)) !== -1) {
      ranges.push([idx, idx + q.length - 1]);
      idx += q.length;
    }
    matched.push({ item: post, ranges });
  }

  return matched;
}

function stripCitedPostsLine(text) {
  return text.replace(/\s*CITED_POSTS:\s*\[[\s\S]*?\]\s*$/i, '').trim();
}

function truncateText(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

async function semanticRankPosts(query, posts, options = {}) {
  const {
    limit = MAX_SEMANTIC_RESULTS,
    threshold = SIMILARITY_THRESHOLD,
  } = options;

  const embeddedPosts = posts.filter((post) => Array.isArray(post.embedding) && post.embedding.length > 0);
  if (embeddedPosts.length === 0) return [];

  const queryEmbedding = await generateEmbedding(query);

  return embeddedPosts
    .map((post) => ({ ...post, score: cosineSimilarity(queryEmbedding, post.embedding) }))
    .filter((post) => threshold == null || post.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function mergeUniquePosts(...groups) {
  const seen = new Set();
  const merged = [];

  for (const group of groups) {
    for (const post of group) {
      if (!post?.id || seen.has(post.id)) continue;
      seen.add(post.id);
      merged.push(post);
    }
  }

  return merged;
}

function topUpWithRecentPosts(basePosts, allPosts, targetCount) {
  const merged = [...basePosts];
  const seen = new Set(basePosts.map((post) => post.id));

  for (const post of allPosts) {
    if (merged.length >= targetCount) break;
    if (!post?.id || seen.has(post.id)) continue;
    seen.add(post.id);
    merged.push(post);
  }

  return merged;
}

function isBroadLibraryQuery(query) {
  const q = query.toLowerCase();
  return [
    'summary',
    'summarize',
    'overview',
    'what are my saved posts about',
    'what have i saved',
    'across my saved posts',
    'from my saved posts',
    'all my saved posts',
    'my library',
  ].some((phrase) => q.includes(phrase));
}

async function toChatError(response) {
  let responseText = '';
  try {
    responseText = await response.text();
  } catch {
    responseText = '';
  }

  if (response.status === 401) {
    return new ChatError('Invalid Google AI Studio API key. Check your settings.');
  }

  if (response.status === 403) {
    return new ChatError('This Google AI Studio key was rejected. Check the key and model access.');
  }

  if (response.status === 429) {
    return new ChatError('Rate limit reached. Wait a moment and try again.');
  }

  if (
    response.status === 400
    && /context|token|length|too large|maximum/i.test(responseText)
  ) {
    return new ChatError('The request was too large for this model. Try a different model or a narrower question.');
  }

  if (
    response.status === 400
    && /api key not valid|api_key_invalid|key invalid|authentication/i.test(responseText)
  ) {
    return new ChatError('Your Google AI Studio key looks invalid. Please paste a fresh API key in settings.');
  }

  return new ChatError('Something went wrong. Please try again.');
}

class ChatError extends Error {}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function extractGeminiChunkText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';

  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');
}
