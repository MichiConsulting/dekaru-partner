// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import { fileURLToPath } from 'node:url';
import { rehypeGrafiken } from './src/lib/rehype-grafiken.mjs';

// Das Repo-Wurzelverzeichnis, dort liegt inhalt/ neben app/.
const repoWurzel = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  site: 'https://partner.dekaru.de',
  output: 'server',
  adapter: vercel(),
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
