import { defineConfig } from 'vite';

// WeChat's in-app browser on older devices runs X5/XWeb kernels based on
// Chromium 57-86, which cannot parse ES2020+ syntax. Target ES2018 so the
// bundle parses everywhere; the size penalty is negligible.
export default defineConfig({
  build: { emptyOutDir: false, target: 'es2018' },
  server: {
    host: '0.0.0.0',
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: process.env.PORT ? Number(process.env.PORT) : 4173,
    strictPort: false,
    allowedHosts: true
  }
});
