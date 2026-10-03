import { defineConfig } from 'vite';

export default defineConfig({
  // Pure client-side game; no plugins needed.
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
