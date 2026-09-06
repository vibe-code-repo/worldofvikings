import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Behind a TLS reverse proxy (staging) the HMR client must talk to the public
// port, not to 5174; VITE_HMR_CLIENT_PORT=443 switches that on. Unset locally.
const hmrClientPort = process.env['VITE_HMR_CLIENT_PORT'];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    ...(hmrClientPort ? { hmr: { clientPort: Number(hmrClientPort) } } : {}),
  },
  preview: { port: 5174, strictPort: true },
});
