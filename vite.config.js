import { cpSync } from 'node:fs';

export default {
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: 'index.html',
        era: 'test/era.html',
        chars: 'test/chars.html',
        affine: 'test/affine.html',
        vignette: 'test/vignette.html',
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
