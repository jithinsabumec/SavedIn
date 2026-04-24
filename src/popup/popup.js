/**
 * popup.js — SavedIn Popup UI
 *
 * The popup is intentionally minimal:
 * - current synced post count
 * - sync controls
 * - button to open the full SavedIn app
 */

const postCount  = document.getElementById('postCount');
const syncStatus = document.getElementById('syncStatus');
const syncBtn    = document.getElementById('syncBtn');
const cancelBtn  = document.getElementById('cancelBtn');
const openAppBtn = document.getElementById('openAppBtn');

let allPosts        = [];
let activeSyncTabId = null;

async function init() {
  allPosts = await loadPosts();
  renderPostCount();
}

async function loadPosts() {
  return new Promise((resolve) => {
    chrome.storage.local.get('posts', (data) => {
      const posts = data.posts ?? [];
      posts.sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt));
      resolve(posts);
    });
  });
}

function renderPostCount() {
  postCount.textContent = `${allPosts.length} post${allPosts.length !== 1 ? 's' : ''} synced`;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.posts) return;
  allPosts = (changes.posts.newValue ?? []).slice().sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt));
  renderPostCount();
});

syncBtn.addEventListener('click', async () => {
  clearStatus();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes('linkedin.com/my-items/saved-posts')) {
    showStatus('Open your LinkedIn saved posts page first', 'warning');
    return;
  }

  activeSyncTabId = tab.id;
  setSyncing(true);

  try {
    const syncPromise = watchSyncProgress((partial) => {
      showStatus(`Scrolling... ${partial.totalThisSession} posts found`, 'progress');
    });

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });

    const result = await syncPromise;

    showStatus(
      result.totalThisSession === 0
        ? 'Already up to date'
        : `${result.totalThisSession} new post${result.totalThisSession !== 1 ? 's' : ''} added`,
      'success',
    );

    allPosts = await loadPosts();
    renderPostCount();
  } catch (err) {
    console.error('[SavedIn] Sync failed:', err);
    showStatus('Sync failed. Please try again.', 'error');
  } finally {
    setSyncing(false);
    activeSyncTabId = null;
  }
});

cancelBtn.addEventListener('click', async () => {
  if (!activeSyncTabId) return;
  chrome.tabs.sendMessage(activeSyncTabId, { type: 'CANCEL_SYNC' }).catch(() => {});
});

openAppBtn.addEventListener('click', async () => {
  const appUrl = chrome.runtime.getURL('app.html');
  const tabs   = await chrome.tabs.query({ url: appUrl });
  const open   = tabs[0];

  if (open?.id) {
    await chrome.tabs.update(open.id, { active: true });
    await chrome.windows.update(open.windowId, { focused: true });
    window.close();
    return;
  }

  await chrome.tabs.create({ url: appUrl });
  window.close();
});

/**
 * Watches storage for sync progress. Calls onPartial() for every partial batch
 * and resolves when the final SYNC_COMPLETE arrives (partial: false).
 * Timeout extended to 120s to allow for a full scroll-sync session.
 */
function watchSyncProgress(onPartial) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.storage.onChanged.removeListener(listener);
      reject(new Error('Sync timed out'));
    }, 120_000);

    function listener(changes, area) {
      if (area !== 'local' || !changes.lastSyncResult) return;
      const result = changes.lastSyncResult.newValue;
      if (result.partial) {
        onPartial(result);
      } else {
        clearTimeout(timeout);
        chrome.storage.onChanged.removeListener(listener);
        resolve(result);
      }
    }

    chrome.storage.onChanged.addListener(listener);
  });
}

function setSyncing(active) {
  syncBtn.disabled = active;
  syncBtn.classList.toggle('loading', active);
  document.body.classList.toggle('syncing', active);
}

function showStatus(message, type = 'success') {
  syncStatus.textContent = message;
  syncStatus.className   = `sync-status ${type}`;
  if (type === 'success') setTimeout(clearStatus, 3000);
}

function clearStatus() {
  syncStatus.textContent = '';
  syncStatus.className   = 'sync-status';
}

init();
