// Abo-Endpunkt fuer Kalender-Apps. Ohne Login erreichbar (zugriff.ts), der
// Schutz ist das persoenliche Token im Pfad: nur als Hash gespeichert,
// widerrufbar, und jede Adresse ist in der Zahl der Abrufe und Fehlversuche
// begrenzt. Inhalt: Termine und offene Wiedervorlagen ab 90 Tage zurueck,
// nur Betriebsname, Status und Datum.
import type { APIRoute } from 'astro';
import { pruefeAboAnfrage } from '../../../lib/kalender-token.ts';
import { eintraegeImZeitraum, erzeugeIcs } from '../../../lib/kalender.ts';
import { heuteBerlin, plusTage } from '../../../lib/datum.ts';
import { clientIp } from '../../../lib/http.ts';

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };

export const GET: APIRoute = async (context) => {
  const { locals, params } = context;
  const token = String(params.token ?? '');
  const ergebnis = await pruefeAboAnfrage(locals.db, token, clientIp(context));

  if (!ergebnis.ok && ergebnis.grund === 'gesperrt') {
    return new Response('Zu viele Anfragen. Bitte später noch einmal.', {
      status: 429,
      headers: { ...TEXT, 'Retry-After': String(ergebnis.wartenSekunden) },
    });
  }
  if (!ergebnis.ok) {
    return new Response('Nicht gefunden.', { status: 404, headers: TEXT });
  }

  const heute = heuteBerlin();
  const eintraege = await eintraegeImZeitraum(locals.db, ergebnis.benutzer.id, plusTage(heute, -90), '9999-12-31');
  const ics = erzeugeIcs(eintraege, `dekaru Termine, ${ergebnis.benutzer.name}`);
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="dekaru-termine.ics"',
      // Kalender-Apps duerfen nichts zwischenspeichern, das Token koennte
      // inzwischen widerrufen sein.
      'Cache-Control': 'private, no-store',
    },
  });
};
