import { defineConfig } from 'vite';

// Behind a TLS reverse proxy (staging) the HMR client must talk to the public
// port, not to 5173; VITE_HMR_CLIENT_PORT=443 switches that on. Unset locally.
const hmrClientPort = process.env['VITE_HMR_CLIENT_PORT'];

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    ...(hmrClientPort ? { hmr: { clientPort: Number(hmrClientPort) } } : {}),
  },
  preview: { port: 5173, strictPort: true },
});
