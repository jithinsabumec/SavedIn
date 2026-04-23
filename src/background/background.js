/**
 * background.js — SavedIn Service Worker
 *
 * Message types handled:
 *   SYNC_POSTS         — legacy single-pass sync (kept for backwards compat)
 *   SYNC_POSTS_PARTIAL — one batch from the auto-scroll loop; partial: true
 *   SYNC_COMPLETE      — scroll loop finished; partial: false, final count
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    SYNC_POSTS:         () => handleLegacySync(message.posts, message.warning),
    SYNC_POSTS_PARTIAL: () => handlePartial(message.posts, message.totalThisSession),
    SYNC_COMPLETE:      () => handleComplete(message.totalThisSession),
  };

  const handler = handlers[message.type];
  if (!handler) return;

  handler()
    .then(sendResponse)
    .catch((err) => {
      console.error(`[SavedIn] Error handling ${message.type}:`, err);
      sendResponse({ success: false, error: err.message });
    });

  return true; // keep the message channel open for the async response
});

// ===========================================================================
// Shared merge helper
// ===========================================================================

/**
 * Merges incomingPosts into storage, deduplicating by post ID.
 * Returns { newCount, totalCount }.
 */
async function mergePosts(incomingPosts) {
  const stored   = await chrome.storage.local.get('posts');
  const existing = stored.posts ?? [];

  const existingIds = new Set(existing.map((p) => p.id));
  const newPosts    = incomingPosts.filter((p) => !existingIds.has(p.id));
  const merged      = [...newPosts, ...existing];

  await chrome.storage.local.set({ posts: merged });

  return { newCount: newPosts.length, totalCount: merged.length };
}

// ===========================================================================
// Handlers
// ===========================================================================

/** Original single-pass sync — kept for backwards compatibility. */
async function handleLegacySync(incomingPosts, warning) {
  const { newCount, totalCount } = await mergePosts(incomingPosts);

  await chrome.storage.local.set({
    lastSyncResult: {
      partial:           false,
      newCount,
      totalThisSession:  newCount,
      totalCount,
      at:                Date.now(),
      ...(warning ? { warning } : {}),
    },
  });

  return { success: true, newCount, totalCount };
}

/**
 * One batch from the scroll loop.
 * Writes lastSyncResult with partial: true so the popup updates its live
 * counter without stopping the loading state.
 */
async function handlePartial(incomingPosts, totalThisSession) {
  const { newCount, totalCount } = await mergePosts(incomingPosts);

  await chrome.storage.local.set({
    lastSyncResult: {
      partial:          true,
      newCount,
      totalThisSession, // running total sent by content.js this session
      totalCount,
      at:               Date.now(),
    },
  });

  return { success: true };
}

/**
 * Scroll loop finished (or was cancelled / errored).
 * Writes lastSyncResult with partial: false — this is the signal the popup
 * uses to stop the loading state.
 */
async function handleComplete(totalThisSession) {
  const stored     = await chrome.storage.local.get('posts');
  const totalCount = (stored.posts ?? []).length;

  await chrome.storage.local.set({
    lastSyncResult: {
      partial:          false,
      totalThisSession,
      totalCount,
      at:               Date.now(),
    },
  });

  return { success: true };
}
