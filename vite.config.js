import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: { input: { main: fileURLToPath(new URL('./index.dev.html', import.meta.url)) } }
  },
  server: { port: 5173, open: 'index.dev.html' }
});
