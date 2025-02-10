import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
    globals: true,
    coverage: {
      all: true,
      provider: 'istanbul',
      src: ['./src'],
      exclude: [
        'coverage/**',
        'dist/**',
        'node_modules/**'
      ]
    },
    typecheck: {
      checker: 'tsc',
    },
  },
});
