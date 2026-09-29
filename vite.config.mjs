import { defineConfig } from 'vite';

export default defineConfig({
  build: { emptyOutDir: false },
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
