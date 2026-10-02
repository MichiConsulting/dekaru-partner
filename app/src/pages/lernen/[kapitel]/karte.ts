// Merkt sich per POST, welche Lernkarte gerade gezeigt wird. Wird vom
// Skript der Kartenseite aufgerufen; ohne JavaScript braucht es die Route
// nicht, dann setzt der Start der Abfrage das Gelesen-Kennzeichen.
import type { APIRoute } from 'astro';
import { lernkarten } from '../../../lib/inhalt.ts';
import { speichereKartenStand } from '../../../lib/lernen.ts';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const benutzer = locals.benutzer;
  if (!benutzer) return new Response(null, { status: 401 });
  const slug = String(params.kapitel ?? '');
  const karten = lernkarten(slug);
  if (!karten) return new Response(null, { status: 404 });
  let karte = 0;
  try {
    karte = Number((await request.formData()).get('karte'));
  } catch {
    karte = 0;
  }
  if (!Number.isInteger(karte) || karte < 1) return new Response(null, { status: 400 });
  await speichereKartenStand(locals.db, benutzer.id, slug, karte, karten.length);
  return new Response(null, { status: 204 });
};
