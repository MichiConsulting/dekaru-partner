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
  fuehreZusammen,
  moduleZurBranche,
  pruefeModulTexte,
  pruefeVerkaufshilfen,
  textFehler,
} from '../src/lib/module.ts';

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

  it('heute ist genau der Kostenrechner verkaufbar, fuer 200 Euro mit 70 Euro Provision', () => {
    expect(VERKAUFBARE_MODULE.map((m) => [m.schluessel, m.preis, m.provision])).toEqual([['modul-kostenrechner', 200, 70]]);
    const k = VERKAUFBARE_MODULE[0];
    expect(k.name).toBe('Kostenrechner für Ihre Kunden');
    expect(k.schemaBranchen).toEqual(['handwerk', 'umzug', 'reinigung', 'garten']);
    expect(k.briefingBranchen.sort()).toEqual(['Garten- und Landschaftsbau', 'Handwerk', 'Reinigung', 'Umzug']);
  });

  it('zeigt ein Modul ohne Text nicht an und meldet es', () => {
    const posten = [{ schluessel: 'modul-x', name: 'X', preis: 300, einheit: 'einmalig', stufe: 'mittel' }];
    const r = fuehreZusammen(posten, pruefeModulTexte(texteRoh).texte, pruefeVerkaufshilfen(hilfenRoh).hilfen);
    expect(r.module).toEqual([]);
    expect(r.fehler.join(' ')).toMatch(/modul-x ist verkaufbar/);
  });

  it('zeigt einen vorbereiteten Text ohne Verkaufbarkeit nicht an', () => {
    const texte = pruefeModulTexte({ module: [...texteRoh.module, { ...texteRoh.module[0], schluessel: 'modul-vorbereitet', name: 'Vorbereitet' }] }).texte;
    expect(texte.length).toBe(texteRoh.module.length + 1);
    const r = fuehreZusammen(MODULE, texte, pruefeVerkaufshilfen(hilfenRoh).hilfen);
    expect(r.module.map((m) => m.schluessel)).not.toContain('modul-vorbereitet');
    expect(findeModul('modul-vorbereitet')).toBeNull();
  });

  it('prueft die Texte auf Preise, Gedankenstriche, Bauzeit und "kommt bald"', () => {
    expect(textFehler('Kostet 200 €.', 'x', true).length).toBe(1);
    expect(textFehler('Kostet 200 €.', 'x', false)).toEqual([]);
    expect(textFehler('Schnell — und gut.', 'x').length).toBe(1);
    expect(textFehler('Fertig in zwei Wochen.', 'x').length).toBe(1);
    expect(textFehler('Das kommt bald.', 'x').length).toBe(1);
    expect(textFehler('Dekaru macht das.', 'x').length).toBe(1);
    const kaputt = pruefeModulTexte({ module: [{ ...texteRoh.module[0], kurz: 'Nur 200 € einmalig.' }] });
    expect(kaputt.texte).toEqual([]);
    expect(kaputt.fehler.join(' ')).toMatch(/kein Preis/);
  });

  it('Antworten fuer den Betrieb in den Verkaufshilfen nennen keinen Preis', () => {
    const kaputt = pruefeVerkaufshilfen({
      ...hilfenRoh,
      module: [{ ...hilfenRoh.module[0], fragen: [{ frage: 'Was kostet das?', antwort: 'Genau 200 €.' }] }],
    });
    expect(kaputt.hilfen).toEqual([]);
    expect(kaputt.fehler.join(' ')).toMatch(/kein Preis/);
  });
});

describe('Module im Preisrechner', () => {
  it('liest m_<schluessel> nur fuer verkaufbare Module', () => {
    const a = auswahlAusFeldern({ 'm_modul-kostenrechner': 'on', 'm_modul-terminbuchung': 'on' });
    expect(a.module).toEqual(['modul-kostenrechner']);
  });

  it('rechnet Module ins Einmalige und in die Provision', () => {
    const ohne = berechne(leereAuswahl('gross'));
    const mit = berechne({ ...leereAuswahl('gross'), module: ['modul-kostenrechner', 'modul-kostenrechner', 'modul-terminbuchung'] });
    expect(mit.summeModule).toBe(200);
    expect(mit.summeEinmalig).toBe(ohne.summeEinmalig + 200);
    expect(mit.provisionEinmalig).toBe(ohne.provisionEinmalig + 70);
    expect(mit.zeilen.filter((z) => z.art === 'modul')).toEqual([{ art: 'modul', schluessel: 'modul-kostenrechner', bezeichnung: 'Kostenrechner für Ihre Kunden', betrag: 200 }]);
  });

  it('gibt Module nur zum Paket Groß, wie die mitarbeitende Funktion', () => {
    expect(MODULE_PAKETE).toEqual(['gross']);
    expect(MODULE_PAKETE).toEqual(PAKETE.filter((p) => p.funktion).map((p) => p.schluessel));
    expect(MODULE_NUR_MIT).toBe('nur mit Paket Groß');
    expect(moduleMoeglich('gross')).toBe(true);
    for (const p of ['klein', 'mittel', '', null, undefined, 'quatsch'] as const) expect(moduleMoeglich(p as never)).toBe(false);
  });

  it('rechnet ohne Paket Groß kein Modul mit und sagt das', () => {
    for (const paket of ['klein', 'mittel'] as const) {
      const ohne = berechne(leereAuswahl(paket));
      const mit = berechne({ ...leereAuswahl(paket), module: ['modul-kostenrechner'] });
      expect(mit.summeModule).toBe(0);
      expect(mit.summeEinmalig).toBe(ohne.summeEinmalig);
      expect(mit.provisionEinmalig).toBe(ohne.provisionEinmalig);
      expect(mit.zeilen.some((z) => z.art === 'modul')).toBe(false);
      expect(mit.hinweise).toContain('Software-Module gibt es nur mit Paket Groß. Nicht mitgerechnet: Kostenrechner für Ihre Kunden.');
      expect(ohne.hinweise.join(' ')).not.toMatch(/Software-Module/);
    }
  });

  it('kommt mit alten Briefings ohne Feld module zurecht', () => {
    const alt = { ...leereAuswahl('mittel') } as Partial<ReturnType<typeof leereAuswahl>>;
    delete alt.module;
    expect(berechne(alt as ReturnType<typeof leereAuswahl>).summeModule).toBe(0);
  });
});

describe('Module im Briefing', () => {
  it('meldet ein Modul, das sich fuer die Branche nicht bauen laesst', () => {
    expect(moduleZurBranche('Umzug', ['modul-kostenrechner'])).toEqual([]);
    expect(moduleZurBranche('Handwerk', ['modul-kostenrechner'])).toEqual([]);
    expect(moduleZurBranche('Gastronomie', ['modul-kostenrechner'])[0]).toMatch(/nicht bauen/);
    expect(moduleZurBranche(undefined, ['modul-kostenrechner'])).toEqual([]);
  });
});
