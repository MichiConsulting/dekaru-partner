// POST /api/provision-import: Import einer Provisionsabrechnung per Token,
// fuer provision.mjs --senden in dekaru-rechnungen. Kein Login, keine
// Sitzung, Schutz ueber das Bearer-Token. Logik in lib/provision-import.ts.
import type { APIRoute } from 'astro';
import { clientIp } from '../../lib/http.ts';
import { bearbeiteImportAnfrage } from '../../lib/provision-import.ts';

export const POST: APIRoute = async (astro) =>
  bearbeiteImportAnfrage({
    request: astro.request,
    db: astro.locals.db,
    ip: clientIp(astro),
    // Fester Link auf das Portal, nie der Host der Anfrage (Preview-URLs).
    portalUrl: import.meta.env.SITE ?? 'https://partner.dekaru.de',
  });

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, fehler: 'Nur POST.' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'POST' },
  });
