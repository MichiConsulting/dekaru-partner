import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Db } from '../src/lib/db.ts';
import { neueDb, vertriebler } from './helfer.ts';
import {
  bewerteUebung,
  feldname,
  filtereEintraege,
  lueckenAufgabe,
  lueckenPositionen,
  mitName,
  modusFuerVersuch,
  pflichtsaetze,
  pruefeGespraechsDaten,
  reihenfolgeAufgabe,
  uebungsAntwortAusFormular,
  type Eintrag,
} from '../src/lib/gespraech.ts';
import { anzahlSitzt, ladeUebungsstand, pflichtsaetzeAller, speichereUebung } from '../src/lib/gespraech-fortschritt.ts';
import { entscheideZugriff } from '../src/lib/zugriff.ts';
import type { Benutzer } from '../src/lib/auth.ts';

const ECHT = JSON.parse(readFileSync(new URL('../../inhalt/gespraechshilfe.json', import.meta.url), 'utf8'));

const SATZ = 'Jede Website beginnt bei 600 €. Was Ihre kostet, steht im Angebot, als Festpreis.';
const UEBUNG = {
  luecken: ['600 €', 'Angebot', 'Festpreis'],
  teile: ['Jede Website', 'beginnt bei 600 €.', 'Was Ihre kostet,', 'steht im Angebot,', 'als Festpreis.'],
};

const DATEN = {
  einleitung: 'Sechs Sätze.',
  eintraege: [
    { id: 'p1', thema: 'Preis', frage: 'Was kostet das?', antwort: SATZ, pflicht: true, uebung: UEBUNG },
    { id: 'a1', thema: 'Ablauf', frage: 'Wie geht es weiter?', antwort: 'Wir schauen die Vorschau zusammen an.', pflicht: false, hinweis: 'Nur im Termin.' },
    { id: 'h1', thema: 'Hosting', frage: 'Backups?', antwort: 'Gesicherter Quellstand.', pflicht: false },
    { id: 'x1', thema: 'Sonstiges', frage: 'f', antwort: 'a', pflicht: false },
    { id: 'a1', thema: 'Ablauf', frage: 'doppelt', antwort: 'a', pflicht: false },
    { id: 'p2', thema: 'Preis', frage: 'f', antwort: 'Ohne Uebung.', pflicht: true },
    { id: 'p3', thema: 'Preis', frage: 'f', antwort: 'Teile passen nicht.', pflicht: true, uebung: { luecken: ['Teile'], teile: ['Teile', 'passen', 'falsch.'] } },
    { id: 'p4', thema: 'Preis', frage: 'f', antwort: 'Die Lücke fehlt hier.', pflicht: true, uebung: { luecken: ['Lück'], teile: ['Die Lücke', 'fehlt', 'hier.'] } },
    { id: 'p5', thema: 'Preis', frage: 'f', antwort: '', pflicht: false },
  ],
};

function form(werte: Record<string, string>) {
  return { get: (name: string) => werte[name] ?? null };
}

describe('Gespraechshilfe: Format', () => {
  it('nimmt gueltige Eintraege und meldet die anderen', () => {
    const { daten, fehler } = pruefeGespraechsDaten(DATEN);
    expect(daten.eintraege.map((e) => e.id)).toEqual(['p1', 'a1', 'h1']);
    expect(daten.einleitung).toBe('Sechs Sätze.');
    expect(fehler.length).toBe(6);
    expect(fehler.join(' ')).toMatch(/thema "Sonstiges" unbekannt/);
    expect(fehler.join(' ')).toMatch(/id doppelt/);
    expect(fehler.join(' ')).toMatch(/ohne uebung.luecken/);
    expect(fehler.join(' ')).toMatch(/ergeben zusammen nicht die antwort/);
    expect(fehler.join(' ')).toMatch(/Luecke kommt im Satz nicht vor/);
    expect(fehler.join(' ')).toMatch(/antwort fehlt/);
  });
  it('verlangt eine Liste', () => {
    expect(pruefeGespraechsDaten({}).fehler.length).toBe(1);
    expect(pruefeGespraechsDaten(null).daten.eintraege).toEqual([]);
  });
  it('liest die echte gespraechshilfe.json ohne Fehler', () => {
    const { daten, fehler } = pruefeGespraechsDaten(ECHT);
    expect(fehler).toEqual([]);
    expect(daten.eintraege.length).toBeGreaterThanOrEqual(30);
    expect(daten.eintraege.length).toBeLessThanOrEqual(40);
    expect(pflichtsaetze(daten.eintraege).length).toBe(6);
    const themen = new Set(daten.eintraege.map((e) => e.thema));
    expect(themen.size).toBe(6);
  });
  it('die sechs Pflichtsaetze haben genau die festgelegten Inhalte', () => {
    const saetze = pflichtsaetze(pruefeGespraechsDaten(ECHT).daten.eintraege).map((e) => e.antwort);
    expect(saetze[0]).toBe(
      'Guten Tag, mein Name ist {{Ihr Name}}, ich rufe für Michael Henning an, er baut Websites für kleine Betriebe. Haben Sie kurz einen Moment?',
    );
    expect(saetze[1]).toBe('Jede Website beginnt bei 600 €. Was Ihre kostet, steht im Angebot, als Festpreis.');
    expect(saetze[2]).toMatch(/^Er fängt gerade an/);
    expect(saetze[2]).toMatch(/Sie sehen Ihre eigene Seite fertig gebaut, bevor Sie sich entscheiden\.$/);
    expect(saetze[3]).toBe('Den Fertigstellungstermin bekommen Sie im Angebot, und der gilt.');
    expect(saetze[4]).toBe('Die Vorschau zeigen wir Ihnen gern im Termin, per Mail verschicken wir sie nicht.');
    expect(saetze[5]).toBe(
      'Buchen Sie das Hosting mit der Website, sind die ersten drei Monate frei, danach läuft es mindestens sechs Monate.',
    );
  });
  it('die Antworten halten die Regeln: kein Ortsbezug, keine Bauzeit, keine Gedankenstriche, dekaru klein', () => {
    const alle = pruefeGespraechsDaten(ECHT).daten.eintraege;
    const texte = alle.flatMap((e) => [e.frage, e.antwort, e.hinweis ?? '']);
    for (const t of texte) {
      expect(t).not.toMatch(/[—–]/);
      expect(t).not.toMatch(/Dekaru/);
    }
    for (const e of alle) {
      expect(e.antwort).not.toMatch(/Horb|Nagold|aus der Gegend|aus der Region|aus Ihrer Nähe|hier aus/i);
      expect(e.antwort).not.toMatch(/\b(ein|zwei|drei|vier|sieben|zehn|\d+)\s+(bis\s+\w+\s+)?(Tage|Wochen)\b/);
      expect(e.antwort).not.toMatch(/\b500\s?€/);
      expect(e.antwort).not.toMatch(/zufriedene Kunden|unsere Kunden/);
    }
  });
  it('setzt den Namen ein', () => {
    expect(mitName('Hallo, {{Ihr Name}} hier.', 'Anna Beispiel')).toBe('Hallo, Anna Beispiel hier.');
    expect(mitName('{{Ihr Name}}', '  ')).toBe('Ihr Name');
  });
});

describe('Gespraechshilfe: Filter', () => {
  const eintraege = pruefeGespraechsDaten(DATEN).daten.eintraege;
  it('filtert nach Thema', () => {
    expect(filtereEintraege(eintraege, { thema: 'Hosting' }).map((e) => e.id)).toEqual(['h1']);
    expect(filtereEintraege(eintraege, { thema: '' }).length).toBe(3);
  });
  it('sucht in Frage, Antwort und Hinweis, ohne Gross- und Kleinschreibung und mit Umlauten', () => {
    expect(filtereEintraege(eintraege, { suche: 'FESTPREIS' }).map((e) => e.id)).toEqual(['p1']);
    expect(filtereEintraege(eintraege, { suche: 'termin' }).map((e) => e.id)).toEqual(['a1']);
    expect(filtereEintraege(eintraege, { suche: 'quellstand' }).map((e) => e.id)).toEqual(['h1']);
    expect(filtereEintraege(eintraege, { suche: 'vorschau zusammen' }).map((e) => e.id)).toEqual(['a1']);
    expect(filtereEintraege(eintraege, { suche: 'gibt es nicht' })).toEqual([]);
  });
  it('kombiniert Thema und Suche', () => {
    expect(filtereEintraege(eintraege, { thema: 'Preis', suche: 'angebot' }).map((e) => e.id)).toEqual(['p1']);
    expect(filtereEintraege(eintraege, { thema: 'Ablauf', suche: 'angebot' })).toEqual([]);
  });
});

describe('Gespraechshilfe: Uebung', () => {
  const satz = SATZ;
  it('findet Luecken nur als ganze Woerter und in Textreihenfolge', () => {
    const p = lueckenPositionen(satz, ['Festpreis', '600 €', 'Angebot'])!;
    expect(p.map((x) => x.loesung)).toEqual(['600 €', 'Angebot', 'Festpreis']);
    expect(lueckenPositionen('Am Freitag ist frei.', ['frei'])![0].start).toBe(15);
    expect(lueckenPositionen(satz, ['Preis'])).toBeNull();
    expect(lueckenPositionen('Angebot Angebot', ['Angebot', 'Angebot'])).toBeNull();
  });
  it('baut den Lueckentext', () => {
    const teile = lueckenAufgabe(satz, UEBUNG.luecken);
    expect(teile.filter((t) => t.art === 'luecke').length).toBe(3);
    const zurueck = teile.map((t) => (t.art === 'text' ? t.text : t.loesung)).join('');
    expect(zurueck).toBe(satz);
  });
  it('mischt die Teile stabil und nie in Originalreihenfolge', () => {
    const a = reihenfolgeAufgabe(UEBUNG.teile, 'g02-0');
    expect(a).toEqual(reihenfolgeAufgabe(UEBUNG.teile, 'g02-0'));
    expect([...a].sort()).toEqual([...UEBUNG.teile].sort());
    expect(a).not.toEqual(UEBUNG.teile);
    for (let i = 0; i < 50; i += 1) expect(reihenfolgeAufgabe(['a', 'b'], `s${i}`)).toEqual(['b', 'a']);
  });
  it('bewertet den Lueckentext grosszuegig bei Schreibweise, streng beim Inhalt', () => {
    const antwort = uebungsAntwortAusFormular('luecken', 3, form({ l_0: '600', l_1: ' angebot ', l_2: 'Festpreis.' }));
    expect(bewerteUebung('luecken', satz, UEBUNG, [], antwort)).toEqual({ richtig: true, teile: [true, true, true] });
    const falsch = uebungsAntwortAusFormular('luecken', 3, form({ l_0: '500 €', l_1: 'Angebot', l_2: '' }));
    expect(bewerteUebung('luecken', satz, UEBUNG, [], falsch)).toEqual({ richtig: false, teile: [false, true, false] });
  });
  it('bewertet die Reihenfolge und erkennt doppelte oder fehlende Positionen', () => {
    const gemischt = reihenfolgeAufgabe(UEBUNG.teile, 'x');
    const werte: Record<string, string> = {};
    gemischt.forEach((t, i) => {
      werte[feldname('reihenfolge', i)] = String(UEBUNG.teile.indexOf(t) + 1);
    });
    const richtig = uebungsAntwortAusFormular('reihenfolge', gemischt.length, form(werte));
    expect(bewerteUebung('reihenfolge', satz, UEBUNG, gemischt, richtig).richtig).toBe(true);

    const doppelt = { ...werte, r_0: werte.r_1 };
    const b = bewerteUebung('reihenfolge', satz, UEBUNG, gemischt, uebungsAntwortAusFormular('reihenfolge', 5, form(doppelt)));
    expect(b.richtig).toBe(false);
    expect(b.teile.filter(Boolean).length).toBeLessThan(5);

    const leer = bewerteUebung('reihenfolge', satz, UEBUNG, gemischt, uebungsAntwortAusFormular('reihenfolge', 5, form({})));
    expect(leer).toEqual({ richtig: false, teile: [false, false, false, false, false] });
  });
  it('wechselt den Modus mit jedem Versuch', () => {
    expect(modusFuerVersuch(0)).toBe('luecken');
    expect(modusFuerVersuch(1)).toBe('reihenfolge');
    expect(modusFuerVersuch(2)).toBe('luecken');
  });
});

describe('Gespraechshilfe: Fortschritt', () => {
  let db: Db;
  let anna: Benutzer;
  let ben: Benutzer;
  beforeAll(async () => {
    db = await neueDb();
    anna = await vertriebler(db, 'Anna');
    ben = await vertriebler(db, 'Ben');
  });
  afterAll(() => db.close());

  it('die Migration 002 ist angewendet', async () => {
    const zeilen = await db.query<{ version: number }>('SELECT version FROM schema_version ORDER BY version');
    expect(zeilen.map((z) => Number(z.version))).toContain(2);
  });
  it('speichert je Satz den letzten Versuch, zaehlt Versuche und merkt sich, ob er je richtig war', async () => {
    await speichereUebung(db, anna.id, 'g01', 'luecken', true, { typ: 'luecken', eingaben: ['a'] });
    await speichereUebung(db, anna.id, 'g02', 'luecken', false, { typ: 'luecken', eingaben: ['b'] });
    await speichereUebung(db, anna.id, 'g02', 'reihenfolge', true, { typ: 'reihenfolge', reihenfolge: [1, 0] });
    await speichereUebung(db, anna.id, 'g02', 'luecken', false, { typ: 'luecken', eingaben: ['c'] });
    const stand = await ladeUebungsstand(db, anna.id);
    expect(stand.get('g01')?.sitzt).toBe(true);
    expect(stand.get('g02')?.sitzt).toBe(false);
    expect(stand.get('g02')?.jeRichtig).toBe(true);
    expect(stand.get('g02')?.versuche).toBe(3);
    expect(stand.get('g02')?.modus).toBe('luecken');
    expect(stand.get('g02')?.antwort).toEqual({ typ: 'luecken', eingaben: ['c'] });
    expect(anzahlSitzt(stand, ['g01', 'g02', 'g03'])).toBe(1);
  });
  it('trennt die Vertriebler und zaehlt fuer den Admin nur die genannten Saetze', async () => {
    await speichereUebung(db, ben.id, 'g01', 'luecken', true, { typ: 'luecken', eingaben: [] });
    await speichereUebung(db, ben.id, 'g09', 'luecken', true, { typ: 'luecken', eingaben: [] });
    expect((await ladeUebungsstand(db, ben.id)).size).toBe(2);
    const alle = await pflichtsaetzeAller(db, ['g01', 'g02', 'g03']);
    expect(alle.get(anna.id)).toBe(1);
    expect(alle.get(ben.id)).toBe(1);
    expect(await pflichtsaetzeAller(db, [])).toEqual(new Map());
  });
});

describe('Gespraechshilfe: Zugriff', () => {
  const v: Benutzer = { id: '1', email: 'v@example.test', name: 'V', rolle: 'vertriebler', vertrieblerSlug: null, passwortWechselNoetig: false, aktiv: true };
  const admin: Benutzer = { ...v, id: '2', rolle: 'admin' };
  it('verlangt eine Anmeldung', () => {
    expect(entscheideZugriff('/gespraech', null)).toEqual({ typ: 'login' });
    expect(entscheideZugriff('/gespraech/ueben', null)).toEqual({ typ: 'login' });
    expect(entscheideZugriff('/gespraech/ueben/1', null)).toEqual({ typ: 'login' });
  });
  it('laesst Vertriebler und Admin zu', () => {
    expect(entscheideZugriff('/gespraech', v)).toEqual({ typ: 'ok' });
    expect(entscheideZugriff('/gespraech/ueben/3', v)).toEqual({ typ: 'ok' });
    expect(entscheideZugriff('/gespraech', admin)).toEqual({ typ: 'ok' });
  });
  it('sperrt deaktivierte Zugaenge und erzwingt den Passwortwechsel', () => {
    expect(entscheideZugriff('/gespraech', { ...v, aktiv: false })).toEqual({ typ: 'login' });
    expect(entscheideZugriff('/gespraech', { ...v, passwortWechselNoetig: true })).toEqual({ typ: 'passwort' });
  });
});

// Typpruefung: Eintrag bleibt exportiert und nutzbar.
const _typ: Eintrag | undefined = undefined;
void _typ;
