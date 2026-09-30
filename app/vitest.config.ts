import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Jede Testdatei bekommt ihre eigene PGlite-Instanz im Speicher.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
