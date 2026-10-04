import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { neueDb, vertriebler } from './helfer.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { aendereKunde, erstelleKunde, holeKunde, pruefeKunde } from '../src/lib/kunden.ts';
import {
  anzahlFaellig,
  entferneWiedervorlage,
  erledigeWiedervorlage,
  faelligkeit,
  gruppiere,
  holeWiedervorlage,
  offeneWiedervorlagen,
  pruefeWiedervorlage,
  setzeWiedervorlage,
  wiedervorlagenAlle,
  wiedervorlagenImZeitraum,
} from '../src/lib/wiedervorlage.ts';
import { heuteBerlin, monat, plusTage, quartal, tageZwischen, woche, wochentag } from '../src/lib/datum.ts';

let db: Db;
let anna: Benutzer;
let bert: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna');
  bert = await vertriebler(db, 'Bert');
});
afterAll(() => db.close());

describe('Datum', () => {
  it('rechnet in Europe/Berlin, nicht in UTC', () => {
    // 23:30 UTC am 4.10. ist in Berlin schon der 5.10.
    expect(heuteBerlin(new Date('2026-10-04T23:30:00Z'))).toBe('2026-10-05');
    expect(heuteBerlin(new Date('2026-10-04T21:30:00Z'))).toBe('2026-10-04');
    // Im Winter nur eine Stunde Unterschied.
    expect(heuteBerlin(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(heuteBerlin(new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31');
  });
  it('kennt Wochen von Montag bis Sonntag, auch ueber Monats- und Jahreswechsel', () => {
    expect(wochentag('2026-10-05')).toBe(1);
    expect(wochentag('2026-10-04')).toBe(7);
    expect(woche('2026-10-07')).toEqual({ von: '2026-10-05', bis: '2026-10-11' });
    expect(woche('2026-10-04')).toEqual({ von: '2026-09-28', bis: '2026-10-04' });
    expect(woche('2027-01-01')).toEqual({ von: '2026-12-28', bis: '2027-01-03' });
    expect(plusTage('2026-10-31', 1)).toBe('2026-11-01');
    expect(plusTage('2026-03-29', 1)).toBe('2026-03-30');
    expect(tageZwischen('2026-10-04', '2026-10-01')).toBe(-3);
  });
  it('kennt Monate und Quartale', () => {
    expect(monat('2026-02')).toEqual({ von: '2026-02-01', bis: '2026-02-28' });
    expect(monat('2028-02')).toEqual({ von: '2028-02-01', bis: '2028-02-29' });
    expect(quartal('2026-10')).toMatchObject({ von: '2026-10', bis: '2026-12', nummer: 4 });
    expect(quartal('2026-02')).toMatchObject({ von: '2026-01', bis: '2026-03', nummer: 1 });
  });
});

describe('Wiedervorlage pruefen', () => {
  it('verlangt ein gueltiges Datum, kuerzt den Grund', () => {
    expect(pruefeWiedervorlage({}).fehler).toContain('Das Datum der Wiedervorlage fehlt.');
    expect(pruefeWiedervorlage({ datum: '2026-13-01' }).fehler.length).toBe(1);
    expect(pruefeWiedervorlage({ datum: '2026-02-30' }).fehler.length).toBe(1);
    expect(pruefeWiedervorlage({ datum: 'morgen' }).fehler.length).toBe(1);
    const ok = pruefeWiedervorlage({ datum: '2026-10-12', grund: '  Angebot  nachfassen \n ' });
    expect(ok.fehler).toEqual([]);
    expect(ok.wert).toEqual({ datum: '2026-10-12', grund: 'Angebot nachfassen' });
    expect(pruefeWiedervorlage({ datum: '2026-10-12', grund: 'x'.repeat(500) }).wert.grund.length).toBe(200);
  });
  it('ordnet relativ zu heute ein', () => {
    const heute = '2026-10-07'; // Mittwoch
    expect(faelligkeit('2026-10-06', heute)).toBe('ueberfaellig');
    expect(faelligkeit('2026-10-07', heute)).toBe('heute');
    expect(faelligkeit('2026-10-11', heute)).toBe('woche');
    expect(faelligkeit('2026-10-12', heute)).toBe('spaeter');
  });
});

describe('Wiedervorlage setzen, erledigen, sehen', () => {
  it('A setzt nur bei eigenen Kunden, B sieht sie nicht', async () => {
    const ka = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Anna Kunde', status: 'angebot' }).wert);
    const kb = await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Bert Kunde', status: 'angerufen' }).wert);

    expect(await setzeWiedervorlage(db, anna.id, kb.id, { datum: '2026-10-10', grund: 'fremd' })).toBeNull();
    expect(await setzeWiedervorlage(db, anna.id, 'keine-uuid', { datum: '2026-10-10', grund: '' })).toBeNull();
    const w = await setzeWiedervorlage(db, anna.id, ka.id, { datum: '2026-10-10', grund: 'Angebot nachfassen' });
    expect(w).toMatchObject({ kundeId: ka.id, kundeName: 'Anna Kunde', status: 'angebot', datum: '2026-10-10', grund: 'Angebot nachfassen', erledigtAm: null });

    expect((await offeneWiedervorlagen(db, anna.id)).map((x) => x.kundeId)).toEqual([ka.id]);
    expect(await offeneWiedervorlagen(db, bert.id)).toEqual([]);
    expect(await holeWiedervorlage(db, bert.id, ka.id)).toBeNull();
    expect(await holeWiedervorlage(db, bert.id, kb.id)).toBeNull();

    // Erledigen fremder Eintraege laeuft ins Leere.
    expect(await erledigeWiedervorlage(db, bert.id, ka.id)).toBe(false);
    expect(await entferneWiedervorlage(db, bert.id, ka.id)).toBe(false);
    expect((await offeneWiedervorlagen(db, anna.id)).length).toBe(1);
  });

  it('erledigt markieren nimmt sie aus der Liste, eine neue macht sie wieder offen', async () => {
    const [w] = await offeneWiedervorlagen(db, anna.id);
    expect(await erledigeWiedervorlage(db, anna.id, w.kundeId)).toBe(true);
    // Zweimal erledigen geht nicht.
    expect(await erledigeWiedervorlage(db, anna.id, w.kundeId)).toBe(false);
    expect(await offeneWiedervorlagen(db, anna.id)).toEqual([]);
    const alt = await holeWiedervorlage(db, anna.id, w.kundeId);
    expect(alt?.erledigtAm).toBeInstanceOf(Date);
    expect(alt?.datum).toBe('2026-10-10');

    const neu = await setzeWiedervorlage(db, anna.id, w.kundeId, { datum: '2026-11-02', grund: 'Nach Urlaub' });
    expect(neu?.erledigtAm).toBeNull();
    expect((await offeneWiedervorlagen(db, anna.id)).map((x) => x.datum)).toEqual(['2026-11-02']);
  });

  it('bleibt beim Aendern der Kundendaten erhalten und verschwindet mit dem Kunden', async () => {
    const k = (await holeKunde(db, anna.id, (await offeneWiedervorlagen(db, anna.id))[0].kundeId))!;
    await aendereKunde(db, anna.id, k.id, { ...k, ort: 'Nagold', status: 'abschluss' });
    const w = await holeWiedervorlage(db, anna.id, k.id);
    expect(w?.datum).toBe('2026-11-02');
    expect(w?.status).toBe('abschluss');
    expect(await entferneWiedervorlage(db, anna.id, k.id)).toBe(true);
    expect(await holeWiedervorlage(db, anna.id, k.id)).toBeNull();
  });

  it('gruppiert in ueberfaellig, heute, diese Woche, spaeter und zaehlt fuer den Admin', async () => {
    const heute = '2026-10-07';
    const namen = ['Gestern', 'Heute', 'Sonntag', 'Naechste Woche'];
    const daten = ['2026-10-06', '2026-10-07', '2026-10-11', '2026-10-12'];
    for (let i = 0; i < namen.length; i++) {
      const k = await erstelleKunde(db, anna.id, pruefeKunde({ name: namen[i], status: 'angerufen' }).wert);
      await setzeWiedervorlage(db, anna.id, k.id, { datum: daten[i], grund: '' });
    }
    const kb = await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Berts Faellige', status: 'angerufen' }).wert);
    await setzeWiedervorlage(db, bert.id, kb.id, { datum: '2026-10-01', grund: '' });

    const liste = await offeneWiedervorlagen(db, anna.id);
    expect(liste.map((w) => w.kundeName)).toEqual(namen);
    const g = gruppiere(liste, heute);
    expect(g.ueberfaellig.map((w) => w.kundeName)).toEqual(['Gestern']);
    expect(g.heute.map((w) => w.kundeName)).toEqual(['Heute']);
    expect(g.woche.map((w) => w.kundeName)).toEqual(['Sonntag']);
    expect(g.spaeter.map((w) => w.kundeName)).toEqual(['Naechste Woche']);
    expect(anzahlFaellig(liste, heute)).toBe(2);

    expect((await wiedervorlagenImZeitraum(db, anna.id, '2026-10-05', '2026-10-11')).map((w) => w.kundeName)).toEqual(['Gestern', 'Heute', 'Sonntag']);
    expect(await wiedervorlagenAlle(db, heute)).toEqual({ offen: 5, faellig: 3 });
  });
});
