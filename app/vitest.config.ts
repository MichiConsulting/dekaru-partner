import { getViteConfig } from 'astro/config';
import { defineConfig } from 'vitest/config';

// Ueber Astros Vite-Konfiguration, damit Tests auch .astro-Komponenten
// rendern koennen (Container-API). Die Datenbank-Tests laufen unveraendert.
const test = defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Jede Testdatei bekommt ihre eigene PGlite-Instanz im Speicher.
    fileParallelism: false,
    testTimeout: 30000,
  },
});

// Astro bringt sein eigenes Vite mit, deshalb passen die beiden UserConfig-Typen
// nominell nicht zusammen. Inhaltlich sind sie gleich.
export default getViteConfig(test as Parameters<typeof getViteConfig>[0]);
