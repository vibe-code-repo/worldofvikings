import { defineConfig } from 'vite';

// Behind a TLS reverse proxy (staging) the HMR client must talk to the public
// port, not to 5173; VITE_HMR_CLIENT_PORT=443 switches that on. Unset locally.
const hmrClientPort = process.env['VITE_HMR_CLIENT_PORT'];

// Staging serves the *built* bundles through `vite preview` behind Nginx Proxy
// Manager, so the preview server has to accept the public host name.
// `WOV_PREVIEW_ALLOWED_HOSTS` is a comma-separated list; unset locally, where
// preview is only ever reached on localhost.
const previewAllowedHosts = (process.env['WOV_PREVIEW_ALLOWED_HOSTS'] ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

// The built bundles carry the debug bridge only when the build asked for it
// (ADR-0030). A literal, not `import.meta.env`: Rollup has to be able to fold
// `__WOV_DEBUG_BRIDGE__ && …` to `false` and drop `dev-debug.ts` from a
// default `pnpm build`.
const debugBridge = process.env['WOV_DEBUG_BRIDGE'] === '1';

export default defineConfig({
  define: { __WOV_DEBUG_BRIDGE__: JSON.stringify(debugBridge) },
  server: {
    port: 5173,
    strictPort: true,
    ...(hmrClientPort ? { hmr: { clientPort: Number(hmrClientPort) } } : {}),
  },
  preview: {
    port: 5173,
    strictPort: true,
    ...(previewAllowedHosts.length > 0 ? { allowedHosts: previewAllowedHosts } : {}),
  },
});
