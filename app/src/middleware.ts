// Laeuft vor jeder Anfrage: Sitzung laden, Zugriff pruefen, CSRF pruefen,
// Sicherheits-Header setzen.

import { defineMiddleware } from 'astro:middleware';
import { getDb } from './lib/db.ts';
import { COOKIE_NAME, ladeSitzung } from './lib/auth.ts';
import { entscheideZugriff } from './lib/zugriff.ts';

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

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  const db = await getDb();
  context.locals.db = db;

  const token = context.cookies.get(COOKIE_NAME)?.value ?? '';
  const sitzung = token ? await ladeSitzung(db, token) : null;
  context.locals.benutzer = sitzung?.benutzer ?? null;
  context.locals.csrf = sitzung?.csrf ?? null;
  context.locals.sitzungId = sitzung?.id ?? null;

  const entscheidung = entscheideZugriff(pathname, context.locals.benutzer);
  if (entscheidung.typ === 'login') {
    if (context.request.method !== 'GET') return new Response('Bitte anmelden.', { status: 401 });
    const weiter = pathname === '/' ? '' : `?weiter=${encodeURIComponent(pathname + context.url.search)}`;
    return context.redirect(`/login${weiter}`, 303);
  }
  if (entscheidung.typ === 'passwort') return context.redirect('/passwort', 303);
  if (entscheidung.typ === 'verboten') {
    return next('/verboten');
  }

  // CSRF: jedes Formular einer angemeldeten Person traegt das Sitzungs-Token.
  // Der Login selbst hat noch keine Sitzung, dort schuetzt Astros Origin-Pruefung.
  if (context.request.method === 'POST' && sitzung) {
    let feld: unknown = null;
    try {
      const form = await context.request.clone().formData();
      feld = form.get('_csrf');
    } catch {
      feld = null;
    }
    if (typeof feld !== 'string' || feld !== sitzung.csrf) {
      return new Response('Das Formular ist abgelaufen. Bitte die Seite neu laden und noch einmal absenden.', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }

  const antwort = await next();
  const kopf = antwort.headers;
  kopf.set('X-Content-Type-Options', 'nosniff');
  kopf.set('X-Frame-Options', 'DENY');
  kopf.set('Referrer-Policy', 'same-origin');
  kopf.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (import.meta.env.PROD) kopf.set('Content-Security-Policy', CSP);
  if (!pathname.startsWith('/_astro/')) kopf.set('Cache-Control', 'private, no-store');
  return antwort;
});
