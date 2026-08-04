import { cpSync, existsSync } from 'node:fs';

export default {
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: 'index.html',
        era: 'test/era.html',
      },
    },
  },
  server: { host: true, port: 5173 },
  plugins: [{
    name: 'copy-progress',
    closeBundle() {
      cpSync('progress', 'dist/progress', { recursive: true });
    }
  }]
};
