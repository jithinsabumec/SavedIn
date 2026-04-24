/**
 * Cloudflare Pages (Git) already uploads the build output directory; running
 * `wrangler pages deploy` again needs a token with Pages:Edit and can fail with
 * auth error 10000 if CLOUDFLARE_API_TOKEN is too narrow or meant for Workers only.
 * When CF_PAGES=1, skip Wrangler so `npm run deploy` is a harmless no-op.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfPages = process.env.CF_PAGES === "1" || process.env.CF_PAGES === "true";

if (cfPages && process.env.FORCE_WRANGLER_PAGES_DEPLOY !== "1") {
  console.log(
    "[SavedIn] CF_PAGES is set: skipping `wrangler pages deploy` (Pages already publishes `web/dist`). Remove the deploy command in the dashboard when you can, or set FORCE_WRANGLER_PAGES_DEPLOY=1 to run Wrangler anyway."
  );
  process.exit(0);
}

const wranglerCli = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const r = spawnSync(process.execPath, [wranglerCli, "pages", "deploy", "web/dist"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status === null ? 1 : r.status);
