import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const devPort = Number(process.env.VITE_DEV_PORT || 5173);
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '0.0.0.0', port: devPort, strictPort: true, proxy: { '/api': apiTarget } },
  preview: { host: '0.0.0.0', port: 4173, proxy: { '/api': apiTarget } },
});
