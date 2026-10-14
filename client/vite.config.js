import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = fileURLToPath(new URL('.', import.meta.url));

// `npm run dev:web` serves the dashboard on :5173 and forwards API and banner requests
// to the Node app on :3000 (start it with `npm run dev` in another terminal).
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/banners': 'http://localhost:3000',
    },
  },
});
