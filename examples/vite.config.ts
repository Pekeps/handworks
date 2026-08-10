import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      handworks: resolve(__dirname, '../src/index.ts'),
      'handworks/core': resolve(__dirname, '../src/core/index.ts'),
      'handworks/three': resolve(__dirname, '../src/three/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        playground: resolve(__dirname, 'playground.html'),
        fingerspell: resolve(__dirname, 'fingerspell.html'),
        shadow: resolve(__dirname, 'shadow.html'),
      },
    },
  },
});
