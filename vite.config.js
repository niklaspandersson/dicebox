import { defineConfig } from 'vite';

export default defineConfig({
  root: 'public',
  base: '/dicebox/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
