// Wer darf welchen Pfad sehen. Reine Funktion, damit sie sich testen laesst.

import type { Benutzer } from './auth.ts';

export type Entscheidung =
  | { typ: 'ok' }
  | { typ: 'login' }
  | { typ: 'verboten' }
  | { typ: 'passwort' };

const OEFFENTLICH = ['/login', '/datenschutz'];
// "/_image" steht bewusst nicht hier: das Portal nutzt astro:assets nicht,
// die Route gaebe es ohne Login unnoetig frei.
// "/kalender/abo/" ist der Abo-Endpunkt fuer Kalender-Apps: ohne Login, der
// Schutz ist das persoenliche Token im Pfad (src/lib/kalender-token.ts).
const OEFFENTLICHE_PRAEFIXE = ['/_astro/', '/favicon', '/kalender/abo/'];

// Endpunkte mit eigenem Token statt Sitzung. Genau diese Pfade, kein Praefix.
// Sie brauchen weder Login noch CSRF-Feld, pruefen aber selbst ein Bearer-Token.
const TOKEN_PFADE = ['/api/provision-import'];

export function istTokenPfad(pfad: string): boolean {
  return TOKEN_PFADE.includes(pfad);
}

export function istOeffentlich(pfad: string): boolean {
  if (istTokenPfad(pfad)) return true;
  if (OEFFENTLICH.includes(pfad)) return true;
  return OEFFENTLICHE_PRAEFIXE.some((p) => pfad.startsWith(p));
}

export function istAdminPfad(pfad: string): boolean {
  return pfad === '/admin' || pfad.startsWith('/admin/');
}

export function entscheideZugriff(pfad: string, benutzer: Benutzer | null): Entscheidung {
  if (istOeffentlich(pfad)) return { typ: 'ok' };
  if (!benutzer || !benutzer.aktiv) return { typ: 'login' };
  if (benutzer.passwortWechselNoetig && pfad !== '/passwort' && pfad !== '/logout') return { typ: 'passwort' };
  if (istAdminPfad(pfad) && benutzer.rolle !== 'admin') return { typ: 'verboten' };
  return { typ: 'ok' };
}

/**
 * Zweite, von der Middleware unabhaengige Pruefung direkt auf jeder
 * Admin-Seite. Die Middleware blockt bereits ueber den Pfad, aber faellt sie
 * durch eine Besonderheit der Vercel-Auslieferung einmal aus, soll keine
 * Admin-Seite allein auf das Pfadpraefix vertrauen.
 */
export function istAdmin(benutzer: Benutzer | null): boolean {
  return benutzer?.rolle === 'admin';
}

/**
 * @astrojs/vercel liest bei "x-vercel-isr: 1" den tatsaechlichen Pfad aus
 * einem Query-Parameter, ohne den Absender zu pruefen (GHSA-x27w-589x-frm2).
 * Lokal gegen den gebauten Vercel-Adapter getestet: die eigene Middleware
 * entscheidet in diesem Portal ueber den schon ersetzten Pfad, ein Bypass
 * der Anmeldung oder der Admin-Rolle liess sich dabei nicht ausloesen. Das
 * Portal hat keine Seite mit ISR, darum gibt es fuer diesen Header hier
 * ohnehin keinen gueltigen Grund. Eine solche Anfrage ganz abzulehnen ist
 * billiger, als sich auf das Verhalten einer fremden Bibliothek zu
 * verlassen.
 */
export function istIsrAnfrage(request: Pick<Request, 'headers'>): boolean {
  return request.headers.get('x-vercel-isr') === '1';
}

/**
 * Nur relative Pfade ohne Protokoll, damit "weiter" nie nach aussen fuehrt.
 *
 * Browser entfernen Steuerzeichen wie Tab beim Parsen einer URL. Aus
 * "/\t/boese.example" wird so "//boese.example", ein Protokoll-relativer
 * Link auf eine fremde Seite. Ein Test nur auf "\n" reicht deshalb nicht,
 * es muss jedes Steuerzeichen (U+0000 bis U+001F und U+007F) abgelehnt werden.
 */
export function sichererWeiterPfad(wert: string | null | undefined): string {
  const text = String(wert ?? '');
  // eslint-disable-next-line no-control-regex
  if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\') || /[\x00-\x1f\x7f]/.test(text)) return '/';
  return text;
}
