/**
 * popup.js — SavedIn popup: post count, LinkedIn sync, auth, open web app.
 * Local sync never depends on Convex or auth; Convex runs only in the service worker.
 *
 * `VITE_WEB_APP_ORIGIN` is set at build time (see extension/.env.example) — e.g. your Cloudflare Pages URL.
 */

const WEB_APP_ORIGIN = import.meta.env.VITE_WEB_APP_ORIGIN || '';

const postCount = document.getElementById('postCount');
const syncBtn = document.getElementById('syncBtn');
const cancelBtn = document.getElementById('cancelBtn');
const openAppBtn = document.getElementById('openAppBtn');
const syncHint = document.getElementById('syncHint');
const authSignedOut = document.getElementById('authSectionSignedOut');
const authSignedIn = document.getElementById('authSectionSignedIn');
const signInBtn = document.getElementById('signInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const userEmailDisplay = document.getElementById('userEmailDisplay');

let allPosts = [];
let activeSyncTabId = null;

async function init() {
  allPosts = await loadPosts();
  renderPostCount();
  await renderAuthState();

  if (!WEB_APP_ORIGIN) {
    openAppBtn.disabled = true;
    signInBtn.disabled = true;
    setHint('Set VITE_WEB_APP_ORIGIN in extension/.env, run build, reload the extension.', 'warning');
  }

  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
}

function onRuntimeMessage(message) {
  if (message?.type === 'AUTH_SUCCESS') {
    void renderAuthState();
  }
}

function onStorageChanged(changes, area) {
  if (area !== 'local') return;

  if (changes.posts) {
    allPosts = (changes.posts.newValue ?? []).slice().sort((a, b) => new Date(b.syncedAt) - new Date(a.syncedAt));
    renderPostCount();
  }

  if (changes.authToken || changes.userEmail || changes.clerkUserId || changes.authTokenExpiresAt) {
    void renderAuthState();
  }
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

async function renderAuthState() {
  const { authToken, userEmail, clerkUserId } = await chrome.storage.local.get([
    'authToken',
    'userEmail',
    'clerkUserId',
  ]);

  if (authToken && clerkUserId) {
    authSignedOut.hidden = true;
    authSignedIn.hidden = false;
    userEmailDisplay.textContent = userEmail || clerkUserId;
  } else {
    authSignedOut.hidden = false;
    authSignedIn.hidden = true;
    userEmailDisplay.textContent = '';
  }
}

function setHint(text, variant = '') {
  syncHint.textContent = text;
  syncHint.className = 'sync-hint visible' + (variant ? ` ${variant}` : '');
}

function clearHint() {
  syncHint.textContent = 'Stay on the LinkedIn tab while syncing';
  syncHint.className = 'sync-hint';
}

syncBtn.addEventListener('click', async () => {
  clearHint();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes('linkedin.com/my-items/saved-posts')) {
    setHint('Open your LinkedIn saved posts page first', 'warning');
    return;
  }

  activeSyncTabId = tab.id;
  setSyncing(true);
  clearHint();

  try {
    const syncPromise = watchSyncProgress((partial) => {
      setHint(`Scrolling… ${partial.totalThisSession} posts found`, 'success');
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__savedInManualSyncTrigger = true;
      },
    });

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });

    const result = await syncPromise;

    setHint(
      result.totalThisSession === 0
        ? 'Already up to date'
        : `${result.totalThisSession} new post${result.totalThisSession !== 1 ? 's' : ''} added`,
      'success',
    );

    allPosts = await loadPosts();
    renderPostCount();
    setTimeout(clearHint, 3200);
  } catch (err) {
    console.error('[SavedIn] Sync failed:', err);
    setHint('Sync failed. Please try again.', 'error');
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
  if (!WEB_APP_ORIGIN) {
    setHint('Web app URL not configured (VITE_WEB_APP_ORIGIN). Rebuild the extension.', 'warning');
    return;
  }

  const webAppUrl = WEB_APP_ORIGIN;
  let focusedExisting = false;

  try {
    const tabs = await chrome.tabs.query({ url: `${webAppUrl}/*` });
    const existing = tabs[0];
    if (existing?.id != null) {
      await chrome.tabs.update(existing.id, { active: true });
      focusedExisting = true;
      if (existing.windowId != null) {
        try {
          await chrome.windows.update(existing.windowId, { focused: true });
        } catch {
          // Window focus is optional; tab activation is enough.
        }
      }
    }
  } catch (err) {
    console.warn('[SavedIn] Could not query for an open SavedIn tab:', err?.message ?? err);
  }

  if (!focusedExisting) {
    await chrome.tabs.create({ url: webAppUrl, active: true });
  }

  window.close();
});

signInBtn.addEventListener('click', () => {
  if (!WEB_APP_ORIGIN) {
    setHint('Web app URL not configured (VITE_WEB_APP_ORIGIN). Rebuild the extension.', 'warning');
    return;
  }
  chrome.tabs.create({ url: `${WEB_APP_ORIGIN}?extension_auth=true` });
  window.close();
});

signOutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove(['authToken', 'authTokenExpiresAt', 'clerkUserId', 'userEmail']);
  await renderAuthState();
});

/**
 * Watches storage for sync progress. Calls onPartial() for every partial batch
 * and resolves when the final SYNC_COMPLETE arrives (partial: false).
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

void init();
