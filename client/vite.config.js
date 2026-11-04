import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API and the SPA share an origin in every mode: Vite proxies both HTTP and
// the Socket.io upgrade to the Express process, and in production Express
// serves client/dist itself.
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
