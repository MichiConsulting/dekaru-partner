import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/lib/db.ts';
import { neueDb, vertriebler } from './helfer.ts';
import { antwortAusFormular, bewerte, mischeStabil, pruefeQuizDaten, punkte, zerlegeLueckentext, type Frage } from '../src/lib/quiz.ts';
import { ergebnisseAusAntworten, verarbeiteQuiz } from '../src/lib/quiz-durchlauf.ts';
import { falscheFragen, fortschritt, ladeAntworten } from '../src/lib/lernen.ts';

const DATEN = {
  fragen: [
    { id: 'q1', kapitel: 'k1', typ: 'multiple-choice', frage: 'Satz?', optionen: ['25 %', '35 %', '50 %'], richtig: 1 },
    { id: 'q2', kapitel: 'k1', typ: 'wahr-falsch', aussage: 'Provision gibt es bei Auftrag.', richtig: false },
    { id: 'q3', kapitel: 'k1', typ: 'paare', frage: 'Ordne zu', paare: [{ links: 'Start', rechts: '19 €' }, { links: 'Basis', rechts: '39 €' }, ['Plus', '590 € im Jahr']] },
    { id: 'q4', kapitel: 'k2', typ: 'lueckentext', text: 'Hosting-Provision auf die ersten {{zwölf|12}} bezahlten Monate, ausgezahlt {{vierteljährlich}}.' },
    { id: 'q5', kapitel: 'k2', typ: 'multiple-choice', frage: 'kaputt', optionen: ['a'], richtig: 0 },
    { id: 'q1', kapitel: 'k2', typ: 'wahr-falsch', aussage: 'doppelt', richtig: true },
    { id: 'q6', kapitel: 'k2', typ: 'unbekannt' },
  ],
};

function form(werte: Record<string, string>) {
  return { get: (name: string) => werte[name] ?? null };
}

describe('Quizformat', () => {
  it('nimmt gueltige Fragen und meldet die anderen', () => {
    const { fragen, fehler } = pruefeQuizDaten(DATEN);
    expect(fragen.map((f) => f.id)).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(fehler.length).toBe(3);
    expect(fehler.join(' ')).toMatch(/zwei Optionen/);
    expect(fehler.join(' ')).toMatch(/doppelt/);
    expect(fehler.join(' ')).toMatch(/unbekannt/);
  });
  it('zerlegt Lueckentexte', () => {
    const teile = zerlegeLueckentext('A {{x|y}} B {{z}}');
    expect(teile).toEqual([
      { art: 'text', text: 'A ' },
      { art: 'luecke', index: 0, loesungen: ['x', 'y'] },
      { art: 'text', text: ' B ' },
      { art: 'luecke', index: 1, loesungen: ['z'] },
    ]);
  });
  it('mischt stabil', () => {
    const a = mischeStabil([1, 2, 3, 4, 5], 'q3');
    expect(a).toEqual(mischeStabil([1, 2, 3, 4, 5], 'q3'));
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('Bewertung', () => {
  const { fragen } = pruefeQuizDaten(DATEN);
  const [mc, wf, paare, luecke] = fragen;

  it('Multiple Choice und Wahr/Falsch', () => {
    expect(bewerte(mc, antwortAusFormular(mc, form({ f_q1: '1' }))).richtig).toBe(true);
    expect(bewerte(mc, antwortAusFormular(mc, form({ f_q1: '0' }))).richtig).toBe(false);
    expect(bewerte(mc, antwortAusFormular(mc, form({}))).richtig).toBe(false);
    expect(bewerte(wf, antwortAusFormular(wf, form({ f_q2: 'falsch' }))).richtig).toBe(true);
    expect(bewerte(wf, antwortAusFormular(wf, form({ f_q2: 'wahr' }))).loesung).toBe('Falsch');
  });
  it('Paare, jedes Paar einzeln bewertet', () => {
    const richtig = antwortAusFormular(paare, form({ f_q3__0: '19 €', f_q3__1: '39 €', f_q3__2: '590 € im Jahr' }));
    expect(bewerte(paare, richtig)).toMatchObject({ richtig: true, teile: [true, true, true] });
    const halb = antwortAusFormular(paare, form({ f_q3__0: '39 €', f_q3__1: '19 €', f_q3__2: '590 € im Jahr' }));
    expect(bewerte(paare, halb)).toMatchObject({ richtig: false, teile: [false, false, true] });
  });
  it('Lueckentext, Alternativen, Gross- und Kleinschreibung, Satzzeichen', () => {
    const a = antwortAusFormular(luecke, form({ f_q4__0: '12', f_q4__1: 'Vierteljährlich.' }));
    expect(bewerte(luecke, a).richtig).toBe(true);
    const b = antwortAusFormular(luecke, form({ f_q4__0: 'Zwölf ', f_q4__1: 'monatlich' }));
    expect(bewerte(luecke, b)).toMatchObject({ richtig: false, teile: [true, false] });
  });
  it('zaehlt Punkte', () => {
    expect(punkte([{ richtig: true, teile: [], loesung: '' }, { richtig: false, teile: [], loesung: '' }])).toEqual({ punkte: 1, max: 2 });
  });
});

describe('Durchlauf mit Speicherung', () => {
  let db: Db;
  let userId: string;
  let fragen: Frage[];
  beforeAll(async () => {
    db = await neueDb();
    userId = (await vertriebler(db, 'Quizzer')).id;
    fragen = pruefeQuizDaten(DATEN).fragen;
  });
  afterAll(() => db.close());

  it('speichert Antworten, merkt sich falsche und markiert das Kapitel', async () => {
    const k1 = fragen.filter((f) => f.kapitel === 'k1');
    const e = await verarbeiteQuiz(db, userId, k1, form({ f_q1: '1', f_q2: 'wahr', f_q3__0: '19 €', f_q3__1: '39 €', f_q3__2: '590 € im Jahr' }));
    expect(e.map((x) => x.bewertung.richtig)).toEqual([true, false, true]);
    expect(await falscheFragen(db, userId)).toEqual(['q2']);

    const gespeichert = await ladeAntworten(db, userId, 'k1');
    const wieder = ergebnisseAusAntworten(k1, gespeichert);
    expect(wieder.get('q2')?.bewertung.richtig).toBe(false);
    expect(wieder.get('q1')?.antwort).toEqual({ typ: 'multiple-choice', index: 1 });

    const karte = new Map([['k1', k1], ['k2', fragen.filter((f) => f.kapitel === 'k2')]]);
    let stand = await fortschritt(db, userId, karte);
    expect(stand).toEqual([
      { kapitel: 'k1', erledigt: false, fragen: 3, richtig: 2, beantwortet: 3 },
      { kapitel: 'k2', erledigt: false, fragen: 1, richtig: 0, beantwortet: 0 },
    ]);

    // Wiederholen: nur die falsche Frage, jetzt richtig.
    await verarbeiteQuiz(db, userId, [k1[1]], form({ f_q2: 'falsch' }));
    expect(await falscheFragen(db, userId)).toEqual([]);
    expect((await ladeAntworten(db, userId)).get('q2')?.versuche).toBe(2);
    stand = await fortschritt(db, userId, karte);
    expect(stand[0].erledigt).toBe(true);
  });
});
