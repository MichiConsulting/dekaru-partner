import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { erstelleBenutzer, type Benutzer } from '../src/lib/auth.ts';
import { erstelleKunde, holeKunde, pruefeKunde } from '../src/lib/kunden.ts';
import {
  MELDUNG_EIGEN,
  MELDUNG_FREMD,
  dublettenImBestand,
  gleicherBetrieb,
  ladeMeldungen,
  normalisiereName,
  normalisiereOrt,
  normalisiereTelefon,
  pruefeDublette,
  schluessel,
} from '../src/lib/dubletten.ts';
import { akteurAus, dubletteEntscheiden } from '../src/lib/admin-aktionen.ts';
import { neueDb, vertriebler } from './helfer.ts';

describe('Normalisierung', () => {
  it('Name: Rechtsform, Gross und Klein, Sonderzeichen, Umlaute', () => {
    const varianten = [
      'Bäckerei Müller GmbH',
      'BAECKEREI MUELLER',
      'Bäckerei Müller GmbH & Co. KG',
      'bäckerei-müller e.K.',
      'Bäckerei  Müller (UG haftungsbeschränkt)',
      'Bäckerei Müller Inh. ',
      'Baeckerei Mueller e. K.',
    ];
    for (const v of varianten) expect(normalisiereName(v), v).toBe('baeckereimueller');
    expect(normalisiereName('Metallbau Sturm')).not.toBe(normalisiereName('Metallbau Storm'));
  });

  it('Name: NFC und NFD ergeben dasselbe', () => {
    const nfc = 'Müller'.normalize('NFC');
    const nfd = 'Müller'.normalize('NFD');
    expect(nfc).not.toBe(nfd);
    expect(normalisiereName(nfd)).toBe(normalisiereName(nfc));
    expect(normalisiereName(nfd)).toBe(normalisiereName('Mueller'));
    expect(normalisiereName('Café Élan')).toBe('cafeelan');
  });

  it('Ort: Postleitzahl, Klammer, Schreibweise', () => {
    expect(normalisiereOrt('72160 Horb')).toBe('horb');
    expect(normalisiereOrt('Horb (Neckar)')).toBe('horb');
    expect(normalisiereOrt('Nagold')).toBe(normalisiereOrt('NAGOLD '));
    expect(normalisiereOrt('Bad Liebenzell')).not.toBe(normalisiereOrt('Bad Wildbad'));
  });

  it('Telefon: nur Ziffern, +49 und 0049 werden 0', () => {
    const ziel = '074511234';
    for (const t of ['07451 1234', '07451/12 34', '+49 7451 1234', '+49 (0) 7451-1234', '0049 7451 1234', '(07451) 1234']) {
      expect(normalisiereTelefon(t), t).toBe(ziel);
    }
    expect(normalisiereTelefon('+43 1 234567')).toBe('00431234567');
  });

  it('gleicher Betrieb: Telefon allein, oder Name mit gleichem oder fehlendem Ort', () => {
    const a = schluessel({ name: 'Bäckerei Müller GmbH', ort: 'Horb', telefon: '07451 1234' });
    expect(gleicherBetrieb(a, schluessel({ name: 'Ganz anders', ort: 'Berlin', telefon: '+49 7451 1234' }))).toBe(true);
    expect(gleicherBetrieb(a, schluessel({ name: 'Baeckerei Mueller', ort: '72160 Horb' }))).toBe(true);
    expect(gleicherBetrieb(a, schluessel({ name: 'Baeckerei Mueller', ort: '' }))).toBe(true);
    expect(gleicherBetrieb(a, schluessel({ name: 'Baeckerei Mueller', ort: 'Nagold' }))).toBe(false);
    expect(gleicherBetrieb(a, schluessel({ name: 'Bäckerei Maier', ort: 'Horb' }))).toBe(false);
    // Zu kurze Nummern zaehlen nicht.
    expect(gleicherBetrieb(schluessel({ name: 'X', telefon: '112' }), schluessel({ name: 'Y', telefon: '112' }))).toBe(false);
  });
});

describe('Pruefung beim Speichern', () => {
  let db: Db;
  let anna: Benutzer;
  let bert: Benutzer;
  let chef: Benutzer;
  let annasKunde: string;

  beforeAll(async () => {
    db = await neueDb();
    anna = await vertriebler(db, 'Anna');
    bert = await vertriebler(db, 'Bert');
    chef = await erstelleBenutzer(db, { email: 'chef@example.test', name: 'Chef', rolle: 'admin', passwort: 'geheim-passwort-1' });
    const k = await erstelleKunde(
      db,
      anna.id,
      pruefeKunde({
        name: 'Bäckerei Müller GmbH',
        ort: 'Horb',
        telefon: '07451 1234',
        ansprechpartner: 'Frau Geheimname',
        notiz: 'GEHEIME-NOTIZ',
        status: 'termin',
        terminDatum: '2026-10-20',
      }).wert,
    );
    annasKunde = k.id;
  });
  afterAll(() => db.close());

  it('blockiert Bert mit dem neutralen Satz und verraet nichts ueber Anna', async () => {
    const e = await pruefeDublette(db, bert, { name: 'baeckerei mueller', ort: 'Horb', telefon: '' });
    expect(e).toEqual({ rolle: 'vertriebler', blockiert: true, meldung: MELDUNG_FREMD });
    const text = JSON.stringify(e);
    for (const geheim of ['Anna', 'anna', annasKunde, 'Frau Geheimname', 'GEHEIME-NOTIZ', '1234', '2026-10-20', 'Bäckerei Müller GmbH', 'termin']) {
      expect(text).not.toContain(geheim);
    }
    expect(MELDUNG_FREMD).toBe('Dieser Betrieb wird bereits betreut, bitte mit Michael Henning klären.');
  });

  it('erkennt auch ueber die Telefonnummer allein', async () => {
    const e = await pruefeDublette(db, bert, { name: 'Backstube am Markt', ort: 'Horb', telefon: '+49 (0) 7451 12 34' });
    expect(e.blockiert).toBe(true);
  });

  it('laesst andere Betriebe durch', async () => {
    const e = await pruefeDublette(db, bert, { name: 'Bäckerei Müller', ort: 'Nagold', telefon: '07452 9999' });
    expect(e).toEqual({ rolle: 'vertriebler', blockiert: false, meldung: null });
  });

  it('ein Vertriebler kann die Admin-Freigabe nicht selbst setzen', async () => {
    const e = await pruefeDublette(db, bert, { name: 'Bäckerei Müller', ort: 'Horb', telefon: '' }, { adminFreigabe: true });
    expect(e.blockiert).toBe(true);
    expect(e.rolle).toBe('vertriebler');
  });

  it('eigene Dublette: eigener Hinweis, ebenfalls ohne Daten', async () => {
    const e = await pruefeDublette(db, anna, { name: 'Bäckerei Müller', ort: 'Horb', telefon: '' });
    expect(e).toEqual({ rolle: 'vertriebler', blockiert: true, meldung: MELDUNG_EIGEN });
  });

  it('beim Bearbeiten zaehlt der eigene Eintrag nicht, und ohne Aenderung von Name, Ort, Telefon wird nicht geprueft', async () => {
    const eigen = { name: 'Bäckerei Müller GmbH', ort: 'Horb', telefon: '07451 1234' };
    expect((await pruefeDublette(db, anna, eigen, { kundeId: annasKunde })).blockiert).toBe(false);
    // Bert hat einen Altbestand, der Annas Betrieb gleicht: Statuswechsel bleibt moeglich.
    const alt = { name: 'Baeckerei Mueller', ort: 'Horb', telefon: '' };
    const k = await db.query<{ id: string }>(
      "INSERT INTO kunden (benutzer_id, name, ort, status) VALUES ($1, 'Baeckerei Mueller', 'Horb', 'angerufen') RETURNING id",
      [bert.id],
    );
    expect((await pruefeDublette(db, bert, alt, { kundeId: k[0].id, alt })).blockiert).toBe(false);
    await db.query('DELETE FROM kunden WHERE id = $1', [k[0].id]);
  });

  it('der Admin sieht beide Eintraege und kann sich selbst freigeben', async () => {
    const e = await pruefeDublette(db, chef, { name: 'Bäckerei Müller', ort: 'Horb', telefon: '' });
    expect(e.rolle).toBe('admin');
    expect(e.blockiert).toBe(true);
    if (e.rolle !== 'admin') throw new Error();
    expect(e.treffer).toEqual([{ id: annasKunde, name: 'Bäckerei Müller GmbH', ort: 'Horb', telefon: '07451 1234', vertriebler: 'Anna' }]);
    const frei = await pruefeDublette(db, chef, { name: 'Bäckerei Müller', ort: 'Horb', telefon: '' }, { adminFreigabe: true });
    expect(frei.blockiert).toBe(false);
  });

  it('legt je Treffer nur eine offene Meldung an, der Admin sieht beide Seiten', async () => {
    await pruefeDublette(db, bert, { name: 'Bäckerei Müller', ort: 'Horb', telefon: '' });
    const offen = await ladeMeldungen(db, true);
    expect(offen.length).toBe(1);
    const m = offen[0];
    expect(m.anfrage.vertriebler).toBe('Bert');
    expect(m.bestand.map((b) => b.vertriebler)).toEqual(['Anna']);
    // Datensparsam: in der Meldung liegen nur Name, Ort, Telefon des Versuchs.
    const roh = await db.query('SELECT * FROM dubletten_meldungen');
    expect(Object.keys(roh[0]).sort()).toEqual(
      ['benutzer_id', 'eigener_kunde_id', 'entschieden_am', 'entschieden_von', 'gemeldet_am', 'id', 'name', 'ort', 'status', 'telefon', 'treffer'].sort(),
    );
  });

  it('nach Freigabe darf Bert speichern, ablehnen haelt ihn weiter auf', async () => {
    const [m] = await ladeMeldungen(db, true);
    await dubletteEntscheiden(db, akteurAus(chef), m.id, 'freigeben');
    expect((await pruefeDublette(db, bert, { name: 'Bäckerei Müller', ort: 'Horb', telefon: '' })).blockiert).toBe(false);
    await expect(dubletteEntscheiden(db, akteurAus(chef), m.id, 'ablehnen')).rejects.toThrow(/schon entschieden/);

    const cora = await vertriebler(db, 'Cora');
    await pruefeDublette(db, cora, { name: 'Bäckerei Müller', ort: 'Horb', telefon: '' });
    const [mc] = await ladeMeldungen(db, true);
    await dubletteEntscheiden(db, akteurAus(chef), mc.id, 'ablehnen');
    expect((await pruefeDublette(db, cora, { name: 'Bäckerei Müller', ort: 'Horb', telefon: '' })).blockiert).toBe(true);
    // Nach der Ablehnung erzeugt ein neuer Versuch keine neue Meldung.
    expect((await ladeMeldungen(db, true)).length).toBe(0);
  });

  it('zuordnen loescht den fremden Eintrag, ohne Daten zu uebertragen', async () => {
    const dora = await vertriebler(db, 'Dora');
    const k = await erstelleKunde(db, dora.id, pruefeKunde({ name: 'Metallbau Sturm', ort: 'Nagold', notiz: 'DORAS-NOTIZ', status: 'angerufen' }).wert);
    const emil = await vertriebler(db, 'Emil');
    expect((await pruefeDublette(db, emil, { name: 'Metallbau Sturm GmbH', ort: 'Nagold', telefon: '' })).blockiert).toBe(true);
    const m = (await ladeMeldungen(db, true)).find((x) => x.anfrage.vertriebler === 'Emil')!;
    await dubletteEntscheiden(db, akteurAus(chef), m.id, 'zuordnen');
    expect(await holeKunde(db, dora.id, k.id)).toBeNull();
    expect((await pruefeDublette(db, emil, { name: 'Metallbau Sturm GmbH', ort: 'Nagold', telefon: '' })).blockiert).toBe(false);
    const emils = await db.query('SELECT * FROM kunden WHERE benutzer_id = $1', [emil.id]);
    expect(JSON.stringify(emils)).not.toContain('DORAS-NOTIZ');
  });

  it('findet Dubletten, die schon im Bestand liegen', async () => {
    await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Baeckerei Mueller', ort: 'Horb', status: 'angerufen' }).wert);
    const paare = await dublettenImBestand(db);
    expect(paare.length).toBe(1);
    expect([paare[0].a.vertriebler, paare[0].b.vertriebler].sort()).toEqual(['Anna', 'Bert']);
  });
});
