import { defineConfig } from 'vite';

export default defineConfig({
  root: 'public',
  base: process.env.VITE_BASE ?? '/dicebox/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
