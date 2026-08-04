import { cpSync } from 'node:fs';

export default {
  build: { target: 'esnext' },
  server: { host: true, port: 5173 },
  plugins: [{
    name: 'copy-progress',
    closeBundle() {
      cpSync('progress', 'dist/progress', { recursive: true });
    }
  }]
};
