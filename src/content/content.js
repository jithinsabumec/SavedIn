/**
 * content.js — SavedIn Content Script
 *
 * Injected on demand via scripting.executeScript. Wrapped in an IIFE so that
 * every injection gets a fresh variable scope — prevents "already declared" errors.
 *
 * Auto-scrolls the LinkedIn saved posts page, scraping posts batch by batch
 * and streaming them to the background via SYNC_POSTS_PARTIAL messages so the
 * popup can show a live running count.
 */

(function () {
  'use strict';

  // Guard against concurrent syncs if the user clicks Sync twice
  if (window.__savedInSyncing) {
    console.warn('[SavedIn] Sync already in progress — ignoring re-injection.');
    return;
  }
  window.__savedInSyncing = true;

  // ===========================================================================
  // SELECTOR UPDATE ZONE
  // LinkedIn frequently renames its CSS classes. When scraping breaks, update
  // the arrays below. The scraper tries each selector in order and uses the
  // first one that matches.
  // ===========================================================================

  const SELECTORS = {
    // Outer container for each saved post card.
    // As of 2026-04, the saved posts page uses an entity-result layout,
    // not the feed-shared layout used on the main feed.
    postContainer: [
      '.entity-result__content-container',
      '.feed-shared-update-v2',
      '.occludable-update',
      '[data-urn]',
    ],

    // Post body text
    postText: [
      'p.entity-result__content-summary',
      '.entity-result__content-summary',
      '.feed-shared-text',
      '.feed-shared-update-v2__description',
      '.update-components-text',
    ],

    // Author display name.
    // The visible name is in span[aria-hidden="true"] to hide the
    // "View X's profile" screen-reader duplicate inside the same link.
    authorName: [
      '.entity-result__content-actor a[href*="/in/"] span[aria-hidden="true"]',
      '.feed-shared-actor__name',
      '.update-components-actor__name',
    ],

    // Author headline / job title
    authorHeadline: [
      '.entity-result__content-actor .linked-area .t-14.t-black.t-normal',
      '.feed-shared-actor__description',
      '.update-components-actor__description',
    ],

    // Direct link to the post (href contains /feed/update/)
    postLink: [
      'a[href*="/feed/update/"]',
      'a[href*="activity"]',
    ],
  };

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function querySelector(root, selectorList) {
    for (const sel of selectorList) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function cleanText(el) {
    if (!el) return '';
    return el.innerText?.trim().replace(/\s+/g, ' ') ?? '';
  }

  // djb2 XOR hash — duplicated from utils/hash.js so this file is self-contained.
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
      hash = hash & hash;
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /** Count how many post containers are currently in the DOM. */
  function countContainers() {
    for (const sel of SELECTORS.postContainer) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) return els.length;
    }
    return 0;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Poll until the container count grows past prevCount, or until timeout.
   * Returns true if new containers appeared, false if timed out.
   */
  async function waitForNewContainers(prevCount, timeout = 2500, interval = 300) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (countContainers() > prevCount) return true;
      await sleep(interval);
    }
    return false;
  }

  /** Load IDs of posts already in storage so we never re-send them. */
  function getExistingIds() {
    return new Promise((resolve) => {
      chrome.storage.local.get('posts', (data) => {
        const posts = data.posts ?? [];
        resolve(new Set(posts.map((p) => p.id)));
      });
    });
  }

  /**
   * Scrape all post containers currently visible in the DOM,
   * skipping any whose ID is already in seenIds.
   */
  function scrapeVisible(seenIds) {
    const posts = [];
    let containers = [];

    for (const sel of SELECTORS.postContainer) {
      containers = Array.from(document.querySelectorAll(sel));
      if (containers.length > 0) break;
    }

    for (const container of containers) {
      try {
        const textEl     = querySelector(container, SELECTORS.postText);
        const authorEl   = querySelector(container, SELECTORS.authorName);
        const headlineEl = querySelector(container, SELECTORS.authorHeadline);
        const linkEl     = querySelector(container, SELECTORS.postLink);

        const postText = cleanText(textEl).replace(/[…\.]*\s*see more\s*$/i, '').trim();
        if (!postText || postText.length < 10) continue;

        const authorName = cleanText(authorEl) || 'Unknown author';
        const id         = hashString(postText.slice(0, 300) + authorName);

        if (seenIds.has(id)) continue;

        posts.push({
          id,
          postText,
          authorName,
          authorHeadline: cleanText(headlineEl) || '',
          postUrl:        linkEl?.href || window.location.href,
          savedDate:      new Date().toISOString().split('T')[0],
          syncedAt:       new Date().toISOString(),
        });
      } catch (err) {
        console.warn('[SavedIn] Error parsing post container:', err);
      }
    }

    return posts;
  }

  /**
   * Send a message to the background, awaiting confirmation so we never
   * have two storage writes racing each other.
   */
  async function safeSend(message) {
    try {
      await chrome.runtime.sendMessage(message);
    } catch (err) {
      // Popup may be closed — that's fine, background still processes it.
      console.warn('[SavedIn] sendMessage warning:', err.message);
    }
  }

  // ===========================================================================
  // Main scroll loop
  // ===========================================================================

  const SAFETY_CAP       = 500;  // max new posts per session
  const SCROLL_DELAY_MIN = 600;  // ms — minimum pause between scroll steps
  const SCROLL_DELAY_MAX = 1200; // ms — maximum pause (random between min–max)

  async function main() {
    const existingIds      = await getExistingIds();
    const seenThisSession  = new Set(existingIds);
    let   totalThisSession = 0;
    let   consecutiveEmpty = 0;
    let   cancelled        = false;

    // Listen for a cancel signal sent from the popup
    const cancelListener = (msg) => {
      if (msg.type === 'CANCEL_SYNC') cancelled = true;
    };
    chrome.runtime.onMessage.addListener(cancelListener);

    try {
      // ── Initial scrape of whatever is already visible ──────────────────────
      const initial = scrapeVisible(seenThisSession);
      if (initial.length > 0) {
        initial.forEach((p) => seenThisSession.add(p.id));
        totalThisSession += initial.length;
        await safeSend({ type: 'SYNC_POSTS_PARTIAL', posts: initial, totalThisSession });
      }

      // ── Scroll loop ────────────────────────────────────────────────────────
      while (!cancelled) {
        if (totalThisSession >= SAFETY_CAP) break;
        if (consecutiveEmpty >= 2) break;
        if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 50) break;

        const prevCount = countContainers();
        window.scrollBy(0, window.innerHeight);

        // Wait for LinkedIn to load new post cards
        const newLoaded = await waitForNewContainers(prevCount);

        // Natural-feeling random pause between scroll steps
        await sleep(SCROLL_DELAY_MIN + Math.random() * (SCROLL_DELAY_MAX - SCROLL_DELAY_MIN));

        if (!newLoaded) {
          consecutiveEmpty++;
        } else {
          consecutiveEmpty = 0;
        }

        const batch = scrapeVisible(seenThisSession);
        if (batch.length > 0) {
          batch.forEach((p) => seenThisSession.add(p.id));
          totalThisSession += batch.length;
          await safeSend({ type: 'SYNC_POSTS_PARTIAL', posts: batch, totalThisSession });
        }
      }

      // ── Final scrape at the resting position (catches the last visible batch)
      const tail = scrapeVisible(seenThisSession);
      if (tail.length > 0) {
        tail.forEach((p) => seenThisSession.add(p.id));
        totalThisSession += tail.length;
        await safeSend({ type: 'SYNC_POSTS_PARTIAL', posts: tail, totalThisSession });
      }

    } catch (err) {
      console.error('[SavedIn] Scroll sync error:', err);
    } finally {
      chrome.runtime.onMessage.removeListener(cancelListener);

      // Signal the popup that the sync is complete (even if we errored or cancelled)
      await safeSend({ type: 'SYNC_COMPLETE', totalThisSession });

      // Return the user to the top of their saved posts
      window.scrollTo({ top: 0, behavior: 'smooth' });

      window.__savedInSyncing = false;
    }
  }

  main().catch((err) => {
    console.error('[SavedIn] Fatal error in main:', err);
    chrome.runtime.sendMessage({ type: 'SYNC_COMPLETE', totalThisSession: 0 }).catch(() => {});
    window.__savedInSyncing = false;
  });

})();
