// Wer darf welchen Pfad sehen. Reine Funktion, damit sie sich testen laesst.

import type { Benutzer } from './auth.ts';

export type Entscheidung =
  | { typ: 'ok' }
  | { typ: 'login' }
  | { typ: 'verboten' }
  | { typ: 'passwort' };

const OEFFENTLICH = ['/login', '/datenschutz'];
const OEFFENTLICHE_PRAEFIXE = ['/_astro/', '/_image', '/favicon'];

export function istOeffentlich(pfad: string): boolean {
  if (OEFFENTLICH.includes(pfad)) return true;
  return OEFFENTLICHE_PRAEFIXE.some((p) => pfad.startsWith(p));
}

export function entscheideZugriff(pfad: string, benutzer: Benutzer | null): Entscheidung {
  if (istOeffentlich(pfad)) return { typ: 'ok' };
  if (!benutzer || !benutzer.aktiv) return { typ: 'login' };
  if (benutzer.passwortWechselNoetig && pfad !== '/passwort' && pfad !== '/logout') return { typ: 'passwort' };
  if ((pfad === '/admin' || pfad.startsWith('/admin/')) && benutzer.rolle !== 'admin') return { typ: 'verboten' };
  return { typ: 'ok' };
}

/** Nur relative Pfade ohne Protokoll, damit "weiter" nie nach aussen fuehrt. */
export function sichererWeiterPfad(wert: string | null | undefined): string {
  const text = String(wert ?? '');
  if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\') || text.includes('\n')) return '/';
  return text;
}
