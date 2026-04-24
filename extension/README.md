# SavedIn

Search your LinkedIn saved posts locally in the browser.  
Posts live in `chrome.storage.local`; **Open SavedIn** opens your hosted web app (**`VITE_WEB_APP_ORIGIN`** in `extension/.env`, e.g. a Cloudflare `*.pages.dev` URL — not the legacy `app.html` extension page).

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

1. Build with `npm run build` and load the `dist/` folder in Chrome
2. Go to [linkedin.com/my-items/saved-posts](https://www.linkedin.com/my-items/saved-posts/)
3. Click sync in the popup
4. Set **`VITE_WEB_APP_ORIGIN`** in `extension/.env` to the same origin as your deployed web app (no trailing slash), then `npm run build` and **Reload** the extension on `chrome://extensions`
5. Click **Open SavedIn** to open that URL in a normal browser tab
6. In the **Search** tab:
   Type to search by text, or press Enter to search by meaning
7. In the **Chat** tab:
   Add your Google AI Studio API key in settings first, then ask questions about your saved posts
8. The first meaning-based search downloads about 25MB of AI model files and can take 5 to 15 seconds
9. If meaning-based search returns nothing, the background indexing may still be running, so check the sidebar status
10. Free Gemini API keys are available from [Google AI Studio](https://aistudio.google.com/)

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

- Vanilla JS · Vite · Transformers.js · Chrome Extension Manifest V3
- Vite · Transformers.js · Chrome Extension Manifest V3 · optional Convex sync via the web app
