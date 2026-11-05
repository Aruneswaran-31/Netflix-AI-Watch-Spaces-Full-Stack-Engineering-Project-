import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API and the SPA share an origin in every mode: Vite proxies both HTTP and
// the Socket.io upgrade to the Express process, and in production Express
// serves client/dist itself.
//
// The API port is read from the root .env — the same file the server reads — so
// one PORT setting keeps the proxy pointed at the API. Without this, a machine
// where 4000 is already taken proxies the whole app to an unrelated process and
// every request (login, video, sockets) fails with someone else's 404.
function rootEnvPort() {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
  if (!fs.existsSync(envPath)) return null;
  const match = /^PORT\s*=\s*(\d+)\s*$/m.exec(fs.readFileSync(envPath, 'utf8'));
  return match ? Number(match[1]) : null;
}

const apiTarget =
  process.env.VITE_API_TARGET || `http://localhost:${rootEnvPort() || Number(process.env.PORT) || 4000}`;

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
