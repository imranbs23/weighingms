/**
 * The Vite configuration — the SPA's build.
 *
 * The API is a **separate process on a separate port** (the tech stack's
 * service topology), and the client's base URL is a build-time variable.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/007-weighingms-ui',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
});
