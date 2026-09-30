// Liefert die Grafiken der Kapitel aus, hinter dem Login wie alles andere.
import type { APIRoute } from 'astro';
import { grafik } from '../../lib/inhalt.ts';

export const GET: APIRoute = ({ params }) => {
  const datei = String(params.datei ?? '');
  const inhalt = /^[a-z0-9._-]+\.svg$/i.test(datei) ? grafik(datei) : null;
  if (!inhalt) return new Response('Nicht gefunden', { status: 404 });
  return new Response(inhalt, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Cache-Control': 'private, max-age=3600',
    },
  });
};
