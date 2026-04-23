/**
 * content.js — SavedIn Content Script
 *
 * Injected on demand via scripting.executeScript. Wrapped in an IIFE so that
 * every injection (e.g. when the user syncs twice) gets a fresh variable scope
 * in the same isolated world — prevents "Identifier already declared" errors.
 */

(function () {
  'use strict';

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

  // ===========================================================================
  // Scraper
  // ===========================================================================

  function scrapePosts() {
    const posts = [];

    let containers = [];
    for (const sel of SELECTORS.postContainer) {
      containers = Array.from(document.querySelectorAll(sel));
      if (containers.length > 0) break;
    }

    if (containers.length === 0) {
      console.warn('[SavedIn] No post containers found. LinkedIn may have changed its DOM. Check SELECTOR UPDATE ZONE in content.js.');
      return posts;
    }

    for (const container of containers) {
      try {
        const textEl     = querySelector(container, SELECTORS.postText);
        const authorEl   = querySelector(container, SELECTORS.authorName);
        const headlineEl = querySelector(container, SELECTORS.authorHeadline);
        const linkEl     = querySelector(container, SELECTORS.postLink);

        // Strip LinkedIn's "…see more" expand button text that innerText picks up
        const postText = cleanText(textEl).replace(/[…\.]*\s*see more\s*$/i, '').trim();
        if (!postText || postText.length < 10) continue;

        const authorName     = cleanText(authorEl) || 'Unknown author';
        const authorHeadline = cleanText(headlineEl) || '';
        const postUrl        = linkEl?.href || window.location.href;
        const savedDate      = new Date().toISOString().split('T')[0];
        const id             = hashString(postText.slice(0, 300) + authorName);

        posts.push({ id, postText, authorName, authorHeadline, postUrl, savedDate, syncedAt: new Date().toISOString() });
      } catch (err) {
        console.warn('[SavedIn] Error parsing a post container:', err);
      }
    }

    return posts;
  }

  // ===========================================================================
  // Entry point
  // ===========================================================================

  const posts = scrapePosts();
  chrome.runtime.sendMessage({
    type: 'SYNC_POSTS',
    posts,
    ...(posts.length === 0 ? { warning: 'No posts found on screen. Scroll down to load posts, then sync again.' } : {}),
  });

})();
