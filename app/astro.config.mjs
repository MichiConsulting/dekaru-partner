// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import node from '@astrojs/node';
import { fileURLToPath } from 'node:url';
import { rehypeGrafiken } from './src/lib/rehype-grafiken.mjs';

// Das Repo-Wurzelverzeichnis, dort liegt inhalt/ neben app/.
const repoWurzel = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  site: 'https://partner.dekaru.de',
  output: 'server',
  // ADAPTER=node baut einen eigenstaendigen Server, nur fuer die lokale
  // Lighthouse-Pruefung. Auf Vercel gilt immer der Vercel-Adapter.
  adapter: process.env.ADAPTER === 'node' ? node({ mode: 'standalone' }) : vercel(),
  // Alles laeuft ueber den Server, es gibt keine oeffentlichen Seiten mit Tracking.
  security: { checkOrigin: true },
  build: {
    // Stylesheets bleiben eigene Dateien, damit die Content-Security-Policy
    // ohne 'unsafe-inline' auskommt.
    inlineStylesheets: 'never',
  },
  markdown: {
    rehypePlugins: [rehypeGrafiken],
  },
  vite: {
    build: {
      // Auch kleine Skripte bleiben eigene Dateien. Ein Inline-Skript wuerde
      // an der Content-Security-Policy (script-src 'self') scheitern.
      assetsInlineLimit: 0,
    },
    ssr: {
      // pg bleibt ein normales Node-Paket und wird nicht gebuendelt.
      external: ['pg'],
    },
    server: {
      // inhalt/ liegt ausserhalb von app/, der Dev-Server darf es lesen.
      fs: { allow: [repoWurzel] },
    },
  },
});
