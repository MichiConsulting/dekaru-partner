import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { neueDb } from './helfer.ts';
import {
  EINMAL_PASSWORT_GUELTIG_STUNDEN,
  RATE_MAX_FEHLVERSUCHE,
  beendeSitzung,
  erstelleBenutzer,
  ladeSitzung,
  login,
  setzeAktiv,
  setzePasswort,
} from '../src/lib/auth.ts';
import { erzeugeEinmalPasswort, hashPasswort, pruefeNeuesPasswort, pruefePasswort } from '../src/lib/passwort.ts';

let db: Db;
beforeAll(async () => {
  db = await neueDb();
  await erstelleBenutzer(db, { email: 'Anna@Example.test', name: 'Anna', rolle: 'vertriebler', passwort: 'richtiges-passwort' });
});
afterAll(() => db.close());

describe('Passwort', () => {
  it('hasht mit scrypt und prueft korrekt', async () => {
    const hash = await hashPasswort('mein-passwort');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await pruefePasswort('mein-passwort', hash)).toBe(true);
    expect(await pruefePasswort('mein-passwort2', hash)).toBe(false);
    expect(await pruefePasswort('x', 'kaputt')).toBe(false);
  });
  it('prueft neue Passwoerter', () => {
    expect(pruefeNeuesPasswort('kurz')).toMatch(/mindestens 12 Zeichen/);
    expect(pruefeNeuesPasswort('1234567890')).toMatch(/Kleinbuchstabe/);
    expect(pruefeNeuesPasswort('ein guter satz hier')).toMatch(/Großbuchstabe/);
    expect(pruefeNeuesPasswort('Ein guter Satz hier')).toMatch(/Zahl/);
    expect(pruefeNeuesPasswort('Ein guter Satz 7 hier')).toMatch(/Sonderzeichen/);
    expect(pruefeNeuesPasswort('Gaaaaa7!Wolke')).toMatch(/viermal/);
    expect(pruefeNeuesPasswort('Wolke!1234Haus')).toMatch(/Folge/);
    expect(pruefeNeuesPasswort('Wolke!qwerHaus7')).toMatch(/Folge/);
    expect(pruefeNeuesPasswort('MeinPasswort!7x')).toMatch(/häufiges Wort/);
    expect(pruefeNeuesPasswort('Henning!Rot73', { email: 'm.henning@example.de', name: 'Michael Henning' })).toMatch(/Namen/);
    expect(pruefeNeuesPasswort('Grüne Tasse! 7 Uhr')).toBeNull();
    expect(pruefeNeuesPasswort('Rote#Bank-39-Ost')).toBeNull();
  });
  it('erzeugt Einmal-Passwoerter in drei Bloecken', () => {
    const p = erzeugeEinmalPasswort();
    expect(p).toMatch(/^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/);
    expect(p).not.toMatch(/[0O1lI]/);
    expect(erzeugeEinmalPasswort()).not.toBe(p);
  });
});

describe('Login', () => {
  it('meldet mit richtigem Passwort an, E-Mail unabhaengig von Schreibweise', async () => {
    const e = await login(db, { email: 'ANNA@example.test', passwort: 'richtiges-passwort', ip: '10.0.0.1' });
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.benutzer.name).toBe('Anna');
    const sitzung = await ladeSitzung(db, e.sitzung.token);
    expect(sitzung?.benutzer.email).toBe('anna@example.test');
    expect(sitzung?.csrf).toBe(e.sitzung.csrf);
    await beendeSitzung(db, sitzung!.id);
    expect(await ladeSitzung(db, e.sitzung.token)).toBeNull();
  });

  it('lehnt falsches Passwort und unbekannte Adresse gleich ab', async () => {
    const a = await login(db, { email: 'anna@example.test', passwort: 'falsch', ip: '10.0.0.2' });
    const b = await login(db, { email: 'niemand@example.test', passwort: 'falsch', ip: '10.0.0.2' });
    expect(a).toEqual({ ok: false, grund: 'falsch' });
    expect(b).toEqual({ ok: false, grund: 'falsch' });
  });

  it('sperrt nach zu vielen Fehlversuchen, auch mit richtigem Passwort', async () => {
    for (let i = 0; i < RATE_MAX_FEHLVERSUCHE; i += 1) {
      await login(db, { email: 'anna@example.test', passwort: 'falsch', ip: '10.0.0.3' });
    }
    const e = await login(db, { email: 'anna@example.test', passwort: 'richtiges-passwort', ip: '10.0.0.3' });
    expect(e.ok).toBe(false);
    if (e.ok) return;
    expect(e.grund).toBe('gesperrt');
    if (e.grund === 'gesperrt') expect(e.wartenSekunden).toBeGreaterThan(0);

    // Nach Ablauf der Sperre klappt es wieder, und die Zaehler sind weg.
    const spaeter = new Date(Date.now() + 20 * 60 * 1000);
    const f = await login(db, { email: 'anna@example.test', passwort: 'richtiges-passwort', ip: '10.0.0.3' }, spaeter);
    expect(f.ok).toBe(true);
  });

  it('erlaubt genau RATE_MAX_FEHLVERSUCHE Versuche, nicht einen weniger', async () => {
    await erstelleBenutzer(db, { email: 'finn@example.test', name: 'Finn', rolle: 'vertriebler', passwort: 'finn-passwort-1' });
    // Das Vorzaehlen darf den letzten erlaubten Versuch nicht selbst schon
    // sperren: sonst kaeme jemand mit dem richtigen Passwort im fuenften
    // Versuch nicht mehr hinein, obwohl die Regel "fuenf Fehlversuche, dann
    // Sperre" lautet.
    for (let i = 0; i < RATE_MAX_FEHLVERSUCHE - 1; i += 1) {
      const e = await login(db, { email: 'finn@example.test', passwort: 'falsch', ip: '10.0.0.40' });
      expect(e).toEqual({ ok: false, grund: 'falsch' });
    }
    const letzterErlaubter = await login(db, { email: 'finn@example.test', passwort: 'finn-passwort-1', ip: '10.0.0.40' });
    expect(letzterErlaubter.ok).toBe(true);
  });

  it('meldet nach 60 Minuten ohne Aktivitaet ab, Aktivitaet verlaengert', async () => {
    await erstelleBenutzer(db, { email: 'ida@example.test', name: 'Ida', rolle: 'vertriebler', passwort: 'ida-passwort-1' });
    const start = new Date();
    const e = await login(db, { email: 'ida@example.test', passwort: 'ida-passwort-1', ip: '10.0.0.9' });
    if (!e.ok) throw new Error('Login fehlgeschlagen');
    const min = (n: number) => new Date(start.getTime() + n * 60 * 1000);
    // Aktiv nach 50 Minuten: gilt noch und wird verlaengert.
    expect(await ladeSitzung(db, e.sitzung.token, min(50))).not.toBeNull();
    // 100 Minuten nach dem Start, aber nur 50 nach der letzten Aktivitaet: gilt.
    expect(await ladeSitzung(db, e.sitzung.token, min(100))).not.toBeNull();
    // 61 Minuten Pause seit der letzten Aktivitaet: abgemeldet.
    expect(await ladeSitzung(db, e.sitzung.token, min(161))).toBeNull();
  });

  it('abgelaufene Sitzungen und deaktivierte Zugaenge gelten nicht', async () => {
    const b = await erstelleBenutzer(db, { email: 'bert@example.test', name: 'Bert', rolle: 'vertriebler', passwort: 'bert-passwort-1' });
    const e = await login(db, { email: 'bert@example.test', passwort: 'bert-passwort-1', ip: '10.0.0.4' });
    if (!e.ok) throw new Error('Login fehlgeschlagen');
    const inZwanzigTagen = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    expect(await ladeSitzung(db, e.sitzung.token, inZwanzigTagen)).toBeNull();

    const e2 = await login(db, { email: 'bert@example.test', passwort: 'bert-passwort-1', ip: '10.0.0.4' });
    if (!e2.ok) throw new Error('Login fehlgeschlagen');
    await setzeAktiv(db, b.id, false);
    expect(await ladeSitzung(db, e2.sitzung.token)).toBeNull();
    const e3 = await login(db, { email: 'bert@example.test', passwort: 'bert-passwort-1', ip: '10.0.0.4' });
    expect(e3.ok).toBe(false);
  });

  it('zaehlt Versuche atomar, auch wenn viele gleichzeitig eintreffen', async () => {
    await erstelleBenutzer(db, { email: 'carla@example.test', name: 'Carla', rolle: 'vertriebler', passwort: 'carla-passwort-1' });
    const ergebnisse = await Promise.all(
      Array.from({ length: 20 }, () => login(db, { email: 'carla@example.test', passwort: 'falsch', ip: '10.0.0.20' })),
    );
    const gesperrt = ergebnisse.filter((e) => !e.ok && e.grund === 'gesperrt').length;
    // Ohne den atomaren Upsert sehen alle 20 parallelen Anfragen den Stand vor
    // der Sperre und keine wird abgewiesen. Mit dem Fix muss die grosse
    // Mehrheit der Versuche jenseits von RATE_MAX_FEHLVERSUCHE gesperrt sein.
    expect(gesperrt).toBeGreaterThan(20 - RATE_MAX_FEHLVERSUCHE - 2);
  });

  it('lehnt ein abgelaufenes Einmal-Passwort ab, auch wenn es stimmt', async () => {
    const b = await erstelleBenutzer(db, { email: 'doro@example.test', name: 'Doro', rolle: 'vertriebler', passwort: 'irrelevant' });
    await setzePasswort(db, b.id, 'einmal-passwort-xyz', true);

    const jetzt = new Date();
    const nochGueltig = new Date(jetzt.getTime() + (EINMAL_PASSWORT_GUELTIG_STUNDEN - 1) * 60 * 60 * 1000);
    const abgelaufen = new Date(jetzt.getTime() + (EINMAL_PASSWORT_GUELTIG_STUNDEN + 1) * 60 * 60 * 1000);

    const nochOk = await login(db, { email: 'doro@example.test', passwort: 'einmal-passwort-xyz', ip: '10.0.0.30' }, nochGueltig);
    expect(nochOk.ok).toBe(true);

    const danach = await login(db, { email: 'doro@example.test', passwort: 'einmal-passwort-xyz', ip: '10.0.0.31' }, abgelaufen);
    expect(danach).toEqual({ ok: false, grund: 'falsch' });
  });

  it('ein selbst gesetztes Passwort hat keine Ablauffrist', async () => {
    const b = await erstelleBenutzer(db, { email: 'emil@example.test', name: 'Emil', rolle: 'vertriebler', passwort: 'irrelevant' });
    await setzePasswort(db, b.id, 'eigenes-passwort-xyz', false);
    const inZehnJahren = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
    const e = await login(db, { email: 'emil@example.test', passwort: 'eigenes-passwort-xyz', ip: '10.0.0.32' }, inZehnJahren);
    expect(e.ok).toBe(true);
  });
});
