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

1. Build with `npm run build` and load the `dist/` folder in Chrome
2. Go to [linkedin.com/my-items/saved-posts](https://www.linkedin.com/my-items/saved-posts/)
3. Click sync in the popup
4. Click **Open SavedIn** to open the full app
5. In the **Search** tab:
   Type to search by text, or press Enter to search by meaning
6. In the **Chat** tab:
   Add your Google AI Studio API key in settings first, then ask questions about your saved posts
7. The first meaning-based search downloads about 25MB of AI model files and can take 5 to 15 seconds
8. If meaning-based search returns nothing, the background indexing may still be running, so check the sidebar status
9. Free Gemini API keys are available from [Google AI Studio](https://aistudio.google.com/)

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
- No server or hosted web app — everything runs inside the extension
