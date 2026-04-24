/**
 * Explicit `wrangler pages deploy web/dist` for CI (not used by default `npm run deploy`).
 * Requires CLOUDFLARE_API_TOKEN with Cloudflare Pages → Edit (and a matching Pages project).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const r = spawnSync(process.execPath, [wranglerCli, "pages", "deploy", "web/dist"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status === null ? 1 : r.status);
