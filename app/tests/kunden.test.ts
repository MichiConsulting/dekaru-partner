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
  pruefeTermin,
  setzeTermin,
  uhrzeit,
  dauerText,
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
    expect(pruefeKunde({ name: 'X', status: 'termin' }).fehler).toContain('Zu einem Termin gehört ein Datum.');
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

describe('Termine mit Uhrzeit und Dauer', () => {
  it('liest Uhrzeiten aus Formular und Datenbank als HH:MM', () => {
    expect(uhrzeit('14:30')).toBe('14:30');
    expect(uhrzeit('09:05:00')).toBe('09:05');
    expect(uhrzeit('23:59:59.5')).toBe('23:59');
    expect(uhrzeit('24:00')).toBeNull();
    expect(uhrzeit('9:5')).toBeNull();
    expect(uhrzeit('')).toBeNull();
    expect(uhrzeit(null)).toBeNull();
    expect(dauerText(45)).toBe('45 Min.');
    expect(dauerText(60)).toBe('1 Std.');
    expect(dauerText(90)).toBe('1 Std. 30 Min.');
  });

  it('setzt ohne Angabe 60 Minuten und laesst ohne Uhrzeit den Termin ganztaegig', () => {
    const mit = pruefeKunde({ name: 'X', status: 'termin', terminDatum: '2026-10-07', terminBeginn: '14:30' });
    expect(mit.fehler).toEqual([]);
    expect(mit.wert.terminBeginn).toBe('14:30');
    expect(mit.wert.terminDauer).toBe(60);

    const ohne = pruefeKunde({ name: 'X', status: 'termin', terminDatum: '2026-10-07', terminBeginn: '', terminDauer: '90' });
    expect(ohne.fehler).toEqual([]);
    expect(ohne.wert.terminBeginn).toBeNull();
    // Das Auswahlfeld schickt immer eine Dauer mit, ohne Uhrzeit faellt sie weg.
    expect(ohne.wert.terminDauer).toBeNull();
  });

  it('lehnt falsche Uhrzeiten, Dauern und eine Uhrzeit ohne Datum ab', () => {
    expect(pruefeKunde({ name: 'X', status: 'angerufen', terminDatum: '2026-10-07', terminBeginn: '25:00' }).fehler.some((f) => /Uhrzeit/.test(f))).toBe(true);
    expect(pruefeKunde({ name: 'X', status: 'angerufen', terminBeginn: '10:00' }).fehler).toContain('Zu einer Uhrzeit gehört ein Datum.');
    for (const d of ['0', '4', '721', 'abc', '-30', '1.5']) {
      expect(pruefeKunde({ name: 'X', status: 'termin', terminDatum: '2026-10-07', terminBeginn: '10:00', terminDauer: d }).fehler.some((f) => /Dauer/.test(f))).toBe(true);
    }
    const ok = pruefeKunde({ name: 'X', status: 'termin', terminDatum: '2026-10-07', terminBeginn: '10:00', terminDauer: '720' });
    expect(ok.fehler).toEqual([]);
    expect(ok.wert.terminDauer).toBe(720);
  });

  it('speichert Uhrzeit und Dauer und entfernt beide mit dem Datum', async () => {
    const k = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Zeit GmbH', status: 'termin', terminDatum: '2026-10-07', terminBeginn: '09:15', terminDauer: '45' }).wert);
    expect(k.terminBeginn).toBe('09:15');
    expect(k.terminDauer).toBe(45);
    const gelesen = await holeKunde(db, anna.id, k.id);
    expect(gelesen?.terminBeginn).toBe('09:15');
    expect(gelesen?.terminDauer).toBe(45);
    expect((await alleKunden(db)).find((x) => x.id === k.id)?.terminBeginn).toBe('09:15');

    // Status auf Angebot, Datum geleert: Uhrzeit und Dauer fallen mit weg,
    // sonst wuerde die Datenbank das Speichern ablehnen.
    const ohne = await aendereKunde(db, anna.id, k.id, pruefeKunde({ name: 'Zeit GmbH', status: 'angebot', terminDatum: '', terminBeginn: '09:15', terminDauer: '45' }).wert);
    // Die Pruefung meldet die Uhrzeit ohne Datum, gespeichert wird trotzdem nur ohne.
    expect(ohne?.terminDatum).toBeNull();
    expect(ohne?.terminBeginn).toBeNull();
    expect(ohne?.terminDauer).toBeNull();
  });

  it('setzt einen Termin aus dem Kalender nur bei eigenen Betrieben', async () => {
    const k = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Kalender KG', status: 'angerufen' }).wert);
    const geprueft = pruefeTermin({ kundeId: k.id, status: 'termin', terminDatum: '2026-10-08', terminBeginn: '11:00', terminDauer: '30' });
    expect(geprueft.fehler).toEqual([]);
    expect(await setzeTermin(db, bert.id, geprueft.wert)).toBeNull();
    const neu = await setzeTermin(db, anna.id, geprueft.wert, '2026-10-05');
    expect(neu?.status).toBe('termin');
    expect(neu?.statusSeit).toBe('2026-10-05');
    expect(neu?.terminDatum).toBe('2026-10-08');
    expect(neu?.terminBeginn).toBe('11:00');
    expect(neu?.terminDauer).toBe(30);

    // Ganztaegig ersetzen, Status bleibt, status_seit bleibt.
    const ganz = await setzeTermin(db, anna.id, pruefeTermin({ kundeId: k.id, status: 'termin', terminDatum: '2026-10-09', terminDauer: '60' }).wert, '2026-10-06');
    expect(ganz?.terminDatum).toBe('2026-10-09');
    expect(ganz?.terminBeginn).toBeNull();
    expect(ganz?.terminDauer).toBeNull();
    expect(ganz?.statusSeit).toBe('2026-10-05');
  });

  it('setzt den Status automatisch: aus Angerufen wird Termin, alles andere bleibt', async () => {
    const neu = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Auto A', status: 'angerufen' }).wert);
    const weiter = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Auto B', status: 'zweittermin', terminDatum: '2026-10-01' }).wert, '2026-09-20');
    const a = await setzeTermin(db, anna.id, pruefeTermin({ kundeId: neu.id, status: '', terminDatum: '2026-10-12' }).wert, '2026-10-05');
    const b = await setzeTermin(db, anna.id, pruefeTermin({ kundeId: weiter.id, status: '', terminDatum: '2026-10-13' }).wert, '2026-10-05');
    expect([a?.status, a?.statusSeit]).toEqual(['termin', '2026-10-05']);
    expect([b?.status, b?.statusSeit]).toEqual(['zweittermin', '2026-09-20']);
  });

  it('prueft das Termin-Formular', () => {
    expect(pruefeTermin({ status: 'termin', terminDatum: '2026-10-08' }).fehler).toContain('Bitte einen Betrieb auswählen.');
    expect(pruefeTermin({ kundeId: '11111111-2222-4333-8444-555555555555', status: 'termin', terminDatum: '2026-02-30' }).fehler).toContain('Das Datum fehlt oder ist ungültig.');
    expect(pruefeTermin({ kundeId: '11111111-2222-4333-8444-555555555555', status: 'quatsch', terminDatum: '2026-02-03' }).fehler).toContain('Der Status ist unbekannt.');
  });
});
