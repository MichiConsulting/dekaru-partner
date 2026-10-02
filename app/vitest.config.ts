import { getViteConfig } from 'astro/config';

// Ueber Astros Vite-Konfiguration, damit Tests auch .astro-Komponenten
// rendern koennen (Container-API). Die Datenbank-Tests laufen unveraendert.
export default getViteConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Jede Testdatei bekommt ihre eigene PGlite-Instanz im Speicher.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
