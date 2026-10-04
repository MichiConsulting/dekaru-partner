import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { erstelleBenutzer } from '../src/lib/auth.ts';
import { aendereKunde, erstelleKunde, loescheKunde, pruefeKunde } from '../src/lib/kunden.ts';
import { importiereAbrechnung, pruefeAbrechnung } from '../src/lib/provision.ts';
import {
  hinweise,
  quartalMonate,
  quoteText,
  sortiere,
  vertrieblerUebersicht,
  type UebersichtZeile,
} from '../src/lib/admin-uebersicht.ts';
import { neueDb, vertriebler } from './helfer.ts';

let db: Db;
let anna: Benutzer;
let bert: Benutzer;
const SAETZE = ['g01', 'g02', 'g03', 'g04', 'g05', 'g06'];

function abrechnung(slug: string, monat: string, summeCent: number) {
  const { abrechnung, fehler } = pruefeAbrechnung({
    format: 1,
    monat,
    vertriebler: slug,
    name: slug,
    erstellt: `${monat}-28`,
    auszahlungZum: `${monat}-28`,
    zeilen: [
      { monat, betragCent: summeCent, art: 'website', text: 'x', nummer: 'R-1', slug: 'k', kunde: 'K', grundlageCent: 100000, zahlungIso: null, leistungsmonat: null },
    ],
    vortragCent: 0,
    summeCent,
    auszahlungCent: summeCent,
    neuerVortragCent: 0,
    aufgelaufen: [],
    aufgelaufenCent: 0,
    hinweise: [],
  });
  if (!abrechnung) throw new Error(fehler.join(' '));
  return abrechnung;
}

beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna', 'anna');
  bert = await vertriebler(db, 'Bert', 'bert');
  await erstelleBenutzer(db, { email: 'chef@example.test', name: 'Chef', rolle: 'admin', passwort: 'geheim-passwort-1' });

  // Anna im Oktober: zwei Ersttermine, einer davon wird Zweittermin und
  // Abschluss, ein dritter Betrieb sagt ab.
  const k1 = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'A1', status: 'termin', terminDatum: '2026-10-05' }).wert, '2026-10-01');
  const k2 = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'A2', status: 'angerufen' }).wert, '2026-10-02');
  await aendereKunde(db, anna.id, k2.id, pruefeKunde({ name: 'A2', status: 'termin', terminDatum: '2026-10-09' }).wert, '2026-10-03');
  await aendereKunde(db, anna.id, k1.id, pruefeKunde({ name: 'A1', status: 'zweittermin', terminDatum: '2026-10-12' }).wert, '2026-10-10');
  await aendereKunde(db, anna.id, k1.id, pruefeKunde({ name: 'A1', status: 'abschluss' }).wert, '2026-10-20');
  // Gleicher Status nochmal gespeichert zaehlt nicht doppelt.
  await aendereKunde(db, anna.id, k1.id, pruefeKunde({ name: 'A1 neu', status: 'abschluss' }).wert, '2026-10-21');
  const k3 = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'A3', status: 'absage' }).wert, '2026-10-04');
  // Ein geloeschter Kunde bleibt in der Zaehlung.
  await loescheKunde(db, anna.id, k3.id);
  // Ein Septemberwert darf im Oktober nicht auftauchen.
  await erstelleKunde(db, anna.id, pruefeKunde({ name: 'A4', status: 'termin', terminDatum: '2026-09-30' }).wert, '2026-09-30');

  // Bert: ein Zweittermin ohne Abschluss im Oktober.
  await erstelleKunde(db, bert.id, pruefeKunde({ name: 'B1', status: 'zweittermin', terminDatum: '2026-10-07' }).wert, '2026-10-06');

  // Provision: Q4 2026 sind Oktober bis Dezember, September gehoert zu Q3.
  await importiereAbrechnung(db, abrechnung('anna', '2026-10', 15000), null);
  await importiereAbrechnung(db, abrechnung('anna', '2026-11', 5000), null);
  await importiereAbrechnung(db, abrechnung('anna', '2026-09', 99900), null);

  // Lernen: Anna hat zwei Kapitel, drei richtige von vier Antworten, vier Pflichtsaetze.
  await db.query("INSERT INTO kapitel_fortschritt (benutzer_id, kapitel) VALUES ($1, '01-a'), ($1, '02-b')", [anna.id]);
  await db.query(
    `INSERT INTO quiz_antworten (benutzer_id, frage_id, kapitel, richtig) VALUES
     ($1, 'f1', '01-a', true), ($1, 'f2', '01-a', true), ($1, 'f3', '02-b', true), ($1, 'f4', '02-b', false)`,
    [anna.id],
  );
  for (const [i, s] of SAETZE.entries()) {
    await db.query("INSERT INTO pflichtsatz_antworten (benutzer_id, satz_id, modus, richtig) VALUES ($1, $2, 'luecken', $3)", [
      anna.id,
      s,
      i < 4,
    ]);
  }
  // Ein Satz, der nicht mehr zu den Pflichtsaetzen gehoert, zaehlt nicht.
  await db.query("INSERT INTO pflichtsatz_antworten (benutzer_id, satz_id, modus, richtig) VALUES ($1, 'alt', 'luecken', true)", [anna.id]);
  await db.query("UPDATE benutzer SET letzter_login = '2026-10-03T10:00:00Z' WHERE id = $1", [anna.id]);
});
afterAll(() => db.close());

describe('Admin-Uebersicht: Zahlen', () => {
  it('zaehlt je Vertriebler Ersttermine, Zweittermine, Abschluesse, Absagen und Quote im Monat', async () => {
    const zeilen = await vertrieblerUebersicht(db, { monat: '2026-10', pflichtsatzIds: SAETZE, kapitelGesamt: 11, jetzt: new Date('2026-10-04T12:00:00Z') });
    expect(zeilen.map((z) => z.name)).toEqual(['Anna', 'Bert']);
    const a = zeilen[0];
    expect(a.ersttermine).toBe(2);
    expect(a.zweittermine).toBe(1);
    expect(a.abschluesse).toBe(1);
    expect(a.absagen).toBe(1);
    expect(a.quote).toBe(1);
    expect(a.provisionQuartalCent).toBe(20000);
    expect(a.kapitelErledigt).toBe(2);
    expect(a.quizRichtig).toBe(3);
    expect(a.quizBeantwortet).toBe(4);
    expect(a.pflichtsaetzeSitzen).toBe(4);
    expect(a.letzterLogin?.toISOString()).toBe('2026-10-03T10:00:00.000Z');

    const b = zeilen[1];
    expect([b.ersttermine, b.zweittermine, b.abschluesse, b.absagen]).toEqual([0, 1, 0, 0]);
    expect(b.quote).toBe(0);
    expect(b.provisionQuartalCent).toBe(0);
  });

  it('der September steht fuer sich', async () => {
    const [a] = await vertrieblerUebersicht(db, { monat: '2026-09', pflichtsatzIds: SAETZE, kapitelGesamt: 11 });
    expect([a.ersttermine, a.zweittermine, a.abschluesse, a.absagen]).toEqual([1, 0, 0, 0]);
    expect(a.quote).toBeNull();
    expect(a.provisionQuartalCent).toBe(99900);
  });

  it('lehnt einen ungueltigen Monat ab', async () => {
    await expect(vertrieblerUebersicht(db, { monat: '2026-13', pflichtsatzIds: [], kapitelGesamt: 0 })).rejects.toThrow();
  });

  it('Quartale und Quote', () => {
    expect(quartalMonate('2026-11')).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(quartalMonate('2026-01')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(quoteText(null)).toBe('keine');
    expect(quoteText(0.5)).toBe('50 %');
  });
});

describe('Admin-Uebersicht: Hinweise und Sortierung', () => {
  const jetzt = new Date('2026-10-20T12:00:00Z');
  const basis = {
    aktiv: true,
    erstellt: new Date('2026-09-01'),
    letzterLogin: new Date('2026-10-19'),
    pflichtsaetzeSitzen: 6,
    kapitelErledigt: 3,
    quizBeantwortet: 10,
    zweittermine: 0,
    abschluesse: 0,
    absagen: 0,
    ersttermine: 0,
  };
  const soll = { pflichtsaetze: 6, kapitel: 11, jetzt };

  it('meldet 14 Tage ohne Anmeldung und offene Pflichtsaetze', () => {
    expect(hinweise(basis, soll)).toEqual([]);
    expect(hinweise({ ...basis, letzterLogin: new Date('2026-10-05') }, soll)).toEqual(['Seit über 14 Tagen nicht angemeldet']);
    expect(hinweise({ ...basis, letzterLogin: null }, soll)[0]).toMatch(/nie angemeldet/);
    expect(hinweise({ ...basis, pflichtsaetzeSitzen: 2 }, soll)).toEqual(['Pflichtsätze offen (4)']);
    expect(hinweise({ ...basis, kapitelErledigt: 0, quizBeantwortet: 0 }, soll)).toEqual(['Lernen nicht begonnen']);
    expect(hinweise({ ...basis, zweittermine: 3 }, soll)).toEqual(['Zweittermine ohne Abschluss']);
    // Deaktivierte Zugaenge sind nicht auffaellig.
    expect(hinweise({ ...basis, aktiv: false, letzterLogin: null }, soll)).toEqual([]);
  });

  it('sortiert nach jeder Spalte, bei Gleichstand nach Name', () => {
    const z = (name: string, abschluesse: number, quote: number | null): UebersichtZeile => ({
      benutzerId: name, name, aktiv: true, erstellt: jetzt, ersttermine: 0, zweittermine: 0, abschluesse, absagen: 0, quote,
      provisionQuartalCent: 0, kapitelErledigt: 0, quizRichtig: 0, quizBeantwortet: 0, pflichtsaetzeSitzen: 0, letzterLogin: null, hinweise: [],
    });
    const liste = [z('Cora', 1, 0.5), z('anton', 3, null), z('Bea', 1, 1)];
    expect(sortiere(liste, 'name', 'auf').map((x) => x.name)).toEqual(['anton', 'Bea', 'Cora']);
    expect(sortiere(liste, 'abschluesse', 'ab').map((x) => x.name)).toEqual(['anton', 'Bea', 'Cora']);
    expect(sortiere(liste, 'abschluesse', 'auf').map((x) => x.name)).toEqual(['Bea', 'Cora', 'anton']);
    expect(sortiere(liste, 'quote', 'ab').map((x) => x.name)).toEqual(['Bea', 'Cora', 'anton']);
    // Die Eingabe bleibt unveraendert.
    expect(liste.map((x) => x.name)).toEqual(['Cora', 'anton', 'Bea']);
  });
});
