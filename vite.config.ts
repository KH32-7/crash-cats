import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the project under /<repo>/ (set by the deploy workflow).
  base: process.env.PAGES_BASE ?? '/',
  server: {
    host: '127.0.0.1',
    port: 5288,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:5189', ws: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:5189', ws: true },
    },
  },
  build: {
    sourcemap: true,
    // rapier2d-deterministic-compat inlines its WASM as base64 (~2.8 MB) — documented tradeoff.
    chunkSizeWarningLimit: 4600,
  },
});
