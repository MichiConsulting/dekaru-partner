import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { neueDb, vertriebler } from './helfer.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import {
  aendereKunde,
  alleKunden,
  erstelleKunde,
  holeKunde,
  listeKunden,
  loescheKunde,
  monatszahlen,
  pruefeKunde,
} from '../src/lib/kunden.ts';

let db: Db;
let anna: Benutzer;
let bert: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna');
  bert = await vertriebler(db, 'Bert');
});
afterAll(() => db.close());

describe('Kunden pruefen', () => {
  it('verlangt Name, gueltigen Status und Datum bei Terminen', () => {
    expect(pruefeKunde({ name: '', status: 'angerufen' }).fehler).toContain('Der Name des Betriebs fehlt.');
    expect(pruefeKunde({ name: 'X', status: 'irgendwas' }).fehler.some((f) => /Status/.test(f))).toBe(true);
    expect(pruefeKunde({ name: 'X', status: 'termin' }).fehler).toContain('Zu einem Termin gehoert ein Datum.');
    expect(pruefeKunde({ name: 'X', status: 'termin', terminDatum: '2026-13-40' }).fehler.length).toBeGreaterThan(0);
    const ok = pruefeKunde({ name: '  Bäckerei Muster ', ort: 'Horb', status: 'termin', terminDatum: '2026-10-05', telefon: '07451 1' });
    expect(ok.fehler).toEqual([]);
    expect(ok.wert.name).toBe('Bäckerei Muster');
  });
});

describe('Kunden anlegen, aendern, sehen', () => {
  it('Vertriebler A sieht nicht die Kunden von B', async () => {
    const ka = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Anna Kunde', status: 'angerufen' }).wert);
    const kb = await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Bert Kunde', status: 'angerufen' }).wert);

    expect((await listeKunden(db, anna.id)).map((k) => k.name)).toEqual(['Anna Kunde']);
    expect((await listeKunden(db, bert.id)).map((k) => k.name)).toEqual(['Bert Kunde']);
    expect(await holeKunde(db, anna.id, kb.id)).toBeNull();
    expect(await holeKunde(db, bert.id, ka.id)).toBeNull();
    expect(await holeKunde(db, anna.id, 'keine-uuid')).toBeNull();

    // Aendern und Loeschen fremder Eintraege laufen ins Leere.
    const daten = pruefeKunde({ name: 'Gekapert', status: 'abschluss' }).wert;
    expect(await aendereKunde(db, anna.id, kb.id, daten)).toBeNull();
    expect(await loescheKunde(db, anna.id, kb.id)).toBe(false);
    expect((await holeKunde(db, bert.id, kb.id))?.name).toBe('Bert Kunde');

    // Der Admin sieht alle, mit Vertrieblername.
    const alle = await alleKunden(db);
    expect(alle.map((k) => k.vertrieblerName).sort()).toEqual(['Anna', 'Bert']);
  });

  it('setzt status_seit nur bei Statuswechsel neu', async () => {
    const k = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Wechsel', status: 'angerufen' }).wert, '2026-09-01');
    expect(k.statusSeit).toBe('2026-09-01');
    const gleich = await aendereKunde(db, anna.id, k.id, { ...k, ort: 'Nagold' }, '2026-09-10');
    expect(gleich?.statusSeit).toBe('2026-09-01');
    expect(gleich?.ort).toBe('Nagold');
    const neu = await aendereKunde(db, anna.id, k.id, { ...gleich!, status: 'abschluss' }, '2026-09-20');
    expect(neu?.statusSeit).toBe('2026-09-20');
  });

  it('filtert nach Status und Suche', async () => {
    await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Metallbau Sturm', ort: 'Nagold', status: 'termin', terminDatum: '2026-10-03' }).wert);
    expect((await listeKunden(db, anna.id, { status: 'termin' })).map((k) => k.name)).toEqual(['Metallbau Sturm']);
    expect((await listeKunden(db, anna.id, { suche: 'nagold' })).length).toBe(2);
    expect((await listeKunden(db, anna.id, { suche: '%' })).length).toBe(0);
  });

  it('zaehlt Termine und Abschluesse je Monat', async () => {
    const z = await monatszahlen(db, anna.id, '2026-10');
    expect(z.termine).toBe(1);
    const s = await monatszahlen(db, anna.id, '2026-09');
    expect(s.abschluesse).toBe(1);
    expect((await monatszahlen(db, bert.id, '2026-10')).termine).toBe(0);
  });

  it('loescht eigene Eintraege', async () => {
    const k = await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Weg damit', status: 'absage' }).wert);
    expect(await loescheKunde(db, bert.id, k.id)).toBe(true);
    expect(await holeKunde(db, bert.id, k.id)).toBeNull();
  });
});
