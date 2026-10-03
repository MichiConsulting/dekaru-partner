import { describe, expect, it } from 'vitest';
import { entscheideZugriff, istAdmin, sichererWeiterPfad } from '../src/lib/zugriff.ts';
import type { Benutzer } from '../src/lib/auth.ts';

const vertriebler: Benutzer = {
  id: '1', email: 'v@example.test', name: 'V', rolle: 'vertriebler', vertrieblerSlug: null, passwortWechselNoetig: false, aktiv: true,
};
const admin: Benutzer = { ...vertriebler, id: '2', rolle: 'admin' };

describe('Zugriff', () => {
  it('laesst nur Login und Datenschutz ohne Anmeldung zu', () => {
    expect(entscheideZugriff('/login', null)).toEqual({ typ: 'ok' });
    expect(entscheideZugriff('/datenschutz', null)).toEqual({ typ: 'ok' });
    expect(entscheideZugriff('/', null)).toEqual({ typ: 'login' });
    expect(entscheideZugriff('/kunden', null)).toEqual({ typ: 'login' });
    expect(entscheideZugriff('/grafiken/x.svg', null)).toEqual({ typ: 'login' });
    expect(entscheideZugriff('/admin', null)).toEqual({ typ: 'login' });
  });
  it('sperrt den Admin-Bereich fuer Vertriebler', () => {
    expect(entscheideZugriff('/admin', vertriebler)).toEqual({ typ: 'verboten' });
    expect(entscheideZugriff('/admin/kunden', vertriebler)).toEqual({ typ: 'verboten' });
    expect(entscheideZugriff('/administration', vertriebler)).toEqual({ typ: 'ok' });
    expect(entscheideZugriff('/admin/kunden', admin)).toEqual({ typ: 'ok' });
  });
  it('zwingt zum Passwortwechsel', () => {
    const neu = { ...vertriebler, passwortWechselNoetig: true };
    expect(entscheideZugriff('/kunden', neu)).toEqual({ typ: 'passwort' });
    expect(entscheideZugriff('/passwort', neu)).toEqual({ typ: 'ok' });
    expect(entscheideZugriff('/logout', neu)).toEqual({ typ: 'ok' });
  });
  it('deaktivierte Zugaenge muessen sich neu anmelden', () => {
    expect(entscheideZugriff('/', { ...vertriebler, aktiv: false })).toEqual({ typ: 'login' });
  });
  it('weiter-Pfad bleibt auf der eigenen Seite', () => {
    expect(sichererWeiterPfad('/kunden?status=termin')).toBe('/kunden?status=termin');
    expect(sichererWeiterPfad('https://boese.example')).toBe('/');
    expect(sichererWeiterPfad('//boese.example')).toBe('/');
    expect(sichererWeiterPfad(null)).toBe('/');
  });
  it('lehnt einen Tab ab, der im Browser aus "/" ein "//" macht', () => {
    expect(sichererWeiterPfad('/\t/boese.example')).toBe('/');
    expect(sichererWeiterPfad('/kunden\u0000x')).toBe('/');
  });
  it('istAdmin prueft die Rolle, unabhaengig vom Pfad', () => {
    expect(istAdmin(admin)).toBe(true);
    expect(istAdmin(vertriebler)).toBe(false);
    expect(istAdmin(null)).toBe(false);
  });
});
