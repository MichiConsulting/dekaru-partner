import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Db } from '../src/lib/db.ts';
import { neueDb, vertriebler } from './helfer.ts';
import { pruefeQuizDaten, type Frage } from '../src/lib/quiz.ts';
import { MAX_KARTEN, MAX_WOERTER_SAETZE, MIN_KARTEN, pruefeLernkarten, zaehleWoerter } from '../src/lib/lernkarten.ts';
import {
  WIEDERHOLEN,
  auswertung,
  beantworteFrage,
  fortschrittProzent,
  ladeDurchlauf,
  starteDurchlauf,
  weiter,
  zustand,
} from '../src/lib/abfrage.ts';
import { falscheFragen, ladeAntworten, ladeKartenStand, markiereGelesen, speichereKartenStand } from '../src/lib/lernen.ts';

const INHALT = fileURLToPath(new URL('../../inhalt/', import.meta.url));

function karte(extra: Record<string, unknown> = {}) {
  return { titel: 'Titel', icon: 'buch', saetze: ['Ein kurzer Satz.'], ...extra };
}

describe('Lernkarten-Format', () => {
  it('nimmt eine gueltige Datei an', () => {
    const { kapitel, fehler } = pruefeLernkarten(
      {
        kapitel: 'k1',
        karten: [
          karte({ grafik: 'test.svg', merke: 'Merke.' }),
          karte({ kennzahl: { wert: '35 %', label: 'Provision' } }),
          karte({ tabelle: { kopf: ['A', 'B'], zeilen: [['1', '2']] }, liste: ['eins', 'zwei'] }),
          karte({ zitat: 'Ein Satz fuer das Gespraech.' }),
        ],
      },
      'k1',
      new Set(['test.svg']),
    );
    expect(fehler).toEqual([]);
    expect(kapitel?.karten.length).toBe(4);
    expect(kapitel?.karten[0].grafik).toBe('test.svg');
  });

  it('meldet zu wenige oder zu viele Karten, lange Saetze, falsche Icons und fehlende Grafiken', () => {
    const wenige = pruefeLernkarten({ kapitel: 'k1', karten: [karte(), karte(), karte()] }, 'k1');
    expect(wenige.kapitel).toBeNull();
    expect(wenige.fehler.join(' ')).toMatch(new RegExp(`${MIN_KARTEN} bis ${MAX_KARTEN}`));

    const viele = pruefeLernkarten({ kapitel: 'k1', karten: Array.from({ length: 9 }, () => karte()) }, 'k1');
    expect(viele.fehler.join(' ')).toMatch(/9 Karten/);

    const lang = 'Wort '.repeat(MAX_WOERTER_SAETZE + 1).trim();
    const r = pruefeLernkarten(
      {
        kapitel: 'k1',
        karten: [
          karte({ saetze: [lang] }),
          karte({ icon: 'einhorn' }),
          karte({ grafik: 'fehlt.svg' }),
          karte({ tabelle: { kopf: ['A', 'B'], zeilen: [['nur eine Zelle']] } }),
        ],
      },
      'k1',
      new Set(),
    );
    expect(r.kapitel).toBeNull();
    expect(r.fehler.join(' ')).toMatch(/41 Wörter/);
    expect(r.fehler.join(' ')).toMatch(/einhorn/);
    expect(r.fehler.join(' ')).toMatch(/fehlt\.svg/);
    expect(r.fehler.join(' ')).toMatch(/2 Zellen/);
  });

  it('verlangt, dass kapitel zum Dateinamen passt', () => {
    const r = pruefeLernkarten({ kapitel: 'k2', karten: [karte(), karte(), karte(), karte()] }, 'k1');
    expect(r.fehler.join(' ')).toMatch(/Dateiname/);
  });

  it('zaehlt Woerter', () => {
    expect(zaehleWoerter('  Drei kurze   Woerter. ')).toBe(3);
    expect(zaehleWoerter('')).toBe(0);
  });

  it('die echten Lernkarten unter inhalt/lernen sind gueltig und decken jedes Kapitel ab', () => {
    const ordner = `${INHALT}lernen/`;
    if (!existsSync(ordner)) return;
    const grafiken = new Set<string>([
      ...readdirSync(`${INHALT}grafiken/`).filter((n) => n.endsWith('.svg')),
      ...(existsSync(`${ordner}grafiken/`) ? readdirSync(`${ordner}grafiken/`).filter((n) => n.endsWith('.svg')) : []),
    ]);
    const kapitelDateien = readdirSync(INHALT).filter((n) => /^\d+.*\.md$/.test(n)).map((n) => n.replace(/\.md$/, ''));
    const kartenDateien = readdirSync(ordner).filter((n) => n.endsWith('.json'));
    expect(kartenDateien.map((n) => n.replace(/\.json$/, '')).sort()).toEqual(kapitelDateien.sort());
    for (const datei of kartenDateien) {
      const roh = JSON.parse(readFileSync(`${ordner}${datei}`, 'utf8'));
      const { fehler } = pruefeLernkarten(roh, datei.replace(/\.json$/, ''), grafiken);
      expect(fehler, datei).toEqual([]);
      // Kein langer Gedankenstrich in dekaru-Texten.
      expect(readFileSync(`${ordner}${datei}`, 'utf8'), datei).not.toMatch(/[–—]/);
    }
  });

  it('der Admin sieht unter Lernen keine Formatfehler (dieselbe Pruefung wie im Portal)', async () => {
    // inhalt.ts liest die echten Dateien ueber import.meta.glob ein, genau
    // wie der Build. Was hier leer ist, zeigt auch /lernen nicht an.
    const inhalt = await import('../src/lib/inhalt.ts');
    expect(inhalt.inhaltsQuelle).toBe('inhalt/');
    expect(inhalt.lernkartenFehler).toEqual([]);
    expect(inhalt.quizFehler).toEqual([]);
  });

  it('jede Lerngrafik hat title, desc und viewBox und benutzt keine festen Textfarben', () => {
    const ordner = `${INHALT}lernen/grafiken/`;
    if (!existsSync(ordner)) return;
    for (const datei of readdirSync(ordner).filter((n) => n.endsWith('.svg'))) {
      const svg = readFileSync(`${ordner}${datei}`, 'utf8');
      expect(svg, datei).toMatch(/<title/);
      expect(svg, datei).toMatch(/<desc/);
      expect(svg, datei).toMatch(/viewBox=/);
      expect(svg, datei).toMatch(/currentColor/);
      // Farben kommen aus Variablen mit Ersatzwert, nie fest an ein Element.
      expect(svg.replace(/<style>[\s\S]*?<\/style>/, ''), datei).not.toMatch(/(fill|stroke)="#/);
    }
  });
});

// Fragen fuer den Durchlauf.
const DATEN = {
  fragen: [
    { id: 'a1', kapitel: 'k1', typ: 'multiple-choice', frage: 'Satz?', optionen: ['25 %', '35 %'], richtig: [1] },
    { id: 'a2', kapitel: 'k1', typ: 'wahr-falsch', aussage: 'Provision bei Auftrag.', richtig: false },
    { id: 'a3', kapitel: 'k1', typ: 'lueckentext', text: 'Stichtag der {{25|25.}}', luecken: [] },
  ],
};

function form(werte: Record<string, string>) {
  return { get: (name: string) => werte[name] ?? null, getAll: (name: string) => (werte[name] ? [werte[name]] : []) };
}

describe('Abfrage-Durchlauf', () => {
  let db: Db;
  let userId: string;
  let fragen: Frage[];
  beforeAll(async () => {
    db = await neueDb();
    userId = (await vertriebler(db, 'Abfrager')).id;
    fragen = pruefeQuizDaten(DATEN).fragen;
  });
  afterAll(() => db.close());

  it('geht Frage fuer Frage durch, loest erst nach der Antwort auf und speichert alles', async () => {
    expect(zustand(null)).toEqual({ art: 'leer' });
    let d = await starteDurchlauf(db, userId, 'k1', fragen.map((f) => f.id));
    expect(zustand(d)).toEqual({ art: 'frage', index: 0 });
    expect(fortschrittProzent(d)).toBe(0);

    // Antwort auf eine andere Frage als die offene wird abgelehnt.
    expect(await beantworteFrage(db, userId, d, fragen[1], form({ f_a2: 'wahr' }))).toBeNull();

    const e1 = await beantworteFrage(db, userId, d, fragen[0], form({ f_a1: '0' }));
    expect(e1?.bewertung.richtig).toBe(false);
    expect(zustand(d)).toEqual({ art: 'aufloesung', index: 0 });
    // Noch einmal antworten geht nicht, erst "weiter".
    expect(await beantworteFrage(db, userId, d, fragen[0], form({ f_a1: '1' }))).toBeNull();

    d = await weiter(db, userId, d);
    expect(zustand(d)).toEqual({ art: 'frage', index: 1 });
    expect(zustand((await ladeDurchlauf(db, userId, 'k1'))!)).toEqual({ art: 'frage', index: 1 });

    await beantworteFrage(db, userId, d, fragen[1], form({ f_a2: 'falsch' }));
    d = await weiter(db, userId, d);
    await beantworteFrage(db, userId, d, fragen[2], form({ f_a3__0: '25.' }));
    d = await weiter(db, userId, d);
    expect(zustand(d)).toEqual({ art: 'fertig' });
    expect(d.beendetAm).not.toBeNull();
    expect(fortschrittProzent(d)).toBe(100);

    const gespeichert = (await ladeDurchlauf(db, userId, 'k1'))!;
    expect(auswertung(gespeichert)).toEqual({ punkte: 2, max: 3, falsche: ['a1'] });
    expect(gespeichert.ergebnisse[0].antwort).toEqual({ typ: 'multiple-choice', indizes: [0] });

    // Die Einzelantworten liegen wie bisher in quiz_antworten.
    expect(await falscheFragen(db, userId)).toEqual(['a1']);
    expect((await ladeAntworten(db, userId, 'k1')).size).toBe(3);
  });

  it('wiederholt nur die falschen Fragen und ersetzt einen alten Durchlauf', async () => {
    const alt = (await ladeDurchlauf(db, userId, 'k1'))!;
    let d = await starteDurchlauf(db, userId, WIEDERHOLEN, auswertung(alt).falsche);
    expect(d.fragen).toEqual(['a1']);
    expect(zustand(d)).toEqual({ art: 'frage', index: 0 });
    await beantworteFrage(db, userId, d, fragen[0], form({ f_a1: '1' }));
    d = await weiter(db, userId, d);
    expect(zustand(d)).toEqual({ art: 'fertig' });
    expect(await falscheFragen(db, userId)).toEqual([]);
    expect((await ladeAntworten(db, userId)).get('a1')?.versuche).toBe(2);

    const neu = await starteDurchlauf(db, userId, 'k1', ['a2']);
    expect(neu.ergebnisse).toEqual([]);
    expect(neu.position).toBe(0);
  });

  it('merkt sich die Lernkarte und das Gelesen-Kennzeichen', async () => {
    await speichereKartenStand(db, userId, 'k1', 2, 5);
    await speichereKartenStand(db, userId, 'k1', 1, 5);
    let stand = await ladeKartenStand(db, userId);
    expect(stand.get('k1')).toEqual({ letzteKarte: 2, gelesen: false });
    await speichereKartenStand(db, userId, 'k1', 5, 5);
    stand = await ladeKartenStand(db, userId);
    expect(stand.get('k1')).toEqual({ letzteKarte: 5, gelesen: true });
    await markiereGelesen(db, userId, 'k2');
    stand = await ladeKartenStand(db, userId);
    expect(stand.get('k2')).toEqual({ letzteKarte: 0, gelesen: true });
    // Ausreisser werden begrenzt.
    await speichereKartenStand(db, userId, 'k3', 99, 4);
    expect((await ladeKartenStand(db, userId)).get('k3')).toEqual({ letzteKarte: 4, gelesen: true });
  });
});
