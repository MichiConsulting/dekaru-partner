// Briefing-Bogen: nur eigene Kunden, nur eigene Boegen, Passwort-Sperre,
// Pflichtfelder beim Einreichen, Statuswechsel, Admin sieht alle.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { neueDb, vertriebler } from './helfer.ts';
import { erstelleKunde, pruefeKunde, type Kunde } from '../src/lib/kunden.ts';
import {
  ALLE_FELDER,
  PASSWORT_SPERRE,
  TEILE,
  alleBriefings,
  enthaeltPasswort,
  erstelleBriefing,
  holeBriefing,
  holeBriefingAdmin,
  listeBriefings,
  loescheBriefing,
  pruefeBriefing,
  reicheEin,
  setzeStatusAdmin,
  speichereBriefing,
} from '../src/lib/briefing.ts';

let db: Db;
let anna: Benutzer;
let bert: Benutzer;
let kundeAnna: Kunde;
let kundeBert: Kunde;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna', 'anna');
  bert = await vertriebler(db, 'Bert', 'bert');
  kundeAnna = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Metallbau Sturm', ort: 'Nagold', ansprechpartner: 'Herr Sturm', status: 'zweittermin', terminDatum: '2026-10-10' }).wert);
  kundeBert = await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Bäckerei Wagner', status: 'angebot' }).wert);
});
afterAll(() => db.close());

/** Ein vollstaendiges Formular, wie es der Browser schickt. */
function vollstaendig(extra: Record<string, string> = {}): Record<string, string> {
  return {
    firmenname: 'Metallbau Sturm GmbH',
    rechtsform: 'GmbH',
    unterzeichner: 'Herr Peter Sturm',
    strasse: 'Industriestraße 7',
    plz: '72202',
    ort: 'Nagold',
    email: 'info@example.de',
    branche: 'Handwerk',
    paket: 'mittel',
    b_unterseite: '2',
    b_team: 'on',
    hosting: 'basis',
    zahlweise: 'monatlich',
    zulieferung_bis: '2026-11-01',
    fotos: 'kunde',
    fotorechte: 'on',
    logo: 'datei',
    kontaktformular: 'on',
    referenz: 'ja',
    weiss_angebot: 'on',
    weiss_zulieferung: 'on',
    weiss_rueckfragen: 'on',
    ...extra,
  };
}

describe('Briefing-Bogen: Felder', () => {
  it('hat nur Felder fuer Angebot, Vertrag und AVV, keine Zugangsdaten', () => {
    const namen = ALLE_FELDER.map((f) => f.name);
    expect(new Set(namen).size).toBe(namen.length);
    expect(namen).toContain('firmenname');
    expect(namen).toContain('referenz');
    expect(namen).toContain('gesundheitsdaten');
    // Blatt 11, Teil F fragte nach dem Namen des Zugangs. Hier bewusst nicht.
    expect(namen.some((n) => /zugang|passw|login/i.test(n))).toBe(false);
    // Blatt 11, Teil D (Inhalte fuer die Seite) bleibt aussen vor: Datensparsamkeit.
    expect(namen.some((n) => /oeffnungszeiten|leistungen|geschichte/i.test(n))).toBe(false);
    expect(TEILE.map((t) => t.kennung)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('erkennt gaengige Passwort-Muster', () => {
    for (const text of ['Passwort: geheim', 'PW: 1234', 'Kennwort = abc', 'passwort ist hallo', 'Login: max / Zugangsdaten: xyz', 'PIN: 4711', 'Das Passwort schicke ich nach']) {
      expect(enthaeltPasswort(text), text).toBe(true);
    }
    for (const text of ['Strato, Zugang hat der Inhaber', 'Pinnwand im Laden', 'Login-Bereich für Kunden gewünscht (Sonderwunsch)', 'kein Logo vorhanden']) {
      expect(enthaeltPasswort(text), text).toBe(false);
    }
  });

  it('sperrt Passwoerter auch beim Zwischenspeichern', () => {
    const p = pruefeBriefing({ firmenname: 'Test', sonderwuensche: 'Strato Passwort: geheim123', paket: 'klein' });
    expect(p.sperren).toEqual([`Sonderwünsche, die nicht auf der Preisliste stehen: ${PASSWORT_SPERRE}`]);
    expect(p.daten.felder.sonderwuensche).toBeUndefined();
    expect(p.daten.felder.firmenname).toBe('Test');
  });

  it('nennt fehlende Pflichtangaben nur fuers Einreichen', () => {
    const leer = pruefeBriefing({ paket: 'klein' });
    expect(leer.sperren).toEqual([]);
    expect(leer.fehlend).toContain('Firmenname, genau wie im Register');
    expect(leer.fehlend).toContain('Referenznennung');
    expect(leer.fehlend).toContain('Er weiß, was er bis wann liefern muss (Teil C)');

    const voll = pruefeBriefing(vollstaendig());
    expect(voll.sperren).toEqual([]);
    expect(voll.fehlend).toEqual([]);
    expect(voll.daten.auswahl).toEqual({ paket: 'mittel', bausteine: { unterseite: 2, team: true }, zusatzleistungen: [], hosting: { tarif: 'basis', zahlweise: 'monatlich', gratisquartal: false } });
  });

  it('kennt die Abhaengigkeiten aus Blatt 11', () => {
    // Fotos vom Kunden ohne Rechtebestaetigung.
    expect(pruefeBriefing(vollstaendig({ fotorechte: '' })).fehlend).toContain('Bestätigung der Fotorechte, weil der Kunde Fotos liefert');
    // Gross ohne Hosting: Hinweis an den Kunden noetig.
    expect(pruefeBriefing(vollstaendig({ paket: 'gross', hosting: 'keins' })).fehlend.some((f) => /mitarbeitende Funktion/.test(f))).toBe(true);
    expect(pruefeBriefing(vollstaendig({ paket: 'gross', hosting: 'keins', kein_hosting_gesagt: 'on' })).fehlend).toEqual([]);
    // Weitere Sprache ohne Angabe welche, individuelles Feature ohne Beschreibung.
    expect(pruefeBriefing(vollstaendig({ b_sprache: '1' })).fehlend).toContain('Weitere Sprache, welche');
    expect(pruefeBriefing(vollstaendig({ b_individuell: 'on' })).fehlend).toContain('Individuelles Feature, Beschreibung');
    // Falsches Datum und falsche Mail sperren.
    expect(pruefeBriefing(vollstaendig({ zulieferung_bis: '01.11.2026' })).sperren.length).toBe(1);
    expect(pruefeBriefing(vollstaendig({ email: 'keine-adresse' })).sperren.length).toBe(1);
  });
});

describe('Briefing-Bogen: Speichern und Zugriff', () => {
  let bogenAnna: string;

  it('legt einen Bogen nur zu eigenen Kunden an und belegt Teil A vor', async () => {
    expect(await erstelleBriefing(db, anna.id, kundeBert.id)).toBeNull();
    expect(await erstelleBriefing(db, anna.id, 'keine-uuid')).toBeNull();
    const b = (await erstelleBriefing(db, anna.id, kundeAnna.id))!;
    bogenAnna = b.id;
    expect(b.status).toBe('entwurf');
    expect(b.kundeName).toBe('Metallbau Sturm');
    expect(b.daten.felder.firmenname).toBe('Metallbau Sturm');
    expect(b.daten.felder.ort).toBe('Nagold');
    expect(b.daten.felder.unterzeichner).toBe('Herr Sturm');
    expect(b.daten.felder.kontaktformular).toBe('on');
  });

  it('Vertriebler B sieht und aendert den Bogen von A nicht', async () => {
    expect(await holeBriefing(db, bert.id, bogenAnna)).toBeNull();
    expect((await listeBriefings(db, bert.id)).length).toBe(0);
    expect((await listeBriefings(db, anna.id)).map((b) => b.id)).toEqual([bogenAnna]);
    const fremd = pruefeBriefing(vollstaendig({ firmenname: 'Gekapert' })).daten;
    expect(await speichereBriefing(db, bert.id, bogenAnna, fremd)).toBeNull();
    expect(await reicheEin(db, bert.id, bogenAnna, fremd)).toBeNull();
    expect(await loescheBriefing(db, bert.id, bogenAnna)).toBe(false);
    expect((await holeBriefing(db, anna.id, bogenAnna))?.daten.felder.firmenname).toBe('Metallbau Sturm');
  });

  it('speichert Entwuerfe, reicht ein und sperrt danach', async () => {
    const teil = pruefeBriefing({ firmenname: 'Metallbau Sturm GmbH', paket: 'gross', b_logo: 'on' }).daten;
    const gespeichert = await speichereBriefing(db, anna.id, bogenAnna, teil);
    expect(gespeichert?.daten.auswahl.paket).toBe('gross');
    expect(gespeichert?.daten.auswahl.bausteine).toEqual({ logo: true });

    const voll = pruefeBriefing(vollstaendig());
    const eingereicht = await reicheEin(db, anna.id, bogenAnna, voll.daten, new Date('2026-10-04T10:00:00Z'));
    expect(eingereicht?.status).toBe('eingereicht');
    expect(eingereicht?.eingereichtAm?.toISOString()).toBe('2026-10-04T10:00:00.000Z');

    // Danach aendert der Vertriebler nichts mehr.
    expect(await speichereBriefing(db, anna.id, bogenAnna, teil)).toBeNull();
    expect(await reicheEin(db, anna.id, bogenAnna, teil)).toBeNull();
    expect(await loescheBriefing(db, anna.id, bogenAnna)).toBe(false);
  });

  it('der Admin sieht alle eingereichten Boegen, keine Entwuerfe, markiert und gibt zurueck', async () => {
    const bBert = (await erstelleBriefing(db, bert.id, kundeBert.id))!;
    const alle = await alleBriefings(db);
    expect(alle.map((b) => [b.vertrieblerName, b.status])).toEqual([['Anna', 'eingereicht']]);
    expect(await alleBriefings(db, 'entwurf')).toHaveLength(1); // unbekannter Filter faellt auf "alle eingereichten" zurueck
    expect(await holeBriefingAdmin(db, bBert.id)).toBeNull();
    expect((await alleBriefings(db, 'eingereicht')).map((b) => b.id)).toEqual([bogenAnna]);
    expect((await holeBriefingAdmin(db, bogenAnna))?.vertrieblerSlug).toBe('anna');

    expect(await setzeStatusAdmin(db, bBert.id, 'uebernommen')).toBe(false); // Entwuerfe werden nicht uebernommen
    expect(await setzeStatusAdmin(db, bogenAnna, 'uebernommen')).toBe(true);
    expect((await holeBriefing(db, anna.id, bogenAnna))?.status).toBe('uebernommen');
    expect(await setzeStatusAdmin(db, bogenAnna, 'entwurf')).toBe(true);
    const zurueck = await holeBriefing(db, anna.id, bogenAnna);
    expect(zurueck?.status).toBe('entwurf');
    expect(zurueck?.eingereichtAm).toBeNull();
    expect(await holeBriefingAdmin(db, bogenAnna)).toBeNull();
    expect(await setzeStatusAdmin(db, bogenAnna, 'entwurf')).toBe(false);
  });

  it('ueberlebt das Loeschen des Kunden mit dem Firmennamen aus dem Bogen', async () => {
    await db.query('DELETE FROM kunden WHERE id = $1', [kundeAnna.id]);
    const b = await holeBriefing(db, anna.id, bogenAnna);
    expect(b?.kundeId).toBeNull();
    expect(b?.kundeName).toBe('Metallbau Sturm GmbH');
  });

  it('loescht eigene Entwuerfe', async () => {
    const b = (await erstelleBriefing(db, bert.id, kundeBert.id))!;
    expect(await loescheBriefing(db, bert.id, b.id)).toBe(true);
    expect(await holeBriefing(db, bert.id, b.id)).toBeNull();
  });
});
