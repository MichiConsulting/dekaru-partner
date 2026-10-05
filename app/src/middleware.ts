// Laeuft vor jeder Anfrage: Sitzung laden, Zugriff pruefen, CSRF pruefen,
// Sicherheits-Header setzen.

import { defineMiddleware } from 'astro:middleware';
import { getDb } from './lib/db.ts';
import { COOKIE_NAME, ladeSitzung } from './lib/auth.ts';
import { entscheideZugriff, istIsrAnfrage, istOeffentlichesSchema, istTokenPfad } from './lib/zugriff.ts';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

// Methoden, die keine Formulardaten tragen und darum keinen CSRF-Schutz
// brauchen. Alles andere kann Daten aendern und braucht das Sitzungs-Token.
const SICHERE_METHODEN = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Setzt dieselben Sicherheits-Header auf jede Antwort, auch auf fruehe Abweisungen. */
function sicherheitsHeader(antwort: Response, pathname: string): Response {
  const kopf = antwort.headers;
  kopf.set('X-Content-Type-Options', 'nosniff');
  kopf.set('X-Frame-Options', 'DENY');
  kopf.set('Referrer-Policy', 'same-origin');
  kopf.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Das ganze Portal gehoert in keine Suchmaschine, auch die oeffentliche
  // Seite /schema nicht. Zusaetzlich zum Meta-Tag, damit es auch fuer
  // Antworten ohne HTML gilt.
  kopf.set('X-Robots-Tag', 'noindex, nofollow');
  if (import.meta.env.PROD) {
    kopf.set('Content-Security-Policy', CSP);
    // Nur in Produktion, wo immer HTTPS gilt. Zwei Jahre, inklusive Subdomains.
    kopf.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  if (!pathname.startsWith('/_astro/')) kopf.set('Cache-Control', 'private, no-store');
  return antwort;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Siehe istIsrAnfrage: dieses Portal hat keine ISR-Seite, so eine Anfrage
  // ist hier immer unerwartet. Abgewiesen, bevor ueberhaupt die Datenbank
  // angefasst wird.
  if (istIsrAnfrage(context.request)) {
    return sicherheitsHeader(new Response('Ungueltige Anfrage.', { status: 400 }), pathname);
  }

  // Oeffentliche Fassung des Schemas: keine Datenbank, keine Sitzung, kein
  // Cookie. Ein mitgeschicktes Sitzungs-Cookie wird gar nicht erst gelesen,
  // die Seite rendert fuer alle gleich. Nur lesen, sonst nichts.
  if (istOeffentlichesSchema(pathname)) {
    if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
      return sicherheitsHeader(new Response('Nicht erlaubt.', { status: 405, headers: { Allow: 'GET, HEAD' } }), pathname);
    }
    context.locals.benutzer = null;
    context.locals.csrf = null;
    context.locals.sitzungId = null;
    return sicherheitsHeader(await next(), pathname);
  }

  const db = await getDb();
  context.locals.db = db;

  const token = context.cookies.get(COOKIE_NAME)?.value ?? '';
  const sitzung = token ? await ladeSitzung(db, token) : null;
  context.locals.benutzer = sitzung?.benutzer ?? null;
  context.locals.csrf = sitzung?.csrf ?? null;
  context.locals.sitzungId = sitzung?.id ?? null;

  const entscheidung = entscheideZugriff(pathname, context.locals.benutzer);
  if (entscheidung.typ === 'login') {
    if (context.request.method !== 'GET') return sicherheitsHeader(new Response('Bitte anmelden.', { status: 401 }), pathname);
    const weiter = pathname === '/' ? '' : `?weiter=${encodeURIComponent(pathname + context.url.search)}`;
    return sicherheitsHeader(context.redirect(`/login${weiter}`, 303), pathname);
  }
  if (entscheidung.typ === 'passwort') return sicherheitsHeader(context.redirect('/passwort', 303), pathname);
  if (entscheidung.typ === 'verboten') {
    return sicherheitsHeader(await next('/verboten'), pathname);
  }

  // CSRF: jedes Formular einer angemeldeten Person traegt das Sitzungs-Token.
  // Der Login selbst hat noch keine Sitzung, dort schuetzt Astros Origin-Pruefung.
  // Geprueft wird jede Methode, die Daten aendern kann, nicht nur POST, damit
  // eine spaeter hinzugefuegte PUT- oder DELETE-Route nicht ungeschuetzt bleibt.
  // Token-Endpunkte (istTokenPfad) lesen kein Formular und schuetzen sich selbst.
  if (!SICHERE_METHODEN.has(context.request.method) && sitzung && !istTokenPfad(pathname)) {
    let feld: unknown = null;
    try {
      const form = await context.request.clone().formData();
      feld = form.get('_csrf');
    } catch {
      feld = null;
    }
    if (typeof feld !== 'string' || feld !== sitzung.csrf) {
      return sicherheitsHeader(
        new Response('Das Formular ist abgelaufen. Bitte die Seite neu laden und noch einmal absenden.', {
          status: 403,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
        pathname,
      );
    }
  }

  const antwort = await next();
  return sicherheitsHeader(antwort, pathname);
});
