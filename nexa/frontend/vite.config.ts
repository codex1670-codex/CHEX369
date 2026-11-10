import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Lets legacy `.js` / `.jsx` import specifiers (and vi.mock paths) resolve to the
 * migrated `.ts` / `.tsx` file. This is what allows the codebase to move to TypeScript
 * file by file without touching every importer.
 */
function tsExtensionFallback(): Plugin {
  return {
    name: 'nexa:ts-extension-fallback',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || !/^(\.|\/)/.test(source) || !/\.jsx?$/.test(source)) return null;
      const base = path.resolve(path.dirname(importer.replace(/\?.*$/, '')), source);
      if (fs.existsSync(base)) return null;
      for (const ext of source.endsWith('.jsx') ? ['.tsx'] : ['.ts', '.tsx']) {
        const candidate = base.replace(/\.jsx?$/, ext);
        if (fs.existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [tsExtensionFallback(), react()],
  build: {
    rollupOptions: {
      output: {
        // Heavy, rarely-needed libraries get their own cached chunks.
        manualChunks: { three: ['three'], motion: ['framer-motion'] },
      },
    },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./test/setup.js'] },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/uploads': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
