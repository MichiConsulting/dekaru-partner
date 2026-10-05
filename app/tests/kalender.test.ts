import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { neueDb, vertriebler } from './helfer.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { erstelleKunde, pruefeKunde } from '../src/lib/kunden.ts';
import { setzeWiedervorlage } from '../src/lib/wiedervorlage.ts';
import {
  eintraegeImZeitraum,
  erzeugeIcs,
  holeEintrag,
  icsDateiname,
  icsFalten,
  icsText,
  icsUid,
  nachTag,
  terminEnde,
  termineImZeitraum,
  vergleicheEintraege,
  type KalenderEintrag,
} from '../src/lib/kalender.ts';
import {
  ABO_FEHL_GRENZEN,
  ABO_GRENZEN,
  benutzerZuKalenderToken,
  erzeugeKalenderToken,
  istTokenFormat,
  kalenderTokenStand,
  pruefeAboAnfrage,
  widerrufeKalenderToken,
} from '../src/lib/kalender-token.ts';
import { setzeAktiv } from '../src/lib/auth.ts';
import { entscheideZugriff } from '../src/lib/zugriff.ts';

let db: Db;
let anna: Benutzer;
let bert: Benutzer;
beforeAll(async () => {
  db = await neueDb();
  anna = await vertriebler(db, 'Anna', 'anna');
  bert = await vertriebler(db, 'Bert', 'bert');
});
afterAll(() => db.close());

function eintrag(extra: Partial<KalenderEintrag> = {}): KalenderEintrag {
  return {
    typ: 'termin',
    datum: '2026-10-07',
    beginn: null,
    dauerMinuten: null,
    kundeId: '11111111-2222-4333-8444-555555555555',
    kundeName: 'Bäckerei Muster',
    ort: 'Horb',
    status: 'termin',
    grund: '',
    geaendertAm: new Date('2026-10-01T10:00:00Z'),
    ...extra,
  };
}

describe('ICS-Format (RFC 5545)', () => {
  it('maskiert Komma, Semikolon, Backslash und Zeilenumbrueche', () => {
    expect(icsText('Müller, Söhne; GmbH \\ Co')).toBe('Müller\\, Söhne\\; GmbH \\\\ Co');
    expect(icsText('Zeile 1\r\nZeile 2\nZeile 3')).toBe('Zeile 1\\nZeile 2\\nZeile 3');
    expect(icsText('Tab\tbleibt, Steuerzeichen\u0007weg')).toBe('Tab\tbleibt\\, Steuerzeichenweg');
  });

  it('faltet Zeilen bei 75 Oktetten, ohne Mehrbyte-Zeichen zu zerreissen', () => {
    const kurz = 'SUMMARY:kurz';
    expect(icsFalten(kurz)).toBe(kurz);
    const lang = 'SUMMARY:' + 'ä'.repeat(60);
    const gefaltet = icsFalten(lang);
    const teile = gefaltet.split('\r\n');
    expect(teile.length).toBeGreaterThan(1);
    for (const [i, teil] of teile.entries()) {
      expect(Buffer.byteLength(teil, 'utf8')).toBeLessThanOrEqual(75);
      if (i > 0) expect(teil.startsWith(' ')).toBe(true);
    }
    // Entfaltet ergibt sich wieder die Zeile.
    expect(gefaltet.replace(/\r\n /g, '')).toBe(lang);
  });

  it('schreibt einen gueltigen Kalender mit Zeitzone Europe/Berlin und ganztaegigen Terminen', () => {
    const jetzt = new Date('2026-10-04T16:05:09.123Z');
    const ics = erzeugeIcs([eintrag(), eintrag({ typ: 'wiedervorlage', datum: '2026-10-31', kundeName: 'Metall, Bau; Sturm', status: 'angebot', grund: 'geheim' })], 'dekaru Termine, Anna', jetzt);

    // Nur CRLF, keine nackten LF, Ende mit CRLF.
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
    expect(ics.endsWith('\r\n')).toBe(true);
    const zeilen = ics.split('\r\n');
    expect(zeilen[0]).toBe('BEGIN:VCALENDAR');
    expect(zeilen).toContain('VERSION:2.0');
    expect(zeilen).toContain('PRODID:-//dekaru//Partner-Portal//DE');
    expect(zeilen).toContain('METHOD:PUBLISH');
    expect(zeilen).toContain('X-WR-CALNAME:dekaru Termine\\, Anna');
    expect(zeilen).toContain('X-WR-TIMEZONE:Europe/Berlin');
    expect(zeilen).toContain('TZID:Europe/Berlin');
    expect(zeilen.filter((z) => z === 'BEGIN:VTIMEZONE').length).toBe(1);
    expect(zeilen.filter((z) => z === 'BEGIN:VEVENT').length).toBe(2);
    expect(zeilen.filter((z) => z === 'END:VEVENT').length).toBe(2);
    expect(zeilen[zeilen.length - 2]).toBe('END:VCALENDAR');
    for (const z of zeilen) expect(Buffer.byteLength(z, 'utf8')).toBeLessThanOrEqual(75);

    expect(zeilen).toContain('DTSTAMP:20261004T160509Z');
    expect(zeilen).toContain('DTSTART;VALUE=DATE:20261007');
    expect(zeilen).toContain('DTEND;VALUE=DATE:20261008');
    expect(zeilen).toContain('DTSTART;VALUE=DATE:20261031');
    expect(zeilen).toContain('DTEND;VALUE=DATE:20261101');
    expect(zeilen).toContain('UID:termin-11111111-2222-4333-8444-555555555555@partner.dekaru.de');
    expect(zeilen).toContain('UID:wiedervorlage-11111111-2222-4333-8444-555555555555@partner.dekaru.de');
    expect(zeilen).toContain('SUMMARY:Termin: Bäckerei Muster (Termin vereinbart)');
    expect(zeilen).toContain('SUMMARY:Wiedervorlage: Metall\\, Bau\\; Sturm (Angebot)');
    // Keine Telefonnummern, Notizen oder Gruende im Kalender.
    expect(ics).not.toContain('geheim');
    expect(zeilen.some((z) => z.startsWith('DESCRIPTION'))).toBe(false);
    expect(zeilen.some((z) => z.startsWith('LOCATION'))).toBe(false);
  });

  it('schreibt Termine mit Uhrzeit mit TZID Europe/Berlin und lokaler Zeit', () => {
    const jetzt = new Date('2026-10-04T16:05:09Z');
    const ics = erzeugeIcs(
      [
        eintrag({ beginn: '14:30', dauerMinuten: 90 }),
        eintrag({ kundeId: '22222222-2222-4333-8444-555555555555', datum: '2026-10-08', beginn: '23:30', dauerMinuten: 60 }),
        eintrag({ kundeId: '33333333-2222-4333-8444-555555555555', datum: '2026-10-09' }),
      ],
      'dekaru Termine',
      jetzt,
    );
    const zeilen = ics.split('\r\n');
    expect(zeilen).toContain('DTSTART;TZID=Europe/Berlin:20261007T143000');
    expect(zeilen).toContain('DTEND;TZID=Europe/Berlin:20261007T160000');
    // Ueber Mitternacht: Ende am Folgetag.
    expect(zeilen).toContain('DTSTART;TZID=Europe/Berlin:20261008T233000');
    expect(zeilen).toContain('DTEND;TZID=Europe/Berlin:20261009T003000');
    // Ganztaegig unveraendert.
    expect(zeilen).toContain('DTSTART;VALUE=DATE:20261009');
    expect(zeilen).toContain('DTEND;VALUE=DATE:20261010');
    // Lokale Zeit ohne Z, jede TZID hat ihre VTIMEZONE, genau eine.
    expect(zeilen.filter((z) => /^DT(START|END);TZID=/.test(z)).every((z) => !z.endsWith('Z'))).toBe(true);
    expect(zeilen.filter((z) => z === 'BEGIN:VTIMEZONE').length).toBe(1);
    expect(zeilen).toContain('TZID:Europe/Berlin');
    expect(zeilen.filter((z) => z === 'TRANSP:OPAQUE').length).toBe(2);
    expect(zeilen.filter((z) => z === 'TRANSP:TRANSPARENT').length).toBe(1);
    // Datenschutz: auch mit Uhrzeit nur Name und Status.
    expect(zeilen.some((z) => /^(DESCRIPTION|LOCATION)/.test(z))).toBe(false);
    expect(ics).not.toContain('Horb');
  });

  it('rechnet das Ende in Wanduhrzeit, auch ueber Mitternacht und Monatsende', () => {
    expect(terminEnde('2026-10-07', '09:00', 60)).toEqual({ datum: '2026-10-07', zeit: '10:00' });
    expect(terminEnde('2026-10-07', '09:45', 30)).toEqual({ datum: '2026-10-07', zeit: '10:15' });
    expect(terminEnde('2026-10-31', '22:00', 180)).toEqual({ datum: '2026-11-01', zeit: '01:00' });
    expect(terminEnde('2026-10-07', '12:00', 720)).toEqual({ datum: '2026-10-08', zeit: '00:00' });
  });

  it('sortiert je Tag ganztaegige zuerst, dann nach Uhrzeit', () => {
    const liste = [
      eintrag({ kundeName: 'C', beginn: '15:00', dauerMinuten: 60 }),
      eintrag({ kundeName: 'B', typ: 'wiedervorlage' }),
      eintrag({ kundeName: 'A', beginn: '09:00', dauerMinuten: 60 }),
      eintrag({ kundeName: 'D' }),
      eintrag({ kundeName: 'E', datum: '2026-10-06', beginn: '18:00', dauerMinuten: 60 }),
    ].sort(vergleicheEintraege);
    expect(liste.map((e) => e.kundeName)).toEqual(['E', 'D', 'B', 'A', 'C']);
  });

  it('bildet stabile UIDs und saubere Dateinamen', () => {
    expect(icsUid({ typ: 'termin', kundeId: 'abc' })).toBe('termin-abc@partner.dekaru.de');
    expect(icsDateiname(eintrag())).toBe('termin-2026-10-07-backerei-muster.ics');
    expect(icsDateiname(eintrag({ typ: 'wiedervorlage', kundeName: '!!!' }))).toBe('wiedervorlage-2026-10-07.ics');
  });

  it('gruppiert nach Tag', () => {
    const tage = nachTag([eintrag({ datum: '2026-10-09' }), eintrag(), eintrag({ typ: 'wiedervorlage' })]);
    expect(tage.map((t) => t.datum)).toEqual(['2026-10-07', '2026-10-09']);
    expect(tage[0].eintraege.length).toBe(2);
  });
});

describe('Kalender-Eintraege je Benutzer', () => {
  it('zeigt nur eigene Termine und offene Wiedervorlagen im Zeitraum', async () => {
    const ka = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Anna Termin', status: 'termin', terminDatum: '2026-10-07' }).wert);
    const ka2 = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Anna Spaeter', status: 'termin', terminDatum: '2026-11-20' }).wert);
    await setzeWiedervorlage(db, anna.id, ka2.id, { datum: '2026-10-09', grund: 'Unterlagen' });
    const kb = await erstelleKunde(db, bert.id, pruefeKunde({ name: 'Bert Termin', status: 'termin', terminDatum: '2026-10-07' }).wert);

    const annas = await eintraegeImZeitraum(db, anna.id, '2026-10-05', '2026-10-11');
    expect(annas.map((e) => [e.typ, e.kundeName, e.datum])).toEqual([
      ['termin', 'Anna Termin', '2026-10-07'],
      ['wiedervorlage', 'Anna Spaeter', '2026-10-09'],
    ]);
    expect(annas[1].grund).toBe('Unterlagen');
    expect((await termineImZeitraum(db, bert.id, '2026-10-05', '2026-10-11')).map((e) => e.kundeName)).toEqual(['Bert Termin']);
    expect((await eintraegeImZeitraum(db, anna.id, '2026-11-01', '2026-11-30')).map((e) => e.kundeName)).toEqual(['Anna Spaeter']);

    // Einzelne Eintraege: nur eigene, nur vorhandene.
    expect((await holeEintrag(db, anna.id, 'termin', ka.id))?.datum).toBe('2026-10-07');
    expect((await holeEintrag(db, anna.id, 'wiedervorlage', ka2.id))?.datum).toBe('2026-10-09');
    expect(await holeEintrag(db, anna.id, 'wiedervorlage', ka.id)).toBeNull();
    expect(await holeEintrag(db, anna.id, 'termin', kb.id)).toBeNull();
    expect(await holeEintrag(db, bert.id, 'termin', ka.id)).toBeNull();
    expect(await holeEintrag(db, anna.id, 'notiz', ka.id)).toBeNull();
  });

  it('liefert Uhrzeit und Dauer bei Terminen, Wiedervorlagen bleiben ganztaegig', async () => {
    const k = await erstelleKunde(
      db,
      anna.id,
      pruefeKunde({ name: 'Anna Uhrzeit', status: 'termin', terminDatum: '2026-12-03', terminBeginn: '10:30', terminDauer: '45' }).wert,
    );
    await setzeWiedervorlage(db, anna.id, k.id, { datum: '2026-12-03', grund: 'nachfassen' });
    const tag = await eintraegeImZeitraum(db, anna.id, '2026-12-03', '2026-12-03');
    expect(tag.map((e) => [e.typ, e.beginn, e.dauerMinuten])).toEqual([
      ['wiedervorlage', null, null],
      ['termin', '10:30', 45],
    ]);
    expect(await holeEintrag(db, anna.id, 'termin', k.id)).toMatchObject({ beginn: '10:30', dauerMinuten: 45 });
    expect(await holeEintrag(db, anna.id, 'wiedervorlage', k.id)).toMatchObject({ beginn: null, dauerMinuten: null });
  });
});

describe('Abo-Token', () => {
  it('ist zufaellig, nur als Hash gespeichert, widerrufbar und neu erzeugbar', async () => {
    expect(await kalenderTokenStand(db, anna.id)).toBeNull();
    const t1 = await erzeugeKalenderToken(db, anna.id);
    expect(istTokenFormat(t1)).toBe(true);
    const gespeichert = await db.query<{ token_hash: string }>('SELECT token_hash FROM kalender_token WHERE benutzer_id = $1', [anna.id]);
    expect(gespeichert[0].token_hash).not.toBe(t1);
    expect(gespeichert[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await benutzerZuKalenderToken(db, t1))?.id).toBe(anna.id);
    expect((await kalenderTokenStand(db, anna.id))?.zuletztAbgerufen).toBeInstanceOf(Date);

    // Neu erzeugen macht das alte ungueltig.
    const t2 = await erzeugeKalenderToken(db, anna.id);
    expect(t2).not.toBe(t1);
    expect(await benutzerZuKalenderToken(db, t1)).toBeNull();
    expect((await benutzerZuKalenderToken(db, t2))?.id).toBe(anna.id);

    // Widerrufen loescht.
    expect(await widerrufeKalenderToken(db, anna.id)).toBe(true);
    expect(await widerrufeKalenderToken(db, anna.id)).toBe(false);
    expect(await benutzerZuKalenderToken(db, t2)).toBeNull();
    expect(await kalenderTokenStand(db, anna.id)).toBeNull();
  });

  it('lehnt falsche Formate, fremde und deaktivierte Zugaenge ab', async () => {
    expect(await benutzerZuKalenderToken(db, '')).toBeNull();
    expect(await benutzerZuKalenderToken(db, 'x'.repeat(43))).toBeNull();
    expect(await benutzerZuKalenderToken(db, "' OR 1=1 --")).toBeNull();
    const tb = await erzeugeKalenderToken(db, bert.id);
    expect((await benutzerZuKalenderToken(db, tb))?.id).toBe(bert.id);
    await setzeAktiv(db, bert.id, false);
    expect(await benutzerZuKalenderToken(db, tb)).toBeNull();
    await setzeAktiv(db, bert.id, true);
  });

  it('der Abo-Pfad ist ohne Login erreichbar, alles andere unter /kalender nicht', () => {
    expect(entscheideZugriff('/kalender/abo/abc.ics', null)).toEqual({ typ: 'ok' });
    expect(entscheideZugriff('/kalender', null)).toEqual({ typ: 'login' });
    expect(entscheideZugriff('/kalender/eintrag/termin/x.ics', null)).toEqual({ typ: 'login' });
    expect(entscheideZugriff('/einstellungen', null)).toEqual({ typ: 'login' });
  });

  it('sperrt eine Adresse nach fuenf unbekannten Tokens, gueltige zaehlen nicht als Fehler', async () => {
    const jetzt = new Date('2026-10-04T12:00:00Z');
    const ta = await erzeugeKalenderToken(db, anna.id);
    const falsch = 'A'.repeat(43);

    for (let i = 0; i < ABO_FEHL_GRENZEN.max; i++) {
      expect(await pruefeAboAnfrage(db, falsch, '10.0.0.9', jetzt)).toEqual({ ok: false, grund: 'unbekannt' });
    }
    const gesperrt = await pruefeAboAnfrage(db, falsch, '10.0.0.9', jetzt);
    expect(gesperrt).toMatchObject({ ok: false, grund: 'gesperrt' });
    // Gesperrt heisst gesperrt, auch mit dem richtigen Token.
    expect(await pruefeAboAnfrage(db, ta, '10.0.0.9', jetzt)).toMatchObject({ ok: false, grund: 'gesperrt' });
    // Andere Adresse ist nicht betroffen.
    expect(await pruefeAboAnfrage(db, ta, '10.0.0.10', jetzt)).toMatchObject({ ok: true, benutzer: { id: anna.id } });
    // Nach der Sperre geht es wieder.
    const spaeter = new Date(jetzt.getTime() + (ABO_FEHL_GRENZEN.sperreMinuten + 1) * 60 * 1000);
    expect(await pruefeAboAnfrage(db, ta, '10.0.0.9', spaeter)).toMatchObject({ ok: true });
  });

  it('begrenzt auch die Gesamtzahl der Abrufe je Adresse', async () => {
    const jetzt = new Date('2026-10-04T13:00:00Z');
    const ta = await erzeugeKalenderToken(db, anna.id);
    for (let i = 0; i < ABO_GRENZEN.max; i++) {
      expect((await pruefeAboAnfrage(db, ta, '10.0.0.20', jetzt)).ok).toBe(true);
    }
    expect(await pruefeAboAnfrage(db, ta, '10.0.0.20', jetzt)).toMatchObject({ ok: false, grund: 'gesperrt' });
  });
});
