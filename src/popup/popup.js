/**
 * popup.js — SavedIn Popup UI
 *
 * Two search modes:
 *   text     — keystroke-driven, instant, case-insensitive substring match
 *   semantic — triggered by Enter, sends query to background for embedding + cosine ranking
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const searchInput  = document.getElementById('searchInput');
const results      = document.getElementById('results');
const emptyState   = document.getElementById('emptyState');
const postCount    = document.getElementById('postCount');
const statusMsg    = document.getElementById('statusMsg');
const searchModeEl = document.getElementById('searchMode');
const syncBtn      = document.getElementById('syncBtn');
const cancelBtn    = document.getElementById('cancelBtn');

// ── State ─────────────────────────────────────────────────────────────────────
let allPosts            = [];
let searchMode          = 'text';   // 'text' | 'semantic'
let semanticPending     = false;
let activeSyncTabId     = null;

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  allPosts = await loadPosts();
  renderResults(searchPosts('', allPosts));
  searchInput.focus();

  // Trigger silent backfill if any post is missing an embedding
  if (allPosts.length > 0 && allPosts.some(p => !p.embedding)) {
    chrome.runtime.sendMessage({ type: 'GENERATE_EMBEDDINGS_FOR_EXISTING' })
      .catch(() => {}); // fire and forget — progress arrives via BACKFILL_PROGRESS messages
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

// ── Background message listener (backfill progress) ───────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'BACKFILL_PROGRESS') return;
  if (message.done) {
    showStatus('AI search ready', 'success');
  } else {
    showStatus(`Indexing for AI search… ${message.count} / ${message.total}`, 'progress');
  }
});

// ── Text search (keystroke) ───────────────────────────────────────────────────

/**
 * Case-insensitive substring search across postText and authorName.
 * Returns results with the exact byte ranges of every match in postText,
 * so highlights are always the complete query phrase — never scattered tokens.
 */
function searchPosts(query, posts) {
  const q = query.trim();
  if (!q) return posts.map(p => ({ item: p, ranges: [] }));

  const qLower  = q.toLowerCase();
  const matched = [];

  for (const post of posts) {
    const textLower   = post.postText.toLowerCase();
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

searchInput.addEventListener('input', () => {
  // Any keystroke resets to text mode and clears semantic state
  if (searchMode === 'semantic') {
    searchMode = 'semantic-stale'; // keeps label until fully replaced
  }
  searchMode = 'text';
  setModeLabel('');
  renderResults(searchPosts(searchInput.value, allPosts));
});

// ── Semantic search (Enter key) ───────────────────────────────────────────────
searchInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  if (semanticPending) return;

  const query = searchInput.value.trim();
  if (!query) return;

  semanticPending = true;
  searchMode      = 'semantic';
  showStatus('Searching by meaning…', 'progress');
  setModeLabel('AI search · loading…');

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Semantic search timed out')), 30_000));

    const response = await Promise.race([
      chrome.runtime.sendMessage({ type: 'SEMANTIC_SEARCH', query }),
      timeoutPromise,
    ]);

    clearStatus();

    if (!response?.success) throw new Error(response?.error ?? 'Unknown error');

    const items = response.results.map(post => ({ item: post, ranges: [], semantic: true }));
    renderResults(items);

    if (items.length === 0) {
      setModeLabel('AI search · no matches (try a broader query or sync more posts)');
    } else {
      setModeLabel(`AI search · ${items.length} result${items.length !== 1 ? 's' : ''} by meaning · press any key for text search`);
    }
  } catch (err) {
    clearStatus();
    const isTimeout = err.message.includes('timed out');
    showStatus(
      isTimeout
        ? 'AI model loading — try again in a moment'
        : 'AI search unavailable — check background console',
      'warning',
    );
    searchMode = 'text';
    setModeLabel('');
    console.error('[SavedIn] Semantic search error:', err);
  } finally {
    semanticPending = false;
  }
});

// ── Render ────────────────────────────────────────────────────────────────────
function renderResults(items) {
  results.querySelectorAll('.card').forEach(c => c.remove());

  const count    = items.length;
  const isSearch = searchInput.value.trim().length > 0;

  postCount.textContent = isSearch
    ? `${count} result${count !== 1 ? 's' : ''}`
    : `${allPosts.length} post${allPosts.length !== 1 ? 's' : ''}`;

  if (count === 0) {
    emptyState.classList.add('show');
    emptyState.querySelector('p').textContent     = allPosts.length === 0 ? 'No posts synced yet'                          : 'No posts found';
    emptyState.querySelector('.hint').textContent = allPosts.length === 0 ? 'Click the sync button to import from LinkedIn' : 'Try a different search term';
    return;
  }

  emptyState.classList.remove('show');

  const fragment = document.createDocumentFragment();

  for (const { item: post, ranges, semantic } of items) {
    const preview = buildHighlightedPreview(post.postText, ranges);
    const card    = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-header">
        <span class="author-name">${escapeHtml(post.authorName)}</span>
        <div class="card-header-right">
          ${semantic ? '<span class="ai-match">AI match</span>' : ''}
          <a class="open-link" href="${escapeHtml(post.postUrl)}" target="_blank" rel="noopener noreferrer">Open post ↗</a>
        </div>
      </div>
      ${post.authorHeadline ? `<div class="author-headline">${escapeHtml(post.authorHeadline)}</div>` : ''}
      <div class="post-preview">${preview}</div>
    `;
    fragment.appendChild(card);
  }

  results.appendChild(fragment);
}

/**
 * Returns an HTML snippet centred around the first match so the highlighted
 * term is always visible, even when it appears deep in a long post.
 * Falls back to the opening 300 chars when there are no match ranges
 * (semantic results have no exact matches to highlight).
 */
function buildHighlightedPreview(text, ranges) {
  const WINDOW = 300;
  const PAD    = 80;

  if (!ranges || ranges.length === 0) {
    const preview = text.slice(0, WINDOW) + (text.length > WINDOW ? '…' : '');
    return escapeHtml(preview);
  }

  const [firstStart]  = ranges[0];
  const winStart      = Math.max(0, firstStart - PAD);
  const winEnd        = winStart + WINDOW;
  const excerpt       = text.slice(winStart, winEnd);
  const leadEllipsis  = winStart > 0;
  const trailEllipsis = winEnd < text.length;

  const local = ranges
    .map(([s, e]) => [s - winStart, e - winStart])
    .filter(([s, e]) => e >= 0 && s < excerpt.length)
    .map(([s, e]) => [Math.max(0, s), Math.min(e, excerpt.length - 1)]);

  let html   = leadEllipsis ? '…' : '';
  let cursor = 0;

  for (const [start, end] of local) {
    if (start > cursor) html += escapeHtml(excerpt.slice(cursor, start));
    html   += `<mark>${escapeHtml(excerpt.slice(start, end + 1))}</mark>`;
    cursor  = end + 1;
  }

  if (cursor < excerpt.length) html += escapeHtml(excerpt.slice(cursor));
  if (trailEllipsis) html += '…';

  return html;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Sync ──────────────────────────────────────────────────────────────────────
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
      showStatus(`Scrolling… ${partial.totalThisSession} posts found`, 'progress');
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
    renderResults(searchPosts(searchInput.value, allPosts));
  } catch (err) {
    console.error('[SavedIn] Sync failed:', err);
    showStatus('Sync failed — check the console', 'error');
  } finally {
    setSyncing(false);
    activeSyncTabId = null;
  }
});

cancelBtn.addEventListener('click', async () => {
  if (!activeSyncTabId) return;
  chrome.tabs.sendMessage(activeSyncTabId, { type: 'CANCEL_SYNC' }).catch(() => {});
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

// ── UI helpers ────────────────────────────────────────────────────────────────
function setSyncing(active) {
  syncBtn.disabled = active;
  syncBtn.classList.toggle('loading', active);
  document.body.classList.toggle('syncing', active);
}

function setModeLabel(text) {
  searchModeEl.textContent = text;
}

function showStatus(msg, type = 'success') {
  statusMsg.textContent = msg;
  statusMsg.className   = `status-msg show ${type}`;
  if (type === 'success') setTimeout(clearStatus, 3000);
}

function clearStatus() {
  statusMsg.textContent = '';
  statusMsg.className   = 'status-msg';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
