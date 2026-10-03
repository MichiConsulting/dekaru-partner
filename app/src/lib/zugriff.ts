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
const OEFFENTLICHE_PRAEFIXE = ['/_astro/', '/favicon'];

export function istOeffentlich(pfad: string): boolean {
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
