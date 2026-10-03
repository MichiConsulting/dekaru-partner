// Die Frage-Seite der Abfrage darf keine Loesung enthalten. Hier wird die
// Frage-Komponente so gerendert, wie die Abfrage sie zeigt (ohne Bewertung),
// und das Markup gegen die Loesungen geprueft. Die Aufloesung dagegen muss
// die Loesung und die Erklaerung zeigen.
import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import QuizFrage from '../src/components/QuizFrage.astro';
import Aufloesung from '../src/components/lernen/Aufloesung.astro';
import { antwortAusFormular, bewerte, pruefeQuizDaten } from '../src/lib/quiz.ts';

const { fragen } = pruefeQuizDaten({
  fragen: [
    {
      id: 'm1', kapitel: 'k', typ: 'multiple-choice', frage: 'Wie hoch ist die Provision?',
      optionen: ['Fuenfundzwanzig', 'Fuenfunddreissig', 'Fuenfzig'], richtig: [1], erklaerung: 'ERKLAERUNG-MC',
    },
    { id: 'w1', kapitel: 'k', typ: 'wahr-falsch', aussage: 'Provision bei Auftrag.', richtig: false, erklaerung: 'ERKLAERUNG-WF' },
    {
      id: 'z1', kapitel: 'k', typ: 'zuordnen', frage: 'Ordnen Sie zu',
      paare: [{ links: 'Start', rechts: 'LOESUNG-A' }, { links: 'Basis', rechts: 'LOESUNG-B' }, { links: 'Plus', rechts: 'LOESUNG-C' }],
      erklaerung: 'ERKLAERUNG-ZU',
    },
    { id: 'l1', kapitel: 'k', typ: 'lueckentext', text: 'Der Stichtag ist der {{GEHEIM-25|25.}} des Monats.', luecken: [], erklaerung: 'ERKLAERUNG-LT' },
  ],
});

describe('Abfrage-Markup', () => {
  it('die Frage-Seite enthaelt weder Loesung noch Erklaerung', async () => {
    const container = await AstroContainer.create();
    for (const frage of fragen) {
      const html = await container.renderToString(QuizFrage, { props: { frage, nummer: 1, antwort: null, bewertung: null } });
      expect(html).not.toMatch(/ERKLAERUNG/);
      expect(html).not.toMatch(/GEHEIM-25/);
      expect(html).not.toMatch(/richtig=|data-richtig|data-loesung/);
      if (frage.typ === 'multiple-choice') {
        // Die Optionen stehen drin, aber nichts markiert die richtige.
        expect(html).toMatch(/Fuenfunddreissig/);
        expect(html).not.toMatch(/checked/);
      }
      if (frage.typ === 'zuordnen') {
        // Die rechte Seite ist gemischt: nicht in Loesungsreihenfolge.
        const reihenfolge = ['LOESUNG-A', 'LOESUNG-B', 'LOESUNG-C'].map((l) => html.indexOf(`<option value="${l}"`));
        expect(reihenfolge.every((i) => i >= 0)).toBe(true);
        expect(reihenfolge).not.toEqual([...reihenfolge].sort((a, b) => a - b));
        expect(html).not.toMatch(/Start[^<]*LOESUNG-A/);
      }
    }
  });

  it('die Aufloesung zeigt Bewertung, Loesung und Erklaerung', async () => {
    const container = await AstroContainer.create();
    const mc = fragen[0];
    const antwort = antwortAusFormular(mc, { get: () => '0', getAll: () => ['0'] });
    const html = await container.renderToString(Aufloesung, { props: { frage: mc, antwort, bewertung: bewerte(mc, antwort) } });
    expect(html).toMatch(/Noch nicht richtig/);
    expect(html).toMatch(/ERKLAERUNG-MC/);
    expect(html).toMatch(/ist-loesung[^>]*>[\s\S]*?Fuenfunddreissig/);
    expect(html).toMatch(/Ihre Antwort/);

    const lt = fragen[3];
    const a2 = antwortAusFormular(lt, { get: () => '25.', getAll: () => [] });
    const html2 = await container.renderToString(Aufloesung, { props: { frage: lt, antwort: a2, bewertung: bewerte(lt, a2) } });
    expect(html2).toMatch(/Richtig\./);
  });
});
