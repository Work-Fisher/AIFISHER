import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built into app/desktop/launcher and served by the main process at aifisher://app/launcher/.
export default defineConfig({
  root: path.dirname(fileURLToPath(import.meta.url)),
  base: '/launcher/',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
