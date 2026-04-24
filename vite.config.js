import { defineConfig }                      from 'vite';
import { resolve }                            from 'path';
import { copyFileSync, mkdirSync, readdirSync } from 'fs';

/**
 * Copies manifest.json, icons/, and the WASM files that onnxruntime-web
 * (bundled inside @xenova/transformers) needs at runtime.
 *
 * The background service worker sets:
 *   env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('/')
 * so onnxruntime looks for these files at the extension's root URL —
 * which is exactly where we put them.
 */
function copyStaticPlugin() {
  return {
    name: 'copy-static',
    closeBundle() {
      // ── manifest + icons ────────────────────────────────────────────────
      copyFileSync('manifest.json', 'dist/manifest.json');
      mkdirSync('dist/icons', { recursive: true });
      for (const icon of ['icon16.png', 'icon48.png', 'icon128.png']) {
        copyFileSync(`icons/${icon}`, `dist/icons/${icon}`);
      }

      // ── onnxruntime WASM files ───────────────────────────────────────────
      const wasmSrc = resolve(__dirname, 'node_modules/onnxruntime-web/dist');
      try {
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

export default defineConfig({
  root:      'src/popup',
  publicDir: false,

  build: {
    // esnext is required for top-level await and modern JS used by
    // @xenova/transformers and onnxruntime-web.
    target:     'esnext',
    outDir:     resolve(__dirname, 'dist'),
    emptyOutDir: true,

    rollupOptions: {
      input: {
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

  plugins: [copyStaticPlugin()],
});
