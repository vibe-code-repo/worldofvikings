import { defineConfig } from 'vite';

// Ports are fixed (spec §5). `strictPort` makes a port clash fail loudly
// instead of silently moving the website to another port.
// Behind a TLS reverse proxy (staging) the HMR client must talk to the public
// port, not to 5172; VITE_HMR_CLIENT_PORT=443 switches that on. Unset locally.
const hmrClientPort = process.env['VITE_HMR_CLIENT_PORT'];

export default defineConfig({
  server: {
    port: 5172,
    strictPort: true,
    ...(hmrClientPort ? { hmr: { clientPort: Number(hmrClientPort) } } : {}),
  },
  preview: { port: 5172, strictPort: true },
});
