import { defineConfig } from 'vite';

// Ports are fixed (spec §5). `strictPort` makes a port clash fail loudly
// instead of silently moving the website to another port.
export default defineConfig({
  server: { port: 5172, strictPort: true },
  preview: { port: 5172, strictPort: true },
});
