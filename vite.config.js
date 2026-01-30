import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'public',
  base: process.env.VITE_BASE ?? '/dicebox/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Multi-page app: include all HTML entry points
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'public/index.html'),
        play: resolve(__dirname, 'public/play/index.html'),
        about: resolve(__dirname, 'public/about.html'),
        help: resolve(__dirname, 'public/help.html'),
        privacy: resolve(__dirname, 'public/privacy.html'),
        terms: resolve(__dirname, 'public/terms.html'),
      },
      output: {
        // Content-hashed filenames for cache-busting (supports "cache forever" strategy)
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
