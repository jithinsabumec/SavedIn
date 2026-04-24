# SavedIn Monorepo

This repository is now organized as a `pnpm` workspace so the Chrome extension, future web app, shared code, and Convex backend can live in one place.

## Structure

- `extension/` — the existing Chrome extension
- `web/` — SavedIn web dashboard (Clerk, Convex, search, chat)
- `convex/` — the shared Convex backend functions and schema
- `shared/` — shared TypeScript types and search helpers

## Install

```bash
pnpm install
```

## Run

```bash
pnpm dev:extension
pnpm build:extension
pnpm dev:web
pnpm build:web
```

## Notes

- The extension keeps a full local cache in `chrome.storage.local` and optionally pushes new posts to Convex when signed in via the web app (same Clerk user id).
- `convex/_generated/` includes minimal checked-in stubs so the repo typechecks before you run `npx convex dev` (which can refresh these files against your deployment).

## Extension + Convex testing

1. Deploy the web app (e.g. Cloudflare Pages) and note its origin (such as `https://your-project.pages.dev`). Add the same value to **`extension/.env`** as **`VITE_WEB_APP_ORIGIN`** (no trailing slash). Rebuild the extension whenever this URL changes.
2. Copy `extension/.env.example` to `extension/.env` and set `VITE_CONVEX_URL` to your Convex deployment URL (same as the web app).
3. Build the extension: `pnpm --filter extension build`.
4. Load `extension/dist/` in Chrome as an unpacked extension.
5. Copy the extension ID from `chrome://extensions` and add it to `web/.env` as `VITE_EXTENSION_ID` (required for the web app to send auth back to the extension). In Clerk, allow your deployed web origin for redirects / authorized URLs.
6. Fresh-install the extension to run the LinkedIn onboarding tab, or use **Sync** from the popup on the saved-posts page.
7. Sign in from the extension (**Sign in** opens the web app with `extension_auth=true`); after Clerk sign-in, the Convex JWT is stored in the extension.
8. Sync again on LinkedIn; new posts should appear on your deployed web app in real time.
9. Without signing in, sync still saves posts locally only.

## Cloudflare Pages (web dashboard)

**Deploy command:** Prefer **empty** so the host publishes **`web/dist`** from the build output only once.

- **`npx wrangler deploy`** is wrong (Workers, not Pages; monorepo root errors).
- If the UI requires a deploy step, use **`npm run deploy`**: it is a **no-op** (does not call Wrangler), so you avoid **auth error 10000** when `CLOUDFLARE_API_TOKEN` is not scoped for **Cloudflare Pages → Edit**. Your platform should still upload `web/dist` after a successful build.
- To **force** a Wrangler Pages upload (e.g. GitHub Actions): **`npm run deploy:wrangler`** with a token that has **Account → Cloudflare Pages → Edit** and an existing Pages project (see `wrangler.toml` `name`).

1. Create a **Pages** project connected to this Git repo (not a **Workers** build that runs `wrangler deploy`).
2. **Root directory**: repository root (leave blank). **Build output directory**: `web/dist`.
3. **Build command**: `npm run cf:pages:build` (web only; faster than `npm run build`, which also builds the extension). Cloudflare may use **Bun** for `bun install` and **npm** for the build script; that combination is fine.
4. **Deploy command**: leave **empty** (recommended). Pages publishes whatever is in **Build output directory** after the build; a deploy step is not required.
   - **`npx wrangler deploy`** is wrong here: it targets a **Worker**, not Pages. From the monorepo root it fails with *“run in the root of a workspace…”* (or a Vite version error).
   - If the UI will not let you clear the deploy field, use **`npm run deploy`** (no-op, no Wrangler). For a real Wrangler upload in CI, use **`npm run deploy:wrangler`** and a Pages-capable **`CLOUDFLARE_API_TOKEN`**.
5. Add environment variables: `VITE_CONVEX_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_EXTENSION_ID`.
6. After deploy, set `VITE_WEB_APP_ORIGIN` in `extension/.env` to your `*.pages.dev` (or custom) URL and rebuild the extension.

## Web app testing

1. Run `pnpm --filter web dev` to start the web app locally.
2. Sign in with a magic link using your email (Clerk must have the **email link** / magic-link strategy enabled for your instance).
3. Configure the Clerk **Convex** JWT template so `ConvexProviderWithClerk` can authenticate Convex queries (see [Convex + Clerk](https://docs.convex.dev/auth/clerk)).
4. If you have the extension installed and posts synced to Convex under the same Clerk user id, they will appear automatically via real-time sync.
5. To test chat, add your Gemini API key in the sidebar settings (stored only in `localStorage`, never sent to Convex).
6. To test semantic search, sync several posts, then press **Enter** after typing a query (first run downloads the embedding model, ~25MB, then caches it).
