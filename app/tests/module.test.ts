// Software-Module: Sync aus dekaru-rechnungen, Texte, Verkaufshilfen.
//
// src/data/module.json ist abgeleitet, nie Quelle. Weicht sie von
// dekaru-rechnungen/preise.json ab: npm run module-sync. Fehlt das Repo
// (Vercel, fremder Rechner), wird nur die Struktur geprueft.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leseQuelle, leseZiel, quelleVorhanden, stimmtUeberein } from '../scripts/module-sync.mjs';
import moduleDaten from '../src/data/module.json';
import texteRoh from '../../inhalt/module.json';
import hilfenRoh from '../../inhalt/verkaufshilfen.json';
import { MODULE, MODULE_NUR_MIT, MODULE_PAKETE, PAKETE, auswahlAusFeldern, berechne, findeModul, leereAuswahl, moduleMoeglich } from '../src/lib/preise.ts';
import {
  MODUL_FEHLER,
  VERKAUFBARE_MODULE,
  ZWEITTERMIN,
  MODULE_GRUPPIEREN_AB,
  fuehreZusammen,
  kurzSchluessel,
  moduleAusAdresse,
  moduleFuerAdresse,
  moduleFuerSchema,
  pruefeModulTexte,
  pruefeVerkaufshilfen,
  textFehler,
} from '../src/lib/module.ts';
import { modulAbschnitte } from '../src/lib/schema-module.ts';
import { BRIEFING_ZU_TEMPLATE } from '../src/lib/paletten.ts';
import { BRANCHEN_IDS, type BrancheId } from '../src/lib/schema.ts';

function quelleMit(module: unknown[]): string {
  const ordner = mkdtempSync(join(tmpdir(), 'module-sync-'));
  const pfad = join(ordner, 'preise.json');
  writeFileSync(pfad, JSON.stringify({ leistungen: { module, regeln: { module: 'Regel' } } }));
  return pfad;
}

describe('module.json Sync', () => {
  it('ist als abgeleitet gekennzeichnet und enthaelt nur die noetigen Felder', () => {
    expect(moduleDaten._hinweis).toMatch(/Nicht von Hand aendern/);
    expect(moduleDaten.erzeugt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const m of moduleDaten.module) expect(Object.keys(m).sort()).toEqual(['einheit', 'preis', 'schluessel', 'stufe']);
  });

  it.skipIf(!quelleVorhanden())('stimmt mit dekaru-rechnungen ueberein', () => {
    expect(stimmtUeberein(leseQuelle(), leseZiel()), 'src/data/module.json weicht ab. Bitte npm run module-sync ausfuehren und die Datei committen.').toBe(true);
  });

  it('uebernimmt nur verkaufbare Module, ohne Namen und Nutzen', () => {
    const pfad = quelleMit([
      { schluessel: 'modul-a', name: 'A fuer Sie', preis: 200, einheit: 'einmalig', stufe: 'klein', verkaufbar: true, nutzen: 'x' },
      { schluessel: 'modul-b', name: 'B', preis: 300, einheit: 'einmalig', stufe: 'mittel', verkaufbar: false, noch_nicht_weil: 'Noch nicht gebaut' },
    ]);
    const q = leseQuelle(pfad);
    expect(q.module).toEqual([{ schluessel: 'modul-a', preis: 200, einheit: 'einmalig', stufe: 'klein' }]);
    expect(JSON.stringify(q)).not.toContain('modul-b');
    expect(JSON.stringify(q)).not.toContain('fuer Sie');
  });

  it('bricht bei unplausibler Quelle ab', () => {
    expect(() => leseQuelle(quelleMit([{ schluessel: 'modul-a', preis: 0, einheit: 'einmalig', stufe: 'klein', verkaufbar: true }]))).toThrow(/keinen Preis/);
    expect(() => leseQuelle(quelleMit([{ schluessel: 'modul-a', preis: 200, einheit: 'einmalig', stufe: 'riesig', verkaufbar: true }]))).toThrow(/Stufe/);
    expect(() => leseQuelle(quelleMit([{ schluessel: 'modul-a', preis: 200, einheit: 'einmalig', stufe: 'klein' }]))).toThrow(/verkaufbar/);
    expect(() => leseQuelle(quelleMit([{ schluessel: 'a', preis: 200, einheit: 'einmalig', stufe: 'klein', verkaufbar: true }]))).toThrow(/Schluessel/);
  });

  it('erkennt eine Abweichung, aber nicht den Zeitstempel', () => {
    const ziel = leseZiel();
    expect(stimmtUeberein({ ...ziel, module: [] }, ziel)).toBe(ziel.module.length === 0);
    expect(stimmtUeberein({ ...ziel, erzeugt: '1999-01-01' }, ziel)).toBe(true);
  });
});

describe('Module im Portal', () => {
  it('jedes verkaufbare Modul hat Text und Verkaufshilfe, die Inhalte sind fehlerfrei', () => {
    expect(MODUL_FEHLER).toEqual([]);
    expect(VERKAUFBARE_MODULE.map((m) => m.schluessel)).toEqual(moduleDaten.module.map((m) => m.schluessel));
    expect(MODULE.map((m) => m.schluessel)).toEqual(moduleDaten.module.map((m) => m.schluessel));
    expect(ZWEITTERMIN?.schritte.length).toBeGreaterThanOrEqual(2);
  });

  it('heute sind die sieben gebauten Module verkaufbar, mit Preis nach Stufe und 35 % Provision', () => {
    expect(VERKAUFBARE_MODULE.map((m) => [m.schluessel, m.preis, m.provision])).toEqual([
      ['modul-kostenrechner', 200, 70],
      ['modul-beitrags-schreiber', 200, 70],
      ['modul-bewertungs-assistent', 200, 70],
      ['modul-speisekarte', 300, 105],
      ['modul-angebots-assistent', 300, 105],
      ['modul-anfrage-fotos', 300, 105],
      ['modul-lagerliste', 300, 105],
    ]);
    const k = VERKAUFBARE_MODULE[0];
    expect(k.name).toBe('Kostenrechner für Ihre Kunden');
    expect(k.schemaBranchen).toEqual(['handwerk', 'umzug', 'reinigung', 'garten']);
    // Bauen laesst er sich seit dem Branch module-alle-branchen in dekaru-templates in allen zehn Vorlagen.
    expect(k.briefingBranchen.sort()).toEqual(Object.keys(BRIEFING_ZU_TEMPLATE).sort());
    expect(k.empfohlenFuer).toEqual(['Handwerk', 'Umzug', 'Reinigung', 'Garten- und Landschaftsbau']);
    // Jedes Modul hat genau drei Schritte fuer "So funktioniert es".
    for (const m of VERKAUFBARE_MODULE) expect(m.soGehts, m.schluessel).toHaveLength(3);
  });

  it('Anfrage mit Fotos: nie fuer Praxen empfohlen, Gesundheitsfotos ausgeschlossen, Workspace Pflicht', () => {
    const f = VERKAUFBARE_MODULE.find((m) => m.schluessel === 'modul-anfrage-fotos')!;
    expect(f.schemaBranchen).not.toContain('praxis');
    expect(f.templates).not.toContain('gesundheit');
    expect(f.kannNicht.join(' ')).toMatch(/Gesundheitsdaten/);
    expect(f.voraussetzungen.join(' ')).toMatch(/Google Workspace/);
    expect(f.intern.join(' ')).toMatch(/Praxen: nicht anbieten/);
    const lager = VERKAUFBARE_MODULE.find((m) => m.schluessel === 'modul-lagerliste')!;
    expect(lager.voraussetzungen.join(' ')).toMatch(/Google Workspace/);
    // Praxen bekommen keine Empfehlung fuer Module mit Fotos von Kunden oder Antworten an Patienten.
    for (const s of ['modul-anfrage-fotos', 'modul-bewertungs-assistent', 'modul-beitrags-schreiber']) {
      expect(VERKAUFBARE_MODULE.find((m) => m.schluessel === s)!.schemaBranchen, s).not.toContain('praxis');
    }
  });

  it('Werkzeuge fuer den Inhaber nennen PIN und Sicherung ehrlich', () => {
    for (const m of VERKAUFBARE_MODULE.filter((x) => x.art === 'inhaber' && x.schluessel !== 'modul-lagerliste')) {
      expect(m.voraussetzungen.join(' '), m.schluessel).toMatch(/PIN mit mindestens 8 Zeichen/);
      expect(m.laufend, m.schluessel).toMatch(/Sicherung/);
    }
  });

  it('nennt soGehts-Fehler: genau drei kurze Schritte, ohne Preis', () => {
    const zwei = pruefeModulTexte({ module: [{ ...texteRoh.module[0], soGehts: ['a', 'b'] }] });
    expect(zwei.fehler.join(' ')).toMatch(/genau 3 Schritte/);
    const preis = pruefeModulTexte({ module: [{ ...texteRoh.module[0], soGehts: ['a', 'b', 'Kostet 200 €'] }] });
    expect(preis.fehler.join(' ')).toMatch(/kein Preis/);
  });

  const basis = VERKAUFBARE_MODULE[0];
  const testModul = (schluessel: string, art: 'besucher' | 'inhaber', schemaBranchen: BrancheId[]) => ({ ...basis, schluessel, name: schluessel, art, schemaBranchen });

  it('zeigt jedes verkaufbare Modul in jeder Branche, die empfohlenen zuerst', () => {
    const daten = [testModul('modul-a', 'besucher', ['gastro']), testModul('modul-b', 'inhaber', ['handwerk']), testModul('modul-c', 'besucher', [])];
    for (const b of BRANCHEN_IDS) {
      const r = moduleFuerSchema(b, daten);
      expect([...r.empfohlen, ...r.weitere].map((m) => m.schluessel).sort(), b).toEqual(['modul-a', 'modul-b', 'modul-c']);
    }
    expect(moduleFuerSchema('gastro', daten).empfohlen.map((m) => m.schluessel)).toEqual(['modul-a']);
    expect(moduleFuerSchema('handwerk', daten).empfohlen.map((m) => m.schluessel)).toEqual(['modul-b']);
    expect(moduleFuerSchema('praxis', daten).empfohlen).toEqual([]);
    expect(moduleFuerSchema('gastro', daten).weitere.map((m) => m.kurz)).toEqual(['b', 'c']);
  });

  it('heute: alle sieben Module in jeder Branche, Empfehlung nach Branche', () => {
    const erwartet: Record<string, string[]> = {
      handwerk: ['modul-kostenrechner', 'modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-angebots-assistent', 'modul-anfrage-fotos', 'modul-lagerliste'],
      gastro: ['modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-speisekarte'],
      friseur: ['modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-speisekarte'],
      praxis: [],
      umzug: ['modul-kostenrechner', 'modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-anfrage-fotos'],
      reinigung: ['modul-kostenrechner', 'modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-anfrage-fotos'],
      garten: ['modul-kostenrechner', 'modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-angebots-assistent', 'modul-anfrage-fotos', 'modul-lagerliste'],
    };
    for (const b of BRANCHEN_IDS) {
      const r = moduleFuerSchema(b);
      expect(r.empfohlen.map((m) => m.schluessel), b).toEqual(erwartet[b]);
      expect([...r.empfohlen, ...r.weitere].length, b).toBe(7);
    }
  });

  it('gruppiert erst ab vielen Modulen nach Art und zeigt nie einen leeren Abschnitt', () => {
    const wenige = [testModul('modul-a', 'besucher', ['gastro']), testModul('modul-b', 'inhaber', [])];
    expect(modulAbschnitte('gastro', wenige).map((a) => [a.titel, a.gruppen.map((g) => g.titel)])).toEqual([
      ['Passt oft zu Ihrer Branche', ['']],
      ['Weitere Module, in jeder Branche wählbar', ['']],
    ]);
    expect(modulAbschnitte('praxis', wenige).map((a) => a.titel)).toEqual(['In jeder Branche wählbar']);
    const viele = Array.from({ length: MODULE_GRUPPIEREN_AB }, (_, i) => testModul(`modul-${i}`, i % 2 ? 'inhaber' : 'besucher', i < 2 ? ['gastro'] : []));
    const abschnitte = modulAbschnitte('gastro', viele);
    expect(abschnitte.map((a) => a.titel)).toEqual(['Passt oft zu Ihrer Branche', 'Weitere Module, in jeder Branche wählbar']);
    expect(abschnitte[1].gruppen.map((g) => g.titel)).toEqual(['Für Ihre Kunden auf der Website', 'Werkzeuge für Sie']);
    expect(modulAbschnitte('gastro', [])).toEqual([]);
  });

  it('liest die Merkliste aus der Adresse: nur verkaufbar, ohne Doppelte, feste Reihenfolge', () => {
    expect(moduleAusAdresse('lagerliste,kostenrechner,reel-werkstatt')).toEqual(['modul-kostenrechner', 'modul-lagerliste']);
    expect(moduleAusAdresse('Kostenrechner, kostenrechner,modul-kostenrechner')).toEqual(['modul-kostenrechner']);
    expect(moduleAusAdresse('')).toEqual([]);
    expect(moduleAusAdresse(null)).toEqual([]);
    expect(moduleAusAdresse('<script>')).toEqual([]);
    const daten = [testModul('modul-a', 'besucher', []), testModul('modul-b', 'besucher', [])];
    expect(moduleAusAdresse('b,a', daten)).toEqual(['modul-a', 'modul-b']);
    expect(moduleFuerAdresse(['modul-a', 'modul-b'])).toBe('a,b');
    expect(kurzSchluessel('modul-kostenrechner')).toBe('kostenrechner');
  });

  it('empfiehlt nur Branchen, deren Vorlage in templates steht', () => {
    const kaputt = pruefeModulTexte({ module: [{ ...texteRoh.module[0], schemaBranchen: ['gastro'], templates: ['handwerk'] }] });
    expect(kaputt.texte).toEqual([]);
    expect(kaputt.fehler.join(' ')).toMatch(/empfohlen für gastro, aber dafür fehlt die Vorlage/);
  });
});
