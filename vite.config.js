import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  base: process.env.VITE_BASE ?? '/dicebox/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        play: resolve(__dirname, 'src/play/index.html'),
        about: resolve(__dirname, 'src/about.html'),
        help: resolve(__dirname, 'src/help.html'),
        privacy: resolve(__dirname, 'src/privacy.html'),
        terms: resolve(__dirname, 'src/terms.html'),
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
