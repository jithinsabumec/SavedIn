import { defineConfig, loadEnv } from 'vite';
import { resolve }                            from 'path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';

/** `VITE_WEB_APP_ORIGIN` → `https://host` (no trailing slash, no path) for popup / background / manifest. */
function normalizeWebAppOrigin(raw) {
  let s = (raw || '').trim().replace(/\/$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s).origin;
  } catch {
    return '';
  }
}

/**
 * Copies manifest.json, icons/, and the WASM files that onnxruntime-web
 * (bundled inside @xenova/transformers) needs at runtime.
 *
 * The background service worker sets:
 *   env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('/')
 * so onnxruntime looks for these files at the extension's root URL —
 * which is exactly where we put them.
 */
function copyStaticPlugin(webOriginNormalized) {
  return {
    name: 'copy-static',
    closeBundle() {
      // ── manifest (inject externally_connectable from VITE_WEB_APP_ORIGIN) ─
      const manifestPath = resolve(__dirname, 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (webOriginNormalized) {
        manifest.externally_connectable = { matches: [`${webOriginNormalized}/*`] };
      } else {
        console.warn(
          '[SavedIn] VITE_WEB_APP_ORIGIN not set — omitting externally_connectable (set it in extension/.env and rebuild for web→extension auth).',
        );
      }
      writeFileSync(resolve(__dirname, 'dist/manifest.json'), JSON.stringify(manifest, null, 2));
      mkdirSync('dist/icons', { recursive: true });
      for (const icon of ['icon16.png', 'icon48.png', 'icon128.png']) {
        copyFileSync(`icons/${icon}`, `dist/icons/${icon}`);
      }

      // ── html entry points ────────────────────────────────────────────────
      copyFileSync(resolve(__dirname, 'dist/src/popup/popup.html'), resolve(__dirname, 'dist/popup.html'));
      copyFileSync(resolve(__dirname, 'dist/src/app/app.html'), resolve(__dirname, 'dist/app.html'));

      // ── onnxruntime WASM files ───────────────────────────────────────────
      const wasmCandidates = [
        resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
        resolve(__dirname, '../node_modules/onnxruntime-web/dist'),
      ];
      const wasmSrc = wasmCandidates.find((candidate) => existsSync(candidate));
      try {
        if (!wasmSrc) throw new Error('onnxruntime-web dist directory not found');
        const wasmFiles = readdirSync(wasmSrc).filter(f => f.endsWith('.wasm'));
        for (const file of wasmFiles) {
          copyFileSync(resolve(wasmSrc, file), resolve(__dirname, 'dist', file));
        }
        console.log(`[SavedIn] Copied ${wasmFiles.length} WASM file(s) to dist/`);
      } catch (e) {
        console.warn('[SavedIn] Could not copy WASM files:', e.message);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const webOriginNormalized = normalizeWebAppOrigin(env.VITE_WEB_APP_ORIGIN);

  return {
  root:      '.',
  publicDir: false,

  define: {
    'import.meta.env.VITE_CONVEX_URL': JSON.stringify(env.VITE_CONVEX_URL ?? ''),
    'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(env.VITE_CLERK_PUBLISHABLE_KEY ?? ''),
    /** Hosted web dashboard (e.g. Cloudflare Pages `https://….pages.dev`, later your custom domain). */
    'import.meta.env.VITE_WEB_APP_ORIGIN': JSON.stringify(webOriginNormalized),
  },

  build: {
    // esnext is required for top-level await and modern JS used by
    // @xenova/transformers and onnxruntime-web.
    target:     'esnext',
    outDir:     resolve(__dirname, 'dist'),
    emptyOutDir: true,

    rollupOptions: {
      input: {
        app:        resolve(__dirname, 'src/app/app.html'),
        popup:      resolve(__dirname, 'src/popup/popup.html'),
        background: resolve(__dirname, 'src/background/background.js'),
        content:    resolve(__dirname, 'src/content/content.js'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name][extname]',
      },
    },
  },

  optimizeDeps: {
    // Exclude from Vite's pre-bundler — Rollup handles it at build time.
    // This also prevents the dev server from trying to analyse the WASM
    // imports, which can cause spurious warnings.
    exclude: ['@xenova/transformers'],
  },

  plugins: [copyStaticPlugin(webOriginNormalized)],
  };
});
