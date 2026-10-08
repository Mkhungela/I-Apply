import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The production/preview build is served by the API server itself (single port),
 * which avoids host-header issues behind proxies. In development, Vite serves the
 * UI and proxies /api to the server.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow the sandbox preview host and any proxied host name.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN || 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
