import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { neueDb, vertriebler } from './helfer.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { erstelleKunde, pruefeKunde } from '../src/lib/kunden.ts';
import { setzeWiedervorlage } from '../src/lib/wiedervorlage.ts';
import { cockpitZahlen, cockpitZahlenAdmin, provisionImQuartal } from '../src/lib/cockpit.ts';

let db: Db;
let anna: Benutzer;
let bert: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna', 'anna');
  bert = await vertriebler(db, 'Bert', 'bert');
});
afterAll(() => db.close());

const HEUTE = '2026-10-07'; // Mittwoch, Woche 05.10. bis 11.10.

describe('Provision im Quartal', () => {
  const abrechnungen = [
    { monat: '2026-07', summeCent: 10000, auszahlungCent: 10000, aufgelaufenCent: 500, ausgezahltAm: '2026-08-05' },
    { monat: '2026-09', summeCent: 20000, auszahlungCent: 20000, aufgelaufenCent: 1000, ausgezahltAm: '2026-10-05' },
    { monat: '2026-10', summeCent: 30000, auszahlungCent: 30000, aufgelaufenCent: 1500, ausgezahltAm: '2026-11-05' },
    { monat: '2026-11', summeCent: 40000, auszahlungCent: 40000, aufgelaufenCent: 2000, ausgezahltAm: null },
  ];
  it('zaehlt nur Abrechnungsmonate im laufenden Quartal, aufgelaufen vom neuesten Stand', () => {
    const q = provisionImQuartal(abrechnungen, '2026-11-15');
    expect(q).toMatchObject({ von: '2026-10', bis: '2026-12', nummer: 4, jahr: 2026, entstandenCent: 70000, ausgezahltCent: 30000, aufgelaufenCent: 2000, abrechnungen: 2 });
    const q3 = provisionImQuartal(abrechnungen, '2026-08-01');
    expect(q3).toMatchObject({ nummer: 3, entstandenCent: 30000, ausgezahltCent: 30000, aufgelaufenCent: 2000 });
    expect(provisionImQuartal([], HEUTE)).toMatchObject({ entstandenCent: 0, ausgezahltCent: 0, aufgelaufenCent: 0, abrechnungen: 0 });
  });
  it('summiert aufgelaufen beim Admin je Vertriebler einmal', () => {
    const alle = [
      { ...abrechnungen[2], vertriebler: 'anna' },
      { ...abrechnungen[3], vertriebler: 'anna' },
      { monat: '2026-10', summeCent: 5000, auszahlungCent: 5000, aufgelaufenCent: 700, ausgezahltAm: null, vertriebler: 'bert' },
    ];
    const q = provisionImQuartal(alle, '2026-10-07');
    expect(q.entstandenCent).toBe(75000);
    expect(q.ausgezahltCent).toBe(30000);
    expect(q.aufgelaufenCent).toBe(2700);
  });
});

describe('Cockpit-Zahlen', () => {
  it('zaehlt je Vertriebler Termine der Woche, faellige Wiedervorlagen und Abschluesse im Monat', async () => {
    await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Termin Mo', status: 'termin', terminDatum: '2026-10-05' }).wert);
    await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Termin So', status: 'termin', terminDatum: '2026-10-11' }).wert);
    await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Termin naechste Woche', status: 'termin', terminDatum: '2026-10-12' }).wert);
    await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Termin letzte Woche', status: 'termin', terminDatum: '2026-10-04' }).wert);
    await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Abschluss', status: 'abschluss' }).wert, '2026-10-02');
    await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Abschluss alt', status: 'abschluss' }).wert, '2026-09-30');
    const wv1 = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'WV gestern', status: 'angebot' }).wert);
    await setzeWiedervorlage(db, anna.id, wv1.id, { datum: '2026-10-06', grund: '' });
    const wv2 = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'WV heute', status: 'angebot' }).wert);
    await setzeWiedervorlage(db, anna.id, wv2.id, { datum: '2026-10-07', grund: '' });
    const wv3 = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'WV spaeter', status: 'angebot' }).wert);
    await setzeWiedervorlage(db, anna.id, wv3.id, { datum: '2026-10-20', grund: '' });

    await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Bert Termin', status: 'termin', terminDatum: '2026-10-08' }).wert);
    await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Bert Abschluss', status: 'abschluss' }).wert, '2026-10-01');

    const z = await cockpitZahlen(db, anna.id, HEUTE);
    expect(z.woche).toEqual({ von: '2026-10-05', bis: '2026-10-11' });
    expect(z.termineWoche.map((t) => t.kundeName)).toEqual(['Termin Mo', 'Termin So']);
    expect(z.naechsteTermine.map((t) => t.kundeName)).toEqual(['Termin So', 'Termin naechste Woche']);
    expect(z.wiedervorlagen.length).toBe(3);
    expect(z.faellig).toBe(2);
    expect(z.ueberfaellig).toBe(1);
    expect(z.abschluesseMonat).toBe(1);

    const b = await cockpitZahlen(db, bert.id, HEUTE);
    expect(b.termineWoche.map((t) => t.kundeName)).toEqual(['Bert Termin']);
    expect(b.faellig).toBe(0);
    expect(b.abschluesseMonat).toBe(1);
  });

  it('liefert dem Admin die Gesamtzahlen', async () => {
    const a = await cockpitZahlenAdmin(db, HEUTE);
    expect(a.termineWoche).toBe(3);
    expect(a.wiedervorlagenOffen).toBe(3);
    expect(a.wiedervorlagenFaellig).toBe(2);
    expect(a.abschluesseMonat).toBe(2);
    expect(a.aktiveVertriebler).toBe(2);
  });
});
