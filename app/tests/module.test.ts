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

  it('heute sind die zehn gebauten Module verkaufbar, mit Preis nach Stufe und 35 % Provision', () => {
    expect(VERKAUFBARE_MODULE.map((m) => [m.schluessel, m.preis, m.provision])).toEqual([
      ['modul-kostenrechner', 200, 70],
      ['modul-beitrags-schreiber', 200, 70],
      ['modul-bewertungs-assistent', 200, 70],
      ['modul-speisekarte', 300, 105],
      ['modul-angebots-assistent', 300, 105],
      ['modul-anfrage-fotos', 300, 105],
      ['modul-lagerliste', 300, 105],
      ['modul-terminbuchung', 400, 140],
      ['modul-tischreservierung', 400, 140],
      ['modul-schichtplan', 400, 140],
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
    // Nur die Werkbank hat eine PIN. Lagerliste und Schichtplan laufen in einer Google-Tabelle.
    for (const m of VERKAUFBARE_MODULE.filter((x) => x.art === 'inhaber' && !['modul-lagerliste', 'modul-schichtplan'].includes(x.schluessel))) {
      expect(m.voraussetzungen.join(' '), m.schluessel).toMatch(/PIN mit mindestens 8 Zeichen/);
      expect(m.laufend, m.schluessel).toMatch(/Sicherung/);
    }
  });

  it('Terminbuchung und Tischreservierung: Weiterentwicklung der Anfrage, die im Paket Groß enthalten bleibt', () => {
    const t = VERKAUFBARE_MODULE.find((m) => m.schluessel === 'modul-terminbuchung')!;
    const r = VERKAUFBARE_MODULE.find((m) => m.schluessel === 'modul-tischreservierung')!;
    expect(t.art).toBe('besucher');
    expect(r.art).toBe('besucher');
    expect(t.einleitung).toMatch(/Im Paket Groß ist die Online-Terminanfrage schon enthalten/);
    expect(r.einleitung).toMatch(/Im Paket Groß ist die Online-Tischanfrage schon enthalten/);
    for (const m of [t, r]) {
      expect(m.einleitung, m.schluessel).toMatch(/an die Stelle der Anfrage/);
      expect(m.fragen[0].frage, m.schluessel).toMatch(/im Paket Groß schon dabei/);
      expect(m.fragen[0].antwort, m.schluessel).toMatch(/bleibt im Paket Groß enthalten/);
      expect(m.intern.join(' '), m.schluessel).toMatch(/mitarbeitende Funktion und bleibt im Paket Groß enthalten/);
      // Workspace ist hier Empfehlung, mit der ehrlichen Mailgrenze von Gmail.
      expect(m.voraussetzungen.join(' '), m.schluessel).toMatch(/Empfohlen ist Google Workspace/);
      expect(m.voraussetzungen.join(' '), m.schluessel).toMatch(/Gmail/);
    }
    // Praxen: Buchung ohne Freitext, Schweigepflicht klaert Michael Henning.
    expect(t.schemaBranchen).toContain('praxis');
    expect(t.intern.join(' ')).toMatch(/Schweigepflicht/);
    expect(t.intern.join(' ')).toMatch(/ohne Freitext/);
    // Kein Feld fuer Allergien, das waeren Gesundheitsdaten.
    expect(r.kannNicht.join(' ')).toMatch(/Kein Feld für Allergien/);
    expect(r.schemaBranchen).toEqual(['gastro']);
  });

  it('Schichtplan: Werkzeug fuer den Betrieb, Workspace fuers Team, keine Gruende, keine Rechtsberatung', () => {
    const s = VERKAUFBARE_MODULE.find((m) => m.schluessel === 'modul-schichtplan')!;
    expect(s.art).toBe('inhaber');
    expect(s.voraussetzungen.join(' ')).toMatch(/Google Workspace/);
    expect(s.kannNicht.join(' ')).toMatch(/Keine Rechtsberatung/);
    expect(s.kannNicht.join(' ')).toMatch(/Keine Zeiterfassung/);
    expect(s.kannNicht.join(' ')).toMatch(/Keine Gründe und keine Krankmeldungen/);
    expect(s.intern.join(' ')).toMatch(/Betriebsrat/);
    expect(s.schemaBranchen).not.toContain('praxis');
  });

  it('die drei grossen Module muessen vor dem ersten Verkauf einmal echt laufen', () => {
    for (const k of ['modul-terminbuchung', 'modul-tischreservierung', 'modul-schichtplan']) {
      expect(VERKAUFBARE_MODULE.find((m) => m.schluessel === k)!.intern.join(' '), k).toMatch(/vor dem ersten Verkauf einmal echt/);
    }
  });

  it('nennt soGehts-Fehler: genau drei kurze Schritte, ohne Preis', () => {
    const zwei = pruefeModulTexte({ module: [{ ...texteRoh.module[0], soGehts: ['a', 'b'] }] });
    expect(zwei.fehler.join(' ')).toMatch(/genau 3 Schritte/);
    const preis = pruefeModulTexte({ module: [{ ...texteRoh.module[0], soGehts: ['a', 'b', 'Kostet 200 €'] }] });
    expect(preis.fehler.join(' ')).toMatch(/kein Preis/);
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
    const a = auswahlAusFeldern({ 'm_modul-kostenrechner': 'on', 'm_modul-reel-werkstatt': 'on' });
    expect(a.module).toEqual(['modul-kostenrechner']);
  });

  it('rechnet Module ins Einmalige und in die Provision', () => {
    const ohne = berechne(leereAuswahl('gross'));
    const mit = berechne({ ...leereAuswahl('gross'), module: ['modul-kostenrechner', 'modul-kostenrechner', 'modul-reel-werkstatt'] });
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

describe('Module im Schema: in jeder Branche, Empfehlung zuerst', () => {
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

  it('heute: alle zehn Module in jeder Branche, Empfehlung nach Branche', () => {
    const erwartet: Record<string, string[]> = {
      handwerk: ['modul-kostenrechner', 'modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-angebots-assistent', 'modul-anfrage-fotos', 'modul-lagerliste'],
      gastro: ['modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-speisekarte', 'modul-tischreservierung', 'modul-schichtplan'],
      friseur: ['modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-speisekarte', 'modul-terminbuchung', 'modul-schichtplan'],
      praxis: ['modul-terminbuchung'],
      umzug: ['modul-kostenrechner', 'modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-anfrage-fotos'],
      reinigung: ['modul-kostenrechner', 'modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-anfrage-fotos'],
      garten: ['modul-kostenrechner', 'modul-beitrags-schreiber', 'modul-bewertungs-assistent', 'modul-angebots-assistent', 'modul-anfrage-fotos', 'modul-lagerliste'],
    };
    for (const b of BRANCHEN_IDS) {
      const r = moduleFuerSchema(b);
      expect(r.empfohlen.map((m) => m.schluessel), b).toEqual(erwartet[b]);
      expect([...r.empfohlen, ...r.weitere].length, b).toBe(10);
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
