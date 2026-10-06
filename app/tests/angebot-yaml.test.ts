// Die Angebots-Eingabe aus dem Bogen muss das Angebotssystem in
// dekaru-rechnungen lesen koennen. Liegt das Repo neben diesem (oder unter
// ~/dekaru), wird die Datei mit dessen YAML-Parser und dessen Paketlogik
// (lib/angebot-pakete.mjs) geprueft. Sonst nur die Form.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dekaruWurzel } from '../scripts/preise-sync.mjs';
import { erzeugeAngebotYaml, kundenSlug, yamlText } from '../src/lib/angebot-yaml.ts';
import { pruefeBriefing, type Briefing } from '../src/lib/briefing.ts';

const RECHNUNGEN = join(dekaruWurzel(), 'dekaru-rechnungen');
const rechnungenDa = existsSync(join(RECHNUNGEN, 'lib', 'angebot-pakete.mjs')) && existsSync(join(RECHNUNGEN, 'node_modules', 'yaml'));

function bogen(felder: Record<string, string>, status: Briefing['status'] = 'eingereicht'): Briefing {
  const { daten } = pruefeBriefing(felder);
  return {
    id: '00000000-0000-4000-8000-000000000001',
    benutzerId: 'b',
    kundeId: 'k',
    kundeName: felder.firmenname ?? 'Kunde',
    status,
    daten,
    farbpalette: null,
    erstelltAm: new Date('2026-10-01T09:00:00Z'),
    geaendertAm: new Date('2026-10-04T09:00:00Z'),
    eingereichtAm: new Date('2026-10-04T09:00:00Z'),
    uebernommenAm: null,
  };
}

const KONTEXT = { vertrieblerName: 'Anna Beispiel', vertrieblerSlug: 'anna', heute: '2026-10-05' };

const GROSS = {
  firmenname: 'Musterbäckerei Wagner',
  rechtsform: 'e. K.',
  unterzeichner: 'Frau Andrea Wagner',
  strasse: 'Beispielweg 4',
  plz: '72160',
  ort: 'Horb am Neckar',
  email: 'kontakt@example.de',
  branche: 'Gastronomie',
  paket: 'gross',
  b_unterseite: '2',
  b_newsletter: 'on',
  b_individuell: 'on',
  individuell_beschreibung: 'Rezeptsuche mit "Filter"',
  'z_gbp-einrichtung': 'on',
  hosting: 'plus',
  zahlweise: 'monatlich',
  gratisquartal: 'on',
  zulieferung_bis: '2026-11-01',
  anlass: 'Eröffnung: 1. Dezember',
  fotos: 'kunde',
  fotorechte: 'on',
  logo: 'keins',
  kontaktformular: 'on',
  gesundheitsdaten: 'on',
  referenz: 'nein',
  domain: 'musterbaeckerei.de',
  sonderwuensche: 'Hausfarbe Dunkelgrün\nRezepte als PDF',
  zusagen: 'Drei Monate Hosting frei.',
};

describe('Angebots-YAML', () => {
  it('bildet Slug und Text sicher', () => {
    expect(kundenSlug('Musterbäckerei Wagner')).toBe('musterbaeckerei-wagner');
    expect(kundenSlug('Café Müller & Söhne GmbH')).toBe('cafe-mueller-soehne-gmbh');
    expect(kundenSlug('   ')).toBe('kunde');
    expect(yamlText('Rezeptsuche mit "Filter"\nZeile 2')).toBe('"Rezeptsuche mit \\"Filter\\" Zeile 2"');
  });

  it('schreibt Paket, Bausteine, Zusatzleistung und Hosting im Format der Angebots-Eingabe', () => {
    const y = erzeugeAngebotYaml(bogen(GROSS), KONTEXT);
    expect(y.dateiname).toBe('2026-10-05-musterbaeckerei-wagner.yaml');
    expect(y.slug).toBe('musterbaeckerei-wagner');
    const t = y.inhalt;
    expect(t).toMatch(/^kunde: musterbaeckerei-wagner$/m);
    expect(t).toMatch(/^angebotsdatum: 2026-10-05$/m);
    expect(t).toMatch(/^paket: gross$/m);
    expect(t).toMatch(/^  unterseite: 2$/m);
    expect(t).toMatch(/^  newsletter: true$/m);
    // Das individuelle Feature hat keinen Preis: nur als Kommentar, damit das Script nicht abbricht.
    expect(t).toMatch(/^  # individuell: \{ preis: 0, beschreibung: "Rezeptsuche mit \\"Filter\\"" \}$/m);
    expect(t).not.toMatch(/^  individuell:/m);
    // Zusatzleistung als freie Position mit Preis aus preise.json.
    expect(t).toMatch(/beschreibung: "Google-Unternehmensprofil einrichten"\n    menge: 1\n    einheit: "Pauschale"\n    einzelpreis: 249\.00/);
    // Plus gibt es nur jaehrlich.
    expect(t).toMatch(/Hosting Plus, Betrieb und Pflege, Jahresvertrag/);
    expect(t).toMatch(/einheit: "Jahr"\n    einzelpreis: 590\.00/);
    // Kundendatei und Zuordnung als Kommentar, die Zahlweise korrigiert.
    expect(t).toMatch(/"hostingTarif": "plus"/);
    expect(t).toMatch(/"hostingZahlweise": "jaehrlich"/);
    expect(t).toMatch(/"gratisquartal": true/);
    expect(t).toMatch(/"vertriebler":"anna"/);
    // Werkvertrag und AVV.
    expect(t).toMatch(/# Referenznennung: nein, Kunde widerspricht/);
    expect(t).toMatch(/Gesundheitsdaten \(Art\. 9 DSGVO\): ja/);
    expect(t).toMatch(/# Sonderwünsche:\n#   Hausfarbe Dunkelgrün\n#   Rezepte als PDF/);
    expect(t).toMatch(/# fertigstellung: JJJJ-MM-TT/);
    expect(t).toMatch(/^anzahlungProzent: 50$/m);
    // Keine Zeile ohne Raute, die das Angebotssystem nicht kennt.
    const schluessel = t
      .split('\n')
      .filter((z) => /^[a-zA-Z]/.test(z))
      .map((z) => z.split(':')[0]);
    expect(new Set(schluessel)).toEqual(new Set(['kunde', 'angebotsdatum', 'gueltigTage', 'betreff', 'anschreiben', 'paket', 'bausteine', 'positionen', 'optionen', 'nichtEnthalten', 'anzahlungProzent', 'auftragsfeld']));
  });

  it('ohne Hosting und ohne Bausteine bleibt die Datei gueltig', () => {
    const t = erzeugeAngebotYaml(bogen({ ...GROSS, paket: 'klein', b_unterseite: '', b_newsletter: '', b_individuell: '', 'z_gbp-einrichtung': '', hosting: 'keins' }), KONTEXT).inhalt;
    expect(t).toMatch(/^bausteine: \{\}$/m);
    expect(t).not.toMatch(/^optionen:/m);
    expect(t).not.toMatch(/^positionen:/m);
    expect(t).toMatch(/# Kein Hosting/);
    expect(t).toMatch(/"hostingTarif": null/);
  });

  it('schreibt ein Software-Modul als freie Position mit Preis aus dem Sync', () => {
    const t = erzeugeAngebotYaml(bogen({ ...GROSS, branche: 'Umzug', 'm_modul-kostenrechner': 'on', 'z_gbp-einrichtung': '' }), KONTEXT).inhalt;
    expect(t).toMatch(/^positionen:$/m);
    expect(t).toMatch(/# Software-Modul modul-kostenrechner \(leistungen\.module\), Stufe klein/);
    expect(t).toMatch(/beschreibung: "Software-Modul: Kostenrechner für Ihre Kunden, einmalig, Einrichtung inklusive"\n    menge: 1\n    einheit: "Pauschale"\n    einzelpreis: 200\.00/);
    // Ein nicht verkaufbares Modul landet nie als Position im Angebot.
    const b = bogen({ ...GROSS, 'z_gbp-einrichtung': '' });
    b.daten.auswahl.module = ['modul-terminbuchung'];
    const t2 = erzeugeAngebotYaml(b, KONTEXT).inhalt;
    expect(t2).not.toMatch(/^positionen:/m);
    expect(t2).toMatch(/# Modul modul-terminbuchung ist zurzeit nicht verkaufbar/);
  });

  it('lehnt einen Bogen ohne Paket ab', () => {
    const b = bogen(GROSS);
    b.daten.auswahl.paket = 'riesig' as never;
    expect(() => erzeugeAngebotYaml(b, KONTEXT)).toThrow(/Paket/);
  });

  it.skipIf(!rechnungenDa)('wird vom Angebotssystem in dekaru-rechnungen gelesen und zu Positionen gebaut', async () => {
    const { parse } = (await import(pathToFileURL(join(RECHNUNGEN, 'node_modules', 'yaml', 'dist', 'index.js')).href)) as { parse: (t: string) => Record<string, unknown> };
    const { bauePaketPositionen } = (await import(pathToFileURL(join(RECHNUNGEN, 'lib', 'angebot-pakete.mjs')).href)) as {
      bauePaketPositionen: (eingabe: unknown, komponenten: unknown) => { paket: string; paketName: string; funktion: string | null; positionen: { beschreibung: string; menge: number; einzelpreis: number }[] };
    };
    const komponenten = JSON.parse(readFileSync(join(RECHNUNGEN, 'preise.json'), 'utf8')).komponenten;

    const daten = parse(erzeugeAngebotYaml(bogen(GROSS), KONTEXT).inhalt);
    expect(daten.kunde).toBe('musterbaeckerei-wagner');
    expect(daten.angebotsdatum).toBe('2026-10-05');
    expect(daten.auftragsfeld).toBe(true);
    const aus = bauePaketPositionen(daten, komponenten);
    expect(aus.paket).toBe('gross');
    expect(aus.funktion).toBe('Online-Terminanfrage');
    expect(aus.positionen.map((p) => [p.menge, p.einzelpreis])).toEqual([
      [1, 1600],
      [2, 75],
      [1, 150],
    ]);
    // Was das Paket enthaelt, laesst das Angebotssystem nicht noch einmal zu. Der Bogen filtert das vorher.
    const mittel = parse(erzeugeAngebotYaml(bogen({ ...GROSS, paket: 'mittel', b_galerie: 'on', b_team: 'on' }), KONTEXT).inhalt);
    expect(() => bauePaketPositionen(mittel, komponenten)).not.toThrow();
    expect(bauePaketPositionen(mittel, komponenten).positionen.map((p) => p.beschreibung)).toContain('Team-Seite');
    // Mit Modul: die freie Position liest der Parser mit Preis.
    const mitModul = parse(erzeugeAngebotYaml(bogen({ ...GROSS, branche: 'Umzug', 'm_modul-kostenrechner': 'on' }), KONTEXT).inhalt) as { positionen: { beschreibung: string; einzelpreis: number }[] };
    expect(mitModul.positionen.map((p) => p.einzelpreis)).toEqual([249, 200]);
  });
});
