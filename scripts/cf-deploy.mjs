/**
 * No-op deploy hook: your platform should publish `web/dist` from the configured
 * build output. Running `wrangler pages deploy` again often hits auth error 10000
 * when CLOUDFLARE_API_TOKEN is not scoped for Pages.
 *
 * For explicit Wrangler upload: `npm run deploy:wrangler` (see README).
 */
console.log(
  "[SavedIn] Deploy step skipped (no `wrangler pages deploy`). Publish `web/dist` via your host’s output directory, or run `npm run deploy:wrangler` in CI with a Pages-capable API token."
);
process.exit(0);
