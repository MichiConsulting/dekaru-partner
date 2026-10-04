// Wiedervorlage eines eigenen Kunden setzen, erledigen oder entfernen.
// Nur POST mit CSRF-Token (prueft die Middleware). Danach zurueck zur Seite,
// von der das Formular kam, sofern der Pfad im Portal bleibt.
import type { APIRoute } from 'astro';
import { entferneWiedervorlage, erledigeWiedervorlage, pruefeWiedervorlage, setzeWiedervorlage } from '../../../lib/wiedervorlage.ts';
import { formular } from '../../../lib/http.ts';
import { sichererWeiterPfad } from '../../../lib/zugriff.ts';

export const POST: APIRoute = async ({ locals, params, request, redirect }) => {
  const benutzer = locals.benutzer;
  if (!benutzer) return new Response('Bitte anmelden.', { status: 401 });
  const id = String(params.id ?? '');
  const daten = await formular(request);
  const zurueck = daten.zurueck ? sichererWeiterPfad(daten.zurueck) : `/kunden/${id}`;
  const ziel = (frage: string) => `${zurueck}${zurueck.includes('?') ? '&' : '?'}${frage}`;

  if (daten.aktion === 'erledigt') {
    const ok = await erledigeWiedervorlage(locals.db, benutzer.id, id);
    return redirect(ok ? ziel('ok=wv-erledigt') : ziel('wv=fehlt'), 303);
  }
  if (daten.aktion === 'entfernen') {
    const ok = await entferneWiedervorlage(locals.db, benutzer.id, id);
    return redirect(ok ? ziel('ok=wv-entfernt') : ziel('wv=fehlt'), 303);
  }

  const geprueft = pruefeWiedervorlage(daten);
  if (geprueft.fehler.length > 0) return redirect(ziel('wv=datum'), 303);
  const w = await setzeWiedervorlage(locals.db, benutzer.id, id, geprueft.wert);
  if (!w) return new Response('Nicht gefunden.', { status: 404 });
  return redirect(ziel('ok=wv'), 303);
};

export const GET: APIRoute = ({ params, redirect }) => redirect(`/kunden/${String(params.id ?? '')}`, 303);
