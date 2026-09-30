// Bindeglied zu den Inhalten: Quizfragen und Grafiken werden zur Build-Zeit
// eingelesen. Nur dieses Modul kennt import.meta.glob, alles andere bleibt
// reines TypeScript.

import { echteInhalte } from './inhalt-pfade.ts';
import { pruefeQuizDaten, type Frage } from './quiz.ts';

const quizEcht = import.meta.glob('../../../inhalt/quiz.json', { eager: true, import: 'default' });
const quizPlatzhalter = import.meta.glob('../../inhalt-platzhalter/quiz.json', { eager: true, import: 'default' });
const grafikenEcht = import.meta.glob('../../../inhalt/grafiken/*.svg', { eager: true, query: '?raw', import: 'default' });
const grafikenPlatzhalter = import.meta.glob('../../inhalt-platzhalter/grafiken/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const echt = echteInhalte();

const quizRoh = Object.values(echt ? quizEcht : quizPlatzhalter)[0] ?? { fragen: [] };
const geprueft = pruefeQuizDaten(quizRoh);

/** Alle gueltigen Fragen. Fehler im Format stehen in quizFehler. */
export const fragen: Frage[] = geprueft.fragen;
export const quizFehler: string[] = geprueft.fehler;

export function fragenJeKapitel(kapitelSlugs: string[]): Map<string, Frage[]> {
  const karte = new Map<string, Frage[]>();
  for (const slug of kapitelSlugs) karte.set(slug, []);
  for (const f of fragen) {
    if (!karte.has(f.kapitel)) karte.set(f.kapitel, []);
    karte.get(f.kapitel)!.push(f);
  }
  return karte;
}

export function frageNachId(id: string): Frage | undefined {
  return fragen.find((f) => f.id === id);
}

const grafiken = new Map<string, string>();
for (const [pfad, inhalt] of Object.entries(echt ? grafikenEcht : grafikenPlatzhalter)) {
  const name = pfad.split('/').pop()!;
  grafiken.set(name, String(inhalt));
}

/** SVG-Quelltext einer Grafik nach Dateiname, oder null. */
export function grafik(datei: string): string | null {
  return grafiken.get(datei) ?? null;
}

export const inhaltsQuelle = echt ? 'inhalt/' : 'app/inhalt-platzhalter/';
