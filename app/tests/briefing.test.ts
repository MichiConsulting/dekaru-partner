// Briefing-Bogen: nur eigene Kunden, nur eigene Boegen, Passwort-Sperre,
// Pflichtfelder beim Einreichen, Statuswechsel, Admin sieht alle.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import type { Benutzer } from '../src/lib/auth.ts';
import { neueDb, vertriebler } from './helfer.ts';
import { erstelleKunde, pruefeKunde, type Kunde } from '../src/lib/kunden.ts';
import {
  ALLE_FELDER,
  BRANCHEN,
  PASSWORT_SPERRE,
  TEILE,
  alleBriefings,
  enthaeltPasswort,
  erstelleBriefing,
  holeBriefing,
  holeBriefingAdmin,
  listeBriefings,
  loescheBriefing,
  moduleAusSchemaLink,
  paletteZumTemplate,
  pruefeBriefing,
  reicheEin,
  setzeStatusAdmin,
  speichereBriefing,
} from '../src/lib/briefing.ts';
import { ALLE_PALETTEN, BRIEFING_ZU_TEMPLATE, palettenBranche } from '../src/lib/paletten.ts';
import { leereAuswahl } from '../src/lib/preise.ts';

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
    for (const text of [
      'Passwort: geheim',
      'Passwort =geheim',
      'Strato Passwort:geheim123',
      'PW: 1234',
      'pw=1234',
      'Kennwort = abc',
      'Kennwort: abc',
      'Login: max / Zugangsdaten: xyz',
      'Zugangsdaten: info@example.de',
      'PIN: 4711',
      'Passwörter: siehe Zettel',
    ]) {
      expect(enthaeltPasswort(text), text).toBe(true);
    }
    for (const text of [
      'Strato, Zugang hat der Inhaber',
      'Pinnwand im Laden',
      'Login-Bereich für Kunden gewünscht (Sonderwunsch)',
      'kein Logo vorhanden',
      'Das Passwort schickt der Kunde selbst',
      'Das Passwort schicke ich nach',
      'Passwort für den Hoster klärt der Inhaber direkt',
      'Passwort:',
      'Passwort: ',
      'Kennwort =',
      'Uhrzeit: 14:30, Ansprechpartner Herr PWagner',
      'Hinweis: Kunde hat kein Login',
    ]) {
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
    expect(voll.daten.auswahl).toEqual({ paket: 'mittel', bausteine: { unterseite: 2, team: true }, zusatzleistungen: [], module: [], hosting: { tarif: 'basis', zahlweise: 'monatlich', gratisquartal: false } });
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

  it('nimmt verkaufbare Software-Module auf, in jeder Branche', () => {
    const mit = pruefeBriefing(vollstaendig({ paket: 'gross', 'm_modul-kostenrechner': 'on', 'm_modul-terminbuchung': 'on' }));
    expect(mit.daten.auswahl.module).toEqual(['modul-kostenrechner']);
    expect(mit.fehlend).toEqual([]);
    // Seit 06.10.2026 keine Sperre nach Branche: Gastronomie mit Groß und Kostenrechner geht durch.
    for (const branche of Object.keys(BRIEFING_ZU_TEMPLATE)) {
      const r = pruefeBriefing(vollstaendig({ paket: 'gross', branche, 'm_modul-kostenrechner': 'on' }));
      expect(r.fehlend.filter((f) => /Kostenrechner|Branche/.test(f)), branche).toEqual([]);
      expect(r.daten.auswahl.module, branche).toEqual(['modul-kostenrechner']);
    }
  });

  it('liest vorgemerkte Module aus einem Schema-Link', () => {
    expect(moduleAusSchemaLink('https://partner.dekaru.de/schema?branche=gastro&palette=BL-2&module=kostenrechner,beitrags-schreiber#schritt-4')).toEqual(['modul-kostenrechner']);
    expect(moduleAusSchemaLink('/schema?module=kostenrechner')).toEqual(['modul-kostenrechner']);
    expect(moduleAusSchemaLink('kostenrechner')).toEqual(['modul-kostenrechner']);
    expect(moduleAusSchemaLink('https://partner.dekaru.de/schema?branche=gastro')).toEqual([]);
    expect(moduleAusSchemaLink('')).toEqual([]);
    expect(moduleAusSchemaLink('quatsch, terminbuchung')).toEqual([]);
  });

  it('nimmt Software-Module nur mit Paket Groß an, behaelt sie aber beim Speichern', () => {
    for (const paket of ['klein', 'mittel']) {
      const ohne = pruefeBriefing(vollstaendig({ paket, 'm_modul-kostenrechner': 'on' }));
      // Einreichen geht nicht, Zwischenspeichern schon: keine Sperre, Auswahl bleibt.
      expect(ohne.sperren).toEqual([]);
      expect(ohne.fehlend).toEqual(['Software-Module gibt es nur mit Paket Groß. Bitte Paket Groß wählen oder abwählen: Kostenrechner für Ihre Kunden.']);
      expect(ohne.daten.auswahl.module).toEqual(['modul-kostenrechner']);
    }
    expect(pruefeBriefing(vollstaendig({ paket: 'mittel' })).fehlend).toEqual([]);
  });
});

describe('Briefing-Bogen: Farbpalette', () => {
  it('nimmt jeden Code aus dem Katalog und "offen", sonst nichts', () => {
    expect(pruefeBriefing(vollstaendig({ farbpalette: 'HW-3' })).daten.felder.farbpalette).toBe('HW-3');
    expect(pruefeBriefing(vollstaendig({ farbpalette: 'BL-2' })).daten.felder.farbpalette).toBe('BL-2');
    expect(pruefeBriefing(vollstaendig({ farbpalette: 'IN-10' })).daten.felder.farbpalette).toBe('IN-10');
    expect(pruefeBriefing(vollstaendig({ farbpalette: 'offen' })).daten.felder.farbpalette).toBe('offen');
    expect(pruefeBriefing(vollstaendig({ farbpalette: '#7b1e2b' })).daten.felder.farbpalette).toBeUndefined();
    expect(pruefeBriefing(vollstaendig({ farbpalette: 'HW-9' })).daten.felder.farbpalette).toBeUndefined();
    const feld = TEILE.flatMap((t) => t.felder).find((f) => f.name === 'farbpalette')!;
    expect(feld.optionen!.length).toBe(ALLE_PALETTEN.length + 1);
    // Optional: ohne Angabe fehlt nichts.
    expect(pruefeBriefing(vollstaendig()).fehlend).toEqual([]);
  });

  it('jede Palette passt zu jeder Branche, ausser bei hell oder dunkel', () => {
    // Fremde Branchenpaletten sind seit dem Katalog kein Fehler mehr.
    expect(pruefeBriefing(vollstaendig({ branche: 'Handwerk', farbpalette: 'GA-2' })).fehlend).toEqual([]);
    expect(paletteZumTemplate('Tattoo', 'BL-2')).toBeNull();
    expect(paletteZumTemplate('Handwerk', 'DK-3')).toBeNull();
    // Die wenigen beschraenkten Standardpaletten melden sich beim Einreichen.
    const p = pruefeBriefing(vollstaendig({ branche: 'Handwerk', farbpalette: 'TA-1' }));
    expect(p.sperren).toEqual([]);
    expect(p.fehlend.some((f) => /TA-1 Rost passt nicht zum hellen Design/.test(f))).toBe(true);
    expect(paletteZumTemplate('Tattoo', 'DL-1')).toMatch(/dunklen Tattoo-Design/);
    expect(paletteZumTemplate('Tattoo', 'offen')).toBeNull();
    expect(paletteZumTemplate('', 'TA-1')).toBeNull();
  });

  it('jede Branche im Bogen hat eine Template-Branche mit Paletten', () => {
    for (const b of BRANCHEN) expect(palettenBranche(BRIEFING_ZU_TEMPLATE[b]), b).not.toBeNull();
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
    expect(b.daten.auswahl.module).toEqual([]);
  });

  it('uebernimmt beim Anlegen die Module aus dem Schema, aber nie das Paket', async () => {
    const b = (await erstelleBriefing(db, anna.id, kundeAnna.id, ['modul-kostenrechner', 'modul-terminbuchung']))!;
    expect(b.daten.auswahl.module).toEqual(['modul-kostenrechner']);
    // Das Paket bleibt die normale Vorbelegung, Module setzen nie Groß.
    expect(b.daten.auswahl.paket).toBe(leereAuswahl().paket);
    // Ohne Groß warnt der Bogen beim Einreichen wie sonst.
    expect(pruefeBriefing(vollstaendig({ 'm_modul-kostenrechner': 'on', paket: 'mittel' })).fehlend.join(' ')).toMatch(/nur mit Paket Groß/);
    await loescheBriefing(db, anna.id, b.id);
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

    expect(gespeichert?.farbpalette).toBeNull();
    const mitFarbe = await speichereBriefing(db, anna.id, bogenAnna, pruefeBriefing({ firmenname: 'X', farbpalette: 'offen' }).daten);
    expect(mitFarbe?.farbpalette).toBe('offen');

    const voll = pruefeBriefing(vollstaendig({ paket: 'gross', farbpalette: 'HW-2', 'm_modul-kostenrechner': 'on' }));
    expect(voll.fehlend).toEqual([]);
    const eingereicht = await reicheEin(db, anna.id, bogenAnna, voll.daten, new Date('2026-10-04T10:00:00Z'));
    expect(eingereicht?.status).toBe('eingereicht');
    expect(eingereicht?.farbpalette).toBe('HW-2');
    expect(eingereicht?.daten.felder.farbpalette).toBe('HW-2');
    // Module stehen im JSON des Bogens, ohne eigene Spalte.
    expect(eingereicht?.daten.auswahl.module).toEqual(['modul-kostenrechner']);
    expect(eingereicht?.eingereichtAm?.toISOString()).toBe('2026-10-04T10:00:00.000Z');

    // Danach aendert der Vertriebler nichts mehr.
    expect(await speichereBriefing(db, anna.id, bogenAnna, teil)).toBeNull();
    expect(await reicheEin(db, anna.id, bogenAnna, teil)).toBeNull();
    expect(await loescheBriefing(db, anna.id, bogenAnna)).toBe(false);
  });

  it('die Admin-Ansicht zeigt Code, Name, Gruppe und Farbfelder der Palette', async () => {
    const { experimental_AstroContainer: AstroContainer } = await import('astro/container');
    const { default: AdminSeite } = await import('../src/pages/admin/briefings/[id].astro');
    const { erstelleBenutzer } = await import('../src/lib/auth.ts');
    const chef = await erstelleBenutzer(db, { email: 'chef-farbe@example.test', name: 'Chef', rolle: 'admin', passwort: 'geheim-passwort-1' });
    const container = await AstroContainer.create();
    const antwort = await container.renderToResponse(AdminSeite, {
      request: new Request(`http://localhost/admin/briefings/${bogenAnna}`),
      params: { id: bogenAnna },
      locals: { db, benutzer: chef, csrf: 'x', sitzungId: 's' },
    });
    const html = await antwort.text();
    expect(html).toContain('HW-2 Petrol (Petrol und Türkis)');
    expect(html).toContain('palette: &quot;HW-2&quot;');
    expect(html).toMatch(/class="admin-palette__felder"[^>]*>\s*<span style="background:#007083"/);
    expect(html).not.toContain('passt nicht zum Design');
    // Angekreuzte Software-Module sind in der Admin-Ansicht sichtbar, mit Preis in der Summe.
    expect(html).toMatch(/data-briefing-module[^>]*>\s*Kostenrechner für Ihre Kunden\s*</);
    const summe = html.slice(html.indexOf('data-aufstellung')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(summe).toContain('Kostenrechner für Ihre Kunden 200 €');
  });

  it('der Admin sieht alle eingereichten Boegen, keine Entwuerfe, markiert und gibt zurueck', async () => {
    const bBert = (await erstelleBriefing(db, bert.id, kundeBert.id))!;
    const alle = await alleBriefings(db);
    expect(alle.map((b) => [b.vertrieblerName, b.status])).toEqual([['Anna', 'eingereicht']]);
    expect(await alleBriefings(db, 'entwurf')).toHaveLength(1); // unbekannter Filter faellt auf "alle eingereichten" zurueck
    expect(await holeBriefingAdmin(db, bBert.id)).toBeNull();
    expect((await alleBriefings(db, 'eingereicht')).map((b) => b.id)).toEqual([bogenAnna]);
    expect((await holeBriefingAdmin(db, bogenAnna))?.vertrieblerSlug).toBe('anna');
    expect((await alleBriefings(db))[0].farbpalette).toBe('HW-2');

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

describe('Briefing-Bogen: Module ohne Paket Groß', () => {
  it('ein gespeicherter Bogen mit Modul ohne Groß zeigt beim Oeffnen den Hinweis und behaelt das Kreuz', async () => {
    const { experimental_AstroContainer: AstroContainer } = await import('astro/container');
    const { default: BogenSeite } = await import('../src/pages/briefing/[id].astro');
    const kunde = await erstelleKunde(db, anna.id, pruefeKunde({ name: 'Umzüge Alt', status: 'zweittermin' }).wert);
    const b = (await erstelleBriefing(db, anna.id, kunde.id))!;
    // So lag ein Bogen vor der Regel vom 06.10.2026 in der Datenbank.
    const alt = pruefeBriefing(vollstaendig({ branche: 'Umzug', paket: 'mittel', 'm_modul-kostenrechner': 'on' }));
    await speichereBriefing(db, anna.id, b.id, alt.daten);
    const container = await AstroContainer.create();
    const antwort = await container.renderToResponse(BogenSeite, {
      request: new Request(`http://localhost/briefing/${b.id}`),
      params: { id: b.id },
      locals: { db, benutzer: anna, csrf: 'x', sitzungId: 's' },
    });
    const html = await antwort.text();
    const feld = /<input[^>]*name="m_modul-kostenrechner"[^>]*>/.exec(html)?.[0] ?? '';
    expect(feld).toMatch(/\schecked/);
    expect(feld).not.toMatch(/\sdisabled/);
    expect(html).not.toMatch(/data-module-warnung hidden/);
    expect(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('Software-Module gibt es nur mit Paket Groß. Angekreuzt ist Kostenrechner für Ihre Kunden');
    // Nichts wurde still geloescht.
    expect((await holeBriefing(db, anna.id, b.id))?.daten.auswahl.module).toEqual(['modul-kostenrechner']);
  });
});
