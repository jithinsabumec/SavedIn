import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

// Copy static assets (manifest + icons) into dist after build
function copyStaticPlugin() {
  return {
    name: 'copy-static',
    closeBundle() {
      // manifest.json → dist/manifest.json
      copyFileSync('manifest.json', 'dist/manifest.json');

      // icons/ → dist/icons/
      mkdirSync('dist/icons', { recursive: true });
      for (const icon of ['icon16.png', 'icon48.png', 'icon128.png']) {
        copyFileSync(`icons/${icon}`, `dist/icons/${icon}`);
      }
    },
  };
}

export default defineConfig({
  // Vite resolves HTML inputs relative to this root
  root: 'src/popup',
  publicDir: false,

  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // popup.html is the root-relative entry — outputs as dist/popup.html
        popup: resolve(__dirname, 'src/popup/popup.html'),
        background: resolve(__dirname, 'src/background/background.js'),
        content: resolve(__dirname, 'src/content/content.js'),
      },
      output: {
        // JS chunks land at dist/popup.js, dist/background.js, dist/content.js
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        // CSS and other assets land at dist/ root
        assetFileNames: '[name][extname]',
      },
    },
  },

  plugins: [copyStaticPlugin()],
});
