# SavedIn

Search your LinkedIn saved posts locally in the browser.  
No server. No tracking. Everything stays in `chrome.storage.local`.

---

## Build & Install

```bash
npm install
npm run build
```

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (toggle, top-right)
3. Click **Load unpacked** and select the `dist/` folder
4. The SavedIn icon appears in your toolbar

---

## Usage

1. Go to [linkedin.com/my-items/saved-posts](https://www.linkedin.com/my-items/saved-posts/)
2. Scroll down to load the posts you want to index
3. Click the SavedIn toolbar icon → click the **sync button** (↻ top-right)
4. After sync, search by keyword or author name

Syncing is additive — run it again after scrolling further to pick up more posts.  
Duplicates are automatically skipped.

---

## Updating broken LinkedIn selectors

LinkedIn renames its CSS classes regularly. When scraping stops working:

1. Open `src/content/content.js`
2. Find the **`SELECTOR UPDATE ZONE`** comment near the top
3. Update the arrays in `SELECTORS` to match the current DOM
4. Run `npm run build` and reload the extension

---

## Tech stack

- Vanilla JS · Vite · Fuse.js · Chrome Extension Manifest V3
- No React, no backend, no external requests at runtime
