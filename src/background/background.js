/**
 * background.js — SavedIn Service Worker
 *
 * Receives SYNC_POSTS from the content script, merges posts into storage,
 * and writes a lastSyncResult key so the popup can always detect completion —
 * even when no new posts were added (storage.onChanged won't fire for posts
 * if the array didn't change, but lastSyncResult always has a fresh timestamp).
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SYNC_POSTS') {
    handleSync(message.posts, message.warning)
      .then(sendResponse)
      .catch((err) => {
        console.error('[SavedIn] Sync error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // keep the channel open for the async response
  }
});

async function handleSync(incomingPosts, warning) {
  const result = await chrome.storage.local.get('posts');
  const existing = result.posts ?? [];

  const existingIds = new Set(existing.map((p) => p.id));
  const newPosts = incomingPosts.filter((p) => !existingIds.has(p.id));
  const merged = [...newPosts, ...existing];

  // Always write lastSyncResult with a fresh timestamp so storage.onChanged
  // fires reliably even when newPosts is empty.
  await chrome.storage.local.set({
    posts: merged,
    lastSyncResult: {
      newCount: newPosts.length,
      totalCount: merged.length,
      at: Date.now(),
      ...(warning ? { warning } : {}),
    },
  });

  return { success: true, newCount: newPosts.length, totalCount: merged.length };
}
