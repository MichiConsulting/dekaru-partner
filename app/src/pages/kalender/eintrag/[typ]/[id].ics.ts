// Ein einzelner Termin oder eine Wiedervorlage als .ics zum Herunterladen.
// Nur angemeldet und nur fuer eigene Kunden; fremde IDs enden mit 404.
import type { APIRoute } from 'astro';
import { erzeugeIcs, holeEintrag, icsDateiname } from '../../../../lib/kalender.ts';

export const GET: APIRoute = async ({ locals, params }) => {
  const benutzer = locals.benutzer;
  if (!benutzer) return new Response('Bitte anmelden.', { status: 401 });
  const eintrag = await holeEintrag(locals.db, benutzer.id, String(params.typ ?? ''), String(params.id ?? ''));
  if (!eintrag) return new Response('Nicht gefunden.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const ics = erzeugeIcs([eintrag], `dekaru ${eintrag.typ === 'termin' ? 'Termin' : 'Wiedervorlage'}`);
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsDateiname(eintrag)}"`,
    },
  });
};
